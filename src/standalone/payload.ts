import type { LocalStateFile } from '../local/state';
import { readLocalCompileOptions } from '../local/options';
import type { Diagnostic, LocalCompileOptions } from '../local/types';
import type { ShareableMountPayload } from '../shareable';
import { errorText, standaloneDiagnostic } from './diagnostics';

/**
 * A target is a plain HTML id, never a selector. It is looked up with
 * `getElementById`, so anything that could compose a selector is rejected.
 */
const MOUNT_TARGET = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MAX_TARGET_LENGTH = 256;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const CONTROL_TEXT = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_IMAGES = 64;
const MAX_IMAGE_KEY_LENGTH = 4096;
const MAX_IMAGE_MAP_BYTES = 40 * 1024 * 1024;

function parseImages(value: unknown, fail: (code: string, message: string) => void): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    fail('standalone.payload.images', 'images must be a JSON object mapping image URLs to data URLs.');
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_IMAGES) {
    fail('standalone.payload.images', `images cannot contain more than ${MAX_IMAGES} entries.`);
    return undefined;
  }
  const images: Record<string, string> = Object.create(null);
  let total = 0;
  for (const [key, data] of entries) {
    if (
      !key
      || key.length > MAX_IMAGE_KEY_LENGTH
      || key === '__proto__'
      || CONTROL_TEXT.test(key)
      || typeof data !== 'string'
      || !DATA_IMAGE.test(data)
    ) {
      fail('standalone.payload.images', 'Every image entry must use a bounded URL key and a base64 raster data URL.');
      continue;
    }
    total += data.length;
    if (total > MAX_IMAGE_MAP_BYTES) {
      fail('standalone.payload.images', 'The embedded image map exceeds the 40 MiB budget.');
      return undefined;
    }
    images[key] = data;
  }
  return images;
}

export type MountPayloadParseResult =
  | { ok: true; payload: ShareableMountPayload }
  | { ok: false; diagnostics: Diagnostic[] };

/**
 * Compile capabilities are host-granted, never inferred from the source text
 * or from parameter state. Validate flags and limits with the shared reader and
 * keep only the normalized values the compiler actually consumes.
 */
function parseCompileOptions(
  value: unknown,
  fail: (code: string, message: string) => void,
): LocalCompileOptions | undefined {
  if (value === undefined) return undefined;
  const check = readLocalCompileOptions(value as LocalCompileOptions);
  if (!check.ok) {
    fail('standalone.payload.compile-options', `The payload compile options are invalid: ${check.message}`);
    return undefined;
  }
  const normalized: {
    enableCss: boolean;
    enableJavaScript: boolean;
    enableExtendedHtml: boolean;
    markdownBreaks?: boolean;
    limits?: { maxSyntaxNodes?: number;maxParseWork?:number;maxMarkdownDepth?:number };
  } = {
    enableCss: check.html.enableCss,
    enableJavaScript: check.html.enableJavaScript,
    enableExtendedHtml: check.html.enableExtendedHtml,
  };
  if (Object.hasOwn(value as object, 'markdownBreaks') && (value as LocalCompileOptions).markdownBreaks !== undefined) {
    normalized.markdownBreaks = check.markdownBreaks;
  }
  const limits = (value as { limits?: unknown }).limits;
  if (isPlainRecord(limits)) {
    const values={
      ...(limits.maxSyntaxNodes===undefined?{}:{maxSyntaxNodes:check.maxSyntaxNodes}),
      ...(limits.maxParseWork===undefined?{}:{maxParseWork:check.maxParseWork}),
      ...(limits.maxMarkdownDepth===undefined?{}:{maxMarkdownDepth:check.maxMarkdownDepth}),
    };
    if(Object.keys(values).length)normalized.limits=values;
  }
  return normalized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseUnsafe(value: unknown): MountPayloadParseResult {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string): void => {
    diagnostics.push(standaloneDiagnostic(code, message));
  };

  if (!isPlainRecord(value)) {
    return {
      ok: false,
      diagnostics: [standaloneDiagnostic(
        'standalone.payload.shape',
        'The reactive-md payload must be a JSON object.',
      )],
    };
  }

  if (value.version !== 1) {
    fail('standalone.payload.version', 'The reactive-md payload must use version 1.');
  }
  const target = value.target;
  if (typeof target !== 'string' || target.length === 0 || target.length > MAX_TARGET_LENGTH) {
    fail('standalone.payload.target', `The payload target must be an element id of 1-${MAX_TARGET_LENGTH} characters.`);
  } else if (!MOUNT_TARGET.test(target)) {
    fail(
      'standalone.payload.target',
      'The payload target must start with a letter and use only letters, digits, underscores or hyphens.',
    );
  }

  const source = value.source;
  if (typeof source !== 'string') {
    fail('standalone.payload.source', 'The payload source must be a string.');
  }

  const locale = value.locale === undefined ? 'en' : value.locale;
  if (locale !== 'en' && locale !== 'zh') {
    fail('standalone.payload.locale', 'The payload locale must be "en" or "zh".');
  }

  const colorScheme = value.colorScheme === undefined ? 'auto' : value.colorScheme;
  if (colorScheme !== 'light' && colorScheme !== 'dark' && colorScheme !== 'auto') {
    fail('standalone.payload.color-scheme', 'The payload colorScheme must be "light", "dark" or "auto".');
  }

  const hydrate = value.hydrate === undefined ? false : value.hydrate;
  if (typeof hydrate !== 'boolean') {
    fail('standalone.payload.hydrate', 'The payload hydrate flag must be a boolean.');
  }

  const state = value.state;
  if (!isPlainRecord(state)) {
    fail('standalone.payload.state', 'The payload state must be a JSON object.');
  }
  const compileOptions = parseCompileOptions(value.compileOptions, fail);
  const images = parseImages(value.images, fail);

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  // Build a fresh object: unknown keys and inherited data never reach mount.
  const payload: ShareableMountPayload = {
    version: 1,
    target: target as string,
    source: source as string,
    state: state as unknown as LocalStateFile,
    locale: locale as 'en' | 'zh',
    colorScheme: colorScheme as 'light' | 'dark' | 'auto',
    hydrate: hydrate as boolean,
    ...(compileOptions === undefined ? {} : { compileOptions }),
    ...(images && Object.keys(images).length > 0 ? { images } : {}),
  };
  return { ok: true, payload };
}

/**
 * Validate the JSON payload embedded by a shareable HTML export. This is a
 * plain-data parser: the source text is never executed and no field is ever
 * interpolated into HTML or a selector.
 */
export function parseMountPayload(value: unknown): MountPayloadParseResult {
  try {
    return parseUnsafe(value);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [standaloneDiagnostic(
        'standalone.payload.invalid',
        `The reactive-md payload could not be read: ${errorText(error)}`,
      )],
    };
  }
}
