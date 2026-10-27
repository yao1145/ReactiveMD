import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileLocal, createLocalRuntime, type LocalNode} from 'reactive-md';
import {buildGuideExamples, GuideDocument, GUIDE_COMPILE_OPTIONS} from '../src/guide-examples';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

describe('user guide live examples', () => {
  for (const language of ['en', 'zh'] as const) {
    const source = readFileSync(new URL(`../../docs/guides/local-guide-${language === 'zh' ? 'ch' : 'en'}.md`, import.meta.url), 'utf8');
    it(`${language}: retains every code block and adds a working independent document immediately after it`, () => {
      const guide = buildGuideExamples(source);
      const result = compileLocal(guide.source, GUIDE_COMPILE_OPTIONS);
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      if (!result.ok) return;
      const nodes = result.document.nodes;
      const code = flatten(nodes).filter(node => node.type === 'code');
      expect(code).toHaveLength(20);
      expect(Object.values(guide.examples)).toEqual(code.map(node => node.value));
      for (const node of code) {
        const next = nodes[nodes.indexOf(node) + 1];
        expect(next).toMatchObject({type: 'hostComponent', name: 'guide-example'});
        const example = compileLocal(guide.examples[`guide:${next.attrs?.ref}`]);
        expect(example.ok, JSON.stringify(example.diagnostics)).toBe(true);
        expect(example.diagnostics).toEqual([]);
      }
      const html = renderToStaticMarkup(<GuideDocument source={source} language={language} />);
      expect((html.match(/class="guide-example"/g) ?? [])).toHaveLength(20);
      expect(html).not.toContain('local-host-unavailable');
    });
    it(`${language}: interactions in one example leave the next example unchanged`, () => {
      const {examples} = buildGuideExamples(source);
      const first = compileLocal(examples['guide:1']);
      const second = compileLocal(examples['guide:2']);
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      const a = createLocalRuntime(first.document);
      const b = createLocalRuntime(second.document);
      try {
        expect(a.setParameters({people: 5})).toEqual([]);
        expect(a.getParameter('people')).toBe(5);
        expect(b.getParameter('people')).toBe(2);
      } finally { a.dispose(); b.dispose(); }
    });
  }
});
