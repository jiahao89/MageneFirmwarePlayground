import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalBridge, FakeCliRuntimeAdapter, readWorkPackageFile, writeWorkPackageFile } from '../src/bridge/node';
import { BridgeError } from '../src/bridge/index';

let seq = 0;
function deterministicId(): string {
  seq += 1;
  return `uuid-${seq.toString().padStart(4, '0')}`;
}

function makeBridge(
  adapterOpts?: ConstructorParameters<typeof FakeCliRuntimeAdapter>[0],
  opts?: { sessionAlive?: (sessionId: string) => Promise<boolean> },
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-session-'));
  // 规则/事实源入口（preflight 检查用）
  fs.mkdirSync(path.join(root, 'knowledge-base', '01_事实源'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# AGENTS');
  fs.writeFileSync(path.join(root, 'knowledge-base', '01_事实源', 'BENCHMARK.md'), '# BENCHMARK');

  const now = () => '2026-08-27T00:00:00.000Z';
  const adapter = new FakeCliRuntimeAdapter(adapterOpts);
  const bridge = new LocalBridge({
    root,
    now,
    adapter,
    newSessionId: deterministicId,
    // 默认模拟「会话进程一直存活」，保持既有断言语义；
    // 对账行为由专门的测试用例覆盖。
    sessionAlive: opts?.sessionAlive ?? (async () => true),
  });
  return { root, bridge, adapter };
}

async function registered(bridge: LocalBridge, text = '希望支持爬坡规划') {
  const wp0 = await bridge.saveRawInput({ text });
  await bridge.recognize(wp0.requestId);
  return bridge.register(wp0.requestId);
}

describe('会话生命周期（Issue #3）', () => {
  it('launch：保存 sessionId / CLI 版本 / 启动时间 / 进程状态到工作包', async () => {
    const { bridge, adapter } = makeBridge();
    const wp = await registered(bridge);
    const res = await bridge.launch(wp.requestId);
    expect(res.ok).toBe(true);
    expect(res.sessionId).toMatch(/^uuid-/);
    expect(adapter.sessions).toHaveLength(1);

    const read = await bridge.readWorkPackage(wp.requestId);
    expect(read.status).toBe('processing');
    expect(read.session.sessionId).toBe(res.sessionId);
    expect(read.session.cliVersion).toBe('9.9.9');
    expect(read.session.startedAt).toBe('2026-08-27T00:00:00.000Z');
    expect(read.session.processState).toBe('running');
    expect(read.runLog.at(-1)?.sessionId).toBe(res.sessionId);
  });

  it('launch 后重复启动 → CONCURRENT_RUN（并发保护不变）', async () => {
    const { bridge } = makeBridge();
    const wp = await registered(bridge);
    await bridge.launch(wp.requestId);
    await expect(bridge.launch(wp.requestId)).rejects.toThrowError(BridgeError);
  });

  it('resume：会话在运行 → 返回既有会话（不新起）', async () => {
    const { bridge, adapter } = makeBridge();
    const wp = await registered(bridge);
    const launched = await bridge.launch(wp.requestId);
    const resumed = await bridge.resume(wp.requestId);
    expect(resumed.sessionId).toBe(launched.sessionId);
    expect(adapter.sessions).toHaveLength(1); // 未新增会话
  });

  it('resume：终端关闭后恢复 → 使用已保存会话，状态不变', async () => {
    const { root, bridge } = makeBridge();
    const wp = await registered(bridge);
    await bridge.launch(wp.requestId);
    // 模拟终端关闭 + 应用重启：文件进程状态置 exited，并用新桥实例恢复
    const file = await findWorkPackageFile(bridge, wp.requestId);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.session.processState = 'exited';
    fs.writeFileSync(file, JSON.stringify(saved));

    const b2 = new LocalBridge({ root, now: () => '2026-08-27T00:00:00.000Z', adapter: new FakeCliRuntimeAdapter(), newSessionId: deterministicId, sessionAlive: async () => true });
    const resumed = await b2.resume(wp.requestId);
    expect(resumed.sessionId).toBe(saved.session.sessionId); // 复用已保存会话
    expect(resumed.fallback).toBeFalsy();
    const read = await b2.readWorkPackage(wp.requestId);
    expect(read.status).toBe('processing'); // 需求状态不变
    expect(read.session.processState).toBe('running');
  });

  it('resume 失败 → 基于工作包创建新会话（fallback）', async () => {
    const { root, bridge } = makeBridge({ resumeShouldFail: true });
    const wp = await registered(bridge);
    await bridge.launch(wp.requestId);
    // 模拟终端关闭 + 应用重启
    const rootFile = await findWorkPackageFile(bridge, wp.requestId);
    const saved = JSON.parse(fs.readFileSync(rootFile, 'utf8'));
    saved.session.processState = 'exited';
    fs.writeFileSync(rootFile, JSON.stringify(saved));

    const b2 = new LocalBridge({ root, now: () => '2026-08-27T00:00:00.000Z', adapter: new FakeCliRuntimeAdapter({ resumeShouldFail: true }), newSessionId: deterministicId, sessionAlive: async () => true });
    const resumed = await b2.resume(wp.requestId);
    expect(resumed.fallback).toBe(true);
    expect(resumed.sessionId).not.toBe(saved.session.sessionId);
    expect(resumed.note).toMatch(/无法恢复/);

    const read = await b2.readWorkPackage(wp.requestId);
    expect(read.session.sessionId).toBe(resumed.sessionId);
    expect(read.session.lastError?.code).toBe('SESSION_NOT_FOUND');
  });

  it('resume：无已保存会话 → 直接创建新会话', async () => {
    const { bridge } = makeBridge();
    const wp = await registered(bridge);
    const resumed = await bridge.resume(wp.requestId); // pending_launch 且无会话
    expect(resumed.ok).toBe(true);
    expect(resumed.note).toMatch(/新会话/);
    const read = await bridge.readWorkPackage(wp.requestId);
    expect(read.status).toBe('processing');
    expect(read.session.processState).toBe('running');
  });

  it('preflight：fake 适配器全部通过', async () => {
    const { bridge } = makeBridge();
    const wp = await registered(bridge);
    const pre = await bridge.preflight(wp.requestId);
    expect(pre.ok).toBe(true);
    const names = pre.checks.map((c) => c.name);
    for (const n of ['mfp_root_exists', 'cli_installed', 'cli_version', 'cli_auth', 'rules_entrypoints', 'task_card_readable', 'output_writable']) {
      expect(names).toContain(n);
    }
    expect(pre.checks.find((c) => c.name === 'cli_version')?.detail).toContain('9.9.9');
  });

  it('preflight：CLI 未安装 → 整体失败且给出可行动信息', async () => {
    const { bridge } = makeBridge({ installed: false });
    const wp0 = await bridge.saveRawInput({ text: '任意需求文本' });
    const pre = await bridge.preflight(wp0.requestId);
    expect(pre.ok).toBe(false);
    const cli = pre.checks.find((c) => c.name === 'cli_installed');
    expect(cli?.ok).toBe(false);
    expect(cli?.detail).toMatch(/安装/);
  });

  it('preflight：认证失败 → cli_auth 不通过并转述错误', async () => {
    const { bridge } = makeBridge({ authOk: false });
    const wp0 = await bridge.saveRawInput({ text: '任意需求文本' });
    const pre = await bridge.preflight(wp0.requestId);
    const auth = pre.checks.find((c) => c.name === 'cli_auth');
    expect(auth?.ok).toBe(false);
    expect(auth?.detail).toMatch(/认证失败/);
  });

  it('不保存 API key：工作包中不存在凭据类字段名', async () => {
    const { bridge } = makeBridge();
    const wp = await registered(bridge);
    await bridge.launch(wp.requestId);
    const file = await findWorkPackageFile(bridge, wp.requestId);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    // 只检查字段名：值里出现「API key」字样属于任务卡禁止事项文案，合法。
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
    expect(keyNames.some((k) => /api[_ -]?key|apikey|token|secret|credential|password/i.test(k))).toBe(false);
    const sessionKeys = Object.keys(parsed.session).sort();
    expect(sessionKeys).toEqual(['cliVersion', 'processState', 'sessionId', 'startedAt'].sort());
  });

  it('回归 F-3：同一轮澄清问题可以连续回答', async () => {
    const { root, bridge } = makeBridge();
    const wp = await registered(bridge, '连续回答回归测试');
    await bridge.launch(wp.requestId);
    // 模拟 Agent 写回 3 个澄清问题（processing → pending_answer）
    const file = path.join(root, '.mfp', 'work', `${wp.requestId}.json`);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.questions = [
      { id: 'Q1', text: '问题一' },
      { id: 'Q2', text: '问题二' },
      { id: 'Q3', text: '问题三' },
    ];
    saved.status = 'pending_answer';
    fs.writeFileSync(file, JSON.stringify(saved));

    // 首个回答：pending_answer → processing
    const a1 = await bridge.answerQuestion(wp.requestId, 'Q1', '答案一');
    expect(a1.status).toBe('processing');
    // 同轮后续回答：processing 下继续，不再 INVALID_TRANSITION（回归点）
    const a2 = await bridge.answerQuestion(wp.requestId, 'Q2', '答案二');
    expect(a2.status).toBe('processing');
    expect(a2.questions.find((q) => q.id === 'Q2')?.answer).toBe('答案二');
    const a3 = await bridge.answerQuestion(wp.requestId, 'Q3', '答案三');
    expect(a3.questions.filter((q) => q.answer).length).toBe(3);

    // 负例：pending_review 下回答仍被拒绝
    const saved2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved2.status = 'pending_review';
    fs.writeFileSync(file, JSON.stringify(saved2));
    await expect(bridge.answerQuestion(wp.requestId, 'Q1', '再答')).rejects.toMatchObject({
      payload: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    });
  });

  it('回归 F-4：会话进程结束后 readWorkPackage 把 running 对账为 exited 并持久化', async () => {
    const { root, bridge } = makeBridge(undefined, { sessionAlive: async () => false });
    const wp = await registered(bridge, '对账回归测试');
    await bridge.launch(wp.requestId); // processState=running

    const read = await bridge.readWorkPackage(wp.requestId);
    expect(read.session.processState).toBe('exited');
    // 持久化：磁盘文件同步为 exited
    const file = path.join(root, '.mfp', 'work', `${wp.requestId}.json`);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).session.processState).toBe('exited');
  });

  it('回归 F-4：进程仍存活时保持 running；stale running 且进程已死时 launch 放行', async () => {
    // 存活 → 不对账
    const alive = makeBridge(undefined, { sessionAlive: async () => true });
    const wp1 = await registered(alive.bridge, '存活对账测试');
    await alive.bridge.launch(wp1.requestId);
    expect((await alive.bridge.readWorkPackage(wp1.requestId)).session.processState).toBe('running');

    // stale running + 进程已死：构造 pending_launch 但持久化会话状态为 running 的
    // 工作包（如上次启动中途异常落盘），launch 应对账放行而非永远 CONCURRENT_RUN
    const dead = makeBridge(undefined, { sessionAlive: async () => false });
    const wp0 = await dead.bridge.saveRawInput({ text: '陈旧状态重启测试' });
    await dead.bridge.recognize(wp0.requestId);
    await dead.bridge.register(wp0.requestId);
    const file = path.join(dead.root, '.mfp', 'work', `${wp0.requestId}.json`);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.session = { sessionId: 'stale-session-id', processState: 'running', startedAt: 't' };
    fs.writeFileSync(file, JSON.stringify(saved));

    const res = await dead.bridge.launch(wp0.requestId);
    expect(res.ok).toBe(true);
    expect(res.sessionId).toBeTruthy();
  });
});

async function findWorkPackageFile(bridge: LocalBridge, requestId: string): Promise<string> {
  // 通过 bridge.guard.root 定位（测试辅助）
  const root = (bridge as unknown as { guard: { root: string } }).guard.root;
  return path.join(root, '.mfp', 'work', `${requestId}.json`);
}
