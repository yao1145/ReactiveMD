import type { LocalDocument, LocalNode, SourceRange } from 'reactive-md';

export interface OutlineHeading {
  key: string;
  title: string;
  depth: number;
  range: SourceRange;
  index: number;
  children: OutlineHeading[];
}

function headingText(node: LocalNode): string {
  if (node.type === 'image') return node.alt ?? '';
  if (node.type === 'break') return ' ';
  return (node.value ?? '') + (node.children ?? []).map(headingText).join('');
}

/** Use the compiled syntax tree so code, escaped headings and fallback text stay out. */
export function documentOutline(document: LocalDocument | null): OutlineHeading[] {
  const roots: OutlineHeading[] = [];
  const parents: OutlineHeading[] = [];
  const occurrences = new Map<string, number>();
  const pending = [...(document?.nodes ?? [])].reverse();
  let index = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === 'heading') {
      const depth = node.depth ?? 1;
      while (parents.length && parents[parents.length - 1].depth >= depth) parents.pop();
      const parent = parents[parents.length - 1];
      const title = headingText(node).replace(/\s+/g, ' ').trim();
      const base = `${parent?.key ?? ''}/${encodeURIComponent(title)}`;
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      const heading: OutlineHeading = {
        key: `${base}:${occurrence}`, title, depth, range: node.range, index: index++, children: [],
      };
      (parent?.children ?? roots).push(heading);
      parents.push(heading);
    }
    if (node.children) pending.push(...[...node.children].reverse());
  }
  return roots;
}

export function flattenOutline(headings: readonly OutlineHeading[]): OutlineHeading[] {
  const result: OutlineHeading[] = [];
  const pending = [...headings].reverse();
  while (pending.length) {
    const heading = pending.pop()!;
    result.push(heading);
    pending.push(...[...heading.children].reverse());
  }
  return result;
}

export function outlineHeadingAt(headings: readonly OutlineHeading[], offset: number): OutlineHeading | null {
  let active: OutlineHeading | null = null;
  for (const heading of headings) {
    if (heading.range.start > offset) break;
    active = heading;
  }
  return active;
}
