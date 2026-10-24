import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { createLocalStateFile } from '../src/local/state';
import type { LocalNode } from '../src/local/types';
import { ReactiveMDMountError } from '../src/standalone/diagnostics';
import { parseMountPayload } from '../src/standalone/payload';
import { prepareStandaloneDocument } from '../src/standalone/prepare';

function findComponent(nodes: LocalNode[], name: string): LocalNode {
  for (const node of nodes) {
    if (node.type === 'component' && node.name === name) return node;
    const found = findComponent(node.children ?? [], name);
    if (found) return found;
  }
  throw new Error(`Missing component ${name}`);
}

const SOURCE = [
  '<panel title="Settings">',
  '<slider bind="people" label="People" initial="2" min="1" max="20">',
  '</panel>',
  '',
  'There are {{ people }} people.',
].join('\n');

function stateFixture() {
  const compiled = compileLocal(SOURCE);
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((item) => item.message).join('; '));
  const runtime = createLocalRuntime(compiled.document);
  runtime.set(findComponent(compiled.document.nodes, 'slider'), 7);
  const file = createLocalStateFile(compiled.document, runtime.snapshot().state, {
    name: 'test',
    version: '1.0.0',
  });
  runtime.dispose();
  return { document: compiled.document, file };
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    target: 'reactive-md-document',
    source: SOURCE,
    state: stateFixture().file,
    locale: 'en',
    colorScheme: 'auto',
    hydrate: true,
    ...overrides,
  };
}

describe('standalone mount payload', () => {
  it('accepts the shareable payload and keeps only known fields', () => {
    const payload = { ...validPayload(), ignored: '<script>alert(1)</script>' };
    const result = parseMountPayload(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.version).toBe(1);
    expect(result.payload.target).toBe('reactive-md-document');
    expect(result.payload.source).toBe(SOURCE);
    expect(result.payload.locale).toBe('en');
    expect(result.payload.colorScheme).toBe('auto');
    expect(result.payload.hydrate).toBe(true);
    expect('ignored' in result.payload).toBe(false);
  });

  it('defaults optional presentation fields', () => {
    const result = parseMountPayload({
      version: 1,
      target: 'doc',
      source: '# Title',
      state: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.locale).toBe('en');
    expect(result.payload.colorScheme).toBe('auto');
    expect(result.payload.hydrate).toBe(false);
    expect(result.payload.images).toBeUndefined();
  });

  it('accepts only verified raster image mappings', () => {
    const accepted = parseMountPayload(validPayload({
      images: { 'media/chart.png': 'data:image/png;base64,AAAA' },
    }));
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.payload.images).toEqual({ 'media/chart.png': 'data:image/png;base64,AAAA' });
    }

    const rejected = parseMountPayload(validPayload({
      images: { 'media/chart.png': 'javascript:alert(1)' },
    }));
    expect(rejected.ok).toBe(false);
    const invalidKey = parseMountPayload(validPayload({
      images: { 'bad\u0000key': 'data:image/png;base64,AAAA' },
    }));
    expect(invalidKey.ok).toBe(false);
  });

  it('rejects selector and markup injection in target', () => {
    for (const target of ['', '#doc', 'a b', 'a"]', 'doc<script>', 'doc:first-child', 7, null]) {
      const result = parseMountPayload(validPayload({ target }));
      expect(result.ok).toBe(false);
    }
    expect(parseMountPayload(validPayload({ target: `a${'b'.repeat(256)}` })).ok).toBe(false);
    expect(parseMountPayload(validPayload({ target: 'A-safe_id-2' })).ok).toBe(true);
  });

  it('validates version, source, state and presentation flags', () => {
    const cases: Record<string, unknown>[] = [
      validPayload({ version: 2 }),
      validPayload({ version: '1' }),
      validPayload({ source: 42 }),
      validPayload({ source: null }),
      validPayload({ state: [] }),
      validPayload({ state: null }),
      validPayload({ locale: 'fr' }),
      validPayload({ colorScheme: 'sepia' }),
      validPayload({ hydrate: 'yes' }),
    ];
    for (const payload of cases) {
      expect(parseMountPayload(payload).ok).toBe(false);
    }
    expect(parseMountPayload(null).ok).toBe(false);
    expect(parseMountPayload('{"version":1}').ok).toBe(false);
  });

  it('never executes or rewrites source text', () => {
    const source = '</script><script>globalThis.__reactive_md_pwned = true</script>\n# Title';
    const result = parseMountPayload(validPayload({ source }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.source).toBe(source);
    expect((globalThis as unknown as { __reactive_md_pwned?: boolean }).__reactive_md_pwned).toBeUndefined();
  });

  it('turns hostile getters into diagnostics instead of throwing', () => {
    const payload = validPayload();
    Object.defineProperty(payload, 'source', {
      get() {
        throw new Error('boom');
      },
    });
    const result = parseMountPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('standalone.payload.invalid');
  });
});

describe('standalone document preparation', () => {
  it('uses the exported state as the runtime baseline for render and reset', () => {
    const { file } = stateFixture();
    const prepared = prepareStandaloneDocument(SOURCE, file);
    expect(prepared.document.source).toBe(SOURCE);
    expect(prepared.document.bindings.people.initial).toBe(7);
    expect(prepared.document.initialState.people).toBe(7);

    const runtime = createLocalRuntime(prepared.document);
    try {
      expect(runtime.snapshot().state.people).toBe(7);
      runtime.set(findComponent(prepared.document.nodes, 'slider'), 12);
      expect(runtime.snapshot().state.people).toBe(12);
      runtime.reset(findComponent(prepared.document.nodes, 'slider'));
      expect(runtime.snapshot().state.people).toBe(7);
    } finally {
      runtime.dispose();
    }
  });

  it('accepts serialized state and rejects mismatched documents', () => {
    const { file } = stateFixture();
    const prepared = prepareStandaloneDocument(SOURCE, JSON.stringify(file));
    expect(prepared.document.bindings.people.initial).toBe(7);

    expect(() => prepareStandaloneDocument(`${SOURCE}\n\nExtra`, file))
      .toThrowError(/does not match this source/);
  });

  it('rejects invalid state and invalid source before mounting anything', () => {
    expect(() => prepareStandaloneDocument(SOURCE, '{"format":"nope"}'))
      .toThrowError(ReactiveMDMountError);

    const duplicate = [
      '<slider bind="a" label="A" initial="1" min="0" max="10">',
      '<slider bind="a" label="B" initial="2" min="0" max="10">',
    ].join('\n');
    try {
      prepareStandaloneDocument(duplicate);
      throw new Error('expected a mount error');
    } catch (error) {
      expect(error).toBeInstanceOf(ReactiveMDMountError);
      expect((error as ReactiveMDMountError).diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('applies a host theme override without losing source or baseline state', () => {
    const { file } = stateFixture();
    const prepared = prepareStandaloneDocument(SOURCE, file, 'midnight');
    expect(prepared.document.theme).toBe('midnight');
    expect(prepared.document.themeRange).toBeUndefined();
    expect(prepared.document.source).toBe(SOURCE);
    expect(prepared.document.bindings.people.initial).toBe(7);
  });
});
