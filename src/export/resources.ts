import type { Diagnostic } from '../local/types';
import type { LocalStyleResource } from '../sdk/theme';
import { isLocalInlineCss } from '../sdk/theme';
import { createLocalObservabilityDiagnostic } from '../local/observability';

/** Literal inline CSS; build adapters resolve local files before this boundary. */
export function isInlineExportCss(css: string): boolean {
  return isLocalInlineCss(css);
}

export function readLocalExportResources(value: unknown): { resources: readonly LocalStyleResource[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  // Every caller rejects the export plan on these diagnostics, so neither is recoverable.
  const fail = (code: string, message: string) => diagnostics.push({ code, message, severity: 'error', phase: 'export', recoverable: false, range: { start: 0, end: 0 }, line: 1, column: 1 });
  const budgetFailure = (message: string, budget: string, limit: number, actual: number, unit: string, owner?: string) => {
    diagnostics.push({
      ...createLocalObservabilityDiagnostic('local.resource.budget', { budget, limit, actual, unit, ...(owner ? { owner } : {}) }),
      recoverable: false,
      code: 'local.extension.resource-budget',
      message,
    });
  };
  const resources = new Map<string, LocalStyleResource>();
  if (!Array.isArray(value)) {
    fail('local.extension.resource-invalid', 'Styles must be a bounded resource array.');
    return { resources: [], diagnostics };
  }
  if (value.length > 256) {
    budgetFailure('Styles must be a bounded resource array.', 'maxStyleEntries', 256, value.length, 'files');
    return { resources: [], diagnostics };
  }
  const maxCssBytes = 4 * 1024 * 1024;
  let bytes = 0;
  for (const resource of value) {
    if (!resource || typeof resource !== 'object' || typeof resource.id !== 'string'
      || !resource.id || resource.id.length > 256 || /[\u0000-\u001f]/.test(resource.id)
      || typeof resource.css !== 'string' || !isInlineExportCss(resource.css)) {
      fail('local.extension.resource-invalid', 'Export styles must be identified inline CSS without network resources.');
      continue;
    }
    const resourceBytes = new TextEncoder().encode(resource.css).byteLength;
    if (resourceBytes > maxCssBytes) {
      budgetFailure('A style resource exceeds the 4 MiB budget.', 'maxStyleBytes', maxCssBytes, resourceBytes, 'bytes', resource.id);
      break;
    }
    const previous = resources.get(resource.id);
    if (previous && previous.css !== resource.css) fail('local.extension.resource-conflict', `Style resource ${resource.id} has conflicting contents.`);
    if (!previous) {
      bytes += resourceBytes;
      if (resources.size >= 128) {
        budgetFailure('Export styles exceed 128 resources or 4 MiB.', 'maxStyles', 128, resources.size + 1, 'files', resource.id);
        break;
      }
      if (bytes > maxCssBytes) {
        budgetFailure('Export styles exceed 128 resources or 4 MiB.', 'maxCssBytes', maxCssBytes, bytes, 'bytes', resource.id);
        break;
      }
      resources.set(resource.id, Object.freeze({ id: resource.id, css: resource.css }));
    }
  }
  return { resources: Object.freeze([...resources.values()]), diagnostics };
}
