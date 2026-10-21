import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile, createRuntime } from '../src';
import type { DocumentNode } from '../src';
import { RuntimeDocumentView } from '../src/react';

const guide = readFileSync(new URL('../docs/guide.md', import.meta.url), 'utf8');
const tree = unified().use(remarkParse).parse(guide);
const examples = tree.children.flatMap(node => node.type === 'code' && node.lang === 'markdown' && node.value.includes('```reactive-md')
  ? [{ source: node.value, line: node.position?.start.line }] : []);
function flatten(nodes: DocumentNode[]): DocumentNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}

describe('copyable complete documents in the language guide', () => {
  it('includes at least eight complete examples', () => expect(examples.length).toBeGreaterThanOrEqual(8));
  for (const example of examples) {
    it(`compiles, initializes and renders the document at guide line ${example.line}`, () => {
      const result = compile(example.source);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const runtime = createRuntime(result.document);
      try {
        const markup = renderToStaticMarkup(<RuntimeDocumentView document={result.document} runtime={runtime}
          report={() => {}} focusDiagnostic={() => {}} />);
        expect(markup).not.toContain('class="component-error"');
        // The savings curve must tell the same story as the displayed final amount,
        // including deposits and the zero-interest case.
        if ('finalAmount' in result.document.computed) {
          const formula = flatten(result.document.nodes).find(node => node.name === 'plot')?.props?.formula;
          if (!formula || formula.kind !== 'literal' || typeof formula.value !== 'string') throw new Error('Missing savings formula');
          const checkEndpoint = () => {
            const snapshot = runtime.snapshot();
            const endpoint = runtime.evaluate({ kind: 'expression', expression: formula.value as string }, { x: snapshot.state.years });
            expect(endpoint).toBeCloseTo(snapshot.computed.finalAmount as number, 5);
          };
          checkEndpoint();
          const rateBinding = result.document.bindings.find(binding => binding.state === 'rate')!;
          expect(runtime.writeBinding(rateBinding.componentId, 0).ok).toBe(true);
          checkEndpoint();
        }
      } finally { runtime.dispose(); }
    });
  }
});
