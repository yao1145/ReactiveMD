import type { Diagnostic } from '../local/types';
import { defineLocalStandaloneBundle, localThemeContractDigest, type LocalStandaloneBundle } from '../export';
import { localComponentRequirement } from '../sdk/manifest';
import type { LocalComponentRequirement, LocalConfig } from '../sdk/types';
import { LOCAL_SDK_VERSION } from '../sdk/version';
import { buildDiagnostic, LocalBuildError } from './diagnostics';
import { sha256, utf8ByteLength } from './digest';
import { readLocalBuildHost, type LocalBuildHostOptions } from './host';
import {
  collectLocalBuildNotices,
  type LocalBuildNotice,
  type LocalBuildNotices,
} from './notices';
import {
  collectLocalBuildResources,
  readLocalBuildBudgets,
  type LocalBuildAsset,
  type LocalBuildBudgets,
  type LocalBuildResource,
} from './resources';
import {
  buildLocalStandaloneScript,
  resolveLocalVite,
  type LocalViteSource,
} from './vite';

export { LocalBuildError } from './diagnostics';
export { createLocalStandaloneEntrySource, VIRTUAL_HOST_ENTRY, VIRTUAL_HOST_MODULE } from './entry';
export { readLocalBuildHost } from './host';
export type { LocalBuildHost, LocalBuildHostOptions, LocalBuildHostResult } from './host';
export { collectLocalBuildNotices } from './notices';
export type { LocalBuildNotice, LocalBuildNoticeInput, LocalBuildNotices } from './notices';
export {
  collectLocalBuildResources,
  DEFAULT_LOCAL_BUILD_BUDGETS,
  readLocalBuildBudgets,
  readLocalStyleResourceInputs,
} from './resources';
export type {
  CollectedLocalResources,
  LocalBuildAsset,
  LocalBuildBudgets,
  LocalBuildResource,
  LocalResourceOrigin,
  LocalStyleResourceInput,
  ResourceCollectionInput,
} from './resources';
export { resolveLocalVite } from './vite';
export type { LocalViteApi, LocalViteSource } from './vite';

/** Version of the build manifest, independent from SDK and document revisions. */
export const LOCAL_BUILD_PROTOCOL = 'reactive-md-build/v1' as const;

export interface LocalStandaloneBuildOptions extends LocalBuildHostOptions {
  /** Theme names to collect; defaults to every installed theme. */
  readonly themes?: readonly string[];
  readonly budgets?: Partial<LocalBuildBudgets>;
  /** Optional Vite peer facade; useful for tests and nonstandard hosts. */
  readonly vite?: LocalViteSource;
}

export interface LocalBuildPreflight {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly entry: string;
  readonly root: string;
  readonly allowlist: readonly string[];
  readonly config?: LocalConfig;
  readonly configKey?: string;
  readonly resources: readonly LocalBuildResource[];
  readonly assets: readonly LocalBuildAsset[];
  readonly css: string;
  readonly notices: LocalBuildNotices;
}

export interface LocalStandaloneBuildManifest {
  readonly protocol: typeof LOCAL_BUILD_PROTOCOL;
  readonly sdkVersion: typeof LOCAL_SDK_VERSION;
  readonly configKey: string;
  readonly format: 'iife';
  readonly script: { readonly digest: string; readonly bytes: number };
  readonly resources: readonly {
    readonly id: string;
    readonly origin: LocalBuildResource['origin'];
    readonly digest: string;
    readonly bytes: number;
  }[];
  readonly inlinedAssets: readonly LocalBuildAsset[];
  readonly components: readonly LocalComponentRequirement[];
  /** Every theme carried by the installed config, whether selected or not. */
  readonly themes: readonly { readonly id: string; readonly name: string; readonly version: string; readonly digest: string }[];
  readonly notices: {
    readonly digest: string;
    readonly entries: readonly Omit<LocalBuildNotice, 'text'>[];
  };
}

/** A compatible LocalStandaloneBundle plus the resources an exporter needs. */
export interface LocalStandaloneBuild extends LocalStandaloneBundle {
  readonly configKey: string;
  readonly resources: readonly LocalBuildResource[];
  readonly assets: readonly LocalBuildAsset[];
  readonly css: string;
  readonly notices: string;
  readonly manifest: LocalStandaloneBuildManifest;
}

const EMPTY_NOTICES: LocalBuildNotices = Object.freeze({
  text: '',
  digest: sha256(''),
  entries: Object.freeze([]),
});

const OFFLINE_CAPABILITIES = ['static', 'interactive', 'offline'] as const;

function capabilityDiagnostics(config: LocalConfig): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const component of config.components) {
    for (const capability of OFFLINE_CAPABILITIES) {
      if (!component.capabilities[capability]) {
        diagnostics.push(buildDiagnostic(
          'local.extension.export-capability',
          `${component.id}@${component.version} does not support ${capability} for an offline standalone bundle.`,
        ));
      }
    }
  }
  return diagnostics;
}

function readOptionsEntry(entry: string | URL): string {
  return typeof entry === 'string' ? entry : entry.toString();
}

/**
 * Build the structured plan first: validate the host module, the LocalConfig
 * key, React implementations, capabilities and every CSS/resource reference.
 * No Vite build or script output happens here.
 */
export async function preflightLocalStandaloneBuild(
  options: LocalStandaloneBuildOptions,
): Promise<LocalBuildPreflight> {
  const hostResult = await readLocalBuildHost(options);
  const diagnostics: Diagnostic[] = [...hostResult.diagnostics];
  const host = hostResult.host;
  if (!host) {
    return Object.freeze({
      ok: false,
      diagnostics: Object.freeze(diagnostics),
      entry: readOptionsEntry(options.entry),
      root: '',
      allowlist: Object.freeze([]),
      resources: Object.freeze([]),
      assets: Object.freeze([]),
      css: '',
      notices: EMPTY_NOTICES,
    });
  }

  diagnostics.push(...capabilityDiagnostics(host.config));
  const budgets = readLocalBuildBudgets(options.budgets, diagnostics);
  const collected = await collectLocalBuildResources({
    config: host.config,
    declared: host.declared,
    themes: options.themes,
    root: host.root,
    allowlist: host.allowlist,
    budgets,
  });
  diagnostics.push(...collected.diagnostics);
  const notices = collectLocalBuildNotices(host.notices, diagnostics);

  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    entry: host.entry,
    root: host.root,
    allowlist: host.allowlist,
    config: host.config,
    configKey: host.config.key,
    resources: collected.resources,
    assets: collected.assets,
    css: collected.css,
    notices,
  });
}

function createManifest(
  preflight: LocalBuildPreflight & { config: LocalConfig; configKey: string },
  script: string,
  notices: LocalBuildNotices,
): LocalStandaloneBuildManifest {
  const config = preflight.config;
  return Object.freeze({
    protocol: LOCAL_BUILD_PROTOCOL,
    sdkVersion: LOCAL_SDK_VERSION,
    configKey: preflight.configKey,
    format: 'iife' as const,
    script: Object.freeze({ digest: sha256(script), bytes: utf8ByteLength(script) }),
    resources: Object.freeze(preflight.resources.map((resource) => Object.freeze({
      id: resource.id,
      origin: resource.origin,
      digest: resource.digest,
      bytes: resource.bytes,
    }))),
    inlinedAssets: preflight.assets,
    components: Object.freeze(config.components.map(localComponentRequirement)),
    themes: Object.freeze(config.themes.map((theme) => Object.freeze({
      id: theme.id,
      name: theme.name,
      version: theme.version,
      digest: localThemeContractDigest(theme),
    }))),
    notices: Object.freeze({
      digest: notices.digest,
      entries: Object.freeze(notices.entries.map((entry) => Object.freeze({
        id: entry.id,
        ...(entry.name === undefined ? {} : { name: entry.name }),
        ...(entry.version === undefined ? {} : { version: entry.version }),
        ...(entry.license === undefined ? {} : { license: entry.license }),
        ...(entry.url === undefined ? {} : { url: entry.url }),
        digest: entry.digest,
      }))),
    }),
  });
}

/**
 * Build one inline self-contained standalone script plus the deterministic
 * resource, notice and manifest data an offline exporter needs.
 *
 * The optional Vite peer is loaded dynamically, so consumers that only read
 * manifests or preflight do not install Vite. The returned object is
 * structurally compatible with `LocalStandaloneBundle` for the existing
 * exporter and standalone restoration path.
 */
export async function buildLocalStandaloneBundle(
  options: LocalStandaloneBuildOptions,
): Promise<LocalStandaloneBuild> {
  const preflight = await preflightLocalStandaloneBuild(options);
  if (!preflight.ok || !preflight.config || !preflight.configKey) {
    throw new LocalBuildError('The standalone bundle preflight failed.', preflight.diagnostics);
  }
  const config = preflight.config;
  const configKey = preflight.configKey;
  const diagnostics: Diagnostic[] = [];
  const vite = await resolveLocalVite(options.vite, diagnostics);
  if (!vite) throw new LocalBuildError('The standalone bundle build could not load Vite.', diagnostics);
  const script = await buildLocalStandaloneScript({
    root: preflight.root,
    hostEntry: preflight.entry,
    configKey,
  }, vite, diagnostics);
  if (!script) throw new LocalBuildError('The standalone bundle build failed.', diagnostics);

  const bundle = defineLocalStandaloneBundle(script, config);
  const manifest = createManifest({ ...preflight, config, configKey }, script, preflight.notices);
  return Object.freeze({
    script: bundle.script,
    extensions: bundle.extensions,
    seal: bundle.seal,
    configKey,
    resources: preflight.resources,
    assets: preflight.assets,
    css: preflight.css,
    notices: preflight.notices.text,
    manifest,
  });
}
