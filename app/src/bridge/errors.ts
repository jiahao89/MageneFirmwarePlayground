import { isPlainObject } from './util';

// ============================================================================
// 错误模型（Contract）：统一错误码 + 分类 + 可行动消息。
// 对齐 Issue #1 用户故事 28 要求的可行动错误：缺 CLI、认证失败、权限、超时、
// malformed 输出。
// ============================================================================

export type ErrorCategory =
  | 'path' // 路径安全
  | 'concurrency' // 并发保护
  | 'state' // 状态 / 数据格式
  | 'cli' // Claude Code CLI / 认证
  | 'io' // 文件 / 权限
  | 'argument' // 参数
  | 'not_implemented'; // 未接入（脚手架占位）

export type BridgeErrorCode =
  | 'INVALID_PATH'
  | 'CONCURRENT_RUN'
  | 'MALFORMED_STATE'
  | 'CLI_NOT_FOUND'
  | 'CLI_AUTH_FAILED'
  | 'CLI_TIMEOUT'
  | 'MALFORMED_OUTPUT'
  | 'WORKSPACE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'INVALID_ARGUMENT'
  | 'NOT_IMPLEMENTED';

export interface BridgeErrorPayload {
  code: BridgeErrorCode;
  category: ErrorCategory;
  /** 面向用户、可行动的错误描述。 */
  message: string;
  details?: unknown;
}

const CODE_CATEGORY: Record<BridgeErrorCode, ErrorCategory> = {
  INVALID_PATH: 'path',
  CONCURRENT_RUN: 'concurrency',
  MALFORMED_STATE: 'state',
  CLI_NOT_FOUND: 'cli',
  CLI_AUTH_FAILED: 'cli',
  CLI_TIMEOUT: 'cli',
  MALFORMED_OUTPUT: 'state',
  WORKSPACE_NOT_FOUND: 'io',
  PERMISSION_DENIED: 'io',
  INVALID_ARGUMENT: 'argument',
  NOT_IMPLEMENTED: 'not_implemented',
};

export class BridgeError extends Error {
  readonly payload: BridgeErrorPayload;

  constructor(code: BridgeErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'BridgeError';
    this.payload = { code, category: CODE_CATEGORY[code], message, details };
  }
}

/** 把任意异常规整为 BridgeErrorPayload，供跨进程 / 序列化边界透传。 */
export function toErrorPayload(err: unknown): BridgeErrorPayload {
  if (err instanceof BridgeError) return err.payload;
  if (
    isPlainObject(err) &&
    typeof err.code === 'string' &&
    typeof err.message === 'string'
  ) {
    return { code: err.code as BridgeErrorCode, category: 'state', message: err.message };
  }
  return { code: 'MALFORMED_STATE', category: 'state', message: String(err) };
}
