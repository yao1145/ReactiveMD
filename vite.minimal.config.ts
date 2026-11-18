import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    outDir: 'dist-library',
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/styles/minimal-entry.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'reactive-md-minimal-styles',
      cssFileName: 'reactive-md-minimal',
    },
  },
});
