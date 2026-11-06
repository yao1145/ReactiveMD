import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { reactiveMd } from 'reactive-md/vite';
import { exportAssets } from './vite.export-assets';

export default defineConfig({
  plugins: [react(), reactiveMd({ extensions: './extensions.ts' }), exportAssets()],
  build: { rolldownOptions: { input: { main: 'index.html', embed: 'embed.html' } } },
});
