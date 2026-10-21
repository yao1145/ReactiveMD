import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['reactive-md', 'reactive-md/react'] },
  build: { rolldownOptions: { input: { main: 'index.html', embed: 'embed.html' } } },
});
