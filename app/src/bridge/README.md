# 本地桥接契约（Bridge Contract）

Issue #1 定义的「最高测试缝隙」—— Web UI 与本地桥接层之间的公共操作面。本文档是
契约的唯一事实来源，Web UI、Node FileBridge、Tauri Rust 命令层三者都必须对齐。

## 入口

- `index.ts`：浏览器安全入口（类型 + 错误 + 状态机 + 任务卡 + 确定性 mock）。
- `node.ts`：Node 入口（附加路径安全、并发保护、进程启动、文件/内存存储、LocalBridge）。

## 公共操作面（`MfpBridge`）

| 操作 | 签名 | 状态迁移 | 归属 Issue |
|---|---|---|---|
| `saveRawInput` | `(req) => WorkPackage` | → `pending_recognition` | #2 |
| `recognize` | `(requestId) => RecognitionResult` | `pending_recognition` → `pending_confirmation` | #3 接入真实 CLI |
| `register` | `(requestId) => WorkPackage` | `pending_confirmation` → `pending_launch`（PM 权威，建任务卡） | #2 |
| `listWorkPackages` | `() => WorkPackage[]` | — | #2 |
| `readWorkPackage` | `(requestId) => WorkPackage` | —（malformed → 诊断态 `error`） | #2 |
| `preflight` | `(requestId) => PreflightResult` | — | #3 |
| `launch` | `(requestId) => LaunchResult` | `pending_launch` → `processing`（并发保护） | #3 |
| `resume` | `(requestId) => LaunchResult` | 复用 launch / 返回现有会话 | #3 |
| `answerQuestion` | `(requestId, questionId, answer) => WorkPackage` | `pending_answer` → `processing` | #2 |
| `submitRevision` | `(requestId, comment) => WorkPackage` | `pending_review` → `revising` | #2 |
| `complete` | `(requestId) => WorkPackage` | `pending_review` → `completed`（PM 权威） | #2 |
| `archive` | `(requestId) => WorkPackage` | `pending_confirmation`/`pending_launch`/`pending_review` → `archived`（PM 权威） | #2 |

## 需求状态机（`state-machine.ts`）

```text
待识别 → 待 PM 确认 → 待启动 → 处理中
处理中 → 待 PM 回答 → 处理中
处理中 → 待审阅 → 修改中 → 待审阅
待审阅 → 完成
待 PM 确认 / 待启动 / 待审阅 → 归档
```

- `ALLOWED_TRANSITIONS`：合法迁移表（`error` 为诊断态，无出边，需人工修复文件后重读）。
- `PM_AUTHORITATIVE_STATUSES = [pending_launch, completed, archived, revising]`：只有 PM 权威动作能迁入。
- `AGENT_WRITABLE_STATUSES = [pending_confirmation, pending_answer, pending_review]`：Agent 写回允许迁入。

PM 权威动作（register/archive/complete/launch/answerQuestion/submitRevision）都经
`assertTransition` 校验前置状态，非法迁移抛 `INVALID_TRANSITION`。

## 任务卡（`task-card.ts`）

注册时 `buildTaskCard(recognition)` 生成可变工作契约：`currentPhase`（注册后第一阶段
固定为 `understand_and_clarify`）、`goal`、`confirmedScope`、`unresolvedQuestions`、
`allowedContext`、`expectedOutputs`、`writeBackRules`、`pauseConditions`、
`prohibitedActions`。持久化在工作包 `taskCard` 字段，注册前为 `null`。

## 文件格式与持久化（Issue #2）

本地文件为事实源，布局（运行时目录，已 gitignore）：

```
<MFP root>/.mfp/work/<requestId>.json     # 工作包（完整生命周期，单文件）
```

- `FileWorkPackageStore`（node-only）：`save` 用「目录 + 每文件锁（`.lock` 排他创建）+
  临时文件原子 rename」；`load` 坏 JSON / 非法状态 → `malformed` 诊断态；`list` 扫描目录。
- `InMemoryWorkPackageStore`（纯）：浏览器 mock / 测试用。
- 工作包 JSON 含：`requestId`、`rawInputId`、`status`、`originalInput`（原始需求）、
  `recognition`（识别结果）、`taskCard`（任务卡）、`questions`（问题+回答）、
  `revisionComments`、`prdPath`/`prdVersion`（PRD 版本）、`runLog`（日志）、
  `session`（会话元数据）、`artifacts`。

重启恢复：`LocalBridge` 每次读写都走文件，新实例 `listWorkPackages()` /
`readWorkPackage(requestId)` 直接恢复；运行中的 `processing`/`running` 状态也持久化，
重启后不会误重复启动。

## 错误模型（`errors.ts`）

`BridgeError { payload: { code, category, message, details } }`。Issue #2 新增
`INVALID_TRANSITION` / `CONCURRENT_WRITE`；Issue #3 新增 `SESSION_NOT_FOUND`（resume 前置
检查失败，触发降级）与 `TERMINAL_LAUNCH_FAILED`（终端无法打开）：

| code | category | 语义 |
|---|---|---|
| `INVALID_TRANSITION` | state | 非法状态迁移（含 PM 权威动作前置状态不符） |
| `CONCURRENT_WRITE` | concurrency | 工作包文件正被并发写入 |
| `MALFORMED_STATE` | state | 工作包 JSON / 状态非法（保留原文件） |
| `CONCURRENT_RUN` | concurrency | 同一请求重复并发运行 |
| `SESSION_NOT_FOUND` | cli | resume 目标会话不存在（自动降级为新会话） |
| `TERMINAL_LAUNCH_FAILED` | io | 终端应用无法打开（macOS osascript / Windows wt+PowerShell 均失败） |

其余（`INVALID_PATH` / `MALFORMED_OUTPUT` / `CLI_*` / `WORKSPACE_NOT_FOUND` /
`PERMISSION_DENIED` / `INVALID_ARGUMENT` / `NOT_IMPLEMENTED`）沿用 Issue #7 定义。

## 运行时适配边界（Issue #3）

`WorkPackageBridge` 通过依赖注入隔离变点：

- `store`：`InMemoryWorkPackageStore`（浏览器 mock）或 `FileWorkPackageStore`（本地文件）。
- `recognizeRaw`：`BrowserMockBridge` 走内存确定性函数；`LocalBridge` 走 `RuntimeAdapter.recognize`。
- `sessions`：`SessionDriver`。`BrowserMockBridge` 用 `MockSessionDriver`（内存确定性）；
  `LocalBridge` 用 `AdapterSessionDriver` + `ClaudeCliAdapter`（真实终端）。
- `preflightRaw`：mock 恒通过 / `LocalBridge` 做完整启动前检查（见下）。

### RuntimeAdapter（`runtime-adapter.ts`）

Agent 专用逻辑的隔离边界（Issue #1「runtime adapter」）。MVP 只有两个实现：

| 实现 | 用途 |
|---|---|
| `ClaudeCliAdapter` | 真实 Claude Code CLI（`claude`）：可用性/版本、认证探测、非交互识别、终端会话 |
| `FakeCliRuntimeAdapter` | 测试：识别走 `bin/fake-cli.mjs` 子进程，会话只记录不开终端 |

### ClaudeCliAdapter 行为（`claude-cli-adapter.ts`）

- **可用性/版本**：PATH 扫描定位 `claude`（win32 含 `.exe`/`.cmd`），`claude --version` 解析语义化版本。
- **认证**：一次最小 `-p` 探测；认证类错误（`auth/api key/login/401/登录…`）转述为
  `CLI_AUTH_FAILED`。**绝不保存 / 检查凭据内容**，认证归 Claude Code 自身管理。
- **非交互识别**：`claude -p --output-format json`，用户文本经 **stdin** 传入；
  双层校验：外层 `{type:'result', is_error, result}` 信封 → 内层 `RecognitionResult` schema
  （`parseEnvelopeToRecognition`；容错剥离 ```` ```json ```` 代码块）。
- **会话启动/恢复**：
  - 新会话：`claude --session-id <uuid> --name "MFP · <requestId>" <启动指令>`；
  - 恢复：`claude --resume <savedSessionId> --name …`；
  - resume 前置检查本地会话文件 `~/.claude/projects/<cwd 非字母数字转 ->/<uuid>.jsonl`，
    缺失 → **基于工作包创建新会话**（`fallback: true` + 降级启动指令 + `SESSION_NOT_FOUND`）。
- **错误映射**：ENOENT→`CLI_NOT_FOUND`；超时→`CLI_TIMEOUT`；认证特征→`CLI_AUTH_FAILED`；
  信封/内层非法→`MALFORMED_OUTPUT`；终端启动失败→`TERMINAL_LAUNCH_FAILED`。

### 终端启动器（`terminal-launcher.ts`）

- macOS：`osascript` 驱动配置的终端应用（默认 Terminal.app）：
  `tell application "Terminal" … do script "cd <root> && claude … "$(cat <启动文件>)""`。
- Windows：优先 `wt.exe -d <root> powershell -NoExit -Command "… (Get-Content -Raw <启动文件>)"`，
  `wt` 不存在时回退 `powershell.exe -NoExit -Command "Set-Location …"`。
- `buildLaunchPlan` / `buildDarwinLaunchPlan` / `buildWindowsTerminalLaunchPlan` /
  `buildPowershellLaunchPlan` 为纯函数（测试直接断言计划内容）。

### 会话生命周期（`session-driver.ts` + 桥接层）

- `launch`（PM 启动）：`pending_launch → processing`，新会话；保存
  `sessionId / cliVersion / startedAt / processState / lastError` 到工作包 `session` 元数据。
- `resume`（PM 恢复）：同一应用会话内已运行 → 直接返回既有会话；应用重启后内存守卫为空 →
  真正走适配器恢复。仅当需求尚在 `pending_launch` 时才迁移到 `processing`，
  其余状态保持不变（会话恢复是会话层操作，不是需求状态迁移）。
- resume 失败 → 基于工作包的新会话（`LaunchResult.fallback=true` + `note`）。

### 启动前检查（preflight，Issue #1）

`LocalBridge.preflight` 检查：`mfp_root_exists` / `mfp_root_writable` / `cli_installed` /
`cli_version` / `cli_auth`（一次最小 `-p` 探测，计费一次极小请求）/ `rules_entrypoints`
（AGENTS.md + BENCHMARK.md）/ `task_card_readable` / `output_writable`。

## 安全不变量（#7 + #3 汇总）

1. **路径安全**：所有文件/进程操作落在固定 MFP 根目录内（`PathGuard`）。
2. **并发保护**：同一请求同一时刻一个运行会话（`RunGuard`）；工作包文件写入每文件锁。
3. **参数数组 + 显式 cwd**：所有进程调用 `shell:false`；用户/长文本经 **stdin**（识别）或
   **启动文件**（终端会话）传递，绝不拼入命令行；终端命令内层字符串只含
   固定模板 + UUID + 受控路径（有测试锁定）。
4. **不保存 API key**：认证归 Claude Code；桥接层只转述认证错误；会话元数据只有
   `sessionId/cliVersion/startedAt/processState/lastError`（有测试锁定无凭据字段）。
5. **malformed 不吞现场**：坏 JSON / 非法状态 → 诊断态，保留原文件。

## 待确认（Issue #6 真实验收时核对）

- `claude --session-id <uuid>` / `--resume <id>` 在 PM 机器所装版本上的行为（本机 2.1.229 已确认存在这两个 flag）。
- 会话文件布局 `~/.claude/projects/<sanitized>/<uuid>.jsonl` 用于 resume 前置检查（本机已确认存在该布局）。
- Windows 上 `wt.exe` / `powershell.exe` 的实际可用性（本机仅 macOS，无法真实验证）。
- 认证探测会产生一次极小模型调用；如成本敏感可在 preflight 侧加开关。

## 迁移策略（Issue #7 → #2）

1. `saveRawInput` 返回值由 `RawInput` 改为 `WorkPackage`；前端改用 `requestId` 而非 `rawInputId`。
2. `recognize` / `register` 入参由 `rawInputId` 改为 `requestId`。
3. `WorkPackage` 新增 `taskCard` 字段（注册前 `null`）。
4. 新增 `listWorkPackages`、`archive` 操作。
5. `InMemoryBridge` 重构为 `WorkPackageBridge`（store 注入），拆出 `state-machine.ts` / `task-card.ts` / `*-store.ts`。

无历史数据迁移负担：Issue #7 仅交付内存骨架，未产生持久化工作包；文件布局为本次新增。

## 确定性 mock

`mock.ts`（前端）与 `bin/fake-cli.mjs`（进程）必须输出一致；`test/mock.test.ts` 的
parity 测试锁定二者，改动其一必须同步另一处。
