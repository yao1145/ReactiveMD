import type { LocalBuildAsset, LocalStandaloneBuild } from '../build';
import type { LocalReactPackage } from '../react/package';
import type { LocalThemePackage } from '../sdk/theme';
import type { DirectoryDiscovery } from './discovery';

/**
 * Browser-safe registration helpers for directory mode.
 *
 * The Vite adapter turns one discovery snapshot into one generated module.
 * That module is the only registration source for the page, the Worker
 * configuration, SSR and the embedded offline build. Everything here must stay
 * free of Node built-ins: the generated module is bundled for the browser.
 */

/** Plain discovery facts exposed for verification; never functions or config. */
export interface DiscoveryMetadata {
  readonly files: readonly string[];
  readonly directories: readonly string[];
  readonly themes: readonly {
    readonly file: string;
    readonly id: string;
    readonly name: string;
  }[];
  readonly plugins: readonly {
    readonly file: string;
    readonly resources: readonly string[];
  }[];
  readonly assets: readonly LocalBuildAsset[];
}

export interface DirectoryRegistrationSource {
  readonly code: string;
  /** Absolute dependency paths that development and build watchers need. */
  readonly files: readonly string[];
}

export interface ComponentOwner {
  readonly file: string;
  readonly id: string;
  readonly name: string;
}

export interface ThemeOwner {
  readonly file: string;
  readonly id: string;
  readonly name: string;
}

function normalize(file: string): string {
  return file.replaceAll('\\', '/');
}

/**
 * Resolve the package exported by one `plugin/` entry module.
 *
 * A default export is preferred. Otherwise exactly one distinct named
 * `LocalReactPackage` is accepted; aliases that point at the same object are
 * deduplicated, and several distinct packages are an error instead of a silent
 * choice. Re-exporting an installed package's public entry works because this
 * reads the module namespace, not the entry source.
 */
export function readLocalReactPackage(namespace: unknown, file: string): LocalReactPackage {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const isComponent = (value: unknown): boolean => isRecord(value)
    && isRecord(value.definition)
    && typeof value.definition.id === 'string'
    && typeof value.definition.name === 'string'
    && typeof value.render === 'function';
  const isPackage = (value: unknown): value is LocalReactPackage => isRecord(value)
    && Array.isArray(value.components)
    && value.components.every(isComponent)
    && (value.resources === undefined || Array.isArray(value.resources))
    && (value.themes === undefined || Array.isArray(value.themes))
    && (value.notices === undefined || Array.isArray(value.notices));
  if (!isRecord(namespace)) {
    throw new Error(`ReactiveMD package entry ${file} did not provide a module namespace.`);
  }
  if (isPackage(namespace.default)) return namespace.default;
  const candidates: LocalReactPackage[] = [];
  const names: string[] = [];
  for (const key of Object.keys(namespace)) {
    if (key === 'default') continue;
    const value = namespace[key];
    if (!isPackage(value)) continue;
    if (!candidates.includes(value)) {
      candidates.push(value);
      names.push(key);
    }
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(
      `ReactiveMD package entry ${file} exports more than one distinct LocalReactPackage `
      + `(${names.join(', ')}); export one default package or exactly one distinct named package.`,
    );
  }
  throw new Error(
    `ReactiveMD package entry ${file} must export a LocalReactPackage as its default export `
    + 'or as exactly one distinct named export.',
  );
}

/**
 * Reject duplicate component identities and theme identities across entries.
 *
 * The first owner wins the reporting order; a later duplicate names both source
 * entries so neither is silently overwritten.
 */
export function assertUniqueRegistration(
  components: readonly ComponentOwner[],
  themes: readonly ThemeOwner[],
): void {
  const componentIds = new Map<string, string>();
  const componentNames = new Map<string, string>();
  for (const item of components) {
    const priorId = componentIds.get(item.id);
    if (priorId !== undefined) {
      throw new Error(`ReactiveMD component id "${item.id}" is declared by ${priorId} and ${item.file}.`);
    }
    componentIds.set(item.id, item.file);
    const priorName = componentNames.get(item.name);
    if (priorName !== undefined) {
      throw new Error(`ReactiveMD component tag <${item.name}> is declared by ${priorName} and ${item.file}.`);
    }
    componentNames.set(item.name, item.file);
  }
  const themeIds = new Map<string, string>();
  const themeNames = new Map<string, string>();
  for (const item of themes) {
    const priorId = themeIds.get(item.id);
    if (priorId !== undefined) {
      throw new Error(`ReactiveMD theme id "${item.id}" is declared by ${priorId} and ${item.file}.`);
    }
    themeIds.set(item.id, item.file);
    const priorName = themeNames.get(item.name);
    if (priorName !== undefined) {
      throw new Error(`ReactiveMD theme name "${item.name}" is declared by ${priorName} and ${item.file}.`);
    }
    themeNames.set(item.name, item.file);
  }
}

/** Serialize discovery facts without functions or derived config. */
export function discoveryMetadata(discovery: DirectoryDiscovery): DiscoveryMetadata {
  return {
    files: Object.freeze(discovery.files.map(normalize)),
    directories: Object.freeze(discovery.directories.map(normalize)),
    themes: Object.freeze(discovery.themes.map((item) => Object.freeze({
      file: normalize(item.file),
      id: item.theme.id,
      name: item.theme.name,
    }))),
    plugins: Object.freeze(discovery.plugins.map((item) => Object.freeze({
      file: normalize(item.file),
      resources: Object.freeze(item.resources.map((resource) => resource.id)),
    }))),
    assets: Object.freeze(discovery.assets.map((asset) => Object.freeze({
      path: asset.path,
      digest: asset.digest,
      bytes: asset.bytes,
      mime: asset.mime,
    }))),
  };
}

/**
 * Generate the single registration module used by every consumer.
 *
 * Themes are plain data, so the snapshot is embedded directly. Plugin entry
 * modules are imported so their packages and implementations stay live under
 * the normal Vite dependency graph. The generated module exports mutable
 * bindings so a theme stylesheet refresh can replace the host without
 * rebuilding the document runtime; the SDK host itself stays frozen.
 */
export function createDirectoryRegistration(
  discovery: DirectoryDiscovery,
  styleId: string,
): DirectoryRegistrationSource {
  const themes = discovery.themes.map((item) => Object.freeze({
    file: normalize(item.file),
    theme: item.theme,
  }));
  const plugins = discovery.plugins.map((item) => Object.freeze({
    file: normalize(item.file),
    resources: item.resources,
  }));
  const imports = plugins
    .map((item, index) => `import * as __rmdPlugin${index} from ${JSON.stringify(item.file)};`)
    .join('\n');
  const pluginTable = plugins
    .map((item, index) => `  { file: ${JSON.stringify(item.file)}, namespace: __rmdPlugin${index}, resources: ${JSON.stringify(item.resources)} }`)
    .join(',\n');
  const metadata = discoveryMetadata(discovery);
  const readerSource = readLocalReactPackage.toString().replace(/^export\s+/, '');
  const ownerSource = assertUniqueRegistration.toString().replace(/^export\s+/, '');
  const code = `${imports}
import { createReactHost } from "reactive-md/react";

const __rmdReadPackage = ${readerSource};

const __rmdAssertUnique = ${ownerSource};

const __rmdThemeEntries = ${JSON.stringify(themes)};
const __rmdPluginEntries = [
${pluginTable}
];
export let discovery = ${JSON.stringify(metadata)};
export const extensions = Object.freeze({});

function __rmdCompose(directoryEntries) {
  const packages = [];
  const components = [];
  const themeOwners = [];
  for (const entry of __rmdPluginEntries) {
    const pkg = __rmdReadPackage(entry.namespace, entry.file);
    const resources = [...(pkg.resources ?? []), ...entry.resources];
    packages.push({ ...pkg, resources });
    for (const component of pkg.components) {
      const definition = component && component.definition;
      if (!definition || typeof definition.id !== "string" || typeof definition.name !== "string") {
        throw new Error("ReactiveMD package entry " + entry.file + " contains a component without a manifest id and name.");
      }
      components.push({ file: entry.file, id: definition.id, name: definition.name });
    }
    for (const theme of pkg.themes ?? []) {
      themeOwners.push({ file: entry.file, id: theme.id, name: theme.name });
    }
  }
  for (const entry of directoryEntries) {
    themeOwners.push({ file: entry.file, id: entry.theme.id, name: entry.theme.name });
  }
  __rmdAssertUnique(components, themeOwners);
  const notices = [];
  for (const entry of __rmdPluginEntries) {
    if (Array.isArray(entry.namespace.notices)) notices.push(...entry.namespace.notices);
  }
  const themes = directoryEntries.map((entry) => entry.theme);
  const host = createReactHost({ packages, themes, notices });
  return { host };
}

let __rmdState = __rmdCompose(__rmdThemeEntries);
export let host = __rmdState.host;
export let config = host.config;
export let reactConfig = host.reactConfig;
export let resources = host.resources;
export let css = host.css;
export let notices = host.notices;
let __rmdStyle;
if (typeof document !== "undefined") {
  __rmdStyle = document.createElement("style");
  __rmdStyle.dataset.reactiveMdHost = ${JSON.stringify(styleId)};
  __rmdStyle.textContent = css;
  document.head.append(__rmdStyle);
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => { __rmdStyle?.remove(); });
  import.meta.hot.on("reactive-md:themes", (payload) => {
    if (!payload || !Array.isArray(payload.themes)) return;
    __rmdState = __rmdCompose(payload.themes);
    host = __rmdState.host;
    config = host.config;
    reactConfig = host.reactConfig;
    resources = host.resources;
    css = host.css;
    notices = host.notices;
    if (payload.discovery !== undefined) discovery = payload.discovery;
    if (__rmdStyle) __rmdStyle.textContent = css;
  });
}
`;
  return Object.freeze({
    code,
    files: Object.freeze(discovery.files.map(normalize)),
  });
}

/**
 * Merge scanner assets into the offline build result. Later entries never
 * replace a collector asset with the same path; the merged list drives both
 * `bundle.assets` and the manifest's `inlinedAssets`.
 */
export function mergeDiscoveredAssets(
  bundle: LocalStandaloneBuild,
  assets: readonly LocalBuildAsset[],
): LocalStandaloneBuild {
  if (assets.length === 0) return bundle;
  const byPath = new Map(bundle.assets.map((asset) => [asset.path, asset] as const));
  let added = false;
  for (const asset of assets) {
    const existing = byPath.get(asset.path);
    if (existing) {
      if (existing.digest !== asset.digest || existing.bytes !== asset.bytes || existing.mime !== asset.mime) {
        throw new Error('ReactiveMD asset ' + asset.path + ' has conflicting contents.');
      }
      continue;
    }
    byPath.set(asset.path, asset);
    added = true;
  }
  if (!added) return bundle;
  const merged = Object.freeze([...byPath.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return Object.freeze({
    ...bundle,
    assets: merged,
    manifest: Object.freeze({ ...bundle.manifest, inlinedAssets: merged }),
  });
}

/** Theme entries from one snapshot, for the development refresh payload. */
export function discoveredThemes(discovery: DirectoryDiscovery): readonly {
  readonly file: string;
  readonly theme: LocalThemePackage;
}[] {
  return Object.freeze(discovery.themes.map((item) => Object.freeze({
    file: normalize(item.file),
    theme: item.theme,
  })));
}
