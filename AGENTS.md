# MFP 项目规则

先读 [`.ai_global_profile.md`](.ai_global_profile.md)。信息缺口会改变范围、流程或交互时向 PM 提问；其余缺口标记为待确认。

> 本文件是**多端入口**：Claude Code 走 `.claude/agents/` 下的编排 Agent；Codex 走本文件「Codex 编排」章节；Antigravity 读取本文件和分配到的开发任务。各端共享同一套 skill / 脚本 / 知识库，产出口径一致。

## 开发任务领取与 Agent 分工

- 当前 MVP 父任务：GitHub Issue [#1](https://github.com/jiahao89/MageneFirmwarePlayground/issues/1)。父任务只作为范围和验收基准，不直接由多个 Agent 并行认领。
- Claude Code 是技术主 Agent：负责架构、Tauri 本地桥接层、工作包/状态机、Claude Code CLI 启动与恢复、测试、联调和最终集成。
- Antigravity 是前端专用 Agent：负责 Tauri/React 页面、交互状态、Markdown 预览、前端 mock 联调和界面验收；不得自行改动桥接协议或运行时安全边界。
- 开工顺序：先读取 `.ai_global_profile.md`、本文件、`CLAUDE.md`（如存在）、分配到的 GitHub Issue，以及 Issue 指向的设计/接口文档；只执行当前 Issue，不从父任务自行扩展范围。
- 每个 Agent 必须在独立分支或 worktree 中工作，不直接修改 `main`。完成后运行 Issue 要求的验证命令，提交分支并创建 PR，在 PR 中说明改动、测试和未决问题。
- 两个 Agent 不得同时修改同一组核心文件。桥接接口未冻结前，Antigravity 使用 mock；接口冻结后再联调。
- MFP 工作包、`AGENTS.md`、`knowledge-base/01_事实源/BENCHMARK.md` 和 Issue 验收标准是共同事实边界；不得写入 API key，不得自动修改 benchmark。
- 完成一个子任务后，Agent 只报告“已完成 / 阻塞 / 待 PM 决策”，不自动认领其他子任务。

详细任务矩阵和本机操作步骤见 [`design/2026-08-27-MFP-Agent开发任务分工.md`](design/2026-08-27-MFP-Agent开发任务分工.md)。

## 事实边界

- 本项目是 Magene Firmware Playground（MFP），迈金固件 PM 的 Claude Code 原生工作台。`knowledge-base/` 为从 `~/Projects/Magene_PM_Workspace` 提取的自包含知识层；workspace 是唯一事实源，**不得修改 workspace**。
- 原始 PRD 历史（`01_工作台`、`02_历史归档`）留在 workspace，运行时只读引用。
- 明确区分「事实」「判断」「待确认」，不得编造 Magene 专属行为、版本能力、协议字段或硬件限制。
- AI 生成结果先作为草稿或评审材料落 `output/`，不自动写回确认知识库。

## 固件 PM 输出约束

- 需求按需说明硬件/物理层、固件/协议通信层、App 业务交互层，不涉及的层级省略。
- 涉及传感器、车灯、导航、OTA、FIT、低电量、断连回连、重启、断电或多设备并发时，必须检查知识库是否有对应事实；无依据标记"待确认"。
- 每个功能先做人群归位（`knowledge-base/03_人群与方法论/6层人群模型.md`，红线 L1–L3 ≥ 60%）。

## 事实源与召回

- **事实源索引（开工必读）**：`knowledge-base/01_事实源/BENCHMARK.md`。仅 benchmark 状态文件可作为功能定义依据。
- 状态纪律：benchmark > draft > superseded（回溯标注待确认）> reference > AI 产出。索引与实际文件不一致 → 停止询问 PM。
- 稳定知识入口：`knowledge-base/README.md`；机型差异查 `01_事实源/机型版本功能矩阵.md`；术语口径查 `00_规范与模板/术语表.md`。

## PRD 到原型的执行规则

- 复杂码表/App/外设需求，先产出对象与字段清单 + 状态—事件—操作矩阵（模板在 `knowledge-base/00_规范与模板/`）。
- 原型输入满足 `Demo版PRD与原型输入规范.md` 后再出图；交付前用 `原型验收清单.md` 反查。
- 页面、状态、操作和验收项尽量关联可追踪 ID；无法映射时列为待确认。

## 设计与原型

- 任务涉及顽鹿 App、迈金 C706、GEOID 或跨端流程时，先走 [`skills/magene-design/`](skills/magene-design/) 设计路由，读取 `knowledge-base/05_设计系统/` 结果后再出图。
- 低保真流程用 [`skills/figma-lofi-prototype/`](skills/figma-lofi-prototype/)，系统/状态/关系图用 [`skills/drawio-skill/`](skills/drawio-skill/)。
- 不自行补充未确认的实体按键、硬件能力、通信协议、自动恢复逻辑或页面状态。

## Skill 来源（与 CLAUDE.md 一致）

- 通用 PM / 交付 skill 用全局 `~/.claude/skills/`（`prd-writer`、`hardware-product-analysis`、`docx`/`pptx`/`lark-doc`），mattpocock 系（`research`、`grill-me`、`domain-modeling`、`wait-what`）用 `mattpocock-skills` 插件，superpowers 系（`writing-plans`、`verification-before-completion`）用全局 `~/.claude/skills/superpowers/`。
- 固件双视角评审**不再用 skill**，读 `knowledge-base/03_人群与方法论/固件评审清单.md`（dev/qa 双清单）。
- 设计/画图用 `skills/` 下的 `magene-design` / `figma-lofi-prototype` / `drawio-skill`（三者保留，均含 `agents/openai.yaml` Codex 双入口）。

## 产出规范

- 输出目录 `output/{需求名}/`：`00-竞品调研` → `01-需求分析` → `02-PRD` → `03-评审意见` → `04-原型输入` → `05-原型验收`。
- **全部产出为 Markdown，不生成 HTML**（评审报告、PRD 呈现一律 Markdown）。
- 飞书发布走 `scripts/md2lark.py` + `lark-cli`，登记表 `output/{需求名}/_publish.json`（只发 `02-PRD.md` 终稿一份）。

## Codex 编排（与 .claude/agents/mfp-prd-flow.md 等价）

Codex 端按以下 Phase 顺序驱动同一套 skill/脚本/知识库，每个 Phase 之间暂停等 PM 确认：

```
Phase 0   事实源召回   → 读 knowledge-base/01_事实源/BENCHMARK.md + workspace（只读）
Phase 0.5 需求澄清     → grill-me / wait-what（mattpocock）
Phase 1   人群归位     → knowledge-base/03_人群与方法论/6层人群模型.md（L1-L3 ≥ 60%）
Phase 2   竞品调研     → hardware-product-analysis / research → 00-竞品调研.md
Phase 3   需求分析     → prd-writer 概念版 + domain-modeling → 01-需求分析.md
Phase 4   PRD 撰写     → prd-writer 落地版 + style.md + 样本 → 02-PRD.md
Phase 5   双视角评审   → 读 knowledge-base/03_人群与方法论/固件评审清单.md → 03-评审意见.md
Phase 6   原型输入     → magene-design + figma-lofi-prototype / drawio-skill → 04-原型输入.md
Phase 7   原型验收     → 原型验收清单.md + superpowers verification-before-completion → 05-原型验收.md
Phase 7.5 发布飞书     → scripts/md2lark.py + lark-cli → 飞书 PRD 终稿（PM 确认后执行）
```
