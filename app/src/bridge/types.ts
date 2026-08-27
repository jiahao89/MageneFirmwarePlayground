import type { BridgeErrorPayload } from './errors';

// ============================================================================
// MFP 本地桥接契约（Contract）—— 类型定义
//
// 本文件是「本地 bridge contract」的唯一事实来源。前端（Web UI）与后端
// （Tauri Rust 命令层 / Node FileBridge）都必须对齐这里的类型。
// 状态机与字段口径对齐 Issue #1「MVP state model」与「Recognition」章节；
// 任务卡（TaskCard）对齐 Issue #1「Registration and work package」。
// ============================================================================

/**
 * 需求状态机（对齐 Issue #1「MVP state model」）。
 * `error` 是诊断态：Agent 写坏 JSON / 非法状态时，保留原文件并落到此态，
 * 不静默推断成功。
 *
 * 合法迁移见 `state-machine.ts` 的 ALLOWED_TRANSITIONS。
 */
export type RequestStatus =
  | 'pending_recognition' // 待识别
  | 'pending_confirmation' // 待 PM 确认
  | 'pending_launch' // 待启动
  | 'processing' // 处理中
  | 'pending_answer' // 待 PM 回答
  | 'pending_review' // 待审阅
  | 'revising' // 修改中
  | 'completed' // 完成
  | 'archived' // 归档
  | 'error'; // 诊断态（malformed）

/** 需求识别分类。 */
export type RecognitionCategory =
  | 'feature_request'
  | 'bug'
  | 'consultation'
  | 'research'
  | 'invalid'
  | 'duplicate_candidate';

/** 原始需求（先于 AI 处理保存，识别失败也不丢失）。 */
export interface RawInput {
  rawInputId: string;
  text: string;
  sourceDescription?: string;
  createdAt: string;
}

export interface EvidenceReference {
  kind: 'file' | 'external';
  ref: string;
  note?: string;
}

/** 结构化识别结果（Issue #1 要求字段）。 */
export interface RecognitionResult {
  category: RecognitionCategory;
  rewrittenRequirement: string;
  user: string;
  scenario: string;
  goal: string;
  scopeClues: string[];
  knownConstraints: string[];
  missingInformation: string[];
  evidence: EvidenceReference[];
  duplicateCandidates: string[];
  confidence: number; // 0..1
}

/**
 * 任务卡：可变的「工作契约」，非一次性 prompt。
 * 对齐 Issue #1「Registration and work package」的 task card 字段。
 */
export interface TaskCard {
  currentPhase: string;
  goal: string;
  confirmedScope: string[];
  unresolvedQuestions: string[];
  allowedContext: string[];
  expectedOutputs: string[];
  writeBackRules: string[];
  pauseConditions: string[];
  prohibitedActions: string[];
}

export interface ClarificationQuestion {
  id: string;
  text: string;
  answer?: string;
  answeredAt?: string;
}

export interface RevisionComment {
  id: string;
  text: string;
  createdAt: string;
}

export type RunState = 'running' | 'succeeded' | 'failed';

export interface RunRecord {
  runId: string;
  sessionId?: string;
  cliVersion?: string;
  startedAt: string;
  endedAt?: string;
  state: RunState;
  lastError?: BridgeErrorPayload;
}

export interface SessionMetadata {
  sessionId?: string;
  cliVersion?: string;
  startedAt?: string;
  processState?: 'idle' | 'running' | 'exited';
  lastError?: BridgeErrorPayload;
}

/**
 * 工作包（file-based source of truth）：单个文件承载完整生命周期，
 * 从「待识别」到「完成/归档」。持久化落盘由 FileWorkPackageStore 负责。
 */
export interface WorkPackage {
  requestId: string;
  rawInputId: string;
  status: RequestStatus;
  originalInput: RawInput;
  recognition: RecognitionResult | null;
  taskCard: TaskCard | null;
  questions: ClarificationQuestion[];
  revisionComments: RevisionComment[];
  prdPath?: string;
  prdVersion?: number;
  runLog: RunRecord[];
  session: SessionMetadata;
  artifacts: string[];
  updatedAt: string;
}

// ----------------------------------------------------------------------------
// 操作请求 / 响应类型（Web UI 与后端共用的公共操作面）
// ----------------------------------------------------------------------------

export interface SaveRawInputRequest {
  text: string;
  sourceDescription?: string;
}

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
}

export interface LaunchResult {
  ok: boolean;
  sessionId?: string;
  startedAt?: string;
  /** resume 失败降级为新会话时为 true。 */
  fallback?: boolean;
  /** 过程说明（如降级原因），供 UI 展示。 */
  note?: string;
  error?: BridgeErrorPayload;
}

/**
 * 本地桥接接口：Web UI 调用的全部公共操作。
 * Issue #2 交付工作包文件持久化 + 状态机 + 读写服务；
 * 真实 CLI 接入见 Issue #3，桥接联调见 Issue #6。
 *
 * 关键约束（Issue #2 验收）：
 *  - `register` / `archive` / `complete` 是 PM 权威动作，只能从合法前置状态迁移；
 *  - Agent 写回只允许落入 `pending_confirmation` / `pending_answer` / `pending_review`。
 */
export interface MfpBridge {
  saveRawInput(req: SaveRawInputRequest): Promise<WorkPackage>;
  recognize(requestId: string): Promise<RecognitionResult>;
  register(requestId: string): Promise<WorkPackage>;
  listWorkPackages(): Promise<WorkPackage[]>;
  readWorkPackage(requestId: string): Promise<WorkPackage>;
  preflight(requestId: string): Promise<PreflightResult>;
  launch(requestId: string): Promise<LaunchResult>;
  resume(requestId: string): Promise<LaunchResult>;
  answerQuestion(requestId: string, questionId: string, answer: string): Promise<WorkPackage>;
  submitRevision(requestId: string, comment: string): Promise<WorkPackage>;
  complete(requestId: string): Promise<WorkPackage>;
  archive(requestId: string): Promise<WorkPackage>;
}
