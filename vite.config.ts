import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  assetsInclude: ['**/*.glb'],
  build: {
    // Ensure compatibility with macOS 10.15 Catalina WKWebView (Safari 13-15) and Win7 WebView2 109
    target: ['safari13', 'chrome90'],
    // Keep binary audio/webp/json assets as clean files instead of +33% Base64 data URIs in JS chunks
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        menu: path.resolve(__dirname, 'menu.html'),
        obs: path.resolve(__dirname, 'obs.html'),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
