import { describe, expect, it } from 'vitest';
import { collectLocalBuildResources, DEFAULT_LOCAL_BUILD_BUDGETS } from '../src/build';
import { createLocalExportPlan, readLocalExportResources } from '../src/export';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalConfig } from '../src/sdk/config';
import type { LocalStyleResource } from '../src/sdk/theme';

/**
 * `Diagnostic.recoverable` means the operation can continue after the
 * diagnostic. Build preflight and export plans both stop on every error, so
 * their budget and resource diagnostics stay unrecoverable.
 */
describe('build and export diagnostic recoverability', () => {
  it('marks a build resource budget failure as unrecoverable with structured details', async () => {
    const root = process.cwd();
    const declared = ['first', 'second', 'third'].map((name) => ({ id: `${name}.css`, css: `.${name} { color: red; }` }));
    const collected = await collectLocalBuildResources({
      config: createLocalConfig(),
      declared,
      themes: [],
      root,
      allowlist: [root],
      budgets: { ...DEFAULT_LOCAL_BUILD_BUDGETS, maxResources: 1 },
    });

    expect(collected.resources).toHaveLength(1);
    const budget = collected.diagnostics.find(diagnostic => diagnostic.code === 'local.build.resource-budget');
    expect(budget).toMatchObject({
      phase: 'resource',
      severity: 'error',
      recoverable: false,
      messageKey: 'local.resource.budget',
      details: { budget: 'maxResources', limit: 1, actual: 3, unit: 'files' },
    });
  });

  it('marks export resource errors as unrecoverable', () => {
    const many = Array.from({ length: 257 }, (_, index) => ({ id: `style-${index}.css`, css: '.x { color: red; }' }));
    const overEntries = readLocalExportResources(many).diagnostics;
    expect(overEntries[0]).toMatchObject({
      code: 'local.extension.resource-budget',
      phase: 'resource',
      recoverable: false,
      details: { budget: 'maxStyleEntries', limit: 256, actual: 257, unit: 'files' },
    });

    const oversized = readLocalExportResources([
      { id: 'huge.css', css: `.a { content: "${'中'.repeat(1_400_000)}"; }` },
    ]).diagnostics;
    expect(oversized[0]).toMatchObject({
      code: 'local.extension.resource-budget',
      recoverable: false,
      details: { budget: 'maxStyleBytes', limit: 4 * 1024 * 1024, unit: 'bytes' },
    });

    const tooManyResources = readLocalExportResources(
      Array.from({ length: 129 }, (_, index) => ({ id: `entry-${index}.css`, css: '.x { color: red; }' })),
    ).diagnostics;
    expect(tooManyResources[0]).toMatchObject({
      code: 'local.extension.resource-budget',
      recoverable: false,
      details: { budget: 'maxStyles', limit: 128, unit: 'files' },
    });

    const invalid = readLocalExportResources([{ id: 'remote.css', css: '.a { background: url(https://example.com/x.png); }' }]).diagnostics;
    expect(invalid[0]).toMatchObject({ code: 'local.extension.resource-invalid', phase: 'export', recoverable: false });

    const conflict = readLocalExportResources([
      { id: 'same.css', css: '.a { color: red; }' },
      { id: 'same.css', css: '.a { color: blue; }' },
    ]).diagnostics;
    expect(conflict[0]).toMatchObject({ code: 'local.extension.resource-conflict', phase: 'export', recoverable: false });
  });

  it('reports an unrecoverable export plan failure for an over-budget resource set', () => {
    const compiled = compileLocal('plain text');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const resources: LocalStyleResource[] = Array.from({ length: 257 }, (_, index) => ({
      id: `plan-${index}.css`,
      css: '.p { color: red; }',
    }));
    const plan = createLocalExportPlan({
      document: compiled.document,
      config: createLocalConfig(),
      target: 'static',
      resources,
    });

    expect(plan.ok).toBe(false);
    const budget = plan.diagnostics.find(diagnostic => diagnostic.code === 'local.extension.resource-budget');
    expect(budget).toMatchObject({ recoverable: false, details: { budget: 'maxStyleEntries', limit: 256, actual: 257 } });
    expect(plan.diagnostics.every(diagnostic => diagnostic.recoverable !== true)).toBe(true);
  });
});