import { describe, it, expect } from 'vitest';
import {
  REQUEST_STATUSES,
  ALLOWED_TRANSITIONS,
  PM_AUTHORITATIVE_STATUSES,
  AGENT_WRITABLE_STATUSES,
  canTransition,
  assertTransition,
  assertAgentWritable,
  BridgeError,
} from '../src/bridge/index';

describe('需求状态机（Issue #2）', () => {
  it('合法迁移：待识别 → 待确认 → 待启动 → 处理中', () => {
    expect(canTransition('pending_recognition', 'pending_confirmation')).toBe(true);
    expect(canTransition('pending_confirmation', 'pending_launch')).toBe(true);
    expect(canTransition('pending_launch', 'processing')).toBe(true);
  });

  it('合法迁移：处理中 → 待回答/待审阅，待审阅 → 完成', () => {
    expect(canTransition('processing', 'pending_answer')).toBe(true);
    expect(canTransition('processing', 'pending_review')).toBe(true);
    expect(canTransition('pending_review', 'completed')).toBe(true);
    expect(canTransition('pending_confirmation', 'archived')).toBe(true);
  });

  it('非法迁移被拒绝（含终态无出边）', () => {
    expect(canTransition('processing', 'completed')).toBe(false);
    expect(canTransition('pending_recognition', 'completed')).toBe(false);
    expect(canTransition('completed', 'processing')).toBe(false);
    expect(canTransition('archived', 'processing')).toBe(false);
    expect(() => assertTransition('processing', 'completed')).toThrowError(BridgeError);
  });

  it('非法迁移错误码为 INVALID_TRANSITION', () => {
    try {
      assertTransition('processing', 'completed');
      throw new Error('应当抛错');
    } catch (e) {
      expect((e as BridgeError).payload.code).toBe('INVALID_TRANSITION');
    }
  });

  it('PM 权威状态与 Agent 可写状态互斥', () => {
    for (const s of PM_AUTHORITATIVE_STATUSES) {
      expect(AGENT_WRITABLE_STATUSES).not.toContain(s);
    }
  });

  it('assertAgentWritable 拒绝 PM 权威状态，允许 Agent 状态', () => {
    expect(() => assertAgentWritable('completed')).toThrowError(BridgeError);
    expect(() => assertAgentWritable('archived')).toThrowError(BridgeError);
    expect(() => assertAgentWritable('pending_answer')).not.toThrow();
    expect(() => assertAgentWritable('pending_review')).not.toThrow();
  });

  it('ALLOWED_TRANSITIONS 覆盖全部 RequestStatus', () => {
    for (const s of REQUEST_STATUSES) {
      expect(ALLOWED_TRANSITIONS[s]).toBeDefined();
    }
  });
});
