import { useState } from 'react';
import { getBridge } from './bridge-adapter';
import type { RecognitionResult, WorkPackage, BridgeErrorPayload } from '../bridge/index';

// 最小可运行页面：验证 mock 可被前端调用。完整视觉设计不在 Issue #7 范围。

const bridge = getBridge();

type Phase =
  | { kind: 'idle' }
  | { kind: 'recognized'; rawInputId: string; recognition: RecognitionResult }
  | { kind: 'registered'; workPackage: WorkPackage }
  | { kind: 'error'; error: BridgeErrorPayload };

export function App() {
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setPhase({ kind: 'idle' });
    try {
      const raw = await bridge.saveRawInput({ text, sourceDescription: source });
      const recognition = await bridge.recognize(raw.rawInputId);
      setPhase({ kind: 'recognized', rawInputId: raw.rawInputId, recognition });
    } catch (e) {
      setPhase({ kind: 'error', error: toPayload(e) });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (phase.kind !== 'recognized') return;
    setBusy(true);
    try {
      const wp = await bridge.register(phase.rawInputId);
      await bridge.launch(wp.requestId);
      const updated = await bridge.readWorkPackage(wp.requestId);
      setPhase({ kind: 'registered', workPackage: updated });
    } catch (e) {
      setPhase({ kind: 'error', error: toPayload(e) });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setText('');
    setSource('');
    setPhase({ kind: 'idle' });
  }

  return (
    <main className="shell">
      <h1>MFP 本地工作台（MVP 骨架）</h1>
      <p className="muted">桥接契约为 mock 模式，验证「前端可调用 bridge」。真实 CLI 由后续 Issue 接入。</p>

      <section className="panel">
        <label>原始需求</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴客户消息…"
          rows={4}
        />
        <label>来源说明（可选）</label>
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="例如：用户反馈 / 竞品对比" />
        <div className="actions">
          <button onClick={run} disabled={busy || text.trim().length === 0}>
            {busy ? '处理中…' : '保存并识别'}
          </button>
          {phase.kind === 'recognized' && (
            <button onClick={confirm} disabled={busy}>
              确认登记并启动
            </button>
          )}
          <button onClick={reset} disabled={busy}>
            重置
          </button>
        </div>
      </section>

      <section className="panel">
        {phase.kind === 'idle' && <p className="muted">等待输入…</p>}
        {phase.kind === 'error' && (
          <div className="error">
            <strong>{phase.error.code}</strong>
            <span>{phase.error.message}</span>
          </div>
        )}
        {phase.kind === 'recognized' && (
          <div>
            <h2>识别结果（mock）</h2>
            <dl>
              <dt>分类</dt>
              <dd>{phase.recognition.category}</dd>
              <dt>重写需求</dt>
              <dd>{phase.recognition.rewrittenRequirement}</dd>
              <dt>置信度</dt>
              <dd>{phase.recognition.confidence}</dd>
              <dt>缺失信息</dt>
              <dd>{phase.recognition.missingInformation.join('；')}</dd>
            </dl>
          </div>
        )}
        {phase.kind === 'registered' && (
          <div>
            <h2>已登记工作包（mock）</h2>
            <dl>
              <dt>requestId</dt>
              <dd>{phase.workPackage.requestId}</dd>
              <dt>状态</dt>
              <dd>{phase.workPackage.status}</dd>
              <dt>sessionId</dt>
              <dd>{phase.workPackage.session.sessionId ?? '—'}</dd>
            </dl>
          </div>
        )}
      </section>
    </main>
  );
}

function toPayload(e: unknown): BridgeErrorPayload {
  if (e && typeof e === 'object' && 'payload' in e) return (e as { payload: BridgeErrorPayload }).payload;
  return { code: 'MALFORMED_STATE', category: 'state', message: String(e) };
}
