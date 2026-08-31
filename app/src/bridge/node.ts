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
export { InMemoryWorkPackageStore, buildDiagnosticWorkPackage, WORK_DIR, workPackageFileName, startupFileName } from './work-package-store';
export type { WorkPackageStore, StoreLoadResult } from './work-package-store';
export { FileWorkPackageStore } from './file-work-package-store';
export { MockSessionDriver, AdapterSessionDriver } from './session-driver';
export type { SessionDriver, SessionStartOutcome, AdapterSessionDriverOptions } from './session-driver';
export { buildStartupInstruction, buildFallbackStartupInstruction } from './session-instruction';
export type {
  RuntimeAdapter,
  CliAvailability,
  AuthCheck,
  StartSessionSpec,
  StartSessionResult,
  StartSessionMode,
} from './runtime-adapter';
export {
  ClaudeCliAdapter,
  buildRecognitionPrompt,
  looksLikeAuthError,
  parseClaudeVersion,
  sanitizeProjectDir,
  resolveBinaryPath,
  claudeFallbackCandidates,
  parseEnvelopeToRecognition,
  stripCodeFence,
} from './claude-cli-adapter';
export type { ClaudeCliAdapterOptions } from './claude-cli-adapter';
export { FakeCliRuntimeAdapter } from './fake-cli-runtime-adapter';
export type { FakeCliAdapterOptions, FakeSessionRecord } from './fake-cli-runtime-adapter';
export {
  buildLaunchPlan,
  buildDarwinLaunchPlan,
  buildWindowsTerminalLaunchPlan,
  buildPowershellLaunchPlan,
  buildClaudeArgv,
  executeLaunchPlan,
  shQuote,
  psQuote,
  appleScriptQuote,
} from './terminal-launcher';
export type { LaunchPlan, TerminalPlatform, TerminalLauncherOptions } from './terminal-launcher';
export { BrowserMockBridge } from './browser-mock';
export { LocalBridge } from './local-bridge';
export type { LocalBridgeOptions } from './local-bridge';
