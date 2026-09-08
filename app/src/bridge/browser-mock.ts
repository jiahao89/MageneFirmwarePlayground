import { WorkPackageBridge } from './work-package-bridge';
import { InMemoryWorkPackageStore } from './work-package-store';
import { recognizeDeterministic } from './mock';
import { hashString } from './util';
import type { RawInput, RecognitionResult, PreflightResult, PrdDocument } from './types';

// ============================================================================
// 浏览器 / 纯前端 mock 桥：内存存储 + 确定性 mock 识别，满足「mock 可被前端调用」。
// 浏览器无法 spawn 进程，识别走内存确定性函数。
//
// Issue #18：readPrd 走内存演示数据（显式 mock，内容带「mock」标注，
// 不落盘、不冒充真实文件）；正式桌面模式使用 LocalBridge 的真实实现。
// ============================================================================

export class BrowserMockBridge extends WorkPackageBridge {
  /** 内存演示 PRD（requestId → mock 文档）；显式注册才可见。 */
  private readonly demoPrds = new Map<string, { content: string; version: number }>();

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

  /** 注册 mock 演示 PRD（内容自动带 mock 标注，不会冒充真实文件）。 */
  registerDemoPrd(requestId: string, content: string, version = 1): void {
    this.demoPrds.set(requestId, { content: `${content}\n\n> ⚠️ mock 演示数据（非真实文件）`, version });
  }

  /** mock readPrd：仅返回显式注册的演示文档；哈希为确定性 mock 哈希。 */
  override async readPrd(requestId: string): Promise<PrdDocument> {
    await this.readWorkPackage(requestId); // 校验工作包存在性（缺失抛 INVALID_ARGUMENT）
    const demo = this.demoPrds.get(requestId);
    if (!demo) return { state: 'not_generated', requestId };
    return {
      state: 'ready',
      requestId,
      path: `output/mock/${requestId}/02-PRD.md`,
      version: demo.version,
      content: demo.content,
      contentHash: `mock-${hashString(demo.content)}`,
    };
  }
}
