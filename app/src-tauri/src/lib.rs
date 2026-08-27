// MFP 桌面壳入口：注册桥接命令（命令名与 src/bridge 契约及前端适配器对齐）。
//
// 架构：Rust 命令层是薄代理，实际契约 / 状态机 / 持久化 / CLI 适配在
// TypeScript 桥接层（经 Node 桥接服务子进程），避免两套互相矛盾的状态机。

pub mod bridge_client;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::save_raw_input,
            commands::recognize,
            commands::register,
            commands::list_work_packages,
            commands::read_work_package,
            commands::preflight,
            commands::launch,
            commands::resume,
            commands::answer_question,
            commands::submit_revision,
            commands::complete,
            commands::archive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
