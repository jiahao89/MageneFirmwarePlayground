# Figma 适配

先运行 `$magene-design`，读取目标系统规范后再创建或修改 Figma 内容。本文件只规定 Figma 的组织方式，不定义品牌色或组件外观。

## 画布与命名

- 页面按目标系统分区：`顽鹿 App`、`迈金 C706`、`GEOID`、`跨端流程`；不要把三套组件混在同一组件页。
- Frame 名称：`[系统] / [端] / [页面] / [状态]`，例如 `迈金 C706 / Device / Sensor List / Default`。
- 组件命名：`[系统]/[类别]/[名称]`，例如 `顽鹿 App/Button/Primary`、`GEOID/Status/Warning`。
- Variables 采用语义 Token 名，不使用颜色编号或临时十六进制命名。
- 开始出图前在画布说明或 Agent 上下文卡中写明目标系统的主色；顽鹿 App 必须写 `app/color/brand/primary = #C6FF00`。

## 组件约束

- 每套系统各自建立组件与变量分组；跨端只共享业务状态名称，不共享视觉组件。
- 组件必须有用户可感知 Variant，如 `Default`、`Selected`、`Disabled`、`Loading`、`Success`、`Error`；不为未确认硬件行为建立 Variant。
- C706 与已确认运行于 C706 平台的 GEOID Frame 固定 `320 × 480px`，先画状态栏和内容高度，再放内容。

## 交付前

- 检查 Frame 名称、系统归属、尺寸和状态完整性。
- 连线只连接用户可见页面；正常实线，已确认异常虚线。
- 未交付的字体、Logo 或插画使用明确占位并注明待替换。
- 截图前检查主按钮、选中态、主焦点和品牌强调是否仍引用目标系统主色；不得因为复制历史参考稿而变成橙色或其他品牌色。
