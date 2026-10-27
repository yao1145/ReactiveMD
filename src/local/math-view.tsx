import { createElement, type ReactElement, type ReactNode } from 'react';
import { boundedLocalMathLiteral, renderLocalMathDisplay } from './math-display';

/**
 * Safe KaTeX rendering for local LaTeX.
 *
 * Typesetting, support detection and diagnostics live in the React-free
 * `math-display` module, so compile-time diagnostics use exactly the same KaTeX
 * call as this renderer. Only the markup KaTeX generated is injected; error
 * messages, macros and HTML from the author are never interpreted. A formula
 * that cannot be typeset falls back to bounded source text rendered by React.
 */

export interface LatexViewProps {
  source: string;
  display?: boolean;
}

type ElementProps = Record<string, unknown>;

const element = (tag: string, props: ElementProps, ...children: ReactNode[]): ReactElement =>
  (createElement as unknown as (
    type: string,
    props?: ElementProps,
    ...children: ReactNode[]
  ) => ReactElement)(tag, props, ...children);

export function LatexView({ source, display = false }: LatexViewProps): ReactElement {
  const result = renderLocalMathDisplay(source, display);
  const classes = display ? 'local-math local-math-block' : 'local-math';

  if (result.html !== null) {
    return element('span', {
      className: classes,
      'data-local-math': 'katex',
      dangerouslySetInnerHTML: { __html: result.html },
    });
  }

  const literal = boundedLocalMathLiteral(source);
  return element(
    'span',
    {
      className: `${classes} local-math-fallback`,
      'data-local-math': 'fallback',
      role: 'math',
      'aria-label': literal,
    },
    literal,
  );
}
