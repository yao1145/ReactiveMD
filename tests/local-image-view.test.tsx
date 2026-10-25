import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ZoomableImage } from '../src/local/image-view';

const IMAGE = {
  src: 'https://images.example.com/chart.png',
  alt: 'Revenue chart',
  title: 'Quarterly revenue',
};
const rootRef = { current: null as HTMLElement | null };

function render(
  mode: 'interactive' | 'static',
  props: Partial<typeof IMAGE> = {},
  ref: typeof rootRef = rootRef,
): string {
  return renderToStaticMarkup(
    <ZoomableImage
      src={props.src ?? IMAGE.src}
      alt={props.alt ?? IMAGE.alt}
      title={props.title ?? IMAGE.title}
      mode={mode}
      rootRef={ref}
    />,
  );
}

function expectPlainImage(html: string): void {
  expect(html.startsWith('<img ')).toBe(true);
  expect(html).toContain('class="md-image"');
  expect(html).toContain(`src="${IMAGE.src}"`);
  expect(html).toContain(`alt="${IMAGE.alt}"`);
  expect(html).toContain(`title="${IMAGE.title}"`);
  expect(html).toContain('loading="lazy"');
  expect(html).toMatch(/referrerpolicy="no-referrer"/i);
}

describe('ZoomableImage server rendering', () => {
  it('renders exactly the plain Markdown image in static mode', () => {
    const html = render('static');
    expectPlainImage(html);
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('data-zoomable');
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('<button');
  });

  it('keeps server markup identical in interactive mode, before any client effect', () => {
    // The interactive trigger is added after mount, so the server and the
    // hydration pass emit the same image element in both modes.
    expect(render('interactive')).toBe(render('static'));
  });

  it('emits no portal, dialog or buttons while no preview is open', () => {
    const html = render('interactive');
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('<button');
    expect(html.match(/<img\b/g)).toHaveLength(1);
  });

  it('does not read the document root during rendering or server rendering', () => {
    const hostileRootRef = {
      get current(): HTMLElement | null {
        throw new Error('the document root was accessed before the preview opened');
      },
    };
    expect(() => render('interactive', {}, hostileRootRef)).not.toThrow();
  });

  it('keeps an image inside a Markdown link as plain anchor content', () => {
    const html = renderToStaticMarkup(
      <a href="https://example.com/page">
        <ZoomableImage
          src={IMAGE.src}
          alt={IMAGE.alt}
          title={IMAGE.title}
          mode="interactive"
          rootRef={rootRef}
        />
      </a>,
    );
    expect(html).toContain('<a href="https://example.com/page"><img ');
    expect(html.match(/<img\b/g)).toHaveLength(1);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('role="button"');
  });

  it('preserves an empty alt and omits an absent title', () => {
    const html = renderToStaticMarkup(
      <ZoomableImage src={IMAGE.src} alt="" mode="static" rootRef={rootRef} />,
    );
    expect(html).toContain('alt=""');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('aria-label');
  });

  it('escapes author-provided alt text instead of emitting markup', () => {
    const html = render('static', { alt: '"><button>x</button>' });
    expect(html).toContain('&lt;button&gt;');
    expect(html).not.toContain('<button');
  });
});
