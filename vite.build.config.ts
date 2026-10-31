import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Node build tooling stays outside every browser/core dependency graph. */
export default defineConfig({
  build: {
    ssr: true, target: 'node22', outDir: 'dist-library', emptyOutDir: false,
    lib: { entry: {
      'reactive-md-build': fileURLToPath(new URL('./src/build/index.ts', import.meta.url)),
      'reactive-md-vite': fileURLToPath(new URL('./src/vite/index.ts', import.meta.url)),
    }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    rolldownOptions: { external: [/^node:/, 'vite', 'react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
      output: { entryFileNames: '[name].js', chunkFileNames: 'build-[name]-[hash].js' } },
  },
});
