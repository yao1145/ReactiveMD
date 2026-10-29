import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal, createLocalRuntime, type LocalHostComponentSchema } from '../src/local';
import type { LocalSourceTarget } from '../src/local/render-types';
import { LocalDocumentView, LocalReactiveDocument } from '../src/local/LocalDocumentView';

describe('LocalReactiveDocument state bridge', () => {
  it.each(['interactive', 'static'] as const)('keeps the stored slider value in %s output after a bound narrows', (mode) => {
    const source = '<external name="cap" type="number">\n<slider bind="n" label="N" initial="8" min="0" max="{{ cap }}">\n\n{{ n }}';
    const html = renderToStaticMarkup(<LocalReactiveDocument source={source} externalValues={{ cap: 4 }} mode={mode} />);
    expect(html).toContain('local-interpolation">8');
    if (mode === 'static') {
      expect(html).toContain('data-local-static-value="">8');
    } else {
      expect(html).toContain('class="md-slider-value" aria-hidden="true">8');
      expect(html).toContain('data-local-print-value="">8');
      expect(html).toContain('Must be at most 4');
    }
  });

  it('applies initialParameters before server rendering', () => {
    const source = '<number bind="pages" label="Pages" initial="4" min="1" max="20">\n\nPages: {{ pages }}';
    const html = renderToStaticMarkup(
      <LocalReactiveDocument source={source} initialParameters={{ pages: 12 }} mode="static" />,
    );
    expect(html).toContain('local-interpolation">12');
  });

  it('leaves author defaults when initial parameters are rejected atomically', () => {
    const source = '<number bind="pages" label="Pages" initial="4" min="1" max="20">\n\nPages: {{ pages }}';
    const html = renderToStaticMarkup(
      <LocalReactiveDocument source={source} initialParameters={{ pages: 99 }} mode="static" />,
    );
    expect(html).toContain('local-interpolation">4');
  });

  it('seeds external values without a separate runtime pass', () => {
    const source = [
      '<external name="rate" type="number">',
      '<computed name="price" value="{{ usd * rate }}">',
      '<number bind="usd" label="USD" initial="10">',
      'Price: {{ price }}',
    ].join('\n');
    const html = renderToStaticMarkup(
      <LocalReactiveDocument source={source} externalValues={{ rate: 7.2 }} mode="static" />,
    );
    expect(html).toContain('local-interpolation">72');
  });

  it('isolates a missing external to the expressions that read it', () => {
    const source = [
      '<external name="rate" type="number">',
      '<computed name="price" value="{{ usd * rate }}">',
      '<number bind="usd" label="USD" initial="10">',
      'USD: {{ usd }}; price: {{ price }}',
    ].join('\n');
    const html = renderToStaticMarkup(<LocalReactiveDocument source={source} mode="static" />);
    expect(html).toContain('USD: ');
    expect(html).toContain('local-error');
    expect(html).not.toContain('price: 0');
  });
});

describe('preview to source navigation', () => {
  const source = [
    '<panel title="Plan">',
    '<slider bind="people" label="People" initial="2" min="1" max="10">',
    '</panel>',
    '',
    'Monthly cost: {{ people * 100 }}',
  ].join('\n');

  it('omits source metadata when navigation is disabled', () => {
    const html = renderToStaticMarkup(<LocalReactiveDocument source={source} mode="static" />);
    expect(html).not.toContain('data-rmd-source-start');
  });

  it('emits source metadata for text and control labels when enabled', () => {
    const targets: LocalSourceTarget[] = [];
    const html = renderToStaticMarkup(
      <LocalReactiveDocument source={source} onSourceNavigate={(target) => targets.push(target)} />,
    );
    expect(html).toContain('data-rmd-source-start');
    expect(html).toContain('data-rmd-source-type="interpolation"');
    expect(html).toContain('data-rmd-source-component="slider"');
    // Rendering must not navigate; only a real click does.
    expect(targets).toEqual([]);
  });

  it('emits source metadata on a host-managed view without changing controls', () => {
    const compiled = compileLocal(source);
    if (!compiled.ok) throw new Error('Expected a valid document');
    const runtime = createLocalRuntime(compiled.document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView document={compiled.document} runtime={runtime} onSourceNavigate={() => {}} />,
      );
      expect(html).toContain('data-rmd-source-node');
      expect(html).toContain('type="range"');
    } finally {
      runtime.dispose();
    }
  });
});

describe('host renderer binding context', () => {
  const schema: LocalHostComponentSchema = {
    name: 'host-rating',
    form: 'leaf',
    props: { label: { kind: 'string' } },
    binding: { kind: 'number', min: 0, max: 5, step: 1 },
  };

  it('passes value, setValue, disabled, reset token and resolved props', () => {
    const result = compileLocal(
      '<host-rating bind="rating" label="Course rating" initial="3" disabled="{{ locked }}">\n<toggle bind="locked" label="Locked">',
      { hostComponents: [schema] },
    );
    if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
    const runtime = createLocalRuntime(result.document);
    const calls: Array<{ value: unknown; disabled: boolean; label: unknown; mode: string; token: number }> = [];
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView
          document={result.document}
          runtime={runtime}
          mode="static"
          hostRenderer={(_node, _data, ctx) => {
            calls.push({ value: ctx.value, disabled: ctx.disabled, label: ctx.props.label, mode: ctx.mode, token: ctx.resetToken });
            return <span className="host-rating">rating {String(ctx.value)} {String(ctx.props.label)}</span>;
          }}
        />,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ value: 3, disabled: false, label: 'Course rating', mode: 'static', token: 0 });
      expect(html).toContain('rating 3 Course rating');
    } finally {
      runtime.dispose();
    }
  });

  it('renders host container children with ctx.render', () => {
    const boxSchema: LocalHostComponentSchema = { name: 'host-box', form: 'container', props: {} };
    const result = compileLocal('<host-box>\n\nNested **text**\n\n</host-box>', { hostComponents: [boxSchema] });
    if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
    const runtime = createLocalRuntime(result.document);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView
          document={result.document}
          runtime={runtime}
          hostRenderer={(_node, _data, ctx) => <section className="host-box">{ctx.render()}</section>}
        />,
      );
      expect(html).toContain('host-box');
      expect(html).toContain('<strong><span>text</span></strong>');
    } finally {
      runtime.dispose();
    }
  });

  it('does not require host data for a binding-only host component', () => {
    const result = compileLocal('<host-rating bind="rating" initial="2">', { hostComponents: [schema] });
    if (!result.ok) throw new Error('Expected a valid document');
    const runtime = createLocalRuntime(result.document);
    const renderer = vi.fn(() => <span className="host-bound">bound</span>);
    try {
      const html = renderToStaticMarkup(
        <LocalDocumentView document={result.document} runtime={runtime} hostRenderer={renderer} />,
      );
      expect(renderer).toHaveBeenCalledTimes(1);
      expect(html).toContain('host-bound');
      expect(html).not.toContain('local-host-unavailable');
    } finally {
      runtime.dispose();
    }
  });
});
