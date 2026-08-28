import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkPackageBridge } from './work-package-bridge';
import { FileWorkPackageStore } from './file-work-package-store';
import { AdapterSessionDriver } from './session-driver';
import { PathGuard } from './path-guard';
import { ClaudeCliAdapter } from './claude-cli-adapter';
import type { RuntimeAdapter } from './runtime-adapter';
import type { RawInput, PreflightResult, PreflightCheck } from './types';

// ============================================================================
// Node 侧本地桥：文件工作包存储 + Claude Code CLI 适配器（Issue #3）。
//  - 识别：非交互模式（-p --output-format json）+ 结构化 JSON 双层校验；
//  - 会话：外部终端启动 / 恢复；恢复失败基于工作包降级为新会话；
//  - 文件为事实源，重启后仍可恢复（Issue #2）。
// 测试通过注入 FakeCliRuntimeAdapter 保持确定性（不真开终端、不调真实模型）。
// ============================================================================

export interface LocalBridgeOptions {
  root: string;
  now?: () => string;
  /** 运行时适配器；默认 ClaudeCliAdapter（真实 claude CLI）。 */
  adapter?: RuntimeAdapter;
  /** macOS 终端应用名（透传给适配器）。 */
  terminalApp?: string;
  /** 新会话 ID 生成器（测试注入确定值）。 */
  newSessionId?: () => string;
}

export class LocalBridge extends WorkPackageBridge {
  readonly guard: PathGuard;
  readonly adapter: RuntimeAdapter;

  constructor(opts: LocalBridgeOptions) {
    const now = opts.now ?? (() => new Date().toISOString());
    const guard = new PathGuard(opts.root);
    const adapter =
      opts.adapter ??
      new ClaudeCliAdapter({
        cwd: guard.root, // 非交互调用以 MFP 根目录为工作目录（项目上下文）
        platform: process.platform === 'win32' ? 'win32' : 'darwin',
        terminalApp: opts.terminalApp,
      });
    super({
      now,
      store: new FileWorkPackageStore(opts.root),
      recognizeRaw: (raw: RawInput) => adapter.recognize(raw),
      preflightRaw: (requestId: string) => runPreflight(guard, adapter, requestId),
      sessions: new AdapterSessionDriver(adapter, { root: guard.root, newSessionId: opts.newSessionId }),
    });
    this.guard = guard;
    this.adapter = adapter;
  }
}

/**
 * 启动前检查（Issue #1）：CLI 可用性与版本、认证探测、MFP 根目录、
 * 规则 / 事实源入口、任务卡可读性、输出区可写性。
 * 认证探测会发起一次最小 `-p` 调用（计费一次极小请求）。
 */
async function runPreflight(guard: PathGuard, adapter: RuntimeAdapter, requestId: string): Promise<PreflightResult> {
  const root = guard.root;
  const checks: PreflightCheck[] = [];

  checks.push({ name: 'mfp_root_exists', ok: fs.existsSync(root), detail: root });
  checks.push({ name: 'mfp_root_writable', ok: isWritable(root), detail: root });

  const availability = await adapter.checkAvailability().catch((e) => ({ installed: false, version: undefined, path: undefined, error: String(e) }));
  checks.push({
    name: 'cli_installed',
    ok: availability.installed,
    detail: availability.installed ? availability.path : '未找到 claude 可执行文件（请安装并登录 Claude Code）',
  });
  checks.push({
    name: 'cli_version',
    ok: Boolean(availability.version),
    detail: availability.version ? `claude ${availability.version}` : '无法获取版本（--version 失败）',
  });

  const auth = availability.installed ? await adapter.checkAuth().catch((e) => ({ ok: false as const, message: String(e) })) : { ok: false as const, message: 'CLI 未安装，跳过认证检查' };
  checks.push({ name: 'cli_auth', ok: auth.ok, detail: auth.ok ? '认证正常' : auth.message });

  const agents = path.join(root, 'AGENTS.md');
  const benchmark = path.join(root, 'knowledge-base', '01_事实源', 'BENCHMARK.md');
  checks.push({
    name: 'rules_entrypoints',
    ok: fs.existsSync(agents) && fs.existsSync(benchmark),
    detail: `AGENTS.md=${fs.existsSync(agents)}；BENCHMARK.md=${fs.existsSync(benchmark)}`,
  });

  // 任务卡可读性：工作包文件存在且（已登记时）任务卡非空。
  try {
    const store = new FileWorkPackageStore(root);
    const loaded = await store.load(requestId);
    if (loaded.kind === 'ok') {
      const wp = loaded.workPackage;
      const needCard = wp.status !== 'pending_recognition' && wp.status !== 'pending_confirmation';
      checks.push({
        name: 'task_card_readable',
        ok: !needCard || wp.taskCard !== null,
        detail: wp.taskCard ? `currentPhase=${wp.taskCard.currentPhase}` : needCard ? '已登记但缺少任务卡' : '尚未登记（无需任务卡）',
      });
    } else {
      checks.push({ name: 'task_card_readable', ok: false, detail: loaded.kind === 'missing' ? '工作包不存在' : `工作包 malformed：${loaded.reason}` });
    }
  } catch (e) {
    checks.push({ name: 'task_card_readable', ok: false, detail: String(e) });
  }

  const outputDir = path.join(root, 'output');
  let outputOk = false;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    outputOk = isWritable(outputDir);
  } catch {
    outputOk = false;
  }
  checks.push({ name: 'output_writable', ok: outputOk, detail: outputDir });

  return { ok: checks.every((c) => c.ok), checks };
}

function isWritable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
