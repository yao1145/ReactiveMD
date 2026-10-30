import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Node build tooling stays outside every browser/core dependency graph. */
export default defineConfig({
  build: {
    ssr: true, target: 'node22', outDir: 'dist-library', emptyOutDir: false,
    lib: { entry: fileURLToPath(new URL('./src/build/index.ts', import.meta.url)), formats: ['es'], fileName: () => 'reactive-md-build.js' },
    rolldownOptions: { external: [/^node:/, 'vite', 'react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
      output: { entryFileNames: 'reactive-md-build.js', chunkFileNames: 'build-[name]-[hash].js' } },
  },
});
