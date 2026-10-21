import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // This dependency's browser entry touches document at import time; its default entry is universal.
  resolve: { alias: { 'decode-named-character-reference': fileURLToPath(import.meta.resolve('decode-named-character-reference')) } },
  build: {
    outDir: 'dist-library',
    lib: {
      entry: {
        'reactive-md': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        'reactive-md-react': fileURLToPath(new URL('./src/react/library.ts', import.meta.url)),
      },
      formats: ['es'], fileName: (_format, name) => `${name}.js`, cssFileName: 'reactive-md',
    },
    rolldownOptions: { external: ['react', 'react-dom', 'react/jsx-runtime'] },
  },
});
