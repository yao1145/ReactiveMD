import { describe, expect, it, vi } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { CompilerConfigurationError, createCompiler } from '../src/compiler/index';
import { createStandardCompiler } from '../src/compiler/standard';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent } from '../src/sdk/manifest';
import type { LocalCompileOptions, LocalCompileResult, LocalNode } from '../src/local/contracts/types';

function flatten(nodes: readonly LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

/**
 * Node ids are parser allocation details. Map every `local-N` id, including
 * ids used as object keys or inside `nodeIds`, to document order so two
 * compilations of the same source compare semantically.
 */
function canonicalize(value: unknown): unknown {
  const ids = new Map<string, string>();
  const id = (key: string): string => {
    if (!/^local-\d+$/.test(key)) return key;
    let mapped = ids.get(key);
    if (mapped === undefined) {
      mapped = `node-${ids.size}`;
      ids.set(key, mapped);
    }
    return mapped;
  };
  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') return id(input);
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input)) output[id(key)] = walk(item);
      return output;
    }
    return input;
  };
  return walk(value);
}

function compatibilityResult(result: ReturnType<ReturnType<typeof createStandardCompiler>['compile']>): LocalCompileResult {
  const recoveries = result.recoveries.length ? { recoveries: [...result.recoveries] } : {};
  return result.ok
    ? { ok: true, document: result.document, diagnostics: result.diagnostics, ...recoveries }
    : { ok: false, diagnostics: result.diagnostics, ...recoveries };
}

const STRICT_CORPUS: string[] = [
  '# Heading\n\nA **bold** paragraph with a [link](https://example.com).',
  '<number bind="count" label="Count" min="0" max="10" initial="2">\n\nValue: {{ count }}',
  '<const name="rate" value="{{ 12.5 }}">\n<computed name="double" value="{{ rate * 2 }}">\n\nTotal: {{ double }}',
  '<toggle bind="on" label="On">\n\n<if when="{{ on }}">\nVisible\n</if>',
  '<theme name="paper">\n\n# Paper',
  '$$\n\\frac{a}{b}\n$$',
  ['$$', String.raw`\href{https://example.com}{x}`, '$$'].join('\n'),
  '<number bind="count" label="Count" max="{{ missing }}">',
  '<alert>\nUnclosed alert',
  '<number bind="count" label="Count">\n\n</toggle>',
];

describe('minimal compiler entry', () => {
  it('compiles plain Markdown without a default component preset', () => {
    const result = createCompiler().compile('# Title\n\nA **bold** word.');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nodes = flatten(result.document.nodes);
    expect(nodes.some((node) => node.type === 'heading')).toBe(true);
    expect(nodes.some((node) => node.type === 'strong')).toBe(true);
    expect(result.document.theme).toBe('default');
  });

  it('keeps declarations and expressions but does not register default controls', () => {
    const compiler = createCompiler();
    const declarations = compiler.compile(
      '<const name="rate" value="{{ 12.5 }}">\n<computed name="double" value="{{ rate * 2 }}">\n\n# Total',
    );
    expect(declarations.ok).toBe(true);
    if (declarations.ok) {
      expect(declarations.document.computations?.rate).toMatchObject({ kind: 'const', type: 'number', value: 12.5 });
      expect(declarations.document.computations?.double).toMatchObject({ kind: 'computed', type: 'number' });
      expect(declarations.document.initialState).toEqual({});
    }

    const control = compiler.compile('<number bind="count" label="Count" />');
    expect(control.ok).toBe(true);
    expect(control.diagnostics.some((item) => item.code === 'local.component.unknown')).toBe(true);
    if (control.ok) expect(control.document.bindings).toEqual({});
  });

  it('reports expression errors through the old result shape', () => {
    const result = createCompiler().compile('<computed name="value" value="{{ missing }}">');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((item) => item.code.startsWith('local.computation'))).toBe(true);
    }
  });

  it('enforces the configured syntax budget', () => {
    expect(createCompiler({ limits: { maxSyntaxNodes: 1 } }).compile('hello').ok).toBe(false);
    expect(createCompiler({ limits: { maxSyntaxNodes: 2 } }).compile('hello').ok).toBe(true);
  });

  it('returns source errors instead of throwing', () => {
    const compiler = createCompiler();
    expect(() => compiler.compile('<number bind="count">')).not.toThrow();
    expect(compiler.compile('<number bind="count">').ok).toBe(false);
    const nonString = compiler.compile(42 as unknown as string);
    expect(nonString.ok).toBe(false);
    expect(nonString.diagnostics.length).toBeGreaterThan(0);
  });

  it('accepts a pure theme name declaration', () => {
    const result = createCompiler().compile('<theme name="paper">\n\n# Paper');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.theme).toBe('paper');
  });

  it('snapshots factory options and keeps compilations independent', () => {
    const limits = { maxSyntaxNodes: 2 };
    const options: LocalCompileOptions = { limits };
    const compiler = createCompiler(options);
    expect(compiler.compile('hello').ok).toBe(true);
    limits.maxSyntaxNodes = 1;
    expect(compiler.compile('hello').ok).toBe(true);

    const first = compiler.compile('# Same');
    const second = compiler.compile('# Same');
    expect(first.ok && second.ok).toBe(true);
    expect(first).not.toBe(second);
    if (first.ok && second.ok) {
      expect(first.document).not.toBe(second.document);
      first.document.nodes.length = 0;
      expect(second.document.nodes.length).toBeGreaterThan(0);
      expect(compiler.compile('# Same').ok).toBe(true);
    }
  });

  it('does not schedule timers while compiling', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    try {
      expect(createCompiler().compile('# Immediate').ok).toBe(true);
      expect(timeout).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
      interval.mockRestore();
    }
  });

  it('throws CompilerConfigurationError for invalid factory options', () => {
    expect(() => createCompiler({ limits: { maxSyntaxNodes: 0 } })).toThrow(CompilerConfigurationError);
    expect(() => createCompiler(42 as unknown as LocalCompileOptions)).toThrow(CompilerConfigurationError);
    expect(() => createCompiler({ markdownBreaks: 'yes' } as unknown as LocalCompileOptions)).toThrow(CompilerConfigurationError);
    try {
      createCompiler({ limits: { maxSyntaxNodes: 0 } });
    } catch (error) {
      expect(error).toBeInstanceOf(CompilerConfigurationError);
      expect((error as Error).name).toBe('CompilerConfigurationError');
      expect((error as Error).message.length).toBeGreaterThan(0);
    }
  });
});

describe('standard compiler entry', () => {
  it('validates and snapshots external component semantics for both factories', () => {
    const rating = defineLocalComponent({
      id: 'example/rating', name: 'rating', version: '1.0.0',
      protocol: 'reactive-md-component/v1', form: 'leaf',
      props: { max: { kind: 'number', default: 5, min: 1, max: 10, integer: true } },
      bindings: { value: {
        kind: 'number', family: 'number', bind: 'bind', initial: 'initial', initialRule: 'nearest-zero',
        constraints: { min: { literal: 0 }, max: { prop: 'max' }, step: { literal: 1 } },
      } },
      capabilities: { interactive: true, static: true, ssr: true, offline: true },
    });
    const config = createLocalConfig({ components: [rating] });
    const raw = JSON.parse(JSON.stringify(config));
    raw.key = 'forged';
    raw.registry = [];
    const minimal = createCompiler({ config: raw });
    const standard = createStandardCompiler({ config: raw });
    raw.components[0].props.max.default = 1;
    const source = '<rating bind="score" initial="3">\n\n{{ score }}';
    const result = minimal.compile(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.bindings.score).toMatchObject({ initial: 3, max: 5 });
    expect(compatibilityResult(standard.compile(source))).toEqual(compileLocal(source, { config }));
    expect(minimal.compile('<rating bind="score" initial="8">').ok).toBe(false);
  });

  it('uses the same semantic identity with or without host theme assets', () => {
    const config = createLocalConfig();
    const source = '<number bind="count" label="Count" initial="2">';
    const ordinary = createStandardCompiler({ config }).compile(source);
    expect(ordinary.ok).toBe(true);
    const themed = createStandardCompiler({ config: {
      ...config,
      themes: [{ id: 'host-only', css: 'host-owned resource' }],
    } as unknown as typeof config }).compile(source);
    expect(themed).toEqual(ordinary);
    expect(compatibilityResult(ordinary)).toEqual(compileLocal(source, { config }));
  });

  it('keys the minimal assembly independently of the standard preset', () => {
    const config = createLocalConfig();
    const minimal = createCompiler().compile('# Title');
    const configured = createCompiler({ config }).compile('# Title');
    const standard = createStandardCompiler({ config }).compile('# Title');
    expect(minimal.ok && configured.ok && standard.ok).toBe(true);
    if (minimal.ok && configured.ok && standard.ok) {
      expect(configured.document.componentConfigKey).toBe(minimal.document.componentConfigKey);
      expect(configured.document.componentConfigKey).not.toBe(standard.document.componentConfigKey);
    }
  });

  it('registers the default components and keeps the math precheck', () => {
    const compiler = createStandardCompiler();
    const control = compiler.compile('<number bind="count" label="Count" min="0" max="5" initial="2">');
    expect(control.ok).toBe(true);
    if (control.ok) {
      expect(control.document.bindings.count).toMatchObject({ type: 'number', initial: 2, min: 0, max: 5 });
      expect(flatten(control.document.nodes).some((node) => node.name === 'number')).toBe(true);
    }

    const display = compiler.compile(['$$', String.raw`\href{https://example.com}{x}`, '$$'].join('\n'));
    expect(display.ok).toBe(true);
    expect(display.diagnostics.some((item) => item.code === 'local.math.display' && item.severity === 'warning')).toBe(true);

    const validMath = compiler.compile(['$$', String.raw`\frac{a}{b}`, '$$'].join('\n'));
    expect(validMath.ok).toBe(true);
    expect(validMath.diagnostics.some((item) => item.code === 'local.math.display')).toBe(false);
  });

  it('throws CompilerConfigurationError for invalid factory options', () => {
    expect(() => createStandardCompiler({ limits: { maxSyntaxNodes: 0 } })).toThrow(CompilerConfigurationError);
    expect(() => createStandardCompiler({ enableCss: 'yes' } as unknown as LocalCompileOptions)).toThrow(CompilerConfigurationError);
  });

  it('matches compileLocal on the strict corpus, ignoring node ids', () => {
    const compiler = createStandardCompiler();
    for (const source of STRICT_CORPUS) {
      const expected = canonicalize(compileLocal(source));
      const actual = canonicalize(compatibilityResult(compiler.compile(source)));
      expect(actual).toEqual(expected);
    }
  });
});
