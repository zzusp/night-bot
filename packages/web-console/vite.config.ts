import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API 的源、身份与权限归可选插件。开发也用同源代理，不能把令牌放进前端环境变量。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 18999,
    strictPort: true,
    proxy: { '/api': {
      target: 'http://127.0.0.1:3080', changeOrigin: true,
      configure(proxy) {
        // 开发服务器也是 loopback；转发时保持生产插件的严格同源校验。
        proxy.on('proxyReq', (request) => request.setHeader('origin', 'http://127.0.0.1:3080'));
      },
    } },
  },
  build: { sourcemap: false },
});
