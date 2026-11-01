import { describe, expect, it } from 'vitest';
import { compileLatex, compileLocal, createLocalRuntime, type LocalValue } from 'reactive-md';
import { DEFAULT_EXAMPLE_ID, EXAMPLES, isFeatureExample, localizedExample, resolveExampleId } from '../src/examples';

describe('scenario catalog', () => {
  it('opens with a classroom lesson and collects the old examples into one feature group', () => {
    expect(DEFAULT_EXAMPLE_ID).toBe('classroom');
    expect(EXAMPLES.filter(item => item.section === 'scenario').map(item => item.id)).toEqual(['classroom', 'proposal', 'survey', 'blog']);
    expect(EXAMPLES.filter(item => item.section === 'feature').map(item => item.id)).toEqual(['features']);
    expect(EXAMPLES.filter(isFeatureExample)).toHaveLength(8);
    expect(resolveExampleId('features')).toBe('features');
    expect(resolveExampleId('tetris')).toBe('games');
    expect(resolveExampleId('game-2048')).toBe('games');
    expect(resolveExampleId('functions')).toBe('functions');
  });
});

describe.each(['en', 'zh'] as const)('%s everyday documents', language => {
  function start(id: string) {
    const example = EXAMPLES.find(item => item.id === id)!;
    const source = localizedExample(example, language).source;
    const result = compileLocal(source);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics).toEqual([]);
    const runtime = createLocalRuntime(result.document);
    return { source, runtime, set(name: string, value: LocalValue) { expect(runtime.setParameter(name, value)).toEqual([]); } };
  }

  it('uses odd Fourier coefficients and makes every partial sum zero at the jump', () => {
    const { source, runtime, set } = start('classroom');
    try {
      set('terms', 1);
      set('probe', 1);
      expect(runtime.evaluate('approx')).toBeCloseTo(4 / Math.PI * Math.sin(1));
      set('terms', 3);
      expect(runtime.evaluate('approx')).toBeCloseTo(4 / Math.PI * (Math.sin(1) + Math.sin(3)/3 + Math.sin(5)/5));
      const formulas = [...source.match(/<plot[\s\S]*?<\/plot>/)![0].matchAll(/\$\$([\s\S]*?)\$\$/g)].map(match => compileLatex(match[1]));
      expect(formulas[0].evaluate(-1, {})).toBe(-1);
      expect(formulas[0].evaluate(0, {})).toBe(0);
      expect(formulas[0].evaluate(1, {})).toBe(1);
      expect(formulas[1].evaluate(1, runtime.snapshot().state as Record<string, number>)).toBeCloseTo(runtime.evaluate('approx') as number);
      set('n', 2);
      expect(runtime.evaluate('coefficient')).toBe(0);
      set('n', 3);
      expect(runtime.evaluate('coefficient')).toBeCloseTo(4 / (3 * Math.PI));
      set('probe', 0); set('terms', 8);
      expect(runtime.evaluate('approx')).toBe(0);
    } finally { runtime.dispose(); }
  });

  it('keeps procurement, contingency and budget decisions on the same estimate', () => {
    const { runtime, set } = start('proposal');
    try {
      expect(runtime.evaluate('total')).toBeCloseTo(4356);
      expect(runtime.evaluate('budget - total')).toBeCloseTo(644);
      set('reuse', true);
      expect(runtime.evaluate('total')).toBeCloseTo(4092);
      set('budget', 4000);
      expect(runtime.evaluate('total > budget')).toBe(true);
      set('books', 70);
      expect(runtime.evaluate('total <= budget')).toBe(true);
    } finally { runtime.dispose(); }
  });

  it('keeps all six merged demonstrations independent in the same runtime', () => {
    const { runtime, set } = start('features');
    try {
      set('formsSeats', 6);
      expect(runtime.evaluate('formsTotal')).toBe(480);
      expect(runtime.evaluate('flowTotal')).toBe(320);
      expect(runtime.evaluate('statisticsTotal')).toBe(620);
      set('functionsA', 0);
      expect(runtime.evaluate('functionsWaveHeight')).toBe(0);
      expect(runtime.evaluate('formsTotal')).toBe(480);
      expect(runtime.validate()).toEqual([]);
    } finally { runtime.dispose(); }
  });

  it('builds an individual survey response from preferences and handles a blank nickname', () => {
    const { runtime, set } = start('survey');
    try {
      set('name', '  River  ');
      set('topics', ['photos', 'writing']);
      set('pace', 'independent');
      expect(runtime.evaluate('displayName')).toBe('River');
      expect(runtime.evaluate('len(topics)')).toBe(2);
      expect(runtime.evaluate('sessionMinutes')).toBe(120);
      set('name', '  ');
      expect(runtime.evaluate('displayName')).toBe(language === 'zh' ? '这位同学' : 'This participant');
    } finally { runtime.dispose(); }
  });

  it('keeps the literary reading choice and personal note as independent inputs', () => {
    const { runtime, set } = start('blog');
    try {
      expect(runtime.evaluate('detail')).toBe('steps');
      set('detail', 'dust');
      set('note', '  A small gesture stayed with me.  ');
      expect(runtime.evaluate('detail')).toBe('dust');
      expect(runtime.evaluate('trim(note)')).toBe('A small gesture stayed with me.');
    } finally { runtime.dispose(); }
  });
});
