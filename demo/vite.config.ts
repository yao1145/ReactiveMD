import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { reactiveMd } from 'reactive-md/vite';

export default defineConfig({
  plugins: [react(), reactiveMd({ extensions: './extensions.ts' })],
  build: { rolldownOptions: { input: { main: 'index.html', embed: 'embed.html' } } },
});
