//! 桥接服务客户端：Tauri 命令层到 Node 桥接服务的薄转发（行分隔 JSON-RPC）。
//!
//! 架构不变量（Issue #6，避免两套状态机）：
//! - 契约、需求状态机、工作包持久化、CLI 适配、终端启动全部在 TypeScript 层
//!   （`app/src/bridge/`），是唯一实现；
//! - 本层只做：定位 `node` 与 `bridge-server.cjs`、以参数数组拉起子进程
//!   （工作目录固定为 MFP 根目录）、按 id 关联请求/响应、透传结果与错误消息；
//! - 不重新解释工作包字段、不实现状态迁移。
//!
//! 安全：不保存 / 不记录任何凭据；服务诊断走 stderr，协议只走 stdout。

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub struct BridgeClient {
    child: Child,
    stdin: std::process::ChildStdin,
    reader: BufReader<std::process::ChildStdout>,
    next_id: u64,
}

impl BridgeClient {
    /// 以参数数组拉起桥接服务；工作目录固定为 MFP 根目录。
    pub fn spawn(
        node_bin: &str,
        server_script: &Path,
        root: &str,
        adapter: &str,
        terminal_app: Option<&str>,
    ) -> Result<Self, String> {
        let args = build_server_args(server_script, root, adapter, terminal_app);
        let mut child = Command::new(node_bin)
            .args(&args)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit()) // 诊断信息到 stderr；协议只走 stdout
            .spawn()
            .map_err(|e| {
                format!(
                    "无法启动桥接服务：{}（node={}，脚本={}）",
                    e,
                    node_bin,
                    server_script.display()
                )
            })?;
        let stdin = child.stdin.take().ok_or("无法获取桥接服务 stdin")?;
        let stdout = child.stdout.take().ok_or("无法获取桥接服务 stdout")?;
        Ok(Self {
            child,
            stdin,
            reader: BufReader::new(stdout),
            next_id: 1,
        })
    }

    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        rpc_roundtrip(&mut self.stdin, &mut self.reader, id, method, params)
    }

    /// 子进程是否仍在运行。
    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

impl Drop for BridgeClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// 单次 RPC 往返：写一行请求，读到同 id 的响应为止（容忍噪声行）。
pub fn rpc_roundtrip<W: Write, R: BufRead>(
    writer: &mut W,
    reader: &mut R,
    id: u64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let request = json!({ "id": id, "method": method, "params": params });
    writeln!(writer, "{}", request).map_err(|e| format!("桥接服务写入失败：{}", e))?;
    writer
        .flush()
        .map_err(|e| format!("桥接服务刷新失败：{}", e))?;

    let mut line = String::new();
    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("桥接服务读取失败：{}", e))?;
        if n == 0 {
            return Err("桥接服务已退出（EOF），请重试或重启应用".to_string());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if parsed.get("id").and_then(|v| v.as_u64()) != Some(id) {
            continue;
        }
        if parsed.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
        }
        let err = parsed.get("error").cloned().unwrap_or_else(|| json!({}));
        let message = err
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("未知桥接错误")
            .to_string();
        return Err(message);
    }
}

/// 桥接服务启动参数（数组传递；只含受控值，用户文本永不进入命令行）。
pub fn build_server_args(
    server_script: &Path,
    root: &str,
    adapter: &str,
    terminal_app: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        server_script.to_string_lossy().to_string(),
        "--root".to_string(),
        root.to_string(),
        "--adapter".to_string(),
        adapter.to_string(),
    ];
    if let Some(t) = terminal_app {
        args.push("--terminal-app".to_string());
        args.push(t.to_string());
    }
    args
}

// —— 解析辅助（纯函数，可单测）——

/// 在 PATH 内容中按名称查找文件（分隔符参数化以便跨平台单测）。
pub fn find_in_path(path_env: &str, names: &[&str]) -> Option<PathBuf> {
    find_in_path_with_sep(path_env, names, if cfg!(windows) { ';' } else { ':' })
}

/// 显式分隔符版本：macOS 上也能测试 Windows 的 `;` 分隔行为。
pub fn find_in_path_with_sep(path_env: &str, names: &[&str], sep: char) -> Option<PathBuf> {
    for dir in path_env.split(sep) {
        if dir.is_empty() {
            continue;
        }
        for name in names {
            let full = Path::new(dir).join(name);
            if full.is_file() {
                return Some(full);
            }
        }
    }
    None
}

/// 取第一个存在的候选路径。
pub fn pick_first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// 桥接服务脚本候选路径（dev 从 app/、仓库根或 src-tauri 运行；打包后命中 resource_dir）。
/// Issue #6 验收 F-1 修复：`tauri dev` 下二进制 cwd = app/src-tauri，需覆盖 `../dist-bridge`。
/// 跨平台发布：bundle.resources 把 dist-bridge/* 打进安装包（macOS 为
/// .app/Contents/Resources/，Windows 为安装目录），resource_dir 候选覆盖两种布局。
pub fn server_script_candidates(cwd: &Path, exe_dir: Option<&Path>, resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut v = vec![
        cwd.join("dist-bridge").join("bridge-server.cjs"),
        cwd.join("app").join("dist-bridge").join("bridge-server.cjs"),
        cwd.join("..").join("dist-bridge").join("bridge-server.cjs"),
    ];
    if let Some(d) = exe_dir {
        v.push(d.join("dist-bridge").join("bridge-server.cjs"));
    }
    if let Some(d) = resource_dir {
        v.push(d.join("dist-bridge").join("bridge-server.cjs"));
    }
    v
}

/// MFP 根目录：优先显式值（env MFP_ROOT），否则当前工作目录；目录必须存在。
pub fn resolve_root(env_root: Option<&str>, cwd: &Path) -> Result<String, String> {
    let root = match env_root {
        Some(r) if !r.trim().is_empty() => PathBuf::from(r),
        _ => cwd.to_path_buf(),
    };
    if !root.is_dir() {
        return Err(format!("MFP 根目录不存在：{}", root.display()));
    }
    root.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "MFP 根目录路径不是合法 UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn rpc_roundtrip_success_and_id_filtering() {
        let mut writer: Vec<u8> = Vec::new();
        // 先一行噪声（不同 id），再目标响应
        let responses = "{\"id\":99,\"ok\":true,\"result\":{\"noise\":true}}\n\
                         {\"id\":7,\"ok\":true,\"result\":{\"requestId\":\"REQ-1\"}}\n";
        let mut reader = Cursor::new(responses.as_bytes());
        let result = rpc_roundtrip(&mut writer, &mut reader, 7, "readWorkPackage", json!({"requestId":"REQ-1"}));
        assert_eq!(result.unwrap()["requestId"], "REQ-1");
        let sent = String::from_utf8(writer).unwrap();
        assert!(sent.contains("\"method\":\"readWorkPackage\""));
        assert!(sent.contains("\"id\":7"));
    }

    #[test]
    fn rpc_roundtrip_error_maps_message() {
        let mut writer: Vec<u8> = Vec::new();
        let responses = "{\"id\":3,\"ok\":false,\"error\":{\"code\":\"INVALID_TRANSITION\",\"category\":\"state\",\"message\":\"非法状态迁移：x → y\"}}\n";
        let mut reader = Cursor::new(responses.as_bytes());
        let err = rpc_roundtrip(&mut writer, &mut reader, 3, "complete", json!({})).unwrap_err();
        assert!(err.contains("非法状态迁移"));
    }

    #[test]
    fn rpc_roundtrip_eof_reports_service_exit() {
        let mut writer: Vec<u8> = Vec::new();
        let mut reader = Cursor::new(b"" as &[u8]);
        let err = rpc_roundtrip(&mut writer, &mut reader, 1, "ping", json!({})).unwrap_err();
        assert!(err.contains("EOF"));
    }

    #[test]
    fn build_server_args_keeps_root_as_single_arg() {
        let args = build_server_args(
            Path::new("/app/dist-bridge/bridge-server.cjs"),
            "/Users/x/MFP 项目 'root'",
            "claude",
            Some("Terminal"),
        );
        assert_eq!(
            args,
            vec![
                "/app/dist-bridge/bridge-server.cjs",
                "--root",
                "/Users/x/MFP 项目 'root'",
                "--adapter",
                "claude",
                "--terminal-app",
                "Terminal",
            ]
        );
    }

    #[test]
    fn find_in_path_locates_binary() {
        let dir = std::env::temp_dir().join(format!("mfp-rust-path-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("node");
        std::fs::write(&bin, "#!/bin/sh\n").unwrap();
        let path_env = format!("/nonexistent:{}:/also-not", dir.display());
        let found = find_in_path(&path_env, &["node"]);
        assert_eq!(found.unwrap(), bin);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn pick_first_existing_skips_missing() {
        let dir = std::env::temp_dir().join(format!("mfp-rust-pick-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let existing = dir.join("bridge-server.cjs");
        std::fs::write(&existing, "x").unwrap();
        let candidates = vec![dir.join("missing.cjs"), existing.clone()];
        assert_eq!(pick_first_existing(&candidates).unwrap(), existing);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn server_script_candidates_cover_dev_layouts() {
        let cwd = Path::new("/repo");
        let candidates = server_script_candidates(cwd, Some(Path::new("/repo/app/target/release")), None);
        assert!(candidates.contains(&PathBuf::from("/repo/dist-bridge/bridge-server.cjs")));
        assert!(candidates.contains(&PathBuf::from("/repo/app/dist-bridge/bridge-server.cjs")));
        assert!(candidates.contains(&PathBuf::from(
            "/repo/app/target/release/dist-bridge/bridge-server.cjs"
        )));
        // F-1：tauri dev 的 cwd 是 app/src-tauri，必须能解析到 app/dist-bridge
        let src_tauri = Path::new("/repo/app/src-tauri");
        let from_src_tauri = server_script_candidates(src_tauri, None, None);
        assert!(from_src_tauri.contains(&PathBuf::from("/repo/app/src-tauri/../dist-bridge/bridge-server.cjs")));
    }

    #[test]
    fn server_script_candidates_cover_packaged_layouts() {
        // macOS 打包：.app/Contents/Resources/dist-bridge/…
        let mac_resources = Path::new("/Applications/MFP.app/Contents/Resources");
        let mac = server_script_candidates(Path::new("/"), None, Some(mac_resources));
        assert!(mac.contains(&mac_resources.join("dist-bridge").join("bridge-server.cjs")));
        // Windows 安装目录布局（反斜杠路径）
        let win_install = Path::new(r"C:\Program Files\MFP");
        let win = server_script_candidates(Path::new(r"C:\\"), None, Some(win_install));
        assert!(win.contains(&win_install.join("dist-bridge").join("bridge-server.cjs")));
    }

    #[test]
    fn find_in_path_windows_separator() {
        // 在 macOS 上验证 Windows 的 `;` 分隔 PATH 解析（跨平台发布）
        let dir = std::env::temp_dir().join(format!("mfp-rust-winpath-{}", std::process::id()));
        let sub = dir.join("bin");
        std::fs::create_dir_all(&sub).unwrap();
        let bin = sub.join("node.exe");
        std::fs::write(&bin, "x").unwrap();
        let path_env = format!(r"C:\Windows\System32;{}", sub.display());
        let found = find_in_path_with_sep(&path_env, &["node.exe", "node.cmd", "node"], ';');
        assert_eq!(found.unwrap(), bin);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resolve_root_prefers_env_and_requires_dir() {
        let dir = std::env::temp_dir().join(format!("mfp-rust-root-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let got = resolve_root(Some(dir.to_str().unwrap()), Path::new("/nowhere")).unwrap();
        assert_eq!(got, dir.to_str().unwrap());
        assert!(resolve_root(Some("/definitely/not/here"), Path::new("/nowhere")).is_err());
        assert!(resolve_root(None, &dir).is_ok());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
