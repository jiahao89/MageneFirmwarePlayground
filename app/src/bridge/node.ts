// ============================================================================
// Node 入口：桥接契约 + 安全原语 + 文件/内存存储 + Node 侧实现（含 fake CLI）。
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

export { WorkPackageBridge } from './work-package-bridge';
export type { WorkPackageBridgeDeps } from './work-package-bridge';
export { InMemoryWorkPackageStore, buildDiagnosticWorkPackage } from './work-package-store';
export type { WorkPackageStore, StoreLoadResult } from './work-package-store';
export { FileWorkPackageStore } from './file-work-package-store';
export { BrowserMockBridge } from './browser-mock';
export { LocalBridge } from './local-bridge';
export type { LocalBridgeOptions } from './local-bridge';
