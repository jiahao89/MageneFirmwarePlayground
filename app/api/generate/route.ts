import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { prompt, sources } = await request.json() as { prompt?: string; sources?: { title: string; path: string; summary: string }[] };
  if (!prompt || !sources?.length) return NextResponse.json({ title: "缺少生成上下文", eyebrow: "AI WORKBENCH", body: "请至少选择一份知识库资料，并填写任务。" }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) return NextResponse.json({ title: "AI 服务尚未配置", eyebrow: "NEEDS CONFIGURATION", body: "工作台界面已经就绪。部署时请在服务端配置 OPENAI_API_KEY 后启用真实生成；原始知识库保持只读。", sources: sources.map((source) => source.path) });

  const context = sources.map((source) => `来源：${source.path}\n标题：${source.title}\n摘要：${source.summary}`).join("\n\n");
  const system = `你是迈金室外固件产品团队的资深产品架构师。严格基于提供的知识库上下文回答，不得编造。信息不足、资料冲突或独有机制未确认时，必须明确写“待确认”，不要自行推导。输出中文 Markdown。涉及功能时必须拆解为：目标人群、硬件/物理层、固件/协议通信层、App 业务交互层、异常与断电保护、验收标准。涉及状态机或协议交互时追加 Mermaid 图。每个关键结论标注 [来源: 文件路径]。`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: `知识库上下文：\n${context}\n\n任务：${prompt}` }] }) });
  if (!response.ok) return NextResponse.json({ title: "AI 服务调用失败", eyebrow: "AI ERROR", body: "模型服务暂时没有返回结果。请检查服务端配置或稍后重试。", sources: sources.map((source) => source.path) }, { status: 502 });
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return NextResponse.json({ title: "生成结果", eyebrow: `${model.toUpperCase()} · GROUNDED`, body: data.choices?.[0]?.message?.content || "模型返回为空。", sources: sources.map((source) => source.path) });
}
