//! Tauri 命令层：把前端 `invoke` 调用转发到 Node 桥接服务。
//!
//! 设计（Issue #6，避免两套互相矛盾的状态机）：
//! - 命令名与 `app/src/web/bridge-adapter.ts` 的 invoke 名一一对应；
//! - 参数形状与 TS 契约一致（如 `saveRawInput` 的 `{ req }`），零转换透传；
//! - 返回值是桥接服务的 JSON 原样透传（`serde_json::Value`），Rust 不镜像
//!   工作包类型、不重新解释字段——契约的唯一事实来源仍是 `src/bridge/types.ts`；
//! - 错误取桥接层可行动消息（`error.message`）作为 invoke 的 `Err(String)`。
//!
//! 安全：不保存 / 不记录凭据；所有子进程调用均为参数数组，用户文本不进入命令行。

use crate::bridge_client::{
    find_in_path, pick_first_existing, resolve_root, server_script_candidates, BridgeClient,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

// —— 输入类型（仅 invoke 入参需要序列化；输出一律 Value 透传）——

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRawInputRequest {
    pub text: String,
    pub source_description: Option<String>,
}

/// 全局状态：懒启动的桥接服务客户端（首次调用时拉起，崩溃后自动重建）。
/// resource_dir：打包后 bundle.resources 的落地目录（macOS=.app/Contents/Resources，
/// Windows=安装目录），用于定位 dist-bridge/bridge-server.cjs。
pub struct AppState {
    client: Mutex<Option<BridgeClient>>,
    resource_dir: Option<PathBuf>,
}

impl Default for AppState {
    fn default() -> Self {
        Self { client: Mutex::new(None), resource_dir: None }
    }
}

impl AppState {
    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        Self { client: Mutex::new(None), resource_dir }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let mut guard = self.client.lock().map_err(|_| "桥接客户端锁中毒".to_string())?;
        if guard.is_none() {
            *guard = Some(spawn_bridge_client(self.resource_dir.as_deref())?);
        }
        let client = guard.as_mut().expect("client 刚被初始化");
        match client.call(method, params) {
            Ok(v) => Ok(v),
            Err(e) => {
                if !client.alive() {
                    *guard = None; // 服务已退出：下次调用重新拉起
                }
                Err(e)
            }
        }
    }
}

fn spawn_bridge_client(resource_dir: Option<&Path>) -> Result<BridgeClient, String> {
    let node = resolve_node()?;
    let script = resolve_script(resource_dir)?;
    let cwd = std::env::current_dir().map_err(|e| format!("无法获取当前目录：{}", e))?;
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|h| PathBuf::from(h));
    let root = resolve_root(std::env::var("MFP_ROOT").ok().as_deref(), &cwd, home.as_deref())?;
    let adapter = std::env::var("MFP_ADAPTER").unwrap_or_else(|_| "claude".to_string());
    let terminal = std::env::var("MFP_TERMINAL_APP").ok();
    BridgeClient::spawn(&node, &script, &root, &adapter, terminal.as_deref())
}

fn resolve_node() -> Result<String, String> {
    if let Ok(p) = std::env::var("MFP_NODE") {
        if !p.trim().is_empty() && Path::new(&p).is_file() {
            return Ok(p);
        }
    }
    let names: &[&str] = if cfg!(windows) {
        &["node.exe", "node.cmd", "node"]
    } else {
        &["node"]
    };
    let path_env = std::env::var("PATH").unwrap_or_default();
    find_in_path(&path_env, names)
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| {
            "未找到 node 可执行文件：请安装 Node.js，或通过 MFP_NODE 环境变量指定路径".to_string()
        })
}

fn resolve_script(resource_dir: Option<&Path>) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("MFP_BRIDGE_SERVER") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Ok(pb);
        }
    }
    let cwd = std::env::current_dir().map_err(|e| format!("无法获取当前目录：{}", e))?;
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let candidates = server_script_candidates(&cwd, exe_dir.as_deref(), resource_dir);
    pick_first_existing(&candidates).ok_or_else(|| {
        format!(
            "未找到桥接服务脚本 dist-bridge/bridge-server.cjs：请先运行 `npm run build:bridge`，或通过 MFP_BRIDGE_SERVER 环境变量指定（候选：{}）",
            candidates
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join("；")
        )
    })
}

// —— 命令：与 MfpBridge 契约一一对应（参数形状与 invoke 一致）——

#[tauri::command]
pub fn save_raw_input(state: State<'_, AppState>, req: SaveRawInputRequest) -> Result<Value, String> {
    state.call("saveRawInput", json!({ "req": req }))
}

#[tauri::command]
pub fn recognize(state: State<'_, AppState>, request_id: String) -> Result<Value, String> {
    state.call("recognize", json!({ "requestId": request_id }))
}

#[tauri::command]
pub fn register(state: State<'_, AppState>, request_id: String) -> Result<Value, String> {
    state.call("register", json!({ "requestId": request_id }))
}

#[tauri::command]
pub fn list_work_packages(state: State<'_, AppState>) -> Result<Value, String> {
    state.call("listWorkPackages", json!({}))
}

#[tauri::command]
pub fn read_work_package(state: State<'_, AppState>, request_id: String) -> Result<Value, String> {
    state.call("readWorkPackage", json!({ "requestId": request_id }))
}

#[tauri::command]
pub fn preflight(state: State<'_, AppState>, request_id: String) -> Result<Value, String> {
    state.call("preflight", json!({ "requestId": request_id }))
}

#[tauri::command]
pub fn launch(state: State<'_, AppState>, request_id: String) -> Result<Value, String> {
    state.call("launch", json!({ "requestId": request_id }))
}

#[tauri::command]
pub fn resume(state: State<'_, AppState>, request_id: String) -> Result<Value, String> {
    state.call("resume", json!({ "requestId": request_id }))
}

#[tauri::command]
pub fn answer_question(
    state: State<'_, AppState>,
    request_id: String,
    question_id: String,
    answer: String,
) -> Result<Value, String> {
    state.call(
        "answerQuestion",
        json!({ "requestId": request_id, "questionId": question_id, "answer": answer }),
    )
}

#[tauri::command]
pub fn submit_revision(state: State<'_, AppState>, request_id: String, comment: String) -> Result<Value, String> {
    state.call(
        "submitRevision",
        json!({ "requestId": request_id, "comment": comment }),
    )
}

#[tauri::command]
pub fn complete(state: State<'_, AppState>, request_id: String) -> Result<Value, String> {
    state.call("complete", json!({ "requestId": request_id }))
}

#[tauri::command]
pub fn archive(state: State<'_, AppState>, request_id: String) -> Result<Value, String> {
    state.call("archive", json!({ "requestId": request_id }))
}
