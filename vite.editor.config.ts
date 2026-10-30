import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Keep editor CSS and its React graph separate from the document renderer. */
export default defineConfig({
  resolve: { alias: { 'decode-named-character-reference': fileURLToPath(import.meta.resolve('decode-named-character-reference')) } },
  worker: { format: 'es' },
  build: {
    outDir: 'dist-library',
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/editor/library.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'reactive-md-editor.js',
      cssFileName: 'reactive-md-editor',
    },
    rolldownOptions: { external: ['react', 'react-dom', 'react/jsx-runtime', 'reactive-md'] },
  },
});
