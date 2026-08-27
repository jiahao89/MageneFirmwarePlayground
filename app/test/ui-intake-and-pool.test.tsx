import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/web/App';

describe('MFP UI Components (Issue #4 & Issue #5)', () => {
  beforeEach(() => {
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(() => Promise.resolve()),
      },
    });
  });

  it('renders header, navigation tabs and switches between pool and intake', async () => {
    render(<App />);

    expect(screen.getByText(/Magene Firmware Playground/i)).toBeDefined();
    expect(screen.getAllByText(/需求池/i).length).toBeGreaterThan(0);

    // Click 原始需求识别 tab
    const intakeTabs = screen.getAllByRole('button', { name: /原始需求识别/i });
    fireEvent.click(intakeTabs[0]);

    expect(await screen.findByText(/原始需求输入与智能识别/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/在此粘贴原始客户反馈/i)).toBeDefined();
  });

  it('Issue #4: fills demo, performs AI recognition, displays results and registers requirement', async () => {
    render(<App />);

    // Go to intake page
    const intakeTabs = screen.getAllByRole('button', { name: /原始需求识别/i });
    fireEvent.click(intakeTabs[0]);

    // Click demo fill
    const demoBtn = await screen.findByRole('button', { name: /C706 踏频低电量提示/i });
    fireEvent.click(demoBtn);

    const textarea = screen.getByPlaceholderText(/在此粘贴原始客户反馈/i) as HTMLTextAreaElement;
    expect(textarea.value).toContain('C706 连踏频传感器');

    // Click AI recognition
    const startBtn = screen.getByRole('button', { name: /保存原文并开始 AI 识别/i });
    fireEvent.click(startBtn);

    // Wait for recognition results
    await waitFor(
      () => {
        expect(screen.getByText(/改写功能需求/i)).toBeDefined();
        expect(screen.getByText(/确认登记为正式需求/i)).toBeDefined();
      },
      { timeout: 3000 }
    );

    // Click register
    const registerBtn = screen.getByRole('button', { name: /确认登记为正式需求/i });
    fireEvent.click(registerBtn);

    // Should transition to work package detail page
    await waitFor(
      () => {
        expect(screen.getByText(/Claude Code 启动前环境检查/i)).toBeDefined();
        expect(screen.getByText(/工作包概览 & Preflight 检查/i)).toBeDefined();
      },
      { timeout: 3000 }
    );
  });

  it('Issue #5: displays clarification questions and allows submitting answer', async () => {
    render(<App />);

    // Switch to intake and register a requirement
    const intakeTabs = screen.getAllByRole('button', { name: /原始需求识别/i });
    fireEvent.click(intakeTabs[0]);

    const demoBtn = await screen.findByRole('button', { name: /L508 雷达防眩目调光/i });
    fireEvent.click(demoBtn);

    const startBtn = screen.getByRole('button', { name: /保存原文并开始 AI 识别/i });
    fireEvent.click(startBtn);

    const registerBtn = await screen.findByRole('button', { name: /确认登记为正式需求/i });
    fireEvent.click(registerBtn);

    const clarifyTab = await screen.findByRole('button', { name: /澄清问答/i });
    fireEvent.click(clarifyTab);

    // Should display clarification questions
    expect(await screen.findByText(/待 PM 确认的问题/i)).toBeDefined();

    // Fill answer and submit
    const answerInputs = screen.getAllByPlaceholderText(/输入 PM 决策口径或产品边界规则/i);
    if (answerInputs.length > 0) {
      fireEvent.change(answerInputs[0], { target: { value: '允许 3 秒半透明浮层，不遮挡关键数据' } });
      const submitBtn = screen.getAllByRole('button', { name: /暂存回答/i })[0];
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/已澄清记录/i)).toBeDefined();
      });
    }
  });

  it('Issue #5: renders PRD Markdown, submits revision comments and triggers completion modal', async () => {
    render(<App />);

    // Register a requirement
    const intakeTabs = screen.getAllByRole('button', { name: /原始需求识别/i });
    fireEvent.click(intakeTabs[0]);

    const demoBtn = await screen.findByRole('button', { name: /C706 踏频低电量提示/i });
    fireEvent.click(demoBtn);

    const startBtn = screen.getByRole('button', { name: /保存原文并开始 AI 识别/i });
    fireEvent.click(startBtn);

    const registerBtn = await screen.findByRole('button', { name: /确认登记为正式需求/i });
    fireEvent.click(registerBtn);

    // Switch to PRD tab
    const prdTab = await screen.findByRole('button', { name: /PRD 评审与修改/i });
    fireEvent.click(prdTab);

    expect(await screen.findByText(/背景与目标/i)).toBeDefined();
    expect(screen.getByText(/协议与交互规范/i)).toBeDefined();

    // Submit revision comment
    const commentInput = screen.getByPlaceholderText(/例如：补充在车队模式下后车接近时的调光时序图/i);
    fireEvent.change(commentInput, { target: { value: '增加 FIT 记录字段定义' } });

    const submitRevBtn = screen.getByRole('button', { name: /提交意见并要求 Claude Code 修改/i });
    fireEvent.click(submitRevBtn);

    await waitFor(() => {
      expect(screen.getByText(/历史修订意见/i)).toBeDefined();
      expect(screen.getByText(/增加 FIT 记录字段定义/i)).toBeDefined();
    });

    // Click confirm completion
    const completeBtn = screen.getByRole('button', { name: /确认完成 \(终态验收\)/i });
    fireEvent.click(completeBtn);

    expect(await screen.findByText(/确认 PRD 终稿并标记完成/i)).toBeDefined();

    const confirmModalBtn = screen.getByRole('button', { name: /确认完成验收/i });
    fireEvent.click(confirmModalBtn);

    await waitFor(() => {
      expect(screen.getByText(/PM 已最终确认完成/i)).toBeDefined();
    });
  });
});
