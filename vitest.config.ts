import { defineConfig } from 'vitest/config';
import { packVisualStyles } from './scripts/pack-visual-styles';

export default defineConfig({ plugins: [packVisualStyles()], test: { include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 30_000 } });
