import { describe, expect, it } from 'vitest';
import { DocumentSession, readSavedDocument, type StorageAdapter } from '../src/session';
import counter from '../examples/counter.reactive.md?raw';

class MemoryStorage implements StorageAdapter {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
function ready(session: DocumentSession, source = counter) {
  const result = session.update(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

describe('document sessions', () => {
  it('preserves compatible user state during incremental append', () => {
    const session = new DocumentSession({ id: 'one' });
    ready(session).runtime.dispatch('increment');
    session.beginStream();
    for (let i = 0; i < counter.length; i += 7) session.append(counter.slice(i, i + 7));
    const result = session.append('\n\n新增正文。', true);
    expect(result.ok).toBe(true);
    expect(session.current()?.runtime.snapshot().state.count).toBe(1);
    expect(session.current()?.document.source).toContain('新增正文');
  });
  it('keeps only the last valid committed view while a component is incomplete', () => {
    const session = new DocumentSession({ id: 'two' });
    const before = ready(session);
    session.beginStream(counter + '\n');
    const result = session.append(':::card[等待闭合]\n正文');
    expect(result.ok).toBe(false);
    expect(result.pending).toBe(true);
    expect(session.current()?.runtime.snapshot().state.count).toBe(0);
    expect(session.current()?.document.source).toBe(before.document.source);
    const complete = session.append('\n:::\n', true);
    expect(complete.ok).toBe(true);
  });
  it('reports final stream errors with source locations', () => {
    const session = new DocumentSession({ id: 'bad' });
    session.beginStream();
    const result = session.append(counter + '\n::unknown[错误]\n', true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.pending).toBe(false);
      expect(result.diagnostics[0].line).toBeGreaterThan(0);
    }
  });
  it('keeps the previous state when a frontmatter prefix arrives before the config', () => {
    const session = new DocumentSession({ id: 'frontmatter' });
    ready(session).runtime.dispatch('increment');
    const text = '---\ntitle: 标题\n---\n\n' + counter;
    session.beginStream();
    for (let i = 0; i < text.length; i += 5) session.append(text.slice(i, i + 5));
    const result = session.append('', true);
    expect(result.ok).toBe(true);
    expect(session.current()?.runtime.snapshot().state.count).toBe(1);
  });
  it('restores stored state and source while isolating document IDs', () => {
    const storage = new MemoryStorage();
    const first = new DocumentSession({ id: 'saved', storage });
    ready(first).runtime.dispatch('increment');
    first.dispose();
    expect(readSavedDocument(storage, 'saved')?.source).toBe(counter);
    expect(ready(new DocumentSession({ id: 'saved', storage })).runtime.snapshot().state.count).toBe(1);
    expect(ready(new DocumentSession({ id: 'other', storage })).runtime.snapshot().state.count).toBe(0);
  });
  it('warns and resets invalid saved state instead of restoring it', () => {
    const storage = new MemoryStorage();
    const original = new DocumentSession({ id: 'corrupt', storage });
    ready(original);
    original.dispose();
    const key = [...storage.values.keys()][0];
    const record = JSON.parse(storage.getItem(key)!);
    record.state.count = 'wrong type';
    storage.setItem(key, JSON.stringify(record));
    const result = ready(new DocumentSession({ id: 'corrupt', storage }));
    expect(result.runtime.snapshot().state.count).toBe(0);
    expect(result.diagnostics.some(d => d.code === 'session.restore.invalid')).toBe(true);
  });
  it('does not let blocked storage break document interaction', () => {
    const storage: StorageAdapter = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    const session = new DocumentSession({ id: 'private', storage });
    const result = ready(session);
    expect(result.runtime.dispatch('increment').ok).toBe(true);
    expect(result.runtime.snapshot().state.count).toBe(1);
  });
  it('supports an explicit reset and destroys all subscriptions on disposal', () => {
    const session = new DocumentSession({ id: 'reset' });
    const old = ready(session).runtime;
    old.dispatch('increment');
    const result = session.update(counter, { preserveState: false });
    expect(result.ok).toBe(true);
    expect(session.current()?.runtime.snapshot().state.count).toBe(0);
    expect(() => old.dispatch('increment')).toThrow();
    session.dispose();
    expect(() => session.update(counter)).toThrow();
  });
  it('continues accepting raw Markdown without a reactive configuration', () => {
    const session = new DocumentSession({ id: 'plain' });
    const result = session.update('# 标题\n\n普通正文。');
    expect(result.ok).toBe(true);
  });
});
