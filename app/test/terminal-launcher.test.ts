import { describe, it, expect } from 'vitest';
import {
  buildLaunchPlan,
  buildDarwinLaunchPlan,
  buildWindowsTerminalLaunchPlan,
  buildPowershellLaunchPlan,
  buildClaudeArgv,
  shQuote,
  psQuote,
  appleScriptQuote,
} from '../src/bridge/node';
import type { StartSessionSpec, LaunchPlan } from '../src/bridge/node';

function makeSpec(overrides?: Partial<StartSessionSpec>): StartSessionSpec {
  return {
    cwd: '/Users/jacko/Projects/MageneFirmwarePlayground',
    sessionId: '11111111-2222-3333-4444-555555555555',
    mode: 'new',
    sessionName: 'MFP · REQ-x',
    startupInstruction: '（启动指令正文——不应出现在命令行里）',
    startupFile: '/Users/jacko/Projects/MageneFirmwarePlayground/.mfp/work/REQ-x.startup.txt',
    ...overrides,
  };
}

const CLAUDE_BIN = '/opt/homebrew/bin/claude';

describe('终端启动计划（Issue #3）', () => {
  it('macOS：osascript 驱动 Terminal，含 cd 根目录 + --name + 读启动文件（自然会话，无 id flag）', () => {
    const plan = buildDarwinLaunchPlan(makeSpec(), CLAUDE_BIN);
    expect(plan.command).toBe('osascript');
    const script = plan.args.join(' ');
    expect(script).toContain('tell application "Terminal"');
    expect(script).toContain(`cd '/Users/jacko/Projects/MageneFirmwarePlayground'`);
    expect(script).toContain(`--name 'MFP · REQ-x'`);
    // 自然而来的新会话：不携带 --session-id（transcript 落盘由适配器发现 sessionId）
    expect(script).not.toContain('--session-id');
    // 注意：处于 AppleScript 字符串层，内层双引号被转义为 \"
    expect(script).toContain(`\\"$(cat '/Users/jacko/Projects/MageneFirmwarePlayground/.mfp/work/REQ-x.startup.txt')\\"`);
  });

  it('macOS resume：使用 --resume <saved>，不用 --session-id，不携带位置参数指令', () => {
    const plan = buildDarwinLaunchPlan(
      makeSpec({ mode: 'resume', resumeSessionId: 'saved-session-uuid' }),
      CLAUDE_BIN,
    );
    const script = plan.args.join(' ');
    expect(script).toContain('--resume saved-session-uuid');
    expect(script).not.toContain('--session-id');
    // 推进已由 headless -p 轮完成；终端只挂载会话，不再注入启动文件位置参数
    expect(script).not.toContain('$(cat');
  });

  it('Windows Terminal：wt.exe -d <root> + PowerShell 读启动文件', () => {
    const plan = buildWindowsTerminalLaunchPlan(makeSpec(), 'C:\\bin\\claude.exe');
    expect(plan.command).toBe('wt.exe');
    expect(plan.args[0]).toBe('-d');
    expect(plan.args[1]).toBe('/Users/jacko/Projects/MageneFirmwarePlayground');
    const joined = plan.args.join(' ');
    expect(joined).toContain('powershell');
    expect(joined).toContain('-NoExit');
    expect(joined).toContain(`Get-Content -Raw '/Users/jacko/Projects/MageneFirmwarePlayground/.mfp/work/REQ-x.startup.txt'`);
  });

  it('PowerShell 回退：Set-Location 到根目录', () => {
    const plan = buildPowershellLaunchPlan(makeSpec(), 'C:\\bin\\claude.exe');
    expect(plan.command).toBe('powershell.exe');
    const joined = plan.args.join(' ');
    expect(joined).toContain(`Set-Location -LiteralPath '/Users/jacko/Projects/MageneFirmwarePlayground'`);
    expect(joined).not.toContain('--session-id'); // 自然而来的新会话
  });

  it('buildLaunchPlan 按平台路由', () => {
    expect(buildLaunchPlan('darwin', makeSpec(), CLAUDE_BIN).command).toBe('osascript');
    expect(buildLaunchPlan('win32', makeSpec(), CLAUDE_BIN).command).toBe('wt.exe');
  });

  it('参数数组传递：启动指令正文绝不进入命令行（只经文件）', () => {
    const plans: LaunchPlan[] = [
      buildDarwinLaunchPlan(makeSpec(), CLAUDE_BIN),
      buildWindowsTerminalLaunchPlan(makeSpec(), CLAUDE_BIN),
      buildPowershellLaunchPlan(makeSpec(), CLAUDE_BIN),
    ];
    for (const plan of plans) {
      const serialized = JSON.stringify([plan.command, ...plan.args]);
      expect(serialized).not.toContain('启动指令正文');
    }
  });

  it('buildClaudeArgv：new（自然会话无 id flag）/ resume 参数数组正确', () => {
    expect(buildClaudeArgv(makeSpec(), CLAUDE_BIN)).toEqual([CLAUDE_BIN, '--name', 'MFP · REQ-x']);
    expect(buildClaudeArgv(makeSpec({ mode: 'resume', resumeSessionId: 'abc' }), CLAUDE_BIN)).toEqual([
      CLAUDE_BIN,
      '--resume',
      'abc',
      '--name',
      'MFP · REQ-x',
    ]);
  });

  it('转义函数处理引号', () => {
    expect(shQuote(`a'b`)).toBe(`'a'\\''b'`);
    expect(psQuote(`a'b`)).toBe(`'a''b'`);
    expect(appleScriptQuote('a"b\\c')).toBe(`"a\\"b\\\\c"`);
    // 带引号的路径不会截断命令结构（AppleScript 层会把反斜杠再转义一次）
    const plan = buildDarwinLaunchPlan(makeSpec({ cwd: `/tmp/it's here` }), CLAUDE_BIN);
    expect(plan.args.join(' ')).toContain(`cd '/tmp/it'\\\\''s here'`);
  });
});
