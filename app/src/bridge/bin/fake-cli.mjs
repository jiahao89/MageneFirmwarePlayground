#!/usr/bin/env node
// 确定性 fake CLI：读取 stdin 的 JSON（{text, sourceDescription}），输出 RecognitionResult JSON。
// 与 src/bridge/mock.ts 保持同步（parity 测试锁定二者输出一致）。
// 用法：echo '{"text":"..."}' | node bin/fake-cli.mjs

const KEYWORD_RULES = [
  { category: 'bug', keywords: ['bug', '崩溃', '闪退', '卡死', '异常', '报错'] },
  { category: 'research', keywords: ['调研', '竞品', 'research', '对标'] },
  { category: 'consultation', keywords: ['咨询', '请教', '是什么', '为什么'] },
  { category: 'invalid', keywords: ['测试', 'test', 'asdf', '无效'] },
];

function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function recognize(input) {
  const text = (input.text || '').trim();
  const lower = text.toLowerCase();
  const matched = KEYWORD_RULES.find((r) => r.keywords.some((k) => lower.includes(k)));
  const category = matched ? matched.category : 'feature_request';
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

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(stdin || '{}');
  } catch {
    process.stdout.write(JSON.stringify({ error: 'MALFORMED_INPUT' }));
    process.exit(0);
    return;
  }
  process.stdout.write(JSON.stringify(recognize(input)));
  process.exit(0);
});
