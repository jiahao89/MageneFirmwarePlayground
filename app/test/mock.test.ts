import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recognizeDeterministic } from '../src/bridge/index';
import { runProcess, parseRecognitionText } from '../src/bridge/node';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeCli = path.resolve(here, '..', 'src', 'bridge', 'bin', 'fake-cli.mjs');

describe('mock 确定性与 fake CLI parity', () => {
  it('同一输入 → 同一输出（确定性）', () => {
    const a = recognizeDeterministic({ text: '码表闪退' });
    const b = recognizeDeterministic({ text: '码表闪退' });
    expect(a).toEqual(b);
  });

  it('关键词命中分类：bug / research', () => {
    expect(recognizeDeterministic({ text: '码表在爬坡时崩溃' }).category).toBe('bug');
    expect(recognizeDeterministic({ text: '请调研竞品的爬坡规划' }).category).toBe('research');
  });

  it('fake CLI 子进程输出与内存 mock 一致（parity）', async () => {
    const input = { text: '希望支持爬坡规划', sourceDescription: '竞品对比' };
    const res = await runProcess({
      command: process.execPath,
      args: [fakeCli],
      cwd: here,
      input: JSON.stringify(input),
    });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(recognizeDeterministic(input));
  });

  it('malformed 识别输出 → MALFORMED_OUTPUT', () => {
    expect(() => parseRecognitionText('not json')).toThrow(/不是合法 JSON/);
    expect(() => parseRecognitionText('{"category":"nope"}')).toThrow(/结构非法/);
  });
});
