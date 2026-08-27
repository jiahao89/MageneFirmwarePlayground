// MFP 桌面壳入口：注册桥接命令（命令名与 src/bridge 契约对齐）。
// ⚠️ 脚手架：本机未装 Rust，尚未编译验证。

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::save_raw_input,
            commands::recognize,
            commands::register,
            commands::preflight,
            commands::launch,
            commands::resume,
            commands::read_work_package,
            commands::answer_question,
            commands::submit_revision,
            commands::complete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
