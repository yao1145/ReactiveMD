import { describe, expect, it } from 'vitest';
import { compileLatex, compileLocal, createLocalRuntime, type LocalValue } from 'reactive-md';
import { EXAMPLES, DEFAULT_EXAMPLE_ID, localizedExample, localizedExamples } from '../src/examples';
import { config, examples as extensionExamples } from '#demo-extensions';

function exampleSource(id: string) {
  const example = EXAMPLES.find((item) => item.id === id);
  if (!example) throw new Error(`Missing example ${id}`);
  return example.source;
}

function flatten<T extends { children?: T[] }>(nodes: T[]): T[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

describe('playground local documents consumed through the public package', () => {
  it('ships the built-in tours and registered plugin examples', () => {
    expect(EXAMPLES).toHaveLength(8 + extensionExamples.length);
    expect(new Set(EXAMPLES.map((example) => example.id)).size).toBe(EXAMPLES.length);
    const contributedIds = new Set(extensionExamples.map(example => example.id));
    const builtins = EXAMPLES.filter(example => !contributedIds.has(example.id));
    expect(builtins.filter((example) => example.section === 'quickstart').map((example) => example.id)).toEqual(['pricing']);
    expect(builtins.filter((example) => example.section === 'feature').map((example) => example.id))
      .toEqual(['functions', 'forms', 'statistics', 'layout', 'flow', 'tasks']);
    expect(builtins.filter((example) => example.section === 'reference').map((example) => example.id)).toEqual([]);
    expect(builtins.filter((example) => example.section === 'debug').map((example) => example.id)).toEqual(['diagnostics']);
    expect(EXAMPLES.some((example) => example.id === DEFAULT_EXAMPLE_ID)).toBe(true);
    for (const example of EXAMPLES) {
      expect(example.source.trim().length).toBeGreaterThan(0);
      expect(example.source).not.toContain('```reactive-md');
      expect(example.source).not.toContain(':::');
    }
  });

  for (const example of EXAMPLES) {
    it(`${example.id}: ${example.id === 'diagnostics' ? 'reports intentional errors' : 'compiles and starts'}`, () => {
      const result = compileLocal(example.source, { config });
      if (example.id === 'diagnostics') {
        expect(result.ok).toBe(false);
        expect(result.diagnostics.length).toBeGreaterThanOrEqual(8);
        expect(result.diagnostics.every((item) => item.line > 0 && item.column > 0)).toBe(true);
        return;
      }
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const runtime = createLocalRuntime(result.document);
      const snapshot = runtime.snapshot();
      expect(snapshot.revision).toBe(0);
      expect(snapshot.state).toBeTypeOf('object');
      expect(runtime.validate()).toEqual([]);
      for (const name of Object.keys(result.document.computations ?? {})) expect(() => runtime.evaluate(name)).not.toThrow();
      runtime.dispose();
    });
  }

  it('runs the pricing panel through its public bindings', () => {
    const result = compileLocal(exampleSource('pricing'));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    const nodes = flatten(result.document.nodes);
    const seats = nodes.find((node) => node.attrs?.bind === 'seats');
    const annual = nodes.find((node) => node.attrs?.bind === 'annual');
    expect(seats?.name).toBe('slider');
    expect(annual?.name).toBe('toggle');
    expect(runtime.get(seats!)).toBe(2);
    expect(runtime.get(annual!)).toBe(false);
    expect(runtime.set(seats!, 5)).toEqual([]);
    expect(runtime.set(annual!, true)).toEqual([]);
    expect(runtime.evaluate('seats * (annual ? 80 : 100)')).toBe(400);
    expect(runtime.text('Monthly total: {{ seats * (annual ? 80 : 100) }} USD.'))
      .toBe('Monthly total: 400 USD.');
    runtime.dispose();
  });

  it('runs checklist and counter bindings with independent reset scopes', () => {
    const checklist = compileLocal(exampleSource('tasks'));
    if (!checklist.ok) throw new Error(JSON.stringify(checklist.diagnostics));
    const checklistRuntime = createLocalRuntime(checklist.document);
    const done = flatten(checklist.document.nodes).find((node) => node.attrs?.bind === 'done');
    expect(checklistRuntime.get(done!)).toEqual(['item-1']);
    expect(checklistRuntime.set(done!, ['item-1', 'item-2', 'item-3'])).toEqual([]);
    expect(checklistRuntime.evaluate('len(done)')).toBe(3);
    const count = flatten(checklist.document.nodes).find((node) => node.attrs?.bind === 'count');
    const panel = flatten(checklist.document.nodes).find((node) => node.name === 'panel');
    checklistRuntime.set(count!, 3);
    checklistRuntime.reset(panel!);
    expect(checklistRuntime.get(done!)).toEqual(['item-1']);
    expect(checklistRuntime.get(count!)).toBe(3);
    checklistRuntime.dispose();
  });
});

describe('localized playground examples', () => {
  it('ships English and Chinese metadata and sources for every tour', () => {
    expect(EXAMPLES).toHaveLength(8 + extensionExamples.length);
    for (const example of EXAMPLES) {
      expect(example.title.trim().length, example.id).toBeGreaterThan(0);
      expect(example.hint.trim().length, example.id).toBeGreaterThan(0);
      expect(example.source.trim().length, example.id).toBeGreaterThan(0);
      expect(example.titleZh.trim().length, example.id).toBeGreaterThan(0);
      expect(example.hintZh.trim().length, example.id).toBeGreaterThan(0);
      expect(example.sourceZh.trim().length, example.id).toBeGreaterThan(0);
      expect(example.sourceZh, example.id).not.toBe(example.source);
      expect(example.titleZh, example.id).not.toBe(example.title);
      expect(example.sourceZh, example.id).not.toContain('```reactive-md');
      expect(example.sourceZh, example.id).not.toContain(':::');
    }
  });

  it('resolves English metadata and sources unchanged', () => {
    const localized = localizedExamples('en');
    expect(localized).toHaveLength(EXAMPLES.length);
    localized.forEach((example, index) => {
      const source = EXAMPLES[index];
      expect(example).toEqual({
        id: source.id,
        section: source.section,
        title: source.title,
        hint: source.hint,
        source: source.source,
      });
      expect(localizedExample(source, 'en')).toEqual(example);
    });
  });

  it('resolves Chinese metadata and sources from the same ids', () => {
    const localized = localizedExamples('zh');
    expect(localized).toHaveLength(EXAMPLES.length);
    localized.forEach((example, index) => {
      const source = EXAMPLES[index];
      expect(example).toEqual({
        id: source.id,
        section: source.section,
        title: source.titleZh,
        hint: source.hintZh,
        source: source.sourceZh,
      });
      expect(localizedExample(source, 'zh')).toEqual(example);
    });
  });

  for (const example of EXAMPLES) {
    it(`zh ${example.id}: ${example.id === 'diagnostics' ? 'reports intentional errors' : 'compiles and starts'}`, () => {
      const result = compileLocal(example.sourceZh, { config });
      if (example.id === 'diagnostics') {
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.diagnostics.length).toBeGreaterThanOrEqual(9);
        expect(result.diagnostics.every((item) => item.line > 0 && item.column > 0)).toBe(true);
        // Compiler diagnostics stay English even for Chinese documents.
        const messages = result.diagnostics.map((item) => item.message).join('\n');
        expect(messages).toMatch(/undeclared parameter seat\b/);
        return;
      }
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const runtime = createLocalRuntime(result.document);
      const snapshot = runtime.snapshot();
      expect(snapshot.revision).toBe(0);
      expect(snapshot.state).toBeTypeOf('object');
      expect(runtime.validate()).toEqual([]);
      for (const name of Object.keys(result.document.computations ?? {})) expect(() => runtime.evaluate(name)).not.toThrow();
      runtime.dispose();
    });
  }
});

describe.each(['en', 'zh'] as const)('%s feature tour outcomes', (language) => {
  it('keeps the expandable key source runnable as a small standalone example', () => {
    for (const example of EXAMPLES.filter(example => example.section === 'feature')) {
      const source = localizedExample(example, language).source.match(/```markdown\r?\n([\s\S]*?)\r?\n```/)?.[1];
      expect(source, example.id).toBeTruthy();
      const result = compileLocal(source!);
      expect(result.diagnostics, example.id).toEqual([]);
      if (!result.ok) throw new Error(example.id);
      const runtime = createLocalRuntime(result.document);
      try {
        expect(runtime.validate(), example.id).toEqual([]);
        for (const name of Object.keys(result.document.computations ?? {})) expect(() => runtime.evaluate(name), example.id).not.toThrow();
      } finally { runtime.dispose(); }
    }
  });

  function start(id: string) {
    const source = localizedExample(EXAMPLES.find((example) => example.id === id)!, language).source;
    const result = compileLocal(source);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    const nodes = flatten(result.document.nodes);
    return { source, runtime, nodes, set: (bind: string, value: LocalValue) => {
      expect(runtime.set(nodes.find((node) => node.attrs?.bind === bind)!, value)).toEqual([]);
    } };
  }

  it('matches the workshop estimate and reset described in the instructions', () => {
    const { runtime, nodes, set } = start('forms');
    try {
      const cost = 'total';
      expect(runtime.evaluate(cost)).toBe(320);
      set('format', 'online'); set('seats', 6); set('equipment', true); set('name', 'Lin');
      expect(runtime.evaluate(cost)).toBe(480);
      expect(runtime.text('{{ name }}: {{ seats }}')).toBe('Lin: 6');
      runtime.reset(nodes.find((node) => node.name === 'panel')!);
      expect(runtime.evaluate(cost)).toBe(320);
      expect(runtime.snapshot().state).toMatchObject({ name: 'Alex', seats: 4, format: 'onsite', equipment: false });
    } finally { runtime.dispose(); }
  });

  it('uses the same budget parameters for each chart and reaches the documented threshold', () => {
    const { runtime, nodes, set } = start('statistics');
    try {
      const sum = 'total';
      expect(runtime.evaluate(sum)).toBe(620);
      set('visual', 300);
      expect(runtime.evaluate(sum)).toBe(690);
      expect(runtime.evaluate(`${sum} > 690`)).toBe(false);
      set('visual', 310);
      expect(runtime.evaluate(sum)).toBe(700);
      expect(runtime.evaluate(`${sum} > 690`)).toBe(true);
      expect(runtime.evaluate('expenses[1]')).toBe(310);
      expect(runtime.evaluate('average(expenses)')).toBe(175);
      expect(runtime.evaluate('minOf(expenses)')).toBe(90);
      expect(runtime.evaluate('maxOf(expenses)')).toBe(310);
      expect(nodes.filter((node) => node.name === 'chart')).toHaveLength(3);
      expect(nodes.filter((node) => node.name === 'table')).toHaveLength(1);
    } finally { runtime.dispose(); }
  });

  it('updates flow selection and the value being explained', () => {
    const { runtime, set } = start('flow');
    try {
      set('people', 6); set('selected', 'compute');
      expect(runtime.evaluate('total')).toBe(480);
      expect(runtime.text('{{ selected }}: {{ people }} × {{ rate }} = {{ total }}')).toBe('compute: 6 × 80 = 480');
      expect(runtime.document.bindings.rate).toBeUndefined();
      expect(runtime.document.bindings.total).toBeUndefined();
    } finally { runtime.dispose(); }
  });

  it('calculates the displayed curves, including the zero-rate savings branch', () => {
    const { source, runtime, set } = start('functions');
    try {
      const plots = [...source.matchAll(/<plot[^>]*>([\s\S]*?)<\/plot>/g)];
      const formulas = plots.flatMap((plot) => [...plot[1].matchAll(/\$\$([\s\S]*?)\$\$/g)].map((match) => compileLatex(match[1])));
      set('a', 2); set('r', 0);
      const env = runtime.snapshot().state as Record<string, number>;
      expect(formulas[0].evaluate(Math.PI / 2, env)).toBeCloseTo(2);
      expect(formulas[3].evaluate(-2, env)).toBe(-4);
      expect(formulas[3].evaluate(2, env)).toBe(8);
      expect(formulas[4].evaluate(20, env)).toBe(130000);
      expect(runtime.evaluate('endingBalance')).toBe(130000);
      expect(runtime.evaluate('endingBalance - deposits')).toBe(0);
      set('r', 5);
      expect(formulas[4].evaluate(20, runtime.snapshot().state as Record<string, number>)).toBeCloseTo(232643.24, 2);
      expect(runtime.evaluate('endingBalance')).toBeCloseTo(232643.24, 2);
      const locale = language === 'zh' ? 'zh-CN' : 'en-US';
      expect(runtime.evaluate(`formatNumber(distance, 2, '${locale}')`)).toBe('2.24');
      expect(runtime.evaluate(`formatScientific(waveHeight, 2, '${locale}')`)).toBe('1.68E0');
    } finally { runtime.dispose(); }
  });

  it('keeps inconsistent workshop plans editable and clears their hints after correction', () => {
    const { runtime, set } = start('forms');
    try {
      set('name', '  Lin  ');
      expect(runtime.evaluate('organizer')).toBe('Lin');
      set('name', '   ');
      expect(runtime.evaluate('organizer')).toBe(language === 'zh' ? '你的小组' : 'Your group');
      expect(runtime.evaluate('registrationGap')).toBe(7);
      set('deadline', '2026-11-02'); set('budget', 300);
      expect(runtime.validate().map(diagnostic => diagnostic.code)).toEqual(['local.validation.failed', 'local.validation.failed']);
      expect(runtime.evaluate('registrationGap')).toBeNull();
      expect(runtime.evaluate('budget')).toBe(300);
      set('deadline', '2026-11-01'); set('budget', 320);
      expect(runtime.validate()).toEqual([]);
      expect(runtime.evaluate('registrationGap')).toBe(0);
      set('date', '');
      expect(runtime.validate()).toHaveLength(1);
    } finally { runtime.dispose(); }
  });

  it('changes reading guidance across calendar dates without consulting the system clock', () => {
    const { runtime, set } = start('layout');
    try {
      expect(runtime.evaluate('daysUntil')).toBe(8);
      expect(runtime.evaluate('readingPhase')).toBe('before');
      set('readingDate', '2026-11-01');
      expect(runtime.evaluate('readingPhase')).toBe('during');
      expect(runtime.evaluate('daysUntil')).toBe(0);
      set('readingDate', '2026-11-03');
      expect(runtime.evaluate('readingPhase')).toBe('after');
      expect(runtime.evaluate('daysUntil')).toBe(-2);
      set('readingDate', '');
      expect(runtime.evaluate('readingPhase')).toBe('undated');
      expect(runtime.evaluate('daysUntil')).toBeNull();
    } finally { runtime.dispose(); }
  });

  it('uses bounded, identity-keyed selections for preparation and reflection rows', () => {
    for (const [id, binding, values, limit] of [
      ['forms', 'subjects', ['math', 'chemistry'], '2'],
      ['tasks', 'done', ['item-1', 'item-2', 'item-3'], '3'],
    ] as const) {
      const { runtime, nodes, set } = start(id);
      try {
        const table = nodes.find(node => node.name === 'data-table')!;
        expect(table.attrs).toMatchObject({ rows: `{{ ${binding} }}`, key: '{{ item }}', 'max-rows': limit });
        set(binding, [...values]);
        expect(runtime.evaluate(binding)).toEqual(values);
        expect(runtime.evaluate(`${binding}[0]`)).toBe(values[0]);
        if (id === 'tasks') {
          expect(runtime.evaluate('readyToShare')).toBe(true);
          expect(runtime.evaluate('formatPercent(completion, 0)')).toBe('100%');
        }
        set(binding, []);
        expect(runtime.evaluate(`${binding}[0]`)).toBeNull();
      } finally { runtime.dispose(); }
    }
  });
});
