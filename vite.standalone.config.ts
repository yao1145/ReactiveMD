import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // This dependency's browser entry touches document at import time; its default entry is universal.
  resolve: { alias: { 'decode-named-character-reference': fileURLToPath(import.meta.resolve('decode-named-character-reference')) } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    cssCodeSplit: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/standalone/index.tsx', import.meta.url)),
      name: 'ReactiveMD',
      formats: ['iife'],
      fileName: () => 'reactive-md-standalone.js',
      cssFileName: 'reactive-md-standalone',
    },
  },
});
