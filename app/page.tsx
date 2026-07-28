"use client";

import { useMemo, useState } from "react";

type Source = {
  id: string;
  title: string;
  path: string;
  category: string;
  kind: string;
  summary: string;
  tags: string[];
};

type Output = {
  title: string;
  eyebrow: string;
  body: string;
  sources?: string[];
};

const sources: Source[] = [
  { id: "sensor", title: "传感器体系总览", path: "07_知识库/00_索引/知识库总索引.md", category: "传感器体系", kind: "专题", summary: "C706 / 海外 2.1 / PV3.2 支持的传感器、协议、表盘、App 入口与 FIT 数据。", tags: ["ANT+", "BLE", "FIT"] },
  { id: "matrix", title: "机型版本功能矩阵", path: "07_知识库/03_版本与机型/机型版本功能矩阵.md", category: "版本与机型", kind: "矩阵", summary: "C706、C606、C716、EDR 的功能与版本差异，适合做兼容性判断。", tags: ["C706", "C716", "版本差异"] },
  { id: "ota", title: "固件升级专题", path: "01_工作台/专项PRD/固件升级/固件升级需求优化版.md", category: "固件升级", kind: "专项 PRD", summary: "OTA、Wi-Fi / 蓝牙共享网络、版本回退、升级安全与断电保护。", tags: ["OTA", "安全", "回退"] },
  { id: "settings", title: "App 码表设置", path: "01_工作台/专项PRD/APP端码表设置专项PRD-整理版.md", category: "App 码表设置", kind: "专项 PRD", summary: "码表设置入口、配置下发、状态同步和设备端反馈。", tags: ["App", "GATT", "配置"] },
  { id: "climb", title: "爬坡提醒 ClimbPro", path: "01_工作台/专项PRD/爬坡提醒ClimbPro专项PRD.md", category: "导航与爬坡", kind: "专项 PRD", summary: "爬坡识别、坡段进度、数据呈现与 App 端爬坡分析。", tags: ["ClimbPro", "高程", "导航"] },
  { id: "smart", title: "智联助手", path: "01_工作台/专项PRD/智联助手专项PRD.md", category: "智联助手", kind: "专项 PRD", summary: "条件 / 动作模型，以及电变、相机、车灯等智能外设联动。", tags: ["FE-C", "车灯", "电变"] },
  { id: "template", title: "PRD 模板 26-6-27", path: "03_标准与规范/PRD模版26-6-27新版.md", category: "标准与规范", kind: "模板", summary: "目标人群、三层架构、功能流程、异常处理与验收标准模板。", tags: ["模板", "三层架构", "验收"] },
  { id: "terms", title: "固件产品术语表", path: "03_标准与规范/术语表.md", category: "标准与规范", kind: "规范", summary: "AGNSS、PCO、FTP、TBT、ANT+ Device Profile 等统一口径。", tags: ["术语", "AGNSS", "PCO"] },
];

const categories = ["全部知识", "传感器体系", "版本与机型", "App 码表设置", "固件升级", "导航与爬坡", "智联助手", "标准与规范"];

const initialOutput = {
  title: "选择资料后开始生成",
  eyebrow: "AI WORKBENCH",
  body: "从左侧选择一到三份资料，再告诉我你要产出什么。生成结果会沿用知识库口径，并把来源标在每个关键结论旁。",
};

export default function Home() {
  const [category, setCategory] = useState("全部知识");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(["matrix", "ota"]);
  const [prompt, setPrompt] = useState("请评审这个固件升级需求，重点检查三层架构、协议并发、断电保护和版本回退。\n");
  const [output, setOutput] = useState<Output>(initialOutput);
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => sources.filter((item) => {
    const matchesCategory = category === "全部知识" || item.category === category;
    const haystack = `${item.title} ${item.summary} ${item.tags.join(" ")}`.toLowerCase();
    return matchesCategory && haystack.includes(query.toLowerCase());
  }), [category, query]);

  function toggleSource(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-3));
  }

  async function generate() {
    if (!selected.length || !prompt.trim()) return;
    setLoading(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sources: sources.filter((source) => selected.includes(source.id)) }),
      });
      const data = await response.json();
      setOutput(data);
    } catch {
      setOutput({ ...initialOutput, title: "生成服务暂不可用", body: "请检查工作台的 AI 服务配置后重试。当前选中的资料没有被修改。" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark"><span>MG</span><div><strong>MAGENE</strong><small>FIRMWARE PM OS</small></div></div>
        <div className="workspace-label">工作空间</div>
        <div className="workspace-card"><div className="workspace-icon">⌁</div><div><strong>固件产品工作台</strong><small>内部知识库 · 只读</small></div><span>⌄</span></div>
        <nav className="nav-list" aria-label="工作台导航">
          <button className="nav-item active"><span>◈</span>工作台总览</button>
          <button className="nav-item"><span>⌕</span>知识库浏览</button>
          <button className="nav-item"><span>▤</span>版本与机型</button>
          <button className="nav-item"><span>✦</span>生成记录 <em>3</em></button>
        </nav>
        <div className="sidebar-bottom"><div className="secure-line"><span>●</span> 工作区私有访问</div><div className="user-row"><div className="avatar">JH</div><div><strong>固件产品团队</strong><small>workspace member</small></div><span>•••</span></div></div>
      </aside>

      <section className="main-column">
        <header className="topbar"><div className="breadcrumbs"><span>工作台</span><b>/</b><strong>总览</strong></div><div className="top-actions"><span className="sync-dot">● 已同步 · 2026.07.28</span><button className="icon-button" aria-label="帮助">?</button><button className="share-button">⌘ 分享工作台</button></div></header>
        <div className="content-wrap">
          <section className="hero"><div><div className="kicker">FIRMWARE PRODUCT OPERATING SYSTEM <span>v0.1</span></div><h1>把知识库，变成<br /><i>能工作的产品系统。</i></h1><p>从版本差异到协议细节，在同一个工作台里查资料、定口径、产出可落地的固件 PRD。</p></div><div className="hero-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-core">MG<span>OS</span></div><div className="orbit-label label-top">知识</div><div className="orbit-label label-right">决策</div><div className="orbit-label label-bottom">交付</div></div></section>

          <section className="metrics"><div><span>知识条目</span><strong>128</strong><small>已整理 · 8 个专题</small></div><div><span>机型覆盖</span><strong>06</strong><small>C706 · C606 · C716 · EDR</small></div><div><span>协议口径</span><strong>24</strong><small>ANT+ Device Profile / BLE GATT</small></div><div><span>待确认</span><strong className="warning-number">07</strong><small>需要产品 / 研发确认</small></div></section>

          <section className="workbench-grid">
            <div className="knowledge-panel panel"><div className="panel-header"><div><span className="section-number">01</span><div><h2>知识库浏览</h2><p>从已确认资料中选取上下文</p></div></div><span className="count-badge">{filtered.length} 条</span></div><div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索专题、机型、协议…" /><kbd>⌘ K</kbd></div><div className="category-tabs">{categories.map((item) => <button key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="source-list">{filtered.map((item) => <button key={item.id} className={`source-card ${selected.includes(item.id) ? "chosen" : ""}`} onClick={() => toggleSource(item.id)}><div className="source-top"><span className="source-type">{item.kind}</span><span className="checkmark">{selected.includes(item.id) ? "✓" : "+"}</span></div><strong>{item.title}</strong><p>{item.summary}</p><div className="source-meta"><span>{item.category}</span>{item.tags.map((tag) => <em key={tag}>{tag}</em>)}</div></button>)}</div></div>

            <div className="generator-panel panel"><div className="panel-header"><div><span className="section-number coral">02</span><div><h2>AI 产品助手</h2><p>基于选中资料生成可追溯结果</p></div></div><span className="ai-status"><span/> AI READY</span></div><div className="selected-context"><div className="context-label">已选上下文 <span>{selected.length} / 3</span></div><div className="context-chips">{sources.filter((source) => selected.includes(source.id)).map((source) => <span key={source.id}>{source.title}<button onClick={() => toggleSource(source.id)} aria-label={`移除 ${source.title}`}>×</button></span>)}</div></div><label className="prompt-label" htmlFor="prompt">你想完成什么？</label><textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} /><div className="quick-prompts"><button onClick={() => setPrompt("请基于选中资料，生成一个新功能 PRD 初稿，必须按目标人群、物理层、协议层、App 层、异常处理、验收标准组织。")}>生成 PRD 初稿</button><button onClick={() => setPrompt("请对选中资料做一次固件可实现性评审，列出证据、风险、待确认问题和建议方案。")}>做可实现性评审</button></div><button className="generate-button" onClick={generate} disabled={loading || !selected.length}>{loading ? "正在整理知识库…" : "开始生成结果  →"}</button><div className="output-card"><div className="output-label"><span>{output.eyebrow}</span><button aria-label="复制结果" onClick={() => navigator.clipboard?.writeText(`${output.title}\n\n${output.body}`)}>↗</button></div><h3>{output.title}</h3><p>{output.body}</p>{output.sources && <div className="output-sources">来源：{output.sources.map((source: string) => <span key={source}>{source}</span>)}</div>}</div></div>
          </section>
          <footer className="footer-note"><span>◆</span> 资料来自当前知识库快照 · 生成结果仅作为产品讨论草稿，冲突与不确定项必须回到原始文档确认 <a href="#">查看工作台规范 →</a></footer>
        </div>
      </section>
    </main>
  );
}
