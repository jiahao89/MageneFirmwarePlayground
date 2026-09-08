import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalBridge, readWorkPackageFile, writeWorkPackageFile, FakeCliRuntimeAdapter, sha256Hex } from '../src/bridge/node';
import { BridgeError } from '../src/bridge/index';
import type { WorkPackage } from '../src/bridge/index';

function makeBridge() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-bridge-'));
  const now = () => '2026-08-27T00:00:00.000Z';
  return { root, bridge: new LocalBridge({ root, now, adapter: new FakeCliRuntimeAdapter() }) };
}

/** 模拟 Agent 直接写回工作包文件（外部进程写文件，桥接层读）。 */
function agentWrite(root: string, requestId: string, mutate: (wp: WorkPackage) => void): void {
  const filePath = path.join(root, '.mfp', 'work', `${requestId}.json`);
  const loaded = readWorkPackageFile(filePath);
  if (loaded.state !== 'ok') throw new Error(`agentWrite 读取失败：${loaded.reason}`);
  mutate(loaded.workPackage);
  writeWorkPackageFile(filePath, loaded.workPackage);
}

describe('文件桥接契约（Issue #2）', () => {
  it('save → recognize → register（任务卡）→ read', async () => {
    const { bridge } = makeBridge();
    const wp0 = await bridge.saveRawInput({ text: '码表在骑行中偶尔闪退', sourceDescription: '用户反馈' });
    expect(wp0.requestId).toMatch(/^REQ-/);
    expect(wp0.status).toBe('pending_recognition');

    const rec = await bridge.recognize(wp0.requestId);
    expect(rec.category).toBe('bug');
    expect(typeof rec.confidence).toBe('number');

    const wp1 = await bridge.register(wp0.requestId);
    expect(wp1.status).toBe('pending_launch');
    expect(wp1.taskCard).not.toBeNull();
    expect(wp1.taskCard?.currentPhase).toBe('understand_and_clarify');

    const read = await bridge.readWorkPackage(wp0.requestId);
    expect(read.originalInput.text).toBe('码表在骑行中偶尔闪退');
    expect(read.recognition?.category).toBe('bug');
  });

  it('空文本被拒绝', async () => {
    const { bridge } = makeBridge();
    await expect(bridge.saveRawInput({ text: '   ' })).rejects.toThrowError(BridgeError);
  });

  it('PM 才能登记/归档/完成：非法前置状态抛 INVALID_TRANSITION', async () => {
    const { bridge } = makeBridge();
    const wp = await bridge.saveRawInput({ text: '需求 AAAA' });
    // 未识别就登记
    await expect(bridge.register(wp.requestId)).rejects.toThrow(/非法状态迁移/);
    // 未登记就完成
    await expect(bridge.complete(wp.requestId)).rejects.toThrow(/非法状态迁移/);

    // 识别后可归档（待 PM 确认 → 归档）
    await bridge.recognize(wp.requestId);
    const archived = await bridge.archive(wp.requestId);
    expect(archived.status).toBe('archived');
    // 归档后不能再登记
    await expect(bridge.register(wp.requestId)).rejects.toThrow(/非法状态迁移/);
  });

  it('重复 launch 被拒绝（首轮完成后由状态机拦截 processing → processing）', async () => {
    const { bridge } = makeBridge();
    const wp0 = await bridge.saveRawInput({ text: '希望支持 ANT+ 车灯自动开关' });
    await bridge.recognize(wp0.requestId);
    await bridge.register(wp0.requestId);
    await bridge.launch(wp0.requestId);
    // v2：守卫只保护在途调用；首轮已完成后，重复启动由状态机拒绝（继续走 resume）
    await expect(bridge.launch(wp0.requestId)).rejects.toThrow(/非法状态迁移/);
  });

  it('完整状态流：启动 → Agent 写问题 → PM 回答 → Agent 写 PRD → PM 完成', async () => {
    const { root, bridge } = makeBridge();
    const wp0 = await bridge.saveRawInput({ text: '希望在码表上支持爬坡规划' });
    await bridge.recognize(wp0.requestId);
    await bridge.register(wp0.requestId);
    await bridge.launch(wp0.requestId);

    // Agent 写问题 → 待回答
    agentWrite(root, wp0.requestId, (wp) => {
      wp.questions.push({ id: 'Q1', text: '目标人群是谁？' });
      wp.status = 'pending_answer';
    });
    let read = await bridge.readWorkPackage(wp0.requestId);
    expect(read.status).toBe('pending_answer');
    expect(read.questions).toHaveLength(1);

    // PM 回答 → 只保存数据，不推进状态、不启动 Agent（Issue #18 契约）
    await bridge.answerQuestion(wp0.requestId, 'Q1', '骑行爱好者');
    read = await bridge.readWorkPackage(wp0.requestId);
    expect(read.status).toBe('pending_answer');
    expect(read.questions[0].answer).toBe('骑行爱好者');

    // Agent 写 PRD 文件 + 登记产物 → 待审阅
    fs.mkdirSync(path.join(root, 'output', '爬坡规划'), { recursive: true });
    const prdContent = `# PRD：爬坡规划\n\n随机唯一验收文本 CLIMB-${Date.now().toString(36)}`;
    fs.writeFileSync(path.join(root, 'output', '爬坡规划', '02-PRD.md'), prdContent, 'utf8');
    agentWrite(root, wp0.requestId, (wp) => {
      wp.prdPath = 'output/爬坡规划/02-PRD.md';
      wp.prdVersion = 1;
      wp.status = 'pending_review';
    });
    read = await bridge.readWorkPackage(wp0.requestId);
    expect(read.status).toBe('pending_review');
    expect(read.prdVersion).toBe(1);

    // PM 审阅：readPrd 获取同次读取的内容与快照（Issue #18）
    const doc = await bridge.readPrd(wp0.requestId);
    expect(doc.state).toBe('ready');
    if (doc.state === 'ready') {
      expect(doc.content).toBe(prdContent);
      expect(doc.version).toBe(1);
      expect(doc.contentHash).toBe(sha256Hex(prdContent));
    }

    // PM 完成：必须携带审阅快照（Issue #18 完成门禁）
    await expect(bridge.complete(wp0.requestId)).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    });
    const done = await bridge.complete(wp0.requestId, {
      version: doc.state === 'ready' ? doc.version : 1,
      contentHash: doc.state === 'ready' ? doc.contentHash : '',
    });
    expect(done.status).toBe('completed');
    expect(done.confirmedPrd?.version).toBe(1);
    expect(done.confirmedPrd?.contentHash).toBe(sha256Hex(prdContent));
  });

  it('重启后未完成的 running 状态不能被再次 launch（持久化运行态）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-bridge2-'));
    const now = () => '2026-08-27T00:00:00.000Z';
    const b1 = new LocalBridge({ root, now, adapter: new FakeCliRuntimeAdapter() });
    const wp0 = await b1.saveRawInput({ text: '需求 BBBB' });
    await b1.recognize(wp0.requestId);
    await b1.register(wp0.requestId);
    await b1.launch(wp0.requestId);

    const b2 = new LocalBridge({ root, now, adapter: new FakeCliRuntimeAdapter(), sessionAlive: async () => true });
    await expect(b2.launch(wp0.requestId)).rejects.toThrow(/运行/);
  });
});
