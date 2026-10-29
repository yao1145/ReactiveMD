import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime, notifyLocalRuntime, updateLocalRuntime } from '../src/local/runtime';
import { createLocalCompileSession } from '../src/local/incremental';
import type { LocalDocument, LocalNode, LocalRuntime } from '../src/local/types';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function control(document: LocalDocument, bind: string): LocalNode {
  const node = all(document.nodes).find((candidate) => candidate.attrs?.bind === bind);
  if (!node) throw new Error(`Missing control bound to ${bind}`);
  return node;
}

const amount = '<number label="Amount" bind="amount" initial="2" min="0" max="20">';
const name = '<input label="Name" bind="name" initial="Ann">';

function withRuntime(document: LocalDocument, run: (runtime: LocalRuntime) => void): void {
  const runtime = createLocalRuntime(document);
  try {
    run(runtime);
  } finally {
    runtime.dispose();
  }
}

describe('in-place runtime document updates', () => {
  it('keeps runtime identity, subscriptions and values across a prose edit', () => {
    const first = compile(`${amount}\n\nTotal: {{ amount * 2 }}`);
    withRuntime(first, (runtime) => {
      let calls = 0;
      runtime.subscribe(() => {
        calls += 1;
      });
      expect(runtime.setParameter('amount', 11)).toEqual([]);
      expect(calls).toBe(1);
      const revisionBefore = runtime.snapshot().revision;
      const publicSnapshot = runtime.snapshot();

      const next = compile(`# Revised prose\n\n${amount}\n\nTotal: {{ amount * 2 }}`);
      const report = updateLocalRuntime(runtime, next, { notify: false });

      expect(report.ok).toBe(true);
      expect(report.changed).toBe(true);
      expect(report.retained).toEqual(['amount']);
      expect(report.dropped).toEqual([]);
      expect(report.diagnostics).toEqual([]);
      expect(report.revision).toBe(revisionBefore + 1);
      expect(runtime.document).toBe(next);
      expect(runtime.document).not.toBe(first);
      expect(runtime.get(control(next, 'amount'))).toBe(11);
      expect(runtime.evaluate('amount * 2')).toBe(22);
      // A staged update must not notify from the update call itself.
      expect(calls).toBe(1);
      // The public snapshot captured before the update is never mutated.
      expect(publicSnapshot.state.amount).toBe(11);
      expect(Object.isFrozen(publicSnapshot.state)).toBe(true);
      expect(runtime.snapshot()).not.toBe(publicSnapshot);

      notifyLocalRuntime(runtime);
      expect(calls).toBe(2);
    });
  });

  it('notifies subscribers by default', () => {
    const first = compile(amount);
    withRuntime(first, (runtime) => {
      let calls = 0;
      runtime.subscribe(() => {
        calls += 1;
      });
      const report = updateLocalRuntime(runtime, compile(`Preamble\n\n${amount}`));
      expect(report.ok).toBe(true);
      expect(calls).toBe(1);
    });
  });

  it('resets removed, renamed, retyped and re-initialised bindings only', () => {
    const first = compile(`${amount}\n\n${name}`);
    withRuntime(first, (runtime) => {
      expect(runtime.setParameter('amount', 13)).toEqual([]);
      expect(runtime.setParameter('name', 'Bea')).toEqual([]);

      const reinitialised = compile(`${amount.replace('initial="2"', 'initial="4"')}\n\n${name}`);
      const report = updateLocalRuntime(runtime, reinitialised, { notify: false });
      expect(report.ok).toBe(true);
      expect(report.retained).toEqual(['name']);
      expect(report.dropped).toEqual([{ name: 'amount', reason: 'initial' }]);
      expect(runtime.getParameter('amount')).toBe(4);
      expect(runtime.getParameter('name')).toBe('Bea');

      const retyped = compile(`${amount.replace('initial="2"','initial="4"')}\n\n<slider label="Name" bind="name" initial="0">`);
      const retypedReport = updateLocalRuntime(runtime, retyped, { notify: false });
      expect(retypedReport.dropped).toEqual([{ name: 'name', reason: 'type' }]);
      expect(runtime.getParameter('name')).toBe(0);

      const removed = compile('Removed control');
      const removedReport = updateLocalRuntime(runtime, removed, { notify: false });
      expect(removedReport.dropped).toEqual([
        { name: 'amount', reason: 'unknown' },
        { name: 'name', reason: 'unknown' },
      ]);
      expect(runtime.parameterNames()).toEqual([]);
      expect(runtime.snapshot().state).toEqual({});
    });
  });

  it('falls back to the new initial when the new constraints reject a value', () => {
    const first = compile(`${amount}\n\n${name}`);
    withRuntime(first, (runtime) => {
      expect(runtime.setParameter('amount', 15)).toEqual([]);
      expect(runtime.setParameter('name', 'A rather long name')).toEqual([]);

      const narrowed = compile(
        `${amount.replace('max="20"', 'max="10"')}\n\n<input label="Name" bind="name" initial="Ann" max-length="4">`,
      );
      const report = updateLocalRuntime(runtime, narrowed, { notify: false });
      expect(report.ok).toBe(true);
      expect(report.retained).toEqual([]);
      expect(report.dropped).toEqual([
        { name: 'amount', reason: 'invalid' },
        { name: 'name', reason: 'invalid' },
      ]);
      expect(report.diagnostics.map((entry) => entry.code)).toEqual([
        'local.runtime.value',
        'local.runtime.value',
      ]);
      expect(runtime.getParameter('amount')).toBe(2);
      expect(runtime.getParameter('name')).toBe('Ann');
    });
  });

  it('keeps multi-slot ranges globally ordered while retaining what still fits', () => {
    const slider = '<range-slider label="Range" bind-start="lo" bind-end="hi" initial-start="20" initial-end="60" min="0" max="100" step="1">';
    const first = compile(slider);
    withRuntime(first, (runtime) => {
      expect(runtime.setParameters({ lo: 30, hi: 70 })).toEqual([]);

      const shifted = compile(`Updated prose\n\n${slider}`);
      const retained = updateLocalRuntime(runtime, shifted, { notify: false });
      expect(retained.retained).toEqual(['hi', 'lo']);
      expect(runtime.getParameter('lo')).toBe(30);
      expect(runtime.getParameter('hi')).toBe(70);

      // A reset end slot now crosses the retained start value. The crossing
      // slot pair must fall back to authored initials, never commit an
      // inverted range.
      const resetEnd = compile(slider.replace('initial-end="60"', 'initial-end="20"'));
      const report = updateLocalRuntime(runtime, resetEnd, { notify: false });
      expect(report.ok).toBe(true);
      expect(report.dropped).toEqual([
        { name: 'hi', reason: 'initial' },
        { name: 'lo', reason: 'invalid' },
      ]);
      expect(runtime.getParameter('lo')).toBe(20);
      expect(runtime.getParameter('hi')).toBe(20);
    });
  });

  it('recomputes constants, computed values and validation ranges for the new document', () => {
    const rule = '<validation when="{{ n > 0 }}" message="N must be positive" fields="n">';
    const first = compile([
      '<const name="step" value="{{ 10 }}">',
      '<computed name="triple" value="{{ n * 3 }}">',
      '<number bind="n" label="N" initial="1" min="0" max="100">',
      rule,
    ].join('\n'));
    withRuntime(first, (runtime) => {
      expect(runtime.setParameter('n', 0)).toEqual([]);
      const failing = runtime.validate();
      expect(failing).toHaveLength(1);
      expect(failing[0].range).toEqual(first.validations![0].range);

      const next = compile([
        'Leading prose that moves every range.',
        '',
        '<const name="step" value="{{ 20 }}">',
        '<computed name="triple" value="{{ n * 4 }}">',
        '<number bind="n" label="N" initial="1" min="0" max="100">',
        rule,
      ].join('\n'));
      const report = updateLocalRuntime(runtime, next, { notify: false });
      expect(report.ok).toBe(true);
      expect(report.retained).toEqual(['n']);
      expect(runtime.evaluate('step')).toBe(20);
      expect(runtime.evaluate('triple')).toBe(0);
      expect(runtime.getParameter('n')).toBe(0);

      const moved = runtime.validate();
      expect(moved).toHaveLength(1);
      expect(moved[0].range).toEqual(next.validations![0].range);
      expect(moved[0].range.start).not.toBe(failing[0].range.start);
    });
  });

  it('isolates a failing computation introduced by the new document', () => {
    const first = compile('<computed name="ratio" value="{{ 100 / n }}">\n<number bind="n" label="N" initial="2">\n\n{{ n + 1 }}');
    withRuntime(first, (runtime) => {
      expect(runtime.evaluate('ratio')).toBe(50);
      const next = compile('<computed name="ratio" value="{{ 100 / (n - 2) }}">\n<number bind="n" label="N" initial="2">\n\n{{ 1 + 1 }}');
      expect(updateLocalRuntime(runtime, next, { notify: false }).ok).toBe(true);
      expect(() => runtime.evaluate('ratio')).toThrow();
      expect(runtime.evaluate('1 + 1')).toBe(2);
    });
  });

  it('behaves conservatively for removed, anonymous and stateful controls', () => {
    const first = compile(`${amount}\n\n<number label="Anonymous" initial="3">\n\n<timer label="Timer" bind="seconds" duration="60">\n\n<checklist label="Checklist" bind="done">\n- [ ] First\n</checklist>`);
    withRuntime(first, (runtime) => {
      const anonymous = all(first.nodes).find((node) => node.name === 'number' && !node.attrs?.bind);
      if (!anonymous) throw new Error('Missing anonymous control');
      expect(runtime.setParameter('amount', 9)).toEqual([]);
      expect(runtime.set(anonymous, 7)).toEqual([]);
      expect(runtime.setParameter('seconds', 27)).toEqual([]);
      expect(runtime.setParameter('done', ['item-1'])).toEqual([]);

      const next = compile(`# New heading\n\n${first.source}`);
      const report = updateLocalRuntime(runtime, next, { notify: false });
      expect(report.retained).toEqual(['amount']);
      expect(report.dropped.find((entry) => entry.name === 'seconds')?.reason).toBe('unretainable');
      expect(report.dropped.find((entry) => entry.name === 'done')?.reason).toBe('unretainable');
      const nextAnonymous = all(next.nodes).find((node) => node.name === 'number' && !node.attrs?.bind);
      if (!nextAnonymous) throw new Error('Missing anonymous control');
      expect(runtime.get(nextAnonymous)).toBe(3);
      expect(runtime.getParameter('seconds')).toBe(60);
      expect(runtime.getParameter('done')).toEqual([]);
    });
  });

  it('rejects unusable documents, foreign runtimes and disposed runtimes', () => {
    const document = compile(amount);
    const runtime = createLocalRuntime(document);
    try {
      const invalid = { ...document, syntax: 'remote' } as unknown as LocalDocument;
      expect(updateLocalRuntime(runtime, invalid, { notify: false })).toMatchObject({ ok: false, changed: false });
      expect(runtime.document).toBe(document);

      expect(() => updateLocalRuntime({} as LocalRuntime, document)).toThrow(TypeError);
    } finally {
      runtime.dispose();
    }
    expect(() => updateLocalRuntime(runtime, document)).toThrow(/disposed/);
  });

  it('can drive repeated edits from one compile session', () => {
    const session = createLocalCompileSession();
    try {
      const runtime = createLocalRuntime(compile(amount));
      try {
        let source = `${amount}\n\nOne`;
        for (let index = 0; index < 6; index += 1) {
          source += `\n\nParagraph ${index}`;
          const result = session.compile(source);
          if (!result.ok) throw new Error('Expected a successful compile');
          const report = updateLocalRuntime(runtime, result.document, { notify: false });
          expect(report.ok).toBe(true);
        }
        expect(runtime.getParameter('amount')).toBe(2);
        expect(runtime.document.source).toBe(source);
      } finally {
        runtime.dispose();
      }
    } finally {
      session.dispose();
    }
  });
});
