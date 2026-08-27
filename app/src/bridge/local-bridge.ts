import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryBridge } from './in-memory-bridge';
import { PathGuard } from './path-guard';
import { runProcess } from './process-runner';
import { parseRecognitionText } from './validate';
import { BridgeError } from './errors';
import type { RawInput, RecognitionResult, PreflightResult, PreflightCheck } from './types';

// ============================================================================
// Node 侧本地桥：用确定性 fake CLI 子进程跑通契约测试缝隙（Issue #1 的
// 「highest test seam」）。真实 claude CLI 适配由 Issue #3 替换 `cli`。
// ============================================================================

export interface LocalBridgeOptions {
  root: string;
  now?: () => string;
  /** 识别用 CLI；默认 node + bin/fake-cli.mjs。 */
  cli?: { command: string; args: string[] };
}

export class LocalBridge extends InMemoryBridge {
  readonly guard: PathGuard;

  constructor(opts: LocalBridgeOptions) {
    const now = opts.now ?? (() => new Date().toISOString());
    const guard = new PathGuard(opts.root);
    const cli = opts.cli ?? defaultFakeCli();
    super({
      now,
      recognizeRaw: (raw: RawInput) => recognizeViaCli(cli, guard.root, raw),
      preflightRaw: async (requestId: string) => preflightFs(guard, requestId),
    });
    this.guard = guard;
  }
}

async function recognizeViaCli(
  cli: { command: string; args: string[] },
  root: string,
  raw: RawInput,
): Promise<RecognitionResult> {
  const input = JSON.stringify({ text: raw.text, sourceDescription: raw.sourceDescription });
  const result = await runProcess({ command: cli.command, args: cli.args, cwd: root, input });
  if (result.code !== 0) {
    throw new BridgeError('CLI_AUTH_FAILED', `识别进程异常退出（code=${result.code}）：${result.stderr.trim()}`, {
      code: result.code,
      stderr: result.stderr,
    });
  }
  return parseRecognitionText(result.stdout);
}

function preflightFs(guard: PathGuard, _requestId: string): PreflightResult {
  const root = guard.root;
  const checks: PreflightCheck[] = [
    { name: 'mfp_root_exists', ok: fs.existsSync(root), detail: root },
    { name: 'mfp_root_writable', ok: isWritable(root), detail: root },
    { name: 'cli_available', ok: true, detail: 'mock 模式：确定性 fake CLI（真实 claude CLI 由 Issue #3 接入）' },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

function isWritable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultFakeCli(): { command: string; args: string[] } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fakeCli = path.resolve(here, 'bin', 'fake-cli.mjs');
  return { command: process.execPath, args: [fakeCli] };
}
