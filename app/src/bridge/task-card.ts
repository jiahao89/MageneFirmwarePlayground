import { isPlainObject } from './util';
import type { TaskCard, RecognitionResult } from './types';

// ============================================================================
// 任务卡（TaskCard）：注册时创建的可变工作契约。
// 对齐 Issue #1「Registration and work package」的 task card 字段。
// ============================================================================

export type TaskCardValidation = { ok: true; value: TaskCard } | { ok: false; reason: string };

export function validateTaskCard(v: unknown): TaskCardValidation {
  if (!isPlainObject(v)) return { ok: false, reason: '任务卡不是对象' };
  const o = v as Record<string, unknown>;
  if (typeof o.currentPhase !== 'string') return { ok: false, reason: '缺少 currentPhase' };
  if (typeof o.goal !== 'string') return { ok: false, reason: '缺少 goal' };
  const arrays = [
    'confirmedScope',
    'unresolvedQuestions',
    'allowedContext',
    'expectedOutputs',
    'writeBackRules',
    'pauseConditions',
    'prohibitedActions',
  ];
  for (const k of arrays) {
    if (!Array.isArray(o[k])) return { ok: false, reason: `任务卡字段非法：${k}` };
  }
  return { ok: true, value: v as unknown as TaskCard };
}

/** 注册时根据识别结果构建默认任务卡；「理解与澄清」为注册后第一阶段。 */
export function buildTaskCard(recognition: RecognitionResult | null): TaskCard {
  return {
    currentPhase: 'understand_and_clarify',
    goal: recognition?.rewrittenRequirement || '（待确认）',
    confirmedScope: recognition?.scopeClues ?? [],
    unresolvedQuestions: recognition?.missingInformation ?? [],
    allowedContext: [
      'AGENTS.md',
      'CLAUDE.md',
      'knowledge-base/01_事实源/BENCHMARK.md',
      'knowledge-base/03_人群与方法论',
    ],
    expectedOutputs: ['澄清问题（写回工作包）', '02-PRD.md（评审后产出）'],
    writeBackRules: ['问题 / 状态 / 日志 / 产出必须写回工作包文件'],
    pauseConditions: ['信息不足时暂停并向 PM 提问'],
    prohibitedActions: ['不得自动修改 benchmark / 确认知识库', '不得保存 API key'],
  };
}
