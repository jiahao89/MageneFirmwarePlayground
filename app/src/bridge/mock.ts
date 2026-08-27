import { truncate } from './util';
import type { RecognitionResult, RecognitionCategory, RawInput } from './types';

// ============================================================================
// 确定性 mock：同一输入 → 同一输出（无随机、无墙钟）。
// 供前端（浏览器 / Tauri dev 未接真实 CLI 时）直接调用。
//
// 注意：与 bin/fake-cli.mjs 保持同步（parity 测试锁定二者输出一致）。
// ============================================================================

const KEYWORD_RULES: Array<{ category: RecognitionCategory; keywords: string[] }> = [
  { category: 'bug', keywords: ['bug', '崩溃', '闪退', '卡死', '异常', '报错'] },
  { category: 'research', keywords: ['调研', '竞品', 'research', '对标'] },
  { category: 'consultation', keywords: ['咨询', '请教', '是什么', '为什么'] },
  { category: 'invalid', keywords: ['测试', 'test', 'asdf', '无效'] },
];

/** 确定性识别：仅由输入文本决定输出。 */
export function recognizeDeterministic(input: { text: string; sourceDescription?: string }): RecognitionResult {
  const text = (input.text ?? '').trim();
  const lower = text.toLowerCase();

  const matched = KEYWORD_RULES.find((r) => r.keywords.some((k) => lower.includes(k)));
  const category: RecognitionCategory = matched?.category ?? 'feature_request';
  const isInvalid = category === 'invalid' || text.length < 4;

  return {
    category: isInvalid ? 'invalid' : category,
    rewrittenRequirement:
      text.length > 0
        ? `作为码表用户，我希望「${truncate(text, 40)}」能够被正式评估，以便形成可执行的固件需求。`
        : '',
    user: '码表用户（待确认）',
    scenario: '未明确（mock 缺场景信息）',
    goal: truncate(text, 60) || '（待确认）',
    scopeClues: [],
    knownConstraints: ['mock 数据：无事实源证据'],
    missingInformation: ['场景与目标人群待澄清', '期望行为与验收标准待明确'],
    evidence: [],
    duplicateCandidates: [],
    confidence: text.length >= 20 ? 0.7 : 0.5,
  };
}

export function buildMockRecognition(rawInput: RawInput): RecognitionResult {
  return recognizeDeterministic({ text: rawInput.text, sourceDescription: rawInput.sourceDescription });
}
