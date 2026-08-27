# CLAUDE.md — MFP（MageneFirmwarePlayground）

## 项目定位

MFP 是迈金固件 PM 个人使用的 **Claude Code 原生工作台**：竞品调研 → 需求分析 → PRD 撰写 → 双视角评审 → 原型输入 → 原型验收，全部在 Claude Code 内完成。

- **知识层**（`knowledge-base/`）与 **领域 skill**（`skills/`）为自包含实体文件，从 `Magene_PM_Workspace` 提取；workspace 保持只读、永不被 MFP 修改。
- **原始 PRD 历史**（`01_工作台` 草稿、`02_历史归档`）留在 workspace，MFP 运行时只读引用。
- 本项目**不是 Web 应用**：无前端代码，产出物通过飞书（文档）与 Figma（原型）呈现。

## 开工前必读（按顺序）

1. [`.ai_global_profile.md`](.ai_global_profile.md) — 行为规范（不编造、三层架构、竞品锚定、数据溯源）
2. [`knowledge-base/README.md`](knowledge-base/README.md) — 知识层导航 + 来源映射
3. [`knowledge-base/01_事实源/BENCHMARK.md`](knowledge-base/01_事实源/BENCHMARK.md) — **事实源索引**：写任何需求前先定位 benchmark 文件
4. [`config/product-line/码表/manifest.json`](config/product-line/码表/manifest.json) — 当前产品线（`current.txt` → 码表）

## 事实源纪律（SSOT）

- `~/Projects/Magene_PM_Workspace` 是唯一事实源；MFP 持有可复用方法论，不持有原始 PRD。
- 状态等级：benchmark（事实源）> draft（仅参考方向）> superseded（回溯须标注"来自废弃版本，待确认"）> reference（仅背景）> AI 产出（永不为事实源）。
- BENCHMARK 索引与实际文件不一致 → **停止并询问 PM**。
- AI 产出先落 `output/` 草稿区；升级为 benchmark 只能由 PM 人工决定。

## 核心方法论

### 1. 人群归位（6 层模型，写需求前必做）

见 [`knowledge-base/03_人群与方法论/6层人群模型.md`](knowledge-base/03_人群与方法论/6层人群模型.md)。
**战略红线：L1–L3 需求占比 ≥ 60%**；每个功能输出需求浓度表，锁定受益层级（3 问锁定法）。

### 2. 三层架构（按需填写）

硬件/物理层 → 固件/协议层 → App 业务层。不涉及的层级省略，**不得为填满而编造**。

### 3. PRD → 原型结构化流水线（复杂需求强制）

复杂需求（跨端/OTA/多传感器并发/复杂状态机）在写 PRD 前，依次产出：
1. 对象与字段清单（`00_规范与模板/对象与字段清单模板.md`）
2. 状态—事件—操作矩阵（`00_规范与模板/状态-事件-操作矩阵模板.md`）
3. Demo 版 PRD（`00_规范与模板/Demo版PRD与原型输入规范.md`）
4. 原型验收（`00_规范与模板/原型验收清单.md`）

### 4. 评审能力边界

AI 扫「有没有/对不对」（依据 `knowledge-base/03_人群与方法论/固件评审清单.md`），人聚焦「好不好/该不该」。见 `knowledge-base/03_人群与方法论/评审能力边界.md`。

## 工作流与触发词

| 想做什么 | 说什么 | 编排 |
|---------|--------|------|
| 完整需求流程 | "开始需求XX / 写PRD / MFP流程" | `mfp-prd-flow`（Phase 间暂停确认，含 7.5 发布） |
| 单独评审 | "评审PRD XX" | `mfp-reviewer`（读知识库评审清单） |
| 只做竞品调研 | "调研XX功能" | `hardware-product-analysis` / `research` |
| 设计/原型 | "出XX原型" | `magene-design` 路由 → `figma-lofi-prototype` / `drawio-skill` |
| 发布飞书 | "发布PRD" | `scripts/md2lark.py` + `lark-cli` |
| 交付归档 | "整理成飞书文档/PPT" | `lark-doc` / `pptx` / `docx` |

## Skill 来源约定（同名冲突裁决）

MFP 维护 **3 个设计 skill**（`magene-design` / `figma-lofi-prototype` / `drawio-skill`），其余全部引用成熟件：

| Skill | 来源 | 说明 |
|-------|------|------|
| `prd-writer` | 全局 `~/.claude/skills/prd-writer`（官方多文件版） | 概念版/落地版两版交付；**不用** prd-generator 项目版 |
| `hardware-product-analysis` | 全局 `~/.claude/skills/`（官方 PM skill） | 竞品调研 |
| `research` / `grill-me` / `domain-modeling` / `wait-what` | `mattpocock-skills` 插件（Claude Code 官方 marketplace，自动更新） | 需求澄清 / 调研 / 对象建模 |
| `docx` / `pptx` / `lark-doc` | 全局 `~/.claude/skills/` | 交付归档 |
| `writing-plans` / `verification-before-completion` | 全局 `~/.claude/skills/superpowers/` | 流程骨架（澄清/计划/自检） |
| `magene-design` / `figma-lofi-prototype` / `drawio-skill` | `skills/`（workspace 副本，源 `~/.agents/skills/`，均含 Codex 双入口） | 设计路由 / 低保真 / 图 |

> 固件双视角评审**不再用 skill**：读 `knowledge-base/03_人群与方法论/固件评审清单.md`（原 firmware-review skill 已降级删除）。

> 全局 skill 数量庞大，同名/近义 skill 可能互相干扰。各 Phase 已在上方编排表写死 skill 名，AI 按编排执行，不得自行替换。

## 设计门禁

涉及顽鹿 App / 迈金 C706 / GEOID 或跨端流程时，先走 [`skills/magene-design/`](skills/magene-design/) 设计路由（`$magene-design`），读取 `knowledge-base/05_设计系统/` 路由结果后再出图。**不得以旧 `design system/` 或 `GEOID_Design/` 为依据**。

## 产出规范

- 输出目录：`output/{需求名}/`，命名：`00-竞品调研` → `01-需求分析` → `02-PRD` → `03-评审意见` → `04-原型输入` → `05-原型验收`
- **全部产出为 Markdown，不生成 HTML**（评审报告、PRD 呈现一律 Markdown）
- 飞书发布：`scripts/md2lark.py` + `lark-cli`，登记表 `output/{需求名}/_publish.json`，只发 `02-PRD.md` 终稿一份
- 不确定标"待定"/"待确认"，**绝不编造假数据**；竞品搜不到明说搜不到
- 写作风格见 [`config/product-line/码表/style.md`](config/product-line/码表/style.md)（结论先行、Toast 精确到字、超时精确标注、国内/海外标注、@人名）

## 文档分区

MFP 的产品定义（PRD）、方案与设计文档统一放 `design/`；`docs/` 已废弃（原定稿 PRD 已删除）。同一文档只存一处。
