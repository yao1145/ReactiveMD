import { defineConfig } from 'vitest/config';
import { reactiveMd } from 'reactive-md/vite';

export default defineConfig({ plugins: [reactiveMd({ extensions: './extensions.ts' })], test: { include: ['tests/**/*.test.{ts,tsx}'], css: true } });
