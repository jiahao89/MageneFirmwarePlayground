import type { WorkPackage } from './types';

// ============================================================================
// 工作包存储抽象（纯类型 + 内存实现，无 node 依赖，浏览器 / Node 共用）。
// 文件实现见 file-work-package-store.ts（node-only）。
// ============================================================================

/** 运行时目录布局（相对 MFP 根目录；.mfp/ 已 gitignore）。 */
export const WORK_DIR = '.mfp/work';

export function workPackageFileName(requestId: string): string {
  return `${WORK_DIR}/${requestId}.json`;
}

export function startupFileName(requestId: string): string {
  return `${WORK_DIR}/${requestId}.startup.txt`;
}

export type StoreLoadResult =
  | { kind: 'ok'; workPackage: WorkPackage }
  | { kind: 'missing' }
  | { kind: 'malformed'; reason: string; raw: string };

export interface WorkPackageStore {
  save(workPackage: WorkPackage): Promise<void>;
  load(requestId: string): Promise<StoreLoadResult>;
  list(): Promise<WorkPackage[]>;
}

export class InMemoryWorkPackageStore implements WorkPackageStore {
  private readonly map = new Map<string, WorkPackage>();

  async save(workPackage: WorkPackage): Promise<void> {
    this.map.set(workPackage.requestId, workPackage);
  }

  async load(requestId: string): Promise<StoreLoadResult> {
    const wp = this.map.get(requestId);
    return wp ? { kind: 'ok', workPackage: wp } : { kind: 'missing' };
  }

  async list(): Promise<WorkPackage[]> {
    return [...this.map.values()];
  }
}

/** malformed 时的诊断态工作包：原文件保留在磁盘，不覆盖。 */
export function buildDiagnosticWorkPackage(requestId: string, reason: string): WorkPackage {
  return {
    requestId,
    rawInputId: requestId,
    status: 'error',
    originalInput: { rawInputId: requestId, text: '', createdAt: '' },
    recognition: null,
    taskCard: null,
    questions: [],
    revisionComments: [],
    runLog: [],
    session: {
      lastError: { code: 'MALFORMED_STATE', category: 'state', message: reason },
    },
    artifacts: [],
    updatedAt: '',
  };
}
