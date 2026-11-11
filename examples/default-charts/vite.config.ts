import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const source = (name: string) => fileURLToPath(new URL(`../../src/${name}`, import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: existsSync(source('index.ts')) ? [
    { find: /^reactive-md\/styles\.css$/, replacement: source('styles.css') },
    { find: /^reactive-md\/react$/, replacement: source('react/index.ts') },
    { find: /^reactive-md$/, replacement: source('index.ts') },
  ] : [] },
  server: { host: '127.0.0.1', port: 5202, strictPort: true },
  build: { outDir: '../../artifacts/chart-interactions-demo/rmd-dist', emptyOutDir: true },
});
