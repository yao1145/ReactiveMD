import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [{
    name: 'optional-print-css',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'reactive-md-print.css', source: readFileSync(new URL('./src/print.css', import.meta.url), 'utf8') });
    },
  }],
  // This dependency's browser entry touches document at import time; its default entry is universal.
  resolve: { alias: { 'decode-named-character-reference': fileURLToPath(import.meta.resolve('decode-named-character-reference')) } },
  build: {
    outDir: 'dist-library',
    lib: {
      entry: {
        'reactive-md': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        'reactive-md-react': fileURLToPath(new URL('./src/react/library.ts', import.meta.url)),
        'reactive-md-react-unstyled': fileURLToPath(new URL('./src/react/index.ts', import.meta.url)),
        'reactive-md-authoring': fileURLToPath(new URL('./src/authoring/index.ts', import.meta.url)),
      },
      formats: ['es'], fileName: (_format, name) => `${name}.js`, cssFileName: 'reactive-md',
    },
    rolldownOptions: { external: ['react', 'react-dom', 'react/jsx-runtime'] },
  },
});
