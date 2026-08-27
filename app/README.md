# MFP 本地工作台应用（app/）

Tauri 桌面壳 + React Web UI + 本地桥接契约（Issue #7 交付物）。

> **状态**：契约优先 + 脚手架壳。桥接契约、路径安全、并发保护、错误模型、确定性 mock
> 均已实现并用 node 全量测试通过；Tauri/Rust 壳为脚手架（本机未装 Rust，未编译验证）。

## 目录结构

```
app/
├── package.json              # 依赖 + 脚本（vite / vitest / tauri）
├── tsconfig.json             # TypeScript 严格模式
├── vite.config.ts            # Web UI dev/build（端口 5173）
├── vitest.config.ts          # 桥接契约测试
├── index.html                # Vite 入口
├── src/
│   ├── bridge/               # ── 本地桥接契约（核心交付物）──
│   │   ├── index.ts          #   浏览器安全入口（类型 + 错误 + mock）
│   │   ├── node.ts           #   Node 入口（+ 安全原语 + LocalBridge）
│   │   ├── types.ts          #   契约类型（RawInput/RecognitionResult/WorkPackage/…）
│   │   ├── errors.ts         #   错误模型（code + category + 可行动消息）
│   │   ├── validate.ts       #   结构校验（malformed 判定）
│   │   ├── mock.ts           #   确定性 mock（同一输入 → 同一输出）
│   │   ├── path-guard.ts     #   路径安全约束（MFP 根目录 + 防穿越/符号链接）
│   │   ├── concurrency.ts    #   并发保护（同一请求禁止重复运行）
│   │   ├── process-runner.ts #   进程启动（参数数组 + cwd，禁止 shell 插值）
│   │   ├── work-package.ts   #   工作包文件读写 + malformed 保留原文件
│   │   ├── in-memory-bridge.ts # 内存桥核心（运行时适配边界）
│   │   ├── browser-mock.ts   #   浏览器 mock 桥
│   │   ├── local-bridge.ts   #   Node 桥（fake CLI 子进程）
│   │   └── bin/fake-cli.mjs  #   确定性 fake CLI（进程化，供测试替换真实 CLI）
│   └── web/                  # ── React Web UI（最小，验证 mock 可调用）──
│       ├── main.tsx / App.tsx
│       ├── bridge-adapter.ts #   Tauri invoke ↔ mock 适配
│       └── app.css
├── test/                     # ── 桥接契约测试 ──
│   ├── path-guard.test.ts    #   非法路径（穿越/绝对/符号链接）
│   ├── concurrency.test.ts   #   重复运行
│   ├── work-package.test.ts  #   malformed 状态
│   ├── bridge.test.ts        #   契约测试缝隙（save→recognize→register→launch→complete）
│   └── mock.test.ts          #   mock 确定性 + fake CLI parity + malformed 输出
└── src-tauri/                # ── Tauri/Rust 壳（脚手架，未编译验证）──
    ├── Cargo.toml / build.rs / tauri.conf.json
    ├── src/{main,lib,commands}.rs   # 命令层镜像桥接契约（占位）
    └── capabilities/default.json
```

## 运行命令

| 命令 | 作用 | 前置条件 |
|---|---|---|
| `cd app && npm install` | 安装依赖 | node ≥ 20（本机 v26 已就绪） |
| `npm test` | 运行桥接契约测试（Vitest） | — |
| `npm run typecheck` | TypeScript 严格类型检查 | — |
| `npm run build` | 类型检查 + 打包 Web UI（dist/） | — |
| `npm run dev` | 启动 Vite dev server（访问 Web UI，mock 模式） | — |
| `npm run tauri dev` | 启动 Tauri 桌面壳 | **需 Rust 工具链 + `@tauri-apps/cli`**（本机未装，未验证） |

验收要点对照：

- **可访问 Web UI**：`npm run dev` 后访问 `http://localhost:5173`（mock 桥可被前端调用）。
- **桥接接口有类型/文档/错误模型**：见 [`src/bridge/README.md`](src/bridge/README.md)。
- **mock 可被前端调用 + 测试覆盖非法路径/重复运行/malformed 状态**：`npm test`。
- **运行命令与目录结构**：本文件。

## 边界与未决项

- 真实 Claude Code CLI 接入、终端启动、会话恢复：**Issue #3**。
- 工作包状态机与落盘持久化：**Issue #2**。
- 桥接联调、跨平台（macOS/Windows）验证与打包：**Issue #6**。
- Tauri/Rust 壳需在本机安装 Rust 后 `npm run tauri dev` 验证；当前为脚手架，`commands.rs` 为占位。
