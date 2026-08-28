import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildWindowsTerminalLaunchPlan,
  buildPowershellLaunchPlan,
  psQuote,
  sanitizeProjectDir,
  resolveBinaryPath,
} from '../src/bridge/node';
import type { StartSessionSpec } from '../src/bridge/node';

// ============================================================================
// 跨平台发布验证（Issue #6 Windows 清单的可本地确定性部分）：
// 本机为 macOS，无法真实运行 Windows Terminal/PowerShell——此处锁定
// 「路径转义 / 启动计划构造 / PATH 解析 / 资源定位」的纯函数行为；
// 真机部分由 scripts/verify-windows.ps1 一键验证（见 runbook）。
// ============================================================================

const WIN_ROOT = 'C:\\Users\\PM 张三\\MageneFirmwarePlayground';
const WIN_CLAUDE = 'C:\\Program Files\\nodejs\\claude.cmd';

function winSpec(overrides?: Partial<StartSessionSpec>): StartSessionSpec {
  return {
    cwd: WIN_ROOT,
    sessionId: '11111111-2222-3333-4444-555555555555',
    mode: 'new',
    sessionName: 'MFP · REQ-win-1',
    startupInstruction: '（启动指令正文——不应出现在命令行里）',
    startupFile: 'C:\\Users\\PM 张三\\MageneFirmwarePlayground\\.mfp\\work\\REQ-win-1.startup.txt',
    ...overrides,
  };
}

describe('Windows 终端启动计划（跨平台纯函数）', () => {
  it('Windows Terminal：-d 根目录 + PowerShell 读启动文件，中文/空格路径完整保留', () => {
    const plan = buildWindowsTerminalLaunchPlan(winSpec(), WIN_CLAUDE);
    expect(plan.command).toBe('wt.exe');
    expect(plan.args[0]).toBe('-d');
    // 根目录作为单个参数原样传递（含中文与空格）
    expect(plan.args[1]).toBe(WIN_ROOT);
    const joined = plan.args.join(' ');
    expect(joined).toContain('powershell');
    expect(joined).toContain('-NoExit');
    // 启动指令经文件传入：Get-Content -Raw <带空格路径>（路径单引号包裹）
    expect(joined).toContain(`Get-Content -Raw 'C:\\Users\\PM 张三\\MageneFirmwarePlayground\\.mfp\\work\\REQ-win-1.startup.txt'`);
  });

  it('PowerShell 回退：Set-Location -LiteralPath 正确转义含单引号路径', () => {
    const spec = winSpec({ cwd: "C:\\Users\\it's PM\\MFP" });
    const plan = buildPowershellLaunchPlan(spec, WIN_CLAUDE);
    expect(plan.command).toBe('powershell.exe');
    const joined = plan.args.join(' ');
    // PowerShell 单引号转义：内部单引号加倍
    expect(joined).toContain(`Set-Location -LiteralPath 'C:\\Users\\it''s PM\\MFP'`);
  });

  it('wt / PowerShell 计划均不含启动指令正文（长文本只经文件）', () => {
    const wt = buildWindowsTerminalLaunchPlan(winSpec(), WIN_CLAUDE);
    const ps = buildPowershellLaunchPlan(winSpec(), WIN_CLAUDE);
    for (const plan of [wt, ps]) {
      expect(JSON.stringify([plan.command, ...plan.args])).not.toContain('启动指令正文');
    }
  });

  it('psQuote：单引号加倍，反斜杠不转义（PowerShell 单引号字符串语义）', () => {
    expect(psQuote("a'b")).toBe("'a''b'");
    expect(psQuote('C:\\Program Files\\x')).toBe("'C:\\Program Files\\x'");
  });

  it('resume 模式：Windows 计划使用 --resume，不用 --session-id', () => {
    const plan = buildWindowsTerminalLaunchPlan(winSpec({ mode: 'resume', resumeSessionId: 'saved-uuid' }), WIN_CLAUDE);
    const joined = plan.args.join(' ');
    expect(joined).toContain('--resume saved-uuid');
    expect(joined).not.toContain('--session-id');
  });
});

describe('Windows PATH 解析与 CLI 定位', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-xplat-'));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('resolveBinaryPath：win32 用 ; 分隔并匹配 node.exe/.cmd 候选', () => {
    const binDir = path.join(tmp, 'winbin');
    fs.mkdirSync(binDir, { recursive: true });
    const exe = path.join(binDir, 'claude.cmd');
    fs.writeFileSync(exe, '@echo off\n');
    fs.chmodSync(exe, 0o755); // 模拟可执行（macOS 上检查 X_OK）
    const pathEnv = `C:\\Windows\\System32;${binDir}`;
    // win32 语义：`;` 分隔 + .cmd 候选命中
    expect(resolveBinaryPath('claude', pathEnv, 'win32')).toBe(exe);
    // 同一 PATH 用 darwin 语义（: 分隔）不应命中
    expect(resolveBinaryPath('claude', pathEnv, 'darwin')).toBeUndefined();
  });

  it('resolveBinaryPath：绝对路径直接检查存在性', () => {
    expect(resolveBinaryPath('/nonexistent/claude', '', 'darwin')).toBeUndefined();
  });
});

describe('会话目录名 sanitization（Windows 盘符路径）', () => {
  it('非字母数字替换为 -（盘符冒号与反斜杠均替换）', () => {
    // 规则由 macOS 观察得出（/Users/x → -Users-x）；Windows 真实布局是否同规则
    // 属待确认项，由 scripts/verify-windows.ps1 在真机核对 ~/.claude/projects。
    expect(sanitizeProjectDir('C:\\Users\\jacko\\Projects\\MFP')).toBe('C--Users-jacko-Projects-MFP');
    // PM 后为「空格+张+三+反斜杠」4 个连续非字母数字字符 → 4 个连字符
    expect(sanitizeProjectDir('C:\\Users\\PM 张三\\MFP')).toBe('C--Users-PM----MFP');
  });
});
