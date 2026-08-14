# MFP 项目规则

先读 [`.ai_global_profile.md`](.ai_global_profile.md)。信息缺口会改变范围、流程或交互时向 PM 提问；其余缺口标记为待确认。

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
