import { spawn } from 'node:child_process';
import { BridgeError } from './errors';

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  command: string;
  /** 参数数组；禁止字符串拼接 / shell 插值。 */
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** 写入子进程 stdin 的内容（用户文本只走 stdin / 文件，不进命令行）。 */
  input?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================================================
// 进程启动：以参数数组 + 显式工作目录启动（shell:false）。
// 对齐 Issue #1「Start the process with an argument list and an explicit
// working directory; do not build a shell command by concatenating unsanitized
// user text」。
// ============================================================================

export function runProcess(opts: RunProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new BridgeError('CLI_NOT_FOUND', `无法启动进程 ${opts.command}：${err.message}`, err.message),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new BridgeError('CLI_TIMEOUT', `进程超时（>${timeoutMs}ms）：${opts.command}`, { timeoutMs }),
        );
        return;
      }
      resolve({ code, stdout, stderr });
    });

    if (child.stdin) {
      if (opts.input !== undefined) child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}
