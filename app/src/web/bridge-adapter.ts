import { invoke } from '@tauri-apps/api/core';
import { BrowserMockBridge } from '../bridge/browser-mock';
import type {
  MfpBridge,
  WorkPackage,
  RecognitionResult,
  SaveRawInputRequest,
  LaunchResult,
  PreflightResult,
} from '../bridge/index';

// ============================================================================
// 前端桥接适配器：
//  - 运行在 Tauri 桌面壳内（window.__TAURI_INTERNALS__ 存在）→ 走 invoke（命令名
//    与 src-tauri/src/commands.rs 对齐）
//  - 纯浏览器 / dev（无 Tauri）→ 走确定性 mock（BrowserMockBridge，内存存储）
// Issue #2 交付文件读写服务；真实 invoke 命令与 Rust 层在壳编译后联调（Issue #6）。
// ============================================================================

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

/** Tauri 壳内：把 MfpBridge 操作映射到 Rust 命令。 */
class TauriBridge implements MfpBridge {
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
  submitRevision(requestId: string, comment: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('submit_revision', { requestId, comment });
  }
  complete(requestId: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('complete', { requestId });
  }
  archive(requestId: string): Promise<WorkPackage> {
    return invoke<WorkPackage>('archive', { requestId });
  }
}

let cached: MfpBridge | null = null;

export function getBridge(): MfpBridge {
  if (!cached) cached = isTauri() ? new TauriBridge() : new BrowserMockBridge();
  return cached;
}
