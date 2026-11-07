import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createLocalConfig } from '../sdk/config';
import type { LocalConfig } from '../sdk/types';
import {
  defineLocalTheme,
  type LocalStyleResource,
  type LocalThemeInput,
  type LocalThemePackage,
} from '../sdk/theme';
import {
  DEFAULT_LOCAL_BUILD_BUDGETS,
  collectLocalBuildResources,
  type CollectedLocalResources,
  type LocalBuildAsset,
  type LocalBuildBudgets,
  type LocalStyleResourceInput,
} from '../build/resources';

/**
 * Directory-driven discovery for the Vite adapter.
 *
 * The scheme is intentionally small and explicit:
 *
 * - `theme/<folder>/theme.css` is a theme. `theme/<folder>/theme.json` may
 *   override `id`, `name`, `version`, `protocol` and `colorSchemes`; defaults
 *   are `local/theme/<folder>`, `<folder>`, `0.0.0` and both color schemes.
 * - `plugin/<folder>/index.{ts,tsx,js,jsx,mts,mjs}` is a plugin entry. Exactly
 *   one entry per folder is allowed. `plugin/<folder>/component.css` is an
 *   optional structural stylesheet.
 *
 * Only those conventional files are inspected. Plugin entries are returned as
 * paths and are never imported here; evaluating them belongs to the adapter
 * that builds the registration module.
 *
 * CSS is inlined through `collectLocalBuildResources`, so local `@import`
 * targets and `url()` assets are resolved under the project root, traversal
 * and remote URLs are rejected, and every file read is bounded by
 * `DEFAULT_LOCAL_BUILD_BUDGETS`. The collector exposes no dependency list, so
 * its bounded asset list is the dependency/watch record; the absolute file
 * paths derived from it are returned in `files`.
 */

export interface DiscoveryOptions {
  readonly themeDir?: string;
  readonly pluginDir?: string;
}

export interface DiscoveredTheme {
  readonly file: string;
  readonly theme: LocalThemePackage;
}

export interface DiscoveredPlugin {
  readonly file: string;
  readonly resources: readonly LocalStyleResource[];
}

export interface DirectoryDiscovery {
  readonly themes: readonly DiscoveredTheme[];
  readonly plugins: readonly DiscoveredPlugin[];
  readonly files: readonly string[];
  readonly directories: readonly string[];
  readonly assets: readonly LocalBuildAsset[];
}

const DEFAULT_THEME_DIR = 'theme';
const DEFAULT_PLUGIN_DIR = 'plugin';
const THEME_STYLESHEET = 'theme.css';
const THEME_METADATA = 'theme.json';
const COMPONENT_STYLESHEET = 'component.css';

/** Entry names are ordered as documented; ambiguity errors list this order. */
const PLUGIN_ENTRIES = Object.freeze([
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.mts',
  'index.mjs',
]);

const THEME_METADATA_KEYS = new Set(['id', 'name', 'version', 'protocol', 'colorSchemes']);

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function posixRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonical project root; a missing root keeps its normalized lexical path. */
async function canonicalRoot(root: string): Promise<string> {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('discoverDirectories requires a project root path.');
  }
  const normalized = resolve(root);
  try {
    return await realpath(normalized);
  } catch {
    return normalized;
  }
}

async function resolveScanDirectory(
  root: string,
  value: string | undefined,
  fallback: string,
  label: string,
): Promise<string> {
  const candidate = value ?? fallback;
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty directory path.`);
  }
  const directory = resolve(root, candidate);
  if (!isInside(root, directory)) {
    throw new Error(`${label} "${candidate}" resolves outside the project root.`);
  }
  // A missing directory keeps its lexical path so watchers can observe creation.
  let real: string;
  try {
    real = await realpath(directory);
  } catch {
    return directory;
  }
  if (!isInside(root, real)) {
    throw new Error(`${label} "${candidate}" resolves outside the project root through a symbolic link.`);
  }
  return real;
}

/** Immediate child directories only. Missing roots scan as empty. */
async function childDirectories(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw new Error(`Cannot scan ${directory}: ${messageOf(error)}`);
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name))
    .sort(compareCodeUnits);
}

async function isFile(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch {
    return false;
  }
}

/** Read optional theme metadata under the shared file budget. */
async function readThemeMetadata(file: string): Promise<Record<string, unknown> | null> {
  let info: Stats;
  try {
    info = await stat(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new Error(`Theme metadata ${file} is not readable: ${messageOf(error)}`);
  }
  if (!info.isFile()) return null;
  if (info.size > DEFAULT_LOCAL_BUILD_BUDGETS.maxFileBytes) {
    throw new Error(
      `Theme metadata ${file} exceeds the ${DEFAULT_LOCAL_BUILD_BUDGETS.maxFileBytes}-byte budget.`,
    );
  }
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Theme metadata ${file} is not readable: ${messageOf(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid theme metadata ${file}: ${messageOf(error)}`);
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid theme metadata ${file}: must be a JSON object.`);
  }
  for (const key of Object.keys(value)) {
    if (!THEME_METADATA_KEYS.has(key)) {
      throw new Error(`Invalid theme metadata ${file}: unsupported key "${key}".`);
    }
  }
  return value;
}

function summarizeDiagnostics(collected: CollectedLocalResources): string {
  return collected.diagnostics
    .map((item) => `[${item.code}] ${item.message}`)
    .join('\n');
}

/** Inline one stylesheet through the shared collector; errors name the file. */
async function inlineStylesheet(
  file: string,
  id: string,
  root: string,
  config: LocalConfig,
  budgets: LocalBuildBudgets,
): Promise<{ css: string; assets: readonly LocalBuildAsset[] }> {
  const declared: readonly LocalStyleResourceInput[] = Object.freeze([
    Object.freeze({ id, path: posixRelative(root, file) }),
  ]);
  const collected = await collectLocalBuildResources({
    config,
    declared,
    root,
    allowlist: Object.freeze([root]),
    budgets,
  });
  if (collected.diagnostics.length > 0) {
    throw new Error(`Cannot inline ${file}:\n${summarizeDiagnostics(collected)}`);
  }
  const resource = collected.resources.find((item) => item.id === id);
  if (!resource) {
    throw new Error(`Cannot inline ${file}: the stylesheet was not collected.`);
  }
  return { css: resource.css, assets: collected.assets };
}

function metadataField(
  metadata: Record<string, unknown> | null,
  key: string,
): unknown {
  return metadata !== null && Object.hasOwn(metadata, key) ? metadata[key] : undefined;
}

function buildThemeInput(
  folder: string,
  resourceId: string,
  css: string,
  metadata: Record<string, unknown> | null,
): LocalThemeInput {
  const id = metadataField(metadata, 'id');
  const name = metadataField(metadata, 'name');
  const version = metadataField(metadata, 'version');
  const protocol = metadataField(metadata, 'protocol');
  const colorSchemes = metadataField(metadata, 'colorSchemes');
  return {
    id: id === undefined ? `local/theme/${folder}` : id,
    name: name === undefined ? folder : name,
    version: version === undefined ? '0.0.0' : version,
    ...(protocol === undefined ? {} : { protocol }),
    ...(colorSchemes === undefined ? {} : { colorSchemes }),
    css: [{ id: resourceId, css }],
  } as unknown as LocalThemeInput;
}

function mergeAsset(assets: Map<string, LocalBuildAsset>, asset: LocalBuildAsset): void {
  const previous = assets.get(asset.path);
  if (previous !== undefined) {
    if (previous.digest !== asset.digest || previous.bytes !== asset.bytes || previous.mime !== asset.mime) {
      throw new Error(`Resource ${asset.path} was read with conflicting contents.`);
    }
    return;
  }
  assets.set(asset.path, asset);
}

/**
 * Discover themes and plugins beneath a project root. Results and every nested
 * package/resource are frozen, sorted by path, and independent of the current
 * working directory. Missing roots produce empty results, but their normalized
 * paths remain in `directories` so a watcher can observe later creation.
 */
export async function discoverDirectories(
  root: string,
  options: DiscoveryOptions = {},
): Promise<DirectoryDiscovery> {
  const projectRoot = await canonicalRoot(root);
  const themeRoot = await resolveScanDirectory(projectRoot, options.themeDir, DEFAULT_THEME_DIR, 'themeDir');
  const pluginRoot = await resolveScanDirectory(projectRoot, options.pluginDir, DEFAULT_PLUGIN_DIR, 'pluginDir');
  const budgets = DEFAULT_LOCAL_BUILD_BUDGETS;
  const config = createLocalConfig();

  const files = new Set<string>();
  const directories = new Set<string>([themeRoot, pluginRoot]);
  const assets = new Map<string, LocalBuildAsset>();
  const themes: DiscoveredTheme[] = [];
  const plugins: DiscoveredPlugin[] = [];
  const themeSources = new Map<string, string>();

  async function recordAssets(collectedAssets: readonly LocalBuildAsset[]): Promise<void> {
    for (const asset of collectedAssets) {
      mergeAsset(assets, asset);
      files.add(resolve(projectRoot, asset.path));
    }
  }

  // Themes: one immediate child directory per theme, identified by theme.css.
  const themeDirectories = await childDirectories(themeRoot);
  for (const directory of themeDirectories) directories.add(directory);
  for (const directory of themeDirectories) {
    const stylesheet = join(directory, THEME_STYLESHEET);
    if (!(await isFile(stylesheet))) continue;
    const folder = basename(directory);
    const resourceId = `directory-theme/${folder}.css`;
    const inlined = await inlineStylesheet(stylesheet, resourceId, projectRoot, config, budgets);
    files.add(stylesheet);
    await recordAssets(inlined.assets);

    const metadataFile = join(directory, THEME_METADATA);
    const metadata = await readThemeMetadata(metadataFile);
    // Optional metadata is always a watch candidate, even before it exists.
    files.add(metadataFile);

    let theme: LocalThemePackage;
    try {
      theme = defineLocalTheme(buildThemeInput(folder, resourceId, inlined.css, metadata));
    } catch (error) {
      const source = metadata === null ? stylesheet : metadataFile;
      throw new Error(`Invalid theme ${source}: ${messageOf(error)}`);
    }
    themes.push(Object.freeze({
      file: stylesheet,
      theme,
    }));
    themeSources.set(stylesheet, metadata === null ? stylesheet : metadataFile);
  }

  themes.sort((left, right) => compareCodeUnits(left.file, right.file));

  const names = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const discovered of themes) {
    const source = themeSources.get(discovered.file) ?? discovered.file;
    const previousName = names.get(discovered.theme.name);
    if (previousName !== undefined) {
      throw new Error(
        `Theme name "${discovered.theme.name}" is declared by both ${previousName} and ${source}.`,
      );
    }
    names.set(discovered.theme.name, source);
    const previousId = ids.get(discovered.theme.id);
    if (previousId !== undefined) {
      throw new Error(
        `Theme id "${discovered.theme.id}" is declared by both ${previousId} and ${source}.`,
      );
    }
    ids.set(discovered.theme.id, source);
  }

  // Plugins: one immediate child directory per plugin, identified by its entry.
  const pluginDirectories = await childDirectories(pluginRoot);
  for (const directory of pluginDirectories) directories.add(directory);
  for (const directory of pluginDirectories) {
    const entries: string[] = [];
    for (const name of PLUGIN_ENTRIES) {
      const candidate = join(directory, name);
      if (await isFile(candidate)) entries.push(candidate);
    }
    if (entries.length === 0) continue;
    if (entries.length > 1) {
      throw new Error(
        `Plugin directory ${directory} declares more than one entry: ${entries.join(', ')}.`,
      );
    }
    const entry = entries[0];
    const folder = basename(directory);
    files.add(entry);

    const stylesheet = join(directory, COMPONENT_STYLESHEET);
    // The optional stylesheet stays a watch candidate even when absent.
    files.add(stylesheet);
    const resources: LocalStyleResource[] = [];
    if (await isFile(stylesheet)) {
      const resourceId = `directory-plugin/${folder}.css`;
      const inlined = await inlineStylesheet(stylesheet, resourceId, projectRoot, config, budgets);
      await recordAssets(inlined.assets);
      resources.push(Object.freeze({ id: resourceId, css: inlined.css }));
    }
    plugins.push(Object.freeze({
      file: entry,
      resources: Object.freeze(resources),
    }));
  }

  plugins.sort((left, right) => compareCodeUnits(left.file, right.file));

  const sortedAssets = [...assets.values()].sort((left, right) => compareCodeUnits(left.path, right.path));
  return Object.freeze({
    themes: Object.freeze(themes),
    plugins: Object.freeze(plugins),
    files: Object.freeze(sortedUnique(files)),
    directories: Object.freeze(sortedUnique(directories)),
    assets: Object.freeze(sortedAssets),
  });
}
