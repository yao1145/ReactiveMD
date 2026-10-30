import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LocalDocumentView, type LocalDocumentViewProps } from '../local/LocalDocumentView';
import { createLocalExportPlan } from '../export';
import { extensionDiagnostic, validateLocalExtensionRequirements } from '../export/requirements';
import type { Diagnostic } from '../local/types';
import type { LocalStyleResource } from '../sdk/theme';

export type LocalStaticRenderResult =
  | { readonly ok: true; readonly markup: string; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** Strict server execution: preflight capabilities, then return markup or diagnostics. */
export function renderLocalStaticDocument(
  options: Omit<LocalDocumentViewProps, 'mode' | 'staticFirst'> & { readonly resources?: readonly LocalStyleResource[] },
): LocalStaticRenderResult {
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(...validateLocalExtensionRequirements(options.document.extensions, options.reactConfig?.config));
  if (diagnostics.length) return { ok: false, diagnostics };
  if (options.reactConfig) {
    const plan = createLocalExportPlan({ document: options.document, config: options.reactConfig.config, target: 'ssr', resources: options.resources });
    diagnostics.push(...plan.diagnostics);
    if (!plan.ok) return { ok: false, diagnostics };
  }
  try {
    // Retain React's text boundaries for static-first standalone hydration.
    // The controls still render in read-only static mode.
    const markup = renderToString(createElement(LocalDocumentView, {
      ...options, mode: 'static', staticFirst: false,
      onDiagnostics(items) { diagnostics.push(...items); options.onDiagnostics?.(items); },
    }));
    if (/data-rmd-extension-error\s*=|local-sdk-unavailable/.test(markup)) {
      diagnostics.push(extensionDiagnostic('local.extension.ssr-render', 'Server output contains an unavailable extension component.'));
    }
    if (diagnostics.some(item => item.severity === 'error')) return { ok: false, diagnostics };
    return { ok: true, markup, diagnostics };
  } catch (error) {
    const ids = options.document.extensions?.components.map(item => item.id).join(', ');
    diagnostics.push(extensionDiagnostic('local.extension.ssr-render',
      `Server rendering failed${ids ? ` (document extensions: ${ids})` : ''}: ${error instanceof Error ? error.message : String(error)}`));
    return { ok: false, diagnostics };
  }
}
