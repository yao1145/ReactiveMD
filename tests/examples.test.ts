import { describe, expect, it } from 'vitest';
import { compile } from '../src/core';

describe('language examples', () => {
  const examples = import.meta.glob<string>('../examples/*.reactive.md', { eager: true, query: '?raw', import: 'default' });
  for (const [name, source] of Object.entries(examples)) {
    it(`${name} compiles as a real document`, () => {
      const result = compile(source);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.ok).toBe(true);
    });
  }
});
