import { BridgeError } from './errors';
import { isPlainObject } from './util';
import type { RecognitionResult, RecognitionCategory, RequestStatus, WorkPackage } from './types';

// 结构校验（纯函数，无 node 依赖）：判定 Agent / CLI 输出是否 malformed。

export const REQUEST_STATUSES: readonly RequestStatus[] = [
  'pending_recognition',
  'pending_confirmation',
  'pending_launch',
  'processing',
  'pending_answer',
  'pending_review',
  'revising',
  'completed',
  'archived',
  'error',
];

const RECOGNITION_CATEGORIES: readonly RecognitionCategory[] = [
  'feature_request',
  'bug',
  'consultation',
  'research',
  'invalid',
  'duplicate_candidate',
];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export function validateWorkPackage(v: unknown): ParseResult<WorkPackage> {
  if (!isPlainObject(v)) return { ok: false, reason: '工作包不是对象' };
  const o = v as Record<string, unknown>;
  if (typeof o.requestId !== 'string') return { ok: false, reason: '缺少 requestId' };
  if (typeof o.rawInputId !== 'string') return { ok: false, reason: '缺少 rawInputId' };
  if (typeof o.status !== 'string' || !REQUEST_STATUSES.includes(o.status as RequestStatus)) {
    return { ok: false, reason: `非法状态：${String(o.status)}` };
  }
  if (
    !isPlainObject(o.originalInput) ||
    typeof (o.originalInput as Record<string, unknown>).text !== 'string'
  ) {
    return { ok: false, reason: '缺少原始输入 originalInput.text' };
  }
  if (!Array.isArray(o.questions) || !Array.isArray(o.revisionComments) || !Array.isArray(o.runLog) || !Array.isArray(o.artifacts)) {
    return { ok: false, reason: 'questions/revisionComments/runLog/artifacts 字段非法' };
  }
  if (!isPlainObject(o.session)) return { ok: false, reason: '缺少 session 元数据' };
  return { ok: true, value: v as unknown as WorkPackage };
}

/** 解析工作包 JSON 文本（bad JSON / 非法结构 → malformed，不抛原始异常）。 */
export function parseWorkPackage(raw: string): ParseResult<WorkPackage> {
  try {
    return validateWorkPackage(JSON.parse(raw));
  } catch (e) {
    return { ok: false, reason: `JSON 解析失败：${(e as Error).message}` };
  }
}

export function validateRecognition(v: unknown): ParseResult<RecognitionResult> {
  if (!isPlainObject(v)) return { ok: false, reason: '识别结果不是对象' };
  const o = v as Record<string, unknown>;
  if (typeof o.category !== 'string' || !RECOGNITION_CATEGORIES.includes(o.category as RecognitionCategory)) {
    return { ok: false, reason: `非法类别：${String(o.category)}` };
  }
  if (typeof o.rewrittenRequirement !== 'string') return { ok: false, reason: '缺少 rewrittenRequirement' };
  if (typeof o.confidence !== 'number') return { ok: false, reason: '缺少 confidence' };
  return { ok: true, value: v as unknown as RecognitionResult };
}

/** 解析 CLI 的识别输出；malformed 时抛 MALFORMED_OUTPUT（不吞掉原始错误）。 */
export function parseRecognitionText(raw: string): RecognitionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new BridgeError('MALFORMED_OUTPUT', `识别输出不是合法 JSON：${(e as Error).message}`, raw);
  }
  const res = validateRecognition(parsed);
  if (!res.ok) {
    throw new BridgeError('MALFORMED_OUTPUT', `识别输出结构非法：${res.reason}`, parsed);
  }
  return res.value;
}
