import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const source = (path: string) => fileURLToPath(new URL(`../../src/${path}`, import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: [
    { find: /^reactive-md\/styles\.css$/, replacement: source('styles.css') },
    { find: /^reactive-md\/react$/, replacement: source('react/index.ts') },
    { find: /^reactive-md\/sdk$/, replacement: source('sdk/index.ts') },
    { find: /^reactive-md\/presets\/default$/, replacement: source('presets/default.ts') },
    { find: /^reactive-md$/, replacement: source('index.ts') },
  ] },
  server: { host: '127.0.0.1', port: 5203, strictPort: true },
  build: { outDir: '../../artifacts/diagram-gallery-2026-11-12/dist', emptyOutDir: true },
});
