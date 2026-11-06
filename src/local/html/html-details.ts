import type { LocalNode } from '../contracts/types';

/**
 * `<details>` child layout shared by the parser and the renderer.
 *
 * Markdown keeps a leading `<summary>` inside a paragraph when the body uses
 * soft line breaks instead of blank lines:
 *
 * ```html
 * <details>
 *   <summary>1145</summary>
 *   1145
 * </details>
 * ```
 *
 * The paragraph then carries the summary and the body text together. Both the
 * parser (which stores the summary first) and the renderer (which splits the
 * trigger from the panel) must agree on that shape, so the rule lives here
 * instead of being repeated on each side.
 *
 * The splitter never mutates its input. A paragraph that also contains body
 * text is cloned with the summary removed and its range narrowed to the body
 * children that remain. Nested `<details>` subtrees are opaque: only the
 * direct children of the given list, and the direct children of its
 * paragraphs, are inspected, so an inner summary is never mistaken for the
 * outer one.
 */

const WHITESPACE_TEXT = /^\s*$/;

/** A text node with no visible characters cannot form a body by itself. */
function hasContent(node: LocalNode): boolean {
  return node.type !== 'text' || !WHITESPACE_TEXT.test(node.value ?? '');
}

/**
 * Keep the paragraph's identity and attributes while replacing its children
 * and narrowing its source range to the surviving content. A hand-built node
 * with an unusable range keeps its original range instead of guessing.
 */
function paragraphWithBody(paragraph: LocalNode, children: LocalNode[]): LocalNode {
  const first = children[0]?.range;
  const last = children[children.length - 1]?.range;
  if (
    first !== undefined
    && last !== undefined
    && Number.isInteger(first.start)
    && Number.isInteger(last.end)
    && first.start >= paragraph.range.start
    && last.end <= paragraph.range.end
    && first.start <= last.end
  ) {
    return { ...paragraph, children, range: { start: first.start, end: last.end } };
  }
  return { ...paragraph, children };
}

/**
 * Pull the first summary out of one paragraph. Remaining text before and after
 * it stays in the body paragraph; a paragraph with only the summary produces
 * no body node at all.
 */
function splitParagraph(paragraph: LocalNode): { summary: LocalNode; body?: LocalNode } | null {
  const children = paragraph.children;
  if (!children || children.length === 0) return null;
  const index = children.findIndex((child) => child.type === 'summary');
  if (index < 0) return null;
  const remaining = children.filter((_, childIndex) => childIndex !== index);
  if (!remaining.some(hasContent)) return { summary: children[index] };
  return {
    summary: children[index],
    body: paragraphWithBody(paragraph, remaining),
  };
}

/**
 * Split a `<details>` child list into its summary and body. A direct summary
 * wins, matching the parser's historical behavior; only when none exists is a
 * summary-bearing paragraph inspected. Later summaries stay in the body, and
 * nested details are left untouched.
 */
export function splitHtmlDetailsChildren(
  nodes: readonly LocalNode[],
): { summary?: LocalNode; body: LocalNode[] } {
  const directIndex = nodes.findIndex((node) => node.type === 'summary');
  if (directIndex >= 0) {
    return {
      summary: nodes[directIndex],
      body: nodes.filter((_, index) => index !== directIndex),
    };
  }

  const body: LocalNode[] = [];
  let summary: LocalNode | undefined;
  for (const node of nodes) {
    if (summary === undefined && node.type === 'paragraph') {
      const split = splitParagraph(node);
      if (split) {
        summary = split.summary;
        if (split.body) body.push(split.body);
        continue;
      }
    }
    body.push(node);
  }
  return summary === undefined ? { body } : { summary, body };
}

/**
 * Parser-level normalization: store the summary first and the body afterwards.
 * Idempotent, and safe to call on an already normalized list.
 */
export function normalizeHtmlDetailsChildren(nodes: readonly LocalNode[]): LocalNode[] {
  const { summary, body } = splitHtmlDetailsChildren(nodes);
  return summary === undefined ? body : [summary, ...body];
}
