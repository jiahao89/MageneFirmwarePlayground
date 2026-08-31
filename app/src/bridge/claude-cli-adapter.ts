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
  /** 首轮超时后等待 transcript 落盘的兜底发现超时（默认 20s；测试可调短）。 */
  discoverTimeoutMs?: number;
  /** 识别超时（默认 300s：单次模型调用，无工具循环）。 */
  recognizeTimeoutMs?: number;
  /**
   * Agent 轮超时（默认 900s）：首轮与继续轮是完整 Agent 循环（读规则/
   * 工作包/事实源 + 多次工具调用 + 写回），实测首轮约 5 分钟以上，
   * 必须显著长于识别超时（发布验证：300s 会在 Agent 写回中途被 kill）。
   */
  agentTurnTimeoutMs?: number;
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

/**
 * 在 PATH 内容中定位 CLI 可执行文件（纯函数，跨平台可测）：
 *  - win32：`;` 分隔，候选 `<name>.exe` / `<name>.cmd` / `<name>`
 *  - 其他：`:` 分隔，候选 `<name>`
 */
export function resolveBinaryPath(cliPath: string, pathEnv: string, platform: 'darwin' | 'win32'): string | undefined {
  const isWin = platform === 'win32';
  if (cliPath.includes('/') || cliPath.includes('\\')) {
    return fs.existsSync(cliPath) ? cliPath : undefined;
  }
  const dirs = pathEnv.split(isWin ? ';' : ':').filter(Boolean);
  const candidates = isWin ? [`${cliPath}.exe`, `${cliPath}.cmd`, cliPath] : [cliPath];
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
  private readonly discoverTimeoutMs: number;
  private readonly recognizeTimeoutMs: number;
  private readonly agentTurnTimeoutMs: number;

  constructor(opts?: ClaudeCliAdapterOptions) {
    this.cliPath = opts?.cliPath ?? 'claude';
    this.homeDir = opts?.homeDir ?? os.homedir();
    this.cwd = opts?.cwd ?? process.cwd();
    this.platform = opts?.platform ?? (process.platform === 'win32' ? 'win32' : 'darwin');
    this.terminalApp = opts?.terminalApp;
    this.launch = opts?.launch ?? executeLaunchPlan;
    this.authProbeTimeoutMs = opts?.authProbeTimeoutMs ?? 60_000;
    this.discoverTimeoutMs = opts?.discoverTimeoutMs ?? 20_000;
    this.recognizeTimeoutMs = opts?.recognizeTimeoutMs ?? 300_000;
    this.agentTurnTimeoutMs = opts?.agentTurnTimeoutMs ?? 900_000;
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
        // 会话文件存在：先跑「继续轮」（headless，让 Agent 读到 PM 的新回答/
        // 修改意见并推进到下一暂停点），再打开终端供 PM 查看与介入。
        await this.runContinueTurn(bin, spec.resumeSessionId, spec.cwd);
      } else {
        // resume 失败 → 基于工作包创建新会话（启动指令已由桥接层换成降级版）。
        fallback = true;
        note = `会话 ${spec.resumeSessionId} 无法恢复（会话文件不存在），已基于工作包创建新会话`;
        lastError = { code: 'SESSION_NOT_FOUND', message: note };
        resumeSessionId = undefined; // 落入「新建会话」流程
      }
    }

    // 启动指令写入受控文件（审计留痕）；终端命令只引用文件路径，不内联长文本。
    fs.mkdirSync(path.dirname(spec.startupFile), { recursive: true });
    fs.writeFileSync(spec.startupFile, spec.startupInstruction, 'utf8');

    if (resumeSessionId) {
      // 单终端策略：已有进程挂载该会话（此前打开的终端）则不再重复打开，
      // 避免多个 claude 进程并发续跑同一会话（发布验证实测）。PM 关闭旧终端
      // 后再次 resume 会重新打开，获得包含最新 headless 轮的完整视图。
      if (!(await this.sessionProcessAlive(resumeSessionId))) {
        await this.launch(this.platform, { ...spec, mode: 'resume', resumeSessionId }, bin, this.launcherOptions());
      }
      return { sessionId: resumeSessionId, fallback, note, lastError };
    }

    // 新建会话（Issue #6 发布验证 v2）：首轮即 headless。
    //  - 交互模式（无论 --session-id / --name / 位置参数如何组合）在 claude 2.1.229
    //    中 transcript 均不落盘（实测：带位置参数的交互会话功能正常但永不持久化，
    //    会话不可恢复）；只有 -p 调用的 transcript 稳定落盘且 --resume 可接续（实测）。
    //  - 因此首轮用 -p 直接执行完整启动指令：Agent 真实读取工作包并写回澄清问题/
    //    产出，envelope.session_id 即真实 sessionId；
    //  - 之后终端仅以 --resume 挂载同一会话，供 PM 查看与介入（交互 resume 会话
    //    正常持久化，实测）。
    const before = this.listSessionFiles(spec.cwd);
    let sessionId: string;
    try {
      sessionId = await this.runFirstTurn(bin, spec);
    } catch (e) {
      // 仅超时走兜底：transcript 可能已落盘（runProcess 超时会 kill 子进程），
      // 按 requestId 标记从新增会话文件中恢复 sessionId，会话仍可接续。
      // 认证 / CLI / 输出错误立即上抛（终端不打开）。
      if (!(e instanceof BridgeError) || e.payload?.code !== 'CLI_TIMEOUT') throw e;
      const discovered = await this.discoverSessionId(spec.cwd, before, this.discoveryMarker(spec));
      if (!discovered) throw e;
      sessionId = discovered;
      note = note ?? '首轮指令未在超时内完成，已从落盘会话文件恢复会话标识；Agent 可能处于中间状态，请检查工作包';
    }

    await this.launch(this.platform, { ...spec, mode: 'resume', resumeSessionId: sessionId }, bin, this.launcherOptions());
    return { sessionId, fallback, note, lastError };
  }

  /**
   * 会话进程存活探测（单终端策略用）：匹配命令行同时含 claude 与 sessionId
   * 的进程（此前打开的终端）。headless 轮结束后 -p 进程已退出，正常只匹配终端。
   * Windows 真机验证前保守返回 false（总是开终端）。
   */
  private async sessionProcessAlive(sessionId: string): Promise<boolean> {
    if (this.platform === 'win32') return false;
    try {
      const res = await runProcess({
        command: 'pgrep',
        args: ['-f', `claude.*${sessionId}`],
        cwd: this.homeDir,
        timeoutMs: 5_000,
      });
      return res.code === 0;
    } catch {
      return false;
    }
  }

  /**
   * 首轮：headless 执行完整启动指令，返回真实（已落盘）的 session id。
   * 指令为受控模板（含 requestId 派生内容），经 stdin 传入，不进命令行；
   * 认证 / CLI 错误在打开终端之前暴露。
   */
  private async runFirstTurn(bin: string, spec: StartSessionSpec): Promise<string> {
    const res = await runProcess({
      command: bin,
      args: ['-p', '--output-format', 'json'],
      cwd: spec.cwd,
      input: spec.startupInstruction,
      timeoutMs: this.agentTurnTimeoutMs,
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

  /** 发现标记：sessionName「MFP · REQ-x」中的 requestId（启动指令文本必含，受控派生）。 */
  private discoveryMarker(spec: StartSessionSpec): string {
    const parts = spec.sessionName.split('·');
    const requestId = parts[parts.length - 1]?.trim();
    return requestId && requestId.length > 0 ? requestId : spec.sessionName;
  }

  /** 继续轮：headless 推进既有会话到下一暂停点（提示为受控模板，不含用户原文）。 */
  private async runContinueTurn(bin: string, sessionId: string, cwd: string): Promise<void> {
    const prompt = [
      'MFP 工作台继续指令：PM 已在 Web 端更新了澄清问题回答或修改意见。',
      '请重新读取当前目录下工作包 JSON（.mfp/work/ 对应文件）中的最新内容，',
      '按任务卡（taskCard）继续工作，直到下一个暂停点（新澄清问题 / 待审阅产出 / 完成），',
      '把结果写回工作包后停止。不要询问确认，直接执行。',
    ].join('\n');
    const res = await runProcess({
      command: bin,
      args: ['-p', '--output-format', 'json', '--resume', sessionId],
      cwd,
      input: prompt,
      timeoutMs: this.agentTurnTimeoutMs,
    });
    if (res.code !== 0) {
      const combined = `${res.stdout}\n${res.stderr}`;
      if (looksLikeAuthError(combined)) {
        throw new BridgeError('CLI_AUTH_FAILED', `恢复会话失败：Claude Code 认证错误（${firstLine(res.stderr)}）`);
      }
      throw new BridgeError('MALFORMED_OUTPUT', `恢复会话失败（exit ${res.code}）：${firstLine(res.stderr)}`);
    }
  }

  /** 列出当前 cwd 对应 projects 目录下已有的会话文件（首轮前快照，兜底发现用）。 */
  private listSessionFiles(cwd: string): Set<string> {
    const dir = this.projectsDir(cwd);
    try {
      return new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')));
    } catch {
      return new Set();
    }
  }

  /** 轮询发现首轮后新增的会话文件；内容须含 requestId 标记以精确匹配（兜底路径）。 */
  private async discoverSessionId(cwd: string, before: Set<string>, marker: string): Promise<string | undefined> {
    const dir = this.projectsDir(cwd);
    const deadline = Date.now() + this.discoverTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(500);
      try {
        const candidates = fs.readdirSync(dir)
          .filter((f) => f.endsWith('.jsonl') && !before.has(f))
          .map((f) => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        for (const candidate of candidates) {
          try {
            // sessionName 可能写在 transcript 后段；只读尾部避免在大文件上全量扫描。
            const full = path.join(dir, candidate.file);
            const stat = fs.statSync(full);
            const fd = fs.openSync(full, 'r');
            const size = Math.min(stat.size, 256 * 1024);
            const buffer = Buffer.alloc(size);
            fs.readSync(fd, buffer, 0, size, Math.max(0, stat.size - size));
            fs.closeSync(fd);
            if (buffer.toString('utf8').includes(marker)) return candidate.file.replace(/\.jsonl$/, '');
          } catch {
            /* 文件正在写入，跳过 */
          }
        }
      } catch {
        /* 目录尚未创建，继续轮询 */
      }
    }
    return undefined;
  }

  private projectsDir(cwd: string): string {
    return path.join(this.homeDir, '.claude', 'projects', sanitizeProjectDir(cwd));
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
    return resolveBinaryPath(this.cliPath, process.env.PATH ?? '', this.platform);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
