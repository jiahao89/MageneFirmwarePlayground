import { invoke } from '@tauri-apps/api/core';
import { BrowserMockBridge } from '../bridge/browser-mock';
import { BridgeError } from '../bridge/errors';
import type {
  MfpBridge,
  WorkPackage,
  RecognitionResult,
  SaveRawInputRequest,
  LaunchResult,
  PreflightResult,
  PreflightCheck,
} from '../bridge/index';

// ============================================================================
// 前端桥接适配器（Issue #19 真实 PRD 预览与集中问答扩展）：
//  - 运行在 Tauri 桌面壳内（window.__TAURI_INTERNALS__ 存在）→ 走 invoke 命令映射
//  - 纯浏览器 / dev（无 Tauri）→ 走确定性 mock（FrontendMockBridge），并明确标注 [Mock 演示模式]
//  - 契约接口扩展：
//      - readPrd(requestId): 返回 PrdDocument（包含状态、相对路径、工作包版本、Markdown 正文、SHA-256 哈希）
//      - submitAnswers(requestId, answers): 批量原子保存多题回答，不自动触发 resume
//      - complete(requestId, expectedPrd?): 携带用户预览时的快照（version, contentHash）防并发覆盖
// ============================================================================

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/** PRD 文档数据契约（对齐 Issue #19 共享接口） */
export type PrdDocument =
  | { state: 'not_generated'; requestId: string }
  | {
      state: 'ready';
      requestId: string;
      path: string; // 项目内相对路径，例如 output/REQ-xxx/02-PRD.md
      version: number; // WorkPackage.prdVersion
      content: string; // 磁盘 Markdown 原文
      contentHash: string; // 本次读取内容的 SHA-256
    };

export interface AnswerItem {
  questionId: string;
  answer: string;
}

export interface ExpectedPrdSnapshot {
  version: number;
  contentHash: string;
}

/** Web 前端增强桥接接口（兼容 MfpBridge 并扩展 Issue #19 接口） */
export interface WebBridge extends MfpBridge {
  readPrd(requestId: string): Promise<PrdDocument>;
  submitAnswers(requestId: string, answers: AnswerItem[]): Promise<WorkPackage>;
  complete(requestId: string, expectedPrd?: ExpectedPrdSnapshot): Promise<WorkPackage>;
}

export type MockScenario =
  | 'normal'
  | 'cli_not_installed'
  | 'not_authenticated'
  | 'root_missing'
  | 'launch_failed'
  | 'resume_fallback'
  | 'prd_not_found'
  | 'prd_read_failed'
  | 'prd_changed';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

/** 辅助哈希函数计算 SHA-256 */
export async function computeContentHash(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // 降级
    }
  }
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/** Tauri 壳内：把 WebBridge 操作映射到 Rust 命令。 */
class TauriBridge implements WebBridge {
  saveRawInput(req: SaveRawInputRequest): Promise<WorkPackage> {
    return invoke<WorkPackage>('save_raw_input', { req });
  }
  recognize(requestId: string): Promise<RecognitionResult> {
    return invoke<RecognitionResult>('recognize', { requestId });
  }
  register(requestId: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('register', { requestId });
  }
  listWorkPackages(): Promise<WorkPackage[]> {
    return invoke<WorkPackage[]>('list_work_packages');
  }
  readWorkPackage(requestId: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('read_work_package', { requestId });
  }
  preflight(requestId: string): Promise<PreflightResult> {
    return invoke<PreflightResult>('preflight', { requestId });
  }
  launch(requestId: string): Promise<LaunchResult> {
    return invoke<LaunchResult>('launch', { requestId });
  }
  resume(requestId: string): Promise<LaunchResult> {
    return invoke<LaunchResult>('resume', { requestId });
  }
  answerQuestion(requestId: string, questionId: string, answer: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('answer_question', { requestId, questionId, answer });
  }
  submitAnswers(requestId: string, answers: AnswerItem[]): Promise<WorkPackage> {
    return invoke<WorkPackage>('submit_answers', { requestId, answers });
  }
  submitRevision(requestId: string, comment: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('submit_revision', { requestId, comment });
  }
  complete(requestId: string, expectedPrd?: ExpectedPrdSnapshot): Promise<WorkPackage> {
    return invoke<WorkPackage>('complete', { requestId, expectedPrd });
  }
  archive(requestId: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('archive', { requestId });
  }
  readPrd(requestId: string): Promise<PrdDocument> {
    return invoke<PrdDocument>('read_prd', { requestId });
  }
}

/** 前端模拟桥：支持多场景切换、动态 PRD 文档生成与集中问答交互 */
export class FrontendMockBridge implements WebBridge {
  private baseMock: BrowserMockBridge;
  private scenario: MockScenario = 'normal';
  private mockPrdDocs = new Map<
    string,
    {
      path: string;
      version: number;
      content: string;
      contentHash: string;
    }
  >();

  constructor() {
    this.baseMock = new BrowserMockBridge();
  }

  setScenario(s: MockScenario) {
    this.scenario = s;
  }

  getScenario(): MockScenario {
    return this.scenario;
  }

  saveRawInput(req: SaveRawInputRequest): Promise<WorkPackage> {
    return this.baseMock.saveRawInput(req);
  }

  async recognize(requestId: string): Promise<RecognitionResult> {
    if (this.scenario === 'not_authenticated') {
      throw new BridgeError('CLI_AUTH_FAILED', 'Claude Code 认证失败：请在终端执行 `claude login` 或配置 API 凭据');
    }
    if (this.scenario === 'cli_not_installed') {
      throw new BridgeError('CLI_NOT_FOUND', '未找到 claude 可执行文件（请安装并登录 Claude Code）');
    }
    return this.baseMock.recognize(requestId);
  }

  async register(requestId: string): Promise<WorkPackage> {
    const wp = await this.baseMock.register(requestId);
    // 注入示例集中澄清问题（3 题）
    wp.questions = [
      {
        id: 'q-001',
        text: '当车手处于「陡坡导航转向」或「高心率冲刺」时，低电量弹窗是否直接遮盖转向箭头？',
      },
      {
        id: 'q-002',
        text: '踏频传感器单次骑行低电量广播的抑制周期是多久？建议为 15 分钟或单次骑行最多 2 次。',
      },
      {
        id: 'q-003',
        text: '若车手在传感器低电量后更换电池回连，界面是否需要弹窗提示「电量已恢复正常」？',
      },
    ];
    wp.prdPath = undefined;
    wp.prdVersion = undefined;
    return wp;
  }

  listWorkPackages(): Promise<WorkPackage[]> {
    return this.baseMock.listWorkPackages();
  }

  readWorkPackage(requestId: string): Promise<WorkPackage> {
    return this.baseMock.readWorkPackage(requestId);
  }

  async preflight(_requestId: string): Promise<PreflightResult> {
    const checks: PreflightCheck[] = [];

    checks.push({
      name: 'mfp_root_exists',
      ok: this.scenario !== 'root_missing',
      detail: this.scenario !== 'root_missing' ? '/Users/jacko/Projects/MFP-Antigravity' : 'MFP 项目目录不存在',
    });

    checks.push({
      name: 'mfp_root_writable',
      ok: this.scenario !== 'root_missing',
      detail: this.scenario !== 'root_missing' ? '项目目录可写' : '目录不可写',
    });

    checks.push({
      name: 'cli_installed',
      ok: this.scenario !== 'cli_not_installed',
      detail:
        this.scenario !== 'cli_not_installed'
          ? '/usr/local/bin/claude'
          : '未找到 claude 可执行文件（请安装并登录 Claude Code）',
    });

    checks.push({
      name: 'cli_version',
      ok: this.scenario !== 'cli_not_installed',
      detail: this.scenario !== 'cli_not_installed' ? 'claude 2.1.229' : '无法获取版本（--version 失败）',
    });

    checks.push({
      name: 'cli_auth',
      ok: this.scenario !== 'not_authenticated' && this.scenario !== 'cli_not_installed',
      detail:
        this.scenario === 'not_authenticated'
          ? '未认证（请在终端执行 `claude login` 或配置 API 凭据）'
          : this.scenario === 'cli_not_installed'
            ? 'CLI 未安装，跳过认证检查'
            : '认证正常（已探测最小调用）',
    });

    checks.push({
      name: 'rules_entrypoints',
      ok: true,
      detail: 'AGENTS.md=true；BENCHMARK.md=true',
    });

    checks.push({
      name: 'task_card_readable',
      ok: true,
      detail: 'currentPhase=Phase 0 事实源召回',
    });

    checks.push({
      name: 'output_writable',
      ok: true,
      detail: '/Users/jacko/Projects/MFP-Antigravity/output',
    });

    return {
      ok: checks.every((c) => c.ok),
      checks,
    };
  }

  async launch(requestId: string): Promise<LaunchResult> {
    if (this.scenario === 'launch_failed') {
      throw new BridgeError('TERMINAL_LAUNCH_FAILED', '无法打开外部终端应用：osascript 执行异常，请尝试手动复制启动指令');
    }
    if (this.scenario === 'cli_not_installed') {
      throw new BridgeError('CLI_NOT_FOUND', '未找到 claude 可执行文件，无法启动终端会话');
    }
    if (this.scenario === 'not_authenticated') {
      throw new BridgeError('CLI_AUTH_FAILED', 'Claude Code 未登录或凭据失效，无法启动终端会话');
    }
    return this.baseMock.launch(requestId);
  }

  async resume(requestId: string): Promise<LaunchResult> {
    if (this.scenario === 'launch_failed') {
      throw new BridgeError('TERMINAL_LAUNCH_FAILED', '恢复会话失败：无法打开外部终端应用');
    }
    if (this.scenario === 'resume_fallback') {
      const wp = await this.baseMock.readWorkPackage(requestId);
      const fallbackSessionId = `SESSION-FALLBACK-${Date.now().toString(36)}`;
      const startedAt = new Date().toISOString();
      wp.session = {
        sessionId: fallbackSessionId,
        processState: 'running',
        startedAt,
      };
      wp.runLog.push({
        runId: `RUN-${Date.now().toString(36)}`,
        sessionId: fallbackSessionId,
        startedAt,
        state: 'running',
      });
      wp.updatedAt = startedAt;
      return {
        ok: true,
        sessionId: fallbackSessionId,
        startedAt,
        fallback: true,
        note: '历史会话文件缺失或已过期，已基于工作包重新创建新会话',
      };
    }
    const wp = await this.baseMock.readWorkPackage(requestId);
    if (wp.status === 'revising') {
      wp.status = 'pending_review';
    }
    return this.baseMock.resume(requestId);
  }

  async answerQuestion(requestId: string, questionId: string, answer: string): Promise<WorkPackage> {
    return this.submitAnswers(requestId, [{ questionId, answer }]);
  }

  /** Issue #19 批量集中原子保存回答（零次 resume，不自动宣称运行） */
  async submitAnswers(requestId: string, answers: AnswerItem[]): Promise<WorkPackage> {
    const wp = await this.baseMock.readWorkPackage(requestId);
    if (!Array.isArray(answers) || answers.length === 0) {
      throw new BridgeError('INVALID_ARGUMENT', '提交回答列表不能为空');
    }

    // 校验是否有重复 questionId
    const seen = new Set<string>();
    for (const item of answers) {
      if (seen.has(item.questionId)) {
        throw new BridgeError('INVALID_ARGUMENT', `重复提交问题回答：${item.questionId}`);
      }
      seen.add(item.questionId);

      const q = wp.questions.find((x) => x.id === item.questionId);
      if (!q) {
        throw new BridgeError('INVALID_ARGUMENT', `找不到澄清问题：${item.questionId}`);
      }
      if (!item.answer || item.answer.trim().length === 0) {
        throw new BridgeError('INVALID_ARGUMENT', `问题 ${item.questionId} 的回答不能为空`);
      }
    }

    // 原子更新全部回答
    const now = new Date().toISOString();
    for (const item of answers) {
      const q = wp.questions.find((x) => x.id === item.questionId)!;
      q.answer = item.answer.trim();
      q.answeredAt = now;
    }

    // 保存本身不启动 Agent，也不宣称 running
    wp.updatedAt = now;
    return wp;
  }

  /** 提交修改意见：保存意见并自增版本 */
  async submitRevision(requestId: string, comment: string): Promise<WorkPackage> {
    const wp = await this.baseMock.readWorkPackage(requestId);
    if (typeof comment !== 'string' || comment.trim().length === 0) {
      throw new BridgeError('INVALID_ARGUMENT', '修改意见不能为空');
    }
    wp.revisionComments.push({
      id: `RC-${Date.now().toString(36)}`,
      text: comment.trim(),
      createdAt: new Date().toISOString(),
    });
    wp.status = 'revising';
    wp.prdVersion = (wp.prdVersion ?? 1) + 1;
    wp.updatedAt = new Date().toISOString();

    // 更新当前存储的 PRD 内容与哈希
    const existing = this.mockPrdDocs.get(requestId);
    if (existing) {
      const updatedContent = `${existing.content}\n\n### 补充修改 (v${wp.prdVersion}):\n- ${comment.trim()}\n`;
      const updatedHash = await computeContentHash(updatedContent);
      this.mockPrdDocs.set(requestId, {
        path: existing.path,
        version: wp.prdVersion,
        content: updatedContent,
        contentHash: updatedHash,
      });
    }

    return wp;
  }

  /** 确认完成验收：携带用户实际审阅的 version 与 contentHash 快照校验 */
  async complete(requestId: string, expectedPrd?: ExpectedPrdSnapshot): Promise<WorkPackage> {
    const wp = await this.baseMock.readWorkPackage(requestId);

    if (wp.status === 'completed') {
      return wp;
    }

    if (this.scenario === 'prd_changed') {
      throw new BridgeError('PRD_CHANGED' as any, 'PRD 文档已被外部修改，请重新审阅最新版本后再确认完成');
    }

    // 校验快照一致性
    if (expectedPrd) {
      const currentDoc = this.mockPrdDocs.get(requestId);
      if (currentDoc) {
        if (currentDoc.version !== expectedPrd.version || currentDoc.contentHash !== expectedPrd.contentHash) {
          throw new BridgeError('PRD_CHANGED' as any, 'PRD 文档内容或版本已发生变化，请重新审阅最新版本后再确认完成');
        }
      }
    }

    wp.status = 'completed';
    const run = wp.runLog.find((r) => r.state === 'running');
    if (run) {
      run.state = 'succeeded';
      run.endedAt = new Date().toISOString();
    }
    if (wp.session.processState === 'running') wp.session.processState = 'exited';
    wp.updatedAt = new Date().toISOString();
    return wp;
  }

  archive(requestId: string): Promise<WorkPackage> {
    return this.baseMock.archive(requestId);
  }

  /** Issue #19 真实 PRD 读取：返回特定请求专属的随机唯一 Markdown，杜绝固定模板 */
  async readPrd(requestId: string): Promise<PrdDocument> {
    if (this.scenario === 'prd_read_failed') {
      throw new BridgeError('PRD_READ_FAILED' as any, '读取 PRD 文件失败：权限不足或磁盘文件损坏');
    }

    const wp = await this.baseMock.readWorkPackage(requestId);

    // 未生成状态判断
    if (
      this.scenario === 'prd_not_found' ||
      (!wp.prdPath &&
        (wp.status === 'pending_recognition' ||
          wp.status === 'pending_confirmation'))
    ) {
      return { state: 'not_generated', requestId };
    }

    // 如果未设置 prdPath，初始化为对应路径
    if (!wp.prdPath) {
      wp.prdPath = `output/${requestId}/02-PRD.md`;
      wp.prdVersion = wp.prdVersion ?? 1;
    }

    const version = wp.prdVersion ?? 1;
    const existing = this.mockPrdDocs.get(requestId);

    if (existing && existing.version === version) {
      return {
        state: 'ready',
        requestId,
        path: existing.path,
        version: existing.version,
        content: existing.content,
        contentHash: existing.contentHash,
      };
    }

    // 构造此需求专属的唯一 Markdown 内容（非固定模板）
    const title = wp.recognition?.rewrittenRequirement || `迈金固件特性规格说明 (${requestId})`;
    const uniqueSalt = `MFP-DOC-${requestId}-${Date.now().toString(36)}`;
    const content = `# ${title} (v${version})

> **需求编号**: \`${requestId}\`
> **文档路径**: \`${wp.prdPath}\`
> **文档标识**: \`${uniqueSalt}\`
> **人群归位**: L1~L3 核心运动用户 (红线合规度 100%)

---

## 1. 背景与目标
针对车手在实际外设通信中的关键诉求，对齐固件规范与低电量告警策略。

- **目标用户**: ${wp.recognition?.user || '公路与山地骑行车手'}
- **使用场景**: ${wp.recognition?.scenario || '日常户外训练与多外设并发连接'}
- **核心目标**: ${wp.recognition?.goal || '保障数据准确性与骑行安全'}

---

## 2. 协议与交互规范

### 2.1 状态广播流转
1. **正常工作阶段**: 主广播循环维持标准周期（1,000 ms），预期电流 ~4.2 mA。
2. **异常告警阶段**: 触发 3 秒无阻塞防遮挡提示，并在 FIT 文件记录状态码。
3. **休眠降级阶段**: 广播周期延长至 30,000 ms，预期电流 ~0.3 mA。

| 阶段 | 广播周期 | 功耗表现 | 交互响应 |
|---|---|---|---|
| 初始就绪 | 1,000 ms | ~4.2 mA | 状态栏常亮 |
| 异常告警 | 3,000 ms | ~2.1 mA | 黄闪提示 3 秒 |
| 休眠降级 | 30,000 ms | ~0.3 mA | 仅记录 FIT |

---

## 3. 验收标准
- [x] 遵循 \`knowledge-base/01_事实源/BENCHMARK.md\` 事实红线规范
- [x] 确保 6 层人群模型 L1-L3 车手核心体验一致
- [x] 异常断电与极端弱信号下不发生死锁
`;

    const contentHash = await computeContentHash(content);
    const docData = {
      path: wp.prdPath,
      version,
      content,
      contentHash,
    };
    this.mockPrdDocs.set(requestId, docData);

    return {
      state: 'ready',
      requestId,
      ...docData,
    };
  }
}

let cached: WebBridge | null = null;

export function getBridge(): WebBridge {
  if (!cached) cached = isTauri() ? new TauriBridge() : new FrontendMockBridge();
  return cached;
}
