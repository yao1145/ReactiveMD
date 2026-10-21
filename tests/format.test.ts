import { describe, expect, it } from 'vitest';
import { compile, createRuntime } from '../src/core';
import { formatDocument } from '../src/session/format';

describe('author formatting', () => {
  const fixtures = import.meta.glob<string>('../examples/*.reactive.md', { eager: true, query: '?raw', import: 'default' });
  for (const [name, source] of Object.entries(fixtures)) {
    it('preserves the initial semantics of ' + name, () => {
      const before = compile(source);
      const output = formatDocument(source);
      const after = compile(output);
      expect(before.ok).toBe(true);
      expect(after.ok).toBe(true);
      if (before.ok && after.ok) {
        expect(createRuntime(after.document).snapshot().state).toEqual(createRuntime(before.document).snapshot().state);
        expect(createRuntime(after.document).snapshot().computed).toEqual(createRuntime(before.document).snapshot().computed);
      }
    });
  }
});
