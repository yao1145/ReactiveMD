import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { createDiagnosticReport } from '../src/local/observability';
import {
  createLocalExportPlan,
  defineLocalStandaloneBundle,
} from '../src/export';
import { renderLocalStaticDocument } from '../src/react/server';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent } from '../src/sdk/manifest';
import { createReactConfig, defineReactComponent } from '../src/react/sdk';

function compiled(source: string, config = createLocalConfig()) {
  const result = compileLocal(source, { config });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

describe('fixed export diagnostics in reports', () => {
  it('keeps preflight bundle and resource failures', () => {
    const config = createLocalConfig();
    const plan = createLocalExportPlan({
      document: compiled('plain text', config),
      config,
      target: 'offline',
      requiredResources: ['missing.css'],
    });
    expect(plan.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'local.extension.bundle-missing',
      'local.extension.resource-missing',
    ]));

    const report = createDiagnosticReport('plain text', { diagnostics: plan.diagnostics });
    expect(report.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'local.extension.bundle-missing',
      'local.extension.resource-missing',
    ]));
  });

  it('keeps package seal failures', () => {
    const config = createLocalConfig();
    const bundle = defineLocalStandaloneBundle('window.sdkReady = true;', config);
    const tampered = { ...bundle, script: 'window.sdkReady = false;' };
    const plan = createLocalExportPlan({
      document: compiled('plain text', config),
      config,
      target: 'offline',
      bundle: tampered,
    });
    expect(plan.diagnostics.map(item => item.code)).toContain('local.extension.bundle-integrity');

    const report = createDiagnosticReport('plain text', { diagnostics: plan.diagnostics });
    expect(report.diagnostics.map(item => item.code)).toContain('local.extension.bundle-integrity');
  });

  it('keeps SSR failures without copying their free-text reason into the report', () => {
    const definition = defineLocalComponent({
      id: 'test/report-note',
      name: 'report-note',
      version: '1.0.0',
      protocol: 'reactive-md-component/v1',
      form: 'leaf',
      props: {},
      capabilities: { interactive: true, static: true, ssr: true, offline: false },
    });
    const config = createLocalConfig({ components: [definition] });
    const reactConfig = createReactConfig(config, {
      components: [defineReactComponent(definition, {
        render: () => <span>note</span>,
        renderStatic: () => {
          throw new Error('secret SSR free text');
        },
      })],
    });
    const source = '<report-note>';
    const document = compiled(source, config);
    const runtime = createLocalRuntime(document);
    try {
      const rendered = renderLocalStaticDocument({ document, runtime, reactConfig });
      expect(rendered.ok).toBe(false);
      expect(rendered.diagnostics.map(item => item.code)).toContain('local.extension.ssr-render');

      const report = createDiagnosticReport(source, { diagnostics: rendered.diagnostics });
      expect(report.diagnostics.map(item => item.code)).toContain('local.extension.ssr-render');
      expect(JSON.stringify(report)).not.toContain('secret SSR free text');
    } finally {
      runtime.dispose();
    }
  });
});