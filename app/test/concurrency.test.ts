import { describe, it, expect } from 'vitest';
import { RunGuard } from '../src/bridge/node';
import { BridgeError } from '../src/bridge/index';

const t = '2026-08-27T00:00:00.000Z';
const now = () => t;

describe('RunGuard（并发运行保护）', () => {
  it('同一 key 重复 acquire 抛 CONCURRENT_RUN', () => {
    const g = new RunGuard();
    g.acquire('REQ-1', now);
    expect(() => g.acquire('REQ-1', now)).toThrowError(BridgeError);
    expect(g.isRunning('REQ-1')).toBe(true);
  });

  it('不同 key 可并发', () => {
    const g = new RunGuard();
    g.acquire('REQ-1', now);
    g.acquire('REQ-2', now);
    expect(g.isRunning('REQ-1')).toBe(true);
    expect(g.isRunning('REQ-2')).toBe(true);
  });

  it('release 后可重新 acquire', () => {
    const g = new RunGuard();
    g.acquire('REQ-1', now);
    g.release('REQ-1');
    expect(() => g.acquire('REQ-1', now)).not.toThrow();
  });

  it('重复运行错误携带 code=CONCURRENT_RUN', () => {
    const g = new RunGuard();
    g.acquire('REQ-1', now);
    try {
      g.acquire('REQ-1', now);
      throw new Error('应当抛错');
    } catch (e) {
      expect((e as BridgeError).payload.code).toBe('CONCURRENT_RUN');
    }
  });
});
