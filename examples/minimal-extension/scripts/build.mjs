import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/**
 * Compile `src/extension.tsx` to `dist/node/entry.mjs`.
 *
 * The Node test and the export script import that file, so they always run the
 * same manifest and React implementations the preview imports. `reactive-md`
 * and React stay external; the consumer installs them.
 */
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const external = [/^reactive-md(?:\/|$)/, /^react(?:\/|$)/, /^react-dom(?:\/|$)/];

await mkdir(path.join(root, 'dist', 'node'), { recursive: true });
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: path.join(root, 'src', 'extension.tsx'),
    outDir: path.join(root, 'dist', 'node'),
    emptyOutDir: true,
    rollupOptions: {
      external,
      output: { entryFileNames: 'entry.mjs', format: 'esm' },
    },
  },
});

console.log('Built dist/node/entry.mjs');
