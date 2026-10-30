import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { defineLocalComponent } from '../src/sdk/manifest';
import { createLocalConfig } from '../src/sdk/config';
import { createReactConfig, defineReactComponent } from '../src/react/sdk';
import { renderLocalStaticDocument } from '../src/react/server';

function fixture(ssr = true, broken = false) {
  const definition = defineLocalComponent({
    id: 'test/server-note', name: 'server-note', version: '1.0.0', protocol: 'reactive-md-component/v1',
    form: 'leaf', props: { title: { kind: 'string', default: 'A static note' } },
    capabilities: { interactive: true, static: true, ssr, offline: false },
  });
  const config = createLocalConfig({ components: [definition] });
  const reactConfig = createReactConfig(config, { components: [defineReactComponent(definition, {
    render: ctx => <span>{String(ctx.props.title)}</span>,
    renderStatic: ctx => {
      if (broken) throw new Error('broken server component');
      return <span>{String(ctx.props.title)}</span>;
    },
  })] });
  const compiled = compileLocal('<server-note>', { config });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return { document: compiled.document, runtime: createLocalRuntime(compiled.document), reactConfig };
}

describe('strict SDK server adapter', () => {
  it('renders registered stateless leaves with typed default props', () => {
    const input = fixture();
    const rendered = renderLocalStaticDocument(input);
    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(rendered.markup).toContain('A static note');
    input.runtime.dispose();
  });
  it('rejects an unsupported server capability before component execution', () => {
    const input = fixture(false);
    const rendered = renderLocalStaticDocument(input);
    expect(rendered.ok).toBe(false);
    expect(rendered.diagnostics.map(item => item.code)).toContain('local.extension.export-capability');
    input.runtime.dispose();
  });
  it('returns diagnostics when a nested React server render throws', () => {
    const input = fixture(true, true);
    const rendered = renderLocalStaticDocument(input);
    expect(rendered.ok).toBe(false);
    expect(rendered.diagnostics.some(item => item.code === 'local.extension.ssr-render' && item.message.includes('broken server component'))).toBe(true);
    input.runtime.dispose();
  });
});
