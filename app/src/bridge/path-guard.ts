import * as path from 'node:path';
import * as fs from 'node:fs';
import { BridgeError } from './errors';

// ============================================================================
// 路径安全约束：所有文件 / 进程操作都必须被约束在固定的 MFP 根目录内。
// 对齐 Issue #1「Limit process and file operations to the selected MFP workspace」。
//
// 拒绝三类越界：
//  1. `..` 相对路径穿越
//  2. 绝对路径落在 root 之外
//  3. 已存在路径通过符号链接逃逸出 root（按真实路径判定）
// ============================================================================

export class PathGuard {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** 把用户 / Agent 提供的相对路径解析到 root 内；越界抛 INVALID_PATH。 */
  resolve(rel: string): string {
    if (typeof rel !== 'string' || rel.trim().length === 0) {
      throw new BridgeError('INVALID_PATH', '路径不能为空');
    }
    const abs = path.resolve(this.root, rel);
    this.assertInside(abs);
    return abs;
  }

  /** 断言绝对路径位于 root 内（含符号链接逃逸检查）。 */
  assertInside(absPath: string): void {
    const abs = path.resolve(absPath);
    const rel = path.relative(this.root, abs);
    if (rel === '' || rel === '.') return; // 根目录本身
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BridgeError('INVALID_PATH', `路径越出 MFP 根目录：${abs}`);
    }
    this.assertNoSymlinkEscape(abs);
  }

  /**
   * 符号链接逃逸检查：从目标路径向上找到最近存在的祖先，用真实路径与
   * root 的真实路径比较。仅当 root 已存在时才有意义（否则无现存路径可逃逸）。
   */
  private assertNoSymlinkEscape(absPath: string): void {
    if (!fs.existsSync(this.root)) return;

    let realRoot: string;
    try {
      realRoot = fs.realpathSync(this.root);
    } catch {
      return; // root 真实路径不可得，跳过符号链接层（字符串层已校验）
    }

    let cur = absPath;
    for (;;) {
      let real: string;
      try {
        real = fs.realpathSync(cur);
      } catch {
        const parent = path.dirname(cur);
        if (parent === cur) return; // 走到文件系统根，无现存路径
        cur = parent;
        continue;
      }
      const rel = path.relative(realRoot, real);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new BridgeError('INVALID_PATH', `路径经符号链接逃出 MFP 根目录：${absPath} -> ${real}`);
      }
      return;
    }
  }
}
