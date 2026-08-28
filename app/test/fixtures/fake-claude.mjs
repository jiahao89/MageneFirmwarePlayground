#!/usr/bin/env node
// 确定性 fake `claude` 二进制（测试专用）：模拟 Claude Code CLI 的关键行为。
//
// 行为控制：
//   参数含 --version            → 输出版本
//   参数含 -p（stdin 提示词）    → 输出 -p --output-format json 信封
//   env FAKE_CLAUDE_AUTH_FAIL=1 → 认证错误（exit 1 + stderr）
//   env FAKE_CLAUDE_BAD_ENVELOPE=1 → 输出非法信封
//   env FAKE_CLAUDE_VERSION       → 覆盖版本文本

const args = process.argv.slice(2);

if (args.includes('--version')) {
  process.stdout.write(process.env.FAKE_CLAUDE_VERSION || '2.1.229 (Claude Code)');
  process.exit(0);
} else if (args.includes('-p') || args.includes('--print')) {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (stdin += d));
  process.stdin.on('end', () => {
    if (process.env.FAKE_CLAUDE_AUTH_FAIL === '1') {
      process.stderr.write('Error: Invalid API key · invalid credentials (401). Run `claude` to login.');
      process.exit(1);
    }
    if (process.env.FAKE_CLAUDE_BAD_ENVELOPE === '1') {
      process.stdout.write('this is not a json envelope');
      process.exit(0);
    }
    const isRecognition = stdin.includes('你是固件需求识别器');
    const result = isRecognition
      ? JSON.stringify({
          category: 'feature_request',
          rewrittenRequirement: '作为码表用户，我希望该反馈被正式评估。',
          user: '码表用户（待确认）',
          scenario: '未明确（fake CLI）',
          goal: '评估该反馈',
          scopeClues: [],
          knownConstraints: [],
          missingInformation: ['场景与目标人群待澄清'],
          evidence: [],
          duplicateCandidates: [],
          confidence: 0.7,
        })
      : 'ok';
    const envelope = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 'fake-session-0001',
      result,
    };
    process.stdout.write(JSON.stringify(envelope));
    process.exit(0);
  });
} else {
  // 其余参数（交互会话等）：fake 二进制不真正启动，直接成功。
  process.stdout.write('fake claude: interactive session not supported in fixture');
  process.exit(0);
}
