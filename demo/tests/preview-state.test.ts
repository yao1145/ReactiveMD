import { describe, expect, it } from 'vitest';
import { compileLocal, type LocalDocument, type LocalNode } from 'reactive-md';
import { PreviewStateSession } from '../src/preview-state';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

function nodes(document: LocalDocument): LocalNode[] {
  const flatten = (items: LocalNode[]): LocalNode[] => items.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  return flatten(document.nodes);
}

function control(document: LocalDocument, bind: string) {
  const node = nodes(document).find((node) => node.attrs?.bind === bind);
  if (!node) throw new Error(`Missing binding ${bind}`);
  return node;
}

const number = '<number label="Amount" bind="amount" initial="2" min="0" max="20">';

describe('Playground preview state session', () => {
  it('retains the latest trial values across prose and formula edits and repeated compiles', () => {
    const session = new PreviewStateSession();
    const first = compile(`${number}\n\nTotal: {{ amount * 2 }}`);
    const active = session.open(first);
    active.runtime.set(control(first, 'amount'), 8);
    active.runtime.set(control(first, 'amount'), 11);
    active.release();

    const next = compile(`# Revised prose\n\n${number}\n\nResult: {{ amount * 3 }}`);
    const updated = session.open(next);
    expect(updated.runtime.evaluate('amount * 3')).toBe(33);
    updated.runtime.set(control(next, 'amount'), 7);
    updated.release();
    const repeated = session.open(compile(`${number}\n\nAnother edit`));
    expect(repeated.runtime.snapshot().state.amount).toBe(7);
    repeated.release();
  });

  it('keeps the last valid session through a temporary compile error and unmount', () => {
    const session = new PreviewStateSession();
    const first = compile(number);
    const active = session.open(first);
    active.runtime.set(control(first, 'amount'), 9);
    active.release();
    expect(compileLocal('<number label="Anonymous" initial="oops">').ok).toBe(false);
    const repaired = session.open(compile(`# Repaired\n\n${number}`));
    expect(repaired.runtime.snapshot().state.amount).toBe(9);
    repaired.release();
  });

  it('gates stale worker previews after an explicit reset until the current source compiles', () => {
    const oldDocument = compile(number);
    const newSource = `# New document\n\n${number}`;
    const session = new PreviewStateSession();
    expect(session.canPreview(oldDocument, newSource)).toBe(false);
    const nextDocument = compile(newSource);
    expect(session.canPreview(nextDocument, newSource)).toBe(true);
    const active = session.open(nextDocument);
    expect(session.canPreview(nextDocument, `${newSource}\n\nPending edit`)).toBe(true);
    active.release();
    expect(new PreviewStateSession().canPreview(oldDocument, newSource)).toBe(false);
  });

  it('uses the current runtime values even if the next compile arrives before release', () => {
    const session = new PreviewStateSession();
    const first = compile(number);
    const active = session.open(first);
    active.runtime.set(control(first, 'amount'), 12);
    const next = session.open(compile(`${number}\n\nLatest worker result`));
    expect(next.runtime.snapshot().state.amount).toBe(12);
    active.runtime.set(control(first, 'amount'), 19);
    active.release();
    next.runtime.set(control(next.runtime.document, 'amount'), 5);
    next.release();
    const repeated = session.open(compile(`${number}\n\nFinal edit`));
    expect(repeated.runtime.snapshot().state.amount).toBe(5);
    repeated.release();
  });

  it('resets changed initial definitions, removed bindings, renamed bindings and types', () => {
    for (const replacement of [
      number.replace('initial="2"', 'initial="4"'),
      number.replace('initial="2"', ''),
      number.replace('amount', 'renamed'),
      '<input label="Name" bind="amount" initial="text">',
      'Removed control',
    ]) {
      const session = new PreviewStateSession();
      const first = compile(number);
      const active = session.open(first);
      active.runtime.set(control(first, 'amount'), 13);
      active.release();
      const document = compile(replacement);
      const next = session.open(document);
      expect(next.runtime.snapshot().state).toEqual(document.initialState);
      next.release();
      const restored = session.open(compile(number));
      expect(restored.runtime.snapshot().state.amount).toBe(2);
      restored.release();
    }
  });

  it('treats adding an explicit initial as an author reset even when its effective value is unchanged', () => {
    const session = new PreviewStateSession();
    const first = compile('<number label="Amount" bind="amount" min="0">');
    const active = session.open(first);
    active.runtime.set(control(first, 'amount'), 8);
    active.release();
    const next = session.open(compile('<number label="Amount" bind="amount" min="0" initial="0">'));
    expect(next.runtime.snapshot().state.amount).toBe(0);
    next.release();
  });

  it('validates retained candidates against changed bounds and every shared string control', () => {
    const session = new PreviewStateSession();
    const first = compile(`${number}\n\n<input label="Name" bind="name" initial="Ann">`);
    const active = session.open(first);
    active.runtime.set(control(first, 'amount'), 15);
    active.runtime.set(control(first, 'name'), 'Long name');
    active.release();
    const next = session.open(compile(`${number.replace('max="20"', 'max="10"')}\n\n<input label="Name" bind="name" initial="Ann">\n\n<textarea label="Name again" bind="name" max-length="4">`));
    expect(next.runtime.snapshot().state.amount).toBe(2);
    expect(next.runtime.snapshot().state.name).toBe('Ann');
    next.release();
  });

  it('rechecks step, email and date constraints while retaining still-valid numeric and boolean values', () => {
    const firstSource = `${number}\n\n<number label="Step" bind="stepAmount" initial="2" step="1">\n\n<input label="Email" bind="email">\n\n<date label="Day" bind="day" initial="2026-10-22">\n\n<toggle label="Enabled" bind="enabled">`;
    const session = new PreviewStateSession();
    const first = compile(firstSource);
    const active = session.open(first);
    active.runtime.set(control(first, 'amount'), 8);
    active.runtime.set(control(first, 'stepAmount'), 3);
    active.runtime.set(control(first, 'email'), 'not-an-email');
    active.runtime.set(control(first, 'day'), '2026-11-01');
    active.runtime.set(control(first, 'enabled'), true);
    active.release();
    const nextSource = firstSource
      .replace('max="20"', 'max="10"')
      .replace('step="1"', 'step="2"')
      .replace('label="Email"', 'label="Email" type="email"')
      .replace('label="Day"', 'label="Day" max="2026-10-31"');
    const next = session.open(compile(nextSource));
    expect(next.runtime.snapshot().state).toMatchObject({
      amount: 8, stepAmount: 2, email: '', day: '2026-10-22', enabled: true,
    });
    next.release();
  });

  it('preserves labels and valid select values but resets removed choices', () => {
    const firstSource = '<select bind="flavour" initial="a" label="Before"><option value="a">A</option><option value="b">B</option></select>';
    const session = new PreviewStateSession();
    const first = compile(firstSource);
    const active = session.open(first);
    active.runtime.set(control(first, 'flavour'), 'b');
    active.release();
    const renamedLabel = session.open(compile(firstSource.replace('Before', 'After').replace('>B<', '>Better<')));
    expect(renamedLabel.runtime.snapshot().state.flavour).toBe('b');
    renamedLabel.release();
    const removed = session.open(compile(firstSource.replace('<option value="b">B</option>', '')));
    expect(removed.runtime.snapshot().state.flavour).toBe('a');
    removed.release();
  });

  it('never transfers anonymous controls, timers or positional checklist items', () => {
    const source = `${number}\n\n<number label="Anonymous" initial="3">\n\n<timer label="Timer" bind="seconds" duration="60">\n\n<checklist label="Checklist" bind="done">\n- [ ] First\n- [ ] Second\n</checklist>`;
    const session = new PreviewStateSession();
    const first = compile(source);
    const active = session.open(first);
    active.runtime.set(control(first, 'amount'), 9);
    const anonymous = nodes(first).find((node) => node.name === 'number' && !node.attrs?.bind)!;
    active.runtime.set(anonymous, 7);
    active.runtime.set(control(first, 'seconds'), 27);
    active.runtime.set(control(first, 'done'), ['item-2']);
    active.release();
    const nextDocument = compile(`# New heading\n\n${source}`);
    const next = session.open(nextDocument);
    expect(next.runtime.snapshot().state.amount).toBe(9);
    expect(next.runtime.get(nodes(nextDocument).find((node) => node.name === 'number' && !node.attrs?.bind)!)).toBe(3);
    expect(next.runtime.snapshot().state.seconds).toBe(60);
    expect(next.runtime.snapshot().state.done).toEqual([]);
    next.release();
  });

  it('disables retention for following edits and isolates fresh sessions for reset actions', () => {
    const session = new PreviewStateSession();
    const first = compile(number);
    const active = session.open(first);
    active.runtime.set(control(first, 'amount'), 10);
    session.setRetention(false);
    expect(active.runtime.snapshot().state.amount).toBe(10);
    active.release();
    const reset = session.open(compile(`${number}\n\nEdit while disabled`));
    expect(reset.runtime.snapshot().state.amount).toBe(2);
    reset.runtime.set(control(reset.runtime.document, 'amount'), 6);
    session.setRetention(true);
    reset.release();
    const retained = session.open(compile(`${number}\n\nEnabled again`));
    expect(retained.runtime.snapshot().state.amount).toBe(6);
    retained.release();
    const fresh = new PreviewStateSession().open(first);
    expect(fresh.runtime.snapshot().state.amount).toBe(2);
    fresh.release();
  });

  it('supports StrictMode cleanup replay, idempotent disposal and immutable initial documents', () => {
    const session = new PreviewStateSession();
    const document = compile(number);
    const before = JSON.stringify(document);
    const first = session.open(document);
    first.release();
    first.release();
    expect(() => first.runtime.snapshot()).toThrow();
    const replayed = session.open(document);
    replayed.runtime.set(control(document, 'amount'), 8);
    replayed.release();
    const afterEdit = session.open(compile(`${number}\n\nNext`));
    expect(afterEdit.runtime.snapshot().state.amount).toBe(8);
    expect(JSON.stringify(document)).toBe(before);
    afterEdit.release();
  });
});
