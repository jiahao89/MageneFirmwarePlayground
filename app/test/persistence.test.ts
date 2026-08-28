import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalBridge, FileWorkPackageStore } from '../src/bridge/node';
import type { WorkPackage } from '../src/bridge/index';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-persist-'));
}

function makeWorkPackage(requestId: string): WorkPackage {
  return {
    requestId,
    rawInputId: 'RAW-1',
    status: 'pending_recognition',
    originalInput: { rawInputId: 'RAW-1', text: 'x', createdAt: 't' },
    recognition: null,
    taskCard: null,
    questions: [],
    revisionComments: [],
    runLog: [],
    session: {},
    artifacts: [],
    updatedAt: 't',
  };
}

describe('文件工作包持久化（Issue #2）', () => {
  it('重启后（新桥实例）工作包仍可恢复', async () => {
    const root = makeRoot();
    const now = () => '2026-08-27T00:00:00.000Z';
    const b1 = new LocalBridge({ root, now });
    const wp0 = await b1.saveRawInput({ text: '码表在爬坡时闪退' });
    await b1.recognize(wp0.requestId);
    await b1.register(wp0.requestId);
    await b1.launch(wp0.requestId);

    // 模拟重启：全新实例，同一 root
    const b2 = new LocalBridge({ root, now });
    const list = await b2.listWorkPackages();
    expect(list).toHaveLength(1);
    expect(list[0].requestId).toBe(wp0.requestId);
    expect(list[0].status).toBe('processing');

    const recovered = await b2.readWorkPackage(wp0.requestId);
    expect(recovered.originalInput.text).toBe('码表在爬坡时闪退');
    expect(recovered.recognition?.category).toBe('bug');
    expect(recovered.taskCard).not.toBeNull();
    expect(recovered.session.processState).toBe('running');
  });

  it('并发写入抛 CONCURRENT_WRITE，释放锁后成功', async () => {
    const root = makeRoot();
    const store = new FileWorkPackageStore(root);
    const wp = makeWorkPackage('REQ-1');
    const filePath = path.join(root, '.mfp', 'work', 'REQ-1.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(`${filePath}.lock`, '');

    await expect(store.save(wp)).rejects.toThrow(/并发写入/);

    fs.unlinkSync(`${filePath}.lock`);
    await expect(store.save(wp)).resolves.toBeUndefined();
  });

  it('malformed JSON 文件 → 读返回诊断态 error，保留原文件', async () => {
    const root = makeRoot();
    const bridge = new LocalBridge({ root });
    const filePath = path.join(root, '.mfp', 'work', 'REQ-bad.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const raw = '{ not json';
    fs.writeFileSync(filePath, raw);

    const wp = await bridge.readWorkPackage('REQ-bad');
    expect(wp.status).toBe('error');
    expect(wp.session.lastError?.code).toBe('MALFORMED_STATE');
    // 原文件保留，未被覆盖
    expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);
  });

  it('非法状态值 → malformed 诊断', async () => {
    const root = makeRoot();
    const bridge = new LocalBridge({ root });
    const filePath = path.join(root, '.mfp', 'work', 'REQ-badstatus.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ ...makeWorkPackage('REQ-badstatus'), status: 'not_a_status' }));

    const wp = await bridge.readWorkPackage('REQ-badstatus');
    expect(wp.status).toBe('error');
  });

  it('任务卡字段随工作包持久化往返', async () => {
    const root = makeRoot();
    const now = () => '2026-08-27T00:00:00.000Z';
    const b1 = new LocalBridge({ root, now });
    const wp0 = await b1.saveRawInput({ text: '希望支持爬坡规划' });
    await b1.recognize(wp0.requestId);
    const registered = await b1.register(wp0.requestId);

    const b2 = new LocalBridge({ root, now });
    const recovered = await b2.readWorkPackage(wp0.requestId);
    expect(recovered.taskCard).toEqual(registered.taskCard);
    expect(recovered.taskCard?.currentPhase).toBe('understand_and_clarify');
  });
});
