// ============================================================================
// Node 入口：桥接契约 + 安全原语 + Node 侧实现（含 fake CLI 子进程）。
// 仅测试 / Node 运行时 import；勿在浏览器打包路径 import 此文件。
// ============================================================================

export * from './index';

export { PathGuard } from './path-guard';
export { RunGuard } from './concurrency';
export { runProcess } from './process-runner';
export type { RunProcessOptions, ProcessResult } from './process-runner';
export { readWorkPackageFile, writeWorkPackageFile, parseWorkPackage, validateWorkPackage } from './work-package';
export type { WorkPackageFileResult } from './work-package';
export { validateRecognition, parseRecognitionText } from './validate';
export { InMemoryBridge } from './in-memory-bridge';
export { BrowserMockBridge } from './browser-mock';
export { LocalBridge } from './local-bridge';
export type { LocalBridgeOptions } from './local-bridge';
