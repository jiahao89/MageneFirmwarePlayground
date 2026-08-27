import { BridgeError } from './errors';
import { RunGuard } from './concurrency';
import { hashString } from './util';
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
// 内存实现的工作包桥接核心（无 node 依赖，浏览器 / Node 共用）。
// 「识别」与「预检」通过依赖注入（recognizeRaw / preflightRaw）形成运行时适配边界，
// 对应 Issue #1「keep Agent-specific logic behind a runtime adapter」。
// 真实 CLI 适配见 Issue #3，工作包落盘见 Issue #2。
// ============================================================================

export interface InMemoryBridgeDeps {
  now: () => string;
  recognizeRaw: (raw: RawInput) => Promise<RecognitionResult>;
  preflightRaw: (requestId: string) => Promise<PreflightResult>;
}

export class InMemoryBridge implements MfpBridge {
  protected readonly now: () => string;
  protected readonly recognizeRaw: (raw: RawInput) => Promise<RecognitionResult>;
  protected readonly preflightRaw: (requestId: string) => Promise<PreflightResult>;
  protected readonly runGuard = new RunGuard();
  protected readonly rawStore = new Map<string, RawInput>();
  protected readonly store = new Map<string, WorkPackage>();
  protected seq = 0;

  constructor(deps: InMemoryBridgeDeps) {
    this.now = deps.now;
    this.recognizeRaw = deps.recognizeRaw;
    this.preflightRaw = deps.preflightRaw;
  }

  async saveRawInput(req: SaveRawInputRequest): Promise<RawInput> {
    if (typeof req.text !== 'string' || req.text.trim().length === 0) {
      throw new BridgeError('INVALID_ARGUMENT', '原始需求文本不能为空');
    }
    this.seq += 1;
    const raw: RawInput = {
      rawInputId: `RAW-${hashString(req.text)}-${this.seq.toString(36)}`,
      text: req.text,
      sourceDescription: req.sourceDescription?.trim() || undefined,
      createdAt: this.now(),
    };
    this.rawStore.set(raw.rawInputId, raw);
    return raw;
  }

  async recognize(rawInputId: string): Promise<RecognitionResult> {
    const raw = this.rawStore.get(rawInputId);
    if (!raw) throw new BridgeError('INVALID_ARGUMENT', `找不到原始输入：${rawInputId}`);
    return this.recognizeRaw(raw);
  }

  async register(rawInputId: string): Promise<WorkPackage> {
    const raw = this.rawStore.get(rawInputId);
    if (!raw) throw new BridgeError('INVALID_ARGUMENT', `找不到原始输入：${rawInputId}`);

    let recognition: RecognitionResult | null = null;
    try {
      recognition = await this.recognize(rawInputId);
    } catch {
      // 识别失败不阻断登记：保留原始输入，识别结果置空，UI 可重试。
      recognition = null;
    }

    this.seq += 1;
    const requestId = `REQ-${hashString(raw.rawInputId)}-${this.seq.toString(36)}`;
    const wp: WorkPackage = {
      requestId,
      rawInputId,
      status: 'pending_launch',
      originalInput: raw,
      recognition,
      questions: [],
      revisionComments: [],
      runLog: [],
      session: {},
      artifacts: [],
      updatedAt: this.now(),
    };
    this.store.set(requestId, wp);
    return wp;
  }

  async preflight(requestId: string): Promise<PreflightResult> {
    return this.preflightRaw(requestId);
  }

  async launch(requestId: string): Promise<LaunchResult> {
    const wp = this.store.get(requestId);
    if (!wp) throw new BridgeError('INVALID_ARGUMENT', `找不到工作包：${requestId}`);

    this.runGuard.acquire(requestId, this.now);
    try {
      const sessionId = `SESSION-${hashString(requestId)}`;
      const startedAt = this.now();
      wp.status = 'processing';
      wp.session = { sessionId, processState: 'running', startedAt };
      this.seq += 1;
      wp.runLog.push({ runId: `RUN-${this.seq.toString(36)}`, sessionId, startedAt, state: 'running' });
      wp.updatedAt = this.now();
      return { ok: true, sessionId, startedAt };
    } catch (e) {
      this.runGuard.release(requestId);
      throw e;
    }
  }

  async resume(requestId: string): Promise<LaunchResult> {
    // mock 语义：与 launch 等价（真实会话恢复见 Issue #3）。
    return this.launch(requestId);
  }

  async readWorkPackage(requestId: string): Promise<WorkPackage> {
    const wp = this.store.get(requestId);
    if (!wp) throw new BridgeError('INVALID_ARGUMENT', `找不到工作包：${requestId}`);
    return wp;
  }

  async answerQuestion(requestId: string, questionId: string, answer: string): Promise<WorkPackage> {
    const wp = this.store.get(requestId);
    if (!wp) throw new BridgeError('INVALID_ARGUMENT', `找不到工作包：${requestId}`);
    const q = wp.questions.find((x) => x.id === questionId);
    if (!q) throw new BridgeError('INVALID_ARGUMENT', `找不到澄清问题：${questionId}`);
    q.answer = answer;
    q.answeredAt = this.now();
    wp.status = 'processing';
    wp.updatedAt = this.now();
    return wp;
  }

  async submitRevision(requestId: string, comment: string): Promise<WorkPackage> {
    const wp = this.store.get(requestId);
    if (!wp) throw new BridgeError('INVALID_ARGUMENT', `找不到工作包：${requestId}`);
    if (typeof comment !== 'string' || comment.trim().length === 0) {
      throw new BridgeError('INVALID_ARGUMENT', '修改意见不能为空');
    }
    this.seq += 1;
    const rc: RevisionComment = { id: `RC-${this.seq.toString(36)}`, text: comment, createdAt: this.now() };
    wp.revisionComments.push(rc);
    wp.status = 'revising';
    wp.updatedAt = this.now();
    return wp;
  }

  async complete(requestId: string): Promise<WorkPackage> {
    const wp = this.store.get(requestId);
    if (!wp) throw new BridgeError('INVALID_ARGUMENT', `找不到工作包：${requestId}`);
    wp.status = 'completed';
    const run = wp.runLog.find((r) => r.state === 'running');
    if (run) {
      run.state = 'succeeded';
      run.endedAt = this.now();
    }
    if (wp.session.processState === 'running') wp.session.processState = 'exited';
    this.runGuard.release(requestId);
    wp.updatedAt = this.now();
    return wp;
  }
}
