import { createElement, type ReactElement, type ReactNode } from 'react';
import { boundedLocalMathLiteral, parseLocalMathDisplay, type MathNode } from './math-display';

/**
 * Safe native MathML rendering for local LaTeX.
 *
 * Parsing and support detection live in the React-free `math-display` module,
 * so compile-time diagnostics use exactly the same rules as this renderer.
 * The renderer never interprets HTML, styles, macros, files or links from the
 * source. Unknown commands are shown as literal text, so a formula that cannot
 * be computed still remains readable. All source text passes through React as
 * text nodes.
 */

export interface LatexViewProps {
  source: string;
  display?: boolean;
}

type MathProps = Record<string, unknown> | null;

const element = (tag: string, props: MathProps, ...children: ReactNode[]): ReactElement =>
  (createElement as unknown as (
    type: string,
    props?: MathProps,
    ...children: ReactNode[]
  ) => ReactElement)(tag, props, ...children);

function renderMathNode(node: MathNode): ReactNode {
  const props = (node.attrs ?? null) as MathProps;
  if (node.children && node.children.length > 0) {
    return element(node.tag, props, ...node.children.map(renderMathNode));
  }
  if (node.text !== undefined) return element(node.tag, props, node.text);
  return element(node.tag, props);
}

export function LatexView({ source, display = false }: LatexViewProps): ReactElement {
  const literal = boundedLocalMathLiteral(source);
  const parsed = parseLocalMathDisplay(source);
  const body = parsed.node ? renderMathNode(parsed.node) : element('mtext', null, literal);
  const annotation = literal;
  return element(
    'math',
    {
      display: display ? 'block' : 'inline',
      className: display ? 'local-math local-math-block' : 'local-math',
      'aria-label': annotation,
    },
    element(
      'semantics',
      null,
      element('mrow', null, body),
      element('annotation', { encoding: 'application/x-tex' }, annotation),
    ),
  );
}
