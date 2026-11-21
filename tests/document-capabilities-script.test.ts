import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { createAuthorScriptVm } from '../src/local/runtime/author-script-vm';
import type { AuthorActionRegistration } from '../src/local/runtime/author-script-protocol';

describe('isolated author JavaScript', () => {
  it('restores binding data, initializes in source order, and registers a specific action', async () => {
    const result = compileLocal('<slider bind="people" label="People" initial="2" min="1" max="20">');
    if (!result.ok) throw new Error('Expected compiled fixture.');
    const runtime = createLocalRuntime(result.document);
    const errors: string[] = [];
    const registrations: AuthorActionRegistration[] = [];
    const requests: string[] = [];
    expect(runtime.setParameter('people', 5)).toEqual([]);
    const vm = await createAuthorScriptVm(['counter'], async request => {
      requests.push(request.operation);
      if (request.operation === 'get') return { ok: true, value: runtime.getParameter(request.name) };
      const diagnostics = request.operation === 'set'
        ? runtime.setParameter(request.name, request.value) : runtime.setParameters(request.values);
      return diagnostics.length ? { ok: false, message: diagnostics[0].message } : { ok: true };
    }, items => registrations.push(...items), (_, error) => errors.push(error));
    try {
      await vm.initialize([
        'const people = 100; if (typeof document !== "undefined" || typeof fetch !== "undefined") throw "host exposed";',
        'await rmd.set("people", await rmd.get("people") + 2);',
        'rmd.handleAction("counter", "increment", async () => { await rmd.setMany({ people: await rmd.get("people") + 3 }); });',
      ]);
      expect(errors).toEqual([]);
      expect(runtime.getParameter('people')).toBe(7);
      expect(registrations).toEqual([{ target: 'counter', action: 'increment', takeover: true }]);
      await vm.dispatch('counter', 'reset');
      expect(runtime.getParameter('people')).toBe(7);
      await vm.dispatch('counter', 'increment');
      expect(runtime.getParameter('people')).toBe(10);
      expect(requests).toEqual(['get', 'set', 'get', 'setMany']);
    } finally {
      vm.dispose();
      runtime.dispose();
    }
  });

  it('keeps later script blocks available after an ordinary exception', async () => {
    const reports: [number, string][] = [];
    const vm = await createAuthorScriptVm([], async () => ({ ok: true }), () => {}, (index, text) => reports.push([index, text]));
    try {
      await vm.initialize(['throw new Error("first");', 'await rmd.set("people", 10);']);
      expect(reports).toEqual([[0, 'first']]);
    } finally {
      vm.dispose();
    }
  });
});
