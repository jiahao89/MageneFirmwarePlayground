# CLAUDE.md — MFP（MageneFirmwarePlayground）

## 项目定位

MFP 是迈金固件 PM 个人使用的 **Claude Code 原生工作流**：竞品调研 → 需求分析 → PRD 撰写 → 双视角评审 → 原型输入，全部在 Claude Code 内完成，产出为 markdown + 单文件 HTML。

本项目**不是 Web 应用**：`app/` `worker/` `db/` 等脚手架已冻结（tag `web-baseline-20260813`），不要投入开发；团队共享需求出现时另行解冻。

## 开工前必读（按顺序）

1. [`.ai_global_profile.md`](.ai_global_profile.md) — 行为规范（不编造、三层架构、不确定性处理、数据溯源）
2. [`knowledge-base/07_知识库/00_索引/知识库总索引.md`](knowledge-base/07_知识库/00_索引/知识库总索引.md) — 知识入口
3. `~/Projects/Magene_PM_Workspace/05_AI协作评测/BENCHMARK.md` — **事实源索引**：写任何需求前先查此索引定位 benchmark 文件

## 事实源纪律（SSOT）

- `~/Projects/Magene_PM_Workspace` 是唯一事实源；本项目 `knowledge-base/`、`skills/`、`.ai_global_profile.md` 均为指向它的软链，**不要在 MFP 内复制知识文件或 skill**
- 状态等级：benchmark（事实源）> draft（仅参考方向）> superseded（回溯须标注"来自废弃版本，待确认"）> reference（仅背景）> AI 产出（永不为事实源）
- BENCHMARK 索引与实际文件不一致 → **停止并询问 PM**，不得自行猜测
- AI 产出先落 `output/` 草稿区；升级为 benchmark 只能由 PM 人工决定并更新 BENCHMARK.md

## 工作流与触发词

| 想做什么 | 说什么 | 编排 |
|---------|--------|------|
| 完整需求流程 | "开始需求XX / 写PRD / MFP流程" | `mfp-prd-flow` agent，Phase 0→5，每个 Phase 之间暂停等确认 |
| 单独评审 PRD | "评审PRD XX" | `mfp-reviewer` agent → `firmware-review` skill |
| 只做竞品调研 | "调研XX功能" | 直接调用 `hardware-product-analysis` / `research` skill |
| 设计/原型 | "出XX原型" | `magene-design` 路由 → `figma-lofi-prototype` / `drawio-skill` |
| 交付归档 | "整理成飞书文档/PPT" | `lark-doc` / `pptx` / `docx` skill |

各 Phase 使用的 skill 由 agent 定义固定，不要用其他同名 skill 替代。

## 产出规范

- 输出目录：`output/{需求名}/`，文件命名固定：
  - `00-竞品调研.md` → `01-需求分析.md` → `02-PRD.md` → `03-评审意见.md` + `03-评审报告.html` → `04-原型输入.md`
- HTML 产出**一律单文件**：Tailwind CSS CDN + 原生 JS，无构建步骤，浏览器直接打开
- 评审 HTML 要求：顶部统计卡片、🔴严重→🟡建议→🟢确认排序、问题卡片可展开、双视角交叉命中醒目标注
- 不确定的信息标"待定"/"待确认"，**绝不编造假数据**；竞品信息搜不到就明说搜不到

## 文档分区

- `design/` 放方案/设计类文档；`docs/` 放定稿类文档（如 MFP-PRD）
- **同一文档只存一处**，禁止双份

## 复杂需求额外门禁

涉及跨端（码表+App+外设）、OTA、多传感器并发、状态机的需求，在进入 PRD 撰写前必须先产出：
- 对象与字段清单（模板：`knowledge-base/03_标准与规范/对象与字段清单模板.md`）
- 状态-事件-操作矩阵（模板：`knowledge-base/03_标准与规范/状态-事件-操作矩阵模板.md`）

原型输入须满足 `knowledge-base/03_标准与规范/Demo版PRD与原型输入规范.md`，交付前用 `原型验收清单.md` 反查。
