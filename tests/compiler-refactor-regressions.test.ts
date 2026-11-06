import { describe, expect, it } from 'vitest';
import { createCompiler } from '../src/compiler';
import { createStandardCompiler } from '../src/compiler/standard';
import { formatLocalDiagnostic, localDiagnosticTemplate } from '../src/local/configuration/diagnostics';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent } from '../src/sdk/manifest';
import type { LocalComponentDefinition } from '../src/sdk/types';

function component(input: Pick<LocalComponentDefinition, 'name' | 'form' | 'props'> & Partial<LocalComponentDefinition>) {
  return defineLocalComponent({
    id: `test/${input.name}`, version: '1.0.0', protocol: 'reactive-md-component/v1',
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
    ...input,
  });
}

describe('compiler refactor regressions', () => {
  it.each([
    '```\n' + '> '.repeat(30) + 'code\n```',
    '    ' + '> '.repeat(30) + 'code',
    '<!--\n' + '> '.repeat(30) + 'comment\n-->',
    '> ```\n> ' + '> '.repeat(30) + 'code\n> ```',
  ])('excludes literal content from minimal Markdown depth: %s', (source) => {
    expect(createCompiler({ limits: { maxMarkdownDepth: 4 } }).compile(source).diagnostics).toEqual([]);
  });

  it('keeps the minimal Markdown depth limit inclusive for actual containers', () => {
    const compiler = createCompiler({ limits: { maxMarkdownDepth: 4 } });
    for (const marker of ['> ', '- ', '> - ']) {
      const count = marker === '> - ' ? 2 : 4;
      expect(compiler.compile(marker.repeat(count) + 'text').ok).toBe(true);
      expect(compiler.compile(marker.repeat(count + 1) + 'text').diagnostics).toContainEqual(
        expect.objectContaining({ messageKey: 'local.budget.markdown-depth' }),
      );
    }
  });

  it('preserves the default child policy for inline SDK manifests', () => {
    const outer = component({ name: 'outer', form: 'inline', props: {} });
    const explicit = component({ name: 'explicit', form: 'inline', props: {}, structure: { rule: 'inline' } });
    const compiler = createStandardCompiler({ config: createLocalConfig({ components: [outer, explicit] }) });
    expect(compiler.compile('<outer>hello <badge>there</badge></outer>').ok).toBe(true);
    expect(compiler.compile('<explicit>hello <badge>there</badge></explicit>').ok).toBe(false);
  });

  it.each([
    '<data-table label="Rows" rows="{{ [1] }}" key="{{ item }}"></data-table>',
    '<data-table label="Rows" rows="{{ [1] }}" key="{{ item }}"><panel></panel></data-table>',
    '<text><badge>nested</badge></text>',
  ])('keeps structural errors readable in both languages: %s', (source) => {
    const result = createStandardCompiler().compile(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).not.toBe('');
      expect(localDiagnosticTemplate(diagnostic.messageKey!)).toBeDefined();
      expect(formatLocalDiagnostic(diagnostic)).toBe(diagnostic.message);
      expect(formatLocalDiagnostic(diagnostic, 'zh')).toMatch(/[㐀-鿿]/);
    }
  });

  it('formats structural rules for external component names', () => {
    const group = component({ name: 'group', form: 'container', props: {},
      rules: [{ kind: 'only-children', children: ['badge'], min: 2 }] });
    const sequence = component({ name: 'sequence', form: 'container', props: {},
      rules: [{ kind: 'value-sequence', child: 'badge', valueAttribute: 'value', min: 1, unique: true, generatedPrefix: 'item-' }] });
    const compiler = createStandardCompiler({ config: createLocalConfig({ components: [group, sequence] }) });
    for (const source of ['<group></group>', '<group><panel></panel></group>', '<sequence></sequence>', '<sequence><panel></panel></sequence>']) {
      const result = compiler.compile(source);
      expect(result.ok).toBe(false);
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.message).not.toBe('');
        expect(localDiagnosticTemplate(diagnostic.messageKey!)).toBeDefined();
        expect(formatLocalDiagnostic(diagnostic, 'zh')).toMatch(/[㐀-鿿]/);
      }
    }
    expect(compiler.compile('<group></group>').diagnostics[0].message).toContain('at least 2 <badge>');
  });

  it.each([
    ['array', 'not-json', undefined],
    ['array', '1', undefined],
    ['array', '[1]', undefined],
    ['number-array', '["bad"]', undefined],
    ['array', '["a","b"]', 1],
  ] as const)('keeps collection initial errors readable: %s %s', (kind, initial, maxItems) => {
    const collection = component({ name: 'collection', form: 'leaf', props: {}, bindings: { value: {
      kind, family: 'collection', bind: 'bind', initial: 'initial', initialRule: 'empty-array',
      ...(maxItems === undefined ? {} : { maxItems: { literal: maxItems } }),
    } } });
    const compiler = createCompiler({ config: createLocalConfig({ components: [collection] }) });
    const result = compiler.compile(`<collection bind="items" initial='${initial}'>`);
    expect(result.ok).toBe(false);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).not.toBe('');
      expect(localDiagnosticTemplate(diagnostic.messageKey!)).toBeDefined();
      expect(formatLocalDiagnostic(diagnostic, 'zh')).toMatch(/[㐀-鿿]/);
    }
  });

  it('names the actual component and attribute in a full-interpolation error', () => {
    const result = createStandardCompiler().compile(
      '<data-table label="Rows" rows="{{ [1] }}" key="{{ item }}"><column label="C" value="literal"></data-table>',
    );
    const diagnostic = result.diagnostics.find(item => item.code === 'local.attribute.interpolation')!;
    expect(diagnostic.message).toContain('<column>');
    expect(diagnostic.message).toContain('value');
    expect(diagnostic.message).not.toContain('boolean');
    expect(formatLocalDiagnostic(diagnostic, 'zh')).toContain('<column>');
    expect(formatLocalDiagnostic(diagnostic, 'zh')).toContain('value');
  });

  it.each(['<number bind="count">', '<number bind="count" label="">'])(
    'retains component names in label diagnostics: %s', (source) => {
      const diagnostic = createStandardCompiler().compile(source).diagnostics.find(item => item.code === 'local.label.required')!;
      expect(diagnostic.message).toContain('<number>');
      expect(formatLocalDiagnostic(diagnostic, 'zh')).toContain('<number>');
    },
  );
});
