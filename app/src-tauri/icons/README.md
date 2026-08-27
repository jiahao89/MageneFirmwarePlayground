# 图标占位

`tauri dev` 可在无图标时运行（使用默认窗口图标）；`tauri build` 打包前需生成正式图标：

```bash
npm run tauri icon app/src-tauri/icons/icon.png
```

`bundle.icon` 尚未在 `tauri.conf.json` 声明，避免引用缺失文件导致脚手架无法启动。
