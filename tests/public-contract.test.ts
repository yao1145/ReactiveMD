import { expect, it, vi } from 'vitest';
import { LOCAL_SYNTAX_VERSION } from '../src/local/version';

it('publishes the local-draft-1 syntax revision as a literal constant', () => {
  const revision: 'local-draft-1' = LOCAL_SYNTAX_VERSION;
  expect(revision).toBe('local-draft-1');
});

it('loads the core entry without touching React', async () => {
  vi.resetModules();
  vi.doMock('react', () => {
    throw new Error('the core entry must not load React');
  });
  try {
    const core = await import('../src/index');
    expect(core.LOCAL_SYNTAX_VERSION).toBe('local-draft-1');
    expect(typeof core.compileLocal).toBe('function');
    expect(typeof core.createLocalRuntime).toBe('function');
  } finally {
    vi.doUnmock('react');
    vi.resetModules();
  }
});
