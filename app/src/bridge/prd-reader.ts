import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BridgeError } from './errors';
import { PathGuard } from './path-guard';
import type { PrdDocument, PrdExpectedSnapshot, WorkPackage } from './types';

// ============================================================================
// 真实 PRD 文件读取（Issue #18）。
//
// 路径策略（复用工作区路径约束）：
//  - 必须是项目内相对路径（绝对路径 / `..` 穿越 → INVALID_PATH）；
//  - 必须位于 `output/` 前缀下且为 Markdown（.md）；
//  - PathGuard 解析含符号链接逃逸检查（已存在路径按真实路径判定）。
//
// 读取一致性（Agent 正在写入 / 读写竞争）：
//  - 读取前后 stat 比对（size + mtime），不一致重试，仍不稳定 → PRD_CHANGED；
//  - 文件丢失 → PRD_NOT_FOUND；不可读 → PRD_READ_FAILED；空文档 → PRD_INVALID。
//
// 本模块只读，绝不改写用户文件；历史工作包不一致时给诊断（错误信息），不重写。
// ============================================================================

/** PRD 允许的产出区前缀（对齐 MFP 产出规范 output/{需求名}/）。 */
export const PRD_ALLOWED_PREFIX = 'output/';

/** 读取竞争重试次数（Agent 正在写入时短重试，避免把瞬时写入当失败）。 */
const READ_ATTEMPTS = 3;

/** 归一化 prdPath：反斜杠转正斜杠 + posix normalize；越界在前缀层先拒绝。 */
export function normalizePrdRelPath(prdPath: string): string {
  if (typeof prdPath !== 'string' || prdPath.trim().length === 0) {
    throw new BridgeError('PRD_INVALID', '工作包 prdPath 为空或缺失（产物登记不完整）');
  }
  const normalized = path.posix.normalize(prdPath.replace(/\\/g, '/').trim());
  if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new BridgeError('INVALID_PATH', `prdPath 必须是项目内相对路径：${prdPath}`);
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new BridgeError('INVALID_PATH', `路径越出 MFP 根目录：${prdPath}`);
  }
  if (!normalized.startsWith(PRD_ALLOWED_PREFIX)) {
    throw new BridgeError('INVALID_PATH', `PRD 必须位于 ${PRD_ALLOWED_PREFIX} 产出区内：${prdPath}`);
  }
  if (!normalized.toLowerCase().endsWith('.md')) {
    throw new BridgeError('PRD_INVALID', `PRD 必须是 Markdown 文件：${prdPath}`);
  }
  return normalized;
}

/** 校验并解析 prdPath 到 root 内的绝对路径（含符号链接逃逸检查）。 */
export function resolvePrdPath(prdPath: string, guard: PathGuard): string {
  return guard.resolve(normalizePrdRelPath(prdPath));
}

/** SHA-256（hex）：readPrd 与 complete 门禁共用同一哈希口径。 */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** 校验工作包的 prdVersion（Issue #18：版本无效不给读取成功）。 */
function requireValidVersion(wp: Pick<WorkPackage, 'requestId' | 'prdVersion'>): number {
  const v = wp.prdVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new BridgeError(
      'PRD_INVALID',
      `PRD 版本无效：${String(v)}（须为 ≥1 的整数，请检查工作包 prdVersion）`,
      { requestId: wp.requestId, prdVersion: v },
    );
  }
  return v;
}

/**
 * 读取当前工作包登记的真实 PRD 文档。
 *  - 无 prdPath → `{ state: 'not_generated' }`（不是错误）；
 *  - 其余情况返回同次读取的 content / contentHash / version。
 */
export function readPrdDocument(
  wp: Pick<WorkPackage, 'requestId' | 'prdPath' | 'prdVersion'>,
  guard: PathGuard,
): PrdDocument {
  if (!wp.prdPath) return { state: 'not_generated', requestId: wp.requestId };
  const version = requireValidVersion(wp);
  const relPath = normalizePrdRelPath(wp.prdPath);
  const abs = guard.resolve(relPath);

  let statBefore: fs.Stats;
  try {
    statBefore = fs.statSync(abs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      throw new BridgeError('PRD_NOT_FOUND', `PRD 文件不存在：${relPath}（产物可能被移动或删除）`, { requestId: wp.requestId, path: relPath });
    }
    throw new BridgeError('PRD_READ_FAILED', `PRD 文件无法访问（${code ?? 'stat 失败'}）：${relPath}`, { requestId: wp.requestId, path: relPath });
  }
  if (!statBefore.isFile()) {
    throw new BridgeError('PRD_NOT_FOUND', `PRD 路径不是普通文件：${relPath}`, { requestId: wp.requestId, path: relPath });
  }

  // 读取一致性：读前/读后 stat 比对；Agent 正在写入时短重试，仍不稳定 → PRD_CHANGED
  for (let attempt = 1; ; attempt++) {
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        throw new BridgeError('PRD_CHANGED', `PRD 文件在读取期间被删除：${relPath}`, { requestId: wp.requestId, path: relPath });
      }
      throw new BridgeError('PRD_READ_FAILED', `PRD 文件读取失败（${code ?? 'IO 错误'}）：${relPath}`, { requestId: wp.requestId, path: relPath });
    }
    let statAfter: fs.Stats;
    try {
      statAfter = fs.statSync(abs);
    } catch {
      throw new BridgeError('PRD_CHANGED', `PRD 文件在读取期间被删除：${relPath}`, { requestId: wp.requestId, path: relPath });
    }
    if (statAfter.size === statBefore.size && statAfter.mtimeMs === statBefore.mtimeMs) {
      if (content.trim().length === 0) {
        throw new BridgeError('PRD_INVALID', `PRD 文档为空：${relPath}（产物写回不完整）`, { requestId: wp.requestId, path: relPath });
      }
      return { state: 'ready', requestId: wp.requestId, path: relPath, version, content, contentHash: sha256Hex(content) };
    }
    if (attempt >= READ_ATTEMPTS) {
      throw new BridgeError('PRD_CHANGED', `PRD 正在被写入，读取不稳定：${relPath}（请稍后重试）`, { requestId: wp.requestId, path: relPath });
    }
    statBefore = statAfter;
  }
}

/**
 * 产物有效性校验（Issue #18 产物写回门禁）：Agent 声称 pending_review 时，
 * 工作包必须已登记 prdPath、版本有效、文件存在且非空。
 * 返回诊断消息；有效返回 undefined（只读，不改写用户文件）。
 */
export function diagnosePrdArtifact(
  wp: Pick<WorkPackage, 'requestId' | 'prdPath' | 'prdVersion'>,
  guard: PathGuard,
): string | undefined {
  if (!wp.prdPath) return '工作包未登记 prdPath（Agent 未按契约写回产物路径）';
  try {
    requireValidVersion(wp);
    const relPath = normalizePrdRelPath(wp.prdPath);
    const abs = guard.resolve(relPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return `PRD 文件不存在：${relPath}`;
    }
    if (!stat.isFile()) return `PRD 路径不是普通文件：${relPath}`;
    if (stat.size === 0) return `PRD 文件为空：${relPath}`;
    return undefined; // 有效
  } catch (e) {
    // prdPath/版本本身非法 → 直接把该诊断作为结果返回（不抛出）
    if (e instanceof BridgeError) return e.payload.message;
    return String(e);
  }
}

/**
 * 完成门禁校验（Issue #18）：当前产物必须与 PM 审阅时的快照一致。
 * 校验通过返回就绪文档（供 complete 落盘 confirmedPrd）。
 */
export function assertPrdMatchesReview(
  wp: Pick<WorkPackage, 'requestId' | 'prdPath' | 'prdVersion'>,
  expected: PrdExpectedSnapshot,
  guard: PathGuard,
): Extract<PrdDocument, { state: 'ready' }> {
  const doc = readPrdDocument(wp, guard);
  if (doc.state !== 'ready') {
    throw new BridgeError('PRD_NOT_FOUND', `PRD 尚未生成，无法完成（${wp.requestId}）`, { requestId: wp.requestId });
  }
  if (doc.version !== expected.version) {
    throw new BridgeError(
      'PRD_CHANGED',
      `PRD 版本已变化：审阅时 v${expected.version}，当前 v${doc.version}；请重新审阅后再完成`,
      { requestId: wp.requestId, expectedVersion: expected.version, currentVersion: doc.version },
    );
  }
  if (doc.contentHash !== expected.contentHash) {
    throw new BridgeError(
      'PRD_CHANGED',
      'PRD 内容已变化（与审阅时不一致）；请重新审阅后再完成',
      { requestId: wp.requestId, expectedContentHash: expected.contentHash, currentContentHash: doc.contentHash },
    );
  }
  return doc;
}
