//! Rust ↔ Node 桥接服务 集成测试（macOS 最小可执行验证）。
//!
//! 验证 Rust 客户端真实拉起 `dist-bridge/bridge-server.cjs` 子进程并完成
//! JSON-RPC 往返：ping / saveRawInput / recognize / 错误传播。
//! 若桥接服务包未构建（`npm run build:bridge`），跳过（打印提示并通过），
//! 保证 `cargo test` 在裸 checkout 下也不失败。

use mfp_lib::bridge_client::{find_in_path, BridgeClient};
use serde_json::json;
use std::path::Path;

#[test]
fn bridge_client_spawns_server_and_roundtrips() {
    let manifest = env!("CARGO_MANIFEST_DIR"); // …/app/src-tauri
    let server = Path::new(manifest).join("../dist-bridge/bridge-server.cjs");
    if !server.is_file() {
        eprintln!("skip: 未找到 {}（先运行 npm run build:bridge）", server.display());
        return;
    }
    let path_env = std::env::var("PATH").unwrap_or_default();
    let node = match find_in_path(&path_env, &["node"]) {
        Some(p) => p,
        None => {
            eprintln!("skip: 未找到 node");
            return;
        }
    };

    let root = std::env::temp_dir().join(format!("mfp-rust-it-{}", std::process::id()));
    std::fs::create_dir_all(root.join("knowledge-base/01_事实源")).unwrap();
    std::fs::write(root.join("AGENTS.md"), "# AGENTS").unwrap();
    std::fs::write(root.join("knowledge-base/01_事实源/BENCHMARK.md"), "# B").unwrap();

    let mut client =
        BridgeClient::spawn(node.to_str().unwrap(), &server, root.to_str().unwrap(), "fake", None)
            .expect("桥接服务应能启动");

    // ping
    let pong = client.call("ping", json!({})).expect("ping 应成功");
    assert_eq!(pong["ok"], true);

    // saveRawInput → WorkPackage
    let saved = client
        .call("saveRawInput", json!({"req": {"text": "Rust 集成测试：码表闪退"}}))
        .expect("saveRawInput 应成功");
    let request_id = saved["requestId"].as_str().unwrap().to_string();
    assert!(request_id.starts_with("REQ-"));
    assert_eq!(saved["status"], "pending_recognition");

    // recognize → bug（fake CLI 关键词命中）
    let rec = client
        .call("recognize", json!({"requestId": request_id}))
        .expect("recognize 应成功");
    assert_eq!(rec["category"], "bug");

    // register → pending_launch + 任务卡
    let reg = client
        .call("register", json!({"requestId": request_id}))
        .expect("register 应成功");
    assert_eq!(reg["status"], "pending_launch");
    assert_eq!(reg["taskCard"]["currentPhase"], "understand_and_clarify");

    // 错误传播：从 pending_launch 直接 complete → INVALID_TRANSITION
    let err = client
        .call("complete", json!({"requestId": request_id}))
        .expect_err("complete 应被状态机拒绝");
    assert!(err.contains("非法状态迁移"), "错误消息应为可行动文案：{}", err);

    std::fs::remove_dir_all(&root).unwrap();
}
