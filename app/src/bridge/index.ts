// ============================================================================
// 浏览器安全入口：仅导出纯类型 / 纯函数 / mock，不引入 node 内置模块。
// Web UI 从这里 import（Vite 打包进浏览器）。
// ============================================================================

export type {
  RequestStatus,
  RecognitionCategory,
  RawInput,
  EvidenceReference,
  RecognitionResult,
  ClarificationQuestion,
  RevisionComment,
  RunState,
  RunRecord,
  SessionMetadata,
  WorkPackage,
  SaveRawInputRequest,
  PreflightCheck,
  PreflightResult,
  LaunchResult,
  MfpBridge,
} from './types';

export { BridgeError } from './errors';
export type { BridgeErrorPayload, BridgeErrorCode, ErrorCategory } from './errors';
export { toErrorPayload } from './errors';

export { REQUEST_STATUSES } from './validate';

export { recognizeDeterministic, buildMockRecognition } from './mock';
