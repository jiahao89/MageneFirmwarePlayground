import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// 桥接服务（Tauri 子进程）黑盒测试：Rust 命令层将经同一协议调用。
// 覆盖 Issue #6 要求：命令契约一致、状态迁移、错误模型、不落盘凭据。
// ============================================================================

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const serverBundle = path.join(appRoot, 'dist-bridge', 'bridge-server.cjs');

let root: string;
let child: ChildProcess;
let seq = 0;
const pending = new Map<number, (line: Record<string, unknown>) => void>();
let buffer = '';

function send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  seq += 1;
  const id = seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`RPC 超时：${method}`)), 15_000);
    pending.set(id, (line) => {
      clearTimeout(timer);
      resolve(line);
    });
    child.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

beforeAll(() => {
  // 构建服务包（测试自包含，不依赖外部先跑 build）
  execSync('npm run build:bridge', { cwd: appRoot, stdio: 'pipe' });
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-rpc-'));
  fs.mkdirSync(path.join(root, 'knowledge-base', '01_事实源'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# AGENTS');
  fs.writeFileSync(path.join(root, 'knowledge-base', '01_事实源', 'BENCHMARK.md'), '# B');

  child = spawn(process.execPath, [serverBundle, '--root', root, '--adapter', 'fake'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (d: Buffer) => {
    buffer += d.toString();
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const handler = pending.get(parsed.id as number);
      if (handler) {
        pending.delete(parsed.id as number);
        handler(parsed);
      }
    }
  });
});

afterAll(() => {
  child.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('桥接服务 RPC（Issue #6 Tauri 子进程协议）', () => {
  it('ping 可用', async () => {
    const res = await send('ping');
    expect(res.ok).toBe(true);
  });

  it('契约全流程：save → recognize → register → launch → read（状态迁移正确）', async () => {
    const saved = await send('saveRawInput', { req: { text: '码表在骑行中偶尔闪退', sourceDescription: '用户反馈' } });
    expect(saved.ok).toBe(true);
    const wp0 = saved.result as { requestId: string; status: string };
    expect(wp0.status).toBe('pending_recognition');

    const rec = await send('recognize', { requestId: wp0.requestId });
    expect(rec.ok).toBe(true);
    expect((rec.result as { category: string }).category).toBe('bug');

    const reg = await send('register', { requestId: wp0.requestId });
    expect(reg.ok).toBe(true);
    const wp1 = reg.result as { status: string; taskCard: { currentPhase: string } | null };
    expect(wp1.status).toBe('pending_launch');
    expect(wp1.taskCard?.currentPhase).toBe('understand_and_clarify');

    const launched = await send('launch', { requestId: wp0.requestId });
    expect(launched.ok).toBe(true);
    expect((launched.result as { sessionId?: string }).sessionId).toBeTruthy();

    const read = await send('readWorkPackage', { requestId: wp0.requestId });
    const wp2 = read.result as { status: string; session: { processState?: string } };
    expect(wp2.status).toBe('processing');
    // fake 适配器会话无真实进程：readWorkPackage 对账后回写 exited（F-4 修复行为）
    expect(wp2.session.processState).toBe('exited');

    const list = await send('listWorkPackages');
    expect((list.result as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('状态机错误经 RPC 传播：complete 前置状态不符 → INVALID_TRANSITION', async () => {
    const saved = await send('saveRawInput', { req: { text: '另一个需求 AAAA' } });
    const wp = saved.result as { requestId: string };
    const res = await send('complete', { requestId: wp.requestId });
    expect(res.ok).toBe(false);
    const err = res.error as { code: string; message: string };
    expect(err.code).toBe('INVALID_TRANSITION');
    expect(err.message).toMatch(/非法状态迁移/);
  });

  it('参数错误经 RPC 传播：answerQuestion 找不到问题 → INVALID_ARGUMENT', async () => {
    const saved = await send('saveRawInput', { req: { text: '需求 BBBB 用于错误路径' } });
    const wp = saved.result as { requestId: string };
    await send('recognize', { requestId: wp.requestId });
    await send('register', { requestId: wp.requestId });
    await send('launch', { requestId: wp.requestId });
    // 模拟 Agent 写回问题（processing → pending_answer），使回答操作处于合法状态
    const file = `${root}/.mfp/work/${wp.requestId}.json`;
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    onDisk.questions = [{ id: 'Q1', text: '问题一' }];
    onDisk.status = 'pending_answer';
    fs.writeFileSync(file, JSON.stringify(onDisk));
    const res = await send('answerQuestion', { requestId: wp.requestId, questionId: 'nope', answer: 'x' });
    expect(res.ok).toBe(false);
    expect((res.error as { code: string }).code).toBe('INVALID_ARGUMENT');
  });

  it('重复启动经 RPC 传播被拒绝（INVALID_TRANSITION）', async () => {
    const saved = await send('saveRawInput', { req: { text: '需求 CCCC 并发测试' } });
    const wp = saved.result as { requestId: string };
    await send('recognize', { requestId: wp.requestId });
    await send('register', { requestId: wp.requestId });
    await send('launch', { requestId: wp.requestId });
    const res = await send('launch', { requestId: wp.requestId });
    expect(res.ok).toBe(false);
    // v2：首轮完成后守卫即释放，重复启动由状态机拦截；继续推进应走 resume
    expect((res.error as { code: string }).code).toBe('INVALID_TRANSITION');
  });

  it('未知方法 → INVALID_ARGUMENT', async () => {
    const res = await send('bogusMethod');
    expect(res.ok).toBe(false);
    expect((res.error as { code: string }).code).toBe('INVALID_ARGUMENT');
  });

  it('preflight 经 RPC 返回结构化检查', async () => {
    const saved = await send('saveRawInput', { req: { text: '需求 DDDD 预检' } });
    const wp = saved.result as { requestId: string };
    const res = await send('preflight', { requestId: wp.requestId });
    expect(res.ok).toBe(true);
    const pre = res.result as { ok: boolean; checks: Array<{ name: string; ok: boolean }> };
    const names = pre.checks.map((c) => c.name);
    expect(names).toContain('cli_installed');
    expect(names).toContain('task_card_readable');
  });

  it('持久化：工作包文件落在 <root>/.mfp/work/ 且无凭据字段', async () => {
    const saved = await send('saveRawInput', { req: { text: '需求 EEEE 落盘检查' } });
    const wp = saved.result as { requestId: string };
    const file = path.join(root, '.mfp', 'work', `${wp.requestId}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const keyNames: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) {
          keyNames.push(k);
          walk(val);
        }
      }
    };
    walk(parsed);
    expect(keyNames.some((k) => /api[_ -]?key|token|secret|credential|password/i.test(k))).toBe(false);
  });

  // —— Issue #18：readPrd / submitAnswers / complete(expectedPrd) 经 RPC ——
  it('RPC：readPrd 返回真实文件内容与哈希；not_generated 与负例正确传播', async () => {
    const saved = await send('saveRawInput', { req: { text: '需求 FFFF PRD 读取' } });
    const wp = saved.result as { requestId: string };
    await send('recognize', { requestId: wp.requestId });
    await send('register', { requestId: wp.requestId });

    // 尚未产出 → not_generated
    const none = await send('readPrd', { requestId: wp.requestId });
    expect(none.ok).toBe(true);
    expect(none.result).toEqual({ state: 'not_generated', requestId: wp.requestId });

    // 落盘真实 PRD（模拟 Agent 写回产物登记）
    const content = `# RPC PRD\n\nRPC-UNIQUE-${process.pid.toString(36)}-${Date.now().toString(36)}`;
    fs.mkdirSync(path.join(root, 'output', 'rpc'), { recursive: true });
    fs.writeFileSync(path.join(root, 'output', 'rpc', '02-PRD.md'), content, 'utf8');
    const wpFile = path.join(root, '.mfp', 'work', `${wp.requestId}.json`);
    const onDisk = JSON.parse(fs.readFileSync(wpFile, 'utf8'));
    onDisk.prdPath = 'output/rpc/02-PRD.md';
    onDisk.prdVersion = 1;
    onDisk.status = 'pending_review';
    fs.writeFileSync(wpFile, JSON.stringify(onDisk));

    const doc = await send('readPrd', { requestId: wp.requestId });
    expect(doc.ok).toBe(true);
    const d = doc.result as { state: string; content: string; contentHash: string; version: number };
    expect(d.state).toBe('ready');
    expect(d.content).toBe(content);
    expect(d.version).toBe(1);
    const { createHash } = await import('node:crypto');
    expect(d.contentHash).toBe(createHash('sha256').update(content, 'utf8').digest('hex'));

    // complete：正确快照通过 + 响应携带 confirmedPrd
    const done = await send('complete', { requestId: wp.requestId, expectedPrd: { version: d.version, contentHash: d.contentHash } });
    expect(done.ok).toBe(true);
    expect((done.result as { confirmedPrd?: unknown }).confirmedPrd).toBeDefined();

    // 审阅后内容变化 → PRD_CHANGED（用第二个工作包验证）
    const saved2 = await send('saveRawInput', { req: { text: '需求 GGGG 完成门禁' } });
    const wp2 = saved2.result as { requestId: string };
    await send('recognize', { requestId: wp2.requestId });
    await send('register', { requestId: wp2.requestId });
    const content2 = `# G PRD\n\nG-UNIQUE-${Date.now().toString(36)}`;
    fs.writeFileSync(path.join(root, 'output', 'rpc', '02-PRD.md'), content2, 'utf8');
    const onDisk2 = JSON.parse(fs.readFileSync(path.join(root, '.mfp', 'work', `${wp2.requestId}.json`), 'utf8'));
    onDisk2.prdPath = 'output/rpc/02-PRD.md';
    onDisk2.prdVersion = 1;
    onDisk2.status = 'pending_review';
    fs.writeFileSync(path.join(root, '.mfp', 'work', `${wp2.requestId}.json`), JSON.stringify(onDisk2));
    const doc2 = await send('readPrd', { requestId: wp2.requestId });
    const d2 = (doc2.result as { version: number; contentHash: string });
    fs.appendFileSync(path.join(root, 'output', 'rpc', '02-PRD.md'), '\n\n内容被改', 'utf8');
    const rejected = await send('complete', { requestId: wp2.requestId, expectedPrd: { version: d2.version, contentHash: d2.contentHash } });
    expect(rejected.ok).toBe(false);
    expect((rejected.error as { code: string }).code).toBe('PRD_CHANGED');
  });

  it('RPC：submitAnswers 整批原子保存，负例整批拒绝', async () => {
    const saved = await send('saveRawInput', { req: { text: '需求 HHHH 批量回答' } });
    const wp = saved.result as { requestId: string };
    await send('recognize', { requestId: wp.requestId });
    await send('register', { requestId: wp.requestId });
    await send('launch', { requestId: wp.requestId });

    // Agent 写问题
    const wpFile = path.join(root, '.mfp', 'work', `${wp.requestId}.json`);
    const onDisk = JSON.parse(fs.readFileSync(wpFile, 'utf8'));
    onDisk.questions = [{ id: 'Q1', text: '一' }, { id: 'Q2', text: '二' }, { id: 'Q3', text: '三' }];
    onDisk.status = 'pending_answer';
    fs.writeFileSync(wpFile, JSON.stringify(onDisk));

    const ok = await send('submitAnswers', {
      requestId: wp.requestId,
      answers: [
        { questionId: 'Q1', answer: '答一' },
        { questionId: 'Q2', answer: '答二' },
        { questionId: 'Q3', answer: '答三' },
      ],
    });
    expect(ok.ok).toBe(true);
    const savedWp = ok.result as { status: string; questions: Array<{ id: string; answer?: string }> };
    expect(savedWp.status).toBe('pending_answer'); // 只保存，不推进
    expect(savedWp.questions.map((q) => q.answer)).toEqual(['答一', '答二', '答三']);

    // 非法题目 → 整批拒绝
    const bad = await send('submitAnswers', {
      requestId: wp.requestId,
      answers: [{ questionId: 'Q1', answer: '再答' }, { questionId: 'NOPE', answer: '非法' }],
    });
    expect(bad.ok).toBe(false);
    expect((bad.error as { code: string }).code).toBe('INVALID_ARGUMENT');
    const after = JSON.parse(fs.readFileSync(wpFile, 'utf8'));
    expect(after.questions[0].answer).toBe('答一'); // 原已保存内容不变
  });
});
