import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/web/App';
import { getBridge, FrontendMockBridge } from '../src/web/bridge-adapter';

describe('Issue #19: 真实 PRD 预览、集中问答与修改闭环 UI 测试', () => {
  let bridge: FrontendMockBridge;

  beforeEach(() => {
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(() => Promise.resolve()),
      },
    });
    const b = getBridge();
    if (b instanceof FrontendMockBridge) {
      bridge = b;
      bridge.setScenario('normal');
    }
  });

  // 辅助函数：登记一条标准需求并进入详情页
  async function setupRegisteredRequirement(demoName: RegExp = /C706 踏频低电量提示/i) {
    const intakeTabs = screen.getAllByRole('button', { name: /原始需求识别/i });
    fireEvent.click(intakeTabs[0]);

    const demoBtn = await screen.findByRole('button', { name: demoName });
    fireEvent.click(demoBtn);

    const startBtn = screen.getByRole('button', { name: /保存原文并开始 AI 识别/i });
    fireEvent.click(startBtn);

    await waitFor(
      () => {
        expect(screen.getByText(/改写功能需求/i)).toBeDefined();
        expect(screen.getByText(/确认登记为正式需求/i)).toBeDefined();
      },
      { timeout: 3000 }
    );

    const registerBtn = screen.getByRole('button', { name: /确认登记为正式需求/i });
    fireEvent.click(registerBtn);

    await waitFor(
      () => {
        expect(screen.getByText(/Claude Code 启动前环境检查/i)).toBeDefined();
      },
      { timeout: 3000 }
    );
  }

  describe('1. 真实 PRD 预览与状态映射', () => {
    it('正常状态下显示真实动态 PRD 文档、文件路径与 SHA-256 校验摘要，不再显示固定模板', async () => {
      render(<App />);
      await setupRegisteredRequirement();

      const prdTab = await screen.findByRole('button', { name: /PRD 评审与修改/i });
      fireEvent.click(prdTab);

      // 验证真实 Markdown 内容加载
      expect(await screen.findByText(/背景与目标/i)).toBeDefined();
      expect(screen.getByText(/协议与交互规范/i)).toBeDefined();

      // 验证元数据栏（文件路径与 SHA-256 哈希）
      expect(screen.getByText(/路径:/i)).toBeDefined();
      expect(screen.getByText(/SHA-256:/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /复制完整 Hash/i })).toBeDefined();

      // 验证刷新文件按钮存在
      const refreshBtn = screen.getByRole('button', { name: /刷新文件/i });
      expect(refreshBtn).toBeDefined();
      fireEvent.click(refreshBtn);
      expect(await screen.findByText(/背景与目标/i)).toBeDefined();
    });

    it('当 PRD 未生成时 (prd_not_found)，明确提示“PRD 尚未生成”，不显示虚构内容', async () => {
      bridge.setScenario('prd_not_found');
      render(<App />);
      await setupRegisteredRequirement();

      const prdTab = await screen.findByRole('button', { name: /PRD 评审与修改/i });
      fireEvent.click(prdTab);

      expect(await screen.findByText(/PRD 尚未生成/i)).toBeDefined();
      expect(screen.getByText(/系统严格遵循事实源规范，不展示任何虚构的临时内容/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /前往会话管理启动 Claude Code/i })).toBeDefined();
    });

    it('当 PRD 读取失败时 (prd_read_failed)，展示错误卡片及重新读取按钮', async () => {
      bridge.setScenario('prd_read_failed');
      render(<App />);
      await setupRegisteredRequirement();

      const prdTab = await screen.findByRole('button', { name: /PRD 评审与修改/i });
      fireEvent.click(prdTab);

      // 明确匹配错误卡片标题，避免匹配顶部模拟场景下拉选项
      expect(await screen.findByText('PRD 读取失败 (PRD_READ_FAILED)')).toBeDefined();
      expect(screen.getByRole('button', { name: /重新读取/i })).toBeDefined();
    });
  });

  describe('2. 集中问答与批量提交', () => {
    it('集中问答面板显示统计栏（待回答、已澄清、已填写草稿）', async () => {
      render(<App />);
      await setupRegisteredRequirement(/L508 雷达防眩目调光/i);

      const clarifyTab = await screen.findByRole('button', { name: /澄清问答/i });
      fireEvent.click(clarifyTab);

      // 验证待 PM 确认问题数量与统计栏
      expect(await screen.findByText(/待 PM 确认的问题/i)).toBeDefined();
      expect(screen.getByText(/待回答问题:/i)).toBeDefined();
      expect(screen.getByText(/已澄清记录:/i)).toBeDefined();
      expect(screen.getByText(/本次已填写草稿:/i)).toBeDefined();
    });

    it('「仅保存回答」调用 bridge.submitAnswers，不调用 resume，明确提示未唤起 Agent', async () => {
      const resumeSpy = vi.spyOn(bridge, 'resume');
      const submitAnswersSpy = vi.spyOn(bridge, 'submitAnswers');

      render(<App />);
      await setupRegisteredRequirement();

      const clarifyTab = await screen.findByRole('button', { name: /澄清问答/i });
      fireEvent.click(clarifyTab);

      const inputs = await screen.findAllByPlaceholderText(/输入 PM 决策口径或产品边界规则/i);
      expect(inputs.length).toBeGreaterThan(0);
      fireEvent.change(inputs[0], { target: { value: '允许 3 秒半透明浮层，不遮挡关键数据' } });

      // 点击「仅保存回答 (不唤起)」
      const saveOnlyBtn = screen.getByRole('button', { name: /仅保存回答 \(不唤起\)/i });
      fireEvent.click(saveOnlyBtn);

      await waitFor(() => {
        expect(submitAnswersSpy).toHaveBeenCalled();
        expect(resumeSpy).not.toHaveBeenCalled();
        expect(screen.getByText(/回答已保存（未唤起 Agent）/i)).toBeDefined();
      });

      resumeSpy.mockRestore();
      submitAnswersSpy.mockRestore();
    });

    it('「保存回答并继续」原子提交回答，并单次唤起 Claude Code resume', async () => {
      const resumeSpy = vi.spyOn(bridge, 'resume');
      const submitAnswersSpy = vi.spyOn(bridge, 'submitAnswers');

      render(<App />);
      await setupRegisteredRequirement();

      const clarifyTab = await screen.findByRole('button', { name: /澄清问答/i });
      fireEvent.click(clarifyTab);

      const inputs = await screen.findAllByPlaceholderText(/输入 PM 决策口径或产品边界规则/i);
      fireEvent.change(inputs[0], { target: { value: '踏频单次骑行最多提示 2 次' } });

      // 点击「保存回答并继续」
      const saveAndResumeBtn = screen.getByRole('button', { name: /保存回答并继续/i });
      fireEvent.click(saveAndResumeBtn);

      await waitFor(() => {
        expect(submitAnswersSpy).toHaveBeenCalledTimes(1);
        expect(resumeSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/回答已保存并恢复会话/i)).toBeDefined();
      });

      resumeSpy.mockRestore();
      submitAnswersSpy.mockRestore();
    });

    it('支持部分提交，当有未填写项时给出友好提示而不死锁', async () => {
      render(<App />);
      await setupRegisteredRequirement();

      const clarifyTab = await screen.findByRole('button', { name: /澄清问答/i });
      fireEvent.click(clarifyTab);

      const inputs = await screen.findAllByPlaceholderText(/输入 PM 决策口径或产品边界规则/i);
      if (inputs.length > 1) {
        // 仅填写第 1 个问题，保留后续问题为空
        fireEvent.change(inputs[0], { target: { value: '第一项决策口径' } });

        // 页面应提示支持部分提交
        expect(screen.getByText(/提示：当前仅填写了 1 项/i)).toBeDefined();
      }
    });
  });

  describe('3. 修改意见提交与重试防重复', () => {
    it('修改意见提交时写入 revision.md 并自增版本号，历史修订意见展示', async () => {
      render(<App />);
      await setupRegisteredRequirement();

      const prdTab = await screen.findByRole('button', { name: /PRD 评审与修改/i });
      fireEvent.click(prdTab);

      const commentInput = screen.getByPlaceholderText(/例如：补充在车队模式下后车接近时的调光时序图/i);
      fireEvent.change(commentInput, { target: { value: '补充低电量关机前的非易失存储时序' } });

      const submitRevBtn = screen.getByRole('button', { name: /提交意见并要求 Claude Code 修改/i });
      fireEvent.click(submitRevBtn);

      await waitFor(() => {
        expect(screen.getByText(/历史修订意见/i)).toBeDefined();
        expect(screen.getByText(/补充低电量关机前的非易失存储时序/i)).toBeDefined();
      });
    });

    it('当 submitRevision 成功但 resume 失败时，变为重试唤起按钮，重试时不重复生成修改意见', async () => {
      render(<App />);
      await setupRegisteredRequirement();

      const prdTab = await screen.findByRole('button', { name: /PRD 评审与修改/i });
      fireEvent.click(prdTab);

      // 设置终端启动失败场景
      bridge.setScenario('launch_failed');

      const commentInput = screen.getByPlaceholderText(/例如：补充在车队模式下后车接近时的调光时序图/i);
      fireEvent.change(commentInput, { target: { value: '测试失败重试不重复提交' } });

      const submitRevBtn = screen.getByRole('button', { name: /提交意见并要求 Claude Code 修改/i });
      fireEvent.click(submitRevBtn);

      // 验证提示：意见已保存，但唤起终端失败
      await waitFor(() => {
        expect(screen.getByText(/修改意见已保存，但唤起终端失败/i)).toBeDefined();
      });

      // 验证重试按钮文案为「重试唤起 Agent (修改意见已保存)」
      const retryBtn = screen.getByRole('button', { name: /重试唤起 Agent \(修改意见已保存\)/i });
      expect(retryBtn).toBeDefined();

      // 恢复正常场景并重试
      const submitRevisionSpy = vi.spyOn(bridge, 'submitRevision');
      const resumeSpy = vi.spyOn(bridge, 'resume');
      bridge.setScenario('normal');

      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(resumeSpy).toHaveBeenCalled();
        // 关键门禁：不重复调用 submitRevision！
        expect(submitRevisionSpy).not.toHaveBeenCalled();
      });

      submitRevisionSpy.mockRestore();
      resumeSpy.mockRestore();
    });
  });

  describe('4. 确认完成与快照保护', () => {
    it('终态确认弹窗展示文档路径、版本号和 SHA-256 校验摘要，并成功标记完成', async () => {
      render(<App />);
      await setupRegisteredRequirement();

      const prdTab = await screen.findByRole('button', { name: /PRD 评审与修改/i });
      fireEvent.click(prdTab);

      const completeBtn = await screen.findByRole('button', { name: /确认完成 \(终态验收\)/i });
      fireEvent.click(completeBtn);

      // 弹窗展示快照信息
      expect(await screen.findByText(/确认 PRD 终稿并标记完成/i)).toBeDefined();
      expect(screen.getByText(/锁定文档:/i)).toBeDefined();
      expect(screen.getByText(/锁定版本:/i)).toBeDefined();
      expect(screen.getByText(/校验摘要 \(SHA-256\):/i)).toBeDefined();

      const confirmBtn = screen.getByRole('button', { name: /确认完成验收/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(screen.getByText(/PM 已最终确认完成 \(终态\)/i)).toBeDefined();
        expect(screen.getByText(/需求已完成交付/i)).toBeDefined();
      });
    });

    it('当 PRD 发生外部变更冲突时 (PRD_CHANGED)，阻止完成并提示重新审阅', async () => {
      render(<App />);
      await setupRegisteredRequirement();

      const prdTab = await screen.findByRole('button', { name: /PRD 评审与修改/i });
      fireEvent.click(prdTab);

      // 触发冲突场景
      bridge.setScenario('prd_changed');

      const completeBtn = await screen.findByRole('button', { name: /确认完成 \(终态验收\)/i });
      fireEvent.click(completeBtn);

      const confirmBtn = screen.getByRole('button', { name: /确认完成验收/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith(
          expect.stringContaining('PRD 文件刚刚被外部修改，内容 Hash 与审阅时不一致')
        );
      });
    });
  });
});
