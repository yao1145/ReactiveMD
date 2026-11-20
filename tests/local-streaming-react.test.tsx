import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalReactiveDocument } from '../src/local/rendering/document/LocalDocumentView';

// A model stream commonly ends mid-component: the closing tag has not arrived
// yet. The streaming phase must keep that tail readable instead of failing the
// whole preview. Final compilation is unchanged.
const PARTIAL = [
  '<panel title="Plan">',
  '<slider bind="people" label="People" initial="2" min="1" max="10">',
  '',
  'Monthly cost: {{ people * 100 }}',
].join('\n');
const COMPLETE = `${PARTIAL}\n</panel>`;

describe('LocalReactiveDocument streaming source phase', () => {
  it('renders an unclosed component snapshot as readable fallback', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument source={PARTIAL} sourcePhase="streaming" />,
    );
    expect(html).toContain('data-local-fallback');
    expect(html).toContain('&lt;panel title=&quot;Plan&quot;&gt;');
    expect(html).toContain('Monthly cost:');
    // No fatal panel: the snapshot is provisional, not broken.
    expect(html).not.toContain('local-inactive');
    expect(html).not.toContain('syntax errors');
    // Streaming renders read-only so side effects stay deferred.
    expect(html).toContain('data-render-mode="static"');
    expect(html).not.toContain('role="slider"');
  });

  it('renders the completed document with normal control markup at final', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument source={COMPLETE} sourcePhase="final" />,
    );
    expect(html).not.toContain('local-inactive');
    expect(html).not.toContain('data-local-fallback');
    expect(html).toContain('md-panel local-panel');
    expect(html).toContain('role="slider"');
    expect(html).toContain('local-interpolation">200');
  });

  it('keeps a final snapshot readable when the host asks for static output', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument source={COMPLETE} sourcePhase="final" mode="static" />,
    );
    expect(html).toContain('local-static');
    expect(html).toContain('data-local-static-value="">2');
    expect(html).toContain('local-interpolation">200');
    expect(html).not.toContain('role="slider"');
  });

  it('renders repeated identical streaming snapshots and a final transition without errors', () => {
    const snapshot = <LocalReactiveDocument source={PARTIAL} sourcePhase="streaming" />;
    const first = renderToStaticMarkup(snapshot);
    const second = renderToStaticMarkup(snapshot);
    expect(first).toBe(second);
    expect(first).toContain('data-local-fallback');

    // A phase change is an ordinary re-render inside one session; the final
    // markup replaces the provisional fallback and never shows the fatal
    // panel. Effects (diagnostics callbacks) do not run under SSR, so this
    // covers the rendered contract only.
    const final = renderToStaticMarkup(
      <LocalReactiveDocument source={COMPLETE} sourcePhase="final" mode="static" />,
    );
    expect(final).not.toContain('data-local-fallback');
    expect(final).not.toContain('local-inactive');
    expect(final).toContain('local-interpolation">200');
  });

  it('keeps the error panel for a deterministic streaming failure', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument
        source={PARTIAL}
        sourcePhase="streaming"
        compileOptions={{ limits: { maxSyntaxNodes: 0 } }}
      />,
    );
    // Invalid options cannot be repaired by later source, so they stay fatal.
    expect(html).toContain('role="alert"');
    expect(html).toContain('syntax errors');
    expect(html).not.toContain('data-local-fallback');
  });

  it('keeps omitted-phase output identical to an explicit final phase', () => {
    const legacy = renderToStaticMarkup(<LocalReactiveDocument source={COMPLETE} />);
    const explicit = renderToStaticMarkup(
      <LocalReactiveDocument source={COMPLETE} sourcePhase="final" />,
    );
    expect(legacy).toBe(explicit);
  });

  it('honors compileOptions.sourcePhase when the prop is omitted', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument source={PARTIAL} compileOptions={{ sourcePhase: 'streaming' }} />,
    );
    expect(html).toContain('data-local-fallback');
    expect(html).toContain('data-render-mode="static"');
    expect(html).not.toContain('local-inactive');
  });

  it('lets the prop win over compileOptions.sourcePhase', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument
        source={COMPLETE}
        sourcePhase="final"
        compileOptions={{ sourcePhase: 'streaming' }}
      />,
    );
    expect(html).not.toContain('data-local-fallback');
    expect(html).toContain('role="slider"');
  });

  it('accepts a transient diagnostics callback without changing the rendered document', () => {
    const seen: unknown[] = [];
    const html = renderToStaticMarkup(
      <LocalReactiveDocument
        source={PARTIAL}
        sourcePhase="streaming"
        onTransientDiagnostics={(diagnostics) => seen.push(diagnostics)}
      />,
    );
    // Effects do not run during server rendering, so the callback stays
    // untouched; the prop must not affect provisional markup either.
    expect(seen).toEqual([]);
    expect(html).toContain('data-local-fallback');
    expect(html).not.toContain('local-inactive');
  });
});