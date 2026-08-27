import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 桌面壳前端（Vite）：端口与 tauri.conf.json 的 devUrl 对齐。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
