import { BridgeError } from './errors';

export interface RunningRun {
  key: string;
  startedAt: string;
}

// ============================================================================
// 并发运行保护：同一请求（key）同一时刻只允许一个运行中的会话。
// 对齐 Issue #1「prevent simultaneous conflicting runs for the same request」。
// ============================================================================

export class RunGuard {
  private readonly running = new Map<string, RunningRun>();

  /** 抢占运行权；已运行则抛 CONCURRENT_RUN。 */
  acquire(key: string, now: () => string): void {
    const existing = this.running.get(key);
    if (existing) {
      throw new BridgeError(
        'CONCURRENT_RUN',
        `请求 ${key} 已在运行中（自 ${existing.startedAt}），禁止重复启动`,
        { key, startedAt: existing.startedAt },
      );
    }
    this.running.set(key, { key, startedAt: now() });
  }

  release(key: string): void {
    this.running.delete(key);
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  runningKeys(): string[] {
    return [...this.running.keys()];
  }
}
