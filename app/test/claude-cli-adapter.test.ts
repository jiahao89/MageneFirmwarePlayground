import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ClaudeCliAdapter,
  parseClaudeVersion,
  parseEnvelopeToRecognition,
  stripCodeFence,
  looksLikeAuthError,
  sanitizeProjectDir,
  buildRecognitionPrompt,
  BridgeError,
} from '../src/bridge/node';
import type { LaunchPlan, StartSessionSpec } from '../src/bridge/node';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, 'fixtures', 'fake-claude.mjs');

let tmp: string;
let wrapper: string;
let homeDir: string;
let savedPath: string | undefined;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-claude-adapter-'));
  homeDir = path.join(tmp, 'home');
  fs.mkdirSync(homeDir, { recursive: true });

  // POSIX shell 包装器：让适配器以 `claude` 形式 spawn（node fixture "$@"）。
  const binDir = path.join(tmp, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  wrapper = path.join(binDir, 'claude');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`, 'utf8');
  fs.chmodSync(wrapper, 0o755);

  savedPath = process.env.PATH;
  process.env.PATH = `${binDir}:${savedPath}`;
});

afterAll(() => {
  process.env.PATH = savedPath;
  delete process.env.FAKE_CLAUDE_AUTH_FAIL;
  delete process.env.FAKE_CLAUDE_BAD_ENVELOPE;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeAdapter(overrides?: Record<string, unknown>) {
  const plans: LaunchPlan[] = [];
  const adapter = new ClaudeCliAdapter({
    cliPath: wrapper,
    homeDir,
    platform: 'darwin',
    launch: async (_p, _spec, _bin, _o) => {
      plans.push({ command: 'captured', args: [], description: 'captured' });
      return { command: 'captured', args: [], description: 'captured' };
    },
    ...overrides,
  });
  return { adapter, plans };
}

describe('ClaudeCliAdapter（Issue #3）', () => {
  it('PATH 扫描找到 claude 并解析版本', async () => {
    const adapter = new ClaudeCliAdapter({ homeDir }); // 默认 'claude'，走 PATH
    const availability = await adapter.checkAvailability();
    expect(availability.installed).toBe(true);
    expect(availability.version).toBe('2.1.229');
    expect(availability.path).toBe(wrapper);
  });

  it('CLI 缺失 → installed:false（CLI_NOT_FOUND 语义）', async () => {
    const adapter = new ClaudeCliAdapter({ cliPath: path.join(tmp, 'does-not-exist', 'claude'), homeDir });
    const availability = await adapter.checkAvailability();
    expect(availability.installed).toBe(false);
    await expect(adapter.recognize({ rawInputId: 'r', text: 'x', createdAt: 't' })).rejects.toThrowError(BridgeError);
  });

  it('认证探测成功', async () => {
    const { adapter } = makeAdapter();
    const auth = await adapter.checkAuth();
    expect(auth.ok).toBe(true);
  });

  it('认证失败 → ok:false 且转述 CLI 错误（不保存凭据）', async () => {
    process.env.FAKE_CLAUDE_AUTH_FAIL = '1';
    try {
      const { adapter } = makeAdapter();
      const auth = await adapter.checkAuth();
      expect(auth.ok).toBe(false);
      if (!auth.ok) expect(auth.message).toMatch(/认证失败/);
    } finally {
      delete process.env.FAKE_CLAUDE_AUTH_FAIL;
    }
  });

  it('识别：信封 + 内层结构双层校验', async () => {
    const { adapter } = makeAdapter();
    const rec = await adapter.recognize({ rawInputId: 'r', text: '希望支持爬坡规划', createdAt: 't' });
    expect(rec.category).toBe('feature_request');
    expect(typeof rec.rewrittenRequirement).toBe('string');
  });

  it('识别时认证失败 → CLI_AUTH_FAILED', async () => {
    process.env.FAKE_CLAUDE_AUTH_FAIL = '1';
    try {
      const { adapter } = makeAdapter();
      await expect(adapter.recognize({ rawInputId: 'r', text: 'x', createdAt: 't' })).rejects.toMatchObject({
        payload: expect.objectContaining({ code: 'CLI_AUTH_FAILED' }),
      });
    } finally {
      delete process.env.FAKE_CLAUDE_AUTH_FAIL;
    }
  });

  it('malformed 信封 → MALFORMED_OUTPUT', async () => {
    process.env.FAKE_CLAUDE_BAD_ENVELOPE = '1';
    try {
      const { adapter } = makeAdapter();
      await expect(adapter.recognize({ rawInputId: 'r', text: 'x', createdAt: 't' })).rejects.toMatchObject({
        payload: expect.objectContaining({ code: 'MALFORMED_OUTPUT' }),
      });
    } finally {
      delete process.env.FAKE_CLAUDE_BAD_ENVELOPE;
    }
  });

  it('startSession(new)：写启动文件并调用终端执行器', async () => {
    const { adapter } = makeAdapter();
    const spec = makeSpec({ mode: 'new' });
    const result = await adapter.startSession(spec);
    expect(result.sessionId).toBe(spec.sessionId);
    expect(result.fallback).toBe(false);
    expect(fs.readFileSync(spec.startupFile, 'utf8')).toContain('AGENTS.md');
  });

  it('startSession(resume)：会话文件存在 → 恢复原会话', async () => {
    const { adapter } = makeAdapter();
    const cwd = path.join(tmp, 'mfp-root');
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const sessionFile = adapter.sessionFilePath(sessionId, cwd);
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, '{}');

    const spec = makeSpec({ mode: 'resume', resumeSessionId: sessionId, cwd });
    const result = await adapter.startSession(spec);
    expect(result.sessionId).toBe(sessionId);
    expect(result.fallback).toBe(false);
  });

  it('startSession(resume)：会话文件缺失 → 降级为新会话（基于工作包）', async () => {
    const { adapter } = makeAdapter();
    const cwd = path.join(tmp, 'mfp-root-2');
    const spec = makeSpec({
      mode: 'resume',
      resumeSessionId: 'missing-session-id',
      cwd,
      sessionId: 'new-fallback-id',
      startupInstruction: '（降级启动指令）请从工作包续接。',
    });
    const result = await adapter.startSession(spec);
    expect(result.sessionId).toBe('new-fallback-id');
    expect(result.fallback).toBe(true);
    expect(result.lastError?.code).toBe('SESSION_NOT_FOUND');
    // 降级时启动文件使用降级指令
    expect(fs.readFileSync(spec.startupFile, 'utf8')).toContain('降级启动指令');
  });

  it('会话元数据不含任何凭据字段（不保存 API key）', async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.startSession(makeSpec({ mode: 'new' }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/api[_ -]?key|token|secret|credential/i);
    expect(Object.keys(result).sort()).toEqual(['fallback', 'lastError', 'note', 'sessionId'].sort());
  });
});

describe('纯函数：版本/信封/错误分类', () => {
  it('parseClaudeVersion', () => {
    expect(parseClaudeVersion('2.1.229 (Claude Code)')).toBe('2.1.229');
    expect(parseClaudeVersion('no version here')).toBeUndefined();
  });

  it('looksLikeAuthError', () => {
    expect(looksLikeAuthError('Invalid API key')).toBe(true);
    expect(looksLikeAuthError('401 unauthorized')).toBe(true);
    expect(looksLikeAuthError('登录已过期')).toBe(true);
    expect(looksLikeAuthError('segfault')).toBe(false);
  });

  it('stripCodeFence', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });

  it('parseEnvelopeToRecognition：is_error / 缺 result / 正常', () => {
    expect(() => parseEnvelopeToRecognition('{"type":"result","is_error":true,"result":"boom"}')).toThrow(/错误/);
    expect(() => parseEnvelopeToRecognition('{"type":"result","is_error":false}')).toThrow(/缺少 result/);
    const inner = JSON.stringify({
      category: 'bug',
      rewrittenRequirement: 'x',
      user: 'u',
      scenario: 's',
      goal: 'g',
      scopeClues: [],
      knownConstraints: [],
      missingInformation: [],
      evidence: [],
      duplicateCandidates: [],
      confidence: 0.5,
    });
    const rec = parseEnvelopeToRecognition(JSON.stringify({ type: 'result', is_error: false, result: inner }));
    expect(rec.category).toBe('bug');
  });

  it('sanitizeProjectDir 与 Claude Code 会话目录规则一致', () => {
    expect(sanitizeProjectDir('/Users/jacko/Projects/MFP')).toBe('-Users-jacko-Projects-MFP');
    expect(sanitizeProjectDir('/a b/c.d')).toBe('-a-b-c-d');
  });

  it('buildRecognitionPrompt 包含 schema 字段与原文', () => {
    const prompt = buildRecognitionPrompt({ rawInputId: 'r', text: '原始文本ABC', sourceDescription: '来源XYZ', createdAt: 't' });
    expect(prompt).toContain('category');
    expect(prompt).toContain('原始文本ABC');
    expect(prompt).toContain('来源XYZ');
  });
});

function makeSpec(overrides: Partial<StartSessionSpec>): StartSessionSpec {
  const base: StartSessionSpec = {
    cwd: path.join(tmp, 'mfp-root'),
    sessionId: 'sid-new-1',
    mode: 'new',
    sessionName: 'MFP · REQ-1',
    startupInstruction: '启动指令：读取 AGENTS.md 与工作包。',
    startupFile: path.join(tmp, 'startup', 'REQ-1.startup.txt'),
  };
  return { ...base, ...overrides };
}
