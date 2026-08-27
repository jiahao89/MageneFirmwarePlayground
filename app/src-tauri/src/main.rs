// 阻止在 Windows 上显示控制台窗口（release 构建）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mfp_lib::run()
}
