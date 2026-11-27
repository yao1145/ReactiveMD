import { walkLocalNodes } from '../source/source-context';
import type { LocalNode } from '../types';

export function collectUsedComponents(nodes: readonly LocalNode[]): readonly string[] {
  const names = new Set<string>();
  for (const node of walkLocalNodes(nodes)) {
    if (node.name && (node.type === 'component' || (node.type === 'hostComponent' && node.hostForm !== undefined))) {
      names.add(node.name);
    }
  }
  return Object.freeze([...names]);
}
