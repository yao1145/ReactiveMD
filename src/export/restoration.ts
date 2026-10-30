import type { Diagnostic, LocalDocument } from '../local/types';
import { createLocalConfig, readLocalConfig } from '../sdk/config';
import { localHash } from '../sdk/hash';
import { localComponentDigest, localJsonByteLength } from '../sdk/manifest';
import type { LocalConfig, LocalComponentRequirement } from '../sdk/types';
import type { LocalStyleResource, LocalThemePackage } from '../sdk/theme';
import { LOCAL_SDK_VERSION, localVersionSatisfies, parseLocalVersionRange } from '../sdk/version';
import { readLocalExportResources } from './resources';

export interface LocalResourceRequirement { readonly id: string; readonly digest: string }
export interface LocalVersionedComponentRequirement extends LocalComponentRequirement { readonly range: string }
export interface LocalThemeRequirement { readonly id: string; readonly name: string; readonly version: string; readonly digest: string }
export interface LocalRestorationRequirements {
  readonly protocol: 'reactive-md-restore/v1';
  readonly sdk: string;
  readonly configKey: string;
  readonly sourceDigest: string;
  readonly target: 'static' | 'ssr' | 'offline';
  readonly components: readonly LocalVersionedComponentRequirement[];
  readonly themes: readonly LocalThemeRequirement[];
  readonly resources: readonly LocalResourceRequirement[];
}
export interface LocalStandaloneBundleManifest {
  readonly protocol: 'reactive-md-bundle/v1';
  readonly sdkVersion: string;
  readonly configKey: string;
  readonly scriptDigest: string;
  readonly themes: readonly LocalThemeRequirement[];
}

/** Content identities detect mismatches; they are not a code sandbox or signature. */
export const localExportContentDigest = localHash;

export function localThemeContractDigest(theme: LocalThemePackage): string {
  return localHash(JSON.stringify([theme.id, theme.name, theme.version, theme.protocol, theme.colorSchemes, theme.css.map(({ id, css }) => [id, css])]));
}

export function createLocalBundleManifest(script: string, config: LocalConfig): LocalStandaloneBundleManifest {
  const installed = readLocalConfig(config);
  return Object.freeze({ protocol: 'reactive-md-bundle/v1', sdkVersion: LOCAL_SDK_VERSION,
    configKey: installed.key, scriptDigest: localHash(script), themes: Object.freeze(installed.themes.map(theme => Object.freeze({
      id: theme.id, name: theme.name, version: theme.version, digest: localThemeContractDigest(theme),
    }))) });
}

export function createLocalRestorationRequirements(document: LocalDocument, config: LocalConfig,
  target: LocalRestorationRequirements['target'], resources: readonly LocalStyleResource[] = []): LocalRestorationRequirements {
  const installed = readLocalConfig(config);
  const used = new Set<string>();
  const stack = [...document.nodes];
  while (stack.length) {
    const node = stack.pop()!;
    if ((node.type === 'component' || node.type === 'hostComponent') && node.name) used.add(node.name);
    if (node.children) stack.push(...node.children);
  }
  const components = installed.registry.filter(component => used.has(component.name)).map(component => Object.freeze({
    id: component.id, name: component.name, version: component.version, range: component.version, digest: localComponentDigest(component),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const themes = installed.themes.filter(theme => theme.name === document.theme).map(theme => Object.freeze({
    id: theme.id, name: theme.name, version: theme.version, digest: localThemeContractDigest(theme),
  }));
  return Object.freeze({ protocol: 'reactive-md-restore/v1', sdk: `^${LOCAL_SDK_VERSION}`,
    configKey: installed.key, sourceDigest: localHash(document.source), target,
    components: Object.freeze(components), themes: Object.freeze(themes),
    resources: Object.freeze(resources.map(resource => Object.freeze({ id: resource.id, digest: localHash(resource.css) }))),
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function boundedString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256; }

export function validateLocalRestorationRequirements(value: unknown, options: {
  readonly config?: LocalConfig;
  readonly source: string;
  readonly resources?: readonly LocalStyleResource[];
  readonly document?: LocalDocument;
}): Diagnostic[] {
  if (value === undefined) return [];
  const diagnostics: Diagnostic[] = [];
  const fail = (kind: string, message: string) => diagnostics.push({ code: `local.extension.restore-${kind}`, message,
    severity: 'error', range: { start: 0, end: 0 }, line: 1, column: 1 } as Diagnostic);
  try {
    if (!record(value) || localJsonByteLength(value) > 256 * 1024 || value.protocol !== 'reactive-md-restore/v1'
      || !boundedString(value.sdk) || !boundedString(value.configKey) || !boundedString(value.sourceDigest)
      || !['static', 'ssr', 'offline'].includes(value.target as string)
      || !Array.isArray(value.components) || value.components.length > 192
      || !Array.isArray(value.themes) || value.themes.length > 16
      || !Array.isArray(value.resources) || value.resources.length > 128) {
      fail('metadata', 'Invalid or oversized restoration requirements.');
      return diagnostics;
    }
    const allowed = new Set(['protocol', 'sdk', 'configKey', 'sourceDigest', 'target', 'components', 'themes', 'resources']);
    if (Object.keys(value).some(key => !allowed.has(key))) fail('metadata', 'Unknown restoration requirement field.');
    const config = options.config === undefined ? createLocalConfig() : readLocalConfig(options.config);
    if (!parseLocalVersionRange(value.sdk) || !localVersionSatisfies(LOCAL_SDK_VERSION, value.sdk)) fail('sdk', `SDK ${LOCAL_SDK_VERSION} does not satisfy ${value.sdk}.`);
    if (config.key !== value.configKey) fail('config', 'The installed configuration differs from the exported configuration.');
    if (localHash(options.source) !== value.sourceDigest) fail('source', 'The source differs from the exported source. Recompile before restoring state.');
    const seen = new Set<string>();
    for (const entry of value.components) {
      if (!record(entry) || !['id', 'name', 'version', 'range', 'digest'].every(key => boundedString(entry[key]))
        || !parseLocalVersionRange(entry.range) || seen.has(entry.id as string)) {
        fail('metadata', 'Invalid or duplicate component restoration requirement.'); continue;
      }
      seen.add(entry.id as string);
      const installed = config.registry.find(component => component.id === entry.id);
      if (!installed) { fail('component-missing', `Required component ${entry.id}@${entry.version} is not installed.`); continue; }
      if (!localVersionSatisfies(installed.version, entry.range as string)) fail('version', `Component ${entry.id}@${installed.version} does not satisfy ${entry.range}.`);
      if (installed.version !== entry.version || installed.name !== entry.name || localComponentDigest(installed) !== entry.digest) {
        fail('contract', `Component ${entry.id}@${entry.version} differs from the installed contract. Recompile and validate state before upgrading.`);
      }
      const capabilities = value.target === 'offline' ? ['interactive', 'static', 'offline'] as const : [value.target as 'static' | 'ssr'];
      for (const capability of capabilities) if (!installed.capabilities[capability]) fail('capability', `Component ${entry.id} cannot render ${capability}.`);
    }
    if (options.document) {
      const expected = createLocalRestorationRequirements(options.document, config, value.target as LocalRestorationRequirements['target']);
      for (const component of expected.components) if (!seen.has(component.id)) fail('component-missing', `Used component ${component.id} is missing from restoration requirements.`);
    }
    seen.clear();
    for (const entry of value.themes) {
      if (!record(entry) || !['id', 'name', 'version', 'digest'].every(key => boundedString(entry[key])) || seen.has(entry.id as string)) {
        fail('metadata', 'Invalid or duplicate theme restoration requirement.'); continue;
      }
      seen.add(entry.id as string);
      const theme = config.themes.find(theme => theme.id === entry.id);
      if (!theme || theme.name !== entry.name || theme.version !== entry.version || localThemeContractDigest(theme) !== entry.digest) fail('theme', `Required theme ${entry.id}@${entry.version} does not match the installed theme.`);
    }
    if (options.document) {
      const theme = config.themes.find(theme => theme.name === options.document!.theme);
      if (theme && !seen.has(theme.id)) fail('theme', `Selected theme ${theme.id} is missing from restoration requirements.`);
    }
    const checked = readLocalExportResources(options.resources ?? []);
    diagnostics.push(...checked.diagnostics);
    const resources = new Map(checked.resources.map(resource => [resource.id, resource.css]));
    seen.clear();
    for (const entry of value.resources) {
      if (!record(entry) || !boundedString(entry.id) || !boundedString(entry.digest) || seen.has(entry.id)) {
        fail('metadata', 'Invalid or duplicate style restoration requirement.'); continue;
      }
      seen.add(entry.id);
      const css = resources.get(entry.id);
      if (css === undefined) fail('resource-missing', `Required style resource ${entry.id} is missing before state restoration.`);
      else if (localHash(css) !== entry.digest) fail('resource-digest', `Style resource ${entry.id} differs from the exported content.`);
    }
    if (options.document) {
      const expected = createLocalRestorationRequirements(options.document, config, value.target as LocalRestorationRequirements['target']);
      const usedIds = new Set(expected.components.map(component => component.id));
      const required = config.registry.filter(component => usedIds.has(component.id)).flatMap(component => component.styles ?? []);
      required.push(...config.themes.filter(theme => theme.name === options.document!.theme).flatMap(theme => theme.css.map(resource => resource.id)));
      for (const id of required) if (!seen.has(id) || !resources.has(id)) fail('resource-missing', `Used style resource ${id} is required before state restoration.`);
    }
  } catch (error) { fail('metadata', error instanceof Error ? error.message : String(error)); }
  return diagnostics;
}
