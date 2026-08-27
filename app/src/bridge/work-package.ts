import * as fs from 'node:fs';
import { parseWorkPackage, validateWorkPackage } from './validate';
import type { WorkPackage } from './types';

export { validateWorkPackage, parseWorkPackage };

// ============================================================================
// 工作包文件读写 + malformed 状态处理。
// 对齐 Issue #1「If an Agent writes malformed JSON or an invalid status,
// preserve the raw file, show a diagnostic state, and do not silently infer
// success」。
//
// 完整持久化布局（目录 / 文件命名 / 状态迁移）由 Issue #2 负责；此处只提供
// 契约层的纯解析 / 原子读写原语。
// ============================================================================

export type WorkPackageFileResult =
  | { state: 'ok'; workPackage: WorkPackage; raw: string }
  | { state: 'malformed'; reason: string; raw: string };

/**
 * 读取工作包文件。malformed（坏 JSON / 非法状态 / 字段缺失）时：
 *  - 不抛原始异常，返回诊断态
 *  - 保留原始文本（raw），绝不覆盖现场
 */
export function readWorkPackageFile(filePath: string): WorkPackageFileResult {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { state: 'malformed', reason: `读取失败：${(e as Error).message}`, raw: '' };
  }
  const parsed = parseWorkPackage(raw);
  if (parsed.ok) return { state: 'ok', workPackage: parsed.value, raw };
  return { state: 'malformed', reason: parsed.reason, raw };
}

/** 原子写入：写临时文件后 rename，避免半写状态。 */
export function writeWorkPackageFile(filePath: string, wp: WorkPackage): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(wp, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}
