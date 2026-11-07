import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

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
  server: { port: 4317, strictPort: true },
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
