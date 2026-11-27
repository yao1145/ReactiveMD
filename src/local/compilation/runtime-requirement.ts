import { walkLocalNodes } from '../source/source-context';
import { MAX_LOCAL_SDK_COMPONENTS } from '../../sdk/manifest';
import { LOCAL_EXTENSIONS_PROTOCOL } from '../../sdk/version';
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
 * or dynamic attribute keeps the runtime path. The document-level checks
 * reject the remaining stateful cases.
 */
function staticallyProjectable(node: LocalNode, definition: LocalComponentDefinition | undefined): boolean {
  if (!definition || definition.capabilities.static !== true) return false;
  if (node.literalAttributes === true) return true;
  return !Object.values(node.attrs ?? {}).some(value => value.includes('{{'));
}

export function localDocumentRequiresRuntime(document: LocalDocument): boolean {
  if (document.html || document.capabilities?.scripts.length
    || [document.bindings, document.computations, document.validations, document.externals, document.dynamicConstraints]
      .some(data => data && Object.keys(data).length)) return true;
  const definitions = new Map((document.componentDefinitions ?? []).map(definition => [definition.name, definition]));
  const extensions = document.extensions;
  if (extensions && (extensions.protocol !== LOCAL_EXTENSIONS_PROTOCOL || !Array.isArray(extensions.components)
    || extensions.components.length > MAX_LOCAL_SDK_COMPONENTS)) return true;
  const requirements = extensions && new Map(extensions.components.flatMap(requirement =>
    requirement && typeof requirement.name === 'string' ? [[requirement.name, requirement] as const] : []));
  const builtInIf = definitions.get('if')?.id === 'reactive-md/if';
  for (const node of walkLocalNodes(document.nodes)) {
    if (staticTypes.has(node.type)) continue;
    if (builtInIf && node.type === 'component' && node.name === 'if'
      && (node.attrs?.when === 'true' || node.attrs?.when === 'false')) continue;
    const definition = definitions.get(node.name ?? '');
    if (node.type === 'component' && node.name !== 'if' && staticallyProjectable(node, definition)) continue;
    if (node.type === 'hostComponent' && definition?.capabilities.interactive === false) {
      const requirement = requirements?.get(definition.name);
      if (requirement?.id === definition.id && requirement.version === definition.version
        && staticallyProjectable(node, definition)) continue;
    }
    return true;
  }
  return false;
}
