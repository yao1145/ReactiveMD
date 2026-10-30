import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Diagnostic } from '../local/types';
import type { LocalConfig } from '../sdk/types';
import type { LocalStyleResource, LocalThemePackage } from '../sdk/theme';
import { buildDiagnostic } from './diagnostics';
import { sha256, sha256Bytes, utf8ByteLength } from './digest';

const STYLE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_STYLE_ID_LENGTH = 256;
const REMOTE_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const DATA_URL = /^data:/i;

/** Bound every resource read, inline expansion and output stylesheet. */
export interface LocalBuildBudgets {
  readonly maxResources: number;
  readonly maxCssBytes: number;
  readonly maxFileBytes: number;
  readonly maxInlinedBytes: number;
  readonly maxFiles: number;
  readonly maxImportDepth: number;
}

export const DEFAULT_LOCAL_BUILD_BUDGETS: LocalBuildBudgets = Object.freeze({
  maxResources: 128,
  maxCssBytes: 4 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxInlinedBytes: 24 * 1024 * 1024,
  maxFiles: 256,
  maxImportDepth: 16,
});

const ABSOLUTE_BUDGETS: LocalBuildBudgets = Object.freeze({
  maxResources: 512,
  maxCssBytes: 32 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxInlinedBytes: 64 * 1024 * 1024,
  maxFiles: 1024,
  maxImportDepth: 32,
});

export interface LocalStyleResourceInput {
  readonly id: string;
  /** Inline CSS. Relative references need an explicit `base`. */
  readonly css?: string;
  /** Root-relative CSS file. Its directory is the base for relative references. */
  readonly path?: string;
  /** Root-relative directory for relative references in inline CSS. */
  readonly base?: string;
}

export type LocalResourceOrigin = 'component' | 'resource' | 'theme';

export interface LocalBuildResource {
  readonly id: string;
  readonly css: string;
  readonly digest: string;
  readonly bytes: number;
  readonly origin: LocalResourceOrigin;
}

export interface LocalBuildAsset {
  /** Root-relative POSIX path of an inlined CSS, font or image file. */
  readonly path: string;
  readonly digest: string;
  readonly bytes: number;
  readonly mime: string;
}

export interface CollectedLocalResources {
  readonly resources: readonly LocalBuildResource[];
  readonly assets: readonly LocalBuildAsset[];
  readonly css: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ResourceCollectionInput {
  readonly config: LocalConfig;
  readonly declared: readonly LocalStyleResourceInput[];
  /** Theme names to include; defaults to every installed theme. */
  readonly themes?: readonly string[];
  readonly root: string;
  readonly allowlist: readonly string[];
  readonly budgets: LocalBuildBudgets;
}

interface CssContext {
  readonly root: string;
  readonly allowlist: readonly string[];
  readonly budgets: LocalBuildBudgets;
  readonly diagnostics: Diagnostic[];
  readonly assets: Map<string, LocalBuildAsset>;
  files: number;
  inlinedBytes: number;
  fileBudgetReported: boolean;
  inlinedBudgetReported: boolean;
  resourceBudgetReported: boolean;
  cssBudgetReported: boolean;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.css': 'text/css',
  '.eot': 'application/vnd.ms-fontobject',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function mimeFor(file: string): string {
  const dot = file.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME_BY_EXTENSION[file.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function posixRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Read host-supplied budget overrides; invalid entries fall back individually. */
export function readLocalBuildBudgets(value: unknown, diagnostics: Diagnostic[]): LocalBuildBudgets {
  if (value === undefined) return DEFAULT_LOCAL_BUILD_BUDGETS;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    diagnostics.push(buildDiagnostic('local.build.budget', 'budgets must be an object.'));
    return DEFAULT_LOCAL_BUILD_BUDGETS;
  }
  const record = value as Record<string, unknown>;
  const read = (key: keyof LocalBuildBudgets, allowZero = false): number => {
    if (record[key] === undefined) return DEFAULT_LOCAL_BUILD_BUDGETS[key];
    const candidate = record[key];
    const valid = allowZero ? (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0) : isPositiveInteger(candidate);
    if (!valid || (candidate as number) > ABSOLUTE_BUDGETS[key]) {
      diagnostics.push(buildDiagnostic(
        'local.build.budget',
        `budgets.${key} must be ${allowZero ? 'a nonnegative' : 'a positive'} integer at most ${ABSOLUTE_BUDGETS[key]}.`,
      ));
      return DEFAULT_LOCAL_BUILD_BUDGETS[key];
    }
    return candidate as number;
  };
  return Object.freeze({
    maxResources: read('maxResources'),
    maxCssBytes: read('maxCssBytes'),
    maxFileBytes: read('maxFileBytes'),
    maxInlinedBytes: read('maxInlinedBytes', true),
    maxFiles: read('maxFiles'),
    maxImportDepth: read('maxImportDepth', true),
  });
}

/** Validate explicit { id, css | path } resource declarations. */
export function readLocalStyleResourceInputs(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): LocalStyleResourceInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${path} must be an array of { id, css | path } resources.`));
    return [];
  }
  const byId = new Map<string, LocalStyleResourceInput>();
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const lead = `${path}[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${lead} must be an object.`));
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_STYLE_ID_LENGTH || !STYLE_ID.test(id)) {
      diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${lead}.id must be a bounded style-resource id.`));
      continue;
    }
    const hasCss = record.css !== undefined;
    const hasPath = record.path !== undefined;
    if (hasCss === hasPath) {
      diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${lead} must declare exactly one of "css" or "path".`));
      continue;
    }
    if (hasCss && typeof record.css !== 'string') {
      diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${lead}.css must be a string.`));
      continue;
    }
    if (hasPath && (typeof record.path !== 'string' || record.path.length === 0)) {
      diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${lead}.path must be a non-empty string.`));
      continue;
    }
    if (record.base !== undefined && (typeof record.base !== 'string' || record.base.length === 0)) {
      diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${lead}.base must be a non-empty root-relative directory.`));
      continue;
    }
    const resource: LocalStyleResourceInput = Object.freeze({
      id,
      ...(hasCss ? { css: record.css as string } : { path: record.path as string }),
      ...(record.base === undefined ? {} : { base: record.base as string }),
    });
    const previous = byId.get(id);
    if (previous) {
      if (canonicalResourceInput(previous) !== canonicalResourceInput(resource)) {
        diagnostics.push(buildDiagnostic(
          'local.build.resource-conflict',
          `Resource "${id}" is declared more than once with different contents.`,
        ));
      }
      continue;
    }
    byId.set(id, resource);
  }
  return [...byId.values()];
}

function canonicalResourceInput(input: LocalStyleResourceInput): string {
  return JSON.stringify({ id: input.id, css: input.css, path: input.path, base: input.base });
}

function reportFileBudget(ctx: CssContext): void {
  if (ctx.fileBudgetReported) return;
  ctx.fileBudgetReported = true;
  ctx.diagnostics.push(buildDiagnostic(
    'local.build.resource-budget',
    `Resource collection exceeds ${ctx.budgets.maxFiles} files or a ${ctx.budgets.maxFileBytes}-byte file.`,
  ));
}

function reportInlineBudget(ctx: CssContext): void {
  if (ctx.inlinedBudgetReported) return;
  ctx.inlinedBudgetReported = true;
  ctx.diagnostics.push(buildDiagnostic(
    'local.build.resource-budget',
    `Inlined resources exceed the ${ctx.budgets.maxInlinedBytes}-byte budget.`,
  ));
}

function recordAsset(ctx: CssContext, file: string, bytes: Uint8Array, mime: string): void {
  const path = posixRelative(ctx.root, file);
  if (ctx.assets.has(path)) return;
  ctx.assets.set(path, Object.freeze({
    path,
    digest: sha256Bytes(bytes),
    bytes: bytes.byteLength,
    mime,
  }));
}

async function resolveAllowed(candidate: string, ctx: CssContext, label: string): Promise<string | null> {
  if (!isInside(ctx.root, candidate)) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-traversal',
      `${label} resolves outside the declared root.`,
    ));
    return null;
  }
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-missing', `${label} does not exist.`));
    return null;
  }
  if (!isInside(ctx.root, real)) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-traversal',
      `${label} resolves outside the declared root through a symbolic link.`,
    ));
    return null;
  }
  if (!ctx.allowlist.some((directory) => isInside(directory, real))) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-traversal',
      `${label} is not inside the declared allowlist.`,
    ));
    return null;
  }
  let info: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    info = await stat(real);
  } catch {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-missing', `${label} is not readable.`));
    return null;
  }
  if (!info || !info.isFile()) {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${label} is not a regular file.`));
    return null;
  }
  if (ctx.files >= ctx.budgets.maxFiles || info.size > ctx.budgets.maxFileBytes) {
    reportFileBudget(ctx);
    return null;
  }
  ctx.files += 1;
  return real;
}

async function resolveAllowedDirectory(candidate: string, ctx: CssContext, label: string): Promise<string | null> {
  if (!isInside(ctx.root, candidate)) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-traversal',
      `${label} resolves outside the declared root.`,
    ));
    return null;
  }
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-missing', `${label} does not exist.`));
    return null;
  }
  if (!isInside(ctx.root, real) || !ctx.allowlist.some((directory) => isInside(directory, real))) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-traversal',
      `${label} is not inside the declared root and allowlist.`,
    ));
    return null;
  }
  let info: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    info = await stat(real);
  } catch {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-missing', `${label} is not readable.`));
    return null;
  }
  if (!info || !info.isDirectory()) {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${label} is not a directory.`));
    return null;
  }
  return real;
}

function findStringEnd(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length) {
    if (css[index] === '\\') {
      index += 2;
      continue;
    }
    if (css[index] === quote) return index + 1;
    index += 1;
  }
  return -1;
}

function findBalancedEnd(css: string, start: number): number {
  let depth = 0;
  for (let index = start; index < css.length; index += 1) {
    const character = css[index];
    if (character === '"' || character === "'") {
      const end = findStringEnd(css, index);
      if (end < 0) return -1;
      index = end - 1;
      continue;
    }
    if (character === '/' && css[index + 1] === '*') {
      const close = css.indexOf('*/', index + 2);
      if (close < 0) return -1;
      index = close + 1;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

interface CssUrl {
  readonly value: string;
  readonly end: number;
  readonly start: number;
}

function readCssUrl(css: string, start: number): CssUrl | null {
  let cursor = start + 3;
  while (cursor < css.length && /\s/.test(css[cursor])) cursor += 1;
  if (css[cursor] !== '(') return null;
  cursor += 1;
  while (cursor < css.length && /\s/.test(css[cursor])) cursor += 1;
  const valueStart = cursor;
  let value: string;
  if (css[cursor] === '"' || css[cursor] === "'") {
    const end = findStringEnd(css, cursor);
    if (end < 0) return null;
    value = css.slice(cursor + 1, end - 1);
    cursor = end;
    while (cursor < css.length && /\s/.test(css[cursor])) cursor += 1;
    if (css[cursor] !== ')') return null;
    cursor += 1;
  } else {
    const close = css.indexOf(')', cursor);
    if (close < 0) return null;
    value = css.slice(cursor, close);
    cursor = close + 1;
  }
  return { value: value.trim(), end: cursor, start: valueStart };
}

interface CssImport {
  readonly specifier: string;
  readonly end: number;
  readonly conditional: boolean;
}

function readCssImport(css: string, start: number): CssImport | null {
  const match = /^@import\b/i.exec(css.slice(start, start + 8));
  if (!match) return null;
  let cursor = start + match[0].length;
  while (cursor < css.length && /\s/.test(css[cursor])) cursor += 1;
  let specifier: string;
  if (css[cursor] === '"' || css[cursor] === "'") {
    const end = findStringEnd(css, cursor);
    if (end < 0) return null;
    specifier = css.slice(cursor + 1, end - 1).trim();
    cursor = end;
  } else if (/^url\s*\(/i.test(css.slice(cursor, cursor + 16))) {
    const url = readCssUrl(css, cursor);
    if (!url) return null;
    specifier = url.value;
    cursor = url.end;
  } else {
    return null;
  }
  let conditional = false;
  while (cursor < css.length) {
    const character = css[cursor];
    if (character === '"' || character === "'") {
      const end = findStringEnd(css, cursor);
      if (end < 0) return null;
      cursor = end;
      continue;
    }
    if (character === '/' && css[cursor + 1] === '*') {
      const close = css.indexOf('*/', cursor + 2);
      if (close < 0) return null;
      cursor = close + 2;
      continue;
    }
    if (character === '(') {
      const close = findBalancedEnd(css, cursor);
      if (close < 0) return null;
      cursor = close;
      continue;
    }
    if (character === ';') return { specifier, end: cursor + 1, conditional };
    if (!/\s/.test(character)) conditional = true;
    cursor += 1;
  }
  return null;
}

function validateImageSet(body: string, diagnostics: Diagnostic[], label: string): void {
  let index = 0;
  while (index < body.length) {
    const character = body[index];
    if (character === '/' && body[index + 1] === '*') {
      const close = body.indexOf('*/', index + 2);
      index = close < 0 ? body.length : close + 2;
      continue;
    }
    if ((character === 't' || character === 'T') && /^type\s*\(/i.test(body.slice(index, index + 8))) {
      let open = index;
      while (open < body.length && body[open] !== '(') open += 1;
      const close = open < body.length ? findBalancedEnd(body, open) : -1;
      index = close < 0 ? body.length : close;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = findStringEnd(body, index);
      if (end < 0) {
        diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${label} has an unterminated image-set() string.`));
        return;
      }
      const value = body.slice(index + 1, end - 1).trim();
      if (!DATA_URL.test(value)) {
        diagnostics.push(buildDiagnostic(
          'local.build.resource-remote',
          `${label} has a non-inline image-set() entry; URL resolution is only supported through url().`,
        ));
      }
      index = end;
      continue;
    }
    index += 1;
  }
}

async function loadCssFile(
  file: string,
  ctx: CssContext,
  stack: readonly string[],
): Promise<string | null> {
  if (stack.length > ctx.budgets.maxImportDepth) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-budget',
      `CSS imports exceed the ${ctx.budgets.maxImportDepth}-level depth budget.`,
    ));
    return null;
  }
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-missing', `CSS resource "${posixRelative(ctx.root, file)}" is not readable.`));
    return null;
  }
  recordAsset(ctx, file, new TextEncoder().encode(text), 'text/css');
  return resolveCss(text, dirname(file), [...stack, file], ctx);
}

async function readBinaryAsset(file: string, ctx: CssContext, label: string): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(file);
  } catch {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-missing', `${label} is not readable.`));
    return null;
  }
  if (ctx.inlinedBytes + bytes.byteLength > ctx.budgets.maxInlinedBytes) {
    reportInlineBudget(ctx);
    return null;
  }
  ctx.inlinedBytes += bytes.byteLength;
  const mime = mimeFor(file);
  recordAsset(ctx, file, bytes, mime);
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

async function resolveUrl(
  value: string,
  baseDir: string | null,
  ctx: CssContext,
  label: string,
): Promise<string | null> {
  if (value === '') {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${label} has an empty url().`));
    return null;
  }
  if (DATA_URL.test(value) || value.startsWith('#')) return value;
  if (value.startsWith('//')) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-remote',
      `${label} references the protocol-relative remote resource "${value}".`,
    ));
    return null;
  }
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-traversal',
      `${label} references the absolute path "${value}".`,
    ));
    return null;
  }
  if (REMOTE_SCHEME.test(value)) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-remote',
      `${label} references the remote resource "${value.length > 160 ? `${value.slice(0, 160)}…` : value}".`,
    ));
    return null;
  }
  if (value.includes('\\')) {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-invalid', `${label} uses an unsupported escaped url().`));
    return null;
  }
  if (baseDir === null) {
    ctx.diagnostics.push(buildDiagnostic(
      'local.build.resource-unresolved',
      `${label} has a relative url() without a base directory.`,
    ));
    return null;
  }
  const file = await resolveAllowed(resolve(baseDir, value), ctx, `${label} url("${value}")`);
  if (!file) return null;
  return readBinaryAsset(file, ctx, `${label} url("${value}")`);
}

/**
 * Inline local `@import` and `url()` targets in one stylesheet. Remote,
 * missing, traversal, cyclic and over-budget targets become diagnostics.
 */
async function resolveCss(
  css: string,
  baseDir: string | null,
  stack: readonly string[],
  ctx: CssContext,
): Promise<string> {
  if (css.toLowerCase().includes('</style')) {
    ctx.diagnostics.push(buildDiagnostic('local.build.resource-invalid', 'CSS must not contain a closing style tag.'));
    return css;
  }
  let output = '';
  let index = 0;
  let depth = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '/' && css[index + 1] === '*') {
      const close = css.indexOf('*/', index + 2);
      const end = close < 0 ? css.length : close + 2;
      output += css.slice(index, end);
      index = end;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = findStringEnd(css, index);
      if (end < 0) {
        ctx.diagnostics.push(buildDiagnostic('local.build.resource-invalid', 'CSS has an unterminated string.'));
        output += css.slice(index);
        break;
      }
      output += css.slice(index, end);
      index = end;
      continue;
    }
    if (character === '\\') {
      ctx.diagnostics.push(buildDiagnostic(
        'local.build.resource-invalid',
        'CSS must not use escapes outside strings; escaped tokens can disguise url() or @import.',
      ));
      output += css.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === '{') {
      depth += 1;
      output += character;
      index += 1;
      continue;
    }
    if (character === '}') {
      depth = Math.max(0, depth - 1);
      output += character;
      index += 1;
      continue;
    }
    const boundary = index === 0 || !/[\w-]/.test(css[index - 1]);

    if (boundary && depth === 0 && character === '@' && /^@import\b/i.test(css.slice(index, index + 8))) {
      const parsed = readCssImport(css, index);
      if (!parsed) {
        ctx.diagnostics.push(buildDiagnostic('local.build.resource-invalid', 'CSS has a malformed @import.'));
        output += '/* rejected @import */';
        index += 7;
        continue;
      }
      if (parsed.conditional) {
        ctx.diagnostics.push(buildDiagnostic(
          'local.build.resource-unsupported',
          '@import with layer, support or media conditions is not supported; inline the stylesheet instead.',
        ));
      }
      const specifier = parsed.specifier;
      if (DATA_URL.test(specifier)) {
        ctx.diagnostics.push(buildDiagnostic('local.build.resource-unsupported', '@import must name a local CSS file, not a data: URL.'));
      } else if (specifier.startsWith('//')) {
        ctx.diagnostics.push(buildDiagnostic('local.build.resource-remote', `@import references the remote URL "${specifier}".`));
      } else if (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier)) {
        ctx.diagnostics.push(buildDiagnostic('local.build.resource-traversal', `@import references the absolute path "${specifier}".`));
      } else if (REMOTE_SCHEME.test(specifier)) {
        ctx.diagnostics.push(buildDiagnostic('local.build.resource-remote', `@import references the remote URL "${specifier}".`));
      } else if (baseDir === null) {
        ctx.diagnostics.push(buildDiagnostic('local.build.resource-unresolved', `@import "${specifier}" has no base directory.`));
      } else {
        const file = await resolveAllowed(resolve(baseDir, specifier), ctx, `@import "${specifier}"`);
        if (file && stack.includes(file)) {
          ctx.diagnostics.push(buildDiagnostic('local.build.resource-cycle', `@import cycle through "${specifier}".`));
        } else if (file) {
          const inlined = await loadCssFile(file, ctx, stack);
          if (inlined !== null) output += `\n${inlined}\n`;
        }
      }
      index = parsed.end;
      continue;
    }

    if (boundary && (character === 'u' || character === 'U') && /^url\s*\(/i.test(css.slice(index, index + 12))) {
      const url = readCssUrl(css, index);
      if (!url) {
        ctx.diagnostics.push(buildDiagnostic('local.build.resource-invalid', 'CSS has a malformed url().'));
        output += 'url("")';
        const close = css.indexOf(')', index);
        index = close < 0 ? css.length : close + 1;
        continue;
      }
      const resolved = DATA_URL.test(url.value) || url.value.startsWith('#')
        ? css.slice(index, url.end)
        : await resolveUrl(url.value, baseDir, ctx, 'CSS');
      output += resolved === null ? 'url("")' : (DATA_URL.test(url.value) || url.value.startsWith('#') ? resolved : `url("${resolved}")`);
      index = url.end;
      continue;
    }

    if (boundary && (character === 'i' || character === 'I' || character === '-')) {
      const match = /^(?:-webkit-)?image-set\s*\(/i.exec(css.slice(index, index + 32));
      if (match) {
        const open = index + match[0].length - 1;
        const end = findBalancedEnd(css, open);
        if (end < 0) {
          ctx.diagnostics.push(buildDiagnostic('local.build.resource-invalid', 'CSS has an unterminated image-set().'));
          output += css.slice(index);
          break;
        }
        const body = css.slice(open + 1, end - 1);
        const resolvedBody = await resolveCss(body, baseDir, stack, ctx);
        validateImageSet(resolvedBody, ctx.diagnostics, 'CSS');
        output += `${match[0]}${resolvedBody})`;
        index = end;
        continue;
      }
    }

    output += character;
    index += 1;
  }
  return output;
}

async function resolveDeclared(
  input: LocalStyleResourceInput,
  ctx: CssContext,
): Promise<string | null> {
  if (input.path !== undefined) {
    const file = await resolveAllowed(resolve(ctx.root, input.path), ctx, `resource "${input.id}"`);
    if (!file) return null;
    return loadCssFile(file, ctx, []);
  }
  let baseDir: string | null = null;
  if (input.base !== undefined) {
    baseDir = await resolveAllowedDirectory(resolve(ctx.root, input.base), ctx, `resource "${input.id}" base`);
    if (!baseDir) return null;
  }
  return resolveCss(input.css ?? '', baseDir, [], ctx);
}

function selectedThemes(config: LocalConfig, names: readonly string[] | undefined, diagnostics: Diagnostic[]): readonly LocalThemePackage[] {
  if (names === undefined) return config.themes;
  const byName = new Map<string, LocalThemePackage>(config.themes.map((theme) => [theme.name, theme] as const));
  const seen = new Set<string>();
  const selected: LocalThemePackage[] = [];
  for (const name of names) {
    if (seen.has(name)) {
      diagnostics.push(buildDiagnostic('local.build.theme', `Theme "${name}" is selected more than once.`));
      continue;
    }
    seen.add(name);
    if (name === 'default') continue;
    const theme = byName.get(name);
    if (!theme) {
      diagnostics.push(buildDiagnostic('local.extension.theme-missing', `Theme ${name} is not installed for this build.`));
      continue;
    }
    selected.push(theme);
  }
  return selected;
}

function themeResources(theme: LocalThemePackage): readonly LocalStyleResource[] {
  return theme.css;
}

/**
 * Collect explicit component CSS, extra host resources and selected theme CSS.
 * Order is deterministic: component style ids, extra declarations, themes.
 */
export async function collectLocalBuildResources(
  input: ResourceCollectionInput,
): Promise<CollectedLocalResources> {
  const diagnostics: Diagnostic[] = [];
  const ctx: CssContext = {
    root: input.root,
    allowlist: input.allowlist,
    budgets: input.budgets,
    diagnostics,
    assets: new Map(),
    files: 0,
    inlinedBytes: 0,
    fileBudgetReported: false,
    inlinedBudgetReported: false,
    resourceBudgetReported: false,
    cssBudgetReported: false,
  };
  const declared = new Map<string, LocalStyleResourceInput>(
    input.declared.map((resource) => [resource.id, resource] as const),
  );
  const order: string[] = [];
  const origins = new Map<string, LocalResourceOrigin>();
  const required: string[] = [];
  const push = (id: string, origin: LocalResourceOrigin): void => {
    if (origins.has(id)) return;
    origins.set(id, origin);
    order.push(id);
  };
  for (const component of input.config.components) {
    for (const style of component.styles ?? []) {
      required.push(style);
      push(style, 'component');
    }
  }
  for (const resource of input.declared) push(resource.id, 'resource');
  const themes = selectedThemes(input.config, input.themes, diagnostics);
  const byThemeId = new Map<string, LocalStyleResource>();
  for (const theme of themes) {
    for (const resource of themeResources(theme)) {
      push(resource.id, 'theme');
      const existing = byThemeId.get(resource.id);
      if (existing) {
        if (existing.css !== resource.css) {
          diagnostics.push(buildDiagnostic(
            'local.build.resource-conflict',
            `Theme resource "${resource.id}" is declared by more than one theme with different contents.`,
          ));
        }
        continue;
      }
      byThemeId.set(resource.id, resource);
    }
  }
  if (order.length > input.budgets.maxResources) {
    ctx.resourceBudgetReported = true;
    diagnostics.push(buildDiagnostic(
      'local.build.resource-budget',
      `Resource collection exceeds the ${input.budgets.maxResources}-resource budget.`,
    ));
  }
  const limited = order.slice(0, input.budgets.maxResources);

  const resources: LocalBuildResource[] = [];
  let cssBytes = 0;
  for (const id of limited) {
    let css: string | null = null;
    const declaration = declared.get(id);
    if (declaration) {
      css = await resolveDeclared(declaration, ctx);
    } else {
      const themeResource = byThemeId.get(id);
      if (themeResource) css = await resolveCss(themeResource.css, null, [], ctx);
    }
    if (css === null) continue;
    const bytes = utf8ByteLength(css);
    cssBytes += bytes;
    if (cssBytes > input.budgets.maxCssBytes && !ctx.cssBudgetReported) {
      ctx.cssBudgetReported = true;
      diagnostics.push(buildDiagnostic(
        'local.build.resource-budget',
        `Collected CSS exceeds the ${input.budgets.maxCssBytes}-byte budget.`,
      ));
    }
    resources.push(Object.freeze({
      id,
      css,
      digest: sha256(css),
      bytes,
      origin: origins.get(id) ?? 'resource',
    }));
    if (declaration && byThemeId.has(id)) {
      const themeResource = byThemeId.get(id)!;
      if (sha256(themeResource.css) !== sha256(css)) {
        diagnostics.push(buildDiagnostic(
          'local.build.resource-conflict',
          `Resource "${id}" is declared by both the host and a theme with different contents.`,
        ));
      }
    }
  }

  const present = new Set(resources.map((resource) => resource.id));
  for (const id of required) {
    if (!present.has(id)) {
      diagnostics.push(buildDiagnostic(
        'local.extension.resource-missing',
        `Required component style resource ${id} is missing from the build.`,
      ));
    }
  }

  const assets = [...ctx.assets.values()].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return Object.freeze({
    resources: Object.freeze(resources),
    assets: Object.freeze(assets),
    css: resources.map((resource) => resource.css).join('\n'),
    diagnostics: Object.freeze(diagnostics),
  });
}
