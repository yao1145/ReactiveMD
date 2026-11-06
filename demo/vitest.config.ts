import { defineConfig } from 'vitest/config';
import { reactiveMd } from 'reactive-md/vite';
import { exportAssets } from './vite.export-assets';

export default defineConfig({
  plugins: [reactiveMd({ extensions: './extensions.ts' }), exportAssets()],
  test: { include: ['tests/**/*.test.{ts,tsx}'], css: true },
});
