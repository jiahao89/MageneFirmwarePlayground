import type { RawInput, RecognitionResult } from './types';

// ============================================================================
// 运行时适配边界（Issue #1「keep Agent-specific logic behind a runtime adapter」）。
//
// MVP 只实现一个适配器：Claude Code CLI（claude-cli-adapter.ts）。
// 测试用 FakeCliRuntimeAdapter（fake-cli-runtime-adapter.ts）替换。
// 未来新增 Codex / Trae 只需新增适配器，不改工作包契约。
// ============================================================================

export interface CliAvailability {
  installed: boolean;
  /** CLI 可执行文件路径（installed 为 true 时存在）。 */
  path?: string;
  /** `claude --version` 输出（installed 为 true 时存在）。 */
  version?: string;
}

export type AuthCheck = { ok: true } | { ok: false; message: string };

export type StartSessionMode = 'new' | 'resume';

/** 终端会话启动指令：全部字段受控，绝不含用户原文。 */
export interface StartSessionSpec {
  /** 显式工作目录（MFP 根目录）。 */
  cwd: string;
  sessionId: string;
  mode: StartSessionMode;
  /** resume 时使用的既有会话 ID。 */
  resumeSessionId?: string;
  /** 会话显示名（`-n/--name`），只含受控文本。 */
  sessionName: string;
  /** 启动指令全文；经启动文件传递，不拼入命令行。 */
  startupInstruction: string;
  /** 启动指令文件路径（桥接层写入）。 */
  startupFile: string;
}

export interface StartSessionResult {
  sessionId: string;
  /** resume 失败降级为新会话时为 true。 */
  fallback: boolean;
  /** 给用户看的过程说明（如降级原因）。 */
  note?: string;
  /** resume/启动前置检查失败时记录到 session.lastError 的错误。 */
  lastError?: { code: string; message: string };
}

export interface RuntimeAdapter {
  /** CLI 是否可用 + 版本。不得读取或保存任何凭据。 */
  checkAvailability(): Promise<CliAvailability>;
  /**
   * 认证检查：调用方（如 preflight）可执行的轻量探测。
   * 认证归 Claude Code 自身管理；桥接层只转述 CLI 的认证错误，
   * 绝不保存 / 检查凭据内容。
   */
  checkAuth(): Promise<AuthCheck>;
  /** 非交互识别模式：结构化 JSON 输入 → 结构化 JSON 输出（经校验）。 */
  recognize(raw: RawInput): Promise<RecognitionResult>;
  /** 在外部终端启动 / 恢复交互会话。实现内部处理 resume 失败降级。 */
  startSession(spec: StartSessionSpec): Promise<StartSessionResult>;
}
