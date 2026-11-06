import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, type LocalNode } from '../src/index';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { MAX_LOCAL_DIAGNOSTICS } from '../src/local/limits';
import { createCompiler, CompilerConfigurationError } from '../src/compiler';
import { createStandardCompiler } from '../src/compiler/standard';
import type { Diagnostic, LocalCompileOptions, LocalDocument } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

it('keeps a normal document interactive around unsupported tags and real footnotes', () => {
  const source = '# 正文\n\n<counter bind="count" label="数量" initial="2">\n\n' +
    '前文[^note]。\n\n<slidr label="拼错" />\n\n后文：{{ count }}。\n\n[^note]: 脚注内容';
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(result.diagnostics.map(item => item.code)).toContain('local.component.unknown');
  expect(result.diagnostics.map(item => item.code)).not.toContain('local.footnote.unsupported');
  expect(result.diagnostics.every(item => item.severity === 'warning')).toBe(true);
  const runtime = createLocalRuntime(result.document);
  try {
    const counter = flatten(result.document.nodes).find(node => node.attrs?.bind === 'count')!;
    expect(runtime.set(counter, 5)).toEqual([]);
    const html = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
    expect(html).toContain('前文');
    expect(html).toContain('后文');
    expect(html).toContain('脚注内容');
    expect(html).not.toContain('[^note]');
    expect(html).toContain('&lt;slidr');
    expect(html).toContain('>5<');
  } finally {
    runtime.dispose();
  }
});

it('keeps executable-looking content inside unsupported regions inert', () => {
  const source = '<unknown-box>\n<counter bind="hidden" label="隐藏">\n{{ absent }}\n' +
    '<script>alert(1)</script>\n</unknown-box>\n\n[^note]: {{ missing }} <counter bind="secret" label="脚注控件">\n\n正文[^note]';
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(Object.keys(result.document.bindings)).toEqual([]);
  const runtime = createLocalRuntime(result.document);
  try {
    const html = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
    expect(html).toContain('{{ absent }}');
    expect(html).toContain('{{ missing }}');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('local-inactive');
  } finally {
    runtime.dispose();
  }
});

it.each(['<card>', '<counter label="计数" onclick="bad">', '{{ missing }}'])('keeps real errors fatal after the warning budget is full: %s', invalid => {
  const result = compileLocal('<unknown />\n\n'.repeat(MAX_LOCAL_DIAGNOSTICS + 1) + invalid);
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some(item => item.severity === 'error')).toBe(true);
  expect(result.diagnostics.length).toBeLessThanOrEqual(MAX_LOCAL_DIAGNOSTICS);
});

it('keeps a footnote inside an indented card inert before lexical validation', () => {
  const source = '<card>\n  正文[^note]\n\n  [^note]: {{ missing }} <counter bind="secret" label="脚注">\n</card>';
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(Object.keys(result.document.bindings)).toEqual([]);
  expect(result.diagnostics.map(item => item.code)).not.toContain('local.footnote.unsupported');
  expect(flatten(result.document.nodes).some(node => node.type === 'footnoteReference')).toBe(true);
  expect(flatten(result.document.nodes).some(node => node.type === 'footnoteDefinition')).toBe(true);
});

it.each(['', '    '])('shields a footnote immediately inside a container with indentation %j', indent => {
  const source = `<card>\n${indent}[^note]: {{ broken <slider onClick="bad">\n</card>\n\n后文`;
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(Object.keys(result.document.bindings)).toEqual([]);
  expect(result.diagnostics.map(item => item.code)).not.toContain('local.footnote.unsupported');
  expect(flatten(result.document.nodes).some(node => node.type === 'footnoteDefinition')).toBe(true);
});

/* ------------------------------------------------------------------ */
/* Roadmap task 2: strict option, local recovery and the M0 contract   */
/* ------------------------------------------------------------------ */

type SourceRange = { start: number; end: number };
type RecoveryAction = 'html-repair' | 'literal-fallback';
type RecoveryBoundary = 'token' | 'fragment' | 'container-end' | 'heading' | 'eof';

interface AcceptanceRecovery {
  code: string;
  causeRange: SourceRange;
  affectedRange: SourceRange;
  action: RecoveryAction;
  boundary: RecoveryBoundary;
}

/**
 * The post-task-2 result surface. `compileLocal` keeps its historical shape
 * and may add `recoveries`; the single-pass entries add `status`, `program`,
 * `checks` and `recoveries` while keeping `ok`/`document` aliases.
 */
interface AcceptanceResult {
  ok: boolean;
  status?: 'valid' | 'recovered' | 'failed';
  document?: LocalDocument;
  program?: Readonly<LocalDocument>;
  diagnostics: Diagnostic[];
  recoveries?: readonly AcceptanceRecovery[];
  checks?: unknown;
}

const RECOVERY_ACTIONS: readonly RecoveryAction[] = ['html-repair', 'literal-fallback'];
const RECOVERY_BOUNDARIES: readonly RecoveryBoundary[] = ['token', 'fragment', 'container-end', 'heading', 'eof'];

const relaxedOptions = { strict: false } as unknown as LocalCompileOptions;
const strictOptions = { strict: true } as unknown as LocalCompileOptions;

const acceptance = (result: unknown): AcceptanceResult => result as AcceptanceResult;

/** Assert the common recovered envelope and return its recovery records. */
function recovered(result: AcceptanceResult): readonly AcceptanceRecovery[] {
  expect(result.ok).toBe(true);
  expect(result.status).toBe('recovered');
  expect(result.document).toBeDefined();
  expect(Array.isArray(result.recoveries)).toBe(true);
  expect(result.recoveries!.length).toBeGreaterThan(0);
  for (const recovery of result.recoveries!) {
    expect(recovery.code.length).toBeGreaterThan(0);
    expect(RECOVERY_ACTIONS).toContain(recovery.action);
    expect(RECOVERY_BOUNDARIES).toContain(recovery.boundary);
    expect(recovery.causeRange.start).toBeGreaterThanOrEqual(0);
    expect(recovery.causeRange.end).toBeGreaterThan(recovery.causeRange.start);
    expect(recovery.affectedRange.start).toBeGreaterThanOrEqual(0);
    expect(recovery.affectedRange.start).toBeLessThanOrEqual(recovery.affectedRange.end);
    expect(recovery.affectedRange.end).toBeLessThanOrEqual(result.document!.source.length);
  }
  return result.recoveries!;
}

function renderResult(result: AcceptanceResult): string {
  expect(result.ok).toBe(true);
  const document = result.document!;
  const runtime = createLocalRuntime(document);
  try {
    return renderToStaticMarkup(<LocalDocumentView document={document} runtime={runtime} />);
  } finally {
    runtime.dispose();
  }
}

/** Recovery never inserts a visible error block into the document. */
function expectNoRecoveryChrome(html: string): void {
  expect(html).not.toContain('local-error');
  expect(html).not.toContain('recovery-error');
}

const codesOf = (result: AcceptanceResult): string[] => result.diagnostics.map(item => item.code);

describe('roadmap task 2: strict default and result envelope', () => {
  it('defaults strict to true and keeps the existing strict failure for a missing close', () => {
    const source = '# 标题\n\n<alert title="提示">\n正文\n';
    const legacyDefault = acceptance(compileLocal(source));
    const legacyStrict = acceptance(compileLocal(source, strictOptions));

    expect(legacyDefault.ok).toBe(false);
    expect(legacyDefault.document).toBeUndefined();
    expect(codesOf(legacyDefault)).toContain('local.tag.unclosed');
    expect(legacyDefault.recoveries ?? []).toEqual([]);

    expect(legacyStrict.ok).toBe(legacyDefault.ok);
    expect(legacyStrict.diagnostics).toEqual(legacyDefault.diagnostics);
    expect(legacyStrict.recoveries ?? []).toEqual([]);

    const standardDefault = acceptance(createStandardCompiler().compile(source));
    const standardStrict = acceptance(createStandardCompiler(strictOptions).compile(source));
    for (const result of [standardDefault, standardStrict]) {
      expect(result.status).toBe('failed');
      expect(result.ok).toBe(false);
      expect(result.document).toBeUndefined();
      expect(result.program).toBeUndefined();
      expect(codesOf(result)).toContain('local.tag.unclosed');
      expect(result.recoveries ?? []).toEqual([]);
    }
    expect(standardStrict.diagnostics).toEqual(standardDefault.diagnostics);
  });

  it('leaves existing strict documents byte-for-byte compatible', () => {
    const source = '# 标题\n\n<counter bind="count" label="计数" initial="2">\n\n{{ count }}';
    const legacyDefault = compileLocal(source);
    const legacyStrict = compileLocal(source, strictOptions);
    expect(legacyStrict.ok).toBe(legacyDefault.ok);
    expect(legacyStrict.diagnostics).toEqual(legacyDefault.diagnostics);
    expect(legacyStrict.ok ? legacyStrict.document : undefined)
      .toEqual(legacyDefault.ok ? legacyDefault.document : undefined);
  });

  it('rejects a non-boolean strict value at factory creation', () => {
    const invalid = { strict: 'yes' } as unknown as LocalCompileOptions;
    expect(() => createStandardCompiler(invalid)).toThrow(CompilerConfigurationError);
    expect(() => createCompiler(invalid)).toThrow(CompilerConfigurationError);
  });

  it('reports valid results with an aliased, deep-read-only program and checks', () => {
    const source = '# 标题\n\n<counter bind="count" label="计数" initial="2">\n\n{{ count }}';
    const result = acceptance(createStandardCompiler().compile(source));
    expect(result.status).toBe('valid');
    expect(result.ok).toBe(true);
    expect(result.recoveries).toEqual([]);
    expect(result.checks).toBeTypeOf('object');

    const program = result.program!;
    expect(program).toBeDefined();
    expect(result.document).toEqual(program);
    expect(result.document).not.toBe(program);
    expect(Object.isFrozen(program)).toBe(true);
    expect(Object.isFrozen(program.nodes)).toBe(true);
    for (const node of program.nodes) expect(Object.isFrozen(node)).toBe(true);
    expect(result.document!.initialState.count).toBe(2);
  });

  it('applies the same envelope to the minimal compiler', () => {
    const result = acceptance(createCompiler().compile('# 标题\n\n正文'));
    expect(result.status).toBe('valid');
    expect(result.ok).toBe(true);
    expect(result.recoveries).toEqual([]);
    expect(result.program).toEqual(result.document);
    expect(result.program).not.toBe(result.document);
    expect(result.checks).toBeTypeOf('object');
  });
});

describe('roadmap task 2: M0 recovery groups', () => {
  it('recovers a missing close at a following same-level ATX heading with exact UTF-16 ranges', () => {
    const source = '😀前文\r\n\r\n<alert title="提示">\r\n内部 **文本** {{ 1 + 1 }}\r\n\r\n## 后续章节\r\n\r\n后文 😀\r\n';
    const alertStart = source.indexOf('<alert');
    const alertTagEnd = source.indexOf('>', alertStart) + 1;
    const headingStart = source.indexOf('## 后续章节');

    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    const [recovery] = recovered(result);
    expect(result.recoveries).toHaveLength(1);
    expect(recovery.action).toBe('literal-fallback');
    expect(recovery.boundary).toBe('heading');
    expect(recovery.causeRange).toEqual({ start: alertStart, end: alertTagEnd });
    expect(source.slice(recovery.causeRange.start, recovery.causeRange.end)).toBe('<alert title="提示">');
    expect(recovery.affectedRange).toEqual({ start: alertStart, end: headingStart });
    const degraded = source.slice(recovery.affectedRange.start, recovery.affectedRange.end);
    expect(degraded.startsWith('<alert')).toBe(true);
    expect(degraded).toContain('内部 **文本** {{ 1 + 1 }}');
    expect(degraded).not.toContain('## 后续章节');
    expect(codesOf(result)).not.toContain('local.tag.unclosed');
    expect(codesOf(result)).not.toContain('local.tag.mismatch');

    const html = renderResult(result);
    expect(html).toContain('&lt;alert');
    expect(html).toContain('内部 **文本** {{ 1 + 1 }}');
    expect(html).toContain('后续章节');
    expect(html).toContain('后文 😀');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('local-alert');
    expect(html).not.toContain('>2<');
    expectNoRecoveryChrome(html);
  });

  it('lets an outer close reclaim an unclosed inner component', () => {
    const source = '<card title="外层">\n<alert title="内层">\n内部文字\n</card>\n\n后文';
    const cardStart = source.indexOf('<card');
    const alertStart = source.indexOf('<alert');
    const alertTagEnd = source.indexOf('>', alertStart) + 1;
    const cardCloseStart = source.indexOf('</card>');

    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    const [recovery] = recovered(result);
    expect(result.recoveries).toHaveLength(1);
    expect(recovery.action).toBe('literal-fallback');
    expect(recovery.boundary).toBe('container-end');
    expect(recovery.causeRange).toEqual({ start: alertStart, end: alertTagEnd });
    expect(recovery.affectedRange).toEqual({ start: alertStart, end: cardCloseStart });

    const all = flatten(result.document!.nodes);
    const card = all.find(node => node.name === 'card');
    expect(card).toBeDefined();
    expect(card!.range.start).toBe(cardStart);
    expect(source.slice(card!.range.start, card!.range.end)).toContain('</card>');
    expect(all.some(node => node.name === 'alert')).toBe(false);

    const html = renderResult(result);
    expect(html).toContain('外层');
    expect(html).toContain('&lt;alert');
    expect(html).toContain('内部文字');
    expect(html).toContain('后文');
    expectNoRecoveryChrome(html);
  });

  it('prefers a legal closing tag across an inner heading instead of truncating', () => {
    const source = '<alert title="跨标题">\n\n内部段落\n\n## 内部标题\n\n更多\n</alert>\n\n' +
      '<counter bind="shown" label="显示" initial="1">\n\n{{ shown }}';
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('valid');
    expect(result.recoveries).toEqual([]);

    const all = flatten(result.document!.nodes);
    const alert = all.find(node => node.name === 'alert');
    expect(alert).toBeDefined();
    expect(flatten(alert!.children ?? []).some(node => node.type === 'heading')).toBe(true);
    expect(result.document!.bindings.shown).toBeDefined();

    const html = renderResult(result);
    expect(html).toContain('跨标题');
    expect(html).toContain('内部标题');
    expect(html).toContain('更多');
    expect(html).toContain('aria-label="显示 increase"');
    expectNoRecoveryChrome(html);
  });

  it('does not execute interpolation, controls or computations inside the degraded region', () => {
    const source = '<alert title="警示">\n{{ hidden }}\n<counter bind="secret" label="秘密" initial="1">\n' +
      '<computed name="calc" value="{{ 1 + 1 }}">\n\n## 后续\n\n' +
      '<counter bind="shown" label="显示" initial="2">\n\n{{ shown }}';
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    recovered(result);
    expect(Object.keys(result.document!.bindings)).toEqual(['shown']);
    expect(result.document!.computations?.calc).toBeUndefined();

    const runtime = createLocalRuntime(result.document!);
    try {
      expect(runtime.parameterNames()).toEqual(['shown']);
      expect(runtime.snapshot().state).toEqual({ shown: 2 });
    } finally {
      runtime.dispose();
    }

    const html = renderResult(result);
    expect(html).toContain('&lt;counter');
    expect(html).toContain('{{ hidden }}');
    expect(html).not.toContain('aria-label="秘密 increase"');
    expect(html).toContain('aria-label="显示 increase"');
    expectNoRecoveryChrome(html);
  });

  it('degrades only an isolated closing tag', () => {
    const source = '前文\n\n</alert>\n\n后文';
    const start = source.indexOf('</alert>');
    const end = start + '</alert>'.length;
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    const [recovery] = recovered(result);
    expect(result.recoveries).toHaveLength(1);
    expect(recovery.action).toBe('literal-fallback');
    expect(recovery.boundary).toBe('token');
    expect(recovery.causeRange).toEqual({ start, end });
    expect(recovery.affectedRange).toEqual({ start, end });
    expect(source.slice(start, end)).toBe('</alert>');

    const html = renderResult(result);
    expect(html).toContain('&lt;/alert&gt;');
    expect(html).toContain('前文');
    expect(html).toContain('后文');
    expectNoRecoveryChrome(html);
  });

  it('falls back to EOF when no reliable sync point exists', () => {
    const source = '<alert>\n只有正文\n没有标题';
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    const [recovery] = recovered(result);
    expect(result.recoveries).toHaveLength(1);
    expect(recovery.action).toBe('literal-fallback');
    expect(recovery.boundary).toBe('eof');
    expect(recovery.causeRange).toEqual({ start: 0, end: '<alert>'.length });
    expect(recovery.affectedRange).toEqual({ start: 0, end: source.length });

    const html = renderResult(result);
    expect(html).toContain('&lt;alert&gt;');
    expect(html).toContain('只有正文');
    expectNoRecoveryChrome(html);
  });

  it('ignores headings inside fences, comments and raw pre text when resyncing', () => {
    const source = [
      '<alert title="提示">',
      '内部',
      '',
      '```md',
      '## 代码标题',
      '```',
      '',
      '<!-- 注释',
      '## 注释标题',
      '-->',
      '',
      '<pre>',
      '## 预格式标题',
      '</pre>',
      '',
      '## 真正标题',
      '',
      '后文',
    ].join('\n');
    const headingStart = source.indexOf('## 真正标题');
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    const [recovery] = recovered(result);
    expect(result.recoveries).toHaveLength(1);
    expect(recovery.boundary).toBe('heading');
    expect(recovery.affectedRange).toEqual({ start: 0, end: headingStart });
    const degraded = source.slice(recovery.affectedRange.start, recovery.affectedRange.end);
    expect(degraded).toContain('## 代码标题');
    expect(degraded).toContain('## 注释标题');
    expect(degraded).toContain('## 预格式标题');
    expect(degraded).not.toContain('## 真正标题');

    const html = renderResult(result);
    expect(html).toContain('## 代码标题');
    expect(html).toContain('## 注释标题');
    expect(html).toContain('## 预格式标题');
    expect(html).toContain('真正标题');
    expect(html).toContain('后文');
    expect(html).not.toContain('<pre');
    expectNoRecoveryChrome(html);
  });

  it('uses the outer container boundary when an attribute quote never closes', () => {
    const source = '<card title="外层">\n<alert title="未结束\n内部\n</card>\n\n后文';
    const cardStart = source.indexOf('<card');
    const alertStart = source.indexOf('<alert');
    const cardCloseStart = source.indexOf('</card>');
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    const [recovery] = recovered(result);
    expect(result.recoveries).toHaveLength(1);
    expect(recovery.action).toBe('literal-fallback');
    expect(recovery.boundary).toBe('container-end');
    expect(recovery.causeRange.start).toBe(alertStart);
    expect(recovery.causeRange.end).toBeLessThanOrEqual(cardCloseStart);
    expect(recovery.affectedRange).toEqual({ start: alertStart, end: cardCloseStart });

    const card = flatten(result.document!.nodes).find(node => node.name === 'card');
    expect(card).toBeDefined();
    expect(card!.range.start).toBe(cardStart);
    const html = renderResult(result);
    expect(html).toContain('外层');
    expect(html).toContain('&lt;alert');
    expect(html).toContain('后文');
    expectNoRecoveryChrome(html);
  });

  it('does not treat a heading in another Markdown container as a sync point', () => {
    const source = '<alert>\n正文\n\n> ## 引用标题\n\n后文';
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    const [recovery] = recovered(result);
    expect(result.recoveries).toHaveLength(1);
    expect(recovery.boundary).toBe('eof');
    expect(recovery.affectedRange).toEqual({ start: 0, end: source.length });
    const html = renderResult(result);
    expect(html).not.toContain('<h2');
    expect(html).toContain('&lt;alert&gt;');
    expect(html).toContain('引用标题');
    expectNoRecoveryChrome(html);
  });

  it('recovers an unregistered line-leading tag through the same recovery whitelist', () => {
    const source = '<widget-x>\n内容\n\n## 后续\n\n后文';
    const strictResult = acceptance(compileLocal(source, strictOptions));
    expect(strictResult.ok).toBe(false);
    expect(codesOf(strictResult)).toContain('local.tag.unclosed');

    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    const [recovery] = recovered(result);
    expect(recovery.action).toBe('literal-fallback');
    expect(recovery.affectedRange.start).toBe(0);
    const degraded = source.slice(recovery.affectedRange.start, recovery.affectedRange.end);
    expect(degraded).toContain('<widget-x>');
    expect(degraded).toContain('内容');

    const html = renderResult(result);
    expect(html).toContain('&lt;widget-x');
    expect(html).toContain('后续');
    expect(html).toContain('后文');
    expectNoRecoveryChrome(html);
  });

  it('keeps tags and interpolations inside code literal without recovery noise', () => {
    const source = '# 代码\n\n`<alert>`\n\n```html\n<alert>\n{{ 1 + 1 }}\n```\n\n正文。';
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('valid');
    expect(result.recoveries).toEqual([]);
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([]);

    const html = renderResult(result);
    expect(html).toContain('&lt;alert&gt;');
    expect(html).toContain('{{ 1 + 1 }}');
    expect(html).toContain('正文。');
    expectNoRecoveryChrome(html);
  });

  it('orders and deduplicates recovery records', () => {
    const source = '<alert title="一">\n第一\n\n## 章节一\n\n<alert title="二">\n第二\n\n## 章节二\n\n结尾';
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    expect(recovered(result)).toHaveLength(2);
    const records = result.recoveries!;
    expect(records[0].affectedRange.start).toBeLessThan(records[1].affectedRange.start);
    expect(records[0].causeRange.start).toBeLessThan(records[1].causeRange.start);
    const keys = records.map(item =>
      `${item.code}:${item.causeRange.start}-${item.causeRange.end}:${item.affectedRange.start}-${item.affectedRange.end}`);
    expect(new Set(keys).size).toBe(keys.length);
    const sorted = [...records].sort((a, b) =>
      a.causeRange.start - b.causeRange.start
      || a.causeRange.end - b.causeRange.end
      || a.affectedRange.start - b.affectedRange.start
      || a.affectedRange.end - b.affectedRange.end
      || a.code.localeCompare(b.code));
    expect(records).toEqual(sorted);

    const html = renderResult(result);
    expect(html).toContain('章节一');
    expect(html).toContain('章节二');
    expect(html).toContain('结尾');
    expectNoRecoveryChrome(html);
  });
});

describe('roadmap task 2: recovery interacts with semantics, budgets and HTML', () => {
  it('keeps semantic failures fatal while retaining prior recoveries', () => {
    expect.hasAssertions();
    const cases: [string, string, string][] = [
      ['unknown binding', '{{ missing }}', 'local.binding.unknown'],
      ['illegal initial value', '<number bind="n" label="N" initial="abc">', 'local.initial'],
      ['computation cycle', '<computed name="a" value="{{ b }}">\n<computed name="b" value="{{ a }}">', 'local.computation.cycle'],
    ];
    for (const [label, tail, code] of cases) {
      const source = `<alert title="提示">\n内部\n\n## 后续\n\n${tail}`;
      const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
      expect(result.ok, label).toBe(false);
      expect(result.status, label).toBe('failed');
      expect(result.document, label).toBeUndefined();
      expect(result.program, label).toBeUndefined();
      expect(result.diagnostics.some(item => item.severity === 'error' && item.code.startsWith(code)), label).toBe(true);
      expect((result.recoveries ?? []).length, label).toBeGreaterThan(0);
    }
  });

  it('keeps a reference to a declaration revoked inside the degraded region fatal', () => {
    const source = '<alert title="提示">\n<external name="rate" type="number">\n\n## 后续\n\n{{ rate }}';
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.document).toBeUndefined();
    expect(codesOf(result)).toContain('local.binding.unknown');
    expect((result.recoveries ?? []).length).toBeGreaterThan(0);
  });

  it('keeps version failures fatal in relaxed mode', () => {
    const source = '<!-- reactive-md: local-draft-99 -->\n\n<alert>\n内部\n\n## 后续\n\n后文';
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.document).toBeUndefined();
    expect(codesOf(result)).toContain('local.version.unsupported');
    expect(Array.isArray(result.recoveries ?? [])).toBe(true);
  });

  it('does not let degradation bypass the parse-work budget', () => {
    const options = { strict: false, limits: { maxParseWork: 20 } } as unknown as LocalCompileOptions;
    const source = '<alert>\n' + '正文内容'.repeat(200);
    const result = acceptance(createStandardCompiler(options).compile(source));
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.diagnostics.some(item => item.code.startsWith('local.budget'))).toBe(true);
    expect(Array.isArray(result.recoveries ?? [])).toBe(true);
  });

  it('restores an interactive component after the closing tag is supplied', () => {
    const broken = '<alert title="提示">\n\n<counter bind="count" label="计数" initial="1">\n\n内部';
    const fixed = broken + '\n\n</alert>';

    const brokenResult = acceptance(createStandardCompiler(relaxedOptions).compile(broken));
    const [recovery] = recovered(brokenResult);
    expect(recovery.boundary).toBe('eof');
    expect(brokenResult.document!.bindings.count).toBeUndefined();

    const fixedResult = acceptance(createStandardCompiler(relaxedOptions).compile(fixed));
    expect(fixedResult.ok).toBe(true);
    expect(fixedResult.status).toBe('valid');
    expect(fixedResult.recoveries).toEqual([]);
    expect(fixedResult.document!.bindings.count.initial).toBe(1);

    const runtime = createLocalRuntime(fixedResult.document!);
    try {
      expect(runtime.setParameter('count', 3)).toEqual([]);
      expect(runtime.getParameter('count')).toBe(3);
      const html = renderToStaticMarkup(<LocalDocumentView document={fixedResult.document!} runtime={runtime} />);
      expect(html).toContain('local-alert');
      expect(html).toContain('aria-label="计数 increase"');
      expectNoRecoveryChrome(html);
    } finally {
      runtime.dispose();
    }
  });

  it('repairs omitted native HTML tags inside the fragment and keeps the article outside', () => {
    const source = '# 前文\n\n<p>第一段\n<p>第二段\n\n## 后文\n\n结尾';
    const firstStart = source.indexOf('<p>');
    const secondStart = source.indexOf('<p>', firstStart + 3);
    const headingStart = source.indexOf('## 后文');
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    const [recovery] = recovered(result);
    expect(recovery.action).toBe('html-repair');

    const all = flatten(result.document!.nodes);
    const first = all.find(node => node.type === 'paragraph' && node.range.start === firstStart);
    const second = all.find(node => node.type === 'paragraph' && node.range.start === secondStart);
    expect(first, 'the first repaired paragraph keeps its real source offset').toBeDefined();
    expect(second, 'the synthesized paragraph keeps the real second tag offset').toBeDefined();
    expect(second!.range.end).toBeLessThanOrEqual(headingStart);

    const html = renderResult(result);
    expect(html).toContain('第一段');
    expect(html).toContain('第二段');
    expect(html).toContain('前文');
    expect(html).toContain('后文');
    expect(html).toContain('结尾');
    expect(html).not.toContain('&lt;p');
    expect(html).not.toContain('&lt;/p');
    expectNoRecoveryChrome(html);
  });

  it('never activates mixed RMD content through HTML repair', () => {
    const source = '<div>\n<counter bind="hidden" label="隐藏" initial="1">\n\n## 后续\n\n正文';
    const result = acceptance(createStandardCompiler(relaxedOptions).compile(source));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('recovered');
    expect((result.recoveries ?? []).length).toBeGreaterThan(0);
    expect(result.document!.bindings.hidden).toBeUndefined();

    const html = renderResult(result);
    expect(html).not.toContain('aria-label="隐藏 increase"');
    expect(html).toContain('后续');
    expect(html).toContain('正文');
    expectNoRecoveryChrome(html);
  });
});
