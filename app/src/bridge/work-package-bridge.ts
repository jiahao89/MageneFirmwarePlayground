import { BridgeError } from './errors';
import { RunGuard } from './concurrency';
import { hashString } from './util';
import { assertTransition } from './state-machine';
import { buildTaskCard } from './task-card';
import { buildDiagnosticWorkPackage } from './work-package-store';
import { MockSessionDriver } from './session-driver';
import type { WorkPackageStore } from './work-package-store';
import type { SessionDriver } from './session-driver';
import type {
  MfpBridge,
  RawInput,
  RecognitionResult,
  WorkPackage,
  SaveRawInputRequest,
  LaunchResult,
  PreflightResult,
  RevisionComment,
} from './types';

// ============================================================================
// 工作包桥接核心（无 node 依赖）：状态机 + 存储 + 并发保护。
// 「识别」与「预检」通过依赖注入（recognizeRaw / preflightRaw）形成运行时适配边界；
// 存储通过 WorkPackageStore 注入（内存 / 文件）。
//
// PM 权威动作（register / archive / complete / launch / answerQuestion /
// submitRevision）都经 assertTransition 校验前置状态；Agent 写回（外部改文件）
// 只允许落入 AGENT_WRITABLE_STATUSES（见 state-machine.ts）。
// ============================================================================

export interface WorkPackageBridgeDeps {
  now: () => string;
  store: WorkPackageStore;
  recognizeRaw: (raw: RawInput) => Promise<RecognitionResult>;
  preflightRaw: (requestId: string) => Promise<PreflightResult>;
  /** 会话驱动；默认内存 mock（浏览器与 UI 测试沿用既有行为）。 */
  sessions?: SessionDriver;
  /**
   * 会话进程存活性探测（Issue #6 验收 F-4 修复）：processState 为 running 时
   * 用于对账——进程已不存在则回写 exited，避免状态永远停留在 running。
   * 缺省（浏览器 mock）不做对账。
   */
  sessionAlive?: (sessionId: string) => Promise<boolean>;
}

export class WorkPackageBridge implements MfpBridge {
  protected readonly now: () => string;
  protected readonly store: WorkPackageStore;
  protected readonly recognizeRaw: (raw: RawInput) => Promise<RecognitionResult>;
  protected readonly preflightRaw: (requestId: string) => Promise<PreflightResult>;
  protected readonly sessions: SessionDriver;
  protected readonly sessionAlive: ((sessionId: string) => Promise<boolean>) | undefined;
  protected readonly runGuard = new RunGuard();
  protected seq = 0;

  constructor(deps: WorkPackageBridgeDeps) {
    this.now = deps.now;
    this.store = deps.store;
    this.recognizeRaw = deps.recognizeRaw;
    this.preflightRaw = deps.preflightRaw;
    this.sessions = deps.sessions ?? new MockSessionDriver();
    this.sessionAlive = deps.sessionAlive;
  }

  async saveRawInput(req: SaveRawInputRequest): Promise<WorkPackage> {
    if (typeof req.text !== 'string' || req.text.trim().length === 0) {
      throw new BridgeError('INVALID_ARGUMENT', '原始需求文本不能为空');
    }
    this.seq += 1;
    const suffix = this.seq.toString(36);
    const requestId = `REQ-${hashString(req.text)}-${suffix}`;
    const rawInputId = `RAW-${hashString(req.text)}-${suffix}`;
    const createdAt = this.now();
    const wp: WorkPackage = {
      requestId,
      rawInputId,
      status: 'pending_recognition',
      originalInput: {
        rawInputId,
        text: req.text,
        sourceDescription: req.sourceDescription?.trim() || undefined,
        createdAt,
      },
      recognition: null,
      taskCard: null,
      questions: [],
      revisionComments: [],
      runLog: [],
      session: {},
      artifacts: [],
      updatedAt: createdAt,
    };
    await this.store.save(wp);
    return wp;
  }

  async recognize(requestId: string): Promise<RecognitionResult> {
    const wp = await this.loadRequired(requestId);
    if (wp.status !== 'pending_recognition' && wp.status !== 'pending_confirmation') {
      throw new BridgeError('INVALID_TRANSITION', `非法识别时机：当前状态 ${wp.status}`, { requestId, status: wp.status });
    }
    const recognition = await this.recognizeRaw(wp.originalInput);
    wp.recognition = recognition;
    if (wp.status === 'pending_recognition') {
      assertTransition('pending_recognition', 'pending_confirmation', 'recognize');
      wp.status = 'pending_confirmation';
    }
    wp.updatedAt = this.now();
    await this.store.save(wp);
    return recognition;
  }

  async register(requestId: string): Promise<WorkPackage> {
    const wp = await this.loadRequired(requestId);
    assertTransition(wp.status, 'pending_launch', 'register（PM 确认登记）');
    if (!wp.recognition) {
      throw new BridgeError('INVALID_TRANSITION', '登记前需先完成识别（recognition 缺失）');
    }
    wp.status = 'pending_launch';
    wp.taskCard = buildTaskCard(wp.recognition);
    wp.updatedAt = this.now();
    await this.store.save(wp);
    return wp;
  }

  async archive(requestId: string): Promise<WorkPackage> {
    const wp = await this.loadRequired(requestId);
    assertTransition(wp.status, 'archived', 'archive（PM 归档）');
    wp.status = 'archived';
    wp.updatedAt = this.now();
    await this.store.save(wp);
    return wp;
  }

  async launch(requestId: string): Promise<LaunchResult> {
    const wp = await this.loadRequired(requestId);
    if (wp.session.processState === 'running') {
      // 持久化状态显示运行中：先对账，进程确实已不存在则放行重新启动，
      // 避免 stale running 状态把 launch 永远卡死（Issue #6 验收 F-4 修复）。
      if (await this.isSessionAlive(wp.session.sessionId)) {
        throw new BridgeError('CONCURRENT_RUN', `请求 ${requestId} 已处于运行状态`);
      }
      wp.session.processState = 'exited';
      wp.updatedAt = this.now();
      await this.store.save(wp);
    }
    this.runGuard.acquire(requestId, this.now);
    try {
      assertTransition(wp.status, 'processing', 'launch（PM 启动）');
      const outcome = await this.sessions.startNew(wp);
      const startedAt = this.now();
      wp.status = 'processing';
      wp.session = {
        sessionId: outcome.sessionId,
        cliVersion: outcome.cliVersion,
        processState: 'running',
        startedAt,
        lastError: outcome.lastError,
      };
      this.seq += 1;
      wp.runLog.push({ runId: `RUN-${this.seq.toString(36)}`, sessionId: outcome.sessionId, startedAt, state: 'running' });
      wp.updatedAt = this.now();
      await this.store.save(wp);
      return { ok: true, sessionId: outcome.sessionId, startedAt, fallback: outcome.fallback, note: outcome.note };
    } catch (e) {
      this.runGuard.release(requestId);
      throw e;
    }
  }

  async resume(requestId: string): Promise<LaunchResult> {
    const wp = await this.loadRequired(requestId);
    // 同一应用会话内已在运行 → 直接返回既有会话（防止重复开终端）。
    // 应用重启后内存守卫为空，resume 会真正走适配器恢复已保存会话。
    if (this.runGuard.isRunning(requestId) && wp.session.sessionId) {
      return { ok: true, sessionId: wp.session.sessionId, startedAt: wp.session.startedAt };
    }
    this.runGuard.acquire(requestId, this.now);
    try {
      // 会话恢复是会话层操作：仅当需求尚在「待启动」时才迁移到「处理中」；
      // 其余状态（如处理中 / 待回答）保持不变，只更新会话元数据。
      if (wp.status === 'pending_launch') {
        assertTransition(wp.status, 'processing', 'resume（PM 恢复会话）');
        wp.status = 'processing';
      }
      const outcome = await this.sessions.resume(wp);
      const startedAt = this.now();
      wp.session = {
        sessionId: outcome.sessionId,
        cliVersion: outcome.cliVersion,
        processState: 'running',
        startedAt,
        lastError: outcome.lastError,
      };
      this.seq += 1;
      wp.runLog.push({ runId: `RUN-${this.seq.toString(36)}`, sessionId: outcome.sessionId, startedAt, state: 'running' });
      wp.updatedAt = this.now();
      await this.store.save(wp);
      return { ok: true, sessionId: outcome.sessionId, startedAt, fallback: outcome.fallback, note: outcome.note };
    } catch (e) {
      this.runGuard.release(requestId);
      throw e;
    }
  }

  async listWorkPackages(): Promise<WorkPackage[]> {
    return this.store.list();
  }

  async readWorkPackage(requestId: string): Promise<WorkPackage> {
    const result = await this.store.load(requestId);
    if (result.kind === 'missing') {
      throw new BridgeError('INVALID_ARGUMENT', `找不到工作包：${requestId}`);
    }
    if (result.kind === 'malformed') {
      // 原文件保留在磁盘，返回诊断态工作包（status: error）
      return buildDiagnosticWorkPackage(requestId, result.reason);
    }
    // 会话状态对账（Issue #6 验收 F-4 修复）：UI 每 3 秒轮询本方法，
    // 进程已不存在时把 running 回写为 exited，避免状态永远停留。
    return this.reconcileSessionState(result.workPackage);
  }

  async answerQuestion(requestId: string, questionId: string, answer: string): Promise<WorkPackage> {
    const wp = await this.loadRequired(requestId);
    // 同一轮澄清允许连续回答（Issue #6 验收 F-3 修复）：首个回答把
    // pending_answer 迁移到 processing；其后同轮回答在 processing 下继续，
    // 不再被状态机拒绝。其他状态（如 pending_review/completed）仍拒绝。
    if (wp.status === 'pending_answer') {
      assertTransition(wp.status, 'processing', 'answerQuestion（PM 回答后继续）');
      wp.status = 'processing';
    } else if (wp.status !== 'processing') {
      throw new BridgeError(
        'INVALID_TRANSITION',
        `回答澄清问题需要状态为 pending_answer 或 processing（当前 ${wp.status}）`,
        { requestId, status: wp.status },
      );
    }
    const q = wp.questions.find((x) => x.id === questionId);
    if (!q) throw new BridgeError('INVALID_ARGUMENT', `找不到澄清问题：${questionId}`);
    q.answer = answer;
    q.answeredAt = this.now();
    wp.updatedAt = this.now();
    await this.store.save(wp);
    return wp;
  }

  async submitRevision(requestId: string, comment: string): Promise<WorkPackage> {
    const wp = await this.loadRequired(requestId);
    assertTransition(wp.status, 'revising', 'submitRevision（PM 提修改意见）');
    if (typeof comment !== 'string' || comment.trim().length === 0) {
      throw new BridgeError('INVALID_ARGUMENT', '修改意见不能为空');
    }
    this.seq += 1;
    const rc: RevisionComment = { id: `RC-${this.seq.toString(36)}`, text: comment, createdAt: this.now() };
    wp.revisionComments.push(rc);
    wp.status = 'revising';
    wp.updatedAt = this.now();
    await this.store.save(wp);
    return wp;
  }

  async complete(requestId: string): Promise<WorkPackage> {
    const wp = await this.loadRequired(requestId);
    assertTransition(wp.status, 'completed', 'complete（PM 完成）');
    wp.status = 'completed';
    const run = wp.runLog.find((r) => r.state === 'running');
    if (run) {
      run.state = 'succeeded';
      run.endedAt = this.now();
    }
    if (wp.session.processState === 'running') wp.session.processState = 'exited';
    this.runGuard.release(requestId);
    wp.updatedAt = this.now();
    await this.store.save(wp);
    return wp;
  }

  async preflight(requestId: string): Promise<PreflightResult> {
    return this.preflightRaw(requestId);
  }

  /** 会话状态对账：running 且进程已不存在 → 回写 exited 并持久化。 */
  private async reconcileSessionState(wp: WorkPackage): Promise<WorkPackage> {
    if (wp.session.processState !== 'running' || !wp.session.sessionId) return wp;
    if (await this.isSessionAlive(wp.session.sessionId)) return wp;
    wp.session.processState = 'exited';
    wp.updatedAt = this.now();
    await this.store.save(wp);
    return wp;
  }

  /** 存活性探测；未注入探测（浏览器 mock）或探测异常时视为存活（保守，不误杀）。 */
  private async isSessionAlive(sessionId: string | undefined): Promise<boolean> {
    if (!this.sessionAlive || !sessionId) return true;
    try {
      return await this.sessionAlive(sessionId);
    } catch {
      return true;
    }
  }

  /** 读取并校验：missing → INVALID_ARGUMENT；malformed → 抛 MALFORMED_STATE（保留原文件）。 */
  private async loadRequired(requestId: string): Promise<WorkPackage> {
    const result = await this.store.load(requestId);
    if (result.kind === 'missing') {
      throw new BridgeError('INVALID_ARGUMENT', `找不到工作包：${requestId}`);
    }
    if (result.kind === 'malformed') {
      throw new BridgeError('MALFORMED_STATE', `工作包 malformed：${result.reason}（原文件已保留）`, { requestId });
    }
    return result.workPackage;
  }
}
