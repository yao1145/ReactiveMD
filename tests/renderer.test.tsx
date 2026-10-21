import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile, createRuntime } from '../src';
import { registerReactiveComponent, useReactiveContext, RuntimeDocumentView, type ComponentProps } from '../src/react';

it('retains the renderer of a compiled host component after unregistering its name', () => {
  function Host({ node }: ComponentProps) {
    const { runtime } = useReactiveContext();
    return <span>HOST:{String(runtime.evaluate(node.props!.value))}</span>;
  }
  const unregister = registerReactiveComponent({ name: 'retained-host', form: 'inline', label: 'none', children: 'none',
    props: { value: { type: 'string', dynamic: true, required: true } } }, Host);
  const result = compile('```reactive-md\nversion: "0.2"\nstate:\n  name: one\nactions:\n  change:\n    - set: name\n      value: two\n```\n\n:retained-host{value="=name"}');
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('fixture failed');
  const runtime = createRuntime(result.document);
  const render = () => renderToStaticMarkup(<RuntimeDocumentView document={result.document} runtime={runtime} report={() => {}} focusDiagnostic={() => {}} />);
  expect(render()).toContain('HOST:one');
  unregister();
  expect(runtime.dispatch('change').ok).toBe(true);
  expect(render()).toContain('HOST:two');
});
