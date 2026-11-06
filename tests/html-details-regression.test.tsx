import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import {
  normalizeHtmlDetailsChildren,
  splitHtmlDetailsChildren,
} from '../src/local/html-details';
import type { LocalNode } from '../src/local/types';

type Mode = 'interactive' | 'static';

const attributes = (node: any): Record<string, string> =>
  Object.fromEntries((node?.attrs ?? []).map((attr: any) => [attr.name, attr.value]));
const classNames = (node: any): string[] =>
  (attributes(node).class ?? '').split(/\s+/).filter(Boolean);
const collect = (node: any, test: (node: any) => boolean): any[] => [
  ...(test(node) ? [node] : []),
  ...(node?.childNodes ?? []).flatMap((child: any) => collect(child, test)),
];
const textOf = (node: any): string =>
  node?.nodeName === '#text'
    ? node.value ?? ''
    : (node?.childNodes ?? []).map(textOf).join('');
const flatText = (node: any): string => textOf(node).replace(/\s+/g, ' ').trim();

interface DisclosurePresentation {
  label: string;
  expanded: string | null;
  panelHidden: boolean;
  panelText: string;
  static: boolean;
}

/**
 * What a reader can observe about each disclosure: trigger text, expanded
 * state, panel visibility and panel text. Generated ids are deliberately not
 * part of the projection, so two rendered documents can be compared.
 */
function presentation(tree: any): DisclosurePresentation[] {
  return collect(tree, (node) => classNames(node).includes('local-disclosure'))
    .map((disclosure) => {
      const heading = collect(
        disclosure,
        (node) => node.tagName === 'h3' && classNames(node).includes('local-disclosure-heading'),
      )[0];
      const trigger = collect(
        disclosure,
        (node) => node.tagName === 'button' && classNames(node).includes('local-disclosure-trigger'),
      )[0];
      const panel = collect(
        disclosure,
        (node) => classNames(node).includes('local-disclosure-panel'),
      )[0];
      const labelSpan = trigger
        ? (trigger.childNodes ?? []).find(
            (child: any) => child.tagName === 'span' && !classNames(child).includes('local-chevron'),
          )
        : undefined;
      return {
        label: flatText(labelSpan ?? trigger ?? heading),
        expanded: trigger ? attributes(trigger)['aria-expanded'] ?? null : null,
        panelHidden: panel ? Object.hasOwn(attributes(panel), 'hidden') : false,
        panelText: flatText(panel),
        static: classNames(disclosure).includes('local-static-disclosure'),
      };
    });
}

function compile(source: string) {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics).toEqual([]);
  return result;
}

function render(source: string, mode: Mode = 'interactive') {
  const result = compile(source);
  const runtime = createLocalRuntime(result.document);
  try {
    const markup = renderToStaticMarkup(
      <LocalDocumentView document={result.document} runtime={runtime} mode={mode} />,
    );
    return { markup, tree: parseFragment(markup) };
  } finally {
    runtime.dispose();
  }
}

let serial = 0;
function node(type: string, start: number, end: number, extra: Partial<LocalNode> = {}): LocalNode {
  serial += 1;
  return { type, id: `${type}-${serial}`, range: { start, end }, ...extra };
}

describe('details child normalization', () => {
  it('splits a summary out of a paragraph that also carries body text, without mutating input', () => {
    const before = node('text', 0, 3, { value: 'pre' });
    const summary = node('summary', 3, 15, { children: [node('text', 12, 15, { value: '1145' })] });
    const after = node('text', 15, 22, { value: ' tail' });
    const paragraph = node('paragraph', 0, 22, { children: [before, summary, after] });
    const following = node('paragraph', 22, 30, {
      children: [node('text', 22, 30, { value: 'later' })],
    });
    const input = [paragraph, following];
    const snapshot = structuredClone(input);

    const { summary: extracted, body } = splitHtmlDetailsChildren(input);

    expect(extracted).toBe(summary);
    expect(body).toHaveLength(2);
    expect(body[0].type).toBe('paragraph');
    expect(body[0].id).toBe(paragraph.id);
    expect(body[0].children?.map((child) => child.id)).toEqual([before.id, after.id]);
    expect(body[0].range).toEqual({ start: 0, end: 22 });
    expect(body[1]).toBe(following);

    // The input array, the paragraph and its child list stay untouched.
    expect(input).toEqual(snapshot);
    expect(paragraph.children).toEqual([before, summary, after]);
  });

  it('narrows a split paragraph range to the remaining body text', () => {
    const summary = node('summary', 0, 10, { children: [node('text', 7, 10, { value: '1145' })] });
    const tail = node('text', 10, 15, { value: '1145' });
    const paragraph = node('paragraph', 0, 15, { children: [summary, tail] });

    const split = splitHtmlDetailsChildren([paragraph]);

    expect(split.summary).toBe(summary);
    expect(split.body).toHaveLength(1);
    expect(split.body[0].range).toEqual({ start: 10, end: 15 });
    expect(split.body[0].children).toEqual([tail]);
  });

  it('keeps every summary after the first one in the body', () => {
    const first = node('summary', 0, 5);
    const middle = node('text', 5, 10, { value: ' tail' });
    const second = node('summary', 10, 15);
    const paragraph = node('paragraph', 0, 15, { children: [first, middle, second] });

    const { summary, body } = splitHtmlDetailsChildren([paragraph]);

    expect(summary).toBe(first);
    expect(body).toHaveLength(1);
    expect(body[0].children).toEqual([middle, second]);
  });

  it('does not lift a nested details summary into the outer details', () => {
    const innerSummary = node('summary', 2, 12, {
      children: [node('text', 9, 12, { value: 'Inner' })],
    });
    const innerDetails = node('details', 0, 20, { children: [innerSummary] });
    const outerBody = node('paragraph', 20, 30, {
      children: [node('text', 20, 30, { value: 'outer body' })],
    });

    const { summary, body } = splitHtmlDetailsChildren([innerDetails, outerBody]);

    expect(summary).toBeUndefined();
    expect(body).toEqual([innerDetails, outerBody]);

    const wrapped = node('paragraph', 0, 30, { children: [innerDetails, outerBody] });
    expect(splitHtmlDetailsChildren([wrapped]).summary).toBeUndefined();
  });

  it('normalizes idempotently and keeps node identities stable', () => {
    const summary = node('summary', 0, 10);
    const tail = node('text', 10, 15, { value: '1145' });
    const paragraph = node('paragraph', 0, 15, { children: [summary, tail] });

    const normalized = normalizeHtmlDetailsChildren([paragraph]);
    expect(normalized[0]).toBe(summary);
    expect(normalized[1].type).toBe('paragraph');
    expect(normalized[1].children).toEqual([tail]);

    const again = normalizeHtmlDetailsChildren(normalized);
    expect(again[0]).toBe(summary);
    expect(again[1]).toBe(normalized[1]);
    expect(again).toEqual(normalized);
  });
});

describe('HTML details rendering', () => {
  // The source has no blank lines, so Markdown keeps the summary and body
  // text in one paragraph. The old renderer only recognized a paragraph whose
  // sole child was the summary and showed the fallback label instead.
  const noBlankLine = '<details>\n  <summary>1145</summary>\n  1145\n</details>';

  it('uses a summary wrapped with body text as the trigger and the rest as the panel', () => {
    const { tree } = render(noBlankLine);
    const [details] = presentation(tree);

    expect(details).toMatchObject({
      label: '1145',
      expanded: 'false',
      panelHidden: true,
      panelText: '1145',
      static: false,
    });

    // The summary is rendered once as the trigger, not again in the panel.
    const panel = collect(tree, (item) => classNames(item).includes('local-disclosure-panel'))[0];
    expect(textOf(panel).match(/1145/g)).toHaveLength(1);
  });

  it('uses one empty-label accordion per details element', () => {
    const { tree } = render(noBlankLine);
    const accordions = collect(tree, (item) => classNames(item).includes('local-accordion'));

    expect(accordions).toHaveLength(1);
    expect(attributes(accordions[0])).toMatchObject({
      role: 'group',
      'aria-label': 'Accordion',
    });
    expect(collect(accordions[0], (item) => classNames(item).includes('local-disclosure'))).toHaveLength(1);
  });

  it('matches the equivalent accordion/disclosure presentation in interactive mode', () => {
    const native = presentation(render(noBlankLine).tree);
    const rmd = presentation(
      render('<accordion>\n\n<disclosure label="1145">\n\n1145\n\n</disclosure>\n\n</accordion>').tree,
    );

    expect(native).toEqual(rmd);
  });

  it('matches the equivalent accordion/disclosure presentation in static SSR', () => {
    const native = presentation(render(noBlankLine, 'static').tree);
    const rmd = presentation(
      render('<accordion>\n\n<disclosure label="1145">\n\n1145\n\n</disclosure>\n\n</accordion>', 'static').tree,
    );

    expect(native).toEqual(rmd);
    expect(native[0]).toMatchObject({ label: '1145', expanded: null, panelHidden: false, static: true });
  });

  it('keeps a blank-line source working with a direct summary child', () => {
    const { tree } = render('<details>\n<summary>1145</summary>\n\n1145\n\n</details>');
    expect(presentation(tree)).toEqual([
      { label: '1145', expanded: 'false', panelHidden: true, panelText: '1145', static: false },
    ]);
  });

  it('preserves rich inline summary content in the trigger', () => {
    const { tree } = render(
      '<details open><summary>Read <strong>more</strong></summary>\n\nBody **text**\n</details>',
    );
    const trigger = collect(
      tree,
      (item) => item.tagName === 'button' && classNames(item).includes('local-disclosure-trigger'),
    )[0];
    const panel = collect(tree, (item) => classNames(item).includes('local-disclosure-panel'))[0];

    expect(flatText(trigger)).toContain('Read more');
    expect(collect(trigger, (item) => item.tagName === 'strong')).toHaveLength(1);
    expect(attributes(trigger)['aria-expanded']).toBe('true');
    expect(Object.hasOwn(attributes(panel), 'hidden')).toBe(false);
    expect(flatText(panel)).toContain('Body text');
  });

  it('keeps body text that follows a summary in the same paragraph', () => {
    const { tree } = render('<details>\n  <summary>Head</summary>\n  tail after\n</details>');
    const [details] = presentation(tree);
    expect(details).toMatchObject({ label: 'Head', panelText: 'tail after' });
  });

  it('recurses into nested details without stealing the outer or inner summary', () => {
    const { tree } = render(
      '<details>\n\n<details><summary>Inner</summary>\n\ninner body\n</details>\n</details>',
      'static',
    );
    const details = presentation(tree);

    expect(details).toHaveLength(2);
    expect(details[0].label).toBe('Details');
    expect(details[0].panelText).toContain('Inner');
    expect(details[1].label).toBe('Inner');
    expect(details[1].panelText).toContain('inner body');

    const labelled = presentation(
      render(
        '<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\ninner\n</details>\n</details>',
        'static',
      ).tree,
    );
    expect(labelled.map((item) => item.label)).toEqual(['Outer', 'Inner']);
  });

  it('falls back to a details label when the summary is missing', () => {
    const { tree } = render('<details>\n\nOnly body\n</details>');
    expect(presentation(tree)).toEqual([
      { label: 'Details', expanded: 'false', panelHidden: true, panelText: 'Only body', static: false },
    ]);
  });

  it.each([
    ['<details open>', 'true'],
    ['<details open="false">', 'true'],
    ['<details>', 'false'],
  ])('treats open as boolean presence: %s', (openTag, expected) => {
    const { tree } = render(`${openTag}<summary>A</summary>\n\nB\n</details>`);
    const [details] = presentation(tree);
    const panel = collect(tree, (item) => classNames(item).includes('local-disclosure-panel'))[0];

    expect(details.expanded).toBe(expected);
    expect(Object.hasOwn(attributes(panel), 'hidden')).toBe(expected === 'false');
  });

  it('renders static mode without a trigger and with every panel visible', () => {
    const { tree, markup } = render(
      '<details open><summary>Read <strong>more</strong></summary>\n\nBody\n</details>',
      'static',
    );
    const [details] = presentation(tree);

    expect(markup).not.toContain('local-disclosure-trigger');
    expect(details).toMatchObject({
      label: 'Read more',
      expanded: null,
      panelHidden: false,
      panelText: 'Body',
      static: true,
    });
  });

  it('keeps P0 ids and data attributes on the disclosure', () => {
    const { tree } = render(
      '<details id="proof" data-test="kept" open><summary>A</summary>\n\nB\n</details>',
    );
    const disclosure = collect(tree, (item) => classNames(item).includes('local-disclosure'))[0];
    const attrs = attributes(disclosure);

    expect(attrs.id).toContain('proof');
    expect(attrs['data-test']).toBe('kept');
  });
});
