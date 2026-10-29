import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalCompileSession, createLocalRuntime, updateLocalRuntime } from '../src/local';
import type { LocalDocument } from '../src/local';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

describe('draft 3 with document and compiler reuse', () => {
  const source = '<external name="rate" type="number">\n<number bind="rooms" label="Rooms" initial="2">\n<computed name="limit" value="{{ rooms * rate }}">\n<number bind="guests" label="Guests" initial="1" max="{{ limit }}">';

  it('retains external values and validates new dynamic expressions after adoption', () => {
    const runtime = createLocalRuntime(compile(source), { externalValues: { rate: 4 } });
    try {
      expect(runtime.setParameters({ rooms: 3, guests: 10 })).toEqual([]);
      expect(updateLocalRuntime(runtime, compile('Intro\n\n' + source)).ok).toBe(true);
      expect(runtime.getExternal('rate')).toBe(4);
      expect(runtime.getParameter('guests')).toBe(10);
      const next = compile(source.replace('max="{{ limit }}"', 'max="{{ limit / 2 }}"'));
      expect(updateLocalRuntime(runtime, next).ok).toBe(true);
      expect(runtime.getParameter('rooms')).toBe(3);
      expect(runtime.getParameter('guests')).toBe(1);
      expect(runtime.setParameter('guests', 7)).not.toEqual([]);
      expect(runtime.setParameter('guests', 6)).toEqual([]);
    } finally { runtime.dispose(); }
  });

  it('revalidates retained dependents after rejecting another retained value', () => {
    const source = '<number bind="rooms" label="Rooms" initial="2" min="1" max="10">\n<number bind="guests" label="Guests" initial="1" max="{{ rooms * 4 }}">';
    const runtime = createLocalRuntime(compile(source));
    try {
      expect(runtime.setParameters({ rooms: 5, guests: 15 })).toEqual([]);
      expect(updateLocalRuntime(runtime, compile(source.replace('max="10"', 'max="3"'))).ok).toBe(true);
      expect(runtime.getParameters()).toEqual({ rooms: 2, guests: 1 });
      expect(runtime.setParameters(runtime.getParameters())).toEqual([]);
    } finally { runtime.dispose(); }
  });

  it('prunes externals when their declaration is removed or changes type', () => {
    const runtime = createLocalRuntime(compile('<external name="rate" type="number">\n\n{{ rate }}'), { externalValues: { rate: 4 } });
    try {
      expect(updateLocalRuntime(runtime, compile('<external name="rate" type="string">\n\n{{ rate }}')).ok).toBe(true);
      expect(runtime.getExternalValues()).toEqual({});
      expect(() => runtime.evaluate('rate')).toThrow();
      expect(runtime.setExternalValues({ rate: 'updated' })).toEqual([]);
      expect(updateLocalRuntime(runtime, compile('No external')).ok).toBe(true);
      expect(runtime.getExternalValues()).toEqual({});
      expect(runtime.snapshot().state).not.toHaveProperty('rate');
    } finally { runtime.dispose(); }
  });

  it('keeps missing external failures local after source edits', () => {
    const runtime = createLocalRuntime(compile(source));
    try {
      expect(updateLocalRuntime(runtime, compile('Intro\n\n' + source)).ok).toBe(true);
      expect(runtime.setParameter('rooms', 5)).toEqual([]);
      expect(() => runtime.evaluate('limit')).toThrow();
      expect(runtime.setExternalValues({ rate: 4 })).toEqual([]);
      expect(runtime.evaluate('limit')).toBe(20);
    } finally { runtime.dispose(); }
  });

  it('shifts external ranges and constraint offsets with incremental source edits', () => {
    const session = createLocalCompileSession();
    try {
      let text = 'First paragraph\n\n' + source + '\n\nLast paragraph';
      expect(session.compile(text).ok).toBe(true);
      session.prepare();
      text = text.replace('First paragraph', 'A longer introductory paragraph');
      const result = session.compile(text);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const full = compile(text);
      expect(result.document.externals?.rate.range).toEqual(full.externals?.rate.range);
      const offsets = (doc: LocalDocument) => Object.values(doc.dynamicConstraints ?? {}).flatMap((constraints) => Object.values(constraints).map((constraint) => constraint.offset));
      expect(offsets(result.document)).toEqual(offsets(full));
      expect(result.document.source).toBe(text);
    } finally { session.dispose(); }
  });

  it('retains shared host bindings on prose edits and resets changed initials', () => {
    const options = { hostComponents: [{ name: 'host-number', form: 'leaf' as const, props: {}, binding: { kind: 'number' as const, min: 0, max: 5 } }] };
    const text = '<host-number bind="rating" initial="2">\n<number bind="rating" label="Rating" min="0" max="5">';
    const first = compileLocal(text, options);
    if (!first.ok) throw new Error(JSON.stringify(first.diagnostics));
    const runtime = createLocalRuntime(first.document);
    try {
      expect(runtime.setParameter('rating', 4)).toEqual([]);
      for (const [nextSource, expected] of [['Intro\n\n' + text, 4], [text.replace('initial="2"', 'initial="3"'), 3]] as const) {
        const next = compileLocal(nextSource, options);
        if (!next.ok) throw new Error(JSON.stringify(next.diagnostics));
        expect(updateLocalRuntime(runtime, next.document).ok).toBe(true);
        expect(runtime.getParameter('rating')).toBe(expected);
      }
    } finally { runtime.dispose(); }
  });
});
