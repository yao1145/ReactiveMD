import { expect, it, vi } from 'vitest';
import { LOCAL_SYNTAX_VERSION } from '../src/local/version';

it('publishes the local-draft-2 syntax revision as a literal constant', () => {
  const revision: 'local-draft-2' = LOCAL_SYNTAX_VERSION;
  expect(revision).toBe('local-draft-2');
});

it('loads the core entry without touching React', async () => {
  vi.resetModules();
  vi.doMock('react', () => {
    throw new Error('the core entry must not load React');
  });
  try {
    const core = await import('../src/index');
    expect(core.LOCAL_SYNTAX_VERSION).toBe('local-draft-2');
    expect(core.LOCAL_STATE_FORMAT).toBe('reactive-md-state/v1');
    expect(core.SHAREABLE_HTML_FORMAT).toBe('reactive-md-html/v1');
    expect(typeof core.compileLocal).toBe('function');
    expect(typeof core.createLocalCompileSession).toBe('function');
    expect(typeof core.createLocalRuntime).toBe('function');
    expect(typeof core.createLocalStateFile).toBe('function');
    expect(typeof core.exportLocalState).toBe('function');
    expect(typeof core.importLocalState).toBe('function');
    expect(typeof core.planLocalStateRetention).toBe('function');
    expect(typeof core.applyLocalStateRetention).toBe('function');
    expect(typeof core.LocalCompileScheduler).toBe('function');
    expect(typeof core.startLocalCompileWorker).toBe('function');
    expect(typeof core.createShareableHtml).toBe('function');
  } finally {
    vi.doUnmock('react');
    vi.resetModules();
  }
});
