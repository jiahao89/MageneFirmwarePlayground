# MFP 本地工作台应用（app/）

Tauri 桌面壳 + React Web UI + 本地桥接契约。

> **状态**：
> - Issue #7（已合并）：契约优先 + 脚手架壳，桥接契约 / 路径安全 / 并发保护 / mock。
> - Issue #2（本分支）：本地文件工作包、需求状态机、持久化与读写服务。
> - Tauri/Rust 壳仍为脚手架（本机未装 Rust，未编译验证）。

## 目录结构

```
app/
├── package.json              # 依赖 + 脚本（vite / vitest / tauri）
├── tsconfig.json             # TypeScript 严格模式
├── vite.config.ts            # Web UI dev/build（端口 5173）
├── vitest.config.ts          # 桥接契约测试
├── index.html                # Vite 入口
├── src/
│   ├── bridge/               # ── 本地桥接契约（核心）──
│   │   ├── index.ts          #   浏览器安全入口（类型 + 错误 + 状态机 + 任务卡 + mock）
│   │   ├── node.ts           #   Node 入口（+ 安全原语 + 存储 + LocalBridge）
│   │   ├── types.ts          #   契约类型（WorkPackage/TaskCard/RecognitionResult/…）
│   │   ├── errors.ts         #   错误模型（code + category + 可行动消息）
│   │   ├── state-machine.ts  #   需求状态机（迁移表 + PM 权威约束）
│   │   ├── task-card.ts      #   任务卡（构建 + 校验）
│   │   ├── validate.ts       #   结构校验（malformed 判定）
│   │   ├── mock.ts           #   确定性 mock（同一输入 → 同一输出）
│   │   ├── work-package-bridge.ts # 工作包桥核心（状态机 + 存储 + 并发）
│   │   ├── work-package-store.ts  # 存储抽象 + 内存实现
│   │   ├── file-work-package-store.ts # 文件存储（.mfp/work/*.json，锁 + 原子写）
│   │   ├── path-guard.ts     #   路径安全约束（MFP 根目录 + 防穿越/符号链接）
│   │   ├── concurrency.ts    #   并发保护（同一请求禁止重复运行）
│   │   ├── process-runner.ts #   进程启动（参数数组 + cwd，禁止 shell 插值）
│   │   ├── work-package.ts   #   工作包文件读写 + malformed 保留原文件
│   │   ├── browser-mock.ts   #   浏览器 mock 桥（内存存储）
│   │   ├── local-bridge.ts   #   Node 桥（文件存储 + fake CLI 子进程）
│   │   └── bin/fake-cli.mjs  #   确定性 fake CLI（进程化，供测试替换真实 CLI）
│   └── web/                  # ── React Web UI（最小，验证读写服务可调用）──
│       ├── main.tsx / App.tsx
│       ├── bridge-adapter.ts #   Tauri invoke ↔ mock 适配
│       └── app.css
├── test/                     # ── 桥接契约测试 ──
│   ├── state-machine.test.ts #   状态机 + PM 权威
│   ├── persistence.test.ts   #   重启恢复 + 并发写入 + malformed 文件
│   ├── bridge.test.ts        #   端到端契约缝隙（save→…→complete）
│   ├── path-guard.test.ts    #   非法路径（穿越/绝对/符号链接）
│   ├── concurrency.test.ts   #   重复运行
│   ├── work-package.test.ts  #   malformed 状态 + 任务卡校验
│   └── mock.test.ts          #   mock 确定性 + fake CLI parity
└── src-tauri/                # ── Tauri/Rust 壳（脚手架，未编译验证）──
    ├── Cargo.toml / build.rs / tauri.conf.json
    ├── src/{main,lib,commands}.rs   # 命令层镜像桥接契约（占位）
    └── capabilities/default.json
```

## 运行命令

| 命令 | 作用 | 前置条件 |
|---|---|---|
| `cd app && npm install` | 安装依赖 | node ≥ 20（本机 v26 已就绪） |
| `npm test` | 运行桥接契约测试（Vitest，38 用例） | — |
| `npm run typecheck` | TypeScript 严格类型检查 | — |
| `npm run build` | 类型检查 + 打包 Web UI（dist/） | — |
| `npm run dev` | 启动 Vite dev server（访问 Web UI，mock 模式） | — |
| `npm run tauri dev` | 启动 Tauri 桌面壳 | **需 Rust 工具链**（本机未装，未验证） |

验收对照（Issue #2）：

- **重启恢复**：文件为事实源，`test/persistence.test.ts` 用新实例恢复工作包。
- **PM 才能登记/归档/完成**：`register/archive/complete` 经状态机校验前置状态。
- **无效状态 / 并发写入有明确错误**：`INVALID_TRANSITION` / `CONCURRENT_WRITE` / `MALFORMED_STATE`。
- **桥接契约测试**：`npm test`（7 个测试文件 38 用例）。

文件格式与迁移策略见 [`src/bridge/README.md`](src/bridge/README.md)。

## 边界与未决项

- 真实 Claude Code CLI 接入、终端启动、会话恢复：**Issue #3**。
- 前端页面与识别结果展示：**Issue #4**；需求池、澄清、PRD 评审页：**Issue #5**。
- 桥接联调、跨平台（macOS/Windows）验收与打包：**Issue #6**。
- Tauri/Rust 壳需安装 Rust 后 `npm run tauri dev` 验证；`commands.rs` 为占位。
