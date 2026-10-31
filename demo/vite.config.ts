import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { demoExtensionBundle } from './extension-build.ts';
import packageJson from '../package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), demoExtensionBundle()],
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: {
    exclude: Object.entries(packageJson.exports)
      .filter(([, entry]) => typeof entry === 'object' && 'import' in entry)
      .map(([name]) => name === '.' ? 'reactive-md' : `reactive-md/${name.slice(2)}`),
  },
  build: { rolldownOptions: { input: { main: 'index.html', embed: 'embed.html' } } },
});
