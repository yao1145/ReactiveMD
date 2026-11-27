import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { compileLocalStreamingTracked } from '../src/local/compilation/streaming';
import { formatLocalDiagnostic } from '../src/local/configuration/diagnostics';
import { portableCompileOptions } from '../src/local/configuration/portable-options';
import {
  localCompileOptionsKey,
  readLocalCompileOptions,
} from '../src/assemblies/default-options';
import { localWorkerOptionsKey, snapshotCompileOptions } from '../src/local/transport/worker-job';
import { createLocalConfig } from '../src/sdk/config';
import { componentSchemaFromDefinition, normalizedComponentFromDefinition } from '../src/sdk/registry-core';
import {
  canonicalLocalComponent,
  defineLocalComponent,
  readLocalComponentManifest,
} from '../src/sdk/manifest';
import type { LocalCompileOptions, LocalHostComponentSchema, LocalNode } from '../src/local/types';

const PROTOCOL = 'reactive-md-component/v1' as const;

function rawDefinition(min = 0) {
  return defineLocalComponent({
    id: 'test/raw-box',
    name: 'raw-box',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'container',
    props: {},
    structure: { rule: 'raw-body', label: 'none', ...(min > 0 ? { min } : {}) },
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

function rawConfig(min = 0) {
  return createLocalConfig({ components: [rawDefinition(min)] });
}

function rawOptions(min = 0, limits?: LocalCompileOptions['limits']): LocalCompileOptions {
  return { config: rawConfig(min), ...(limits ? { limits } : {}) };
}

function component(nodes: readonly LocalNode[]): LocalNode {
  const found = nodes[0];
  expect(found?.type).toBe('hostComponent');
  return found;
}

function flatten(nodes: readonly LocalNode[]): LocalNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}

function rawBody(node: LocalNode): LocalNode {
  expect(node.children).toHaveLength(1);
  const child = node.children![0];
  expect(child.type).toBe('rawBody');
  return child;
}

/** A manifest base with the required bounded fields. */
function manifest(overrides: Record<string, unknown>) {
  return {
    id: 'test/raw-box',
    name: 'raw-box',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'container',
    props: {},
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
    ...overrides,
  };
}

describe('raw-body manifest contract', () => {
  it('accepts a container raw-body structure and rejects leaf and inline forms', () => {
    const definition = readLocalComponentManifest(
      manifest({ structure: { rule: 'raw-body', label: 'optional', min: 1 } }),
    );
    expect(definition.structure).toEqual({ rule: 'raw-body', label: 'optional', min: 1 });
    expect(() => readLocalComponentManifest(
      manifest({ form: 'leaf', structure: { rule: 'raw-body' } }),
    )).toThrow(/container/);
    expect(() => readLocalComponentManifest(
      manifest({ form: 'inline', structure: { rule: 'raw-body' } }),
    )).toThrow(/container|inline/);
  });

  it('preserves raw-body in canonical, legacy and normalized structure views', () => {
    const definition = rawDefinition();
    const canonical = canonicalLocalComponent(definition) as { structure?: { rule?: string } };
    expect(canonical.structure?.rule).toBe('raw-body');
    expect(JSON.stringify(definition)).toContain('"rule":"raw-body"');
    const legacy = componentSchemaFromDefinition(definition);
    expect(legacy.structure?.rule).toBe('raw-body');
    expect(legacy.childRule).toBe('raw-body');
    const normalized = normalizedComponentFromDefinition(definition);
    expect(normalized.form).toBe('container');
    expect(normalized.structure.rule).toBe('raw-body');
  });
});

describe('host body option', () => {
  const host = (body?: 'markdown' | 'raw', form: 'leaf' | 'inline' | 'container' = 'container') =>
    ({ name: 'host-box', form, props: {}, ...(body ? { body } : {}) }) as const;

  it('defaults to markdown and lowers raw to the internal raw-body rule', () => {
    const defaults = readLocalCompileOptions({ hostComponents: [host()] });
    expect(defaults.ok).toBe(true);
    if (!defaults.ok) return;
    expect(defaults.hostComponents[0].body).toBeUndefined();
    expect(defaults.schemaByName.get('host-box')?.structure.rule).toBe('any');

    const raw = readLocalCompileOptions({ hostComponents: [host('raw')] });
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    expect(raw.hostComponents[0].body).toBe('raw');
    expect(raw.schemaByName.get('host-box')?.structure.rule).toBe('raw-body');
  });

  it('rejects unknown body values and bodies on non-containers with a localized key', () => {
    for (const value of ['html', '', 1, null]) {
      const check = readLocalCompileOptions({
        hostComponents: [{ ...host(), body: value } as unknown as LocalHostComponentSchema],
      });
      expect(check.ok).toBe(false);
      if (check.ok) continue;
      expect(check.key).toBe('local.options.invalid.host-body');
    }
    const leaf = readLocalCompileOptions({ hostComponents: [host('raw', 'leaf')] });
    expect(leaf.ok).toBe(false);
    if (!leaf.ok) expect(leaf.key).toBe('local.options.invalid.host-body');

    const result = compileLocal('hello', {
      hostComponents: [{ name: 'host-box', form: 'container', props: {}, body: 'html' } as unknown as LocalHostComponentSchema],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toEqual(expect.objectContaining({
      code: 'local.options.invalid',
      messageKey: 'local.options.invalid.host-body',
    }));
    expect(formatLocalDiagnostic(result.diagnostics[0], 'zh')).toMatch(/[㐀-鿿]/);
  });

  it('serializes body through portable options and the config lowering', () => {
    const portable = portableCompileOptions({
      hostComponents: [{ name: 'host-box', form: 'container', props: {}, body: 'raw' }],
    });
    expect(portable?.hostComponents?.[0]).toEqual({
      name: 'host-box', form: 'container', props: {}, body: 'raw',
    });
    const snapshot = snapshotCompileOptions({
      hostComponents: [{ name: 'host-box', form: 'container', props: {}, body: 'raw' }],
    });
    expect(snapshot?.hostComponents?.[0]).toEqual(portable?.hostComponents?.[0]);
    const check = readLocalCompileOptions({ config: rawConfig() });
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.hostByName.get('raw-box')?.body).toBe('raw');
  });

  it('compiles a host-declared raw container end to end', () => {
    const result = compileLocal('<host-box>\nhello\n</host-box>', {
      hostComponents: [{ name: 'host-box', form: 'container', props: {}, body: 'raw' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(rawBody(component(result.document.nodes)).value).toBe('\nhello\n');
  });
});

describe('raw body options', () => {
  it('defaults to 100,000 and accepts up to 1,000,000', () => {
    const defaults = readLocalCompileOptions({});
    expect(defaults.ok && defaults.maxRawBodyChars).toBe(100_000);
    const maximum = readLocalCompileOptions({ limits: { maxRawBodyChars: 1_000_000 } });
    expect(maximum.ok && maximum.maxRawBodyChars).toBe(1_000_000);
    const over = readLocalCompileOptions({ limits: { maxRawBodyChars: 1_000_001 } });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.key).toBe('local.options.invalid.max-raw-body-chars');
    const result = compileLocal('hello', { limits: { maxRawBodyChars: 1_000_001 } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toEqual(expect.objectContaining({
      code: 'local.options.invalid',
      messageKey: 'local.options.invalid.max-raw-body-chars',
    }));
  });

  it.each([0, -1, 1.5, NaN, Infinity, '10', null, true])(
    'rejects an invalid maxRawBodyChars value: %j',
    (value) => {
      const result = compileLocal('hello', {
        limits: { maxRawBodyChars: value },
      } as unknown as LocalCompileOptions);
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toEqual(expect.objectContaining({
        code: 'local.options.invalid',
        messageKey: 'local.options.invalid.max-raw-body-chars',
      }));
    },
  );

  it('keeps unknown limit keys rejected', () => {
    const result = compileLocal('hello', {
      limits: { maxRawBody: 10 },
    } as unknown as LocalCompileOptions);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toEqual(expect.objectContaining({
      messageKey: 'local.options.invalid.limits-unknown',
    }));
  });

  it('round-trips maxRawBodyChars through portable options', () => {
    const portable = portableCompileOptions({ limits: { maxRawBodyChars: 50 } });
    expect(portable?.limits).toEqual({ maxRawBodyChars: 50 });
    expect(() => portableCompileOptions({ limits: { maxRawBodyChars: 1_000_001 } })).toThrow(TypeError);
  });

  it('distinguishes body and limit changes in compile, worker and cache identities', () => {
    expect(localCompileOptionsKey({ limits: { maxRawBodyChars: 10 } }))
      .not.toBe(localCompileOptionsKey({ limits: { maxRawBodyChars: 11 } }));
    expect(localCompileOptionsKey({}))
      .not.toBe(localCompileOptionsKey({ limits: { maxRawBodyChars: 100_000 } }));
    expect(localWorkerOptionsKey({ limits: { maxRawBodyChars: 10 } }))
      .not.toBe(localWorkerOptionsKey({ limits: { maxRawBodyChars: 11 } }));

    const raw = { hostComponents: [{ name: 'host-box', form: 'container' as const, props: {}, body: 'raw' as const }] };
    const markdown = { hostComponents: [{ name: 'host-box', form: 'container' as const, props: {}, body: 'markdown' as const }] };
    const omitted = { hostComponents: [{ name: 'host-box', form: 'container' as const, props: {} }] };
    const keys = [raw, markdown, omitted].map((options) => localCompileOptionsKey(options));
    expect(new Set(keys).size).toBe(3);
  });
});

describe('raw body parsing', () => {
  it('keeps Markdown, entities, interpolation, escapes and fake tags literal', () => {
    const body = '\n*em* {{ count }} &lt; \\* <raw-box>fake</raw-box>\n<raw-box>\n\n</let>\n';
    const source = `<raw-box>${body}</raw-box>`;
    const result = compileLocal(source, rawOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    const node = component(result.document.nodes);
    const raw = rawBody(node);
    expect(raw.value).toBe(body);
    expect(raw.range).toEqual({ start: 9, end: 9 + body.length });
    expect(node.range).toEqual({ start: 0, end: source.length });
    expect(result.document.nodes).toHaveLength(1);
    expect(result.document.bindings).toEqual({});
  });

  it('closes only on a line whose first content is the exact close tag', () => {
    const source = '<raw-box>\nhello\n</raw-box> trailing\n</RAW-BOX>\n</raw-box>  \t\n';
    const result = compileLocal(source, rawOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = component(result.document.nodes);
    const raw = rawBody(node);
    expect(raw.value).toBe('\nhello\n</raw-box> trailing\n</RAW-BOX>\n');
    expect(node.range.end).toBe(source.length - 1);
  });

  it('allows an indented close line and removes common indentation', () => {
    const source = '<raw-box>\n    alpha\n      beta\n    </raw-box>';
    const result = compileLocal(source, rawOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const raw = rawBody(component(result.document.nodes));
    expect(raw.value).toBe('\nalpha\n  beta\n');
    expect(source.slice(raw.range.start, raw.range.end)).toBe('\n    alpha\n      beta\n');
  });

  it('preserves CRLF line endings and remaining whitespace', () => {
    const source = '<raw-box>\r\n  alpha\r\n    beta\r\n  </raw-box>';
    const result = compileLocal(source, rawOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const raw = rawBody(component(result.document.nodes));
    expect(raw.value).toBe('\r\nalpha\r\n  beta\r\n');
  });

  it('emits exactly one rawBody node, including for an immediate or blank body', () => {
    const immediate = compileLocal('<raw-box></raw-box>', rawOptions());
    expect(immediate.ok).toBe(true);
    if (immediate.ok) {
      const raw = rawBody(component(immediate.document.nodes));
      expect(raw.value).toBe('');
      expect(raw.range).toEqual({ start: 9, end: 9 });
    }

    const blank = compileLocal('<raw-box>\n \n</raw-box>', rawOptions());
    expect(blank.ok).toBe(true);
    if (blank.ok) {
      const raw = rawBody(component(blank.document.nodes));
      expect((raw.value ?? '').trim()).toBe('');
      expect(raw.value).toBe('\n \n');
    }
  });

  it('reports the existing pair diagnostic for a strict unclosed body', () => {
    const result = compileLocal('<raw-box>\nhello', rawOptions());
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.tag.unclosed',
      messageKey: 'local.tag.unclosed.pair',
      range: { start: 0, end: 9 },
      params: { name: 'raw-box' },
    }));
  });

  it('degrades an unclosed body through the loose recovery planner', () => {
    const source = '<raw-box>\nhello';
    const result = compileLocal(source, { ...rawOptions(), strict: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.recovery.unclosed',
      severity: 'warning',
    }));
    expect(result.recoveries).toEqual([
      expect.objectContaining({
        code: 'local.recovery.unclosed',
        causeRange: { start: 0, end: 9 },
        boundary: 'eof',
      }),
    ]);
    expect(result.document.nodes[0].type).toBe('fallback');
  });

  it('keeps tag-shaped body lines out of the loose recovery planner', () => {
    const body = '\n<unknown-widget>\n# not a heading\n';
    const source = `<raw-box>${body}</raw-box>`;
    const result = compileLocal(source, { ...rawOptions(), strict: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.recoveries ?? []).toEqual([]);
    expect(rawBody(component(result.document.nodes)).value).toBe(body);
  });

  it('renders an unfinished body to the snapshot end while streaming', () => {
    const tracked = compileLocalStreamingTracked('<raw-box>\nhello', rawOptions());
    expect(tracked.result.ok).toBe(true);
    if (!tracked.result.ok) return;
    expect(tracked.result.status).toBe('partial');
    expect(tracked.result.diagnostics).toEqual([]);
    const node = component(tracked.result.document.nodes);
    const raw = rawBody(node);
    expect(raw.value).toBe('\nhello');
    expect(node.range.end).toBe('<raw-box>\nhello'.length);
  });

  it('keeps an unfinished loose streaming body raw to the snapshot end', () => {
    const source = '<raw-box>\nhello\n\nAfter **bold**';
    const tracked = compileLocalStreamingTracked(source, { ...rawOptions(), strict: false });
    expect(tracked.result.ok).toBe(true);
    if (!tracked.result.ok) return;
    expect(tracked.result.status).toBe('partial');
    expect(tracked.result.diagnostics).toEqual([]);
    const node = component(tracked.result.document.nodes);
    expect(rawBody(node).value).toBe('\nhello\n\nAfter **bold**');
    expect(node.range.end).toBe(source.length);
  });

  it('does not resume Markdown after a loose streaming body inside a blockquote', () => {
    const source = '> <raw-box>\n> hello\n\nAfter **bold**';
    const tracked = compileLocalStreamingTracked(source, { ...rawOptions(), strict: false });
    expect(tracked.result.ok).toBe(true);
    if (!tracked.result.ok) return;
    const nodes = flatten(tracked.result.document.nodes);
    expect(nodes.some(node => node.type === 'strong')).toBe(false);
    const raw = nodes.find(node => node.type === 'rawBody');
    expect(raw?.value).toContain('After **bold**');
    expect(raw?.range.end).toBe(source.length);
  });
});

describe('raw body budgets', () => {
  it.each(['streaming', 'final'] as const)('keeps the length budget on unfinished loose %s bodies', (sourcePhase) => {
    const source = '<raw-box>\nhello';
    const options = { ...rawOptions(0, { maxRawBodyChars: 5 }), strict: false };
    const result = sourcePhase === 'streaming' ? compileLocalStreamingTracked(source, options).result : compileLocal(source, options);
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({
      code: 'local.budget', messageKey: 'local.budget.raw', severity: 'error',
      params: { name: 'raw-box', limit: 5 },
    })]) });
  });

  it('rejects an oversized body with local.budget.raw and no partial document', () => {
    const body = 'x'.repeat(10);
    const source = `<raw-box>\n${body}\n</raw-box>`;
    const result = compileLocal(source, rawOptions(0, { maxRawBodyChars: 11 }));
    expect(result.ok).toBe(false);
    expect('document' in result).toBe(false);
    const raw = result.diagnostics.find(
      (diagnostic) => diagnostic.messageKey === 'local.budget.raw',
    )!;
    expect(raw.code).toBe('local.budget');
    expect(raw.params).toEqual({ name: 'raw-box', limit: 11 });
    expect(raw.details).toEqual(expect.objectContaining({
      budget: 'maxRawBodyChars', unit: 'characters', limit: 11, actual: 12,
    }));
    expect(formatLocalDiagnostic(raw, 'en')).toBe(raw.message);
    expect(formatLocalDiagnostic(raw, 'zh')).toContain('原始正文');
    expect(formatLocalDiagnostic(raw, 'zh')).toContain('11');
  });

  it('accepts a body exactly at the limit', () => {
    const body = 'x'.repeat(10);
    const source = `<raw-box>\n${body}\n</raw-box>`;
    const result = compileLocal(source, rawOptions(0, { maxRawBodyChars: 12 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rawBody(component(result.document.nodes)).value).toBe(`\n${body}\n`);
  });

  it('still bounds raw scanning with maxParseWork', () => {
    const source = `<raw-box>\n${'x'.repeat(10_000)}\n</raw-box>`;
    const result = compileLocal(source, rawOptions(0, {
      maxParseWork: source.length * 3 + 100,
    }));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.budget',
      messageKey: 'local.budget.parse-work',
    }));
  });

  it('charges a closed raw body scan once in loose mode', () => {
    const body = 'x'.repeat(100_000);
    const source = `<raw-box>\n${body}\n</raw-box>`;
    const limits = (maxParseWork: number) => ({ maxRawBodyChars: 1_000_000, maxParseWork });
    let low = 1, high = source.length * 8;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (compileLocal(source, rawOptions(0, limits(mid))).ok) high = mid;
      else low = mid + 1;
    }
    // The recovery planner charges one fixed structural pass. Reusing its raw
    // close scan must not add a second charge for the body itself.
    const loose = compileLocal(source, {
      ...rawOptions(0, limits(low + source.length)),
      strict: false,
    });
    expect(loose.ok).toBe(true);
  });
});

describe('raw body structure validation', () => {
  it('reports a required blank body with the children minimum template', () => {
    const result = compileLocal('<raw-box>\n   \n</raw-box>', rawOptions(1));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.structure.children',
      messageKey: 'local.structure.children.minimum',
      params: { name: 'raw-box', min: 1, children: 'body block' },
    }));
  });

  it('delivers an optional empty body without diagnostics', () => {
    const result = compileLocal('<raw-box>\n   \n</raw-box>', rawOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(rawBody(component(result.document.nodes)).value).toBe('\n   \n');
  });
});

describe('raw body dependency boundary', () => {
  it('keeps parsing, structure and manifest modules free of React and DOM imports', () => {
    for (const file of [
      'src/local/parsing/parser-region.ts',
      'src/local/parsing/parser-core.ts',
      'src/local/compilation/compiler-structure.ts',
      'src/sdk/manifest.ts',
      'src/contracts/component-kernel.ts',
    ]) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(text, file).not.toMatch(/from\s+['"][^'"]*react/);
      expect(text, file).not.toMatch(/\bdocument\.createElement\b/);
    }
  });
});
