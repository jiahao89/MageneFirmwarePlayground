import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BridgeError } from './errors';
import { runProcess } from './process-runner';
import { parseRecognitionText } from './validate';
import { isPlainObject } from './util';
import { executeLaunchPlan } from './terminal-launcher';
import type { TerminalLauncherOptions } from './terminal-launcher';
import type {
  RuntimeAdapter,
  CliAvailability,
  AuthCheck,
  StartSessionSpec,
  StartSessionResult,
} from './runtime-adapter';
import type { RawInput, RecognitionResult } from './types';

// ============================================================================
// Claude Code CLI 适配器（MVP 唯一运行时适配器，Issue #3）。
//
// 安全约束（Issue #1 / #3）：
//  - 所有调用经参数数组（runProcess，shell:false）；用户文本经 -p stdin 或启动
//    文件传递，绝不拼入 shell 命令。
//  - 不保存 API key / 凭据：认证归 Claude Code 自身管理，本适配器只转述
//    CLI 返回的认证错误；会话元数据只记录 sessionId / 版本 / 时间 / 状态。
//  - resume 前检查本地会话文件（~/.claude/projects/…），缺失则降级为基于
//    工作包的新会话（返回 fallback: true）。
// ============================================================================

export interface ClaudeCliAdapterOptions {
  /** claude 可执行文件名或绝对路径（默认 'claude'）。 */
  cliPath?: string;
  /** HOME 目录（默认 os.homedir()；测试可注入临时目录）。 */
  homeDir?: string;
  /** 识别等非交互调用的工作目录（默认 process.cwd()；生产应设为 MFP 根目录，让 CLI 读到项目上下文）。 */
  cwd?: string;
  /** 目标平台（默认 process.platform）。 */
  platform?: 'darwin' | 'win32';
  /** macOS 终端应用名。 */
  terminalApp?: string;
  /** 会话启动执行器（测试可注入以捕获 LaunchPlan，不真正开终端）。 */
  launch?: typeof executeLaunchPlan;
  /** 认证探测超时（默认 60s）。 */
  authProbeTimeoutMs?: number;
  /** 会话种子调用超时（默认 90s：一次最小 -p 调用）。 */
  seedTimeoutMs?: number;
  /** 识别超时（默认 300s：识别属于真实模型调用）。 */
  recognizeTimeoutMs?: number;
}

/** 识别提示词：要求只输出符合 RecognitionResult 结构的 JSON。 */
export function buildRecognitionPrompt(raw: RawInput): string {
  return [
    '你是固件需求识别器。请阅读下面的原始需求文本，只输出一个 JSON 对象（不要输出任何其他内容、不要 Markdown 代码块），字段如下：',
    '- category: feature_request | bug | consultation | research | invalid | duplicate_candidate',
    '- rewrittenRequirement: 改写为可执行的功能需求（一句话）',
    '- user: 目标用户（不确定写「待确认」）',
    '- scenario: 使用场景（不确定写「未明确」）',
    '- goal: 用户目标',
    '- scopeClues: 范围线索（字符串数组，可为空）',
    '- knownConstraints: 已知约束（字符串数组，可为空）',
    '- missingInformation: 缺失信息（字符串数组）',
    '- evidence: 证据引用（数组，元素 {kind: "file"|"external", ref, note?}；无证据给空数组，严禁编造）',
    '- duplicateCandidates: 疑似重复需求（字符串数组，可为空）',
    '- confidence: 0 到 1 的数字',
    '',
    `来源说明：${raw.sourceDescription ?? '（未提供）'}`,
    '原始需求文本：',
    raw.text,
  ].join('\n');
}

/** CLI 错误文本中的认证类错误特征。 */
export function looksLikeAuthError(text: string): boolean {
  return /auth|api[_ -]?key|login|log in|credential|unauthorized|forbidden|401|403|登录|认证|鉴权|密钥/i.test(text);
}

/** 解析 `claude --version` 输出中的语义化版本号。 */
export function parseClaudeVersion(stdout: string): string | undefined {
  const m = stdout.match(/(\d+\.\d+\.\d+)/);
  return m?.[1];
}

/** Claude Code 会话目录名规则：工作目录中非字母数字字符替换为 `-`。 */
export function sanitizeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

interface ClaudeResultEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
}

export class ClaudeCliAdapter implements RuntimeAdapter {
  private readonly cliPath: string;
  private readonly homeDir: string;
  private readonly cwd: string;
  private readonly platform: 'darwin' | 'win32';
  private readonly terminalApp?: string;
  private readonly launch: typeof executeLaunchPlan;
  private readonly authProbeTimeoutMs: number;
  private readonly seedTimeoutMs: number;
  private readonly recognizeTimeoutMs: number;

  constructor(opts?: ClaudeCliAdapterOptions) {
    this.cliPath = opts?.cliPath ?? 'claude';
    this.homeDir = opts?.homeDir ?? os.homedir();
    this.cwd = opts?.cwd ?? process.cwd();
    this.platform = opts?.platform ?? (process.platform === 'win32' ? 'win32' : 'darwin');
    this.terminalApp = opts?.terminalApp;
    this.launch = opts?.launch ?? executeLaunchPlan;
    this.authProbeTimeoutMs = opts?.authProbeTimeoutMs ?? 60_000;
    this.seedTimeoutMs = opts?.seedTimeoutMs ?? 90_000;
    this.recognizeTimeoutMs = opts?.recognizeTimeoutMs ?? 300_000;
  }

  async checkAvailability(): Promise<CliAvailability> {
    const found = this.findBinary();
    if (!found) return { installed: false };
    try {
      const res = await runProcess({
        command: found,
        args: ['--version'],
        cwd: this.homeDir,
        timeoutMs: 15_000,
      });
      if (res.code !== 0) return { installed: false, path: found };
      return { installed: true, path: found, version: parseClaudeVersion(res.stdout) };
    } catch {
      return { installed: false, path: found };
    }
  }

  async checkAuth(): Promise<AuthCheck> {
    const bin = this.findBinary();
    if (!bin) return { ok: false, message: '未找到 claude 可执行文件（CLI_NOT_FOUND）' };
    try {
      const res = await runProcess({
        command: bin,
        args: ['-p', '--output-format', 'json'],
        cwd: this.homeDir,
        input: 'Reply with exactly: ok',
        timeoutMs: this.authProbeTimeoutMs,
      });
      const combined = `${res.stdout}\n${res.stderr}`;
      if (res.code === 0) {
        const envelope = tryParseEnvelope(res.stdout);
        if (envelope && envelope.is_error) {
          return { ok: false, message: extractErrorText(envelope, combined) };
        }
        return { ok: true };
      }
      return {
        ok: false,
        message: looksLikeAuthError(combined)
          ? `Claude Code 认证失败：${firstLine(res.stderr) || firstLine(res.stdout) || `exit ${res.code}`}`
          : `Claude Code 探测失败（exit ${res.code}）：${firstLine(res.stderr) || firstLine(res.stdout)}`,
      };
    } catch (e) {
      const be = e as BridgeError;
      return { ok: false, message: be?.payload?.message ?? String(e) };
    }
  }

  async recognize(raw: RawInput): Promise<RecognitionResult> {
    const bin = this.findBinary();
    if (!bin) throw new BridgeError('CLI_NOT_FOUND', '未找到 claude 可执行文件');
    // 用户文本经 stdin 传入（-p 无位置参数时读取 stdin），不进命令行。
    // 工作目录用 MFP 根目录，让 CLI 能读到 AGENTS.md / 知识库等项目上下文。
    const res = await runProcess({
      command: bin,
      args: ['-p', '--output-format', 'json'],
      cwd: this.cwd,
      input: buildRecognitionPrompt(raw),
      timeoutMs: this.recognizeTimeoutMs,
    });
    if (res.code !== 0) {
      const combined = `${res.stdout}\n${res.stderr}`;
      if (looksLikeAuthError(combined)) {
        throw new BridgeError('CLI_AUTH_FAILED', `识别失败：Claude Code 认证错误（${firstLine(res.stderr)}）`);
      }
      throw new BridgeError('MALFORMED_OUTPUT', `识别进程异常退出（exit ${res.code}）：${firstLine(res.stderr)}`);
    }
    return parseEnvelopeToRecognition(res.stdout);
  }

  async startSession(spec: StartSessionSpec): Promise<StartSessionResult> {
    const bin = this.findBinary();
    if (!bin) throw new BridgeError('CLI_NOT_FOUND', '未找到 claude 可执行文件');

    let fallback = false;
    let note: string | undefined;
    let lastError: { code: string; message: string } | undefined;
    let resumeSessionId: string | undefined = spec.resumeSessionId;

    if (spec.mode === 'resume' && spec.resumeSessionId) {
      const sessionFile = this.sessionFilePath(spec.resumeSessionId, spec.cwd);
      if (fs.existsSync(sessionFile)) {
        // 会话文件存在：transcript 已落盘，--resume 可直接恢复。
      } else {
        // resume 失败 → 基于工作包创建新会话（启动指令已由桥接层换成降级版）。
        fallback = true;
        note = `会话 ${spec.resumeSessionId} 无法恢复（会话文件不存在），已基于工作包创建新会话`;
        lastError = { code: 'SESSION_NOT_FOUND', message: note };
        resumeSessionId = undefined; // 落入「新建会话」流程
      }
    }

    let sessionId: string;
    if (resumeSessionId) {
      sessionId = resumeSessionId;
    } else {
      // 新建会话（Issue #6 验收 F-2 修复）：claude 2.1.229 中交互模式 + --session-id
      // 的 transcript 不落盘，--resume 会报 "No conversation found"（实测）。
      // 改为：先用一次最小 -p 调用建立会话（envelope.session_id 真实落盘，
      // 已实测验证），再在终端用 --resume 接续交互并处理启动指令。
      sessionId = await this.seedConversation(bin, spec);
    }

    // 启动指令写入受控文件；终端命令只引用文件路径，不内联长文本。
    fs.mkdirSync(path.dirname(spec.startupFile), { recursive: true });
    fs.writeFileSync(spec.startupFile, spec.startupInstruction, 'utf8');

    await this.launch(this.platform, { ...spec, mode: 'resume', resumeSessionId: sessionId }, bin, this.launcherOptions());

    return { sessionId, fallback, note, lastError };
  }

  /**
   * 用最小 `-p` 调用建立可恢复的会话，返回真实（已落盘）的 session id。
   * 种子提示只含受控文本（sessionName 由 requestId 派生），不含用户原文；
   * 认证 / CLI 错误在此提前暴露（打开终端之前）。
   */
  private async seedConversation(bin: string, spec: StartSessionSpec): Promise<string> {
    const res = await runProcess({
      command: bin,
      args: ['-p', '--output-format', 'json'],
      cwd: spec.cwd,
      input: `MFP 会话初始化锚点（${spec.sessionName}）。请只回复四个字：已就绪。不要使用任何工具。`,
      timeoutMs: this.seedTimeoutMs,
    });
    if (res.code !== 0) {
      const combined = `${res.stdout}\n${res.stderr}`;
      if (looksLikeAuthError(combined)) {
        throw new BridgeError('CLI_AUTH_FAILED', `启动会话失败：Claude Code 认证错误（${firstLine(res.stderr)}）`);
      }
      throw new BridgeError('MALFORMED_OUTPUT', `启动会话失败（exit ${res.code}）：${firstLine(res.stderr)}`);
    }
    const envelope = tryParseEnvelope(res.stdout);
    if (!envelope || envelope.type !== 'result' || envelope.is_error) {
      throw new BridgeError('MALFORMED_OUTPUT', `启动会话失败：无法解析会话信封（${firstLine(res.stdout)}）`);
    }
    if (typeof envelope.session_id !== 'string' || envelope.session_id.length === 0) {
      throw new BridgeError('MALFORMED_OUTPUT', '启动会话失败：会话信封缺少 session_id');
    }
    return envelope.session_id;
  }

  /** 会话文件路径：~/.claude/projects/<cwd 非字母数字转 ->/<uuid>.jsonl。 */
  sessionFilePath(sessionId: string, cwd: string): string {
    return path.join(this.homeDir, '.claude', 'projects', sanitizeProjectDir(cwd), `${sessionId}.jsonl`);
  }

  private launcherOptions(): TerminalLauncherOptions {
    return this.terminalApp ? { terminalApp: this.terminalApp } : {};
  }

  /** 在 PATH 中查找 claude 可执行文件；找不到返回 undefined。 */
  private findBinary(): string | undefined {
    if (this.cliPath.includes('/') || this.cliPath.includes('\\')) {
      return fs.existsSync(this.cliPath) ? this.cliPath : undefined;
    }
    const isWin = this.platform === 'win32';
    const pathEnv = process.env.PATH ?? '';
    const dirs = pathEnv.split(isWin ? ';' : ':').filter(Boolean);
    const candidates = isWin ? [`${this.cliPath}.exe`, `${this.cliPath}.cmd`, this.cliPath] : [this.cliPath];
    for (const dir of dirs) {
      for (const name of candidates) {
        const full = path.join(dir, name);
        try {
          fs.accessSync(full, fs.constants.X_OK);
          return full;
        } catch {
          /* continue */
        }
      }
    }
    return undefined;
  }
}

function tryParseEnvelope(stdout: string): ClaudeResultEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isPlainObject(parsed) ? (parsed as ClaudeResultEnvelope) : undefined;
  } catch {
    return undefined;
  }
}

/** 解析 `-p --output-format json` 信封 → 内层识别结果（双层校验）。 */
export function parseEnvelopeToRecognition(stdout: string): RecognitionResult {
  const envelope = tryParseEnvelope(stdout);
  if (!envelope || envelope.type !== 'result') {
    throw new BridgeError('MALFORMED_OUTPUT', `Claude Code 输出不是合法 result 信封：${firstLine(stdout)}`);
  }
  if (envelope.is_error) {
    throw new BridgeError('MALFORMED_OUTPUT', `Claude Code 识别返回错误：${extractErrorText(envelope, stdout)}`);
  }
  if (typeof envelope.result !== 'string') {
    throw new BridgeError('MALFORMED_OUTPUT', 'Claude Code result 信封缺少 result 文本字段');
  }
  return parseRecognitionText(stripCodeFence(envelope.result));
}

/** 容错：模型偶尔把 JSON 包在 ```json 代码块里。 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : trimmed;
}

function extractErrorText(envelope: ClaudeResultEnvelope, fallback: string): string {
  return typeof envelope.result === 'string' && envelope.result.length > 0 ? firstLine(envelope.result) : firstLine(fallback);
}

function firstLine(text: string): string {
  return (text ?? '').trim().split('\n')[0]?.trim() ?? '';
}
