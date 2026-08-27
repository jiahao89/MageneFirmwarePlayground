# MFP（MageneFirmwarePlayground）

迈金固件 PM 个人的 **Claude Code / Codex 原生工作台**：竞品调研 → 需求分析 → PRD 撰写 → 双视角评审 → 原型输入 → 原型验收 → 发布飞书，全程在终端内完成。

> **状态（2026-08-17，v3）**：Web 骨架已删除（历史存 tag `web-baseline-20260813`）。产出物通过**飞书 wiki**（PRD 终稿）与 **Figma**（原型）呈现，本地 git 是唯一事实源。

## 结构

| 目录 | 作用 |
|---|---|
| `knowledge-base/` | 知识层：BENCHMARK 事实源索引、6 层人群模型、PRD 模板、固件评审清单、四套设计系统 |
| `config/product-line/码表/` | 产品线配置 + PRD 写作风格 + 成熟样本 |
| `.claude/agents/` | 编排 Agent：`mfp-prd-flow`（主流程）、`mfp-reviewer`（评审） |
| `skills/` | 设计三件套：`magene-design` / `figma-lofi-prototype` / `drawio-skill`（均含 Codex 双入口） |
| `scripts/` | `md2lark.py`（PRD Markdown → 飞书 XML 转换器） |
| `output/{需求名}/` | 产出区：`00-竞品调研` → `02-PRD` → `03-评审意见` → `04-原型输入` → `05-原型验收` |
| `design/` | 方案文档（v1/v2/v3 演进） |
| `app/` | MFP 本地工作台应用：Tauri 壳 + React UI + 本地桥接契约（Issue #7 起，见 `app/README.md`） |

## 用法

双端入口，触发词驱动：

- Claude Code：读 `.claude/agents/` 编排，触发词「开始需求XX / 写PRD / 评审PRD XX / 调研XX / 出XX原型 / 发布PRD」
- Codex：读 `AGENTS.md` 的「Codex 编排」章节，等价 Phase 顺序

## 核心纪律

1. **SSOT**：`~/Projects/Magene_PM_Workspace` 是唯一事实源，只读不写；AI 产出永不为事实源
2. **不编造**：迈金专属行为/协议/硬件无依据一律标「待确认」
3. **人群红线**：写 PRD 前必做 L1–L6 归位，L1–L3 ≥ 60%
4. **产出 Markdown 化**：不生成 HTML，呈现交给飞书/Figma

详见 [`CLAUDE.md`](CLAUDE.md)（Claude Code 入口）、[`AGENTS.md`](AGENTS.md)（Codex 入口）、[`.ai_global_profile.md`](.ai_global_profile.md)（行为规范）。
