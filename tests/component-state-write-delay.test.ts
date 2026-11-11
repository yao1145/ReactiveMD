import { describe, expect, it, vi } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import type { LocalComponentStateDocument } from '../src/runtime-services';

function memoryStorage() {
  return {
    value: null as string | null,
    writes: 0,
    read(): string | null {
      return this.value;
    },
    write(document: LocalComponentStateDocument): void {
      this.writes += 1;
      this.value = JSON.stringify(document);
    },
    remove(): void {
      this.value = null;
    },
  };
}

describe('runtime component-state write delay', () => {
  it('flushes a coalesced save when the runtime is disposed', () => {
    vi.useFakeTimers();
    try {
      const compiled = compileLocal('<counter label="N">');
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      const storage = memoryStorage();
      const runtime = createLocalRuntime(compiled.document, {
        componentStateStorage: storage,
        componentStateWriteDelayMs: 200,
      });
      const state = runtime.services?.state;
      if (!state) throw new Error('Expected runtime services');
      const handle = state.handle({
        nodeId: 'local-1',
        component: 'example/game',
        componentVersion: '1.0.0',
      });
      handle.save({ score: 1 });
      expect(storage.writes).toBe(0);

      runtime.dispose();
      expect(storage.writes).toBe(1);
      expect(JSON.parse(storage.value ?? '{}').records[handle.key].data).toEqual({ score: 1 });
      vi.advanceTimersByTime(200);
      expect(storage.writes).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
