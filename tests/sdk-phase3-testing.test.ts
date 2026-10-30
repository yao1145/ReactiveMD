import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import type { LocalComponentDefinition } from '../src/sdk';
import defaultPreset from '../src/presets/default';
import {
  compareLocalComplianceParity,
  createLocalComplianceReport,
  readLocalBehaviorSpec,
  runLocalBehaviorCompliance,
  runLocalManifestCompliance,
} from '../src/testing';
import type {
  LocalBehaviorSpec,
  LocalComplianceCaseResult,
  LocalComplianceSuiteResult,
} from '../src/testing';

const CAPABILITIES = { interactive: true, static: false, ssr: false, offline: false };

function manifest(name: string, input: Record<string, unknown>): LocalComponentDefinition {
  return defineLocalComponent({
    id: `example/${name}`,
    name,
    version: '1.0.0',
    protocol: 'reactive-md-component/v1',
    capabilities: CAPABILITIES,
    ...input,
  } as unknown as LocalComponentDefinition);
}

function caseOf(result: LocalComplianceSuiteResult, id: string): LocalComplianceCaseResult {
  const found = result.cases.find((item) => item.id === id);
  if (!found) throw new Error(`Missing case ${id}: ${result.cases.map((item) => item.id).join(', ')}`);
  return found;
}

function expectAllPassed(result: LocalComplianceSuiteResult): void {
  const failures = result.cases.filter((item) => item.status === 'failed');
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
}

const rating = manifest('rating', {
  form: 'leaf',
  props: {
    label: { kind: 'string', required: true },
    max: { kind: 'number', integer: true, min: 1, max: 10, default: 5 },
    locked: { kind: 'boolean', dynamic: true, default: false },
  },
  bindings: {
    value: {
      kind: 'number',
      family: 'number',
      bind: 'bind',
      initial: 'initial',
      initialRule: 'nearest-zero',
      constraints: {
        min: { literal: 0 },
        max: { prop: 'max' },
        step: { literal: 1 },
      },
    },
  },
  structure: { rule: 'none' },
});

const ratingSpec: LocalBehaviorSpec = {
  protocol: 'reactive-md-behavior-spec/v1',
  component: 'rating',
  source: '<rating label="Rating" bind="score" max="5">',
  writes: [
    { id: 'accept-three', value: 3, accepted: true, expect: { score: 3 } },
    { id: 'accept-max', value: 5, accepted: true, expect: { score: 5 } },
    { id: 'reject-over-max', value: 6, accepted: false },
    { id: 'reject-type', value: 'not-a-number', accepted: false },
  ],
};

describe('behavior compliance executes real runtime writes', () => {
  const config = createLocalConfig({ components: [rating] });
  const result = runLocalBehaviorCompliance(ratingSpec, config);

  it('reports accepted, rejected, rollback, reset and interactive evidence', () => {
    expectAllPassed(result);
    expect(caseOf(result, 'behavior.compile').status).toBe('passed');
    expect(caseOf(result, 'behavior.write.accept-three').status).toBe('passed');
    expect(caseOf(result, 'behavior.write.reject-over-max').status).toBe('passed');
    expect(caseOf(result, 'behavior.rollback.reject-over-max').status).toBe('passed');
    expect(caseOf(result, 'behavior.reset').status).toBe('passed');
    expect(caseOf(result, 'behavior.interactive').status).toBe('passed');
    expect(caseOf(result, 'behavior.interactive').capabilities).toEqual(['interactive']);
  });

  it('reports the actual parameter values in observed evidence', () => {
    const accepted = caseOf(result, 'behavior.write.accept-three');
    expect(accepted.observed).toMatchObject({ accepted: true, changed: true, 'value.score': 3 });
    const rejected = caseOf(result, 'behavior.write.reject-over-max');
    expect(rejected.observed).toMatchObject({ accepted: false, changed: false, 'value.score': 5 });
  });

  it('does not let a reduced capability set hide a declared capability', () => {
    const report = createLocalComplianceReport({
      config,
      component: 'rating',
      suites: [runLocalManifestCompliance(rating), result],
    });
    expect(report.ok).toBe(true);
    expect(report.capabilities.map((item) => item.capability)).toEqual(['interactive']);

    const partial = createLocalComplianceReport({
      config,
      component: 'rating',
      suites: [result],
      capabilities: ['interactive', 'ssr'],
    });
    expect(partial.ok).toBe(false);
    expect(partial.capabilities.find((item) => item.capability === 'ssr')?.status).toBe('unsupported');
    expect(partial.diagnostics.some((item) => item.code === 'testing.capability-evidence')).toBe(true);
  });
});

describe('manifest compliance normalizes and rejects illegal input', () => {
  it('round-trips a validated manifest and applies declared defaults', () => {
    const result = runLocalManifestCompliance(rating);
    expectAllPassed(result);
    expect(caseOf(result, 'manifest.normalize').status).toBe('passed');
    expect(caseOf(result, 'manifest.default.max').status).toBe('passed');
    expect(caseOf(result, 'manifest.default.locked').status).toBe('passed');
    expect(caseOf(result, 'manifest.invalid-value.max').status).toBe('passed');
    expect(caseOf(result, 'manifest.required.label').status).toBe('passed');
    expect(caseOf(result, 'manifest.unknown-field').status).toBe('passed');
    expect(caseOf(result, 'manifest.dangerous-key').status).toBe('passed');
    expect(caseOf(result, 'manifest.invalid-default.max').status).toBe('passed');
  });

  it('turns an invalid manifest into a failed case instead of throwing', () => {
    const result = runLocalManifestCompliance({ id: 'Bad/Id', name: 'Bad Name' });
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].id).toBe('manifest.normalize');
    expect(result.cases[0].status).toBe('failed');
    expect(result.cases[0].diagnostics[0].code).toBe('testing.manifest');
  });

  it('rejects malformed specs with bounded validation errors', () => {
    expect(() => readLocalBehaviorSpec({ ...ratingSpec, protocol: 'wrong' })).toThrow(/protocol/);
    expect(() => readLocalBehaviorSpec({
      ...ratingSpec,
      writes: [{ value: 1, accepted: 'yes' }],
    })).toThrow(/accepted/);
    expect(() => readLocalBehaviorSpec({
      ...ratingSpec,
      writes: [{ value: 1, values: { value: 1 }, accepted: true }],
    })).toThrow(/exactly one/);
    expect(() => readLocalBehaviorSpec({
      ...ratingSpec,
      writes: [
        { id: 'same', value: 1, accepted: true },
        { id: 'same', value: 2, accepted: true },
      ],
    })).toThrow(/duplicates/);
    expect(() => readLocalBehaviorSpec({
      ...ratingSpec,
      source: 'x'.repeat(300_000),
    })).toThrow(/exceeds/);
    expect(() => readLocalBehaviorSpec({ ...ratingSpec, unexpected: true })).toThrow(/unknown field/);
  });
});

describe('named slots and atomic rollback', () => {
  const range = manifest('range', {
    form: 'leaf',
    props: {
      label: { kind: 'string' },
      min: { kind: 'number', default: 0 },
      max: { kind: 'number', default: 100 },
      step: { kind: 'number', default: 1 },
    },
    bindings: {
      start: {
        kind: 'number', family: 'number', bind: 'bind-start', initial: 'initial-start',
        initialRule: 'min', exclusive: true,
        constraints: { min: { prop: 'min' }, max: { prop: 'max' }, step: { prop: 'step' } },
      },
      end: {
        kind: 'number', family: 'number', bind: 'bind-end', initial: 'initial-end',
        initialRule: 'max-step', exclusive: true,
        constraints: { min: { prop: 'min' }, max: { prop: 'max' }, step: { prop: 'step' } },
      },
    },
    slotRelations: [{ lower: 'start', upper: 'end' }],
    structure: { rule: 'none' },
  });
  const config = createLocalConfig({ components: [range] });
  const spec: LocalBehaviorSpec = {
    protocol: 'reactive-md-behavior-spec/v1',
    component: 'range',
    source: '<range label="Range">',
    writes: [
      { id: 'move', values: { start: 10, end: 90 }, accepted: true, expect: { start: 10, end: 90 } },
      { id: 'cross', values: { start: 90, end: 10 }, accepted: false },
      { id: 'single', slot: 'start', value: 20, accepted: true, expect: { start: 20, end: 90 } },
    ],
  };
  const result = runLocalBehaviorCompliance(spec, config);

  it('accepts atomic setMany and rolls back crossing writes', () => {
    expectAllPassed(result);
    expect(caseOf(result, 'behavior.write.move').observed).toMatchObject({
      'value.start': 10,
      'value.end': 90,
    });
    expect(caseOf(result, 'behavior.write.cross').status).toBe('passed');
    expect(caseOf(result, 'behavior.rollback.cross').status).toBe('passed');
    expect(caseOf(result, 'behavior.write.single').status).toBe('passed');
  });

  it('restores both slots and advances the reset token', () => {
    const reset = caseOf(result, 'behavior.reset');
    expect(reset.status).toBe('passed');
    expect(reset.observed).toMatchObject({ 'value.start': 0, 'value.end': 100 });
  });
});

describe('collection writes prove budgets and defensive copies', () => {
  const basket = manifest('basket', {
    form: 'leaf',
    props: {
      label: { kind: 'string' },
      'max-items': { kind: 'number', integer: true, min: 0, default: 2 },
    },
    bindings: {
      value: {
        kind: 'array', family: 'collection', bind: 'bind', initial: 'initial',
        initialRule: 'empty-array', exclusive: true, maxItems: { prop: 'max-items' },
      },
    },
    structure: { rule: 'none' },
  });
  const config = createLocalConfig({ components: [basket] });
  const spec: LocalBehaviorSpec = {
    protocol: 'reactive-md-behavior-spec/v1',
    component: 'basket',
    source: `<basket label="Basket" bind="items" initial='["a","b"]'>`,
    writes: [
      { id: 'reorder', value: ['b', 'a'], accepted: true, expect: { items: ['b', 'a'] } },
      { id: 'over-budget', value: ['a', 'b', 'c'], accepted: false },
    ],
  };
  const result = runLocalBehaviorCompliance(spec, config);

  it('accepts valid collections and rejects over-budget or malformed writes', () => {
    expectAllPassed(result);
    expect(caseOf(result, 'behavior.write.reorder').status).toBe('passed');
    expect(caseOf(result, 'behavior.write.over-budget').status).toBe('passed');
    expect(caseOf(result, 'behavior.rollback.over-budget').status).toBe('passed');
    expect(caseOf(result, 'behavior.copy.reorder').status).toBe('passed');
  });

  it('resets to the authored collection', () => {
    expect(caseOf(result, 'behavior.reset').observed).toMatchObject({ 'value.items': ['a', 'b'] });
  });
});

describe('default and external component parity', () => {
  const builtin = defaultPreset.components.find((item) => item.name === 'number');
  if (!builtin) throw new Error('default number component missing');

  const aliasInput = JSON.parse(JSON.stringify(builtin)) as Record<string, unknown>;
  aliasInput.id = 'example/number-alias';
  aliasInput.name = 'number-alias';
  const alias = defineLocalComponent(aliasInput as unknown as LocalComponentDefinition);
  const builtinConfig = createLocalConfig();
  const aliasConfig = createLocalConfig({ components: [alias] });

  const baseSpec: LocalBehaviorSpec = {
    protocol: 'reactive-md-behavior-spec/v1',
    component: 'number',
    source: '<number label="Count" bind="count" min="0" max="5">',
    writes: [
      { id: 'three', value: 3, accepted: true, expect: { count: 3 } },
      { id: 'nine', value: 9, accepted: false },
      { id: 'negative', value: -1, accepted: false },
    ],
  };

  it('produces the same observations through the public tooling', () => {
    const builtinResult = runLocalBehaviorCompliance(baseSpec, builtinConfig);
    const aliasResult = runLocalBehaviorCompliance(
      { ...baseSpec, component: 'number-alias', source: baseSpec.source.replaceAll('number', 'number-alias') },
      aliasConfig,
    );
    expectAllPassed(builtinResult);
    expectAllPassed(aliasResult);
    expect(compareLocalComplianceParity(builtinResult, aliasResult)).toEqual({ ok: true, mismatches: [] });
    expect(compareLocalComplianceParity(
      runLocalManifestCompliance(builtin),
      runLocalManifestCompliance(alias),
    )).toEqual({ ok: true, mismatches: [] });
  });

  it('detects a deliberately divergent spec through parity', () => {
    const builtinResult = runLocalBehaviorCompliance(baseSpec, builtinConfig);
    const divergent = runLocalBehaviorCompliance(
      {
        ...baseSpec,
        component: 'number-alias',
        source: baseSpec.source.replaceAll('number', 'number-alias'),
        writes: baseSpec.writes?.map((write) => write.id === 'three' ? { ...write, value: 4 } : write),
      },
      aliasConfig,
    );
    const parity = compareLocalComplianceParity(builtinResult, divergent);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.some((item) => item.case === 'behavior.write.three')).toBe(true);
  });

  it('keeps the compiled runtime aligned with the tool observations', () => {
    const compiled = compileLocal('<number label="Count" bind="count" min="0" max="5">');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const runtime = createLocalRuntime(compiled.document);
    try {
      expect(runtime.setParameter('count', 3)).toEqual([]);
      expect(runtime.setParameter('count', 9).length).toBeGreaterThan(0);
      expect(runtime.getParameter('count')).toBe(3);
    } finally {
      runtime.dispose();
    }
  });
});
