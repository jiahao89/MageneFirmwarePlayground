import { BridgeError } from './errors';
import type { RequestStatus } from './types';

// ============================================================================
// 需求状态机（纯函数）：对齐 Issue #1「MVP state model」。
//
//   待识别 → 待 PM 确认 → 待启动 → 处理中
//   处理中 → 待 PM 回答 → 处理中
//   处理中 → 待审阅 → 修改中 → 待审阅
//   待审阅 → 完成
//   待 PM 确认 → 归档
//
// 关键约束（Issue #2 验收「PM 才能确认登记、归档和完成」）：
//  - 只有 PM 权威动作能迁入 `pending_launch` / `completed` / `archived` / `revising`；
//  - Agent 写回只允许迁入 `pending_confirmation` / `pending_answer` / `pending_review`。
// ============================================================================

export const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  pending_recognition: ['pending_confirmation'],
  pending_confirmation: ['pending_launch', 'archived'],
  pending_launch: ['processing', 'archived'],
  processing: ['pending_answer', 'pending_review'],
  pending_answer: ['processing'],
  pending_review: ['revising', 'completed', 'archived'],
  revising: ['pending_review'],
  completed: [],
  archived: [],
  error: [], // 诊断态：无出边，需人工修复文件后重读
};

/** 只有 PM 权威动作能迁入的状态。 */
export const PM_AUTHORITATIVE_STATUSES: readonly RequestStatus[] = [
  'pending_launch',
  'completed',
  'archived',
  'revising',
];

/** Agent（外部 CLI 写回）允许迁入的状态。 */
export const AGENT_WRITABLE_STATUSES: readonly RequestStatus[] = [
  'pending_confirmation',
  'pending_answer',
  'pending_review',
];

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/** 校验状态迁移；非法迁移抛 INVALID_TRANSITION。 */
export function assertTransition(from: RequestStatus, to: RequestStatus, context?: string): void {
  if (!canTransition(from, to)) {
    throw new BridgeError(
      'INVALID_TRANSITION',
      `非法状态迁移：${from} → ${to}${context ? `（${context}）` : ''}`,
      { from, to },
    );
  }
}

/** 校验目标状态是否允许 Agent 写回；PM 权威状态抛 INVALID_TRANSITION。 */
export function assertAgentWritable(status: RequestStatus): void {
  if (!AGENT_WRITABLE_STATUSES.includes(status)) {
    throw new BridgeError(
      'INVALID_TRANSITION',
      `Agent 写回不允许将状态设为 ${status}（仅 PM 权威动作可迁移）`,
      { status },
    );
  }
}
