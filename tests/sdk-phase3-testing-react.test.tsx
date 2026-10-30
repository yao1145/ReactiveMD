import { describe, expect, it } from 'vitest';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import { createReactConfig, defineReactComponent } from '../src/react/sdk';
import { runLocalManifestCompliance } from '../src/testing';
import {
  readLocalReactSpec,
  runLocalReactCompliance,
} from '../src/testing/react';
import { createLocalComplianceReport } from '../src/testing';

const probe = defineLocalComponent({
  id: 'example/probe',
  name: 'probe',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    text: { kind: 'string', default: 'Hello' },
    boom: { kind: 'boolean', dynamic: true, default: false },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: false },
});

const config = createLocalConfig({ components: [probe] });
const source = '<probe text="Hello">';

const implementation = defineReactComponent(probe, {
  render: (ctx) => <span data-probe>{String(ctx.props.text)}</span>,
  renderStatic: (ctx) => <span data-probe-static>{String(ctx.props.text)}</span>,
});
const reactConfig = createReactConfig(config, { components: [implementation] });

const brokenImplementation = defineReactComponent(probe, {
  render: () => <span data-probe>broken</span>,
  renderStatic: () => {
    throw new Error('probe exploded during server rendering');
  },
});
const brokenReactConfig = createReactConfig(config, { components: [brokenImplementation] });

const wrongImplementation = defineReactComponent(probe, {
  render: () => <span data-wrong>wrong</span>,
  renderStatic: () => <span data-wrong>wrong</span>,
});
const wrongReactConfig = createReactConfig(config, { components: [wrongImplementation] });

const spec = {
  protocol: 'reactive-md-react-spec/v1' as const,
  source,
  staticMarkupIncludes: ['data-probe-static', 'Hello'],
  ssrMarkupIncludes: ['data-probe-static', 'Hello'],
  error: {
    source,
    config,
    reactConfig: brokenReactConfig,
    code: 'local.extension.ssr-render',
  },
};

describe('React compliance exercises static, SSR and error isolation', () => {
  it('passes declared component resources to static and SSR preflight', () => {
    const styled = defineLocalComponent({ ...probe, styles: ['probe.css'] });
    const styledConfig = createLocalConfig({ components: [styled] });
    const styledReact = createReactConfig(styledConfig, { components: [defineReactComponent(styled, {
      render: () => <span data-probe-static>Hello</span>,
      renderStatic: () => <span data-probe-static>Hello</span>,
    })] });
    const result = runLocalReactCompliance({ config: styledConfig, reactConfig: styledReact, component: 'probe',
      resources: [{ id: 'probe.css', css: '.probe { color: green; }' }],
      spec: { protocol: 'reactive-md-react-spec/v1', source,
        staticMarkupIncludes: ['data-probe-static'], ssrMarkupIncludes: ['data-probe-static'] } });
    expect(result.cases.filter(item => ['react.static', 'react.ssr'].includes(item.id)).map(item => item.status)).toEqual(['passed', 'passed']);
  });
  const result = runLocalReactCompliance({
    config,
    reactConfig,
    component: 'probe',
    spec,
    locale: 'en',
  });

  it('passes static and deterministic SSR with expected markup', () => {
    const failures = result.cases.filter((item) => item.status === 'failed');
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    expect(result.cases.find((item) => item.id === 'react.static')?.capabilities).toEqual(['static']);
    expect(result.cases.find((item) => item.id === 'react.ssr')?.capabilities).toEqual(['ssr']);
    expect(result.cases.find((item) => item.id === 'react.error-isolation')?.status).toBe('passed');
  });

  it('satisfies explicitly required static and SSR evidence', () => {
    const report = createLocalComplianceReport({
      config,
      component: 'probe',
      suites: [runLocalManifestCompliance(probe), result],
      capabilities: ['static', 'ssr'],
    });
    expect(report.ok).toBe(true);
    expect(report.capabilities.map((item) => item.status)).toEqual(['passed', 'passed']);
  });

  it('fails when a rendered implementation does not match the expected markup', () => {
    const wrong = runLocalReactCompliance({
      config,
      reactConfig: wrongReactConfig,
      component: 'probe',
      spec,
    });
    expect(wrong.cases.find((item) => item.id === 'react.static')?.status).toBe('failed');
    const report = createLocalComplianceReport({
      config,
      component: 'probe',
      suites: [wrong],
      capabilities: ['static', 'ssr'],
    });
    expect(report.ok).toBe(false);
    expect(report.summary.failed).toBeGreaterThan(0);
  });

  it('reports absent SSR evidence explicitly instead of passing', () => {
    const staticOnly = defineLocalComponent({
      id: 'example/static-only',
      name: 'static-only',
      version: '1.0.0',
      protocol: 'reactive-md-component/v1',
      form: 'leaf',
      props: { text: { kind: 'string', default: 'Static' } },
      structure: { rule: 'none' },
      capabilities: { interactive: true, static: true, ssr: false, offline: false },
    });
    const staticConfig = createLocalConfig({ components: [staticOnly] });
    const staticReact = createReactConfig(staticConfig, {
      components: [defineReactComponent(staticOnly, {
        render: () => <span data-static>{'static'}</span>,
        renderStatic: () => <span data-static>{'static'}</span>,
      })],
    });
    const absent = runLocalReactCompliance({
      config: staticConfig,
      reactConfig: staticReact,
      component: 'static-only',
      spec: {
        protocol: 'reactive-md-react-spec/v1',
        source: '<static-only>',
        staticMarkupIncludes: ['data-static'],
      },
    });
    expect(absent.cases.find((item) => item.id === 'react.ssr')?.status).toBe('unsupported');
    const report = createLocalComplianceReport({
      config: staticConfig,
      component: 'static-only',
      suites: [absent],
      capabilities: ['static', 'ssr'],
    });
    expect(report.ok).toBe(false);
    expect(report.capabilities.find((item) => item.capability === 'ssr')?.status).toBe('unsupported');
  });

  it('rejects contradictory or unbounded React specs', () => {
    expect(() => readLocalReactSpec({
      protocol: 'reactive-md-react-spec/v1',
      source,
      staticMarkupIncludes: ['x'],
      staticMarkupExcludes: ['x'],
    })).toThrow(/requires and forbids/);
    expect(() => readLocalReactSpec({
      protocol: 'reactive-md-react-spec/v1',
      source,
      staticMarkupIncludes: Array.from({ length: 30 }, (_, index) => `p${index}`),
    })).toThrow(/at most/);
  });
});
