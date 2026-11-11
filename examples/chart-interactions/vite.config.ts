import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5201, strictPort: true },
  build: { outDir: '../../artifacts/chart-interactions-demo/dist', emptyOutDir: true },
});
