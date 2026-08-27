import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PathGuard } from '../src/bridge/node';
import { BridgeError } from '../src/bridge/index';

let tmp: string;
let root: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-pathguard-'));
  root = path.join(tmp, 'mfp');
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('PathGuard（路径安全约束）', () => {
  it('允许根目录内的相对路径', () => {
    const g = new PathGuard(root);
    expect(g.resolve('work/a.json')).toBe(path.join(root, 'work', 'a.json'));
  });

  it('拒绝 `..` 路径穿越', () => {
    const g = new PathGuard(root);
    expect(() => g.resolve('../outside.txt')).toThrowError(BridgeError);
    expect(() => g.resolve('work/../../outside.txt')).toThrow(/越出 MFP 根目录/);
  });

  it('拒绝绝对路径落在根目录之外', () => {
    const g = new PathGuard(root);
    expect(() => g.resolve('/etc/passwd')).toThrowError(BridgeError);
  });

  it('拒绝空路径', () => {
    const g = new PathGuard(root);
    expect(() => g.resolve('   ')).toThrowError(BridgeError);
  });

  it('拒绝通过符号链接逃逸', () => {
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
    fs.symlinkSync(outside, path.join(root, 'link'), 'dir');

    const g = new PathGuard(root);
    expect(() => g.resolve('link/secret.txt')).toThrow(/符号链接/);
  });

  it('根目录不存在时仍拒绝 `..`（字符串层校验）', () => {
    const g = new PathGuard(path.join(tmp, 'does-not-exist'));
    expect(() => g.resolve('../x')).toThrowError(BridgeError);
  });
});
