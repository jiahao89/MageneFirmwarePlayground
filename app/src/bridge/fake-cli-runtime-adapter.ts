import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeError } from './errors';
import { runProcess } from './process-runner';
import { parseRecognitionText } from './validate';
import type {
  RuntimeAdapter,
  CliAvailability,
  AuthCheck,
  StartSessionSpec,
  StartSessionResult,
} from './runtime-adapter';
import type { RawInput, RecognitionResult } from './types';
import type { LaunchPlan } from './terminal-launcher';

// ============================================================================
// 确定性 fake CLI 运行时适配器（测试专用）：
//  - 识别走真实子进程（node bin/fake-cli.mjs），保住「进程 + JSON 校验」缝隙；
//  - 会话启动不开真实终端，只记录 LaunchPlan；
//  - resume 可配置失败，用于验证「降级为新会话」。
// ============================================================================

export interface FakeCliAdapterOptions {
  cliVersion?: string;
  installed?: boolean;
  authOk?: boolean;
  /** resume 时视为「会话文件不存在」，触发降级。 */
  resumeShouldFail?: boolean;
  newSessionIds?: () => string;
}

export interface FakeSessionRecord {
  sessionId: string;
  mode: 'new' | 'resume';
  cwd: string;
  plan: LaunchPlan;
}

export class FakeCliRuntimeAdapter implements RuntimeAdapter {
  readonly sessions: FakeSessionRecord[] = [];
  private seq = 0;
  private readonly opts: FakeCliAdapterOptions;

  constructor(opts?: FakeCliAdapterOptions) {
    this.opts = opts ?? {};
  }

  async checkAvailability(): Promise<CliAvailability> {
    if (this.opts.installed === false) return { installed: false };
    return { installed: true, path: '/fake/claude', version: this.opts.cliVersion ?? '9.9.9' };
  }

  async checkAuth(): Promise<AuthCheck> {
    if (this.opts.authOk === false) {
      return { ok: false, message: 'Claude Code 认证失败：请先在终端运行 claude 完成登录' };
    }
    return { ok: true };
  }

  async recognize(raw: RawInput): Promise<RecognitionResult> {
    if (this.opts.installed === false) throw new BridgeError('CLI_NOT_FOUND', '未找到 claude 可执行文件');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fakeCli = path.resolve(here, 'bin', 'fake-cli.mjs');
    const res = await runProcess({
      command: process.execPath,
      args: [fakeCli],
      cwd: here,
      input: JSON.stringify({ text: raw.text, sourceDescription: raw.sourceDescription }),
    });
    if (res.code !== 0) throw new BridgeError('MALFORMED_OUTPUT', `fake CLI 异常退出：${res.stderr}`);
    return parseRecognitionText(res.stdout);
  }

  async startSession(spec: StartSessionSpec): Promise<StartSessionResult> {
    if (this.opts.installed === false) throw new BridgeError('CLI_NOT_FOUND', '未找到 claude 可执行文件');

    if (spec.mode === 'resume' && spec.resumeSessionId && this.opts.resumeShouldFail) {
      // 模拟会话文件缺失 → 降级为基于工作包的新会话。
      const newId = this.nextSessionId(spec.sessionId);
      this.record({ sessionId: newId, mode: 'new', cwd: spec.cwd, plan: fakePlan(spec.cwd) });
      const note = `会话 ${spec.resumeSessionId} 无法恢复，已基于工作包创建新会话`;
      return { sessionId: newId, fallback: true, note, lastError: { code: 'SESSION_NOT_FOUND', message: note } };
    }

    const sessionId = spec.mode === 'resume' ? spec.resumeSessionId! : spec.sessionId;
    this.record({ sessionId, mode: spec.mode, cwd: spec.cwd, plan: fakePlan(spec.cwd) });
    return { sessionId, fallback: false };
  }

  private record(r: FakeSessionRecord): void {
    this.sessions.push(r);
  }

  private nextSessionId(seed: string): string {
    this.seq += 1;
    return `${seed}-FB${this.seq}`;
  }
}

function fakePlan(cwd: string): LaunchPlan {
  return { command: 'fake-terminal', args: [cwd], description: 'fake terminal plan' };
}
