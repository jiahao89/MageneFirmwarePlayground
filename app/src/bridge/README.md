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

`BridgeError { payload: { code, category, message, details } }`，Issue #2 新增：

| code | category | 语义 |
|---|---|---|
| `INVALID_TRANSITION` | state | 非法状态迁移（含 PM 权威动作前置状态不符） |
| `CONCURRENT_WRITE` | concurrency | 工作包文件正被并发写入 |
| `MALFORMED_STATE` | state | 工作包 JSON / 状态非法（保留原文件） |
| `CONCURRENT_RUN` | concurrency | 同一请求重复并发运行 |

其余（`INVALID_PATH` / `MALFORMED_OUTPUT` / `CLI_*` / `WORKSPACE_NOT_FOUND` /
`PERMISSION_DENIED` / `INVALID_ARGUMENT` / `NOT_IMPLEMENTED`）沿用 Issue #7 定义。

## 运行时适配边界

`WorkPackageBridge` 通过依赖注入隔离变点：

- `store`：`InMemoryWorkPackageStore`（浏览器 mock）或 `FileWorkPackageStore`（本地文件）。
- `recognizeRaw`：`BrowserMockBridge` 走内存确定性函数；`LocalBridge` 走 `node bin/fake-cli.mjs` 子进程；真实 `claude` CLI 由 Issue #3 替换。
- `preflightRaw`：mock 恒通过 / 文件桥做根目录存在性与可写检查。

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
