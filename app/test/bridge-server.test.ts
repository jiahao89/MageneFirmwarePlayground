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
});
