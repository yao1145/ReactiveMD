import type { Diagnostic } from '../local/types';
import type { LocalStyleResource } from '../sdk/theme';
import { isLocalInlineCss } from '../sdk/theme';

/** Literal inline CSS; build adapters resolve local files before this boundary. */
export function isInlineExportCss(css: string): boolean {
  return isLocalInlineCss(css);
}

export function readLocalExportResources(value: unknown): { resources: readonly LocalStyleResource[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string) => diagnostics.push({ code, message, severity: 'error', range: { start: 0, end: 0 }, line: 1, column: 1 } as Diagnostic);
  const resources = new Map<string, LocalStyleResource>();
  if (!Array.isArray(value) || value.length > 256) {
    fail('local.extension.resource-budget', 'Styles must be a bounded resource array.');
    return { resources: [], diagnostics };
  }
  let bytes = 0;
  for (const resource of value) {
    if (!resource || typeof resource !== 'object' || typeof resource.id !== 'string'
      || !resource.id || resource.id.length > 256 || /[\u0000-\u001f]/.test(resource.id)
      || typeof resource.css !== 'string' || !isInlineExportCss(resource.css)) {
      fail('local.extension.resource-invalid', 'Export styles must be identified inline CSS without network resources.');
      continue;
    }
    if (resource.css.length > 4 * 1024 * 1024) {
      fail('local.extension.resource-budget', 'A style resource exceeds the 4 MiB budget.');
      break;
    }
    const previous = resources.get(resource.id);
    if (previous && previous.css !== resource.css) fail('local.extension.resource-conflict', `Style resource ${resource.id} has conflicting contents.`);
    if (!previous) {
      bytes += new TextEncoder().encode(resource.css).byteLength;
      if (resources.size >= 128 || bytes > 4 * 1024 * 1024) {
        fail('local.extension.resource-budget', 'Export styles exceed 128 resources or 4 MiB.');
        break;
      }
      resources.set(resource.id, Object.freeze({ id: resource.id, css: resource.css }));
    }
  }
  return { resources: Object.freeze([...resources.values()]), diagnostics };
}
