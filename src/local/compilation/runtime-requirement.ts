import { walkLocalNodes } from '../source/source-context';
import type { LocalComponentDefinition } from '../../sdk/types';
import type { LocalDocument, LocalNode } from '../types';

const staticTypes = new Set([
  'root', 'heading', 'paragraph', 'text', 'rawBody', 'emphasis', 'strong', 'delete', 'underline',
  'mark', 'sup', 'sub', 'span', 'div', 'summary', 'details', 'inlineCode', 'code', 'blockquote',
  'break', 'thematicBreak', 'list', 'listItem', 'link', 'image', 'htmlTable', 'htmlTableElement',
  'table', 'tableRow', 'tableCell', 'math', 'inlineMath', 'html', 'extendedHtml', 'fallback',
  'footnoteReference', 'footnoteDefinition', 'comment', 'definition', 'externalSlot',
]);

/**
 * A component can join a runtime-free document only when its manifest declares
 * static projection and every attribute is already literal; any interpolation
 * or dynamic attribute keeps the runtime path. The document-level binding and
 * computation checks above remove the remaining stateful cases.
 */
function staticallyProjectable(node: LocalNode, definitions: ReadonlyMap<string, LocalComponentDefinition>): boolean {
  if (node.type !== 'component' || node.name === 'if') return false;
  const definition = definitions.get(node.name ?? '');
  if (!definition || definition.capabilities.static !== true) return false;
  if (node.literalAttributes === true) return true;
  return !Object.values(node.attrs ?? {}).some(value => value.includes('{{'));
}

export function localDocumentRequiresRuntime(document: LocalDocument): boolean {
  if (document.html || document.capabilities?.scripts.length || document.extensions
    || [document.bindings, document.computations, document.validations, document.externals, document.dynamicConstraints]
      .some(data => data && Object.keys(data).length)) return true;
  const definitions = new Map((document.componentDefinitions ?? []).map(definition => [definition.name, definition]));
  const builtInIf = definitions.get('if')?.id === 'reactive-md/if';
  for (const node of walkLocalNodes(document.nodes)) {
    if (staticTypes.has(node.type)) continue;
    if (builtInIf && node.type === 'component' && node.name === 'if'
      && (node.attrs?.when === 'true' || node.attrs?.when === 'false')) continue;
    if (staticallyProjectable(node, definitions)) continue;
    return true;
  }
  return false;
}
