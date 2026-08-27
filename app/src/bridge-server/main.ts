#!/usr/bin/env node
// ============================================================================
// MFP 桥接服务（bridge server）：Tauri 桌面壳的子进程。
//
// 架构（避免 TS/Rust 两套状态机）：
//  - 契约、状态机、工作包持久化、CLI 适配、终端启动全部在 TypeScript 桥接层
//    （src/bridge/），是唯一实现；
//  - Rust 命令层是薄代理，经本服务的行分隔 JSON-RPC 转发 MfpBridge 操作；
//  - 协议：stdin / stdout 每行一个 JSON；诊断日志只走 stderr。
//
// 请求：{"id":<n>,"method":"saveRawInput","params":{...}}
// 响应：{"id":<n>,"ok":true,"result":...}
//      {"id":<n>,"ok":false,"error":{"code","category","message","details?"}}
//
// 参数形状与前端 invoke 参数一致（Rust 侧零转换透传）：
//   saveRawInput {req} / recognize {requestId} / register {requestId} /
//   answerQuestion {requestId, questionId, answer} / submitRevision {requestId, comment} …
//
// 启动：node bridge-server.cjs --root <MFP 根目录> [--adapter claude|fake] [--terminal-app Terminal]
//   --adapter fake：确定性测试适配器（Issue #1 的 fake CLI 测试缝隙），生产默认 claude。
//
// 安全：不保存 / 不输出任何 API key 与凭据；错误消息来自桥接层可行动文案。
// ============================================================================

import * as readline from 'node:readline';
import { LocalBridge } from '../bridge/local-bridge';
import { ClaudeCliAdapter } from '../bridge/claude-cli-adapter';
import { FakeCliRuntimeAdapter } from '../bridge/fake-cli-runtime-adapter';
import { BridgeError, toErrorPayload } from '../bridge/errors';
import type { BridgeErrorPayload } from '../bridge/errors';
import type { MfpBridge, SaveRawInputRequest } from '../bridge/types';

interface RpcRequest {
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface Args {
  root: string;
  adapter: 'claude' | 'fake';
  terminalApp?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { root: process.cwd(), adapter: 'claude' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--adapter') {
      const v = argv[++i];
      if (v !== 'claude' && v !== 'fake') throw new Error(`非法 --adapter：${v}`);
      args.adapter = v;
    } else if (a === '--terminal-app') args.terminalApp = argv[++i];
  }
  if (!args.root) throw new Error('缺少 --root <MFP 根目录>');
  return args;
}

function buildBridge(args: Args): MfpBridge {
  const adapter =
    args.adapter === 'fake'
      ? new FakeCliRuntimeAdapter()
      : new ClaudeCliAdapter({ cwd: args.root, terminalApp: args.terminalApp });
  return new LocalBridge({ root: args.root, adapter });
}

type Handler = (bridge: MfpBridge, params: Record<string, unknown>) => Promise<unknown>;

const METHODS: Record<string, Handler> = {
  ping: async () => ({ ok: true, service: 'mfp-bridge-server' }),
  saveRawInput: (b, p) => b.saveRawInput(p.req as SaveRawInputRequest),
  recognize: (b, p) => b.recognize(String(p.requestId)),
  register: (b, p) => b.register(String(p.requestId)),
  listWorkPackages: (b) => b.listWorkPackages(),
  readWorkPackage: (b, p) => b.readWorkPackage(String(p.requestId)),
  preflight: (b, p) => b.preflight(String(p.requestId)),
  launch: (b, p) => b.launch(String(p.requestId)),
  resume: (b, p) => b.resume(String(p.requestId)),
  answerQuestion: (b, p) => b.answerQuestion(String(p.requestId), String(p.questionId), String(p.answer)),
  submitRevision: (b, p) => b.submitRevision(String(p.requestId), String(p.comment)),
  complete: (b, p) => b.complete(String(p.requestId)),
  archive: (b, p) => b.archive(String(p.requestId)),
};

function respond(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function errorPayload(e: unknown): BridgeErrorPayload {
  return toErrorPayload(e);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bridge = buildBridge(args);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: RpcRequest;
    try {
      req = JSON.parse(trimmed) as RpcRequest;
    } catch (e) {
      respond({ id: null, ok: false, error: { code: 'INVALID_ARGUMENT', category: 'argument', message: `非法请求行：${(e as Error).message}` } });
      return;
    }
    const handler = METHODS[req.method];
    if (!handler) {
      respond({ id: req.id ?? null, ok: false, error: { code: 'INVALID_ARGUMENT', category: 'argument', message: `未知方法：${req.method}` } });
      return;
    }
    handler(bridge, req.params ?? {})
      .then((result) => respond({ id: req.id ?? null, ok: true, result }))
      .catch((e) => {
        const payload = errorPayload(e);
        // 只输出可行动消息与分类；不输出请求细节，避免任何敏感内容进日志。
        if (!(e instanceof BridgeError)) process.stderr.write(`[mfp-bridge] ${payload.message}\n`);
        respond({ id: req.id ?? null, ok: false, error: payload });
      });
  });
  rl.on('close', () => {
    process.exit(0);
  });
  process.stderr.write(`[mfp-bridge] ready root=${args.root} adapter=${args.adapter}\n`);
}

main().catch((e) => {
  process.stderr.write(`[mfp-bridge] 启动失败：${(e as Error).message}\n`);
  process.exit(1);
});
