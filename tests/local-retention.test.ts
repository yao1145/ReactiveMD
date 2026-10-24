import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import {
  applyLocalStateRetention,
  planLocalStateRetention,
  type LocalStateRetentionDrop,
} from '../src/local/retention';
import { createLocalRuntime } from '../src/local/runtime';
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

function planFrom(previous: LocalDocument, runtime: LocalRuntime, next: LocalDocument) {
  return planLocalStateRetention({ previous, state: runtime.snapshot().state, next });
}

function reasons(dropped: readonly LocalStateRetentionDrop[]): string[] {
  return dropped.map((entry) => entry.reason);
}

const number = '<number label="Amount" bind="amount" initial="2" min="0" max="20">';

describe('local state retention planning', () => {
  it('retains values across prose and formula edits without mutating inputs', () => {
    const first = compile(`${number}\n\nTotal: {{ amount * 2 }}`);
    const runtime = createLocalRuntime(first);
    try {
      expect(runtime.setParameter('amount', 11)).toEqual([]);
      const documentBefore = JSON.stringify(first);
      const stateBefore = JSON.stringify(runtime.snapshot().state);

      const next = compile(`# Revised prose\n\n${number}\n\nResult: {{ amount * 3 }}`);
      const plan = planFrom(first, runtime, next);
      expect(plan.retained).toEqual(['amount']);
      expect(plan.values).toEqual({ amount: 11 });
      expect(plan.dropped).toEqual([]);
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.values)).toBe(true);
      expect(Object.isFrozen(plan.retained)).toBe(true);
      expect(Object.isFrozen(plan.dropped)).toBe(true);
      expect(JSON.stringify(first)).toBe(documentBefore);
      expect(JSON.stringify(runtime.snapshot().state)).toBe(stateBefore);

      const updated = createLocalRuntime(next);
      try {
        expect(applyLocalStateRetention(updated, plan)).toEqual({
          retained: ['amount'],
          dropped: [],
          diagnostics: [],
        });
        expect(updated.getParameter('amount')).toBe(11);
        expect(updated.setParameter('amount', 7)).toEqual([]);

        const repeatedDocument = compile(`${number}\n\nAnother edit`);
        const repeated = planFrom(next, updated, repeatedDocument);
        expect(repeated.retained).toEqual(['amount']);
        expect(repeated.values).toEqual({ amount: 7 });
      } finally {
        updated.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  it('resets changed initial definitions, removed bindings, renames and types', () => {
    const replacements: { source: string; reason: LocalStateRetentionDrop['reason'] }[] = [
      { source: number.replace('initial="2"', 'initial="4"'), reason: 'initial' },
      { source: number.replace('initial="2"', ''), reason: 'initial' },
      { source: 'Removed control', reason: 'unknown' },
      { source: number.replace('amount', 'renamed'), reason: 'unknown' },
      { source: '<input label="Name" bind="amount" initial="text">', reason: 'type' },
    ];
    for (const replacement of replacements) {
      const first = compile(number);
      const runtime = createLocalRuntime(first);
      const next = compile(replacement.source);
      try {
        expect(runtime.setParameter('amount', 13)).toEqual([]);
        const plan = planFrom(first, runtime, next);
        expect(plan.values).toEqual({});
        expect(plan.retained).toEqual([]);
        expect(plan.dropped).toEqual([{ name: 'amount', reason: replacement.reason }]);

        const updated = createLocalRuntime(next);
        try {
          expect(applyLocalStateRetention(updated, plan).diagnostics).toEqual([]);
          expect(updated.snapshot().state).toEqual(next.initialState);
        } finally {
          updated.dispose();
        }
      } finally {
        runtime.dispose();
      }
    }
  });

  it('treats an added explicit initial as an author reset', () => {
    const first = compile('<number label="Amount" bind="amount" min="0">');
    const runtime = createLocalRuntime(first);
    try {
      expect(runtime.setParameter('amount', 8)).toEqual([]);
      const next = compile('<number label="Amount" bind="amount" min="0" initial="0">');
      const plan = planFrom(first, runtime, next);
      expect(plan.values).toEqual({});
      expect(plan.dropped).toEqual([{ name: 'amount', reason: 'initial' }]);

      const updated = createLocalRuntime(next);
      try {
        applyLocalStateRetention(updated, plan);
        expect(updated.getParameter('amount')).toBe(0);
      } finally {
        updated.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  it('revalidates retained values against changed bounds and shared string controls', () => {
    const first = compile(`${number}\n\n<input label="Name" bind="name" initial="Ann">`);
    const runtime = createLocalRuntime(first);
    try {
      expect(runtime.setParameter('amount', 15)).toEqual([]);
      expect(runtime.setParameter('name', 'Long name')).toEqual([]);

      const next = compile(
        `${number.replace('max="20"', 'max="10"')}\n\n<input label="Name" bind="name" initial="Ann">\n\n<textarea label="Name again" bind="name" max-length="4">`,
      );
      const plan = planFrom(first, runtime, next);
      expect(plan.retained).toEqual(['amount', 'name']);
      expect(plan.dropped).toEqual([]);

      const updated = createLocalRuntime(next);
      try {
        const result = applyLocalStateRetention(updated, plan);
        expect(result.retained).toEqual([]);
        expect(result.dropped).toEqual([
          { name: 'amount', reason: 'invalid' },
          { name: 'name', reason: 'invalid' },
        ]);
        expect(result.diagnostics.map((entry) => entry.code)).toEqual([
          'local.runtime.value',
          'local.runtime.value',
        ]);
        expect(updated.getParameter('amount')).toBe(2);
        expect(updated.getParameter('name')).toBe('Ann');
      } finally {
        updated.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  it('rechecks step, email and date constraints while keeping other values', () => {
    const firstSource = `${number}\n\n<number label="Step" bind="stepAmount" initial="2" step="1">\n\n<input label="Email" bind="email">\n\n<date label="Day" bind="day" initial="2026-10-22">\n\n<toggle label="Enabled" bind="enabled">`;
    const first = compile(firstSource);
    const runtime = createLocalRuntime(first);
    try {
      expect(runtime.setParameter('amount', 8)).toEqual([]);
      expect(runtime.setParameter('stepAmount', 3)).toEqual([]);
      expect(runtime.setParameter('email', 'not-an-email')).toEqual([]);
      expect(runtime.setParameter('day', '2026-11-01')).toEqual([]);
      expect(runtime.setParameter('enabled', true)).toEqual([]);

      const nextSource = firstSource
        .replace('max="20"', 'max="10"')
        .replace('step="1"', 'step="2"')
        .replace('label="Email"', 'label="Email" type="email"')
        .replace('label="Day"', 'label="Day" max="2026-10-31"');
      const next = compile(nextSource);
      const plan = planFrom(first, runtime, next);
      expect(plan.retained).toEqual(['amount', 'day', 'email', 'enabled', 'stepAmount']);

      const updated = createLocalRuntime(next);
      try {
        const result = applyLocalStateRetention(updated, plan);
        expect(result.retained).toEqual(['amount', 'enabled']);
        expect(result.dropped).toEqual([
          { name: 'day', reason: 'invalid' },
          { name: 'email', reason: 'invalid' },
          { name: 'stepAmount', reason: 'invalid' },
        ]);
        expect(updated.snapshot().state).toMatchObject({
          amount: 8,
          stepAmount: 2,
          email: '',
          day: '2026-10-22',
          enabled: true,
        });
      } finally {
        updated.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  it('keeps select labels but rejects choices removed from the new document', () => {
    const firstSource = '<select bind="flavour" initial="a" label="Before"><option value="a">A</option><option value="b">B</option></select>';
    const first = compile(firstSource);
    const runtime = createLocalRuntime(first);
    try {
      expect(runtime.setParameter('flavour', 'b')).toEqual([]);

      const renamed = compile(firstSource.replace('Before', 'After').replace('>B<', '>Better<'));
      const renamedPlan = planFrom(first, runtime, renamed);
      expect(renamedPlan.retained).toEqual(['flavour']);
      const renamedRuntime = createLocalRuntime(renamed);
      try {
        expect(applyLocalStateRetention(renamedRuntime, renamedPlan).diagnostics).toEqual([]);
        expect(renamedRuntime.getParameter('flavour')).toBe('b');
      } finally {
        renamedRuntime.dispose();
      }

      const removed = compile(firstSource.replace('<option value="b">B</option>', ''));
      const removedPlan = planFrom(first, runtime, removed);
      expect(removedPlan.retained).toEqual(['flavour']);
      const removedRuntime = createLocalRuntime(removed);
      try {
        const result = applyLocalStateRetention(removedRuntime, removedPlan);
        expect(result.retained).toEqual([]);
        expect(result.dropped).toEqual([{ name: 'flavour', reason: 'invalid' }]);
        expect(removedRuntime.getParameter('flavour')).toBe('a');
      } finally {
        removedRuntime.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  it('never retains anonymous controls, timers or positional checklist items', () => {
    const source = `${number}\n\n<number label="Anonymous" initial="3">\n\n<timer label="Timer" bind="seconds" duration="60">\n\n<checklist label="Checklist" bind="done">\n- [ ] First\n- [ ] Second\n</checklist>`;
    const first = compile(source);
    const runtime = createLocalRuntime(first);
    try {
      const anonymous = all(first.nodes).find((node) => node.name === 'number' && !node.attrs?.bind);
      if (!anonymous) throw new Error('Missing anonymous control');
      expect(runtime.setParameter('amount', 9)).toEqual([]);
      expect(runtime.set(anonymous, 7)).toEqual([]);
      expect(runtime.setParameter('seconds', 27)).toEqual([]);
      expect(runtime.setParameter('done', ['item-2'])).toEqual([]);

      const next = compile(`# New heading\n\n${source}`);
      const plan = planFrom(first, runtime, next);
      expect(plan.retained).toEqual(['amount']);
      expect(plan.values).toEqual({ amount: 9 });
      expect(reasons(plan.dropped)).toEqual(['internal', 'unretainable', 'unretainable']);
      expect(plan.dropped.find((entry) => entry.name === 'seconds')?.reason).toBe('unretainable');
      expect(plan.dropped.find((entry) => entry.name === 'done')?.reason).toBe('unretainable');
      expect(plan.dropped.every((entry) => Object.isFrozen(entry))).toBe(true);

      const updated = createLocalRuntime(next);
      try {
        expect(applyLocalStateRetention(updated, plan).diagnostics).toEqual([]);
        expect(updated.getParameter('amount')).toBe(9);
        const nextAnonymous = all(next.nodes).find((node) => node.name === 'number' && !node.attrs?.bind);
        if (!nextAnonymous) throw new Error('Missing anonymous control');
        expect(updated.get(nextAnonymous)).toBe(3);
        expect(updated.getParameter('seconds')).toBe(60);
        expect(updated.getParameter('done')).toEqual([]);
      } finally {
        updated.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  it('retains and applies public slot bindings atomically', () => {
    const source = '<range-slider label="Range" bind-start="lo" bind-end="hi" initial-start="20" initial-end="60" min="0" max="100" step="1">';
    const first = compile(source);
    const runtime = createLocalRuntime(first);
    try {
      expect(runtime.setParameters({ lo: 30, hi: 70 })).toEqual([]);
      const next = compile(`# Updated\n\n${source}`);
      const plan = planFrom(first, runtime, next);
      expect(plan.retained).toEqual(['hi', 'lo']);
      expect(plan.values).toEqual({ hi: 70, lo: 30 });

      const updated = createLocalRuntime(next);
      try {
        let calls = 0;
        updated.subscribe(() => {
          calls += 1;
        });
        expect(applyLocalStateRetention(updated, plan)).toEqual({
          retained: ['hi', 'lo'],
          dropped: [],
          diagnostics: [],
        });
        expect(calls).toBe(1);
        expect(updated.snapshot().revision).toBe(1);
        expect(updated.getParameter('lo')).toBe(30);
        expect(updated.getParameter('hi')).toBe(70);
      } finally {
        updated.dispose();
      }

      const narrowed = compile(source.replace('max="100"', 'max="60"'));
      const narrowedPlan = planFrom(first, runtime, narrowed);
      expect(narrowedPlan.retained).toEqual(['hi', 'lo']);
      const narrowedRuntime = createLocalRuntime(narrowed);
      try {
        const result = applyLocalStateRetention(narrowedRuntime, narrowedPlan);
        expect(result.retained).toEqual(['lo']);
        expect(result.dropped).toEqual([{ name: 'hi', reason: 'invalid' }]);
        expect(narrowedRuntime.getParameter('lo')).toBe(30);
        expect(narrowedRuntime.getParameter('hi')).toBe(60);
      } finally {
        narrowedRuntime.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
});
