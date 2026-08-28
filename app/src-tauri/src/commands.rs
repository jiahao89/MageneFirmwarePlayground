//! Rust 命令层：镜像 `src/bridge` 的 MfpBridge 契约。
//!
//! ⚠️ 本文件为脚手架，本机未装 Rust、尚未编译验证。各命令体为占位（返回错误），
//! 待以下 Issue 填充实现：
//! - Issue #2：工作包状态机与文件持久化（register / read_work_package / complete / archive / list）
//! - Issue #3：真实 Claude Code CLI 适配与终端启动（recognize / launch / resume）
//! - Issue #6：桥接联调与跨平台打包（接入真实命令 + macOS/Windows 验收）

use serde::{Deserialize, Serialize};

// —— 类型定义（与 src/bridge/types.ts 对齐，字段名 camelCase 经 serde 转换）——

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawInput {
    pub raw_input_id: String,
    pub text: String,
    pub source_description: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceReference {
    pub kind: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionResult {
    pub category: String,
    pub rewritten_requirement: String,
    pub user: String,
    pub scenario: String,
    pub goal: String,
    pub scope_clues: Vec<String>,
    pub known_constraints: Vec<String>,
    pub missing_information: Vec<String>,
    pub evidence: Vec<EvidenceReference>,
    pub duplicate_candidates: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCard {
    pub current_phase: String,
    pub goal: String,
    pub confirmed_scope: Vec<String>,
    pub unresolved_questions: Vec<String>,
    pub allowed_context: Vec<String>,
    pub expected_outputs: Vec<String>,
    pub write_back_rules: Vec<String>,
    pub pause_conditions: Vec<String>,
    pub prohibited_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkPackage {
    pub request_id: String,
    pub raw_input_id: String,
    pub status: String,
    pub original_input: RawInput,
    pub recognition: Option<RecognitionResult>,
    pub task_card: Option<TaskCard>,
    pub questions: Vec<serde_json::Value>,
    pub revision_comments: Vec<serde_json::Value>,
    pub prd_path: Option<String>,
    pub prd_version: Option<u32>,
    pub run_log: Vec<serde_json::Value>,
    pub session: serde_json::Value,
    pub artifacts: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRawInputRequest {
    pub text: String,
    pub source_description: Option<String>,
}

// —— 命令（占位：契约形状，待 Issue #2/#3/#6 填充实现）——

#[tauri::command]
pub async fn save_raw_input(_req: SaveRawInputRequest) -> Result<WorkPackage, String> {
    Err("save_raw_input: 脚手架占位（Issue #2 工作包持久化实现）".into())
}

#[tauri::command]
pub async fn recognize(_request_id: String) -> Result<RecognitionResult, String> {
    Err("recognize: 脚手架占位（Issue #3 CLI 适配实现）".into())
}

#[tauri::command]
pub async fn register(_request_id: String) -> Result<WorkPackage, String> {
    Err("register: 脚手架占位（Issue #2 工作包状态机实现）".into())
}

#[tauri::command]
pub async fn list_work_packages() -> Result<Vec<WorkPackage>, String> {
    Err("list_work_packages: 脚手架占位（Issue #2）".into())
}

#[tauri::command]
pub async fn read_work_package(_request_id: String) -> Result<WorkPackage, String> {
    Err("read_work_package: 脚手架占位（Issue #2）".into())
}

#[tauri::command]
pub async fn preflight(_request_id: String) -> Result<serde_json::Value, String> {
    Err("preflight: 脚手架占位".into())
}

#[tauri::command]
pub async fn launch(_request_id: String) -> Result<serde_json::Value, String> {
    Err("launch: 脚手架占位（Issue #3 终端启动实现）".into())
}

#[tauri::command]
pub async fn resume(_request_id: String) -> Result<serde_json::Value, String> {
    Err("resume: 脚手架占位（Issue #3 会话恢复实现）".into())
}

#[tauri::command]
pub async fn answer_question(
    _request_id: String,
    _question_id: String,
    _answer: String,
) -> Result<serde_json::Value, String> {
    Err("answer_question: 脚手架占位".into())
}

#[tauri::command]
pub async fn submit_revision(_request_id: String, _comment: String) -> Result<serde_json::Value, String> {
    Err("submit_revision: 脚手架占位".into())
}

#[tauri::command]
pub async fn complete(_request_id: String) -> Result<serde_json::Value, String> {
    Err("complete: 脚手架占位".into())
}

#[tauri::command]
pub async fn archive(_request_id: String) -> Result<serde_json::Value, String> {
    Err("archive: 脚手架占位".into())
}
