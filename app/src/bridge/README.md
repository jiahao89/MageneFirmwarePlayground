# 本地桥接契约（Bridge Contract）

Issue #1 定义的「最高测试缝隙」—— Web UI 与本地桥接层之间的公共操作面。本文档是
契约的唯一事实来源，Web UI、Node LocalBridge、Tauri Rust 命令层三者都必须对齐。

## 入口

- `index.ts`：浏览器安全入口（类型 + 错误 + 确定性 mock），Web UI 从这里 import。
- `node.ts`：Node 入口（附加路径安全、并发保护、进程启动、LocalBridge），测试从这里 import。

## 公共操作面（`MfpBridge`）

| 操作 | 签名 | 说明 | 归属 Issue |
|---|---|---|---|
| `saveRawInput` | `(req) => RawInput` | 先存原始文本再处理，失败不丢源 | #7 |
| `recognize` | `(rawInputId) => RecognitionResult` | 结构化识别（分类/重写/缺失信息/证据） | #3 接入真实 CLI |
| `register` | `(rawInputId) => WorkPackage` | PM 确认后建立正式工作包 | #2 |
| `preflight` | `(requestId) => PreflightResult` | 启动前检查根目录可读写、CLI 可用 | #3 |
| `launch` | `(requestId) => LaunchResult` | 打开终端启动会话（含并发保护） | #3 |
| `resume` | `(requestId) => LaunchResult` | 恢复已有会话 | #3 |
| `readWorkPackage` | `(requestId) => WorkPackage` | 读工作包（问题/状态/输出） | #2 |
| `answerQuestion` | `(requestId, questionId, answer) => WorkPackage` | PM 回答澄清问题 | #2 |
| `submitRevision` | `(requestId, comment) => WorkPackage` | 提交修改意见 | #2 |
| `complete` | `(requestId) => WorkPackage` | PM 显式确认完成 | #2 |

## 类型（`types.ts`）

- `RequestStatus`：状态机（`pending_recognition` → … → `completed` / `archived` / `error`）。
- `RawInput` / `RecognitionResult` / `WorkPackage` / `SessionMetadata` / `RunRecord`。

## 错误模型（`errors.ts`）

统一 `BridgeError { payload: { code, category, message, details } }`。

| code | category | 语义 |
|---|---|---|
| `INVALID_PATH` | path | 路径越出 MFP 根目录（穿越/绝对/符号链接） |
| `CONCURRENT_RUN` | concurrency | 同一请求重复并发运行 |
| `MALFORMED_STATE` | state | 工作包/状态非法（保留原文件） |
| `MALFORMED_OUTPUT` | state | Agent/CLI 输出不是合法结构化 JSON |
| `CLI_NOT_FOUND` | cli | Claude Code CLI 不存在 |
| `CLI_AUTH_FAILED` | cli | CLI 认证失败 / 异常退出 |
| `CLI_TIMEOUT` | cli | 进程超时 |
| `WORKSPACE_NOT_FOUND` / `PERMISSION_DENIED` | io | 根目录缺失 / 不可读写 |
| `INVALID_ARGUMENT` | argument | 参数非法（空文本等） |
| `NOT_IMPLEMENTED` | not_implemented | 脚手架占位（未接入） |

## 安全不变量（Issue #7 核心）

1. **路径安全**（`path-guard.ts`）：所有文件/进程操作必须落在固定 MFP 根目录内，
   拒绝 `..` 穿越、根外绝对路径、符号链接逃逸（按真实路径判定）。
2. **并发保护**（`concurrency.ts`）：同一请求同一时刻只允许一个运行中的会话（`RunGuard`）。
3. **参数数组 + 显式 cwd**（`process-runner.ts`）：`spawn(command, args, { shell: false, cwd })`，
   用户/Agent 文本只经 stdin 或文件传递，绝不拼进命令行。
4. **malformed 不吞现场**（`work-package.ts`）：坏 JSON / 非法状态 → 诊断态，保留原文件。

## 运行时适配边界

`InMemoryBridge` 通过依赖注入（`recognizeRaw` / `preflightRaw`）隔离 Agent 专用逻辑：

- `BrowserMockBridge`：识别走内存确定性函数（浏览器无 spawn）。
- `LocalBridge`：识别走 `node bin/fake-cli.mjs` 子进程（契约测试缝隙）。
- 真实 `claude` CLI 适配：Issue #3 替换 `LocalBridge` 的 `cli` 配置。

## 确定性 mock

`mock.ts`（前端）与 `bin/fake-cli.mjs`（进程）必须输出一致；`test/mock.test.ts` 的
parity 测试锁定二者，改动其一必须同步另一处。
