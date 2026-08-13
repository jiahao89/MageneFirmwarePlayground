# MFP 项目规则

## 角色与事实边界

- 先读取 [`.ai_global_profile.md`](.ai_global_profile.md)。
- 本项目是 Magene Firmware Playground（MFP），迈金固件 PM 的 Claude Code 原生工作流。`knowledge-base/` 与 `skills/` 均为指向 `~/Projects/Magene_PM_Workspace` 的软链；该工作区是唯一事实源（SSOT）。
- 优先使用已确认的知识页、当前 PRD 和可追溯来源；明确区分“事实”“判断”和“待确认”。不得编造 Magene 专属行为、版本能力、协议字段或硬件限制。
- 不要把 AI 生成结果自动写回确认知识库；生成内容应先作为草稿或评审材料保存。

## 固件 PM 输出约束

- 相关需求按需说明硬件/物理层、固件/协议通信层和 App 业务交互层，不涉及的层级省略。
- 涉及传感器、车灯、导航、OTA、FIT、低电量、断连回连、重启、断电或多设备并发时，必须检查知识库中是否有对应事实；没有依据就标记“待确认”。
- PRD 和原型输入优先参考 [`knowledge-base/03_标准与规范/`](knowledge-base/03_标准与规范/) 中的模板、字段清单、状态矩阵和验收清单。

## 设计与原型

- MFP 自身文档（如汇报 HTML）可使用通用 Web 设计规范；若任务涉及顽鹿 App、迈金 C706、GEOID 或跨端产品流程，先使用 [`skills/magene-design/`](skills/magene-design/) 进行设计路由。
- 低保真流程图使用 [`skills/figma-lofi-prototype/`](skills/figma-lofi-prototype/)；系统流程、架构、状态或关系图使用 [`skills/drawio-skill/`](skills/drawio-skill/)。
- 设计或原型交付前，检查页面、状态、操作、跳转和验收项是否可追踪；复杂码表/App/外设需求先补对象字段和状态事件操作矩阵。

## 知识库使用

- **事实源索引（开工必读）**：源工作区 `05_AI协作评测/BENCHMARK.md`。任何需求开始前先查该索引定位 benchmark 文件；仅 benchmark 状态文件可作为功能定义依据。
- 状态纪律：benchmark（事实源）> draft（仅参考方向）> superseded（回溯须标注"来自废弃版本，待确认"）> reference（仅背景）> AI 产出（永不为事实源）。索引与实际文件不一致时，停止并询问 PM。
- 稳定知识入口：[`knowledge-base/07_知识库/00_索引/知识库总索引.md`](knowledge-base/07_知识库/00_索引/知识库总索引.md)。
- 关系追溯入口：[`knowledge-base/08_知识图谱/README.md`](knowledge-base/08_知识图谱/README.md)。
- `knowledge-base/` 通过软链直达源工作区，知识页中引用的工作区路径（如 `01_工作台/`、`02_历史归档/`）可直接到 `~/Projects/Magene_PM_Workspace/` 下读取原文。
