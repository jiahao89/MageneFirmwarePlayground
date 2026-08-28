import * as fs from 'node:fs';
import * as path from 'node:path';
import { BridgeError } from './errors';
import { PathGuard } from './path-guard';
import { parseWorkPackage } from './validate';
import { buildDiagnosticWorkPackage } from './work-package-store';
import type { WorkPackageStore, StoreLoadResult } from './work-package-store';
import type { WorkPackage } from './types';

// ============================================================================
// 文件工作包存储（node-only）：本地文件为事实源，重启后仍可恢复。
//  - 布局：<root>/.mfp/work/<requestId>.json
//  - 写：目录 + 每文件锁（防并发写入）+ 临时文件原子 rename
//  - 读：坏 JSON / 非法状态 → malformed 诊断态，保留原文件
// ============================================================================

const WORK_DIR = '.mfp/work';
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class FileWorkPackageStore implements WorkPackageStore {
  private readonly guard: PathGuard;
  private readonly workDir: string;

  constructor(root: string) {
    this.guard = new PathGuard(root);
    this.workDir = this.guard.resolve(WORK_DIR);
  }

  private filePathFor(requestId: string): string {
    if (!ID_PATTERN.test(requestId)) {
      throw new BridgeError('INVALID_ARGUMENT', `非法 requestId：${requestId}`);
    }
    return this.guard.resolve(path.join(WORK_DIR, `${requestId}.json`));
  }

  async save(workPackage: WorkPackage): Promise<void> {
    const filePath = this.filePathFor(workPackage.requestId);
    fs.mkdirSync(this.workDir, { recursive: true });
    this.writeLocked(filePath, JSON.stringify(workPackage, null, 2));
  }

  async load(requestId: string): Promise<StoreLoadResult> {
    const filePath = this.filePathFor(requestId);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
      return { kind: 'malformed', reason: `读取失败：${(e as Error).message}`, raw: '' };
    }
    const parsed = parseWorkPackage(raw);
    if (parsed.ok) return { kind: 'ok', workPackage: parsed.value };
    return { kind: 'malformed', reason: parsed.reason, raw };
  }

  async list(): Promise<WorkPackage[]> {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.workDir);
    } catch {
      return [];
    }
    const result: WorkPackage[] = [];
    for (const name of entries.sort()) {
      if (!name.endsWith('.json')) continue;
      const requestId = name.slice(0, -'.json'.length);
      const loaded = await this.load(requestId);
      if (loaded.kind === 'ok') result.push(loaded.workPackage);
      else if (loaded.kind === 'malformed') result.push(buildDiagnosticWorkPackage(requestId, loaded.reason));
    }
    return result;
  }

  /** 每文件锁 + 原子写：拒绝并发写入，避免半写。 */
  private writeLocked(filePath: string, data: string): void {
    const lockPath = `${filePath}.lock`;
    let fd: number | null = null;
    try {
      fd = fs.openSync(lockPath, 'wx'); // 排他创建：已存在即并发冲突
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new BridgeError('CONCURRENT_WRITE', `工作包正在被并发写入：${filePath}`);
      }
      throw e;
    }
    try {
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, data, 'utf8');
      fs.renameSync(tmp, filePath);
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* noop */
        }
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* noop */
      }
    }
  }
}
