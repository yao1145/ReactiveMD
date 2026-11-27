import { walkLocalNodes } from '../source/source-context';
import type { LocalDocument } from '../types';

const staticTypes = new Set([
  'root', 'heading', 'paragraph', 'text', 'rawBody', 'emphasis', 'strong', 'delete', 'underline',
  'mark', 'sup', 'sub', 'span', 'div', 'summary', 'details', 'inlineCode', 'code', 'blockquote',
  'break', 'thematicBreak', 'list', 'listItem', 'link', 'image', 'htmlTable', 'htmlTableElement',
  'table', 'tableRow', 'tableCell', 'math', 'inlineMath', 'html', 'extendedHtml', 'fallback',
  'footnoteReference', 'footnoteDefinition', 'comment', 'definition',
]);

export function localDocumentRequiresRuntime(document: LocalDocument): boolean {
  if (document.html || document.capabilities?.scripts.length || document.extensions
    || [document.bindings, document.computations, document.validations, document.externals, document.dynamicConstraints]
      .some(data => data && Object.keys(data).length)) return true;
  const builtInIf = document.componentDefinitions?.some(definition => definition.id === 'reactive-md/if' && definition.name === 'if');
  for (const node of walkLocalNodes(document.nodes)) {
    if (staticTypes.has(node.type)) continue;
    if (builtInIf && node.type === 'component' && node.name === 'if'
      && (node.attrs?.when === 'true' || node.attrs?.when === 'false')) continue;
    return true;
  }
  return false;
}
