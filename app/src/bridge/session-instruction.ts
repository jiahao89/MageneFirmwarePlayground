// ============================================================================
// 启动指令（startup instruction）：开新会话时喂给 Claude Code 的受控文本。
// 对齐 Issue #1「start a named interactive session with the request identifier
// and a startup instruction that points Claude Code to AGENTS.md and the
// current task card」。
//
// 安全不变量：只由 requestId / 相对路径 / 固定模板构成，绝不包含用户原文
// （用户原文在工作包文件里，由 Agent 自行读取）。
// ============================================================================

export interface StartupInput {
  requestId: string;
  /** 工作包文件相对 MFP 根目录的路径，如 .mfp/work/REQ-x.json。 */
  workPackageRelPath: string;
}

export function buildStartupInstruction(input: StartupInput): string {
  const { requestId, workPackageRelPath } = input;
  return [
    `你是 MFP 工作台的 Claude Code Agent，正在处理需求 ${requestId}。`,
    ``,
    `请先读取以下文件（按顺序）：`,
    `1. AGENTS.md 与 CLAUDE.md（项目规则）`,
    `2. ${workPackageRelPath}（当前工作包：原始需求、识别结果、任务卡、问题与回答、运行日志）`,
    `3. knowledge-base/01_事实源/BENCHMARK.md（事实源索引）`,
    ``,
    `执行要求：`,
    `- 按工作包内任务卡（taskCard）的 currentPhase 继续工作，不得跳过「理解与澄清」直接写终稿。`,
    `- 正式问题、状态更新、日志和产出物必须写回工作包文件（或工作包记录的产出路径），不得只留在终端对话里。`,
    `- 信息不足时先完成不受影响的部分，并把阻塞性问题写回工作包后暂停等待 PM。`,
    ``,
    `PRD 产出后的强制写回（Issue #6 验收 F-4）：${workPackageRelPath} 写入 PRD 文件后，`,
    `必须同步更新工作包 JSON 的以下字段，否则 Web 端无法看到产出：`,
    `  - prdPath：PRD 文件相对 MFP 根目录的路径（如 output/<需求名>/02-PRD.md）`,
    `  - prdVersion：在上一版本基础上 +1（首次为 1）`,
    `  - artifacts：追加本次产出的文件路径`,
    `  - status：置为 "pending_review"（待 PM 审阅）`,
    `  - taskCard.currentPhase：推进到下一阶段`,
    ``,
    `禁止事项：`,
    `- 不得自动修改 benchmark 或确认知识库。`,
    `- 不得保存或输出任何 API key / 登录凭据。`,
    `- 不得在未获 PM 确认时执行登记、归档或完成等 PM 权威动作。`,
  ].join('\n');
}

/** resume 失败降级时的新会话启动指令：显式说明从工作包续接。 */
export function buildFallbackStartupInstruction(input: StartupInput): string {
  return [
    `（上一个会话恢复失败，本会话基于工作包续接。）`,
    ``,
    buildStartupInstruction(input),
  ].join('\n');
}
