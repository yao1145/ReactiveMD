import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalStateFile, LOCAL_STATE_FORMAT, serializeLocalState } from '../src/local/state';
import { createLocalRuntime } from '../src/local/runtime';
import type { LocalNode } from '../src/local/types';
import { createShareableHtml, resolveLocalStateBaseline, serializeForScript } from '../src/shareable';

function findComponent(nodes: LocalNode[], name: string): LocalNode {
  for (const node of nodes) {
    if (node.type === 'component' && node.name === name) return node;
    const found = findComponent(node.children ?? [], name);
    if (found) return found;
  }
  throw new Error(`Missing component ${name}`);
}

function fixture() {
  const result = compileLocal([
    '<panel title="Settings">',
    '<slider bind="people" label="People" initial="2" min="1" max="20">',
    '</panel>',
    '',
    'There are {{ people }} people.',
  ].join('\n'));
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  const runtime = createLocalRuntime(result.document);
  runtime.set(findComponent(result.document.nodes, 'slider'), 7);
  const file = createLocalStateFile(result.document, runtime.snapshot().state, {
    name: 'test', version: '1.0.0',
  });
  return { document: result.document, runtime, file };
}

describe('shareable HTML envelope', () => {
  it('produces static HTML without scripts and records generator/state metadata', () => {
    const { runtime, file } = fixture();
    try {
      const html = createShareableHtml({
        title: 'A <title> & "quotes"',
        source: runtime.document.source,
        state: file,
        staticMarkup: '<article class="md-document"><p>There are 7 people.</p></article>',
        css: '.md-document { color: black; }',
        mode: 'static',
        generator: { name: 'reactive-md', version: '0.4.0' },
        notices: 'MIT <third-party>',
      });
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('There are 7 people.');
      expect(html).toContain('reactive-md-html/v1');
      expect(html).toContain('content="static"');
      expect(html).toContain('local-draft-2');
      expect(html).toContain('reactive-md 0.4.0');
      expect(html).toContain('<title>A &lt;title&gt; &amp; "quotes"</title>');
      expect(html).toContain('default-src &#39;none&#39;');
      expect(html).toContain('img-src data:');
      expect(html).not.toContain('connect-src');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('application/reactive-md+json');
      expect(html).toContain('&lt;third-party&gt;');
    } finally {
      runtime.dispose();
    }
  });

  it('escapes JSON, runtime and notices so script elements cannot be terminated', () => {
    const { runtime, file } = fixture();
    try {
      const marker = '</script><script>alert("x")</script>\u2028';
      const html = createShareableHtml({
        title: 'Share',
        source: `${runtime.document.source}\n${marker}`,
        state: createLocalStateFile(
          { ...runtime.document, source: `${runtime.document.source}\n${marker}` },
          runtime.snapshot().state,
        ),
        staticMarkup: '<article class="md-document"></article>',
        css: 'body { color: black; }',
        mode: 'interactive',
        runtimeScript: `globalThis.x = "</script><script>alert(1)</script>";`,
        notices: '</template><script>alert(2)</script>',
      });
      const scriptClosings = (html.match(/<\/script>/g) ?? []).length;
      expect(scriptClosings).toBe(2);
      expect(html).toContain('\\u003c/script');
      expect(html).toContain('\\u2028');
      expect(html).not.toContain('</template><script>alert(2)</script>');
      expect(html).toContain('application/reactive-md+json');
    } finally {
      runtime.dispose();
    }
  });

  it('embeds only verified raster data URLs in the auto-mount payload', () => {
    const { runtime, file } = fixture();
    try {
      const html = createShareableHtml({
        title: 'Share',
        source: runtime.document.source,
        state: file,
        staticMarkup: '<article class="md-document"></article>',
        css: 'body{}',
        mode: 'interactive',
        runtimeScript: 'globalThis.mounted = true;',
        images: { 'images/chart.png': 'data:image/png;base64,AAAA' },
      });
      expect(html).toContain('"images":{"images/chart.png":"data:image/png;base64,AAAA"}');
      expect(html).toContain('reactive-md-image-count" content="1"');
      expect(() => createShareableHtml({
        title: 'Share',
        source: runtime.document.source,
        state: file,
        staticMarkup: '<article class="md-document"></article>',
        css: 'body{}',
        mode: 'interactive',
        runtimeScript: 'globalThis.mounted = true;',
        images: { 'images/chart.png': 'javascript:alert(1)' },
      })).toThrow(/base64 PNG/);
    } finally {
      runtime.dispose();
    }
  });

  it('rejects state files from another source and missing interactive runtime code', () => {
    const { runtime, file } = fixture();
    try {
      expect(() => createShareableHtml({
        title: 'Share',
        source: `${runtime.document.source}\nchanged`,
        state: file,
        staticMarkup: '<article></article>',
        css: 'body{}',
        mode: 'static',
      })).toThrow(/does not belong/);
      expect(() => createShareableHtml({
        title: 'Share',
        source: runtime.document.source,
        state: file,
        staticMarkup: '<article></article>',
        css: 'body{}',
        mode: 'interactive',
      })).toThrow(/requires the standalone runtime/);
    } finally {
      runtime.dispose();
    }
  });

  it('rebases exported state into the reset baseline', () => {
    const { document, runtime, file } = fixture();
    try {
      const outcome = resolveLocalStateBaseline(document, file);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.baseline.document.bindings.people.initial).toBe(7);
      expect(outcome.baseline.document.initialState.people).toBe(7);
      const replay = createLocalRuntime(outcome.baseline.document);
      try {
        expect(replay.snapshot().state.people).toBe(7);
        const slider = findComponent(outcome.baseline.document.nodes, 'slider');
        replay.set(slider, 9);
        replay.reset(slider);
        expect(replay.snapshot().state.people).toBe(7);
      } finally {
        replay.dispose();
      }
      expect(JSON.parse(serializeLocalState(file))).toMatchObject({
        format: LOCAL_STATE_FORMAT,
        parameters: { people: 7 },
      });
    } finally {
      runtime.dispose();
    }
  });

  it('serializes inline JSON without HTML-sensitive characters', () => {
    const serialized = serializeForScript({ text: '</script><!--&\u2028\u2029' });
    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(serialized)).toEqual({ text: '</script><!--&\u2028\u2029' });
  });
});
