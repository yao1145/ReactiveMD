import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { createLocalRuntime } from '../src/local/runtime';

it('server-renders the static pass before interactive enhancement', () => {
  const result = compileLocal('<input bind="name" label="Name" initial="Ada">\n\nHello {{ name }}.');
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  const runtime = createLocalRuntime(result.document);
  try {
    const html = renderToStaticMarkup(
      <LocalDocumentView
        document={result.document}
        runtime={runtime}
        mode="interactive"
        staticFirst
      />,
    );
    expect(html).toContain('data-render-mode="static"');
    expect(html).toContain('local-static');
    expect(html).toContain('Ada');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
  } finally {
    runtime.dispose();
  }
});
