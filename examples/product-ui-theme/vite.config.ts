import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const repoRoot = here('../..');
const modules = realpathSync(here('../../node_modules'));

export default defineConfig({
  root: here('./demo'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'reactive-md/styles.css', replacement: here('../../src/styles.css') },
      { find: 'reactive-md/react', replacement: here('../../src/react/index.ts') },
      { find: 'reactive-md/sdk', replacement: here('../../src/sdk/index.ts') },
      { find: 'reactive-md', replacement: here('../../src/index.ts') },
    ],
  },
  server: {
    port: 4318,
    strictPort: true,
    // KaTeX fonts are requested from node_modules realpath. In a worktree the
    // node_modules junction can resolve outside the repository root.
    fs: { allow: [repoRoot, modules] },
  },
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
