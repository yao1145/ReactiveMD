import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Diagnostic } from '../local/types';
import type { LocalReactConfig } from '../react/sdk';
import { readLocalConfig } from '../sdk/config';
import { localComponentDigest } from '../sdk/manifest';
import type { LocalComponentDefinition, LocalConfig } from '../sdk/types';
import { buildDiagnostic } from './diagnostics';
import type { LocalBuildNoticeInput } from './notices';
import {
  readLocalStyleResourceInputs,
  type LocalStyleResourceInput,
} from './resources';

/** Options accepted by the Node host reader. Root and allowlist come from the host module. */
export interface LocalBuildHostOptions {
  readonly entry: string | URL;
  readonly resources?: readonly LocalStyleResourceInput[];
  readonly notices?: readonly LocalBuildNoticeInput[] | string;
}

export interface LocalBuildHost {
  /** Real path of the Node-loadable host entry module. */
  readonly entry: string;
  /** Real path of the declared resource root. */
  readonly root: string;
  /** Real paths of directories the builder may read resources from. */
  readonly allowlist: readonly string[];
  readonly config: LocalConfig;
  readonly reactConfig: LocalReactConfig;
  readonly declared: readonly LocalStyleResourceInput[];
  readonly notices: readonly unknown[];
}

export interface LocalBuildHostResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly host?: LocalBuildHost;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileUrlToPath(value: URL, label: string, diagnostics: Diagnostic[]): string | null {
  if (value.protocol !== 'file:') {
    diagnostics.push(buildDiagnostic('local.build.host', `${label} must be a file: URL or a path.`));
    return null;
  }
  // The host module is imported with an mtime query; strip URL metadata.
  const clean = new URL(value.href);
  clean.search = '';
  clean.hash = '';
  try {
    return fileURLToPath(clean);
  } catch {
    diagnostics.push(buildDiagnostic('local.build.host', `${label} is not a valid file: URL.`));
    return null;
  }
}

function pathFromValue(value: unknown, base: string, label: string, diagnostics: Diagnostic[]): string | null {
  if (value instanceof URL) return fileUrlToPath(value, label, diagnostics);
  if (typeof value === 'string' && value.trim().length > 0) {
    if (value.startsWith('file:')) {
      try {
        return fileUrlToPath(new URL(value), label, diagnostics);
      } catch {
        diagnostics.push(buildDiagnostic('local.build.host', `${label} is not a valid file: URL.`));
        return null;
      }
    }
    return resolve(base, value);
  }
  diagnostics.push(buildDiagnostic('local.build.host', `${label} must be a file: URL or a path.`));
  return null;
}

function pick(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function readImplementation(
  definition: LocalComponentDefinition,
  components: readonly unknown[],
  diagnostics: Diagnostic[],
): void {
  const implementation = components.find((entry) => {
    if (!isRecord(entry) || !isRecord(entry.definition)) return false;
    return entry.definition.id === definition.id;
  });
  if (!implementation || !isRecord(implementation) || !isRecord(implementation.definition)) {
    diagnostics.push(buildDiagnostic(
      'local.build.config',
      `reactConfig is missing an implementation for ${definition.id}@${definition.version}.`,
    ));
    return;
  }
  const manifest = implementation.definition as unknown as LocalComponentDefinition;
  if (manifest.name !== definition.name || manifest.version !== definition.version) {
    diagnostics.push(buildDiagnostic(
      'local.build.config',
      `reactConfig implementation ${definition.id} does not match the declared name or version.`,
    ));
    return;
  }
  let digest: string;
  try {
    digest = localComponentDigest(manifest);
  } catch (error) {
    diagnostics.push(buildDiagnostic(
      'local.build.config',
      `reactConfig implementation ${definition.id} has an invalid manifest: ${messageOf(error)}`,
    ));
    return;
  }
  if (digest !== localComponentDigest(definition)) {
    diagnostics.push(buildDiagnostic(
      'local.build.config',
      `reactConfig implementation ${definition.id} does not match the declared manifest contract.`,
    ));
    return;
  }
  if (implementation.digest !== undefined && implementation.digest !== digest) {
    diagnostics.push(buildDiagnostic(
      'local.build.config',
      `reactConfig implementation ${definition.id} has a stale digest.`,
    ));
  }
}

function mergeDeclared(
  lists: readonly (readonly LocalStyleResourceInput[])[],
  diagnostics: Diagnostic[],
): LocalStyleResourceInput[] {
  const byId = new Map<string, LocalStyleResourceInput>();
  for (const list of lists) {
    for (const input of list) {
      const canonical = JSON.stringify({ id: input.id, css: input.css, path: input.path, base: input.base });
      const previous = byId.get(input.id);
      if (previous) {
        const prior = JSON.stringify({ id: previous.id, css: previous.css, path: previous.path, base: previous.base });
        if (prior !== canonical) {
          diagnostics.push(buildDiagnostic(
            'local.build.resource-conflict',
            `Resource "${input.id}" is declared by the host and the build options with different contents.`,
          ));
        }
        continue;
      }
      byId.set(input.id, input);
    }
  }
  return [...byId.values()];
}

/**
 * Load the explicit host module, validate its LocalConfig and prepared React
 * config, and resolve its resource root/allowlist before collection.
 *
 * The entry must be Node-loadable JavaScript (`.mjs`, or `.js` in a module
 * package). The same file is the Vite build entry, so implementations are
 * imported explicitly and never reconstructed from `function.toString()`.
 */
export async function readLocalBuildHost(options: LocalBuildHostOptions): Promise<LocalBuildHostResult> {
  const diagnostics: Diagnostic[] = [];
  const entryPath = pathFromValue(options.entry, process.cwd(), 'entry', diagnostics);
  if (!entryPath) return { diagnostics: Object.freeze(diagnostics) };

  let module: Record<string, unknown>;
  try {
    // Include the entry mtime so repeated builds in one Node process observe
    // edits instead of a cached module namespace.
    const stamp = await stat(entryPath).then((info) => Math.trunc(info.mtimeMs)).catch(() => 0);
    module = await import(`${pathToFileURL(entryPath).href}?rmd=${stamp}`) as Record<string, unknown>;
  } catch (error) {
    diagnostics.push(buildDiagnostic(
      'local.build.host-import',
      `The host entry could not be imported by Node: ${messageOf(error)}`,
    ));
    return { diagnostics: Object.freeze(diagnostics) };
  }

  const rawConfig = pick(module, 'config');
  const rawReactConfig = pick(module, 'reactConfig');
  const rawRoot = pick(module, 'root');
  const rawAllowlist = pick(module, 'allowlist');

  let config: LocalConfig | null = null;
  if (rawConfig === undefined) {
    diagnostics.push(buildDiagnostic('local.build.host', 'The host entry must export "config".'));
  } else {
    try {
      config = readLocalConfig(rawConfig);
      if (isRecord(rawConfig) && typeof rawConfig.key === 'string' && rawConfig.key !== config.key) {
        diagnostics.push(buildDiagnostic(
          'local.build.config-key',
          'The host config.key is stale; use the key computed by createLocalConfig or readLocalConfig.',
        ));
      }
    } catch (error) {
      diagnostics.push(buildDiagnostic('local.build.config', `The host config is invalid: ${messageOf(error)}`));
    }
  }

  let reactConfig: LocalReactConfig | null = null;
  if (rawReactConfig === undefined) {
    diagnostics.push(buildDiagnostic('local.build.host', 'The host entry must export a prepared "reactConfig".'));
  } else if (!isRecord(rawReactConfig) || rawReactConfig.config === undefined) {
    diagnostics.push(buildDiagnostic('local.build.host', 'reactConfig must expose its LocalConfig as reactConfig.config.'));
  } else {
    let reactConfigConfig: LocalConfig | null = null;
    try {
      reactConfigConfig = readLocalConfig(rawReactConfig.config);
    } catch (error) {
      diagnostics.push(buildDiagnostic('local.build.config', `reactConfig.config is invalid: ${messageOf(error)}`));
    }
    if (reactConfigConfig && config && reactConfigConfig.key !== config.key) {
      diagnostics.push(buildDiagnostic(
        'local.build.config',
        'reactConfig.config.key does not match the exported LocalConfig key.',
      ));
    }
    if (reactConfigConfig && config && JSON.stringify(reactConfigConfig.themes) !== JSON.stringify(config.themes)) {
      diagnostics.push(buildDiagnostic(
        'local.build.config',
        'reactConfig.config themes do not match the exported LocalConfig themes.',
      ));
    }
    const components = rawReactConfig.components;
    if (!Array.isArray(components)) {
      diagnostics.push(buildDiagnostic('local.build.host', 'reactConfig.components must be an array.'));
    } else if (config) {
      for (const definition of config.components) readImplementation(definition, components, diagnostics);
    }
    reactConfig = rawReactConfig as unknown as LocalReactConfig;
  }

  const entryBase = dirname(entryPath);
  let root: string | null = null;
  if (rawRoot === undefined) {
    diagnostics.push(buildDiagnostic('local.build.host', 'The host entry must export an explicit "root".'));
  } else {
    const candidate = pathFromValue(rawRoot, entryBase, 'root', diagnostics);
    if (candidate) {
      try {
        root = await realpath(candidate);
        const info = await stat(root);
        if (!info.isDirectory()) {
          diagnostics.push(buildDiagnostic('local.build.host', 'root must be a directory.'));
          root = null;
        }
      } catch (error) {
        diagnostics.push(buildDiagnostic('local.build.host', `root is not readable: ${messageOf(error)}`));
        root = null;
      }
    }
  }

  let entry: string | null = null;
  try {
    entry = await realpath(entryPath);
  } catch (error) {
    diagnostics.push(buildDiagnostic('local.build.host', `entry is not readable: ${messageOf(error)}`));
  }
  if (root && entry && !isInside(root, entry)) {
    diagnostics.push(buildDiagnostic('local.build.host', 'The host entry must be inside the declared root.'));
  }

  let allowlist: string[] = [];
  if (rawAllowlist === undefined) {
    diagnostics.push(buildDiagnostic('local.build.host', 'The host entry must export an explicit "allowlist".'));
  } else if (!Array.isArray(rawAllowlist) || rawAllowlist.length === 0) {
    diagnostics.push(buildDiagnostic('local.build.host', 'allowlist must be a non-empty array of directories.'));
  } else if (root) {
    for (const item of rawAllowlist) {
      const candidate = pathFromValue(item, root, 'allowlist entry', diagnostics);
      if (!candidate) continue;
      try {
        const real = await realpath(candidate);
        const info = await stat(real);
        if (!info.isDirectory()) {
          diagnostics.push(buildDiagnostic('local.build.host', 'Every allowlist entry must be a directory.'));
          continue;
        }
        if (!isInside(root, real)) {
          diagnostics.push(buildDiagnostic('local.build.host', 'Every allowlist directory must be inside root.'));
          continue;
        }
        allowlist.push(real);
      } catch (error) {
        diagnostics.push(buildDiagnostic('local.build.host', `An allowlist directory is not readable: ${messageOf(error)}`));
      }
    }
    allowlist = [...new Set(allowlist)];
  }

  const hostStyles = pick(module, 'resources') ?? pick(module, 'styles');
  const declared = mergeDeclared([
    readLocalStyleResourceInputs(hostStyles, 'resources', diagnostics),
    readLocalStyleResourceInputs(options.resources, 'options.resources', diagnostics),
  ], diagnostics);
  const hostNotices = pick(module, 'notices');
  const notices = [options.notices, hostNotices].filter((value): value is readonly unknown[] | string => value !== undefined);

  if (!config || !reactConfig || !root || !entry || allowlist.length === 0) {
    return { diagnostics: Object.freeze(diagnostics) };
  }

  return {
    diagnostics: Object.freeze(diagnostics),
    host: Object.freeze({
      entry,
      root,
      allowlist: Object.freeze(allowlist),
      config,
      reactConfig,
      declared: Object.freeze(declared),
      notices: Object.freeze(notices),
    }),
  };
}
