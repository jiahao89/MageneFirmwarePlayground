import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalBridge } from '../src/bridge/node';
import { BridgeError } from '../src/bridge/index';

function makeBridge() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-bridge-'));
  const now = () => '2026-08-27T00:00:00.000Z';
  return { root, bridge: new LocalBridge({ root, now }) };
}

describe('LocalBridge 契约测试缝隙（fake CLI）', () => {
  it('save → recognize（结构化字段）→ register → read', async () => {
    const { bridge } = makeBridge();

    const raw = await bridge.saveRawInput({ text: '码表在骑行中偶尔闪退', sourceDescription: '用户反馈' });
    expect(raw.rawInputId).toMatch(/^RAW-/);
    expect(raw.text).toBe('码表在骑行中偶尔闪退');

    const rec = await bridge.recognize(raw.rawInputId);
    expect(rec.category).toBe('bug');
    expect(typeof rec.rewrittenRequirement).toBe('string');
    expect(typeof rec.confidence).toBe('number');
    expect(Array.isArray(rec.missingInformation)).toBe(true);

    const wp = await bridge.register(raw.rawInputId);
    expect(wp.status).toBe('pending_launch');
    expect(wp.requestId).toMatch(/^REQ-/);
    expect(wp.recognition?.category).toBe('bug');

    const read = await bridge.readWorkPackage(wp.requestId);
    expect(read.originalInput.text).toBe('码表在骑行中偶尔闪退');
  });

  it('空文本被拒绝（INVALID_ARGUMENT）', async () => {
    const { bridge } = makeBridge();
    await expect(bridge.saveRawInput({ text: '   ' })).rejects.toThrowError(BridgeError);
  });

  it('重复 launch 抛 CONCURRENT_RUN，complete 后释放', async () => {
    const { bridge } = makeBridge();
    const raw = await bridge.saveRawInput({ text: '希望支持 ANT+ 车灯自动开关' });
    const wp = await bridge.register(raw.rawInputId);

    await bridge.launch(wp.requestId);
    expect((await bridge.readWorkPackage(wp.requestId)).status).toBe('processing');

    await expect(bridge.launch(wp.requestId)).rejects.toThrow(/重复启动/);

    await bridge.complete(wp.requestId);
    const done = await bridge.readWorkPackage(wp.requestId);
    expect(done.status).toBe('completed');
    expect(done.runLog.find((r) => r.state === 'running')).toBeUndefined();

    // complete 释放并发锁后可再次启动
    await expect(bridge.launch(wp.requestId)).resolves.toBeDefined();
  });

  it('preflight 校验根目录存在且可写', async () => {
    const { bridge, root } = makeBridge();
    const raw = await bridge.saveRawInput({ text: '需求 AAAA' });
    const wp = await bridge.register(raw.rawInputId);
    const pre = await bridge.preflight(wp.requestId);
    expect(pre.ok).toBe(true);
    expect(pre.checks.find((c) => c.name === 'mfp_root_exists')?.ok).toBe(true);
    expect(pre.checks.find((c) => c.name === 'mfp_root_writable')?.ok).toBe(true);
    expect(root.length).toBeGreaterThan(0);
  });
});
