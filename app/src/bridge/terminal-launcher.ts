import { spawn } from 'node:child_process';
import { BridgeError } from './errors';
import type { StartSessionSpec } from './runtime-adapter';

// ============================================================================
// 终端启动器：在外部终端打开 MFP 根目录并启动 Claude Code 交互会话。
//  - macOS：配置的终端应用（默认 Terminal.app，经 osascript）
//  - Windows：优先 Windows Terminal（wt.exe），失败回退 PowerShell
//
// 安全不变量（Issue #1 / #3）：
//  1. spawn 一律参数数组（shell: false），不拼接命令字符串；
//  2. 平台内层命令字符串只含「固定模板 + UUID + 受控路径」，绝不含用户原文；
//  3. 启动指令长文本经启动文件传递：
//     - macOS：`"$(cat '<file>')"` 由 shell 读文件
//     - Windows：`(Get-Content -Raw '<file>')` 由 PowerShell 读文件
// ============================================================================

export type TerminalPlatform = 'darwin' | 'win32';

export interface LaunchPlan {
  command: string;
  args: string[];
  description: string;
}

export interface TerminalLauncherOptions {
  /** macOS 终端应用名（默认 Terminal）。 */
  terminalApp?: string;
}

/** sh 单引号转义。 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** AppleScript 字符串字面量转义。 */
export function appleScriptQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** PowerShell 单引号字符串转义。 */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * claude 交互会话的参数（不含启动指令文本；文本经文件传入）。
 * resume 模式显式 --resume：会话推进全部由适配器的 -p headless 轮完成，
 * 终端只负责挂载会话供 PM 查看与介入（交互 resume 不自动提交位置参数，实测），
 * 因此 resume 不携带位置参数指令。
 * new 模式为「自然会话」（不指定 id）：仅作降级展示路径；位置参数指令经启动文件传入。
 */
export function buildClaudeArgv(spec: StartSessionSpec, claudeBin: string): string[] {
  const args = [claudeBin];
  if (spec.mode === 'resume' && spec.resumeSessionId) {
    args.push('--resume', spec.resumeSessionId);
  }
  args.push('--name', spec.sessionName);
  return args;
}

/** macOS：osascript 驱动终端应用执行 `cd <root> && claude ...`（new 模式追加启动文件位置参数）。 */
export function buildDarwinLaunchPlan(spec: StartSessionSpec, claudeBin: string, opts?: TerminalLauncherOptions): LaunchPlan {
  const app = opts?.terminalApp ?? 'Terminal';
  const argv = buildClaudeArgv(spec, claudeBin)
    .map((a) => (/^[A-Za-z0-9/_@.:-]+$/.test(a) ? a : shQuote(a)))
    .join(' ');
  const promptArg = spec.mode === 'new' ? ` "$(cat ${shQuote(spec.startupFile)})"` : '';
  const shCommand = `cd ${shQuote(spec.cwd)} && ${argv}${promptArg}`;
  const script = `tell application ${appleScriptQuote(app)}\n  activate\n  do script ${appleScriptQuote(shCommand)}\nend tell`;
  return {
    command: 'osascript',
    args: ['-e', script],
    description: `macOS ${app} 打开 ${spec.cwd} 并启动 Claude Code 会话`,
  };
}

/** Windows Terminal：`wt.exe -d <root> powershell -NoExit -Command "& claude ..."`（new 模式追加启动文件位置参数）。 */
export function buildWindowsTerminalLaunchPlan(spec: StartSessionSpec, claudeBin: string): LaunchPlan {
  const argv = buildClaudeArgv(spec, claudeBin)
    .slice(1)
    .map((a) => (/^[A-Za-z0-9-]+$/.test(a) ? a : psQuote(a)))
    .join(' ');
  const promptArg = spec.mode === 'new' ? ` (Get-Content -Raw ${psQuote(spec.startupFile)})` : '';
  const psCommand = `& ${psQuote(claudeBin)} ${argv}${promptArg}`;
  return {
    command: 'wt.exe',
    args: ['-d', spec.cwd, 'powershell', '-NoExit', '-Command', psCommand],
    description: `Windows Terminal 打开 ${spec.cwd} 并启动 Claude Code 会话`,
  };
}

/** PowerShell 回退：`powershell -NoExit -Command "Set-Location <root>; & claude ..."`（new 模式追加启动文件位置参数）。 */
export function buildPowershellLaunchPlan(spec: StartSessionSpec, claudeBin: string): LaunchPlan {
  const argv = buildClaudeArgv(spec, claudeBin)
    .slice(1)
    .map((a) => (/^[A-Za-z0-9-]+$/.test(a) ? a : psQuote(a)))
    .join(' ');
  const promptArg = spec.mode === 'new' ? ` (Get-Content -Raw ${psQuote(spec.startupFile)})` : '';
  const psCommand = `Set-Location -LiteralPath ${psQuote(spec.cwd)}; & ${psQuote(claudeBin)} ${argv}${promptArg}`;
  return {
    command: 'powershell.exe',
    args: ['-NoExit', '-Command', psCommand],
    description: `PowerShell 打开 ${spec.cwd} 并启动 Claude Code 会话`,
  };
}

/** 按平台构建首选启动方案（win32 的回退由 executor 处理）。 */
export function buildLaunchPlan(
  platform: TerminalPlatform,
  spec: StartSessionSpec,
  claudeBin: string,
  opts?: TerminalLauncherOptions,
): LaunchPlan {
  if (platform === 'darwin') return buildDarwinLaunchPlan(spec, claudeBin, opts);
  return buildWindowsTerminalLaunchPlan(spec, claudeBin);
}

/**
 * 执行启动方案（spawn，参数数组，无 shell）。
 * win32：wt.exe 不存在时自动回退 PowerShell 方案。
 */
export async function executeLaunchPlan(
  platform: TerminalPlatform,
  spec: StartSessionSpec,
  claudeBin: string,
  opts?: TerminalLauncherOptions,
): Promise<LaunchPlan> {
  const plan = buildLaunchPlan(platform, spec, claudeBin, opts);
  try {
    await spawnDetached(plan);
    return plan;
  } catch (e) {
    if (platform === 'win32' && plan.command === 'wt.exe') {
      const fallback = buildPowershellLaunchPlan(spec, claudeBin);
      try {
        await spawnDetached(fallback);
        return fallback;
      } catch (e2) {
        throw new BridgeError('TERMINAL_LAUNCH_FAILED', `终端启动失败：${(e2 as Error).message}`, {
          wtError: (e as Error).message,
          powershellError: (e2 as Error).message,
        });
      }
    }
    throw new BridgeError('TERMINAL_LAUNCH_FAILED', `终端启动失败：${(e as Error).message}`);
  }
}

function spawnDetached(plan: LaunchPlan): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      shell: false,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
