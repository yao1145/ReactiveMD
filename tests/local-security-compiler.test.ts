import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { parseLocal } from '../src/local/parser';
import {
  MAX_LOCAL_DIAGNOSTICS,
  MAX_LOCAL_DIAGNOSTIC_LENGTH,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
  MAX_LOCAL_STRING_LENGTH,
} from '../src/local/limits';
import type { LocalNode } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

const codes = (source: string): string[] =>
  compileLocal(source).diagnostics.map((diagnostic) => diagnostic.code);

function plot(curves: number, samples?: number): string {
  const attr = samples === undefined ? '' : ` samples="${samples}"`;
  return `<plot${attr}>\n${'$$ y = x $$\n\n'.repeat(curves)}</plot>`;
}

describe('compiler and parser budget boundaries', () => {
  it('bounds duplicate-initial diagnostics without quadratic expansion', () => {
    const source = '<input bind="a" label="x" initial="v">\n'.repeat(800);
    const result = compileLocal(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'local.initial.duplicate')).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(MAX_LOCAL_DIAGNOSTICS);
    expect(result.diagnostics.reduce((sum, diagnostic) => sum + diagnostic.message.length, 0)).toBeLessThan(20_000);
    expect(result.diagnostics.every((diagnostic) => diagnostic.line > 0 && diagnostic.column > 0)).toBe(true);
  });

  it('caps parser diagnostics and diagnostic message length', () => {
    const parsed = parseLocal('<Card/>\n'.repeat(300));
    expect(parsed.diagnostics.length).toBeLessThanOrEqual(MAX_LOCAL_DIAGNOSTICS);
    expect(parsed.diagnostics.every((diagnostic) => diagnostic.message.length <= MAX_LOCAL_DIAGNOSTIC_LENGTH)).toBe(true);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === 'local.tag.name')).toBe(true);
  });

  it('rejects a document that exceeds the syntax-node budget instead of crashing', () => {
    const parsed = parseLocal('<badge>x</badge>\n\n'.repeat(10_001));
    expect(parsed.nodes).toEqual([]);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === 'local.budget')).toBe(true);
  });

  it('rejects overlarge displayed math without throwing', () => {
    const parsed = parseLocal(`$${'x'.repeat(50_001)}$`);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === 'local.budget.math')).toBe(true);
    const math = flatten(parsed.nodes).find((node) => node.type === 'inlineMath');
    expect(math?.value?.length).toBe(50_000);
  });
});

describe('decoded marker spoofing', () => {
  it('does not let entity-decoded markers duplicate a component', () => {
    const parsed = parseLocal('&#57344;0&#57345;\n\n<counter label="x">');
    expect(parsed.diagnostics).toEqual([]);
    const nodes = flatten(parsed.nodes);
    expect(nodes.filter((node) => node.type === 'component')).toHaveLength(1);
    expect(nodes.filter((node) => node.type === 'text').map((node) => node.value ?? '').join(''))
      .toContain('\uE0000\uE001');
  });

  it('keeps escaped markers literal and only restores real markers once', () => {
    const escaped = parseLocal('\\&#57344;0&#57345;\n\n<counter label="x">');
    expect(escaped.diagnostics).toEqual([]);
    const escapedNodes = flatten(escaped.nodes);
    expect(escapedNodes.filter((node) => node.type === 'component')).toHaveLength(1);
    expect(escapedNodes.filter((node) => node.type === 'text').map((node) => node.value ?? '').join(''))
      .toContain('&#57344;');

    const mixed = parseLocal('&#57344;0&#57345;<badge>ok</badge>\n\n<counter label="x">');
    const mixedNodes = flatten(mixed.nodes);
    expect(mixedNodes.filter((node) => node.type === 'component' && node.name === 'badge')).toHaveLength(1);
    expect(mixedNodes.filter((node) => node.type === 'component' && node.name === 'counter')).toHaveLength(1);
  });
});

describe('decoded string and name limits', () => {
  it('rejects an initial value above the shared string limit', () => {
    const result = compileLocal(`<input label="x" initial="${'a'.repeat(MAX_LOCAL_STRING_LENGTH + 1)}">`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'local.budget.attribute')).toBe(true);
  });

  it('accepts the exact shared string boundary', () => {
    const result = compileLocal(`<input label="x" initial="${'a'.repeat(MAX_LOCAL_STRING_LENGTH)}">`);
    expect(result.ok).toBe(true);
  });

  it('bounds long binding and tag names before suggestion work', () => {
    expect(codes(`<input bind="${'a'.repeat(129)}" label="x">`)).toContain('local.budget.identifier');
    const parsed = parseLocal(`<${'a'.repeat(129)}>`);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === 'local.budget.name')).toBe(true);
    expect(compileLocal(`<input bind="${'a'.repeat(128)}" label="x">`).ok).toBe(true);
  });
});

describe('plot work budgets', () => {
  it('allows the curve and point boundaries', () => {
    expect(compileLocal(plot(MAX_LOCAL_PLOT_CURVES)).ok).toBe(true);
    expect(compileLocal(plot(10, 2_000)).ok).toBe(true);
  });

  it('rejects too many curves in one plot', () => {
    const result = compileLocal(plot(MAX_LOCAL_PLOT_CURVES + 1, 2_000));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'local.budget.plot.curves')).toBe(true);
  });

  it('rejects excessive total requested points across plots, including hidden branches', () => {
    const total = compileLocal(`${plot(6, 2_000)}\n\n${plot(6, 2_000)}`);
    expect(total.ok).toBe(false);
    expect(total.diagnostics.some((diagnostic) => diagnostic.code === 'local.budget.plot.points')).toBe(true);
    expect(MAX_LOCAL_PLOT_POINTS).toBe(20_000);

    const hidden = compileLocal(`<if when="{{ flag }}">\n${plot(11, 2_000)}\n</if>\n<toggle bind="flag" label="开关">`);
    expect(hidden.ok).toBe(false);
    expect(hidden.diagnostics.some((diagnostic) => diagnostic.code === 'local.budget.plot.points')).toBe(true);
  });
});

describe('static constraints on shared string initials', () => {
  it('applies every writer length constraint to one shared initial', () => {
    const shared = compileLocal(
      '<input bind="s" label="strict" max-length="3">\n<input bind="s" label="relaxed" initial="abcd">',
    );
    expect(shared.ok).toBe(false);
    expect(shared.diagnostics.some((diagnostic) => diagnostic.code === 'local.initial.length')).toBe(true);

    const minimum = compileLocal('<input bind="s" label="s" min-length="3" initial="ab">');
    expect(minimum.ok).toBe(false);
    expect(codes('<input bind="s" label="s" min-length="3" initial="ab">')).toContain('local.initial.length');
    expect(compileLocal('<input bind="s" label="s" max-length="3" initial="abc">').ok).toBe(true);
  });

  it('checks email and date constraints for nonempty initials', () => {
    expect(codes('<input bind="s" label="s" type="email" initial="not-an-email">')).toContain('local.initial.email');
    expect(compileLocal('<input bind="s" label="s" type="email" initial="a@b.co">').ok).toBe(true);
    expect(
      codes('<date bind="d" label="d" min="2026-01-01" max="2026-12-31" initial="2025-12-31">'),
    ).toContain('local.initial.range');
    expect(
      compileLocal('<date bind="d" label="d" min="2026-01-01" max="2026-12-31" initial="2026-12-31">').ok,
    ).toBe(true);
  });

  it('keeps the sanctioned empty initial', () => {
    expect(
      compileLocal('<input bind="s" label="s" required="true" min-length="3" initial="">').ok,
    ).toBe(true);
  });
});
