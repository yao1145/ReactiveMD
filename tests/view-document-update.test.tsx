import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal } from '../src/local/compiler';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { createLocalRuntime, updateLocalRuntime } from '../src/local/runtime';
import { collectNodeDependencies } from '../src/local/dependencies';
import {
  blockInputsEqual,
  dependencyIndexEqual,
  projectAnchors,
  projectFootnotes,
  sameAnchorProjection,
  sameFootnoteProjection,
  validationProjectionKey,
} from '../src/local/view-revision';
import type { LocalDocument, LocalNode } from '../src/local/types';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

/** Simulate the compiler's structural sharing: unrelated nodes keep identity. */
function replaceTopLevel(document: LocalDocument, text: string): LocalDocument {
  return {
    ...document,
    source: text,
    nodes: document.nodes.map((node) => (
      node.type === 'paragraph' ? { ...node, value: text } : node
    )),
  };
}

describe('document view projections', () => {
  it('reuses anchors and footnotes for a prose-only edit', () => {
    const first = compile('# Title\n\nBody with a note [^a].\n\n[^a]: Note body.');
    const next = replaceTopLevel(first, 'Changed prose');

    expect(sameAnchorProjection(projectAnchors(first), projectAnchors(next))).toBe(true);
    expect(sameFootnoteProjection(projectFootnotes(first), projectFootnotes(next))).toBe(true);

    const headingChanged: LocalDocument = {
      ...first,
      nodes: first.nodes.map((node) => (
        node.type === 'heading'
          ? { ...node, children: [{ ...node.children![0], value: 'Renamed' }] as LocalNode[] }
          : node
      )),
    };
    expect(sameAnchorProjection(projectAnchors(first), projectAnchors(headingChanged))).toBe(false);

    const noteChanged: LocalDocument = {
      ...first,
      nodes: first.nodes.map((node) => (
        node.type === 'footnoteDefinition' ? { ...node } : node
      )),
    };
    expect(sameFootnoteProjection(projectFootnotes(first), projectFootnotes(noteChanged))).toBe(false);
  });

  it('keeps the validation projection stable across unrelated text', () => {
    const first = compile([
      '<number bind="n" label="N" initial="1" min="0" max="10">',
      '<validation when="{{ n > 0 }}" message="Positive" fields="n">',
      '',
      'Some prose.',
    ].join('\n'));
    const next = replaceTopLevel(first, 'Different prose');
    expect(validationProjectionKey(first)).toBe(validationProjectionKey(next));

    const shifted: LocalDocument = {
      ...first,
      validations: [{
        ...first.validations![0],
        range: { start: first.validations![0].range.start + 10, end: first.validations![0].range.end + 10 },
      }],
    };
    expect(validationProjectionKey(first)).toBe(validationProjectionKey(shifted));

    const changedRule: LocalDocument = {
      ...first,
      validations: [{ ...first.validations![0], message: 'Changed' }],
    };
    expect(validationProjectionKey(first)).not.toBe(validationProjectionKey(changedRule));
  });

  it('compares dependency indexes by content', () => {
    const left = new Map<string, readonly string[] | null>([
      ['a', ['x', 'y']],
      ['b', null],
    ]);
    const right = new Map<string, readonly string[] | null>([
      ['a', ['x', 'y']],
      ['b', null],
    ]);
    expect(dependencyIndexEqual(left, right)).toBe(true);
    const shorter = new Map<string, readonly string[] | null>([['a', ['x']], ['b', null]]);
    const different = new Map<string, readonly string[] | null>([['a', ['x', 'y']], ['b', ['z']]]);
    const missing = new Map<string, readonly string[] | null>([['a', ['x', 'y']]]);
    expect(dependencyIndexEqual(left, shorter)).toBe(false);
    expect(dependencyIndexEqual(left, different)).toBe(false);
    expect(dependencyIndexEqual(left, missing)).toBe(false);

    const document = compile('<number bind="n" label="N" initial="1">');
    const cloned = { ...document };
    expect(dependencyIndexEqual(collectNodeDependencies(document), collectNodeDependencies(cloned))).toBe(true);
  });

  it('memoizes an unchanged block across a document update', () => {
    const document = compile('<number bind="n" label="N" initial="1">\n\nStatic');
    const env = {};
    const node = all(document.nodes).find((candidate) => candidate.attrs?.bind === 'n')!;
    const base = { node, visible: true, resetToken: 0, env, depValues: [1] as const };

    expect(blockInputsEqual(base, { ...base, depValues: [1] })).toBe(true);
    expect(blockInputsEqual(base, { ...base, depValues: [2] })).toBe(false);
    expect(blockInputsEqual(base, { ...base, env: {} })).toBe(false);
    expect(blockInputsEqual(base, { ...base, node: { ...node } })).toBe(false);
    expect(blockInputsEqual({ ...base, depValues: null }, { ...base, depValues: null })).toBe(false);
    expect(blockInputsEqual(base, { ...base, resetToken: 1 })).toBe(false);
    expect(blockInputsEqual(base, { ...base, visible: false })).toBe(false);
  });

  it('bails out every unchanged block, and only re-renders the edited prose block', () => {
    const amount = '<number label="Amount" bind="amount" initial="2" min="0" max="20">';
    const first = compile(`${amount}\n\nFirst paragraph\n\nSecond paragraph`);
    const paragraph = first.nodes.find((node) => node.type === 'paragraph' && (
      all([node]).some((child) => child.value === 'Second paragraph')
    ));
    if (!paragraph) throw new Error('Missing edited paragraph');

    // The incremental compiler hands back the same control object while the
    // edited paragraph is rebuilt, exactly what this next document models.
    const next: LocalDocument = {
      ...first,
      source: first.source.replace('Second paragraph', 'Edited paragraph'),
      nodes: first.nodes.map((node) => (node === paragraph ? { ...node } : node)),
    };

    const controlFirst = all(first.nodes).find((node) => node.attrs?.bind === 'amount')!;
    const controlNext = all(next.nodes).find((node) => node.attrs?.bind === 'amount')!;
    expect(controlNext).toBe(controlFirst);

    const state = first.initialState;
    const depsFirst = collectNodeDependencies(first).get(controlFirst.id) ?? [];
    const depsNext = collectNodeDependencies(next).get(controlNext.id) ?? [];
    const valuesFirst = depsFirst.map((key) => state[key]);
    const valuesNext = depsNext.map((key) => state[key]);
    const env = {};

    expect(sameAnchorProjection(projectAnchors(first), projectAnchors(next))).toBe(true);
    expect(sameFootnoteProjection(projectFootnotes(first), projectFootnotes(next))).toBe(true);
    expect(blockInputsEqual(
      { node: controlFirst, visible: true, resetToken: 0, env, depValues: valuesFirst },
      { node: controlNext, visible: true, resetToken: 0, env, depValues: valuesNext },
    )).toBe(true);

    const sharedParagraphs = first.nodes.filter((node) => node.type === 'paragraph');
    const edited = next.nodes.find((node) => node.type === 'paragraph' && !sharedParagraphs.includes(node));
    if (!edited) throw new Error('Missing rebuilt paragraph');
    expect(blockInputsEqual(
      { node: paragraph, visible: true, resetToken: 0, env, depValues: null },
      { node: edited, visible: true, resetToken: 0, env, depValues: null },
    )).toBe(false);
  });
});

describe('view document update integration', () => {
  it('renders the adopted document with retained control state', () => {
    const amount = '<number label="Amount" bind="amount" initial="2" min="0" max="20">';
    const first = compile(`${amount}\n\nOriginal prose`);
    const next = compile(`${amount}\n\nReplacement prose`);
    const runtime = createLocalRuntime(first);
    try {
      expect(runtime.setParameter('amount', 11)).toEqual([]);

      const before = renderToStaticMarkup(<LocalDocumentView document={first} runtime={runtime} />);
      expect(before).toContain('Original prose');
      expect(before).toContain('value="11"');

      const report = updateLocalRuntime(runtime, next, { notify: false });
      expect(report.ok).toBe(true);
      expect(report.retained).toEqual(['amount']);

      const after = renderToStaticMarkup(<LocalDocumentView document={next} runtime={runtime} />);
      expect(after).toContain('Replacement prose');
      expect(after).not.toContain('Original prose');
      expect(after).toContain('value="11"');
      expect(runtime.snapshot().revision).toBe(report.revision);
    } finally {
      runtime.dispose();
    }
  });
});
