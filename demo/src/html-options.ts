import type { LocalCompileOptions, LocalHtmlOptions } from 'reactive-md';

/**
 * Demo-owned capability switches. Every entry starts disabled: the playground
 * keeps the safe ReactiveMD renderer until the visitor explicitly grants a
 * native HTML capability for the current document.
 */
export type DemoHtmlOptions = Required<LocalHtmlOptions>;

export const DEFAULT_HTML_OPTIONS: DemoHtmlOptions = Object.freeze({
  enableCss: false,
  enableJavaScript: false,
  enableExtendedHtml: false,
});

export function freshHtmlOptions(): DemoHtmlOptions {
  return { ...DEFAULT_HTML_OPTIONS };
}

/** True when any capability would switch the whole document to native HTML. */
export function isHtmlOptionsActive(options?: LocalHtmlOptions | null): boolean {
  return options?.enableCss === true
    || options?.enableJavaScript === true
    || options?.enableExtendedHtml === true;
}

/**
 * Convert the demo switches into the compile option shape. Keeping `undefined`
 * for the default all-off case (without custom limits) makes the safe default
 * explicit to the compiler and to the scheduler, which treats it as the normal
 * ReactiveMD route.
 */
export function toCompileOptions(options?: LocalCompileOptions | null): LocalCompileOptions | undefined {
  if (!isHtmlOptionsActive(options) && options?.limits === undefined) return undefined;
  return {
    ...(options?.limits ? { limits: options.limits } : {}),
    enableCss: options?.enableCss === true,
    enableJavaScript: options?.enableJavaScript === true,
    enableExtendedHtml: options?.enableExtendedHtml === true,
  };
}

/**
 * Primitive routing key used by compilation effects. Two equivalent option
 * sets produce the same key, so an options-only change can safely rebuild the
 * scheduler without preserving a preview compiled under different permissions.
 */
export function compileOptionsKey(options?: LocalCompileOptions | null): string {
  return [
    options?.enableCss === true ? 'css' : '',
    options?.enableJavaScript === true ? 'js' : '',
    options?.enableExtendedHtml === true ? 'html' : '',
    options?.limits?.maxSyntaxNodes ?? '',
  ].join('|');
}
