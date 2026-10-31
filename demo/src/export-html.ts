import { createElement } from 'react';
import {
  compileLocal,
  createLocalRuntime,
  createShareableHtml,
  resolveLocalStateBaseline,
  type Diagnostic,
  type LocalCompileOptions,
  type LocalDocument,
  type LocalNode,
  type LocalStateFile,
  type LocalValue,
} from 'reactive-md';
import { LocalDocumentView, type LocalDocumentViewProps } from 'reactive-md/react';
import { createLocalShareableHtml, type LocalStandaloneBundle } from 'reactive-md/export';
import { host } from 'virtual:reactive-md/host';
import { imagePolicy, resolveDocumentImages, validateImageManifest, type ImageAsset } from './image-assets';

const { config: demoConfig, reactConfig, resources, notices } = host;

export const DEMO_GENERATOR_NAME = 'reactive-md-demo';
export const FALLBACK_DOCUMENT_TITLE = 'Reactive MD document';
const FALLBACK_PACKAGE_VERSION = '0.0.0';

export type ShareableHtmlMode = 'interactive' | 'static';
export type ShareableColorScheme = 'light' | 'dark' | 'auto';

export interface ShareableHtmlBuildOptions {
  source: string;
  state: LocalStateFile;
  mode: ShareableHtmlMode;
  locale?: 'en' | 'zh';
  colorScheme?: ShareableColorScheme;
  /** Routing options granted in the demo; the same policy must reach the export. */
  compileOptions?: LocalCompileOptions;
  /** Optional override; otherwise the first heading supplies the title. */
  title?: string;
  imageAssets?: readonly ImageAsset[];
}

export interface ShareableHtmlBuildResult {
  html: string;
  title: string;
  imageCount: number;
  document: LocalDocument;
}

export interface PreparedShareableAssets {
  version: string;
}

/** A build failure with optional compiler or state diagnostics. */
export class ShareableHtmlBuildError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[] = []) {
    super(message);
    this.name = 'ShareableHtmlBuildError';
    this.diagnostics = diagnostics;
  }
}

/** The generated CSS/runtime/notices artifacts are unavailable. */
export class ShareableAssetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareableAssetsError';
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ */
/* Pure helpers (also used by the dialog summary)                      */
/* ------------------------------------------------------------------ */

/** Parse the version from a package.json payload; never fail on bad input. */
export function readPackageVersion(raw: string): string {
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const version = (value as { version?: unknown }).version;
      if (typeof version === 'string' && version.trim()) return version.trim();
    }
  } catch {
    // Fall through to the stable placeholder.
  }
  return FALLBACK_PACKAGE_VERSION;
}

function plainText(node: LocalNode): string {
  if (node.type === 'image') return node.alt ?? '';
  if (node.type === 'break') return ' ';
  let text = typeof node.value === 'string' ? node.value : '';
  for (const child of node.children ?? []) text += plainText(child);
  return text;
}

function firstHeading(nodes: LocalNode[]): LocalNode | null {
  for (const node of nodes) {
    if (node.type === 'heading') return node;
    const nested = firstHeading(node.children ?? []);
    if (nested) return nested;
  }
  return null;
}

/** Plain text of the first heading, or the stable fallback title. */
export function deriveDocumentTitle(document: LocalDocument): string {
  const heading = firstHeading(document.nodes);
  const title = heading ? plainText(heading).replace(/\s+/g, ' ').trim() : '';
  return title || FALLBACK_DOCUMENT_TITLE;
}

/** All Markdown image nodes, including images inside component children. */
export function collectImageNodes(document: LocalDocument): LocalNode[] {
  const images: LocalNode[] = [];
  const walk = (nodes: LocalNode[]) => {
    for (const node of nodes) {
      if (node.type === 'image') images.push(node);
      if (node.children) walk(node.children);
    }
  };
  walk(document.nodes);
  return images;
}

export function countDocumentImages(document: LocalDocument): number {
  return collectImageNodes(document).length;
}

function sameLocalValue(left: LocalValue, right: LocalValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }
  return Object.is(left, right);
}

/**
 * Count exported parameters whose values differ. Arrays compare by content and
 * order, matching the serialized state format.
 */
export function countParameterDifferences(
  initial: Readonly<Record<string, LocalValue>>,
  current: Readonly<Record<string, LocalValue>>,
  names?: readonly string[],
): number {
  const keys = names
    ? [...new Set(names)]
    : [...new Set([...Object.keys(initial), ...Object.keys(current)])];
  let count = 0;
  for (const name of keys) {
    if (!Object.hasOwn(initial, name) || !Object.hasOwn(current, name)) {
      count += 1;
      continue;
    }
    if (!sameLocalValue(initial[name], current[name])) count += 1;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Generated raw artifacts                                             */
/* ------------------------------------------------------------------ */

interface BaseAssets {
  css: string;
  notices: string;
  packageVersion: string;
}

interface LoadedAssets extends BaseAssets {
  runtimeScript: string;
}

let baseAssetsPromise: Promise<BaseAssets> | null = null;
let runtimeScriptPromise: Promise<string> | null = null;

function resetFailed<T>(promise: Promise<T>, reset: () => void): Promise<T> {
  promise.catch(() => reset());
  return promise;
}

function loadBaseAssets(): Promise<BaseAssets> {
  if (!baseAssetsPromise) {
    baseAssetsPromise = resetFailed(
      Promise.all([
        import('../../dist-library/reactive-md.css?raw'),
        import('../../THIRD_PARTY_NOTICES.md?raw'),
        import('../../package.json?raw'),
        import('../../dist-library/reactive-md-print.css?raw'),
      ])
        .then(([css, notices, packageJson, printCss]) => {
          if (!css.default.trim()) {
            throw new ShareableAssetsError('The generated document stylesheet is empty.');
          }
          return {
            css: `${css.default}\n${printCss.default}`,
            notices: notices.default,
            packageVersion: readPackageVersion(packageJson.default),
          };
        })
        .catch((error: unknown) => {
          throw error instanceof ShareableAssetsError
            ? error
            : new ShareableAssetsError(errorText(error));
        }),
      () => {
        baseAssetsPromise = null;
      },
    );
  }
  return baseAssetsPromise;
}

function loadRuntimeScript(): Promise<string> {
  if (!runtimeScriptPromise) {
    runtimeScriptPromise = resetFailed(
      import('../../dist-standalone/reactive-md-standalone.js?raw')
        .then((module) => {
          if (!module.default.trim()) {
            throw new ShareableAssetsError('The generated standalone runtime is empty.');
          }
          return module.default;
        })
        .catch((error: unknown) => {
          throw error instanceof ShareableAssetsError
            ? error
            : new ShareableAssetsError(errorText(error));
        }),
      () => {
        runtimeScriptPromise = null;
      },
    );
  }
  return runtimeScriptPromise;
}

async function loadAssets(mode: ShareableHtmlMode, defaultRuntime = true): Promise<LoadedAssets> {
  const base = await loadBaseAssets();
  const runtimeScript = mode === 'interactive' && defaultRuntime ? await loadRuntimeScript() : '';
  return { ...base, runtimeScript };
}

/**
 * Load the build artifacts the dialog needs and report the package version.
 * Rejecting with `ShareableAssetsError` means the demo was not built yet.
 */
export async function prepareShareableHtmlAssets(
  mode: ShareableHtmlMode,
): Promise<PreparedShareableAssets> {
  const assets = await loadAssets(mode);
  return { version: assets.packageVersion };
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

function diagnosticsMessage(prefix: string, diagnostics: readonly Diagnostic[]): string {
  const detail = diagnostics
    .slice(0, 3)
    .map((item) => `${item.line}:${item.column} ${item.message}`)
    .join(' ');
  return detail ? `${prefix} ${detail}` : prefix;
}

export function formatBuildError(error: unknown): string {
  if (error instanceof ShareableHtmlBuildError && error.diagnostics.length) {
    return diagnosticsMessage(error.message, error.diagnostics);
  }
  return errorText(error);
}

/**
 * Compile the source, rebase the selected state as the document baseline, render
 * trusted static markup, and wrap it with the verified document image manifest.
 */
export async function buildShareableHtml(
  options: ShareableHtmlBuildOptions,
): Promise<ShareableHtmlBuildResult> {
  const { source, state, mode } = options;
  const locale: 'en' | 'zh' = options.locale === 'zh' ? 'zh' : 'en';
  const colorScheme: ShareableColorScheme = options.colorScheme ?? 'auto';

  const compileOptions = { ...options.compileOptions, config: options.compileOptions?.config ?? demoConfig };
  const compiled = compileLocal(source, compileOptions);
  if (!compiled.ok) {
    throw new ShareableHtmlBuildError('The document does not compile.', compiled.diagnostics);
  }
  const document = compiled.document;
  const usesExtensions = Boolean(document.extensions?.components.length
    || demoConfig.themes.some(theme => theme.name === document.theme));
  if (usesExtensions && compileOptions.config.key !== demoConfig.key) {
    throw new ShareableHtmlBuildError('This document requires an extension configuration that is not installed in the Demo.');
  }
  const imageCount = countDocumentImages(document);
  const resolved = resolveDocumentImages(document, validateImageManifest(options.imageAssets ?? []));
  if (resolved.missing.length > 0) {
    throw new ShareableHtmlBuildError(
      `Choose files for these image references before exporting: ${resolved.missing.join(', ')}`,
    );
  }

  const baseline = resolveLocalStateBaseline(document, state);
  if (!baseline.ok) {
    throw new ShareableHtmlBuildError(
      'The selected state does not match this document.',
      baseline.diagnostics,
    );
  }

  const assets = await loadAssets(mode, !usesExtensions);
  let bundle: LocalStandaloneBundle | undefined;
  let extensionNotices = usesExtensions
    ? notices.map(notice => [notice.id, notice.license, notice.text].filter(Boolean).join('\n')).join('\n\n')
    : '';
  if (usesExtensions && mode === 'interactive') {
    const built = (await import('virtual:reactive-md/bundle')).default;
    if ('error' in built) throw new ShareableHtmlBuildError(built.error, built.diagnostics);
    if (built.configKey !== demoConfig.key) {
      throw new ShareableAssetsError('The extension bundle is stale. Restart or rebuild the Demo.');
    }
    bundle = built;
    extensionNotices = built.notices;
  }
  const title = options.title?.trim() || deriveDocumentTitle(document);
  const runtime = createLocalRuntime(baseline.baseline.document);
  let staticMarkup: string;
  try {
    const { renderToString } = await import('react-dom/server');
    // `staticFirst` keeps the server markup identical to the interactive
    // hydration pass, so the single-file export shows a static first screen.
    const viewProps: LocalDocumentViewProps & { staticFirst?: boolean } = {
      ...imagePolicy(resolved.images),
      document: baseline.baseline.document,
      runtime,
      mode,
      staticFirst: mode === 'interactive',
      locale,
      colorScheme,
    };
    if (usesExtensions) {
      const { renderLocalStaticDocument } = await import('reactive-md/react/server');
      const rendered = renderLocalStaticDocument({ ...viewProps, reactConfig, resources });
      if (!rendered.ok) throw new ShareableHtmlBuildError('Extension static rendering failed.', rendered.diagnostics);
      staticMarkup = rendered.markup;
    } else {
      staticMarkup = renderToString(createElement(LocalDocumentView, viewProps));
    }
  } finally {
    runtime.dispose();
  }

  const htmlOptions = {
    title,
    source,
    state,
    staticMarkup,
    css: assets.css,
    mode,
    runtimeScript: mode === 'interactive' ? assets.runtimeScript : undefined,
    locale,
    colorScheme,
    compileOptions,
    generator: { name: DEMO_GENERATOR_NAME, version: assets.packageVersion },
    assets: 'inline' as const,
    imageCount,
    images: resolved.images,
    notices: `${assets.notices}\n${extensionNotices}`,
  };
  const html = usesExtensions
    ? createLocalShareableHtml({ ...htmlOptions, document, config: demoConfig, resources, bundle })
    : createShareableHtml(htmlOptions);

  return { html, title, imageCount, document: baseline.baseline.document };
}
