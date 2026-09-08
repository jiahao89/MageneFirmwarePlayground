import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalBridge, FakeCliRuntimeAdapter, readWorkPackageFile, writeWorkPackageFile, sha256Hex } from '../src/bridge/node';
import type { WorkPackage } from '../src/bridge/index';

// ============================================================================
// Issue #18 验收：真实 PRD 读取、批量回答与修订执行一致性。
// 三层中的「fake CLI / 真实文件」层：FakeCliRuntimeAdapter（确定性 fake，不依赖
// 开发机真实 Claude 安装）+ 真实磁盘工作包与 PRD 文件。
// 真实模型层验证见集成阶段（报告区分）。
// ============================================================================

let seq = 0;
function deterministicId(): string {
  seq += 1;
  return `uuid-${seq.toString(36).padStart(4, '0')}`;
}
const NOW = () => '2026-08-31T00:00:00.000Z';

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-prd-'));
}

interface Harness {
  root: string;
  bridge: LocalBridge;
  adapter: FakeCliRuntimeAdapter;
}

function makeHarness(adapterOpts?: ConstructorParameters<typeof FakeCliRuntimeAdapter>[0]): Harness {
  const root = makeRoot();
  const adapter = new FakeCliRuntimeAdapter(adapterOpts);
  const bridge = new LocalBridge({ root, now: NOW, adapter, newSessionId: deterministicId, sessionAlive: async () => true });
  return { root, bridge, adapter };
}

async function launched(h: Harness, text: string): Promise<WorkPackage> {
  const wp0 = await h.bridge.saveRawInput({ text });
  await h.bridge.recognize(wp0.requestId);
  const wp = await h.bridge.register(wp0.requestId);
  await h.bridge.launch(wp.requestId);
  return wp;
}

/** 模拟 Agent 写问题并置待回答。 */
function agentAsks(h: Harness, requestId: string, ids: string[]): void {
  agentWrite(h, requestId, (wp) => {
    wp.questions = ids.map((id) => ({ id, text: `问题 ${id}` }));
    wp.status = 'pending_answer';
  });
}

/** 模拟 Agent 直接写回工作包文件（外部进程写文件，桥接层读）。 */
function agentWrite(h: Harness, requestId: string, mutate: (wp: WorkPackage) => void): void {
  const filePath = path.join(h.root, '.mfp', 'work', `${requestId}.json`);
  const loaded = readWorkPackageFile(filePath);
  if (loaded.state !== 'ok') throw new Error(`agentWrite 读取失败：${loaded.reason}`);
  mutate(loaded.workPackage);
  writeWorkPackageFile(filePath, loaded.workPackage);
}

function readWpFile(h: Harness, requestId: string): WorkPackage {
  const filePath = path.join(h.root, '.mfp', 'work', `${requestId}.json`);
  const loaded = readWorkPackageFile(filePath);
  if (loaded.state !== 'ok') throw new Error(`读取失败：${loaded.reason}`);
  return loaded.workPackage;
}

/** 落盘一个真实 PRD 文件，并把产物登记写进工作包（模拟 Agent 完成写回）。 */
function writePrdArtifact(h: Harness, requestId: string, relPath: string, content: string, version: number, status: WorkPackage['status'] = 'pending_review'): void {
  const abs = path.join(h.root, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  agentWrite(h, requestId, (wp) => {
    wp.prdPath = relPath;
    wp.prdVersion = version;
    wp.status = status;
  });
}

function randomText(tag: string): string {
  return `${tag}-${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Issue #18：readPrd 真实读取', () => {
  it('隔离临时工作包 + 随机唯一文本：readPrd 返回完全一致；两条需求不串用', async () => {
    const h = makeHarness();
    const wpA = await launched(h, '需求 A：随机唯一内容读取');
    const wpB = await launched(h, '需求 B：随机唯一内容读取');
    const textA = `# PRD A\n\n${randomText('A')}`;
    const textB = `# PRD B\n\n${randomText('B')}`;
    writePrdArtifact(h, wpA.requestId, 'output/A/02-PRD.md', textA, 1);
    writePrdArtifact(h, wpB.requestId, 'output/B/02-PRD.md', textB, 1);

    const docA = await h.bridge.readPrd(wpA.requestId);
    const docB = await h.bridge.readPrd(wpB.requestId);
    expect(docA.state).toBe('ready');
    expect(docB.state).toBe('ready');
    if (docA.state === 'ready' && docB.state === 'ready') {
      expect(docA.content).toBe(textA);
      expect(docA.contentHash).toBe(sha256Hex(textA));
      expect(docA.path).toBe('output/A/02-PRD.md');
      expect(docA.version).toBe(1);
      expect(docB.content).toBe(textB);
      expect(docB.contentHash).toBe(sha256Hex(textB));
      // 不串用
      expect(docA.content).not.toContain(docB.content);
    }
  });

  it('无 prdPath → not_generated（不是错误）', async () => {
    const h = makeHarness();
    const wp = await launched(h, '尚未产出 PRD');
    const doc = await h.bridge.readPrd(wp.requestId);
    expect(doc).toEqual({ state: 'not_generated', requestId: wp.requestId });
  });

  it('文件丢失 → PRD_NOT_FOUND', async () => {
    const h = makeHarness();
    const wp = await launched(h, 'PRD 文件丢失');
    writePrdArtifact(h, wp.requestId, 'output/x/02-PRD.md', '# x', 1);
    fs.rmSync(path.join(h.root, 'output', 'x', '02-PRD.md'));
    await expect(h.bridge.readPrd(wp.requestId)).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'PRD_NOT_FOUND' }),
    });
  });

  it('文件不可读（权限）→ PRD_READ_FAILED', async () => {
    const h = makeHarness();
    const wp = await launched(h, 'PRD 文件不可读');
    writePrdArtifact(h, wp.requestId, 'output/x/02-PRD.md', '# x', 1);
    fs.chmodSync(path.join(h.root, 'output', 'x', '02-PRD.md'), 0o000);
    try {
      await expect(h.bridge.readPrd(wp.requestId)).rejects.toMatchObject({
        payload: expect.objectContaining({ code: 'PRD_READ_FAILED' }),
      });
    } finally {
      fs.chmodSync(path.join(h.root, 'output', 'x', '02-PRD.md'), 0o644);
    }
  });

  it('空文档 → PRD_INVALID', async () => {
    const h = makeHarness();
    const wp = await launched(h, 'PRD 空文档');
    writePrdArtifact(h, wp.requestId, 'output/x/02-PRD.md', '   \n\t\n', 1);
    await expect(h.bridge.readPrd(wp.requestId)).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'PRD_INVALID' }),
    });
  });

  it('路径越界（../ 穿越 / 绝对路径 / 非 output 前缀 / 非 .md）→ INVALID_PATH / PRD_INVALID', async () => {
    const h = makeHarness();
    const wp = await launched(h, '路径越界');
    const cases: Array<[string, string]> = [
      ['../outside/02-PRD.md', 'INVALID_PATH'],
      ['/etc/passwd.md', 'INVALID_PATH'],
      ['docs/02-PRD.md', 'INVALID_PATH'],
      ['output/x/02-PRD.txt', 'PRD_INVALID'],
    ];
    for (const [rel, code] of cases) {
      agentWrite(h, wp.requestId, (w) => {
        w.prdPath = rel;
        w.prdVersion = 1;
      });
      await expect(h.bridge.readPrd(wp.requestId)).rejects.toMatchObject({
        payload: expect.objectContaining({ code }),
      }, `prdPath=${rel}`);
    }
  });

  it('符号链接越界 → INVALID_PATH', async () => {
    const h = makeHarness();
    const wp = await launched(h, '符号链接越界');
    const outside = path.join(os.tmpdir(), `mfp-outside-${Date.now()}.md`);
    fs.writeFileSync(outside, '# 越界内容', 'utf8');
    fs.mkdirSync(path.join(h.root, 'output', 'x'), { recursive: true });
    fs.symlinkSync(outside, path.join(h.root, 'output', 'x', '02-PRD.md'));
    agentWrite(h, wp.requestId, (w) => {
      w.prdPath = 'output/x/02-PRD.md';
      w.prdVersion = 1;
    });
    await expect(h.bridge.readPrd(wp.requestId)).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'INVALID_PATH' }),
    });
    fs.rmSync(outside);
  });

  it('版本无效（缺版本 / 0 / 非整数）→ PRD_INVALID', async () => {
    const h = makeHarness();
    const wp = await launched(h, '版本无效');
    fs.mkdirSync(path.join(h.root, 'output', 'x'), { recursive: true });
    fs.writeFileSync(path.join(h.root, 'output', 'x', '02-PRD.md'), '# 有效内容', 'utf8');
    for (const bad of [undefined, 0, 1.5]) {
      agentWrite(h, wp.requestId, (w) => {
        w.prdPath = 'output/x/02-PRD.md';
        w.prdVersion = bad;
      });
      await expect(h.bridge.readPrd(wp.requestId)).rejects.toMatchObject({
        payload: expect.objectContaining({ code: 'PRD_INVALID' }),
      }, `prdVersion=${bad}`);
    }
  });
});

describe('Issue #18：submitAnswers 批量原子保存', () => {
  it('同轮 3 个回答一次保存：状态不变、无运行记录、磁盘包含全部答案', async () => {
    const h = makeHarness();
    const wp = await launched(h, '批量保存三题');
    agentAsks(h, wp.requestId, ['Q1', 'Q2', 'Q3']);
    const before = readWpFile(h, wp.requestId);

    const updated = await h.bridge.submitAnswers(wp.requestId, [
      { questionId: 'Q1', answer: '答案一' },
      { questionId: 'Q2', answer: '答案二' },
      { questionId: 'Q3', answer: '答案三' },
    ]);
    // 只保存：不推进状态、不启动运行
    expect(updated.status).toBe('pending_answer');
    expect(updated.runLog).toHaveLength(before.runLog.length);

    // 磁盘文件包含全部答案（resume 时 Agent 从磁盘读到全部已提交答案）
    const onDisk = readWpFile(h, wp.requestId);
    expect(onDisk.questions.map((q) => q.answer)).toEqual(['答案一', '答案二', '答案三']);
    expect(onDisk.status).toBe('pending_answer');
  });

  it('非法题目 / 重复 ID / 空答案 → 整批拒绝且原文件不变', async () => {
    const h = makeHarness();
    const wp = await launched(h, '整批拒绝');
    agentAsks(h, wp.requestId, ['Q1', 'Q2']);
    const before = fs.readFileSync(path.join(h.root, '.mfp', 'work', `${wp.requestId}.json`), 'utf8');

    const badBatches = [
      [{ questionId: 'Q1', answer: '有效' }, { questionId: 'NOPE', answer: '非法题目' }],
      [{ questionId: 'Q1', answer: '一' }, { questionId: 'Q1', answer: '二' }],
      [{ questionId: 'Q1', answer: '有效' }, { questionId: 'Q2', answer: '   ' }],
    ];
    for (const batch of badBatches) {
      await expect(h.bridge.submitAnswers(wp.requestId, batch)).rejects.toMatchObject({
        payload: expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      });
      // 原文件不变（字节级）
      expect(fs.readFileSync(path.join(h.root, '.mfp', 'work', `${wp.requestId}.json`), 'utf8')).toBe(before);
    }
  });

  it('保存不伪造运行：不产生新运行轮、会话元数据不变', async () => {
    const h = makeHarness();
    const wp = await launched(h, '保存不伪造运行');
    agentAsks(h, wp.requestId, ['Q1']);
    const before = readWpFile(h, wp.requestId);
    const updated = await h.bridge.answerQuestion(wp.requestId, 'Q1', '答案');
    expect(updated.runLog).toHaveLength(before.runLog.length);
    expect(updated.session).toEqual(before.session);
    expect(updated.status).toBe(before.status);
  });
});

describe('Issue #18：修订执行一致性（fake Agent 实际改写文件）', () => {
  it('submitRevision → resume → fake Agent 改写文件 → 版本更新 → pending_review', async () => {
    // 用 agentTurn 注入的适配器重建桥
    const root = makeRoot();
    const adapter = new FakeCliRuntimeAdapter({
      agentTurn: async (spec) => {
        // 模拟真实 headless 轮：读磁盘工作包 → 有未处理意见则改写 PRD → 写回
        const file = path.join(root, '.mfp', 'work', `${path.basename(spec.startupFile, '.startup.txt')}.json`);
        const loaded = readWorkPackageFile(file);
        if (loaded.state !== 'ok') return;
        const wp = loaded.workPackage;
        if (wp.status !== 'revising' || !wp.prdPath) return;
        const abs = path.join(root, ...wp.prdPath.split('/'));
        const old = fs.readFileSync(abs, 'utf8');
        const comment = wp.revisionComments.at(-1)?.text ?? '修订';
        fs.writeFileSync(abs, `${old}\n\n## 修订（v${(wp.prdVersion ?? 1) + 1}）\n\n${comment}\n\n${randomText('REV')}`, 'utf8');
        wp.prdVersion = (wp.prdVersion ?? 1) + 1;
        wp.status = 'pending_review';
        writeWorkPackageFile(file, wp);
      },
    });
    const bridge = new LocalBridge({ root, now: NOW, adapter, newSessionId: deterministicId, sessionAlive: async () => true });
    const wp0 = await bridge.saveRawInput({ text: '修订执行一致性' });
    await bridge.recognize(wp0.requestId);
    const wp = await bridge.register(wp0.requestId);
    await bridge.launch(wp.requestId);
    const v1 = `# PRD\n\n${randomText('V1')}`;
    writePrdArtifact({ root, bridge, adapter } as Harness, wp.requestId, 'output/rev/02-PRD.md', v1, 1);
    const doc1 = await bridge.readPrd(wp.requestId);
    expect(doc1.state === 'ready' && doc1.version).toBe(1);

    await bridge.submitRevision(wp.requestId, '补充 FIT 字段定义');
    const res = await bridge.resume(wp.requestId);
    expect(res.ok).toBe(true);

    const after = await bridge.readWorkPackage(wp.requestId);
    expect(after.status).toBe('pending_review');
    expect(after.prdVersion).toBe(2);
    const doc2 = await bridge.readPrd(wp.requestId);
    expect(doc2.state).toBe('ready');
    if (doc2.state === 'ready') {
      expect(doc2.version).toBe(2);
      expect(doc2.content).toContain('补充 FIT 字段定义');
      expect(doc2.contentHash).not.toBe(doc1.state === 'ready' ? doc1.contentHash : '');
    }
  });

  it('resume 失败：意见保留、旧 PRD 可恢复、重试不重复添加同一意见', async () => {
    const root = makeRoot();
    let failFirstRevising = true;
    const adapter = new FakeCliRuntimeAdapter({
      agentTurn: async (spec) => {
        const file = path.join(root, '.mfp', 'work', `${path.basename(spec.startupFile, '.startup.txt')}.json`);
        const loaded = readWorkPackageFile(file);
        if (loaded.state !== 'ok') return;
        const wp = loaded.workPackage;
        if (wp.status !== 'revising' || !wp.prdPath) return;
        if (failFirstRevising) {
          failFirstRevising = false;
          throw new Error('模拟执行轮失败（网络中断）');
        }
        const abs = path.join(root, ...wp.prdPath.split('/'));
        const old = fs.readFileSync(abs, 'utf8');
        fs.writeFileSync(abs, `${old}\n\n## 修订重试成功`, 'utf8');
        wp.prdVersion = (wp.prdVersion ?? 1) + 1;
        wp.status = 'pending_review';
        writeWorkPackageFile(file, wp);
      },
    });
    const bridge = new LocalBridge({ root, now: NOW, adapter, newSessionId: deterministicId, sessionAlive: async () => true });
    const wp0 = await bridge.saveRawInput({ text: 'resume 失败可重试' });
    await bridge.recognize(wp0.requestId);
    const wp = await bridge.register(wp0.requestId);
    await bridge.launch(wp.requestId);
    const v1 = `# PRD\n\n${randomText('OLD')}`;
    writePrdArtifact({ root, bridge, adapter } as Harness, wp.requestId, 'output/retry/02-PRD.md', v1, 1);

    await bridge.submitRevision(wp.requestId, '唯一一条修改意见');
    await expect(bridge.resume(wp.requestId)).rejects.toThrow();

    // 失败后：意见保留、旧 PRD 仍可读（v1 原文）
    let mid = await bridge.readWorkPackage(wp.requestId);
    expect(mid.revisionComments).toHaveLength(1);
    const docOld = await bridge.readPrd(wp.requestId);
    expect(docOld.state === 'ready' && docOld.content).toBe(v1);

    // 重试只 resume（不再 submitRevision）→ 意见不重复
    await bridge.resume(wp.requestId);
    mid = await bridge.readWorkPackage(wp.requestId);
    expect(mid.revisionComments).toHaveLength(1);
    expect(mid.status).toBe('pending_review');
    expect(mid.prdVersion).toBe(2);
  });
});

describe('Issue #18：complete 完成门禁', () => {
  async function reviewable(h: Harness): Promise<{ requestId: string; snapshot: { version: number; contentHash: string } }> {
    const wp = await launched(h, '完成门禁');
    const content = `# PRD\n\n${randomText('GATE')}`;
    writePrdArtifact(h, wp.requestId, 'output/gate/02-PRD.md', content, 1);
    const doc = await h.bridge.readPrd(wp.requestId);
    if (doc.state !== 'ready') throw new Error('前置失败');
    return { requestId: wp.requestId, snapshot: { version: doc.version, contentHash: doc.contentHash } };
  }

  it('缺 expectedPrd（已登记 prdPath）→ INVALID_ARGUMENT', async () => {
    const h = makeHarness();
    const { requestId } = await reviewable(h);
    await expect(h.bridge.complete(requestId)).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    });
  });

  it('审阅后文件被改 → PRD_CHANGED；版本变化 → PRD_CHANGED', async () => {
    const h = makeHarness();
    const { requestId, snapshot } = await reviewable(h);
    // 内容变化
    fs.appendFileSync(path.join(h.root, 'output', 'gate', '02-PRD.md'), '\n\n被 Agent 偷偷改了', 'utf8');
    await expect(h.bridge.complete(requestId, snapshot)).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'PRD_CHANGED' }),
    });
    // 恢复原内容、改版本
    const original = fs.readFileSync(path.join(h.root, 'output', 'gate', '02-PRD.md'), 'utf8').replace('\n\n被 Agent 偷偷改了', '');
    fs.writeFileSync(path.join(h.root, 'output', 'gate', '02-PRD.md'), original, 'utf8');
    agentWrite(h, requestId, (wp) => {
      wp.prdVersion = 2;
    });
    await expect(h.bridge.complete(requestId, { version: 1, contentHash: snapshot.contentHash })).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'PRD_CHANGED' }),
    });
  });

  it('正确快照 → completed，落盘 confirmedPrd（PM 确认版本/哈希）', async () => {
    const h = makeHarness();
    const { requestId, snapshot } = await reviewable(h);
    const done = await h.bridge.complete(requestId, snapshot);
    expect(done.status).toBe('completed');
    expect(done.confirmedPrd).toMatchObject({ version: snapshot.version, contentHash: snapshot.contentHash });
    // 落盘验证
    expect(readWpFile(h, requestId).confirmedPrd?.contentHash).toBe(snapshot.contentHash);
  });

  it('执行轮进行中禁止完成 → CONCURRENT_RUN（UI 可见 pending_review 但本轮未结束）', async () => {
    const root = makeRoot();
    let releaseTurn!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const prdContent = `# PRD\n\n${randomText('RUN')}`;
    const writeReviewState = (requestId: string, version: number): void => {
      // Agent 已把 pending_review + 有效产物写盘（UI 轮询可见），本轮仍继续写入中
      const file = path.join(root, '.mfp', 'work', `${requestId}.json`);
      const loaded = readWorkPackageFile(file);
      if (loaded.state !== 'ok') return;
      fs.mkdirSync(path.join(root, 'output', 'r'), { recursive: true });
      fs.writeFileSync(path.join(root, 'output', 'r', '02-PRD.md'), prdContent, 'utf8');
      loaded.workPackage.status = 'pending_review';
      loaded.workPackage.prdPath = 'output/r/02-PRD.md';
      loaded.workPackage.prdVersion = version;
      writeWorkPackageFile(file, loaded.workPackage);
    };
    const adapter = new FakeCliRuntimeAdapter({
      agentTurn: async (spec) => {
        const requestId = path.basename(spec.startupFile, '.startup.txt');
        writeReviewState(requestId, 1);
        await gate; // 本轮挂起（仍在执行）
      },
    });
    const bridge = new LocalBridge({ root, now: NOW, adapter, newSessionId: deterministicId, sessionAlive: async () => true });
    const wp0 = await bridge.saveRawInput({ text: '运行中禁止完成' });
    await bridge.recognize(wp0.requestId);
    const wp = await bridge.register(wp0.requestId);

    const inFlight = bridge.launch(wp.requestId); // agentTurn 写盘后挂起
    await new Promise((r) => setTimeout(r, 50));
    // 磁盘已是 pending_review（UI 可见），但执行轮未结束
    const visible = await bridge.readWorkPackage(wp.requestId);
    expect(visible.status).toBe('pending_review');
    await expect(bridge.complete(wp.requestId, { version: 1, contentHash: sha256Hex(prdContent) })).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'CONCURRENT_RUN' }),
    });
    releaseTurn();
    await inFlight;
  });

  it('运行中（状态 processing/pending_answer）完成被状态机拒绝', async () => {
    const h = makeHarness();
    const wp = await launched(h, '非审阅态完成');
    await expect(h.bridge.complete(wp.requestId, { version: 1, contentHash: 'x'.repeat(64) })).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    });
  });
});

describe('Issue #18：产物写回门禁（pending_review 不容伪造）', () => {
  it('Agent 声称 pending_review 但产物无效 → 退回 processing + PRD_INVALID 诊断，不改写产物文件', async () => {
    const root = makeRoot();
    const adapter = new FakeCliRuntimeAdapter({
      agentTurn: async (spec) => {
        // Agent 声称 pending_review，但 PRD 文件根本没写（产物写回失败）
        const file = path.join(root, '.mfp', 'work', `${path.basename(spec.startupFile, '.startup.txt')}.json`);
        const loaded = readWorkPackageFile(file);
        if (loaded.state !== 'ok') return;
        loaded.workPackage.status = 'pending_review';
        loaded.workPackage.prdPath = 'output/g/02-PRD.md';
        loaded.workPackage.prdVersion = 1;
        writeWorkPackageFile(file, loaded.workPackage);
      },
    });
    const bridge = new LocalBridge({ root, now: NOW, adapter, newSessionId: deterministicId, sessionAlive: async () => true });
    const wp0 = await bridge.saveRawInput({ text: '产物门禁' });
    await bridge.recognize(wp0.requestId);
    const wp = await bridge.register(wp0.requestId);
    await bridge.launch(wp.requestId);
    const res = await bridge.resume(wp.requestId);
    expect(res.note).toMatch(/产物写回校验未通过/);
    const after = await bridge.readWorkPackage(wp.requestId);
    expect(after.status).toBe('processing'); // 不把无效产物当作待审阅
    expect(after.session.lastError?.code).toBe('PRD_INVALID');
    // 产物目录不被桥接层改写（文件仍不存在）
    expect(fs.existsSync(path.join(root, 'output', 'g', '02-PRD.md'))).toBe(false);
    // 此后完成被状态机拒绝（未处于待审阅）
    await expect(bridge.complete(wp.requestId, { version: 1, contentHash: 'x' })).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    });
  });

  it('空 PRD 文件同样被门禁退回', async () => {
    const root = makeRoot();
    const adapter = new FakeCliRuntimeAdapter({
      agentTurn: async (spec) => {
        const file = path.join(root, '.mfp', 'work', `${path.basename(spec.startupFile, '.startup.txt')}.json`);
        const loaded = readWorkPackageFile(file);
        if (loaded.state !== 'ok') return;
        const w = loaded.workPackage;
        fs.mkdirSync(path.join(root, 'output', 'e'), { recursive: true });
        fs.writeFileSync(path.join(root, 'output', 'e', '02-PRD.md'), '', 'utf8'); // 空文件
        w.status = 'pending_review';
        w.prdPath = 'output/e/02-PRD.md';
        w.prdVersion = 1;
        writeWorkPackageFile(file, w);
      },
    });
    const bridge = new LocalBridge({ root, now: NOW, adapter, newSessionId: deterministicId, sessionAlive: async () => true });
    const wp0 = await bridge.saveRawInput({ text: '空产物门禁' });
    await bridge.recognize(wp0.requestId);
    const wp = await bridge.register(wp0.requestId);
    await bridge.launch(wp.requestId);
    await bridge.resume(wp.requestId);
    const after = await bridge.readWorkPackage(wp.requestId);
    expect(after.status).toBe('processing');
    expect(after.session.lastError?.code).toBe('PRD_INVALID');
  });
});

describe('Issue #18：历史工作包兼容', () => {
  it('合法历史包（已登记产物 + 文件存在）可正常读取；不一致给诊断、不重写用户文件', async () => {
    const h = makeHarness();
    const wp = await launched(h, '历史包兼容');
    const content = `# 历史 PRD\n\n${randomText('HIST')}`;
    writePrdArtifact(h, wp.requestId, 'output/hist/02-PRD.md', content, 1);
    const filePath = path.join(h.root, '.mfp', 'work', `${wp.requestId}.json`);
    const before = fs.readFileSync(filePath, 'utf8');
    const doc = await h.bridge.readPrd(wp.requestId);
    expect(doc.state === 'ready' && doc.content).toBe(content);
    // 读取不改写工作包文件
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
  });
});
