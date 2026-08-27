import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readWorkPackageFile,
  writeWorkPackageFile,
  parseWorkPackage,
} from '../src/bridge/node';
import type { WorkPackage } from '../src/bridge/index';

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-wp-'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function valid(): WorkPackage {
  return {
    requestId: 'REQ-1',
    rawInputId: 'RAW-1',
    status: 'pending_launch',
    originalInput: { rawInputId: 'RAW-1', text: 'hello', createdAt: 't' },
    recognition: null,
    taskCard: null,
    questions: [],
    revisionComments: [],
    runLog: [],
    session: {},
    artifacts: [],
    updatedAt: 't',
  };
}

describe('工作包 malformed 状态处理', () => {
  it('坏 JSON → 诊断态，保留原始文本', () => {
    const file = path.join(tmp, 'bad.json');
    const raw = '{ not json';
    fs.writeFileSync(file, raw);
    const res = readWorkPackageFile(file);
    expect(res.state).toBe('malformed');
    expect(res.raw).toBe(raw);
  });

  it('非法状态 → malformed，不抛原始异常', () => {
    const bad = { ...valid(), status: 'not_a_status' };
    const res = parseWorkPackage(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/非法状态/);
  });

  it('缺字段 → malformed', () => {
    const bad = { requestId: 'REQ-1', status: 'completed' };
    const res = parseWorkPackage(JSON.stringify(bad));
    expect(res.ok).toBe(false);
  });

  it('非法任务卡 → malformed', () => {
    const bad = { ...valid(), taskCard: { currentPhase: 123, goal: 'x' } };
    const res = parseWorkPackage(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/任务卡非法/);
  });

  it('合法工作包 → ok', () => {
    const res = parseWorkPackage(JSON.stringify(valid()));
    expect(res.ok).toBe(true);
  });

  it('write→read 往返，且不残留 .tmp', () => {
    const file = path.join(tmp, 'ok.json');
    writeWorkPackageFile(file, valid());
    const res = readWorkPackageFile(file);
    expect(res.state).toBe('ok');
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });
});
