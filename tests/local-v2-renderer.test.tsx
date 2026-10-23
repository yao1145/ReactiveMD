import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView, type LocalUrlPolicy } from '../src/local/LocalDocumentView';
import type { LocalDocument, LocalNode } from '../src/local/types';
import type { LocalLocale } from '../src/local/i18n';

function compile(source: string): { document: LocalDocument; runtime: ReturnType<typeof createLocalRuntime> } {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  }
  return { document: result.document, runtime: createLocalRuntime(result.document) };
}

function renderDocument(
  document: LocalDocument,
  runtime: ReturnType<typeof createLocalRuntime>,
  locale?: LocalLocale,
  urlPolicy?: LocalUrlPolicy,
): string {
  return renderToStaticMarkup(
    <LocalDocumentView
      document={document}
      runtime={runtime}
      locale={locale}
      urlPolicy={urlPolicy}
    />,
  );
}

function mount(source: string, locale?: LocalLocale): { html: string; text: string } {
  const { document, runtime } = compile(source);
  try {
    const html = renderDocument(document, runtime, locale);
    return { html, text: html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ') };
  } finally {
    runtime.dispose();
  }
}

function findNode(document: LocalDocument, name: string, index = 0): LocalNode {
  const found: LocalNode[] = [];
  const visit = (nodes: LocalNode[]) => {
    for (const node of nodes) {
      if (node.type === 'component' && node.name === name) found.push(node);
      if (node.children) visit(node.children);
    }
  };
  visit(document.nodes);
  const node = found[index];
  if (!node) throw new Error(`Missing component ${name}`);
  return node;
}

function anchorIds(html: string): string[] {
  return [...html.matchAll(/<span class="local-anchor" id="([^"]+)"/g)].map((match) => match[1]);
}

function jumpTags(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*class="local-jump[^"]*"[^>]*>/g)].map((match) => match[0]);
}

function hrefOf(tag: string): string {
  const match = /\bhref="([^"]*)"/.exec(tag);
  if (!match) throw new Error(`No href in ${tag}`);
  return match[1];
}

function inputTagByLabel(html: string, label: string): string {
  const tag = [...html.matchAll(/<input\b[^>]*>/g)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes(`aria-label="${label}"`));
  if (!tag) throw new Error(`No input labelled ${label}`);
  return tag;
}

describe('jump and explicit anchors', () => {
  it('renders a native link jump to an explicit anchor and inline Markdown children', () => {
    const { html, text } = mount(
      '<anchor id="result">\n\n' +
        '# Findings\n\n' +
        'Open <jump to="result" appearance="button" color="#2563eb">**the result**</jump> now.\n\n' +
        '[Markdown link](#result)\n',
    );
    const ids = anchorIds(html);
    expect(ids).toHaveLength(1);
    const tags = jumpTags(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('local-jump-button');
    expect(hrefOf(tags[0])).toBe(`#${ids[0]}`);
    expect(tags[0]).toContain('--local-accent:#2563eb');
    expect(html).toMatch(/<strong>(?:<span>)?the result(?:<\/span>)?<\/strong>/);
    expect(text).toContain('Open');
    expect(text).toContain('now.');
    // Both the jump and the Markdown fragment resolve the explicit anchor in
    // the same instance namespace.
    const allHrefs = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1]);
    expect(allHrefs.filter((href) => href === `#${ids[0]}`)).toHaveLength(2);
  });

  it('defaults to link appearance and resolves heading slugs', () => {
    const { html } = mount('# Hello World\n\n<jump to="hello-world">Go</jump>');
    const headingId = /<h1[^>]*\bid="([^"]+)"/.exec(html)?.[1];
    expect(headingId).toBeTruthy();
    const tags = jumpTags(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('local-jump-link');
    expect(tags[0]).not.toContain('role="button"');
    expect(hrefOf(tags[0])).toBe(`#${headingId}`);
  });

  it('keeps heading and anchor namespaces per render instance', () => {
    const { document, runtime } = compile('<anchor id="target">\n\n<jump to="target">Go</jump>');
    try {
      const html = renderToStaticMarkup(
        <>
          <LocalDocumentView document={document} runtime={runtime} />
          <LocalDocumentView document={document} runtime={runtime} />
        </>,
      );
      const ids = anchorIds(html);
      const hrefs = jumpTags(html).map(hrefOf);
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
      expect(hrefs).toEqual(ids.map((id) => `#${id}`));
    } finally {
      runtime.dispose();
    }
  });

  it('marks a forged missing target instead of looking outside the article', () => {
    const { document, runtime } = compile('<anchor id="target">\n\n<jump to="target">Go</jump>');
    try {
      findNode(document, 'jump').attrs!.to = 'missing';
      const html = renderDocument(document, runtime);
      const tags = jumpTags(html);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toContain('data-local-target-missing="true"');
      expect(hrefOf(tags[0])).toBe('#');
    } finally {
      runtime.dispose();
    }
  });

  it('respects a host link policy that rejects internal fragments', () => {
    const { document, runtime } = compile('<anchor id="target">\n\n<jump to="target">Go</jump>');
    try {
      const html = renderDocument(document, runtime, undefined, () => false);
      const tags = jumpTags(html);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toContain('data-local-jump-blocked="true"');
      expect(hrefOf(tags[0])).toBe('#');
    } finally {
      runtime.dispose();
    }
  });
});

describe('foreground colors and checklist state', () => {
  it('applies validated colors to inline and block foregrounds', () => {
    const { html } = mount(
      "<text color='#0f0'>**hot** {{ 1 + 2 }}</text>\n\n" +
        "<section color='red'>\n\n## Inside\n\n<slider bind='s' label='S' color='red'>\n\n</section>\n",
    );
    expect(html).toContain('<span class="local-text" style="color:#0f0">');
    expect(html).toMatch(/<strong>(?:<span>)?hot(?:<\/span>)?<\/strong>/);
    expect(html).toContain('local-interpolation');
    expect(html).toContain('<div class="local-section" style="color:red">');
    expect(html).toContain('<h2');
  });

  it('revalidates colors defensively and never emits an invalid CSS value', () => {
    const { document, runtime } = compile(
      "<slider bind='s' label='S' color='#2563eb'>\n\n<text color='red'>Safe</text>\n\n<section color='blue'>Body</section>",
    );
    try {
      findNode(document, 'slider').attrs!.color = 'url(https://evil.test/x)';
      findNode(document, 'text').attrs!.color = 'var(--danger)';
      findNode(document, 'section').attrs!.color = 'expression; color: red';
      const html = renderDocument(document, runtime);
      expect(html).not.toContain('evil.test');
      expect(html).not.toContain('--local-accent');
      expect(html).not.toContain('var(--danger)');
      expect(html).not.toContain('expression');
      expect(html).toContain('Safe');
    } finally {
      runtime.dispose();
    }
  });

  it('maps accents onto controls, progress fill and badge foreground', () => {
    const { html } = mount(
      "<slider bind='s' label='S' color='#2563eb'>\n\n" +
        "<toggle bind='t' label='T' color='tomato'>\n\n" +
        "<checkbox bind='c' label='C' color='#0f0'>\n\n" +
        "<select bind='sel' label='Sel' color='#123'>\n<option value='a'>A</option>\n</select>\n\n" +
        "<choices bind='ch' label='Ch' color='#123'>\n<option value='a'>A</option>\n</choices>\n\n" +
        "<radio-group bind='rg' label='RG' color='#123'>\n<option value='a'>A</option>\n</radio-group>\n\n" +
        "<progress label='P' value='2' color='#123456'>\n\n" +
        "<badge color='#abc'>New</badge>",
    );
    expect(html).toMatch(/class="md-control md-slider local-slider" style="[^"]*--local-accent:#2563eb/);
    expect(html).toMatch(/class="md-control md-toggle local-toggle" style="[^"]*--local-accent:tomato/);
    expect(html).toMatch(/class="md-control local-checkbox" style="[^"]*--local-accent:#0f0/);
    expect(html).toMatch(/class="md-control md-select local-select" style="[^"]*--local-accent:#123/);
    expect(html).toMatch(/class="md-control local-choices" style="[^"]*--local-accent:#123/);
    expect(html).toMatch(/class="md-control local-radio-group" style="[^"]*--local-accent:#123/);
    expect(html).toContain('--local-progress-color:#123456');
    expect(html).toContain('style="color:#abc"');
    expect(html).toContain('New');
  });

  it('strikes through checked checklist labels and restores unchecked ones', () => {
    const { html } = mount(
      "<checklist bind='done' label='Todo'>\n- [x] Done item\n- [ ] Open item\n</checklist>",
    );
    expect(html.match(/local-checklist-text is-checked/g)).toHaveLength(1);
    expect(html).toMatch(
      /class="local-checklist-text is-checked"[^>]*>[\s\S]*?Done item/,
    );
    expect(html).toMatch(/class="local-checklist-text"[^>]*>[\s\S]*?Open item/);
  });
});

describe('multi-select', () => {
  const source =
    "<multi-select bind='picked' label='Pick' initial='b,a' max-selected='2' color='#2563eb'>\n" +
    "<option value='a'>Alpha</option>\n" +
    "<option value='b'>**Beta**</option>\n" +
    "<option value='c'>Gamma</option>\n" +
    '</multi-select>';

  it('renders search, clear and source-order selections with a maximum', () => {
    const { html } = mount(source);
    expect(html).toContain('placeholder="Search options"');
    expect(html).toContain('>Clear<');
    expect(html).toContain('aria-label="Search Pick"');
    expect(html.match(/local-multi-option is-selected/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    // The third option is at the maximum and cannot be added.
    expect(html).toContain('disabled=""');
    expect(html).toMatch(/<strong>(?:<span>)?Beta(?:<\/span>)?<\/strong>/);
    expect(html).toContain('2 of 2 selected');
    expect(html).toContain('--local-accent:#2563eb');
  });

  it('localizes its built-in search, clear and count text', () => {
    const { html } = mount(source, 'zh');
    expect(html).toContain('placeholder="搜索选项"');
    expect(html).toContain('>清除<');
    expect(html).toContain('已选 2/2');
  });
});

describe('range-slider', () => {
  it('renders two accessible thumbs with initial slots and color', () => {
    const { html } = mount(
      "<range-slider bind-start='lo' bind-end='hi' label='Band' min='0' max='10' step='2' " +
        "initial-start='2' initial-end='8' color='#2563eb'>",
    );
    expect(html.match(/type="range"/g)).toHaveLength(2);
    expect(inputTagByLabel(html, 'Band Start')).toContain('value="2"');
    expect(inputTagByLabel(html, 'Band End')).toContain('value="8"');
    expect(html).toContain('--local-accent:#2563eb');
    expect(html).toContain('>Start<');
    expect(html).toContain('>End<');
  });

  it('defaults start to min and end to the largest legal step', () => {
    const { html } = mount(
      "<range-slider label='Band' min='3' max='10' step='2'>",
    );
    expect(inputTagByLabel(html, 'Band Start')).toContain('value="3"');
    expect(inputTagByLabel(html, 'Band End')).toContain('value="9"');
  });

  it('localizes thumb labels', () => {
    const { html } = mount("<range-slider label='Band' min='0' max='10'>", 'zh');
    expect(html).toContain('aria-label="Band 起点"');
    expect(html).toContain('aria-label="Band 终点"');
  });
});

describe('coordinate', () => {
  it('renders a keyboard pad, pointer position and numeric alternatives', () => {
    const { html } = mount(
      "<coordinate bind-x='px' bind-y='py' label='Point' x-min='-2' x-max='2' " +
        "y-min='-1' y-max='1' step='0.5' initial-x='1' initial-y='-0.5' color='#2563eb'>",
    );
    expect(html).toContain('aria-label="Point drag area"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('local-coordinate-dot');
    expect(html).toContain('style="left:75%;top:75%"');
    expect(html).toMatch(/<label[^>]*for="[^"]*coordinate-x"[^>]*>Point X<\/label>/);
    expect(html).toMatch(/<label[^>]*for="[^"]*coordinate-y"[^>]*>Point Y<\/label>/);
    expect(html).toMatch(/id="[^"]*coordinate-x"[^>]*value="1"/);
    expect(html).toMatch(/id="[^"]*coordinate-y"[^>]*value="-0.5"/);
    expect(html).toContain('--local-accent:#2563eb');
  });

  it('localizes the pad label and keyboard help', () => {
    const { html } = mount("<coordinate label='Point' initial-x='0' initial-y='0'>", 'zh');
    expect(html).toContain('aria-label="Point 拖拽区"');
    expect(html).toContain('方向键调整坐标');
  });
});

describe('quiz', () => {
  it('renders choice radios with check and try-again controls and a live region', () => {
    const { html } = mount(
      "<quiz label='Capital' answer='b'>\n" +
        "<option value='a'>Paris</option>\n" +
        "<option value='b'>Berlin</option>\n" +
        '</quiz>',
    );
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toContain('Check answer');
    expect(html).toContain('Try again');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('local-quiz-feedback');
    expect(html).not.toContain('local-quiz-explanation');
  });

  it('renders a numeric quiz without revealing the explanation before checking', () => {
    const { html } = mount(
      "<quiz type='number' label='Sum' answer='3' tolerance='0.1' explanation='Because {{ 1 + 2 }}.'>\n</quiz>",
    );
    expect(html).toMatch(/inputmode="decimal"/i);
    expect(html).toContain('aria-label="Sum"');
    expect(html).not.toContain('Because');
  });

  it('localizes quiz actions', () => {
    const { html } = mount(
      "<quiz label='Capital' answer='b'>\n<option value='b'>Berlin</option>\n</quiz>",
      'zh',
    );
    expect(html).toContain('>检查答案<');
    expect(html).toContain('>再试一次<');
  });
});

describe('steps', () => {
  it('renders anonymous step changes made through the registered runtime', () => {
    const { document, runtime } = compile('<steps label="Path">\n<step label="One" value="one">First</step>\n<step label="Two" value="two">Second</step>\n</steps>');
    try {
      expect(runtime.set(findNode(document, 'steps'), 'two')).toEqual([]);
      expect(renderDocument(document, runtime)).toContain('Step 2 of 2');
    } finally { runtime.dispose(); }
  });
  const source =
    "<steps label='Flow' initial='two'>\n" +
    "<step label='One' value='one'>\n" +
    "First body.\n\n" +
    "<timer label='First timer' duration='60'>\n" +
    '</step>\n' +
    "<step label='Two' value='two'>\n" +
    'Second body.\n' +
    '</step>\n' +
    '</steps>';

  it('shows only the active step, keeps hidden content mounted and reports progress', () => {
    const { html, text } = mount(source);
    expect(html).toContain('>Previous<');
    expect(html).toContain('>Next<');
    expect(text).toContain('Step 2 of 2');
    expect(text).toContain('Second body.');
    expect(html).toContain('First timer');
    expect(html).toContain('local-timer');
    expect(html).toMatch(
      /class="local-steps-panel" role="group" aria-label="One"[^>]*hidden=""/,
    );
    expect(html).toMatch(
      /class="local-steps-panel" role="group" aria-label="Two"(?![^>]*hidden)/,
    );
    // Previous is enabled, Next is disabled at the last step.
    expect(html).toMatch(/class="[^"]*local-steps-next"[^>]*disabled=""/);
  });

  it('localizes navigation and progress text', () => {
    const { html, text } = mount(source, 'zh');
    expect(html).toContain('>上一步<');
    expect(html).toContain('>下一步<');
    expect(text).toContain('第 2 步，共 2 步');
  });
});
