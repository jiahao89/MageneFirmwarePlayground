import { invoke } from '@tauri-apps/api/core';
import { BrowserMockBridge } from '../bridge/browser-mock';
import { BridgeError } from '../bridge/errors';
import type {
  MfpBridge,
  WorkPackage,
  RecognitionResult,
  SaveRawInputRequest,
  LaunchResult,
  PreflightResult,
  PreflightCheck,
} from '../bridge/index';

// ============================================================================
// 前端桥接适配器：
//  - 运行在 Tauri 桌面壳内（window.__TAURI_INTERNALS__ 存在）→ 走 invoke（命令名
//    与 src-tauri/src/commands.rs 对齐）
//  - 纯浏览器 / dev（无 Tauri）→ 走确定性 mock（BrowserMockBridge / FrontendMockBridge）
//  - 支持在 Web 前端动态切换模拟场景（如 CLI 未安装、未认证、目录丢失、启动失败、会话降级），
//    供 PM 评审与测试验证各种异常边界和可行动建议。
// ============================================================================

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export type MockScenario =
  | 'normal'
  | 'cli_not_installed'
  | 'not_authenticated'
  | 'root_missing'
  | 'launch_failed'
  | 'resume_fallback';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

/** Tauri 壳内：把 MfpBridge 操作映射到 Rust 命令。 */
class TauriBridge implements MfpBridge {
  saveRawInput(req: SaveRawInputRequest): Promise<WorkPackage> {
    return invoke<WorkPackage>('save_raw_input', { req });
  }
  recognize(requestId: string): Promise<RecognitionResult> {
    return invoke<RecognitionResult>('recognize', { requestId });
  }
  register(requestId: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('register', { requestId });
  }
  listWorkPackages(): Promise<WorkPackage[]> {
    return invoke<WorkPackage[]>('list_work_packages');
  }
  readWorkPackage(requestId: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('read_work_package', { requestId });
  }
  preflight(requestId: string): Promise<PreflightResult> {
    return invoke<PreflightResult>('preflight', { requestId });
  }
  launch(requestId: string): Promise<LaunchResult> {
    return invoke<LaunchResult>('launch', { requestId });
  }
  resume(requestId: string): Promise<LaunchResult> {
    return invoke<LaunchResult>('resume', { requestId });
  }
  answerQuestion(requestId: string, questionId: string, answer: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('answer_question', { requestId, questionId, answer });
  }
  submitRevision(requestId: string, comment: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('submit_revision', { requestId, comment });
  }
  complete(requestId: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('complete', { requestId });
  }
  archive(requestId: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('archive', { requestId });
  }
}

/** 前端模拟桥：支持多场景切换与高仿真 Preflight / Launch 交互 */
export class FrontendMockBridge implements MfpBridge {
  private baseMock: BrowserMockBridge;
  private scenario: MockScenario = 'normal';

  constructor() {
    this.baseMock = new BrowserMockBridge();
  }

  setScenario(s: MockScenario) {
    this.scenario = s;
  }

  getScenario(): MockScenario {
    return this.scenario;
  }

  saveRawInput(req: SaveRawInputRequest): Promise<WorkPackage> {
    return this.baseMock.saveRawInput(req);
  }

  async recognize(requestId: string): Promise<RecognitionResult> {
    if (this.scenario === 'not_authenticated') {
      throw new BridgeError('CLI_AUTH_FAILED', 'Claude Code 认证失败：请在终端执行 `claude login` 或配置 API 凭据');
    }
    if (this.scenario === 'cli_not_installed') {
      throw new BridgeError('CLI_NOT_FOUND', '未找到 claude 可执行文件（请安装并登录 Claude Code）');
    }
    return this.baseMock.recognize(requestId);
  }

  async register(requestId: string): Promise<WorkPackage> {
    const wp = await this.baseMock.register(requestId);
    // 注入示例澄清问题
    wp.questions = [
      {
        id: 'q-001',
        text: '当车手处于「陡坡导航转向」或「高心率冲刺」时，低电量弹窗是否直接遮盖转向箭头？',
      },
      {
        id: 'q-002',
        text: '踏频传感器单次骑行低电量广播的抑制周期是多久？建议为 15 分钟或单次骑行最多 2 次。',
      },
    ];
    return wp;
  }

  listWorkPackages(): Promise<WorkPackage[]> {
    return this.baseMock.listWorkPackages();
  }

  readWorkPackage(requestId: string): Promise<WorkPackage> {
    return this.baseMock.readWorkPackage(requestId);
  }

  async preflight(_requestId: string): Promise<PreflightResult> {
    // 高仿真 Preflight 检查项列表（与 local-bridge.ts 对齐）
    const checks: PreflightCheck[] = [];

    checks.push({
      name: 'mfp_root_exists',
      ok: this.scenario !== 'root_missing',
      detail: this.scenario !== 'root_missing' ? '/Users/jacko/Projects/MFP-Antigravity' : 'MFP 项目目录不存在',
    });

    checks.push({
      name: 'mfp_root_writable',
      ok: this.scenario !== 'root_missing',
      detail: this.scenario !== 'root_missing' ? '项目目录可写' : '目录不可写',
    });

    checks.push({
      name: 'cli_installed',
      ok: this.scenario !== 'cli_not_installed',
      detail:
        this.scenario !== 'cli_not_installed'
          ? '/usr/local/bin/claude'
          : '未找到 claude 可执行文件（请安装并登录 Claude Code）',
    });

    checks.push({
      name: 'cli_version',
      ok: this.scenario !== 'cli_not_installed',
      detail: this.scenario !== 'cli_not_installed' ? 'claude 2.1.229' : '无法获取版本（--version 失败）',
    });

    checks.push({
      name: 'cli_auth',
      ok: this.scenario !== 'not_authenticated' && this.scenario !== 'cli_not_installed',
      detail:
        this.scenario === 'not_authenticated'
          ? '未认证（请在终端执行 `claude login` 或配置 API 凭据）'
          : this.scenario === 'cli_not_installed'
            ? 'CLI 未安装，跳过认证检查'
            : '认证正常（已探测最小调用）',
    });

    checks.push({
      name: 'rules_entrypoints',
      ok: true,
      detail: 'AGENTS.md=true；BENCHMARK.md=true',
    });

    checks.push({
      name: 'task_card_readable',
      ok: true,
      detail: 'currentPhase=Phase 0 事实源召回',
    });

    checks.push({
      name: 'output_writable',
      ok: true,
      detail: '/Users/jacko/Projects/MFP-Antigravity/output',
    });

    return {
      ok: checks.every((c) => c.ok),
      checks,
    };
  }

  async launch(requestId: string): Promise<LaunchResult> {
    if (this.scenario === 'launch_failed') {
      throw new BridgeError('TERMINAL_LAUNCH_FAILED', '无法打开外部终端应用：osascript 执行异常，请尝试手动复制启动指令');
    }
    if (this.scenario === 'cli_not_installed') {
      throw new BridgeError('CLI_NOT_FOUND', '未找到 claude 可执行文件，无法启动终端会话');
    }
    if (this.scenario === 'not_authenticated') {
      throw new BridgeError('CLI_AUTH_FAILED', 'Claude Code 未登录或凭据失效，无法启动终端会话');
    }
    return this.baseMock.launch(requestId);
  }

  async resume(requestId: string): Promise<LaunchResult> {
    if (this.scenario === 'resume_fallback') {
      const wp = await this.baseMock.readWorkPackage(requestId);
      const fallbackSessionId = `SESSION-FALLBACK-${Date.now().toString(36)}`;
      const startedAt = new Date().toISOString();
      wp.session = {
        sessionId: fallbackSessionId,
        processState: 'running',
        startedAt,
      };
      wp.runLog.push({
        runId: `RUN-${Date.now().toString(36)}`,
        sessionId: fallbackSessionId,
        startedAt,
        state: 'running',
      });
      wp.updatedAt = startedAt;
      return {
        ok: true,
        sessionId: fallbackSessionId,
        startedAt,
        fallback: true,
        note: '历史会话文件缺失或已过期，已基于工作包重新创建新会话',
      };
    }
    return this.baseMock.resume(requestId);
  }

  async answerQuestion(requestId: string, questionId: string, answer: string): Promise<WorkPackage> {
    const wp = await this.baseMock.readWorkPackage(requestId);
    const q = wp.questions.find((x) => x.id === questionId);
    if (!q) throw new BridgeError('INVALID_ARGUMENT', `找不到澄清问题：${questionId}`);
    q.answer = answer;
    q.answeredAt = new Date().toISOString();
    wp.status = 'processing';
    wp.updatedAt = new Date().toISOString();
    return wp;
  }

  async submitRevision(requestId: string, comment: string): Promise<WorkPackage> {
    const wp = await this.baseMock.readWorkPackage(requestId);
    if (typeof comment !== 'string' || comment.trim().length === 0) {
      throw new BridgeError('INVALID_ARGUMENT', '修改意见不能为空');
    }
    wp.revisionComments.push({
      id: `RC-${Date.now().toString(36)}`,
      text: comment,
      createdAt: new Date().toISOString(),
    });
    wp.status = 'revising';
    wp.updatedAt = new Date().toISOString();
    return wp;
  }

  async complete(requestId: string): Promise<WorkPackage> {
    const wp = await this.baseMock.readWorkPackage(requestId);
    wp.status = 'completed';
    const run = wp.runLog.find((r) => r.state === 'running');
    if (run) {
      run.state = 'succeeded';
      run.endedAt = new Date().toISOString();
    }
    if (wp.session.processState === 'running') wp.session.processState = 'exited';
    wp.updatedAt = new Date().toISOString();
    return wp;
  }

  archive(requestId: string): Promise<WorkPackage> {
    return this.baseMock.archive(requestId);
  }
}

let cached: MfpBridge | null = null;

export function getBridge(): MfpBridge {
  if (!cached) cached = isTauri() ? new TauriBridge() : new FrontendMockBridge();
  return cached;
}
