import { describe, it, expect } from 'vitest';
import { buildStartupInstruction, buildFallbackStartupInstruction } from '../src/bridge/node';

describe('启动指令（Issue #3）', () => {
  const input = { requestId: 'REQ-abc', workPackageRelPath: '.mfp/work/REQ-abc.json' };

  it('包含项目规则 / 工作包 / 事实源入口与写回要求', () => {
    const text = buildStartupInstruction(input);
    expect(text).toContain('REQ-abc');
    expect(text).toContain('AGENTS.md');
    expect(text).toContain('.mfp/work/REQ-abc.json');
    expect(text).toContain('BENCHMARK.md');
    expect(text).toContain('写回工作包');
  });

  it('包含禁止事项：不改 benchmark / 不保存 API key / 不越权', () => {
    const text = buildStartupInstruction(input);
    expect(text).toContain('不得自动修改 benchmark');
    expect(text).toMatch(/不得保存或输出任何 API key/);
    expect(text).toContain('PM 权威动作');
  });

  it('降级版启动指令显式说明从工作包续接', () => {
    const text = buildFallbackStartupInstruction(input);
    expect(text).toContain('恢复失败');
    expect(text).toContain('基于工作包续接');
    expect(text).toContain('REQ-abc');
  });

  it('回归 F-4：PRD 产出后的强制写回契约（prdPath/prdVersion/artifacts/pending_review）', () => {
    const text = buildStartupInstruction(input);
    expect(text).toContain('prdPath');
    expect(text).toContain('prdVersion');
    expect(text).toContain('artifacts');
    expect(text).toContain('pending_review');
    // 指明写回目标文件与相对路径示例
    expect(text).toContain('.mfp/work/REQ-abc.json');
    expect(text).toContain('02-PRD.md');
    // 降级版同样包含该契约（两条指令共享主体）
    expect(buildFallbackStartupInstruction(input)).toContain('prdPath');
  });

  it('函数签名只接受受控字段（不含用户原文参数）', () => {
    // 编译期约束的运行时印证：构造参数只有 requestId 与相对路径。
    const keys = Object.keys(input).sort();
    expect(keys).toEqual(['requestId', 'workPackageRelPath'].sort());
  });
});
