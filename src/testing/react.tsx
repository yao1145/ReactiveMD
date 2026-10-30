import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { compileLocal } from '../local/compiler';
import { LocalDocumentView } from '../local/LocalDocumentView';
import { createLocalRuntime } from '../local/runtime';
import type { Diagnostic, LocalNode } from '../local/types';
import { readLocalConfig } from '../sdk/config';
import { getLocalComponentRegistry } from '../sdk/registry';
import type { LocalComponentDefinition, LocalConfig } from '../sdk/types';
import type { LocalStyleResource } from '../sdk/theme';
import type { LocalReactConfig } from '../react/sdk';
import { renderLocalStaticDocument } from '../react/server';
import { failed, passed, skipped, unsupported } from './cases';
import {
  LOCAL_COMPLIANCE_PROTOCOL,
  LOCAL_REACT_SPEC_PROTOCOL,
  MAX_LOCAL_COMPLIANCE_MARKUP_PATTERNS,
  MAX_LOCAL_COMPLIANCE_SOURCE_LENGTH,
  MAX_LOCAL_COMPLIANCE_STRING_LENGTH,
  type LocalComplianceCaseResult,
  type LocalComplianceSuiteResult,
} from './types';
import {
  checkKeys,
  readErrorMessage,
  readString,
  readStringList,
  requireRecord,
} from './values';

export interface LocalReactErrorProbe {
  readonly source: string;
  /** Defaults to the main config/react config. */
  readonly config?: LocalConfig;
  readonly reactConfig?: LocalReactConfig;
  /** Expected diagnostic code; defaults to `local.extension.ssr-render`. */
  readonly code?: string;
  readonly messageIncludes?: string;
}

export interface LocalReactComplianceSpec {
  readonly protocol: typeof LOCAL_REACT_SPEC_PROTOCOL;
  readonly source: string;
  readonly staticMarkupIncludes?: readonly string[];
  readonly staticMarkupExcludes?: readonly string[];
  readonly ssrMarkupIncludes?: readonly string[];
  readonly ssrMarkupExcludes?: readonly string[];
  readonly error?: LocalReactErrorProbe;
}

export interface LocalReactComplianceOptions {
  readonly resources?: readonly LocalStyleResource[];
  readonly config: LocalConfig | unknown;
  readonly reactConfig: LocalReactConfig;
  /** Tag name under test. */
  readonly component: string;
  readonly spec: LocalReactComplianceSpec | unknown;
  readonly locale?: 'en' | 'zh';
}

const SPEC_KEYS = new Set([
  'protocol', 'source', 'staticMarkupIncludes', 'staticMarkupExcludes',
  'ssrMarkupIncludes', 'ssrMarkupExcludes', 'error',
]);
const ERROR_KEYS = new Set(['source', 'config', 'reactConfig', 'code', 'messageIncludes']);
const COMPONENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const UNAVAILABLE = /data-rmd-extension-error\s*=|local-sdk-unavailable/;

function readPatterns(value: unknown, path: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const patterns = readStringList(value, path, MAX_LOCAL_COMPLIANCE_MARKUP_PATTERNS);
  for (const pattern of patterns) {
    if (pattern.length === 0) throw new TypeError(`${path} must not contain empty strings.`);
  }
  return patterns;
}

function readErrorProbe(value: unknown): LocalReactErrorProbe {
  const record = requireRecord(value, 'spec.error');
  checkKeys(record, ERROR_KEYS, 'spec.error');
  if (record.source === undefined) throw new TypeError('spec.error.source is required.');
  const source = readString(record.source, 'spec.error.source', MAX_LOCAL_COMPLIANCE_SOURCE_LENGTH);
  if (source.trim() === '') throw new TypeError('spec.error.source must not be empty.');
  let config: LocalConfig | undefined;
  if (record.config !== undefined) config = readLocalConfig(record.config);
  let reactConfig: LocalReactConfig | undefined;
  if (record.reactConfig !== undefined) {
    const react = requireRecord(record.reactConfig, 'spec.error.reactConfig') as Partial<LocalReactConfig>;
    if (!react.config || typeof react !== 'object') {
      throw new TypeError('spec.error.reactConfig must expose a config object.');
    }
    reactConfig = record.reactConfig as LocalReactConfig;
  }
  const code = record.code === undefined ? undefined : readString(record.code, 'spec.error.code', 128);
  const messageIncludes = record.messageIncludes === undefined
    ? undefined
    : readString(record.messageIncludes, 'spec.error.messageIncludes', MAX_LOCAL_COMPLIANCE_STRING_LENGTH);
  return Object.freeze({
    source,
    ...(config === undefined ? {} : { config }),
    ...(reactConfig === undefined ? {} : { reactConfig }),
    ...(code === undefined ? {} : { code }),
    ...(messageIncludes === undefined ? {} : { messageIncludes }),
  });
}

/** Validate a React/SSR compliance spec before rendering anything. */
export function readLocalReactSpec(value: unknown): LocalReactComplianceSpec {
  const record = requireRecord(value, 'spec');
  checkKeys(record, SPEC_KEYS, 'spec');
  if (record.protocol !== LOCAL_REACT_SPEC_PROTOCOL) {
    throw new TypeError(`spec.protocol must be "${LOCAL_REACT_SPEC_PROTOCOL}".`);
  }
  const source = readString(record.source, 'spec.source', MAX_LOCAL_COMPLIANCE_SOURCE_LENGTH);
  if (source.trim() === '') throw new TypeError('spec.source must not be empty.');
  const staticIncludes = readPatterns(record.staticMarkupIncludes, 'spec.staticMarkupIncludes');
  const staticExcludes = readPatterns(record.staticMarkupExcludes, 'spec.staticMarkupExcludes');
  const ssrIncludes = readPatterns(record.ssrMarkupIncludes, 'spec.ssrMarkupIncludes');
  const ssrExcludes = readPatterns(record.ssrMarkupExcludes, 'spec.ssrMarkupExcludes');
  for (const [includes, excludes] of [
    [staticIncludes, staticExcludes],
    [ssrIncludes, ssrExcludes],
  ] as const) {
    for (const pattern of includes ?? []) {
      if (excludes?.includes(pattern)) {
        throw new TypeError(`spec requires and forbids markup "${pattern}" at the same time.`);
      }
    }
  }
  const error = record.error === undefined ? undefined : readErrorProbe(record.error);
  return Object.freeze({
    protocol: LOCAL_REACT_SPEC_PROTOCOL,
    source,
    ...(staticIncludes === undefined ? {} : { staticMarkupIncludes: staticIncludes }),
    ...(staticExcludes === undefined ? {} : { staticMarkupExcludes: staticExcludes }),
    ...(ssrIncludes === undefined ? {} : { ssrMarkupIncludes: ssrIncludes }),
    ...(ssrExcludes === undefined ? {} : { ssrMarkupExcludes: ssrExcludes }),
    ...(error === undefined ? {} : { error }),
  });
}

function findNodes(nodes: readonly LocalNode[], name: string): LocalNode[] {
  const found: LocalNode[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type !== 'text' && node.name === name) found.push(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) stack.push(child);
    }
  }
  return found;
}

function checkMarkup(
  markup: string,
  includes: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  label: string,
): string[] {
  const issues: string[] = [];
  if (markup.trim() === '') issues.push(`${label} markup is empty.`);
  if (UNAVAILABLE.test(markup)) issues.push(`${label} markup contains an unavailable component placeholder.`);
  for (const pattern of includes ?? []) {
    if (!markup.includes(pattern)) issues.push(`${label} markup does not include ${JSON.stringify(pattern)}.`);
  }
  for (const pattern of excludes ?? []) {
    if (markup.includes(pattern)) issues.push(`${label} markup unexpectedly includes ${JSON.stringify(pattern)}.`);
  }
  return issues;
}

function hasErrorDiagnostic(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error');
}

/**
 * Execute static rendering, strict SSR and an optional server error probe.
 *
 * Static evidence renders the document view directly in static mode. SSR
 * evidence goes through `renderLocalStaticDocument`, which preflights declared
 * capabilities and rejects unavailable placeholders. The probe proves that a
 * failing implementation is reported as a diagnostic instead of escaping.
 */
export function runLocalReactCompliance(input: LocalReactComplianceOptions): LocalComplianceSuiteResult {
  if (!input || typeof input !== 'object') {
    throw new TypeError('runLocalReactCompliance requires an options object.');
  }
  const config = readLocalConfig(input.config);
  const spec = readLocalReactSpec(input.spec);
  const component = readString(input.component, 'component', 128);
  if (!COMPONENT_NAME.test(component)) throw new TypeError('component must be a lowercase kebab-case tag name.');
  const reactConfig = input.reactConfig;
  if (!reactConfig || typeof reactConfig !== 'object' || !reactConfig.config) {
    throw new TypeError('reactConfig must be a LocalReactConfig.');
  }
  if (readLocalConfig(reactConfig.config).key !== config.key) {
    throw new TypeError('reactConfig was built for a different LocalConfig.');
  }
  const definition = getLocalComponentRegistry(config).find((item) => item.name === component);
  const cases: LocalComplianceCaseResult[] = [];
  const ref = definition
    ? Object.freeze({ id: definition.id, name: definition.name, version: definition.version })
    : null;

  if (!definition) {
    cases.push(failed('react.component', 'react', `Component <${component}> is not installed in this configuration.`));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'react',
      configKey: config.key,
      component: ref,
      cases: Object.freeze(cases),
    });
  }
  const typedDefinition: LocalComponentDefinition = definition;

  const compiled = compileLocal(spec.source, { config });
  if (!compiled.ok) {
    cases.push(failed('react.compile', 'react', 'The compliance source did not compile.', compiled.diagnostics));
    cases.push(skipped('react.static', 'react', 'Skipped because the source did not compile.', ['static']));
    cases.push(skipped('react.ssr', 'react', 'Skipped because the source did not compile.', ['ssr']));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'react',
      configKey: config.key,
      component: ref,
      cases: Object.freeze(cases),
    });
  }
  cases.push(passed('react.compile', 'react'));
  const nodes = findNodes(compiled.document.nodes, component);
  if (nodes.length === 0) {
    cases.push(failed('react.node', 'react', `The source does not use <${component}>.`));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'react',
      configKey: config.key,
      component: ref,
      cases: Object.freeze(cases),
    });
  }
  cases.push(passed('react.node', 'react'));

  const runtime = createLocalRuntime(compiled.document);
  try {
    const locale = input.locale === 'zh' ? 'zh' : 'en';
    if (typedDefinition.capabilities.static !== true) {
      cases.push(unsupported('react.static', 'react',
        'The manifest does not declare static rendering.', ['static']));
    } else {
      const diagnostics: Diagnostic[] = [];
      try {
        const markup = renderToString(createElement(LocalDocumentView, {
          document: compiled.document,
          runtime,
          reactConfig,
          mode: 'static',
          staticFirst: false,
          locale,
          onDiagnostics(items) { diagnostics.push(...items); },
        }));
        const issues = checkMarkup(
          markup,
          spec.staticMarkupIncludes,
          spec.staticMarkupExcludes,
          'Static',
        );
        if (hasErrorDiagnostic(diagnostics)) {
          issues.push(`Static rendering reported ${diagnostics.length} diagnostics.`);
        }
        cases.push(issues.length === 0
          ? passed('react.static', 'react', {
            capabilities: ['static'],
            observed: { bytes: markup.length },
          })
          : failed('react.static', 'react', issues.join(' '), diagnostics));
      } catch (error) {
        cases.push(failed('react.static', 'react', `Static rendering threw: ${readErrorMessage(error)}`));
      }
    }

    if (typedDefinition.capabilities.ssr !== true) {
      cases.push(unsupported('react.ssr', 'react',
        'The manifest does not declare SSR.', ['ssr']));
    } else {
      const firstDiagnostics: Diagnostic[] = [];
      const secondDiagnostics: Diagnostic[] = [];
      try {
        const first = renderLocalStaticDocument({
          document: compiled.document,
          runtime,
          reactConfig,
          locale,
          resources: input.resources,
          onDiagnostics(items) { firstDiagnostics.push(...items); },
        });
        const second = renderLocalStaticDocument({
          document: compiled.document,
          runtime,
          reactConfig,
          locale,
          resources: input.resources,
          onDiagnostics(items) { secondDiagnostics.push(...items); },
        });
        const issues: string[] = [];
        if (!first.ok || !second.ok) {
          const diagnostics = [...first.diagnostics, ...second.diagnostics];
          cases.push(failed('react.ssr', 'react', 'Strict SSR execution failed.', diagnostics));
        } else {
          if (first.markup !== second.markup) {
            issues.push('Two SSR executions produced different markup.');
          }
          issues.push(...checkMarkup(
            first.markup,
            spec.ssrMarkupIncludes,
            spec.ssrMarkupExcludes,
            'SSR',
          ));
          if (hasErrorDiagnostic(firstDiagnostics) || hasErrorDiagnostic(secondDiagnostics)) {
            issues.push('SSR reported error diagnostics.');
          }
          cases.push(issues.length === 0
            ? passed('react.ssr', 'react', {
              capabilities: ['ssr'],
              observed: { bytes: first.markup.length },
            })
            : failed('react.ssr', 'react', issues.join(' ')));
        }
      } catch (error) {
        cases.push(failed('react.ssr', 'react', `SSR threw instead of returning diagnostics: ${readErrorMessage(error)}`));
      }
    }

    if (!spec.error) {
      cases.push(skipped('react.error-isolation', 'react',
        'No server error probe was supplied; error isolation is not claimed.'));
    } else {
      const probe = spec.error;
      const probeConfig = probe.config ?? config;
      const probeReact = probe.reactConfig ?? reactConfig;
      const probeCompiled = compileLocal(probe.source, { config: probeConfig });
      if (!probeCompiled.ok) {
        cases.push(failed('react.error-isolation', 'react',
          'The error probe source did not compile.', probeCompiled.diagnostics));
      } else {
        const probeRuntime = createLocalRuntime(probeCompiled.document);
        try {
          const result = renderLocalStaticDocument({
            document: probeCompiled.document,
            runtime: probeRuntime,
            reactConfig: probeReact,
            locale,
            resources: input.resources,
          });
          const expectedCode = probe.code ?? 'local.extension.ssr-render';
          const matched = !result.ok && result.diagnostics.some((item) =>
            item.code === expectedCode
            && (probe.messageIncludes === undefined
              || item.message.includes(probe.messageIncludes)));
          cases.push(matched
            ? passed('react.error-isolation', 'react')
            : failed('react.error-isolation', 'react',
              `Expected a ${expectedCode} diagnostic from the server error probe.`,
              result.ok ? [] : result.diagnostics));
        } catch (error) {
          cases.push(failed('react.error-isolation', 'react',
            `The server error probe threw instead of returning diagnostics: ${readErrorMessage(error)}`));
        } finally {
          probeRuntime.dispose();
        }
      }
    }
  } finally {
    runtime.dispose();
  }

  return Object.freeze({
    protocol: LOCAL_COMPLIANCE_PROTOCOL,
    suite: 'react',
    configKey: config.key,
    component: ref,
    cases: Object.freeze(cases),
  });
}

/** Exposed for adapters that need the same markup contract. */
export function checkLocalComplianceMarkup(
  markup: string,
  includes?: readonly string[],
  excludes?: readonly string[],
): readonly string[] {
  return Object.freeze(checkMarkup(markup, includes, excludes, 'Rendered'));
}

export const REACT_COMPLIANCE_CAPABILITIES = Object.freeze(['static', 'ssr'] as const);
