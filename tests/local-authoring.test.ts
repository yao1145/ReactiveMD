import { describe, expect, it } from 'vitest';
import {
  analyzeLocalSource,
  compileLocal,
  completeLocalSource,
  formatLocalSource,
  renameLocalBinding,
} from '../src/local';
import type {
  AuthorAnalysis,
  LocalCompileOptions,
  LocalHostComponentSchema,
  SourceRange,
} from '../src/local';
import {
  getNativeComponentCatalog,
  insertTemplate,
  renderNativeSnippet,
} from '../src/authoring';

it('can reuse an exact compiled document and omit unused authoring diagnostics', () => {
  const source='<number bind="n" label="N" initial="2">\n\nValue {{ n * 2 }}.\n\n```\n{{ literal }}\n```';
  const compiled=compileLocal(source);
  if(!compiled.ok)throw new Error('Expected valid authoring fixture');
  const full=analyzeLocalSource(source);
  expect(analyzeLocalSource(source,undefined,{document:compiled.document,diagnostics:false}))
    .toEqual({...full,diagnostics:[]});
  const edited=source.replace('n * 2','n * 3');
  expect(analyzeLocalSource(edited,undefined,{document:compiled.document,diagnostics:false}))
    .toEqual({...analyzeLocalSource(edited),diagnostics:[]});
  const invalid='<number bind="n" label="N" initial="invalid">';
  expect(analyzeLocalSource(invalid).diagnostics.length).toBeGreaterThan(0);
  expect(analyzeLocalSource(invalid,undefined,{diagnostics:false}).diagnostics).toEqual([]);
});

function slices(source: string, ranges: SourceRange[]): string[] {
  return ranges.map((range) => source.slice(range.start, range.end));
}

function tokensOf(source: string, kind: string): string[] {
  return tokensOfWithOptions(source, kind);
}

function tokensOfWithOptions(
  source: string,
  kind: string,
  options?: LocalCompileOptions,
): string[] {
  return analyzeLocalSource(source, options).tokens
    .filter((token) => token.kind === kind)
    .map((token) => source.slice(token.range.start, token.range.end));
}

function binding(analysis: AuthorAnalysis, name: string) {
  return analysis.bindings.find((item) => item.name === name);
}

function expectOrderedNonOverlapping(analysis: AuthorAnalysis): void {
  for (let index = 1; index < analysis.tokens.length; index += 1) {
    const previous = analysis.tokens[index - 1];
    const current = analysis.tokens[index];
    expect(previous.range.start).toBeLessThanOrEqual(current.range.start);
    expect(previous.range.end).toBeLessThanOrEqual(current.range.start);
    expect(previous.range.end).toBeGreaterThan(previous.range.start);
    expect(current.range.end).toBeGreaterThan(current.range.start);
  }
}

describe('analyzeLocalSource', () => {
  it('reports UTF-16 tag, attribute, string, expression and binding ranges', () => {
    const source = [
      '<number bind="seats" label="座位😀" initial="2" min="0" max="10">',
      '',
      '已有 {{ seats + 1 }} 个座位。',
      '',
      '<if when="{{ seats >= 5 }}">',
      '<alert tone="success" title="满座">',
      'Full',
      '</alert>',
      '</if>',
    ].join('\n');
    expect(compileLocal(source).diagnostics).toEqual([]);
    const analysis = analyzeLocalSource(source);
    expect(analysis.diagnostics).toEqual(compileLocal(source).diagnostics);
    expectOrderedNonOverlapping(analysis);

    const tags = tokensOf(source, 'tag');
    expect(tags).toContain('number');
    expect(tags.filter((tag) => tag === 'alert')).toHaveLength(2);
    expect(tags.filter((tag) => tag === 'if')).toHaveLength(2);
    expect(tokensOf(source, 'attribute')).toEqual(
      expect.arrayContaining(['bind', 'label', 'initial', 'min', 'max', 'when', 'tone', 'title']),
    );
    const strings = tokensOf(source, 'string');
    expect(strings).toContain('座位😀');
    expect(strings).toContain('success');
    expect(tokensOf(source, 'binding')).toEqual(['seats']);
    const expressions = tokensOf(source, 'expression');
    expect(expressions).toContain('{{ seats + 1 }}');
    expect(expressions).toContain('{{ seats >= 5 }}');

    const seats = binding(analysis, 'seats');
    expect(seats).toBeDefined();
    expect(slices(source, seats!.declarations)).toEqual(['seats']);
    expect(slices(source, seats!.references)).toEqual(['seats', 'seats']);
    for (const reference of seats!.references) {
      expect(source[reference.start - 1]).toBe(' ');
      expect(source[reference.end]).toBe(' ');
    }
  });

  it('ignores literals, code, math, comments, footnotes and escaped syntax', () => {
    const source = [
      '<input bind="name" label="{{ name }} name" placeholder="name">',
      '',
      'Plain name text.',
      '',
      '`{{ name }}`',
      '',
      '```md',
      '{{ name }}',
      '<input bind="name" label="code">',
      '```',
      '',
      '\\{{ name }} and \\<input bind="name" label="escaped">',
      '',
      '<!-- <input bind="name" label="comment"> {{ name }} -->',
      '',
      '{{ "name" + name }}',
      '',
      '$name$',
      '',
      '[^1]',
      '',
      '[^1]: <input bind="ghost" label="footnote"> {{ ghost }}',
    ].join('\n');
    expect(compileLocal(source).diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    const analysis = analyzeLocalSource(source);
    expectOrderedNonOverlapping(analysis);
    expect(analysis.bindings.map((item) => item.name)).toEqual(['name']);
    const name = binding(analysis, 'name')!;
    expect(name.declarations).toHaveLength(1);
    expect(name.references).toHaveLength(2);
    expect(slices(source, name.references)).toEqual(['name', 'name']);
    expect(tokensOf(source, 'binding')).toEqual(['name']);
    expect(tokensOf(source, 'tag')).toEqual(['input']);
    expect(tokensOf(source, 'comment').length).toBeGreaterThan(0);
    expect(tokensOf(source, 'code').length).toBeGreaterThan(0);
    expect(tokensOf(source, 'math').length).toBeGreaterThan(0);
  });

  it('handles every multi-slot bind attribute as a declaration and reference source', () => {
    const source = [
      '<range-slider label="区间" bind-start="lo" bind-end="hi">',
      '',
      '<coordinate label="坐标" bind-x="px" bind-y="py">',
      '',
      '{{ lo }} {{ hi }} {{ px }} {{ py }}',
    ].join('\n');
    expect(compileLocal(source).diagnostics).toEqual([]);
    const analysis = analyzeLocalSource(source);
    expect(analysis.bindings.map((item) => item.name)).toEqual(['lo', 'hi', 'px', 'py']);
    for (const item of analysis.bindings) {
      expect(slices(source, item.declarations)).toEqual([item.name]);
      expect(slices(source, item.references)).toEqual([item.name]);
    }
    expect(tokensOf(source, 'binding')).toEqual(['lo', 'hi', 'px', 'py']);
  });

  it('tracks plot parameters while keeping the independent variable x local', () => {
    const source = [
      '<slider bind="t" label="t" initial="1" min="0" max="5">',
      '<plot label="f" min="-10" max="{{ t }}">',
      '$$ y = x + t $$',
      '</plot>',
    ].join('\n');
    expect(compileLocal(source).diagnostics).toEqual([]);
    const analysis = analyzeLocalSource(source);
    expect(analysis.bindings.map((item) => item.name)).toEqual(['t']);
    const t = binding(analysis, 't')!;
    expect(t.references).toHaveLength(2);
    expect(slices(source, t.references)).toEqual(['t', 't']);
    expect(tokensOf(source, 'math')).toHaveLength(1);
  });

  it('returns compiler diagnostics and never declares invalid names', () => {
    const invalid = '<input bind="9bad" label="A">';
    const analysis = analyzeLocalSource(invalid);
    expect(analysis.diagnostics).toEqual(compileLocal(invalid).diagnostics);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === 'local.binding.name')).toBe(true);
    expect(analysis.bindings).toEqual([]);
    expect(tokensOf(invalid, 'binding')).toEqual([]);

    const broken = '<input bind="a" label="A">\n\n{{ a +';
    const brokenAnalysis = analyzeLocalSource(broken);
    expect(brokenAnalysis.diagnostics).toEqual(compileLocal(broken).diagnostics);
    const interpolation = brokenAnalysis.diagnostics.find((diagnostic) => diagnostic.code === 'local.interpolation');
    expect(interpolation).toBeDefined();
    expect(interpolation!.range.start).toBe(broken.indexOf('{{'));
  });
});

describe('completeLocalSource', () => {
  it('completes component names, including a typed suffix', () => {
    const source = '<num';
    const completions = completeLocalSource(source, source.length);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      label: 'number',
      insertText: 'number',
      kind: 'tag',
      range: { start: 1, end: 4 },
    });

    const withSuffix = '<number';
    const cursor = withSuffix.indexOf('num') + 3;
    const suffixCompletions = completeLocalSource(withSuffix, cursor);
    expect(suffixCompletions[0].range).toEqual({ start: 1, end: withSuffix.length });
    expect(withSuffix.slice(suffixCompletions[0].range.start, suffixCompletions[0].range.end)).toBe('number');
  });

  it('completes schema attributes without repeating typed suffixes', () => {
    const source = '<number label="A" ';
    const completions = completeLocalSource(source, source.length);
    const labels = completions.map((completion) => completion.label).filter((label) => label !== undefined);
    expect(labels).toEqual(expect.arrayContaining(['bind', 'min', 'max', 'step', 'disabled', 'initial']));
    expect(labels).not.toContain('label');
    expect(completions.every((completion) => completion.kind === 'attribute')).toBe(true);
    expect(completions.every((completion) => completion.range.start === source.length)).toBe(true);

    const partial = '<number bind="n"';
    const cursor = partial.indexOf('bi') + 2;
    const bind = completeLocalSource(partial, cursor).find((completion) => completion.label === 'bind');
    expect(bind).toBeDefined();
    expect(bind!.range).toEqual({ start: partial.indexOf('bi'), end: partial.indexOf('nd') + 2 });
    expect(partial.slice(bind!.range.start, bind!.range.end)).toBe('bind');
  });

  it('completes enum values and respects the existing suffix', () => {
    const source = '<input label="A" type="em';
    const completions = completeLocalSource(source, source.length);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ label: 'email', insertText: 'email', kind: 'value' });
    expect(completions[0].range.start).toBe(source.indexOf('em'));

    const withSuffix = '<input label="A" type="email">';
    const cursor = withSuffix.indexOf('em') + 2;
    const suffixed = completeLocalSource(withSuffix, cursor);
    expect(suffixed[0].range).toEqual({ start: withSuffix.indexOf('"email"') + 1, end: withSuffix.indexOf('"email"') + 6 });
    expect(withSuffix.slice(suffixed[0].range.start, suffixed[0].range.end)).toBe('email');
  });

  it('completes declared binding names inside interpolations', () => {
    const source = '<input bind="seats" label="A">\n\n{{ se';
    const completions = completeLocalSource(source, source.length);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ label: 'seats', insertText: 'seats', kind: 'binding' });
    expect(completions[0].range).toEqual({ start: source.indexOf('{{ se') + 3, end: source.length });

    const suffix = '<input bind="seats" label="A">\n\n{{ se' + 'ats }}';
    const cursor = suffix.indexOf('{{ se') + 5;
    const suffixed = completeLocalSource(suffix, cursor);
    expect(suffixed[0].range).toEqual({ start: suffix.indexOf('{{ se') + 3, end: suffix.indexOf('{{ seats') + 8 });
    expect(suffix.slice(suffixed[0].range.start, suffixed[0].range.end)).toBe('seats');
  });

  it('does not complete inside strings, static attributes, code or fallback regions', () => {
    const expressionString = '<input bind="seats" label="A">\n\n{{ "se';
    expect(completeLocalSource(expressionString, expressionString.length)).toEqual([]);

    const staticAttribute = '<input bind="{{ se';
    expect(completeLocalSource(staticAttribute, staticAttribute.length)).toEqual([]);

    const code = '```\n<input la\n```';
    expect(completeLocalSource(code, code.indexOf('<input la') + '<input la'.length)).toEqual([]);

    const fallback = '<widget>x</widget>';
    expect(completeLocalSource(fallback, fallback.indexOf('x'))).toEqual([]);
  });
});

describe('renameLocalBinding', () => {
  const source = [
    '<input bind="seats" label="Seats for seats">',
    '',
    'Plain seats text.',
    '',
    '`{{ seats + 1 }}`',
    '',
    '{{ "seats" + seats }}',
    '',
    '<input bind="seats" label="Also seats">',
    '',
    '<widget bind="seats">seats</widget>',
    '',
    '\\{{ seats }}',
  ].join('\n');

  it('renames declarations and real references only', () => {
    const result = renameLocalBinding(source, 'seats', 'count');
    expect(result.edits.map((edit) => source.slice(edit.range.start, edit.range.end))).toEqual(['seats', 'seats', 'seats']);
    expect(result.source).toContain('<input bind="count" label="Seats for seats">');
    expect(result.source).toContain('<input bind="count" label="Also seats">');
    expect(result.source).toContain('{{ "seats" + count }}');
    expect(result.source).toContain('Plain seats text.');
    expect(result.source).toContain('`{{ seats + 1 }}`');
    expect(result.source).toContain('<widget bind="seats">seats</widget>');
    expect(result.source).toContain('\\{{ seats }}');
    expect(result.source).not.toContain('<input bind="seats"');
  });

  it('rejects invalid names, reserved names, collisions and unknown bindings', () => {
    expect(() => renameLocalBinding(source, 'seats', '9bad')).toThrow();
    expect(() => renameLocalBinding(source, 'seats', 'min')).toThrow();
    expect(() => renameLocalBinding(source, 'seats', 'x')).toThrow();
    expect(() => renameLocalBinding(source, 'missing', 'count')).toThrow();
    const collision = '<input bind="seats" label="A">\n\n<input bind="count" label="B">';
    expect(() => renameLocalBinding(collision, 'seats', 'count')).toThrow();
  });

  it('refuses to rename when parse errors could hide references', () => {
    const broken = '<input bind="seats" label="A">\n\n{{ seats';
    expect(() => renameLocalBinding(broken, 'seats', 'count')).toThrow();
  });
});

describe('formatLocalSource', () => {
  it('normalizes whitespace inside active tags without touching literals', () => {
    const source = [
      '## Title',
      '',
      '<input   label = "Seats"   bind = \'seats\'  >',
      '',
      '{{ seats }}',
      '',
      '<panel   title = "Card" >',
      'Text',
      '</panel   >',
      '',
      '```',
      '<input label = "code">',
      '```',
    ].join('\n');
    expect(compileLocal(source).diagnostics).toEqual([]);
    const formatted = formatLocalSource(source);
    expect(formatted).toContain('<input label="Seats" bind=\'seats\'>');
    expect(formatted).toContain('<panel title="Card">');
    expect(formatted).toContain('</panel>');
    expect(formatted).toContain('```\n<input label = "code">\n```');
    expect(formatted).toContain('## Title');
    expect(formatted.split('\n')).toHaveLength(source.split('\n').length);
    expect(compileLocal(formatted).diagnostics).toEqual([]);
    expect(formatLocalSource(formatted)).toBe(formatted);
  });

  it('leaves documents with compile errors unchanged', () => {
    const broken = '<input label="A" bind="a"';
    expect(formatLocalSource(broken)).toBe(broken);
  });
});

describe('compile options', () => {
  const hostComponents: LocalHostComponentSchema[] = [
    { name: 'widget', form: 'leaf', props: { title: { kind: 'string', required: true } } },
  ];
  const hostOptions: LocalCompileOptions = { hostComponents };

  it('recognises host components in analysis and formatting', () => {
    const source = '<widget   title = "A" >';
    // Without the schema the line-leading tag is an incomplete unknown tag.
    expect(compileLocal(source).diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(compileLocal(source, hostOptions).diagnostics).toEqual([]);

    const analysis = analyzeLocalSource(source, hostOptions);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.bindings).toEqual([]);
    expect(tokensOfWithOptions(source, 'tag', hostOptions)).toEqual(['widget']);
    expect(tokensOfWithOptions(source, 'attribute', hostOptions)).toEqual(['title']);
    expect(tokensOfWithOptions(source, 'string', hostOptions)).toEqual(['A']);

    expect(formatLocalSource(source)).toBe(source);
    expect(formatLocalSource(source, hostOptions)).toBe('<widget title="A">');
  });

  it('reports syntax limits through the same diagnostics as compilation', () => {
    const source = '<input bind="a" label="A">\n\n<input bind="b" label="B">';
    const limits: LocalCompileOptions = { limits: { maxSyntaxNodes: 1 } };
    const analysis = analyzeLocalSource(source, limits);
    expect(analysis.diagnostics).toEqual(compileLocal(source, limits).diagnostics);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === 'local.budget')).toBe(true);
  });

  it('treats HTML mode as opaque for analysis, completion, rename and formatting', () => {
    const options: LocalCompileOptions = { enableExtendedHtml: true };
    const source = '<div class="card">{{ nope }}</div>';
    const analysis = analyzeLocalSource(source, options);
    expect(analysis).toEqual({
      tokens: [],
      bindings: [],
      diagnostics: compileLocal(source, options).diagnostics,
    });
    expect(completeLocalSource(source, source.indexOf('nope') + 2, options)).toEqual([]);
    expect(() => renameLocalBinding(source, 'nope', 'other', options)).toThrow(/HTML mode/);

    const spacedHtml = '<div   class = "card" >x</div>';
    expect(formatLocalSource(spacedHtml, options)).toBe(spacedHtml);
  });
});

describe('authoring entry', () => {
  it('renders a catalog template and inserts it without React UI', () => {
    const catalog = getNativeComponentCatalog('en');
    const definition = catalog.components.find((component) => component.id === 'number');
    expect(definition).toBeDefined();
    const snippet = renderNativeSnippet(definition!, '');
    expect(snippet).toContain('bind="quantity"');

    const edit = insertTemplate('', { start: 0, end: 0 }, snippet, { block: true });
    expect(edit.value).toContain('<number bind="quantity"');
    expect(edit.selection.start).toBeGreaterThan(0);
  });
});
