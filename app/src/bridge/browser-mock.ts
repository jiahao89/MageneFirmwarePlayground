import { WorkPackageBridge } from './work-package-bridge';
import { InMemoryWorkPackageStore } from './work-package-store';
import { recognizeDeterministic } from './mock';
import type { RawInput, RecognitionResult, PreflightResult } from './types';

// ============================================================================
// 浏览器 / 纯前端 mock 桥：内存存储 + 确定性 mock 识别，满足「mock 可被前端调用」。
// 浏览器无法 spawn 进程，识别走内存确定性函数。
// ============================================================================

export class BrowserMockBridge extends WorkPackageBridge {
  constructor(now?: () => string) {
    super({
      now: now ?? (() => new Date().toISOString()),
      store: new InMemoryWorkPackageStore(),
      recognizeRaw: async (raw: RawInput): Promise<RecognitionResult> =>
        recognizeDeterministic({ text: raw.text, sourceDescription: raw.sourceDescription }),
      preflightRaw: async (): Promise<PreflightResult> => ({
        ok: true,
        checks: [{ name: 'mock', ok: true, detail: '浏览器 mock 模式（无真实 CLI）' }],
      }),
    });
  }
}
