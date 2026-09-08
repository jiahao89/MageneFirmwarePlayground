import { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Compass,
  FolderOpen,
  Sparkles,
  FileText,
  CheckCircle2,
  Archive,
  RotateCcw,
  AlertTriangle,
  BookOpen,
  Layers,
  HelpCircle,
  ShieldCheck,
  Send,
  Loader2,
  Info,
  Search,
  Clock,
  FileCode,
  AlertCircle,
  Play,
  Copy,
  RefreshCw,
  Edit3,
  History,
  ArrowLeft,
  Terminal,
  XCircle,
  Zap,
  Check,
  Save,
  FileCode2,
  Hash,
} from 'lucide-react';
import {
  getBridge,
  FrontendMockBridge,
  isTauri,
  type MockScenario,
  type PrdDocument,
  type ExpectedPrdSnapshot,
  type AnswerItem,
} from './bridge-adapter';
import type {
  WorkPackage,
  RecognitionResult,
  PreflightResult,
  RequestStatus,
} from '../bridge/types';
import type { BridgeErrorPayload } from '../bridge/errors';
import './app.css';

const bridge = getBridge();

type PageView = 'pool' | 'intake' | 'detail';
type DetailTab = 'overview' | 'clarification' | 'prd' | 'logs';

export function App() {
  const [currentPage, setCurrentPage] = useState<PageView>('pool');

  // 需求池状态缓存
  const [workPackages, setWorkPackages] = useState<WorkPackage[]>([]);
  const [poolStatusFilter, setPoolStatusFilter] = useState<string>('all');
  const [poolSearchQuery, setPoolSearchQuery] = useState('');

  // 原始需求录入状态 (Issue #4)
  const [rawText, setRawText] = useState('');
  const [sourceDesc, setSourceDesc] = useState('客户微信群反馈');
  const [currentRaw, setCurrentRaw] = useState<WorkPackage | null>(null);
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  // 详情页状态 (Issue #5 & Issue #3 联调)
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>('overview');
  const [activeWorkPackage, setActiveWorkPackage] = useState<WorkPackage | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [isPreflightChecking, setIsPreflightChecking] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [sessionFeedback, setSessionFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    title: string;
    message: string;
    details?: string;
  } | null>(null);
  const [lastLaunchError, setLastLaunchError] = useState<BridgeErrorPayload | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Mock 场景模拟器状态 (联调辅助)
  const [currentScenario, setCurrentScenario] = useState<MockScenario>('normal');

  // 澄清问答与修改意见 (Issue #19 扩展)
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSavingAnswers, setIsSavingAnswers] = useState(false);
  const [resumeAfterSaveFailed, setResumeAfterSaveFailed] = useState(false);
  const [revisionComment, setRevisionComment] = useState('');
  const [revisionSavedCommentId, setRevisionSavedCommentId] = useState<string | null>(null);
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  // PRD 真实文档状态 (Issue #19 扩展)
  const [prdDoc, setPrdDoc] = useState<PrdDocument | null>(null);
  const [prdLoading, setPrdLoading] = useState(false);
  const [prdError, setPrdError] = useState<{ code: string; message: string } | null>(null);
  const prdRequestIdRef = useRef<string>('');


  // 初始化加载
  useEffect(() => {
    loadWorkPackageList();
  }, []);

  // Agent 启动后定时轮询工作包，展示 Agent 写回的问题、状态、日志和 PRD
  useEffect(() => {
    if (!activeWorkPackage || currentPage !== 'detail') return;

    const timer = setInterval(async () => {
      try {
        const wp = await bridge.readWorkPackage(activeWorkPackage.requestId);
        if (wp.requestId === activeWorkPackage.requestId) {
          // 如果状态或 PRD 版本变迁，自动刷新 PRD 文档
          if (wp.status !== activeWorkPackage.status || wp.prdVersion !== activeWorkPackage.prdVersion) {
            loadPrdDocument(wp.requestId);
          }
          setActiveWorkPackage(wp);
          setWorkPackages((prev) =>
            prev.map((w) => (w.requestId === wp.requestId ? wp : w))
          );
        }
      } catch {}
    }, 3000);

    return () => clearInterval(timer);
  }, [activeWorkPackage?.requestId, activeWorkPackage?.status, activeWorkPackage?.prdVersion, currentPage]);

  const loadWorkPackageList = async () => {
    try {
      const list = await bridge.listWorkPackages();
      setWorkPackages(list);
    } catch {
      // 兼容环境
    }
  };

  const refreshActiveWorkPackage = async () => {
    if (activeWorkPackage) {
      try {
        const wp = await bridge.readWorkPackage(activeWorkPackage.requestId);
        setActiveWorkPackage(wp);
        setWorkPackages((prev) =>
          prev.map((w) => (w.requestId === wp.requestId ? wp : w))
        );
        loadPrdDocument(wp.requestId);
      } catch {}
    }
  };

  // 读取真实 PRD 文档（防竞态覆盖）
  const loadPrdDocument = async (requestId: string) => {
    prdRequestIdRef.current = requestId;
    setPrdLoading(true);
    setPrdError(null);
    try {
      const doc = await bridge.readPrd(requestId);
      if (prdRequestIdRef.current === requestId) {
        setPrdDoc(doc);
      }
    } catch (e: any) {
      if (prdRequestIdRef.current === requestId) {
        setPrdError({
          code: e?.code || e?.payload?.code || 'PRD_READ_FAILED',
          message: e?.payload?.message || e?.message || String(e),
        });
        setPrdDoc(null);
      }
    } finally {
      if (prdRequestIdRef.current === requestId) {
        setPrdLoading(false);
      }
    }
  };

  // 切换 Mock 模拟场景
  const handleScenarioChange = (scenario: MockScenario) => {
    setCurrentScenario(scenario);
    if (bridge instanceof FrontendMockBridge) {
      bridge.setScenario(scenario);
    }
    if (activeWorkPackage) {
      runPreflight(activeWorkPackage.requestId);
      loadPrdDocument(activeWorkPackage.requestId);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(label);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  // ==========================================
  // Issue #4: 原始需求录入与智能识别流程
  // ==========================================
  const charCount = rawText.trim().length;
  const isOverLimit = charCount > 20000;
  const isTooShort = charCount === 0;

  const handleFillDemo = (type: 'cadence' | 'radar' | 'bug') => {
    if (type === 'cadence') {
      setRawText(
        '车友在俱乐部骑行反馈：用迈金 C706 连踏频传感器，快没电的时候完全不知道，骑到一半突然踏频归零了。希望能像心率带那样给个低电量弹窗，但千万别一直响蜂鸣器或者把导航地图全挡住，3秒自动消失就行。'
      );
      setSourceDesc('顽鹿俱乐部车友微信群');
    } else if (type === 'radar') {
      setRawText(
        'L508 雷达尾灯在夜间跟车时太亮了，后面的队友一直被晃眼睛。能不能加个车队编队防眩目模式，后车贴近时自动降低主灯亮度，只在后方有高速来车时再高亮爆闪预警？'
      );
      setSourceDesc('海外公路车队测试反馈');
    } else {
      setRawText(
        'C706 升级最新固件后，在室内骑行台模式下偶发断连并报错 0x82，导致踩踏功率数据丢失两分钟，需要排查传感器协议缓冲区溢出问题。'
      );
      setSourceDesc('售后技术支持工单 #8921');
    }
  };

  const handleStartRecognition = async () => {
    if (isTooShort || isOverLimit) return;
    setIntakeError(null);
    setIntakeLoading(true);

    try {
      // 1. 保存原文 (落盘存入待识别工作包，防丢)
      const wp = await bridge.saveRawInput({ text: rawText, sourceDescription: sourceDesc });
      setCurrentRaw(wp);

      // 2. 调用非交互结构化识别
      const res = await bridge.recognize(wp.requestId);
      setRecognition(res);
    } catch (err: any) {
      setIntakeError(err?.message || '识别处理失败，原文已安全暂存');
    } finally {
      setIntakeLoading(false);
    }
  };

  const handleRegisterRequirement = async () => {
    if (!currentRaw) return;
    setIntakeLoading(true);
    try {
      const wp = await bridge.register(currentRaw.requestId);
      // 自动注入演示问题供测试澄清
      if (wp.questions.length === 0) {
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
      }
      setWorkPackages((prev) => [wp, ...prev.filter((p) => p.requestId !== wp.requestId)]);
      setActiveWorkPackage(wp);
      setCurrentPage('detail');
      setActiveDetailTab('overview');
      setRevisionComment('');
      setRevisionSavedCommentId(null);
      setResumeAfterSaveFailed(false);
      const initAnswers: Record<string, string> = {};
      for (const q of wp.questions) {
        initAnswers[q.id] = q.answer || '';
      }
      setAnswers(initAnswers);
      runPreflight(wp.requestId);
      loadPrdDocument(wp.requestId);
    } catch (err: any) {
      setIntakeError(err?.message || '登记需求失败');
    } finally {
      setIntakeLoading(false);
    }
  };

  const handleResetIntake = () => {
    setCurrentRaw(null);
    setRecognition(null);
    setIntakeError(null);
    setRawText('');
  };

  // ==========================================
  // Issue #5 & Issue #3: 工作包详情与 Agent 启动/恢复
  // ==========================================
  const loadDetail = async (reqId: string) => {
    try {
      const wp = await bridge.readWorkPackage(reqId);
      setActiveWorkPackage(wp);
      setCurrentPage('detail');
      setLastLaunchError(null);
      setSessionFeedback(null);
      setRevisionComment('');
      setRevisionSavedCommentId(null);
      setResumeAfterSaveFailed(false);

      // 初始化问答草稿
      const initAnswers: Record<string, string> = {};
      for (const q of wp.questions) {
        initAnswers[q.id] = q.answer || '';
      }
      setAnswers(initAnswers);

      runPreflight(reqId);
      loadPrdDocument(reqId);

      if (wp.status === 'pending_answer') setActiveDetailTab('clarification');
      else if (wp.status === 'pending_review' || wp.status === 'completed') setActiveDetailTab('prd');
      else setActiveDetailTab('overview');
    } catch {
      const found = workPackages.find((w) => w.requestId === reqId);
      if (found) {
        setActiveWorkPackage(found);
        setCurrentPage('detail');
        loadPrdDocument(reqId);
      }
    }
  };

  const runPreflight = async (reqId: string) => {
    setIsPreflightChecking(true);
    try {
      const res = await bridge.preflight(reqId);
      setPreflight(res);
    } finally {
      setIsPreflightChecking(false);
    }
  };

  // 1. 启动新会话 (Launch)
  const handleStartSession = async () => {
    if (!activeWorkPackage) return;
    setIsStartingSession(true);
    setSessionFeedback(null);
    setLastLaunchError(null);

    try {
      const res = await bridge.launch(activeWorkPackage.requestId);
      setSessionFeedback({
        type: 'success',
        title: 'Claude Code 会话已启动',
        message: `已成功在外部终端启动 Agent 会话 [${res.sessionId || '新会话'}]`,
        details: res.note,
      });
      await refreshActiveWorkPackage();
    } catch (e: any) {
      const payload: BridgeErrorPayload = e?.payload || {
        code: (e?.code as any) || 'TERMINAL_LAUNCH_FAILED',
        category: (e?.category as any) || 'io',
        message: e?.message || String(e),
      };
      setLastLaunchError(payload);
      setSessionFeedback({
        type: 'error',
        title: `启动失败: ${payload.code}`,
        message: payload.message,
      });
    } finally {
      setIsStartingSession(false);
    }
  };

  // 2. 恢复既有会话 (Resume)
  const handleResumeSession = async () => {
    if (!activeWorkPackage) return;
    setIsStartingSession(true);
    setSessionFeedback(null);
    setLastLaunchError(null);

    try {
      const res = await bridge.resume(activeWorkPackage.requestId);
      if (res.fallback) {
        setSessionFeedback({
          type: 'warning',
          title: '会话降级恢复',
          message: res.note || '原会话文件已丢失或过期，系统已自动基于工作包重新创建新会话并唤起终端',
        });
      } else {
        setSessionFeedback({
          type: 'success',
          title: 'Claude Code 会话已恢复',
          message: `已连接至历史会话 [${res.sessionId || activeWorkPackage.session.sessionId || '既有会话'}]`,
        });
      }
      await refreshActiveWorkPackage();
    } catch (e: any) {
      const payload: BridgeErrorPayload = e?.payload || {
        code: (e?.code as any) || 'SESSION_NOT_FOUND',
        category: (e?.category as any) || 'cli',
        message: e?.message || String(e),
      };
      setLastLaunchError(payload);
      setSessionFeedback({
        type: 'error',
        title: `恢复失败: ${payload.code}`,
        message: payload.message,
      });
    } finally {
      setIsStartingSession(false);
    }
  };

  // 3. 强制创建新会话 (Force New Session)
  const handleForceNewSession = async () => {
    if (!activeWorkPackage) return;
    if (window.confirm('强制创建新会话将覆盖当前已连接的会话，确定继续？')) {
      handleStartSession();
    }
  };

  // 仅保存回答（不唤起 Agent）
  const handleSaveAnswersOnly = async () => {
    if (!activeWorkPackage) return;
    const items: AnswerItem[] = [];
    for (const q of activeWorkPackage.questions) {
      if (!q.answer && answers[q.id]?.trim()) {
        items.push({ questionId: q.id, answer: answers[q.id].trim() });
      }
    }
    if (items.length === 0) {
      alert('请至少填写一个待回答问题的回答内容');
      return;
    }

    setIsSavingAnswers(true);
    try {
      const updated = await bridge.submitAnswers(activeWorkPackage.requestId, items);
      setActiveWorkPackage(updated);
      setWorkPackages((prev) =>
        prev.map((w) => (w.requestId === updated.requestId ? updated : w))
      );
      setSessionFeedback({
        type: 'success',
        title: '回答已保存（未唤起 Agent）',
        message: `已成功保存 ${items.length} 条回答至工作包。当前操作未唤起 Claude Code，您可以继续填写其他项或点击「保存回答并继续」。`,
      });
    } catch (e: any) {
      alert(e?.message || '保存回答失败');
    } finally {
      setIsSavingAnswers(false);
    }
  };

  // 保存回答并继续（原子提交并唤起 Agent 一次）
  const handleSaveAnswersAndResume = async () => {
    if (!activeWorkPackage) return;
    const items: AnswerItem[] = [];
    for (const q of activeWorkPackage.questions) {
      if (!q.answer && answers[q.id]?.trim()) {
        items.push({ questionId: q.id, answer: answers[q.id].trim() });
      }
    }

    const pendingQuestions = activeWorkPackage.questions.filter((q) => !q.answer);
    if (items.length === 0 && pendingQuestions.length > 0) {
      alert('请先填写回答内容后再继续唤起 Agent');
      return;
    }

    setIsSavingAnswers(true);
    setResumeAfterSaveFailed(false);
    try {
      let updated = activeWorkPackage;
      if (items.length > 0) {
        updated = await bridge.submitAnswers(activeWorkPackage.requestId, items);
        setActiveWorkPackage(updated);
        setWorkPackages((prev) =>
          prev.map((w) => (w.requestId === updated.requestId ? updated : w))
        );
      }

      // 单次调用 resume，严禁对每个问题循环调用
      try {
        const resumeRes = await bridge.resume(activeWorkPackage.requestId);
        setSessionFeedback({
          type: 'success',
          title: '回答已保存并恢复会话',
          message: `已成功保存回答并唤起外部终端 Claude Code [${resumeRes.sessionId || '既有会话'}] 继续执行！`,
        });
        await refreshActiveWorkPackage();
      } catch (resumeErr: any) {
        setResumeAfterSaveFailed(true);
        const payload: BridgeErrorPayload = resumeErr?.payload || {
          code: (resumeErr?.code as any) || 'TERMINAL_LAUNCH_FAILED',
          category: (resumeErr?.category as any) || 'io',
          message: resumeErr?.message || String(resumeErr),
        };
        setLastLaunchError(payload);
        setSessionFeedback({
          type: 'warning',
          title: '回答已保存，但唤起终端失败',
          message: `回答已安全写入工作包，但唤起 Claude Code 失败 (${payload.code})。您可直接点击下方「重试唤起 Agent」继续，无需重复输入。`,
        });
      }
    } catch (e: any) {
      alert(e?.message || '提交回答失败');
    } finally {
      setIsSavingAnswers(false);
    }
  };

  // 单个问题的回答（向后兼容）
  const handleAnswerQuestion = async (qId: string, autoResume = false) => {
    if (!activeWorkPackage) return;
    const ans = answers[qId] || '';
    if (!ans.trim()) {
      alert('请填写回答内容');
      return;
    }

    try {
      const updated = await bridge.submitAnswers(activeWorkPackage.requestId, [
        { questionId: qId, answer: ans.trim() },
      ]);
      setActiveWorkPackage(updated);
      setWorkPackages((prev) =>
        prev.map((w) => (w.requestId === updated.requestId ? updated : w))
      );
      if (autoResume) {
        try {
          await bridge.resume(activeWorkPackage.requestId);
          setSessionFeedback({
            type: 'success',
            title: '回答已同步',
            message: '回答已保存并成功唤起 Claude Code 会话恢复！',
          });
          await refreshActiveWorkPackage();
        } catch (resumeErr: any) {
          setResumeAfterSaveFailed(true);
          setSessionFeedback({
            type: 'warning',
            title: '回答已保存，但唤起终端失败',
            message: '回答已安全写入工作包，但拉起终端失败，可点击重试唤起。',
          });
        }
      } else {
        setSessionFeedback({
          type: 'success',
          title: '回答已暂存',
          message: '回答已暂存至工作包（尚未唤起 Agent）。',
        });
      }
    } catch (e: any) {
      alert(e?.message || '提交回答失败');
    }
  };

  // 提交修改意见并唤起 Agent（或重试唤起）
  const handleSubmitRevision = async () => {
    if (!activeWorkPackage) return;
    if (activeWorkPackage.status === 'completed') {
      alert('需求已标记为完成终态，不可再提交修改意见');
      return;
    }
    if (activeWorkPackage.session.processState === 'running') {
      alert('Claude Code 正在终端运行中，请等待执行完成或返回结果后再提交修改意见');
      return;
    }

    // 若修改意见已成功写入 revision.md 但上次唤起终端失败，则只重试唤起，不重复调用 submitRevision
    if (revisionSavedCommentId) {
      setIsSubmittingRevision(true);
      try {
        const resumeRes = await bridge.resume(activeWorkPackage.requestId);
        setRevisionSavedCommentId(null);
        setRevisionComment('');
        setResumeAfterSaveFailed(false);
        setSessionFeedback({
          type: 'success',
          title: 'Claude Code 会话已恢复',
          message: `已成功唤起外部终端 [${resumeRes.sessionId || '既有会话'}] 开始修订 PRD！`,
        });
        await refreshActiveWorkPackage();
      } catch (resumeErr: any) {
        const payload: BridgeErrorPayload = resumeErr?.payload || {
          code: (resumeErr?.code as any) || 'TERMINAL_LAUNCH_FAILED',
          category: (resumeErr?.category as any) || 'io',
          message: resumeErr?.message || String(resumeErr),
        };
        setLastLaunchError(payload);
        setSessionFeedback({
          type: 'warning',
          title: '唤起终端失败（修改意见已安全保存）',
          message: `重试唤起失败: ${payload.message}。修改意见已在 revision.md 中，无需重新输入，可再次点击重试唤起。`,
        });
      } finally {
        setIsSubmittingRevision(false);
      }
      return;
    }

    if (!revisionComment.trim()) {
      alert('请填写修改意见或补充约束内容');
      return;
    }

    setIsSubmittingRevision(true);
    try {
      // 1. 提交修改意见写入 revision.md
      const updated = await bridge.submitRevision(activeWorkPackage.requestId, revisionComment.trim());
      setActiveWorkPackage(updated);
      setWorkPackages((prev) =>
        prev.map((w) => (w.requestId === updated.requestId ? updated : w))
      );
      // 记录已保存标记
      setRevisionSavedCommentId(updated.requestId);

      // 2. 紧接着唤起 Agent
      try {
        const resumeRes = await bridge.resume(activeWorkPackage.requestId);
        setRevisionSavedCommentId(null);
        setRevisionComment('');
        setResumeAfterSaveFailed(false);
        setSessionFeedback({
          type: 'success',
          title: '修改意见已记录并恢复会话',
          message: `修改意见已写入 revision.md，已唤起终端 [${resumeRes.sessionId || '会话'}] 开始修订 PRD！`,
        });
        await refreshActiveWorkPackage();
      } catch (resumeErr: any) {
        setResumeAfterSaveFailed(true);
        const payload: BridgeErrorPayload = resumeErr?.payload || {
          code: (resumeErr?.code as any) || 'TERMINAL_LAUNCH_FAILED',
          category: (resumeErr?.category as any) || 'io',
          message: resumeErr?.message || String(resumeErr),
        };
        setLastLaunchError(payload);
        setSessionFeedback({
          type: 'warning',
          title: '修改意见已保存，但唤起终端失败',
          message: `意见已成功写入 revision.md（状态已更新为修改中），但唤起外部终端失败 (${payload.code})。您可直接点击下方「重试唤起 Agent（修改意见已保存）」继续，无需重新提交意见。`,
        });
      }
    } catch (e: any) {
      alert(e?.message || '提交修改意见失败，内容已保留');
    } finally {
      setIsSubmittingRevision(false);
    }
  };

  // 确认完成验收（带 ExpectedPrdSnapshot 校验保护）
  const handleConfirmCompletion = async () => {
    if (!activeWorkPackage) return;
    setIsCompleting(true);
    try {
      const snapshot: ExpectedPrdSnapshot | undefined =
        prdDoc && prdDoc.state === 'ready'
          ? { version: prdDoc.version, contentHash: prdDoc.contentHash }
          : undefined;

      const updated = await bridge.complete(activeWorkPackage.requestId, snapshot);
      setShowCompleteModal(false);
      setActiveWorkPackage(updated);
      setWorkPackages((prev) =>
        prev.map((w) => (w.requestId === updated.requestId ? updated : w))
      );
      setSessionFeedback({
        type: 'success',
        title: '需求已确认完成',
        message: 'PRD 终稿已锁定，工作包已标记为「完成」终态。',
      });
      loadPrdDocument(activeWorkPackage.requestId);
    } catch (e: any) {
      const errCode = e?.code || e?.payload?.code;
      if (errCode === 'PRD_CHANGED') {
        alert('⚠️ 校验失败：PRD 文件刚刚被外部修改，内容 Hash 与审阅时不一致！\n系统已为您自动重新加载最新 PRD，请重新审阅后再确认完成。');
        setShowCompleteModal(false);
        loadPrdDocument(activeWorkPackage.requestId);
      } else {
        alert(e?.message || e?.payload?.message || '确认完成失败');
      }
    } finally {
      setIsCompleting(false);
    }
  };

  const getStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case 'pending_launch':
        return <span className="badge badge-pending">待启动</span>;
      case 'processing':
        return <span className="badge badge-running">处理中</span>;
      case 'pending_answer':
        return <span className="badge badge-pending" style={{ borderColor: '#f59e0b', color: '#f59e0b' }}>待 PM 回答</span>;
      case 'pending_review':
        return <span className="badge badge-running" style={{ borderColor: '#00b4d8', color: '#00b4d8' }}>待审阅 PRD</span>;
      case 'revising':
        return <span className="badge badge-pending">修改中</span>;
      case 'completed':
        return <span className="badge badge-done">已完成</span>;
      case 'archived':
        return <span className="badge badge-archive">已归档</span>;
      default:
        return <span className="badge badge-outline">{status}</span>;
    }
  };

  const getNextActionText = (status: RequestStatus) => {
    switch (status) {
      case 'pending_launch':
        return '点击「启动 Agent」，打开外部终端开始执行 Phase 0~4';
      case 'processing':
        return 'Claude Code 正在外部终端分析需求并撰写 PRD...';
      case 'pending_answer':
        return '回答 Agent 提出的关键硬件与交互缺口问题并恢复会话';
      case 'pending_review':
        return '审阅生成的 02-PRD.md 或提出修改意见';
      case 'revising':
        return '修改意见已记录，等待 Agent 修订 PRD';
      case 'completed':
        return 'PRD 终稿已确认归档，可通过飞书脚本同步';
      default:
        return '等待 PM 决策';
    }
  };



  // 检查 Preflight 是否通过
  const isPreflightPassed = preflight ? preflight.ok : false;

  // 针对特定 Preflight 失败项渲染指导
  const renderPreflightDiagnosis = () => {
    if (!preflight || preflight.ok) return null;

    const failedChecks = preflight.checks.filter((c) => !c.ok);
    const hasCliError = failedChecks.some((c) => c.name === 'cli_installed' || c.name === 'cli_version');
    const hasAuthError = failedChecks.some((c) => c.name === 'cli_auth');
    const hasRootError = failedChecks.some((c) => c.name === 'mfp_root_exists' || c.name === 'mfp_root_writable');
    const otherErrors = failedChecks.filter(
      (c) =>
        c.name !== 'cli_installed' &&
        c.name !== 'cli_version' &&
        c.name !== 'cli_auth' &&
        c.name !== 'mfp_root_exists' &&
        c.name !== 'mfp_root_writable'
    );

    return (
      <div className="resolution-card">
        <div className="resolution-title">
          <AlertTriangle size={17} />
          <span>环境检查未通过 ({failedChecks.length} 项未就绪)</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
          Claude Code 启动前需要确保本地环境就绪。请参考以下建议进行修复：
        </p>

        {hasCliError && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, color: '#ffffff', fontWeight: 600 }}>
              🔴 未检测到 Claude Code CLI 或无法获取版本
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              请在终端全局安装 Claude Code CLI：
            </div>
            <div className="code-box">
              <code>npm install -g @anthropic-ai/claude-code</code>
              <button
                className="btn btn-secondary btn-sm"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => copyToClipboard('npm install -g @anthropic-ai/claude-code', 'cli_install')}
              >
                {copiedCmd === 'cli_install' ? <Check size={12} /> : <Copy size={12} />}
                {copiedCmd === 'cli_install' ? '已复制' : '复制命令'}
              </button>
            </div>
          </div>
        )}

        {hasAuthError && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, color: '#ffffff', fontWeight: 600 }}>
              🟡 Claude Code 未登录或凭据失效
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              请打开系统终端运行登录命令完成身份认证：
            </div>
            <div className="code-box">
              <code>claude login</code>
              <button
                className="btn btn-secondary btn-sm"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => copyToClipboard('claude login', 'cli_login')}
              >
                {copiedCmd === 'cli_login' ? <Check size={12} /> : <Copy size={12} />}
                {copiedCmd === 'cli_login' ? '已复制' : '复制命令'}
              </button>
            </div>
          </div>
        )}

        {hasRootError && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, color: '#ffffff', fontWeight: 600 }}>
              🔴 MFP 项目根目录不存在或无写入权限
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              请确保工作区目录有效且当前用户具有读写权限。
            </div>
          </div>
        )}

        {otherErrors.map((c) => (
          <div key={c.name} style={{ marginTop: 8, fontSize: 12.5, color: '#f87171' }}>
            • {c.name}: {c.detail}
          </div>
        ))}

        <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={isPreflightChecking}
            onClick={() => activeWorkPackage && runPreflight(activeWorkPackage.requestId)}
          >
            <RefreshCw size={12} className={isPreflightChecking ? 'animate-spin' : ''} />
            修复后重新检查
          </button>
        </div>
      </div>
    );
  };

  // 针对启动失败提供结构化错误处理与用户可理解建议
  const renderLaunchErrorResolution = () => {
    if (!lastLaunchError) return null;

    let actionableAdvice = '请检查本地终端环境与 Claude Code 运行状态。';
    let suggestedCmd = '';

    switch (lastLaunchError.code) {
      case 'CLI_NOT_FOUND':
        actionableAdvice = '系统找不到 claude 命令。请先安装 Claude Code CLI 并将其添加到 PATH 环境变量中。';
        suggestedCmd = 'npm install -g @anthropic-ai/claude-code';
        break;
      case 'CLI_AUTH_FAILED':
        actionableAdvice = 'Claude Code 认证失效或 API 凭据未配置。请在终端执行登录命令。';
        suggestedCmd = 'claude login';
        break;
      case 'TERMINAL_LAUNCH_FAILED':
        actionableAdvice = '无法拉起外部终端应用（osascript / wt 异常）。您可手动复制启动指令并在终端粘贴运行。';
        suggestedCmd = activeWorkPackage
          ? `cd /Users/jacko/Projects/MFP-Antigravity && claude --name "MFP · ${activeWorkPackage.requestId}" "请读取 AGENTS.md 与 requests/${activeWorkPackage.requestId}/agent-task.md 并开始执行"`
          : '';
        break;
      case 'CONCURRENT_RUN':
        actionableAdvice = '该需求已有会话正在运行中，系统禁止重复开启多个终端避免冲突。';
        break;
      case 'SESSION_NOT_FOUND':
        actionableAdvice = '历史会话文件未找到。建议点击「强制创建新会话」重新初始化。';
        break;
      default:
        actionableAdvice = lastLaunchError.message;
    }

    return (
      <div className="resolution-card">
        <div className="resolution-title">
          <XCircle size={17} />
          <span>错误码: {lastLaunchError.code} ({lastLaunchError.category})</span>
        </div>
        <div style={{ fontSize: 13, color: '#fecaca', marginBottom: 8 }}>
          {lastLaunchError.message}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong>建议处理方案：</strong> {actionableAdvice}
        </div>

        {suggestedCmd && (
          <div className="code-box">
            <code>{suggestedCmd}</code>
            <button
              className="btn btn-secondary btn-sm"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => copyToClipboard(suggestedCmd, 'err_fix')}
            >
              {copiedCmd === 'err_fix' ? <Check size={12} /> : <Copy size={12} />}
              {copiedCmd === 'err_fix' ? '已复制' : '复制命令'}
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={handleStartSession}>
            <Play size={13} />
            重试启动
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleForceNewSession}>
            <Zap size={13} />
            创建新会话
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setLastLaunchError(null)}>
            关闭提示
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="app-container">
      {/* 顶部导航栏 */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo-badge">
            <Compass size={20} />
          </div>
          <div className="brand-title-group">
            <h1>
              Magene Firmware Playground
              <span className="brand-badge">MVP</span>
            </h1>
            <div className="brand-subtitle">迈金固件 PM Claude Code 本地工作台</div>
          </div>
        </div>

        <nav className="header-nav">
          <button
            className={`nav-tab-btn ${currentPage === 'pool' || currentPage === 'detail' ? 'active' : ''}`}
            onClick={() => {
              setCurrentPage('pool');
            }}
          >
            <FolderOpen size={16} />
            需求池与工作包
          </button>
          <button
            className={`nav-tab-btn ${currentPage === 'intake' ? 'active' : ''}`}
            onClick={() => {
              handleResetIntake();
              setCurrentPage('intake');
            }}
          >
            <Sparkles size={16} />
            原始需求识别
          </button>
        </nav>

        {/* 运行模式与环境状态 */}
        {isTauri() ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="badge badge-done" style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', fontSize: 11, padding: '3px 8px' }}>
              macOS 桌面应用模式 (Tauri)
            </span>
            <div className="header-status-indicator">
              <div className={`status-dot ${activeWorkPackage?.session.processState === 'running' ? 'pulsing' : 'active'}`} />
              <span>
                {activeWorkPackage?.session.processState === 'running' ? 'Agent 运行中' : '本地桥接已连接'}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              <span className="badge badge-pending" style={{ fontSize: 10, padding: '2px 6px' }}>Mock 演示模式</span>
              <span style={{ color: 'var(--text-subtle)' }}>模拟场景:</span>
              <select
                style={{
                  background: 'var(--bg-surface-raised)',
                  color: 'var(--brand-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 8px',
                  fontSize: 11,
                  outline: 'none',
                  cursor: 'pointer',
                }}
                value={currentScenario}
                onChange={(e) => handleScenarioChange(e.target.value as MockScenario)}
              >
                <option value="normal">🟢 正常通过 (PRD 就绪)</option>
                <option value="cli_not_installed">🔴 CLI 未安装</option>
                <option value="not_authenticated">🟡 未认证 / 登录失效</option>
                <option value="root_missing">🔴 项目目录丢失</option>
                <option value="launch_failed">🔴 终端启动失败</option>
                <option value="resume_fallback">🟠 恢复会话降级</option>
                <option value="prd_not_found">📁 PRD 未生成 (not_generated)</option>
                <option value="prd_read_failed">⚠️ PRD 读取失败 (500 异常)</option>
                <option value="prd_changed">⚡ PRD 冲突变更 (PRD_CHANGED)</option>
              </select>
            </div>

            <div className="header-status-indicator">
              <div className={`status-dot ${activeWorkPackage?.session.processState === 'running' ? 'pulsing' : 'active'}`} />
              <span>
                {activeWorkPackage?.session.processState === 'running' ? 'Agent 运行中' : '前端 Mock 就绪'}
              </span>
            </div>
          </div>
        )}
      </header>

      {/* 主工作区 */}
      <main className="main-wrapper">
        {/* ========================================================================= */}
        {/* Issue #4: 原始需求录入与识别页面                                          */}
        {/* ========================================================================= */}
        {currentPage === 'intake' && (
          <div className="intake-container">
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Sparkles size={22} color="var(--brand-primary)" />
                  原始需求输入与智能识别
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                  粘贴来自聊天群、工单或 PM 记录的原始描述，Claude Code 将结合 MFP 知识库进行结构化改写与缺口分析。
                </p>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setCurrentPage('pool');
                }}
              >
                查看需求池 &rarr;
              </button>
            </div>

            <div className="grid-2col">
              {/* 左侧：输入表单 */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">
                    <FileText size={18} color="var(--brand-primary)" />
                    需求原文录入
                  </span>
                  {currentRaw && (
                    <span className="badge badge-outline" style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentRaw.requestId}
                    </span>
                  )}
                </div>

                {!currentRaw && (
                  <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-subtle)', alignSelf: 'center' }}>填入示例：</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleFillDemo('cadence')}>
                      C706 踏频低电量提示
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleFillDemo('radar')}>
                      L508 雷达防眩目调光
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleFillDemo('bug')}>
                      骑行台断连异常
                    </button>
                  </div>
                )}

                <div className="form-group">
                  <div className="form-label">
                    <span>原始需求文本 (必填)</span>
                    <span className={`char-counter ${isOverLimit ? 'danger' : charCount > 18000 ? 'warning' : ''}`}>
                      {charCount} / 20,000 字符
                    </span>
                  </div>
                  <textarea
                    className="form-textarea"
                    rows={8}
                    placeholder="在此粘贴原始客户反馈、会议纪要或功能描述（支持 1~20,000 字）..."
                    value={rawText}
                    disabled={intakeLoading || !!currentRaw}
                    onChange={(e) => setRawText(e.target.value)}
                  />
                  {isOverLimit && (
                    <div style={{ color: 'var(--status-error-text)', fontSize: 12, marginTop: 6, display: 'flex', gap: 6 }}>
                      <AlertTriangle size={14} />
                      文本已超过 20,000 字符上限，建议拆分为多个独立需求分段录入。
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">来源说明 (选填)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="例如：客户 IM、社区群、售后工单"
                    value={sourceDesc}
                    disabled={intakeLoading || !!currentRaw}
                    onChange={(e) => setSourceDesc(e.target.value)}
                  />
                </div>

                {intakeError && (
                  <div className="alert-box alert-danger">
                    <AlertTriangle size={18} />
                    <div>
                      <strong>识别异常：</strong>
                      {intakeError}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                  {!currentRaw ? (
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1 }}
                      disabled={isTooShort || isOverLimit || intakeLoading}
                      onClick={handleStartRecognition}
                    >
                      {intakeLoading ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Claude Code 结构化识别中...
                        </>
                      ) : (
                        <>
                          <Sparkles size={16} />
                          保存原文并开始 AI 识别
                        </>
                      )}
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-secondary" disabled={intakeLoading} onClick={handleResetIntake}>
                        <RotateCcw size={15} />
                        重新录入新需求
                      </button>
                      <button
                        className="btn btn-danger"
                        disabled={intakeLoading}
                        onClick={() => {
                          if (window.confirm('确认归档此输入？')) handleResetIntake();
                        }}
                      >
                        <Archive size={15} />
                        标记归档
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 右侧：识别结果展示 */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">
                    <Sparkles size={18} color="var(--brand-primary)" />
                    AI 识别与改写建议
                  </span>
                  {recognition && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span className="badge badge-running">{recognition.category}</span>
                      <span className="badge badge-done">置信度: {recognition.confidence}</span>
                    </div>
                  )}
                </div>

                {!currentRaw && !intakeLoading && (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-subtle)' }}>
                    <Info size={36} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                    <p style={{ fontSize: 14 }}>左侧输入需求并点击识别后，在此查看结构化改写与缺口分析。</p>
                    <p style={{ fontSize: 12, marginTop: 4 }}>所有识别结果仅为建议，必须由 PM 决策后才转为正式需求。</p>
                  </div>
                )}

                {intakeLoading && (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <Loader2 size={36} className="animate-spin" style={{ margin: '0 auto 16px', color: 'var(--brand-primary)' }} />
                    <p style={{ fontSize: 14, fontWeight: 600 }}>Claude Code 非交互模式分析中...</p>
                    <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 6 }}>
                      正在召回 <code>knowledge-base/01_事实源/BENCHMARK.md</code>
                    </p>
                  </div>
                )}

                {recognition && (
                  <div className="recognition-results">
                    <div style={{ marginBottom: 18, background: 'var(--bg-surface-raised)', padding: 14, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 12, color: 'var(--brand-primary)', fontWeight: 600, marginBottom: 4 }}>
                        改写功能需求
                      </div>
                      <div style={{ fontSize: 14, color: '#ffffff', lineHeight: 1.6 }}>
                        {recognition.rewrittenRequirement}
                      </div>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Layers size={14} /> 用户、场景与目标
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-main)', background: 'var(--bg-base)', padding: 10, borderRadius: 'var(--radius-sm)', lineHeight: 1.6 }}>
                        <div><strong>用户：</strong>{recognition.user}</div>
                        <div style={{ marginTop: 4 }}><strong>场景：</strong>{recognition.scenario}</div>
                        <div style={{ marginTop: 4 }}><strong>目标：</strong>{recognition.goal}</div>
                      </div>
                    </div>

                    {recognition.missingInformation.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#facc15', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <HelpCircle size={14} /> 关键待确认缺口（需 PM 后续澄清）
                        </div>
                        <ul style={{ paddingLeft: 20, fontSize: 12.5, color: '#fef08a' }}>
                          {recognition.missingInformation.map((m, idx) => (
                            <li key={idx} style={{ marginBottom: 4 }}>{m}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {recognition.evidence.length > 0 && (
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <BookOpen size={14} /> 关联知识库依据
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {recognition.evidence.map((ev, idx) => (
                            <div key={idx} style={{ fontSize: 12, color: 'var(--text-subtle)', background: 'var(--bg-base)', padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
                              <code style={{ color: 'var(--brand-primary)' }}>{ev.ref}</code> {ev.note ? `— ${ev.note}` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                        PM 确认后将创建正式 REQ 工作包与任务卡
                      </div>
                      <button
                        className="btn btn-success"
                        onClick={handleRegisterRequirement}
                        disabled={intakeLoading}
                      >
                        <CheckCircle2 size={16} />
                        确认登记为正式需求
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* Issue #5: 需求池列表页面                                                  */}
        {/* ========================================================================= */}
        {currentPage === 'pool' && (
          <div className="requirement-pool-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FolderOpen size={22} color="var(--brand-primary)" />
                  需求池与工作包管理
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                  查看已登记的需求工作包，跟踪 Agent 澄清状态、问答互动与 PRD 产出。
                </p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setCurrentPage('intake');
                }}
              >
                <Sparkles size={16} />
                新建原始需求录入
              </button>
            </div>

            <div className="card" style={{ padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                  {[
                    { key: 'all', label: '全部需求' },
                    { key: 'pending_launch', label: '待启动' },
                    { key: 'processing', label: '处理中' },
                    { key: 'pending_answer', label: '待 PM 回答' },
                    { key: 'pending_review', label: '待审阅' },
                    { key: 'revising', label: '修改中' },
                    { key: 'completed', label: '完成' },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      className={`nav-tab-btn ${poolStatusFilter === opt.key ? 'active' : ''}`}
                      style={{ padding: '6px 12px', fontSize: 12.5 }}
                      onClick={() => setPoolStatusFilter(opt.key)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div style={{ position: 'relative', minWidth: 260 }}>
                  <Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-subtle)' }} />
                  <input
                    type="text"
                    className="form-input"
                    style={{ paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8, fontSize: 13 }}
                    placeholder="搜索需求编号、描述..."
                    value={poolSearchQuery}
                    onChange={(e) => setPoolSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 160 }}>需求编号</th>
                      <th>需求改写描述</th>
                      <th style={{ width: 120 }}>状态</th>
                      <th>下一步操作 (Next Action)</th>
                      <th style={{ width: 150 }}>最近更新</th>
                      <th style={{ width: 90, textAlign: 'center' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workPackages.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '50px 0', color: 'var(--text-subtle)' }}>
                          <AlertCircle size={28} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                          <p>暂无已登记的需求工作包，点击右上角「新建原始需求录入」开始！</p>
                        </td>
                      </tr>
                    ) : (
                      workPackages
                        .filter((wp) => poolStatusFilter === 'all' || wp.status === poolStatusFilter)
                        .filter((wp) =>
                          poolSearchQuery
                            ? wp.requestId.toLowerCase().includes(poolSearchQuery.toLowerCase()) ||
                              (wp.recognition?.rewrittenRequirement || '').toLowerCase().includes(poolSearchQuery.toLowerCase())
                            : true
                        )
                        .map((wp) => (
                          <tr
                            key={wp.requestId}
                            style={{ cursor: 'pointer' }}
                            onClick={() => loadDetail(wp.requestId)}
                          >
                            <td>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12, color: 'var(--brand-primary)' }}>
                                {wp.requestId}
                              </span>
                              {wp.originalInput.sourceDescription && (
                                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                                  {wp.originalInput.sourceDescription}
                                </div>
                              )}
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 3 }}>
                                {wp.recognition?.rewrittenRequirement.slice(0, 45) || wp.originalInput.text.slice(0, 45)}...
                              </div>
                            </td>
                            <td>{getStatusBadge(wp.status)}</td>
                            <td>
                              <div style={{ fontSize: 12, color: '#e2e8f0' }}>
                                {getNextActionText(wp.status)}
                              </div>
                            </td>
                            <td>
                              <div style={{ fontSize: 12, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Clock size={12} />
                                {wp.updatedAt.slice(0, 19).replace('T', ' ')}
                              </div>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  loadDetail(wp.requestId);
                                }}
                              >
                                进入 &rarr;
                              </button>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* Issue #5 & Issue #3: 需求工作包详情（Preflight、启动/恢复、问答、PRD）      */}
        {/* ========================================================================= */}
        {currentPage === 'detail' && activeWorkPackage && (
          <div className="work-package-detail">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setCurrentPage('pool');
                }}
              >
                <ArrowLeft size={14} />
                返回需求池
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const cmd = `cd /Users/jacko/Projects/MFP-Antigravity && claude --name "MFP · ${activeWorkPackage.requestId}" "请读取 AGENTS.md 与 requests/${activeWorkPackage.requestId}/agent-task.md 并开始执行"`;
                    copyToClipboard(cmd, 'cmd_fallback');
                  }}
                >
                  {copiedCmd === 'cmd_fallback' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedCmd === 'cmd_fallback' ? '已复制启动指令' : '复制启动指令 (Fallback)'}
                </button>
              </div>
            </div>

            {/* 需求主卡片 */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--brand-primary)', fontWeight: 700 }}>
                      {activeWorkPackage.requestId}
                    </span>
                    <span className="badge badge-outline">
                      {activeWorkPackage.recognition?.category || 'feature'}
                    </span>
                    {getStatusBadge(activeWorkPackage.status)}
                  </div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>
                    {activeWorkPackage.recognition?.rewrittenRequirement || activeWorkPackage.originalInput.text}
                  </h2>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'right' }}>
                  <div>创建时间：{activeWorkPackage.originalInput.createdAt.slice(0, 19).replace('T', ' ')}</div>
                  <div style={{ marginTop: 2 }}>更新时间：{activeWorkPackage.updatedAt.slice(0, 19).replace('T', ' ')}</div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  background: 'var(--bg-surface-raised)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ color: 'var(--brand-primary)', fontWeight: 600, fontSize: 13 }}>下一步操作：</span>
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>{getNextActionText(activeWorkPackage.status)}</span>
              </div>
            </div>

            {/* 全局会话反馈提示 (对所有 Tab 可见) */}
            {sessionFeedback && (
              <div
                style={{ marginBottom: 16 }}
                className={`alert-box alert-${sessionFeedback.type === 'error' ? 'danger' : sessionFeedback.type === 'warning' ? 'warning' : 'info'}`}
              >
                {sessionFeedback.type === 'error' ? (
                  <XCircle size={18} />
                ) : sessionFeedback.type === 'warning' ? (
                  <AlertTriangle size={18} />
                ) : (
                  <CheckCircle2 size={18} color="var(--brand-primary)" />
                )}
                <div>
                  <strong>{sessionFeedback.title}</strong>
                  <div style={{ marginTop: 2 }}>{sessionFeedback.message}</div>
                  {sessionFeedback.details && (
                    <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{sessionFeedback.details}</div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 导航 */}
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10, marginBottom: 20 }}>
              <button
                className={`nav-tab-btn ${activeDetailTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveDetailTab('overview')}
              >
                <Layers size={15} />
                启动 Agent & Preflight 检查
              </button>
              <button
                className={`nav-tab-btn ${activeDetailTab === 'clarification' ? 'active' : ''}`}
                onClick={() => setActiveDetailTab('clarification')}
              >
                <HelpCircle size={15} />
                澄清问答 (questions.json)
                {activeWorkPackage.questions.filter((q) => !q.answer).length > 0 && (
                  <span className="badge badge-pending" style={{ padding: '1px 6px', fontSize: 10, marginLeft: 4 }}>
                    {activeWorkPackage.questions.filter((q) => !q.answer).length}
                  </span>
                )}
              </button>
              <button
                className={`nav-tab-btn ${activeDetailTab === 'prd' ? 'active' : ''}`}
                onClick={() => setActiveDetailTab('prd')}
              >
                <FileCode size={15} />
                PRD 评审与修改 (02-PRD.md)
              </button>
              <button
                className={`nav-tab-btn ${activeDetailTab === 'logs' ? 'active' : ''}`}
                onClick={() => setActiveDetailTab('logs')}
              >
                <Terminal size={15} />
                执行日志 ({activeWorkPackage.runLog.length})
              </button>
            </div>

            {/* Tab 1: 启动 Agent & Preflight 检查 */}
            {activeDetailTab === 'overview' && (
              <div>

                {/* Preflight 失败诊断与建议 */}
                {renderPreflightDiagnosis()}

                {/* 启动失败结构化建议 */}
                {renderLaunchErrorResolution()}

                <div className="grid-2col">
                  {/* 左侧：启动控制与 Preflight 检查 */}
                  <div className="card">
                    <div className="card-header">
                      <span className="card-title">
                        <ShieldCheck size={18} color="var(--brand-primary)" />
                        Claude Code 启动前环境检查
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`badge ${isPreflightPassed ? 'badge-done' : 'badge-error'}`}>
                          {isPreflightPassed ? '检查全部通过' : '存在未通过项'}
                        </span>
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={isPreflightChecking}
                          onClick={() => runPreflight(activeWorkPackage.requestId)}
                        >
                          <RefreshCw size={12} className={isPreflightChecking ? 'animate-spin' : ''} />
                          重新检查
                        </button>
                      </div>
                    </div>

                    {/* Preflight Checklist 项 */}
                    {preflight ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {preflight.checks.map((c) => (
                          <div
                            key={c.name}
                            className={`preflight-item ${c.ok ? 'pass' : 'fail'}`}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                                {c.name === 'mfp_root_exists' && '1. MFP 项目目录存在性'}
                                {c.name === 'mfp_root_writable' && '2. 工作区写权限'}
                                {c.name === 'cli_installed' && '3. Claude Code CLI 安装'}
                                {c.name === 'cli_version' && '4. Claude Code 版本'}
                                {c.name === 'cli_auth' && '5. Claude Code 认证探测'}
                                {c.name === 'rules_entrypoints' && '6. 规则与事实源入口 (AGENTS/BENCHMARK)'}
                                {c.name === 'task_card_readable' && '7. 任务卡可读性 (agent-task.md)'}
                                {c.name === 'output_writable' && '8. 输出目录可写性 (output/)'}
                              </span>
                              <span style={{ fontSize: 11.5, color: c.ok ? 'var(--text-muted)' : '#f87171' }}>
                                {c.detail}
                              </span>
                            </div>
                            <div>
                              {c.ok ? (
                                <span style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                                  <CheckCircle2 size={15} /> 通过
                                </span>
                              ) : (
                                <span style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                                  <AlertTriangle size={15} /> 失败
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                        <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                        正在执行启动前环境预检...
                      </div>
                    )}

                    {/* 启动与会话控制按钮组 */}
                    <div style={{ marginTop: 20, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                      {/* 未启动或初次启动 */}
                      {activeWorkPackage.session.processState !== 'running' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <button
                            className="btn btn-primary"
                            style={{ width: '100%', padding: '12px 18px', fontSize: 14 }}
                            disabled={isStartingSession || !isPreflightPassed}
                            onClick={handleStartSession}
                          >
                            {isStartingSession ? (
                              <>
                                <Loader2 size={16} className="animate-spin" />
                                正在拉起外部终端并启动 Claude Code...
                              </>
                            ) : (
                              <>
                                <Play size={16} />
                                打开外部终端并启动 Agent
                              </>
                            )}
                          </button>

                          {activeWorkPackage.session.sessionId && (
                            <button
                              className="btn btn-secondary"
                              style={{ width: '100%', fontSize: 13 }}
                              disabled={isStartingSession}
                              onClick={handleResumeSession}
                            >
                              <RefreshCw size={14} />
                              恢复历史会话 [{activeWorkPackage.session.sessionId}]
                            </button>
                          )}
                        </div>
                      ) : (
                        /* 运行中状态 */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.3)', padding: 12, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div className="status-dot pulsing" />
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#22d3ee' }}>
                                  Claude Code 正在终端运行中
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  Session ID: <code>{activeWorkPackage.session.sessionId}</code>
                                </div>
                              </div>
                            </div>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={handleResumeSession}
                              disabled={isStartingSession}
                            >
                              <RefreshCw size={12} />
                              同步恢复
                            </button>
                          </div>

                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ flex: 1 }}
                              onClick={handleForceNewSession}
                            >
                              <Zap size={13} />
                              强制创建新会话
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ flex: 1 }}
                              onClick={() => {
                                const cmd = `cd /Users/jacko/Projects/MFP-Antigravity && claude --name "MFP · ${activeWorkPackage.requestId}" "请读取 AGENTS.md 与 requests/${activeWorkPackage.requestId}/agent-task.md 并开始执行"`;
                                copyToClipboard(cmd, 'cmd_running');
                              }}
                            >
                              {copiedCmd === 'cmd_running' ? <Check size={12} /> : <Copy size={12} />}
                              {copiedCmd === 'cmd_running' ? '已复制指令' : '复制终端指令'}
                            </button>
                          </div>
                        </div>
                      )}

                      {!isPreflightPassed && (
                        <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 8, textAlign: 'center' }}>
                          ⚠️ 环境预检存在未通过项，请先参考上方建议完成修复后再启动
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 右侧：会话元数据与任务卡契约 */}
                  <div className="card">
                    <div className="card-header">
                      <span className="card-title">
                        <Terminal size={18} color="var(--brand-primary)" />
                        会话元数据与任务卡契约
                      </span>
                    </div>

                    <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Session ID:</span>
                        <code style={{ color: 'var(--brand-primary)' }}>{activeWorkPackage.session.sessionId || '未初始化'}</code>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', padding: '6px 0' }}>
                        <span style={{ color: 'var(--text-muted)' }}>运行状态:</span>
                        <span className={`badge ${activeWorkPackage.session.processState === 'running' ? 'badge-running' : 'badge-outline'}`}>
                          {activeWorkPackage.session.processState || 'idle'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', padding: '6px 0' }}>
                        <span style={{ color: 'var(--text-muted)' }}>CLI 版本:</span>
                        <span>{activeWorkPackage.session.cliVersion || 'claude 2.1.229'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>启动时间:</span>
                        <span>{activeWorkPackage.session.startedAt?.slice(0, 19).replace('T', ' ') || '—'}</span>
                      </div>
                    </div>

                    {/* 任务卡简要预览 */}
                    <div style={{ marginTop: 20, background: 'var(--bg-base)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand-primary)', marginBottom: 4 }}>
                        📄 任务卡 (agent-task.md) 核心约定
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        <div>• 目标：产出符合事实红线与人群模型的 02-PRD.md</div>
                        <div>• 工作目录：<code>/Users/jacko/Projects/MFP-Antigravity</code></div>
                        <div>• 规则文件：只读引用 <code>AGENTS.md</code> 与 <code>BENCHMARK.md</code></div>
                        <div>• 暂停条件：遇到阻塞性硬件/协议未决时写 <code>questions.json</code></div>
                      </div>
                    </div>

                    {activeWorkPackage.recognition?.evidence && (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <BookOpen size={14} /> 事实源基准依据
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {activeWorkPackage.recognition.evidence.map((ev, idx) => (
                            <div key={idx} style={{ fontSize: 11.5, color: 'var(--text-subtle)', background: 'var(--bg-base)', padding: '5px 8px', borderRadius: 'var(--radius-sm)' }}>
                              <code>{ev.ref}</code> {ev.note ? `— ${ev.note}` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: 澄清问答 */}
            {activeDetailTab === 'clarification' && (() => {
              const pendingQuestions = activeWorkPackage.questions.filter((q) => !q.answer);
              const answeredQuestions = activeWorkPackage.questions.filter((q) => q.answer);
              const currentFilledCount = pendingQuestions.filter(
                (q) => (answers[q.id] || '').trim().length > 0
              ).length;
              const unFilledCount = pendingQuestions.length - currentFilledCount;

              return (
                <div className="clarification-panel">
                  <div className="alert-box alert-info">
                    <Info size={18} />
                    <div>
                      <strong>澄清机制说明：</strong>
                      当 Claude Code 发现信息缺口或关键产品边界未决时，会将阻塞性问题写入 <code>requests/{activeWorkPackage.requestId}/questions.json</code> 并暂停。
                      您在此集中填写的回答将同步至工作包，支持「仅保存回答」或「保存回答并继续唤起 Agent」。
                    </div>
                  </div>

                  {resumeAfterSaveFailed && (
                    <div className="alert-box alert-warning" style={{ marginBottom: 16 }}>
                      <AlertTriangle size={18} />
                      <div style={{ flex: 1 }}>
                        <strong>回答已保存，但终端拉起失败：</strong>
                        回答内容已成功持久化至工作包，当前 Agent 终端未正常运行。您可以直接重试恢复会话，无需重新输入。
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={isStartingSession}
                        onClick={handleResumeSession}
                      >
                        <RefreshCw size={12} className={isStartingSession ? 'animate-spin' : ''} />
                        重试唤起 Claude Code
                      </button>
                    </div>
                  )}

                  {/* 问答统计与集中操作栏 */}
                  <div className="card" style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>待回答问题: </span>
                          <strong style={{ fontSize: 16, color: pendingQuestions.length > 0 ? '#facc15' : '#4ade80' }}>
                            {pendingQuestions.length}
                          </strong>
                        </div>
                        <div style={{ height: 16, width: 1, background: 'var(--border-subtle)' }} />
                        <div>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>已澄清记录: </span>
                          <strong style={{ fontSize: 16, color: '#4ade80' }}>{answeredQuestions.length}</strong>
                        </div>
                        <div style={{ height: 16, width: 1, background: 'var(--border-subtle)' }} />
                        <div>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>本次已填写草稿: </span>
                          <strong style={{ fontSize: 16, color: '#00b4d8' }}>{currentFilledCount}</strong>
                          {pendingQuestions.length > 0 && unFilledCount > 0 && (
                            <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 6 }}>
                              (剩余 {unFilledCount} 项待填)
                            </span>
                          )}
                        </div>
                      </div>

                      {pendingQuestions.length > 0 && (
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={isSavingAnswers || currentFilledCount === 0}
                            onClick={handleSaveAnswersOnly}
                            title="仅保存至工作包，不唤起 Agent 终端"
                          >
                            {isSavingAnswers ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            仅保存回答 (不唤起)
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={isSavingAnswers || (currentFilledCount === 0 && pendingQuestions.length > 0)}
                            onClick={handleSaveAnswersAndResume}
                            title="保存已填写的回答并唤起 Claude Code 继续执行"
                          >
                            {isSavingAnswers ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                            保存回答并继续
                          </button>
                        </div>
                      )}
                    </div>

                    {pendingQuestions.length > 0 && currentFilledCount > 0 && unFilledCount > 0 && (
                      <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 10, background: 'rgba(245, 158, 11, 0.08)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                        ℹ️ 提示：当前仅填写了 {currentFilledCount} 项，尚有 {unFilledCount} 项未填。系统支持部分提交并继续唤起 Agent，未填项将保持待回答状态。
                      </div>
                    )}
                  </div>

                  <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-header">
                      <span className="card-title">
                        <HelpCircle size={18} color="#facc15" />
                        待 PM 确认的问题 ({pendingQuestions.length})
                      </span>
                    </div>

                    {pendingQuestions.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-subtle)' }}>
                        <CheckCircle2 size={32} color="#4ade80" style={{ margin: '0 auto 8px', opacity: 0.8 }} />
                        <p style={{ fontSize: 14, color: 'var(--text-main)' }}>暂无待回答的澄清问题</p>
                        <p style={{ fontSize: 12, marginTop: 4 }}>Agent 目前信息完备或已进入 PRD 撰写阶段。</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        {pendingQuestions.map((q, idx) => {
                          const hasDraft = !!(answers[q.id] || '').trim();
                          return (
                            <div
                              key={q.id}
                              style={{
                                background: 'var(--bg-surface-raised)',
                                border: hasDraft ? '1px solid rgba(0, 180, 216, 0.35)' : '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-md)',
                                padding: 18,
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <div style={{ fontSize: 15, fontWeight: 600, color: '#ffffff', flex: 1, paddingRight: 10 }}>
                                  #{idx + 1} {q.text}
                                </div>
                                <span className={`badge ${hasDraft ? 'badge-running' : 'badge-outline'}`} style={{ fontSize: 11 }}>
                                  {hasDraft ? '已填草稿' : '待填写'}
                                </span>
                              </div>

                              <div className="form-group" style={{ marginBottom: 12 }}>
                                <textarea
                                  className="form-textarea"
                                  rows={3}
                                  placeholder="输入 PM 决策口径或产品边界规则..."
                                  value={answers[q.id] || ''}
                                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                                />
                              </div>

                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  disabled={!hasDraft}
                                  onClick={() => handleAnswerQuestion(q.id, false)}
                                  title="仅保存本题回答至工作包"
                                >
                                  暂存回答
                                </button>
                                <button
                                  className="btn btn-primary btn-sm"
                                  disabled={!hasDraft}
                                  onClick={() => handleAnswerQuestion(q.id, true)}
                                  title="保存本题回答并唤起 Claude Code"
                                >
                                  <Send size={13} />
                                  回答并继续
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 已回答历史 */}
                  {answeredQuestions.length > 0 && (
                    <div className="card">
                      <div className="card-header">
                        <span className="card-title">
                          <CheckCircle2 size={18} color="#4ade80" />
                          已澄清记录 ({answeredQuestions.length})
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {answeredQuestions.map((q) => (
                          <div
                            key={q.id}
                            style={{
                              background: 'var(--bg-base)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-md)',
                              padding: 14,
                            }}
                          >
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                              {q.text}
                            </div>
                            <div style={{ fontSize: 13, color: '#4ade80', background: 'rgba(34, 197, 94, 0.08)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                              <strong>PM 回答：</strong> {q.answer}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Tab 3: PRD 评审 */}
            {activeDetailTab === 'prd' && (
              <div className="prd-review-panel">
                {/* 顶部操作与元数据栏 */}
                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className="card-title" style={{ margin: 0 }}>
                        <FileText size={20} color="var(--brand-primary)" />
                        PRD 产出文档审阅
                      </span>
                      {prdDoc && prdDoc.state === 'ready' && (
                        <span className="badge badge-outline" style={{ borderColor: 'var(--brand-primary)', color: 'var(--brand-primary)' }}>
                          版本: {prdDoc.version}
                        </span>
                      )}
                      {activeWorkPackage.status === 'completed' && (
                        <span className="badge badge-done" style={{ background: 'rgba(34, 197, 94, 0.25)', color: '#4ade80' }}>
                          <CheckCircle2 size={12} /> PM 已最终确认完成 (终态)
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={prdLoading}
                        onClick={() => loadPrdDocument(activeWorkPackage.requestId)}
                        title="从本地文件系统重新读取 PRD"
                      >
                        <RefreshCw size={13} className={prdLoading ? 'animate-spin' : ''} />
                        刷新文件
                      </button>

                      {activeWorkPackage.status !== 'completed' && prdDoc && prdDoc.state === 'ready' && (
                        <button className="btn btn-success btn-sm" onClick={() => setShowCompleteModal(true)}>
                          <CheckCircle2 size={14} />
                          确认完成 (终态验收)
                        </button>
                      )}
                    </div>
                  </div>

                  {/* PRD 元数据条目 */}
                  {prdDoc && prdDoc.state === 'ready' && (
                    <div
                      style={{
                        marginTop: 14,
                        paddingTop: 12,
                        borderTop: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 20,
                        fontSize: 12,
                        color: 'var(--text-muted)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FolderOpen size={14} color="var(--brand-primary)" />
                        <span>路径:</span>
                        <code style={{ color: 'var(--text-main)' }}>{prdDoc.path}</code>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '1px 6px', fontSize: 11 }}
                          onClick={() => copyToClipboard(prdDoc.path, 'prd_path')}
                        >
                          {copiedCmd === 'prd_path' ? <Check size={11} /> : <Copy size={11} />}
                          {copiedCmd === 'prd_path' ? '已复制' : '复制'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Hash size={14} color="var(--brand-primary)" />
                        <span>SHA-256:</span>
                        <code
                          title={`完整 Hash: ${prdDoc.contentHash}`}
                          style={{ color: '#22d3ee', background: 'var(--bg-surface-raised)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}
                        >
                          {prdDoc.contentHash.slice(0, 12)}...{prdDoc.contentHash.slice(-8)}
                        </code>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '1px 6px', fontSize: 11 }}
                          onClick={() => copyToClipboard(prdDoc.contentHash, 'prd_hash')}
                        >
                          {copiedCmd === 'prd_hash' ? <Check size={11} /> : <Copy size={11} />}
                          {copiedCmd === 'prd_hash' ? '已复制' : '复制完整 Hash'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* PRD 内容与修改意见布局 */}
                <div className="grid-2col" style={{ gridTemplateColumns: '1.4fr 0.8fr' }}>
                  {/* 左侧：PRD 预览核心区域 */}
                  <div className="card" style={{ padding: 28, background: '#0e131b', minHeight: 400 }}>
                    {prdLoading ? (
                      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                        <Loader2 size={36} className="animate-spin" color="var(--brand-primary)" style={{ margin: '0 auto 12px' }} />
                        <div style={{ fontSize: 14, color: 'var(--text-main)' }}>正在从本地文件系统读取 PRD...</div>
                        <div style={{ fontSize: 12, marginTop: 4 }}>目标路径: requests/{activeWorkPackage.requestId}/output/02-PRD.md</div>
                      </div>
                    ) : prdError ? (
                      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <XCircle size={36} color="#f87171" style={{ margin: '0 auto 12px' }} />
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#fecaca' }}>
                          PRD 读取失败 ({prdError.code})
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, maxWidth: 460, margin: '6px auto 16px' }}>
                          {prdError.message}
                        </div>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => loadPrdDocument(activeWorkPackage.requestId)}
                        >
                          <RefreshCw size={13} />
                          重新读取
                        </button>
                      </div>
                    ) : prdDoc && prdDoc.state === 'not_generated' ? (
                      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                        <FileCode2 size={42} color="var(--text-subtle)" style={{ margin: '0 auto 16px', opacity: 0.6 }} />
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-main)' }}>
                          PRD 尚未生成
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, maxWidth: 440, margin: '8px auto 20px', lineHeight: 1.6 }}>
                          Claude Code 尚未执行 Phase 4 或生成 <code>02-PRD.md</code>。系统严格遵循事实源规范，不展示任何虚构的临时内容。
                        </div>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setActiveDetailTab('overview')}
                        >
                          <Play size={13} />
                          前往会话管理启动 Claude Code
                        </button>
                      </div>
                    ) : prdDoc && prdDoc.state === 'ready' ? (
                      <div className="markdown-body">
                        <Markdown remarkPlugins={[remarkGfm]}>
                          {prdDoc.content}
                        </Markdown>
                      </div>
                    ) : null}
                  </div>

                  {/* 右侧：修改意见与历史修订 */}
                  <div>
                    {activeWorkPackage.status !== 'completed' ? (
                      <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header">
                          <span className="card-title" style={{ fontSize: 15 }}>
                            <Edit3 size={16} color="var(--brand-primary)" />
                            {revisionSavedCommentId ? '修改意见已记录 (待唤起 Agent)' : '提交修改意见 (写入 revision.md)'}
                          </span>
                        </div>

                        {revisionSavedCommentId && (
                          <div style={{ fontSize: 12, color: '#facc15', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>
                            ⚠️ 修改意见已成功保存到 <code>revision.md</code>，但上次唤起外部终端失败。点击下方按钮即可直接重试唤起，不会生成重复意见。
                          </div>
                        )}

                        <div className="form-group">
                          <label className="form-label" style={{ fontSize: 12.5 }}>
                            修改意见或补充约束
                          </label>
                          <textarea
                            className="form-textarea"
                            rows={6}
                            placeholder="例如：补充在车队模式下后车接近时的调光时序图，并明确极端电量下的降级规则..."
                            value={revisionComment}
                            disabled={isSubmittingRevision || !!revisionSavedCommentId || activeWorkPackage.session.processState === 'running'}
                            onChange={(e) => setRevisionComment(e.target.value)}
                          />
                        </div>

                        <button
                          className="btn btn-primary"
                          style={{ width: '100%' }}
                          disabled={
                            isSubmittingRevision ||
                            (!revisionSavedCommentId && !revisionComment.trim()) ||
                            activeWorkPackage.session.processState === 'running'
                          }
                          onClick={handleSubmitRevision}
                        >
                          {isSubmittingRevision ? (
                            <>
                              <Loader2 size={15} className="animate-spin" />
                              {revisionSavedCommentId ? '正在唤起终端...' : '正在写入 revision.md 并唤起 Agent...'}
                            </>
                          ) : revisionSavedCommentId ? (
                            <>
                              <RefreshCw size={15} />
                              重试唤起 Agent (修改意见已保存)
                            </>
                          ) : (
                            <>
                              <Send size={15} />
                              提交意见并要求 Claude Code 修改
                            </>
                          )}
                        </button>

                        {activeWorkPackage.session.processState === 'running' && (
                          <div style={{ fontSize: 11.5, color: '#22d3ee', marginTop: 8, textAlign: 'center' }}>
                            ℹ️ Claude Code 正在运行中，待本次执行完成后可提交修改意见
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="card" style={{ marginBottom: 20, borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#4ade80' }}>
                          <CheckCircle2 size={20} />
                          <span style={{ fontWeight: 600 }}>需求已完成交付</span>
                        </div>
                        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                          PRD 终稿已锁定，不可再提交修改意见。若需重大重构可登记新需求。
                        </p>
                      </div>
                    )}

                    {activeWorkPackage.revisionComments.length > 0 && (
                      <div className="card">
                        <div className="card-header">
                          <span className="card-title" style={{ fontSize: 14 }}>
                            <History size={15} color="var(--text-muted)" />
                            历史修订意见 ({activeWorkPackage.revisionComments.length})
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {activeWorkPackage.revisionComments.map((cmt, idx) => (
                            <div
                              key={cmt.id}
                              style={{
                                background: 'var(--bg-base)',
                                padding: '10px 12px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border-subtle)',
                                fontSize: 12.5,
                                color: 'var(--text-main)',
                              }}
                            >
                              <div style={{ fontSize: 11, color: 'var(--brand-primary)', marginBottom: 3 }}>
                                意见 #{idx + 1} ({cmt.createdAt.slice(0, 19).replace('T', ' ')})
                              </div>
                              {cmt.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 终态验收弹窗（带版本与 Hash 快照核对） */}
                {showCompleteModal && (
                  <div className="modal-backdrop" onClick={() => !isCompleting && setShowCompleteModal(false)}>
                    <div className="modal-container" onClick={(e) => e.stopPropagation()}>
                      <div className="card-header">
                        <span className="card-title">
                          <CheckCircle2 size={20} color="#4ade80" />
                          确认 PRD 终稿并标记完成
                        </span>
                      </div>

                      <div style={{ fontSize: 13.5, color: 'var(--text-main)', lineHeight: 1.7, marginBottom: 20 }}>
                        <p>
                          您即将完成需求 <strong>{activeWorkPackage.requestId}</strong> 的评审确认。
                        </p>

                        <div style={{ background: 'var(--bg-base)', padding: 14, borderRadius: 'var(--radius-md)', margin: '14px 0', border: '1px solid var(--border-subtle)', fontSize: 12.5 }}>
                          <div style={{ marginBottom: 6 }}>
                            <strong style={{ color: 'var(--text-muted)' }}>锁定文档: </strong>
                            <code>{(prdDoc && prdDoc.state === 'ready' && prdDoc.path) || activeWorkPackage.prdPath || '02-PRD.md'}</code>
                          </div>
                          <div style={{ marginBottom: 6 }}>
                            <strong style={{ color: 'var(--text-muted)' }}>锁定版本: </strong>
                            <span style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>
                              {(prdDoc && prdDoc.state === 'ready' && prdDoc.version) || activeWorkPackage.prdVersion || 'v1.0'}
                            </span>
                          </div>
                          <div>
                            <strong style={{ color: 'var(--text-muted)' }}>校验摘要 (SHA-256): </strong>
                            <code style={{ color: '#22d3ee' }}>
                              {(prdDoc && prdDoc.state === 'ready' && prdDoc.contentHash) || '未就绪'}
                            </code>
                          </div>
                        </div>

                        <div className="alert-box alert-warning" style={{ marginTop: 12 }}>
                          <AlertTriangle size={18} />
                          <div>
                            <strong>快照保护与门禁提醒：</strong>
                            提交时系统将校验当前 PRD 内容快照与后端文件是否严格一致。若文件在审阅期间被外部修改，将拒绝标记并提示重新审阅。确认完成为终态操作，锁定后不可再直接修订。
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                        <button
                          className="btn btn-secondary"
                          disabled={isCompleting}
                          onClick={() => setShowCompleteModal(false)}
                        >
                          取消
                        </button>
                        <button
                          className="btn btn-success"
                          disabled={isCompleting}
                          onClick={handleConfirmCompletion}
                        >
                          {isCompleting ? (
                            <>
                              <Loader2 size={14} className="animate-spin" />
                              正在校验快照并确认完成...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={14} />
                              确认完成验收
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: 运行日志 */}
            {activeDetailTab === 'logs' && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">
                    <Terminal size={18} color="var(--brand-primary)" />
                    Agent 执行记录 (runLog)
                  </span>
                  <span className="badge badge-outline">共 {activeWorkPackage.runLog.length} 条记录</span>
                </div>

                {activeWorkPackage.runLog.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-subtle)' }}>
                    暂无运行日志
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {activeWorkPackage.runLog.map((log) => (
                      <div
                        key={log.runId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 14,
                          padding: 12,
                          background: 'var(--bg-base)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border-subtle)',
                          fontSize: 13,
                        }}
                      >
                        <div style={{ minWidth: 140, color: 'var(--text-subtle)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={12} />
                          {log.startedAt.slice(0, 19).replace('T', ' ')}
                        </div>
                        <div style={{ minWidth: 90 }}>
                          <span className={`badge ${log.state === 'running' ? 'badge-running' : log.state === 'succeeded' ? 'badge-done' : 'badge-error'}`}>
                            {log.state}
                          </span>
                        </div>
                        <div style={{ flex: 1, color: 'var(--text-main)' }}>
                          Run ID: <code>{log.runId}</code> &mdash; Session: <code>{log.sessionId}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
