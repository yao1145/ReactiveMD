import { createShareableHtml, type ShareableHtmlOptions } from '../shareable';
import { readLocalConfig } from '../sdk/config';
import { localComponentDigest } from '../sdk/manifest';
import { getLocalComponentRegistry } from '../sdk/registry';
import type { LocalStyleResource } from '../sdk/theme';
import type { LocalConfig, LocalExtensionRequirements } from '../sdk/types';
import type { Diagnostic, LocalDocument } from '../local/types';
import {
  extensionDiagnostic,
  validateLocalComponentContracts,
  validateLocalExtensionRequirements,
} from './requirements';

export {
  validateLocalComponentContracts,
  validateLocalExtensionRequirements,
} from './requirements';

export type LocalExportTarget = 'static' | 'ssr' | 'offline';

/** A trusted host build artifact, never reconstructed from function.toString(). */
export interface LocalStandaloneBundle {
  readonly script: string;
  readonly extensions: LocalExtensionRequirements;
}

export interface LocalExportPlan {
  readonly target: LocalExportTarget;
  readonly extensions: LocalExtensionRequirements;
  readonly resources: readonly LocalStyleResource[];
  readonly css: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly ok: boolean;
}

export interface LocalExportPlanOptions {
  readonly document: LocalDocument;
  readonly config: LocalConfig;
  readonly target: LocalExportTarget;
  readonly resources?: readonly LocalStyleResource[];
  /** Resource identities declared by the host build's component style manifest. */
  readonly requiredResources?: readonly string[];
  readonly bundle?: LocalStandaloneBundle;
}

/** Bind an explicitly built standalone script to the installed manifest set. */
export function defineLocalStandaloneBundle(script: string, config: LocalConfig): LocalStandaloneBundle {
  const installed = readLocalConfig(config);
  if (typeof script !== 'string' || !script.trim() || script.length > 32 * 1024 * 1024) {
    throw new TypeError('A standalone bundle must contain a nonempty script of at most 32 MiB.');
  }
  return Object.freeze({
    script,
    extensions: Object.freeze({
      protocol: 'reactive-md-extensions/v1' as const,
      components: Object.freeze(installed.components.map(definition => Object.freeze({
        id: definition.id, name: definition.name, version: definition.version, digest: localComponentDigest(definition),
      }))),
    }),
  });
}

/** Preflight a target before state serialization or any output is generated. */
export function createLocalExportPlan(options: LocalExportPlanOptions): LocalExportPlan {
  const config = readLocalConfig(options.config);
  const requirements: LocalExtensionRequirements = options.document.extensions ?? {
    protocol: 'reactive-md-extensions/v1', components: [],
  };
  const diagnostics = validateLocalExtensionRequirements(requirements, config);
  diagnostics.push(...validateLocalComponentContracts({
    document: options.document,
    installed: getLocalComponentRegistry(config),
    externalNames: new Set(config.components.map(definition => definition.name)),
  }));
  const requiredResources = new Set(options.requiredResources ?? []);
  const target = options.target;
  if (!['static', 'ssr', 'offline'].includes(target)) throw new TypeError('Unknown export target.');
  for (const requirement of requirements.components) {
    const component = config.components.find(item => item.id === requirement.id);
    if (!component) continue;
    for (const id of component.styles ?? []) requiredResources.add(id);
    const needed = target === 'offline' ? ['static', 'interactive', 'offline'] as const : [target] as const;
    for (const capability of needed) {
      if (!component.capabilities[capability]) diagnostics.push(extensionDiagnostic(
        'local.extension.export-capability', `${component.id}@${component.version} does not support ${capability} for ${target} export.`,
      ));
    }
  }
  if (target === 'offline') {
    if (!options.bundle?.script?.trim()) {
      diagnostics.push(extensionDiagnostic('local.extension.bundle-missing', 'Offline output requires an explicitly built standalone bundle.'));
    } else {
      diagnostics.push(...validateLocalExtensionRequirements(options.bundle.extensions, config));
      for (const entry of requirements.components) {
        if (!options.bundle.extensions.components.some(item => item.id === entry.id && item.digest === entry.digest)) {
          diagnostics.push(extensionDiagnostic('local.extension.bundle-mismatch', `The standalone bundle does not include ${entry.id}@${entry.version}.`));
        }
      }
    }
  }
  const themeName = options.document.theme ?? 'default';
  const theme = config.themes.find(item => item.name === themeName);
  if (themeName !== 'default' && !theme) diagnostics.push(extensionDiagnostic(
    'local.extension.theme-missing', `Theme ${themeName} is not installed for export.`,
  ));
  const resources = new Map<string, LocalStyleResource>();
  let bytes = 0;
  for (const resource of [...(options.resources ?? []), ...(theme?.css ?? [])]) {
    if (!resource || typeof resource.id !== 'string' || !resource.id || resource.id.length > 256
      || typeof resource.css !== 'string' || !isInlineExportCss(resource.css)) {
      diagnostics.push(extensionDiagnostic('local.extension.resource-invalid', 'Export styles must be identified inline CSS without network resources.'));
      continue;
    }
    const previous = resources.get(resource.id);
    if (previous && previous.css !== resource.css) diagnostics.push(extensionDiagnostic(
      'local.extension.resource-conflict', `Style resource ${resource.id} has conflicting contents.`,
    ));
    if (!previous) {
      bytes += new TextEncoder().encode(resource.css).byteLength;
      resources.set(resource.id, Object.freeze({ ...resource }));
    }
  }
  for (const id of requiredResources) {
    if (!resources.has(id)) diagnostics.push(extensionDiagnostic('local.extension.resource-missing', `Required style resource ${id} is missing.`));
  }
  if (resources.size > 128 || bytes > 4 * 1024 * 1024) diagnostics.push(extensionDiagnostic(
    'local.extension.resource-budget', 'Export styles exceed 128 resources or 4 MiB.',
  ));
  // Component defaults precede theme enhancements; each list retains its order.
  const collected = Object.freeze([...resources.values()]);
  return Object.freeze({
    target, extensions: requirements, resources: collected,
    css: collected.map(item => item.css).join('\n'), diagnostics: Object.freeze(diagnostics), ok: diagnostics.length === 0,
  });
}

function isInlineExportCss(css: string): boolean {
  // Escaped CSS tokens can disguise imports and URL schemes. The phase-one
  // resource contract accepts literal CSS tokens and inline data resources.
  if (/\\|@import\b/i.test(css)) return false;
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of plain.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    if (!/^data:/i.test((match[1] ?? match[2] ?? match[3]).trim())) return false;
  }
  return true;
}

export interface LocalExtensionShareableOptions extends Omit<ShareableHtmlOptions, 'runtimeScript' | 'extensions'> {
  readonly document: LocalDocument;
  readonly config: LocalConfig;
  readonly bundle?: LocalStandaloneBundle;
  readonly resources?: readonly LocalStyleResource[];
  readonly requiredResources?: readonly string[];
}

/** First-phase export: the host supplies its prebuilt implementation bundle. */
export function createLocalShareableHtml(options: LocalExtensionShareableOptions): string {
  if (options.document.source !== options.source) throw new TypeError('The compiled document does not belong to this source.');
  const config = readLocalConfig(options.config);
  if (options.compileOptions?.hostComponents !== undefined
    || (options.compileOptions?.config && readLocalConfig(options.compileOptions.config).key !== config.key)) {
    throw new TypeError('Conflicting export component configuration.');
  }
  const plan = createLocalExportPlan({ ...options, target: options.mode === 'static' ? 'static' : 'offline' });
  if (!plan.ok) throw new TypeError(plan.diagnostics.map(item => `[${item.code}] ${item.message}`).join('\n'));
  if (/data-rmd-extension-error\s*=|local-sdk-unavailable/.test(options.staticMarkup)) {
    throw new TypeError('Static output contains an unavailable extension component.');
  }
  const html = createShareableHtml({
    ...options,
    compileOptions: { ...options.compileOptions, config },
    extensions: plan.extensions,
    runtimeScript: options.bundle?.script,
    css: `${options.css}\n${plan.css}`,
  });
  return html;
}
