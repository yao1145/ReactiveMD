import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse, parseFragment } from 'parse5';
import type { LocalHtmlPolicy } from '../src/local/types';
import * as html from '../src/local/html/html';
import {
  extendedFragmentDocument,
  extendedFragmentSandbox,
  sanitizeExtendedFragment,
} from '../src/local/html/extended-fragment';
import { ExtendedHtmlFragment } from '../src/local/rendering/document/ExtendedHtmlFragment';

const policy = (overrides: Partial<LocalHtmlPolicy> = {}): LocalHtmlPolicy => ({
  enableCss: true, enableJavaScript: false, enableExtendedHtml: true, ...overrides,
});
const elements = (node: any, tag: string): any[] => [
  ...(node.tagName === tag ? [node] : []),
  ...(node.childNodes ?? []).flatMap((child: any) => elements(child, tag)),
];
const attrs = (node: any): Record<string, string> =>
  Object.fromEntries((node?.attrs ?? []).map((attribute: any) => [attribute.name, attribute.value]));
const text = (node: any): string =>
  (node.nodeName === '#text' ? node.value : '') + (node.childNodes ?? []).map(text).join('');

describe('extended HTML fragment sanitization', () => {
  it('denies remote frame origins by default and keeps the diagnostic', () => {
    const result = sanitizeExtendedFragment('<iframe title="Embed" src="https://widgets.example.test/panel"></iframe>', policy(), 1000);
    expect(result.markup).toBeDefined();
    const frame = elements(parseFragment(result.markup!), 'iframe')[0];
    expect(attrs(frame).src).toBeUndefined();
    // The sandbox comes from policy, never from the author.
    expect(attrs(frame).sandbox).not.toContain('allow-same-origin');
    expect(attrs(frame).sandbox).not.toContain('allow-top-navigation');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'local.html.unsafe-url', severity: 'warning' }));
  });

  it('keeps an exact HTTPS origin only when the host grants it', () => {
    const source = '<iframe title="Embed" src="https://widgets.example.test/panel?x=1"></iframe>';
    const allowed = sanitizeExtendedFragment(source, policy(), 1000, ['https://widgets.example.test']);
    const frame = elements(parseFragment(allowed.markup!), 'iframe')[0];
    expect(attrs(frame).src).toBe('https://widgets.example.test/panel?x=1');
    expect(allowed.diagnostics).toEqual([]);

    const crossOrigin = sanitizeExtendedFragment(source, policy(), 1000, ['https://other.example.test']);
    expect(attrs(elements(parseFragment(crossOrigin.markup!), 'iframe')[0]).src).toBeUndefined();
    expect(crossOrigin.diagnostics.some(diagnostic => diagnostic.code === 'local.html.unsafe-url')).toBe(true);

    // A lookalike host is not an origin match, and non-HTTPS grants are rejected.
    const lookalike = sanitizeExtendedFragment(source, policy(), 1000, ['https://example.test']);
    expect(attrs(elements(parseFragment(lookalike.markup!), 'iframe')[0]).src).toBeUndefined();
    const insecure = sanitizeExtendedFragment(source, policy(), 1000, ['http://widgets.example.test']);
    expect(attrs(elements(parseFragment(insecure.markup!), 'iframe')[0]).src).toBeUndefined();
  });

  it('reflects only granted origins in the container CSP', () => {
    const denied = html.localHtmlContentSecurityPolicy(policy(), [], true);
    expect(denied).toContain('frame-src about:');
    expect(denied).not.toContain('https://widgets.example.test');
    expect(denied).toContain("form-action 'none'");
    expect(denied).toContain("base-uri 'none'");

    const granted = html.localHtmlContentSecurityPolicy(policy(), ['https://widgets.example.test:8443'], true);
    expect(granted).toContain('frame-src about: https://widgets.example.test:8443');
  });

  it('keeps legacy whole-document CSP and frame behavior when no origins are passed', () => {
    const legacy = html.localHtmlContentSecurityPolicy(policy({ enableExtendedHtml: true }));
    expect(legacy).toContain('frame-src about: data: blob:');
    expect(legacy).toContain('base-uri \'self\' http: https:');

    const document = html.sanitizeLocalHtmlDocument('<iframe src="https://any.example.test"></iframe>', policy({ enableExtendedHtml: true }), 1000);
    expect(attrs(elements(parseFragment(document.markup), 'iframe')[0]).src).toBe('https://any.example.test');

    // Passing grants on the whole-document entry point applies the same frame
    // filter, so a legacy caller can opt into host-scoped framing.
    const scoped = html.sanitizeLocalHtmlDocument('<iframe src="https://any.example.test"></iframe>', policy({ enableExtendedHtml: true }), 1000, []);
    expect(attrs(elements(parseFragment(scoped.markup), 'iframe')[0]).src).toBeUndefined();
  });

  it('runs srcdoc frames through the same sanitizer and filter', () => {
    const srcdoc = '<p onclick="window.ran = true">Child</p><script>window.ran = true</script><iframe src="https://widgets.example.test/x"></iframe>';
    const result = sanitizeExtendedFragment(
      `<iframe srcdoc="${srcdoc.replace(/"/g, '&quot;')}"></iframe>`,
      policy({ enableJavaScript: false }),
      1000,
    );
    const frame = elements(parseFragment(result.markup!), 'iframe')[0];
    const child = parse(attrs(frame).srcdoc);
    expect(elements(child, 'script')).toHaveLength(0);
    expect(attrs(elements(child, 'p')[0]).onclick).toBeUndefined();
    // Nested remote frames obey the outer deny list even though the element stays.
    expect(attrs(elements(child, 'iframe')[0]).src).toBeUndefined();
    const nestedFrame = elements(child, 'iframe')[0];
    expect(attrs(nestedFrame).sandbox).not.toContain('allow-same-origin');
  });

  it('re-parses data: HTML as an inline document instead of framing it raw', () => {
    const payload = encodeURIComponent('<p onclick="window.ran=true">Inline</p><script>window.ran=true</script>');
    const result = sanitizeExtendedFragment(`<iframe src="data:text/html,${payload}"></iframe>`, policy(), 1000);
    const frame = elements(parseFragment(result.markup!), 'iframe')[0];
    expect(attrs(frame).src).toBeUndefined();
    const child = parse(attrs(frame).srcdoc);
    expect(text(elements(child, 'p')[0])).toBe('Inline');
    expect(attrs(elements(child, 'p')[0]).onclick).toBeUndefined();
    expect(elements(child, 'script')).toHaveLength(0);
  });

  it('never decodes blob: sources and rejects author frame permissions', () => {
    const result = sanitizeExtendedFragment(
      '<iframe src="blob:https://widgets.example.test/abc" allow="camera" allowfullscreen></iframe>',
      policy(),
      1000,
      ['https://widgets.example.test'],
    );
    const frame = elements(parseFragment(result.markup!), 'iframe')[0];
    expect(attrs(frame).src).toBeUndefined();
    expect(attrs(frame).allow).toBeUndefined();
    expect(attrs(frame).allowfullscreen).toBeUndefined();
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'local.html.capability')).toBe(true);
  });

  it('applies capability flags to fragment script, style and event handlers', () => {
    const source = '<style>p{color:red}</style><p style="color:red" onclick="alert(1)">Text</p><script>window.ran=true</script>';
    const denied = sanitizeExtendedFragment(source, policy({ enableCss: false, enableJavaScript: false }), 1000);
    const deniedTree = parseFragment(denied.markup!);
    expect(elements(deniedTree, 'style')).toHaveLength(0);
    expect(elements(deniedTree, 'script')).toHaveLength(0);
    expect(attrs(elements(deniedTree, 'p')[0]).style).toBeUndefined();
    expect(attrs(elements(deniedTree, 'p')[0]).onclick).toBeUndefined();

    const granted = sanitizeExtendedFragment(source, policy({ enableCss: true, enableJavaScript: true }), 1000);
    const grantedTree = parseFragment(granted.markup!);
    expect(elements(grantedTree, 'style')).toHaveLength(1);
    expect(elements(grantedTree, 'script')).toHaveLength(1);
    expect(attrs(elements(grantedTree, 'p')[0]).style).toBe('color:red');
  });

  it('keeps an unsupported element as inert source without dropping siblings', () => {
    const result = sanitizeExtendedFragment('<p>Before</p><p align="middle">Mid</p><p>After</p>', policy(), 1000);
    const tree = parseFragment(result.markup!);
    expect(elements(tree, 'p').map(text)).toEqual(['Before', 'After']);
    expect(text(tree)).toContain('<p align="middle">Mid</p>');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'local.html.fallback', severity: 'warning' }));
  });

  it('drops a document base that reaches the fragment tree', () => {
    // The parser may hoist or drop head-only elements; when a base survives in
    // the tree it is still removed so the container's URL resolution stands.
    const result = sanitizeExtendedFragment('<base href="https://example.test/"><p>Text</p>', policy(), 1000);
    expect(elements(parseFragment(result.markup!), 'base')).toHaveLength(0);
  });

  it('reports the node budget as an error and yields no markup', () => {
    const result = sanitizeExtendedFragment('<p>a</p><p>b</p>', policy(), 1);
    expect(result.markup).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'local.budget', severity: 'error' }));
  });

  it('builds the container document and sandbox from the policy', () => {
    expect(extendedFragmentSandbox(policy())).toBe('allow-forms');
    expect(extendedFragmentSandbox(policy())).not.toContain('allow-same-origin');
    expect(extendedFragmentSandbox(policy())).not.toContain('allow-top-navigation');
    expect(extendedFragmentSandbox(policy({ enableExtendedHtml: false }))).toBe('');
    expect(extendedFragmentSandbox(policy({ enableJavaScript: true }))).toBe('allow-scripts allow-forms');

    const document = extendedFragmentDocument('<p>Frag &amp; "quotes"</p>', policy(), ['https://widgets.example.test']);
    expect(document).toContain('<!doctype html>');
    expect(document).toContain('frame-src about: https://widgets.example.test');
    expect(document).toContain('<p>Frag &amp; "quotes"</p>');
    expect(document).not.toContain('allow-same-origin');
  });
});

describe('ExtendedHtmlFragment render adapter', () => {
  it('renders a sandboxed srcdoc container without injecting author markup into the host', () => {
    const markup = renderToStaticMarkup(
      <ExtendedHtmlFragment
        source={'<p class="note">Fragment</p><iframe title="Embed" src="https://widgets.example.test/panel"></iframe>'}
        policy={policy()}
      />,
    );
    const tree = parseFragment(markup);
    const frames = elements(tree, 'iframe');
    expect(frames).toHaveLength(1);
    const [frame] = frames;
    expect(attrs(frame).sandbox).toBe('allow-forms');
    expect(attrs(frame).referrerpolicy).toBe('no-referrer');
    expect(attrs(frame).src).toBeUndefined();
    const srcdoc = attrs(frame).srcdoc;
    expect(srcdoc).toContain('frame-src about:');
    expect(srcdoc).not.toContain('https://widgets.example.test');
    // Denied child markup is not promoted into the host document tree.
    expect(elements(tree, 'p')).toHaveLength(0);
  });

  it('includes granted origin in both the frame attribute and the container CSP', () => {
    const markup = renderToStaticMarkup(
      <ExtendedHtmlFragment
        source={'<iframe title="Embed" src="https://widgets.example.test/panel"></iframe>'}
        policy={policy()}
        allowedFrameOrigins={['https://widgets.example.test']}
      />,
    );
    const frame = elements(parseFragment(markup), 'iframe')[0];
    const srcdoc = attrs(frame).srcdoc;
    const inner = elements(parse(srcdoc), 'iframe')[0];
    expect(attrs(inner).src).toBe('https://widgets.example.test/panel');
    expect(srcdoc).toContain('frame-src about: https://widgets.example.test');
  });

  it('renders ordinary fragments in the sandbox container', () => {
    const markup = renderToStaticMarkup(<ExtendedHtmlFragment source={'<p>a</p><p>b</p>'} policy={policy()} />);
    const tree = parseFragment(markup);
    const [frame] = elements(tree, 'iframe');
    expect(frame).toBeDefined();
    expect(attrs(frame).sandbox).toBe('allow-forms');
    expect(attrs(frame).srcdoc).toContain('<p>a</p>');
    // The fragment body stays inside srcdoc; nothing leaks into host markup.
    expect(elements(tree, 'p')).toHaveLength(0);
  });

  it('shows source text when the mount does not grant extended HTML', () => {
    const markup = renderToStaticMarkup(
      <ExtendedHtmlFragment source={'<p>Fragment</p>'} policy={policy({ enableExtendedHtml: false })} />,
    );
    const tree = parseFragment(markup);
    expect(elements(tree, 'iframe')).toHaveLength(0);
    expect(text(tree)).toContain('<p>Fragment</p>');
  });
});
