import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const source = (name: string) => fileURLToPath(new URL(`../../src/${name}`, import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: existsSync(source('index.ts')) ? [
    { find: /^reactive-md\/styles\.css$/, replacement: source('styles.css') },
    { find: /^reactive-md\/react$/, replacement: source('react/index.ts') },
    { find: /^reactive-md$/, replacement: source('index.ts') },
  ] : [] },
  server: { host: '127.0.0.1', port: 5200, strictPort: true },
  build: { outDir: '../../artifacts/uiarc-integration-2026-11-11/example-dist', emptyOutDir: true },
});
