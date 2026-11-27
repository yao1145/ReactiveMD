import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { extensionDiagnostic } from '../export/requirements';
import type { Diagnostic } from '../local/types';
import { LocalStaticDocumentView, staticDocumentDiagnostics, type LocalStaticDocumentViewProps } from './rendering/document/LocalStaticDocumentView';

export type LocalStaticRenderResult =
  | { readonly ok: true; readonly markup: string; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** Render a compiler-proven static document without constructing a runtime. */
export function renderLocalStaticMarkup(options: LocalStaticDocumentViewProps): LocalStaticRenderResult {
  try {
    const diagnostics = staticDocumentDiagnostics(options);
    if (diagnostics.length) return { ok: false, diagnostics };
    return { ok: true, markup: renderToString(createElement(LocalStaticDocumentView, options)), diagnostics };
  } catch (error) {
    return { ok: false, diagnostics: [extensionDiagnostic('local.extension.ssr-render',
      `Server rendering failed: ${error instanceof Error ? error.message : String(error)}`)] };
  }
}
