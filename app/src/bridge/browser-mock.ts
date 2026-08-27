import { InMemoryBridge } from './in-memory-bridge';
import { recognizeDeterministic } from './mock';
import type { RawInput, RecognitionResult, PreflightResult } from './types';

// ============================================================================
// 浏览器 / 纯前端 mock 桥：不接真实 CLI，用确定性 mock 数据满足「mock 可被
// 前端调用」。识别走内存确定性函数（浏览器无法 spawn 进程）。
// ============================================================================

export class BrowserMockBridge extends InMemoryBridge {
  constructor(now?: () => string) {
    super({
      now: now ?? (() => new Date().toISOString()),
      recognizeRaw: async (raw: RawInput): Promise<RecognitionResult> =>
        recognizeDeterministic({ text: raw.text, sourceDescription: raw.sourceDescription }),
      preflightRaw: async (): Promise<PreflightResult> => ({
        ok: true,
        checks: [{ name: 'mock', ok: true, detail: '浏览器 mock 模式（无真实 CLI）' }],
      }),
    });
  }
}
