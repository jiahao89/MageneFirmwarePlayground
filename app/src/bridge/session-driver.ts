import { hashString } from './util';
import { workPackageFileName, startupFileName } from './work-package-store';
import { buildStartupInstruction, buildFallbackStartupInstruction } from './session-instruction';
import type { BridgeErrorPayload } from './errors';
import type { WorkPackage } from './types';
import type { RuntimeAdapter, StartSessionSpec } from './runtime-adapter';

// ============================================================================
// 会话驱动：把「启动 / 恢复 Claude Code 会话」从工作包状态机中解耦。
//  - MockSessionDriver：内存 mock（浏览器 / AGY UI 测试沿用既有行为）。
//  - AdapterSessionDriver：经 RuntimeAdapter 走真实终端；
//    resume 失败时基于工作包创建新会话（Issue #1 用户故事 21）。
// ============================================================================

export interface SessionStartOutcome {
  sessionId: string;
  cliVersion?: string;
  fallback?: boolean;
  note?: string;
  lastError?: BridgeErrorPayload;
}

export interface SessionDriver {
  startNew(wp: WorkPackage): Promise<SessionStartOutcome>;
  resume(wp: WorkPackage): Promise<SessionStartOutcome>;
}

/** 内存 mock 驱动：确定性 ID，无终端。 */
export class MockSessionDriver implements SessionDriver {
  async startNew(wp: WorkPackage): Promise<SessionStartOutcome> {
    return { sessionId: `SESSION-${hashString(wp.requestId)}` };
  }

  async resume(wp: WorkPackage): Promise<SessionStartOutcome> {
    return { sessionId: wp.session.sessionId ?? `SESSION-${hashString(wp.requestId)}` };
  }
}

export interface AdapterSessionDriverOptions {
  /** MFP 根目录（终端工作目录 + 启动文件所在）。 */
  root: string;
  /** 新会话 ID 生成器（默认 crypto.randomUUID）。 */
  newSessionId?: () => string;
}

export class AdapterSessionDriver implements SessionDriver {
  private readonly adapter: RuntimeAdapter;
  private readonly root: string;
  private readonly newSessionId: () => string;
  private cachedVersion: Promise<string | undefined> | null = null;

  constructor(adapter: RuntimeAdapter, opts: AdapterSessionDriverOptions) {
    this.adapter = adapter;
    this.root = opts.root;
    this.newSessionId = opts?.newSessionId ?? (() => crypto.randomUUID());
  }

  async startNew(wp: WorkPackage): Promise<SessionStartOutcome> {
    const sessionId = this.newSessionId();
    const spec = this.buildSpec(wp, {
      mode: 'new',
      sessionId,
      startupInstruction: buildStartupInstruction({
        requestId: wp.requestId,
        workPackageRelPath: workPackageFileName(wp.requestId),
      }),
    });
    const result = await this.adapter.startSession(spec);
    return {
      sessionId: result.sessionId,
      cliVersion: await this.cliVersion(),
      fallback: result.fallback,
      note: result.note,
      lastError: this.toPayload(result.lastError),
    };
  }

  async resume(wp: WorkPackage): Promise<SessionStartOutcome> {
    if (!wp.session.sessionId) {
      // 无已保存会话 → 直接创建新会话（启动指令指向工作包与任务卡）。
      const outcome = await this.startNew(wp);
      return { ...outcome, note: outcome.note ?? '未找到已保存会话，已创建新会话' };
    }
    const spec = this.buildSpec(wp, {
      mode: 'resume',
      sessionId: this.newSessionId(), // 降级为新会话时使用
      resumeSessionId: wp.session.sessionId,
      // 仅降级时使用的启动指令：显式说明从工作包续接。
      startupInstruction: buildFallbackStartupInstruction({
        requestId: wp.requestId,
        workPackageRelPath: workPackageFileName(wp.requestId),
      }),
    });
    const result = await this.adapter.startSession(spec);
    return {
      sessionId: result.sessionId,
      cliVersion: await this.cliVersion(),
      fallback: result.fallback,
      note: result.note,
      lastError: this.toPayload(result.lastError),
    };
  }

  private buildSpec(
    wp: WorkPackage,
    fields: { mode: 'new' | 'resume'; sessionId: string; resumeSessionId?: string; startupInstruction: string },
  ): StartSessionSpec {
    return {
      cwd: this.root,
      sessionId: fields.sessionId,
      mode: fields.mode,
      resumeSessionId: fields.resumeSessionId,
      sessionName: `MFP · ${wp.requestId}`,
      startupInstruction: fields.startupInstruction,
      startupFile: `${this.root}/${startupFileName(wp.requestId)}`,
    };
  }

  private async cliVersion(): Promise<string | undefined> {
    if (!this.cachedVersion) {
      this.cachedVersion = this.adapter
        .checkAvailability()
        .then((a) => a.version)
        .catch(() => undefined);
    }
    return this.cachedVersion;
  }

  private toPayload(e?: { code: string; message: string }): BridgeErrorPayload | undefined {
    if (!e) return undefined;
    return { code: e.code as BridgeErrorPayload['code'], category: 'cli', message: e.message };
  }
}
