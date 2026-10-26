import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import * as html from '../src/local/html';
import type { LocalHtmlPolicy } from '../src/local/types';

const policy = (overrides: Partial<LocalHtmlPolicy> = {}): LocalHtmlPolicy => ({
  enableCss: false, enableJavaScript: false, enableExtendedHtml: false, ...overrides,
});
const elements = (node: any, tag: string): any[] => [
  ...(node.tagName === tag ? [node] : []),
  ...(node.childNodes ?? []).flatMap((child: any) => elements(child, tag)),
];
const attrs = (node: any): Record<string, string> => Object.fromEntries((node?.attrs ?? []).map((attr: any) => [attr.name, attr.value]));
function output(source: string, flags: Partial<LocalHtmlPolicy>, limit = 10000) {
  const result = html.sanitizeLocalHtmlDocument(source, policy(flags), limit);
  return { ...result, tree: parse(result.markup) };
}

describe('native HTML capability boundaries', () => {
  it('keeps validated block alignment without granting author CSS', () => {
    const result = output('<div align=" CENTER ">你好</div><p align="right">Right</p><h2 align="justify">Title</h2>', { enableJavaScript: true });
    expect(result.diagnostics).toEqual([]);
    expect(attrs(elements(result.tree, 'div')[0]).align).toBe('center');
    expect(attrs(elements(result.tree, 'p')[0]).align).toBe('right');
    expect(attrs(elements(result.tree, 'h2')[0]).align).toBe('justify');
  });

  it('rejects invalid alignment values even when author CSS is allowed', () => {
    const result = output('<div align="center;color:red">Text</div>', { enableCss: true });
    expect(attrs(elements(result.tree, 'div')[0]).align).toBeUndefined();
    expect(result.diagnostics.some(d => d.code === 'local.html.attribute')).toBe(true);
  });
  it('preserves allowed whole-document attributes within the isolated document', () => {
    const result = output('<html lang="zh" dir="rtl"><head data-note="head"></head><body id="content" style="color:red" onload="window.ran=true"><p>Body</p></body></html>', { enableCss: true, enableJavaScript: true, enableExtendedHtml: true });
    expect(attrs(elements(result.tree, 'html')[0])).toMatchObject({ lang: 'zh', dir: 'rtl' });
    expect(attrs(elements(result.tree, 'head')[0])).toMatchObject({ 'data-note': 'head' });
    expect(attrs(elements(result.tree, 'body')[0])).toMatchObject({ id: 'content', style: 'color:red', onload: 'window.ran=true' });
  });

  it('allows class selectors with CSS alone', () => {
    const result = output('<style>.red{color:red}</style><p class="red">Styled</p>', { enableCss: true });
    expect(attrs(elements(result.tree, 'p')[0]).class).toBe('red');
  });

  it('removes disabled script attributes from style elements too', () => {
    const result = output('<style onload="window.ran=true">p{color:red}</style><p>Text</p>', { enableCss: true });
    expect(attrs(elements(result.tree, 'style')[0]).onload).toBeUndefined();
  });

  it('shares the node budget across sibling srcdoc documents', () => {
    const nested = '<p>x</p>'.repeat(15).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const result = output(`<iframe srcdoc="${nested}"></iframe><iframe srcdoc="${nested}"></iframe>`, { enableExtendedHtml: true }, 45);
    expect(result.diagnostics.some(item => item.severity === 'error' && item.code === 'local.budget')).toBe(true);
  });

  it('permits base only behind the extended gate inside the native document', () => {
    const denied = output('<base href="https://example.test/path/"><p>Text</p>', { enableCss: true });
    expect(elements(denied.tree, 'base')).toHaveLength(0);
    const allowed = output('<base href="https://example.test/path/"><p>Text</p>', { enableExtendedHtml: true });
    expect(attrs(elements(allowed.tree, 'base')[0]).href).toBe('https://example.test/path/');
    expect(html.localHtmlContentSecurityPolicy(policy({ enableExtendedHtml: true }))).toContain('base-uri');
    expect(html.localHtmlContentSecurityPolicy(policy({ enableExtendedHtml: true }))).not.toContain("base-uri 'none'");
  });

  it('permits sandboxed form submission only behind the extended gate', () => {
    const sandbox = (html as any).localHtmlSandbox;
    expect(typeof sandbox).toBe('function');
    expect(sandbox(policy({ enableExtendedHtml: true }))).toContain('allow-forms');
    expect(sandbox(policy({ enableCss: true }))).not.toContain('allow-forms');
    expect(sandbox(policy({ enableExtendedHtml: true, enableJavaScript: true }))).not.toContain('allow-same-origin');
    expect(html.localHtmlContentSecurityPolicy(policy({ enableExtendedHtml: true }))).toContain('form-action http: https:');
  });

  it('keeps disabled body elements at their source position', () => {
    const result = output('<p>Before</p><dl><dt>Term</dt></dl><p>After</p>', { enableCss: true });
    expect(result.markup.indexOf('Before')).toBeLessThan(result.markup.indexOf('&lt;dl&gt;'));
    expect(result.markup.indexOf('&lt;dl&gt;')).toBeLessThan(result.markup.indexOf('After'));
  });

  it('removes legacy CSS presentation attributes when CSS is disabled', () => {
    const result = output('<body bgcolor="red"><table bgcolor="blue"><tr><td>Text</td></tr></table></body>', { enableExtendedHtml: true });
    expect(attrs(elements(result.tree, 'body')[0]).bgcolor).toBeUndefined();
    expect(attrs(elements(result.tree, 'table')[0]).bgcolor).toBeUndefined();
  });

  it('rejects obfuscated script URLs and namespace handlers with scripts disabled', () => {
    const result = output('<a href="java&#x09;script&colon;alert(1)">Link</a><svg onload="alert(1)"><a xlink:href="javascript:alert(2)"><text>SVG link</text></a><script>alert(3)</script></svg>', { enableExtendedHtml: true });
    expect(elements(result.tree, 'script')).toHaveLength(0);
    expect(attrs(elements(result.tree, 'svg')[0]).onload).toBeUndefined();
    for (const link of elements(result.tree, 'a')) expect(attrs(link).href).toBeUndefined();
  });

  it('re-applies script restrictions inside authored srcdoc and sandbox attributes', () => {
    const result = output('<iframe sandbox="allow-scripts allow-same-origin allow-top-navigation" srcdoc="&lt;p onclick=&quot;alert(1)&quot;&gt;Child&lt;/p&gt;&lt;script&gt;alert(2)&lt;/script&gt;"></iframe>', { enableExtendedHtml: true });
    const frame = attrs(elements(result.tree, 'iframe')[0]);
    expect(frame.sandbox).not.toContain('allow-scripts');
    expect(frame.sandbox).not.toContain('allow-same-origin');
    expect(frame.sandbox).not.toContain('allow-top-navigation');
    const child = parse(frame.srcdoc);
    expect(elements(child, 'script')).toHaveLength(0);
    expect(attrs(elements(child, 'p')[0]).onclick).toBeUndefined();
  });

  it('preserves script execution types without requiring extended HTML', () => {
    const result = output('<script type="module">await Promise.resolve()</script><script type="application/json">{"key":"value"}</script><script src="external.js">ignoredFallback()</script>', { enableJavaScript: true });
    const scripts = elements(result.tree, 'script');
    expect(attrs(scripts[0]).type).toBe('module');
    expect(attrs(scripts[1]).type).toBe('application/json');
    expect(attrs(scripts[2]).src).toBe('external.js');
  });

  it('preserves CSS media semantics without requiring extended HTML', () => {
    const result = output('<style media="print">p{color:red}</style><link rel="stylesheet" href="print.css" media="print">', { enableCss: true });
    expect(attrs(elements(result.tree, 'style')[0]).media).toBe('print');
    expect(attrs(elements(result.tree, 'link')[0])).toMatchObject({ rel: 'stylesheet', href: 'print.css', media: 'print' });
  });
});
