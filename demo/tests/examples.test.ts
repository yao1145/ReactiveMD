import { describe, expect, it } from 'vitest';
import { compile } from 'reactive-md';
import { EXAMPLES } from '../src/examples';

describe('demo documents consumed through the public package', () => {
  for (const example of EXAMPLES) {
    it(`${example.id}: ${example.id === 'diagnostics' ? 'reports intentional errors' : 'compiles'}`, () => {
      const result = compile(example.source);
      if (example.id !== 'diagnostics' && !result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.ok).toBe(example.id !== 'diagnostics');
    });
  }
});
