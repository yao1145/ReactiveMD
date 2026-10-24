import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView, LocalReactiveDocument, type LocalImageResolver, type LocalUrlPolicy } from '../src/local/LocalDocumentView';
import type { LocalDocument, LocalNode } from '../src/local/types';
import type { LocalRenderMode } from '../src/local/render-types';

interface Compiled {
  document: LocalDocument;
  runtime: ReturnType<typeof createLocalRuntime>;
}

function compile(source: string): Compiled {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  }
  return { document: result.document, runtime: createLocalRuntime(result.document) };
}

function findBound(document: LocalDocument, bind: string): LocalNode {
  const found: LocalNode[] = [];
  const visit = (nodes: LocalNode[]) => {
    for (const node of nodes) {
      const attrs = node.attrs ?? {};
      if (
        Object.entries(attrs).some(
          ([key, value]) => key.startsWith('bind') && value === bind,
        )
      ) {
        found.push(node);
      }
      if (node.children) visit(node.children);
    }
  };
  visit(document.nodes);
  const node = found[0];
  if (!node) throw new Error(`Missing binding ${bind}`);
  return node;
}

function render(
  document: LocalDocument,
  runtime: ReturnType<typeof createLocalRuntime>,
  mode?: LocalRenderMode,
  options: { imageResolver?: LocalImageResolver; urlPolicy?: LocalUrlPolicy } = {},
): string {
  return renderToStaticMarkup(
    <LocalDocumentView
      document={document}
      runtime={runtime}
      mode={mode}
      imageResolver={options.imageResolver}
      urlPolicy={options.urlPolicy}
    />,
  );
}

function setValue(
  document: LocalDocument,
  runtime: ReturnType<typeof createLocalRuntime>,
  bind: string,
  value: string | number | boolean | string[],
  slot?: string,
): void {
  const diagnostics = runtime.set(findBound(document, bind), value, slot);
  if (diagnostics.length) {
    throw new Error(diagnostics.map((item) => item.message).join('; '));
  }
}

const SOURCE = `# Static document

<toggle bind="show" label="Show details" initial="true">

<panel title="Settings" reset="true">

<input bind="name" label="Name" initial="Ada">

<textarea bind="notes" label="Notes" initial="Initial notes">

<number bind="count" label="Count" initial="2" min="0" max="100" step="1">

<slider bind="level" label="Level" initial="10" min="0" max="100">

<toggle bind="enabled" label="Enabled" initial="false">

<checkbox bind="agree" label="Agree" initial="false">

<date bind="day" label="Day" initial="2026-01-01">

<select bind="color" label="Color">
<option value="red">Red</option>
<option value="blue">Blue</option>
</select>

<choices bind="size" label="Size">
<option value="s">Small</option>
<option value="m">Medium</option>
</choices>

<radio-group bind="plan" label="Plan">
<option value="free">Free</option>
<option value="pro">Pro</option>
</radio-group>

</panel>

<grid columns="2">
<card title="Layout">

<accordion label="More">
<disclosure label="Details" open="true">
Disclosure body.
</disclosure>
</accordion>

<if when="{{ show }}">
Conditional body.
</if>

</card>
</grid>

<tabs label="Sections">
<tab label="Tab One" value="one">Tab one body.</tab>
<tab label="Tab Two" value="two">Tab two body.</tab>
</tabs>

<multi-select bind="picked" label="Picked" max-selected="3">
<option value="a">Alpha</option>
<option value="b">Beta</option>
<option value="c">Gamma</option>
</multi-select>

<checklist bind="done" label="Done">
- [x] First task
- [ ] Second task
</checklist>

<counter bind="rounds" label="Rounds" initial="0" min="0" max="10">

<timer bind="seconds" label="Timer" duration="60">

<progress label="Progress" value="{{ rounds / 10 * 100 }}">

<range-slider bind-start="lo" bind-end="hi" label="Band" min="0" max="10" step="1" initial-start="2" initial-end="8">

<coordinate bind-x="px" bind-y="py" label="Point" initial-x="1" initial-y="-1" x-min="-5" x-max="5" y-min="-5" y-max="5">

<quiz label="Capital" answer="b">
<option value="a">Paris</option>
<option value="b">Berlin</option>
</quiz>

<steps label="Flow" bind="lesson" initial="one">
<step label="One" value="one">Step one body.</step>
<step label="Two" value="two">Step two body.</step>
</steps>

<anchor id="target">

<jump to="target" appearance="button">Jump text</jump>

A <tooltip text="Tooltip text">tooltip trigger</tooltip> in prose.
`;

function mutateDocument(compiled: Compiled): void {
  const { document, runtime } = compiled;
  setValue(document, runtime, 'name', 'Grace Hopper');
  setValue(document, runtime, 'notes', 'Revised notes');
  setValue(document, runtime, 'count', 7);
  setValue(document, runtime, 'level', 60);
  setValue(document, runtime, 'enabled', true);
  setValue(document, runtime, 'agree', true);
  setValue(document, runtime, 'day', '2026-05-06');
  setValue(document, runtime, 'color', 'blue');
  setValue(document, runtime, 'size', 'm');
  setValue(document, runtime, 'plan', 'pro');
  setValue(document, runtime, 'picked', ['a', 'c']);
  setValue(document, runtime, 'done', ['item-2']);
  setValue(document, runtime, 'rounds', 4);
  setValue(document, runtime, 'seconds', 30);
  setValue(document, runtime, 'lo', 3, 'start');
  setValue(document, runtime, 'hi', 7, 'end');
  setValue(document, runtime, 'px', 2, 'x');
  setValue(document, runtime, 'py', -1, 'y');
  setValue(document, runtime, 'lesson', 'two');
}

describe('static rendering mode', () => {
  it('renders read-only values for every control and layout container', () => {
    const compiled = compile(SOURCE);
    try {
      mutateDocument(compiled);
      const html = render(compiled.document, compiled.runtime, 'static');

      // No editable widget or action button survives static rendering.
      expect(html).not.toMatch(/<input\b/);
      expect(html).not.toMatch(/<select\b/);
      expect(html).not.toMatch(/<textarea\b/);
      expect(html).not.toMatch(/<button\b/);
      expect(html).not.toContain('local-panel-reset');
      expect(html).toContain('class="md-document local-document local-static"');
      expect(html).toContain('data-render-mode="static"');

      // Current runtime values are visible, empty handling and units stay.
      expect(html).toContain('Grace Hopper');
      expect(html).toContain('Revised notes');
      expect(html).toContain('Min 0 · Max 100 · Step 1');
      expect(html).toContain('On');
      expect(html).toContain('Checked');
      expect(html).toContain('2026-05-06');
      expect(html).toContain('Blue');
      expect(html).toContain('Medium');
      expect(html).toContain('Pro');
      expect(html).toContain('Alpha, Gamma');
      expect(html).toContain('Second task');
      expect(html).toContain('Unchecked');
      expect(html).toContain('Start: 3 · End: 7');
      expect(html).toContain('X: 2 · Y: -1');
      expect(html).toContain('30 seconds');
      expect(html).toContain('40%');
      expect(html).toContain('Step 2 of 2');
      expect(html).toContain('Step two body.');

      // Conditional content still follows the runtime.
      expect(html).toContain('Conditional body.');
      const conditionalTag = /<div class="local-if md-if"[^>]*>/.exec(html)?.[0] ?? '';
      expect(conditionalTag).not.toContain('hidden=""');
      expect(conditionalTag).not.toContain('aria-hidden="true"');

      // Tabs and disclosures expose readable content without buttons.
      expect(html).toContain('Tab One');
      expect(html).toContain('Tab one body.');
      expect(html).toContain('Tab Two');
      expect(html).toContain('Tab two body.');
      expect(html).toContain('Disclosure body.');
      expect(html).not.toContain('role="tablist"');
      expect(html).not.toContain('role="tab"');

      // A jump with a valid target stays a normal fragment link.
      expect(html).toContain('local-jump-static');
      expect(html).toContain('href="#');
      expect(html).toContain('Jump text');
      expect(html).not.toContain('local-jump-button');

      // Tooltip text is always readable rather than hover-only.
      expect(html).toContain('tooltip trigger');
      expect(html).toContain('Tooltip text');
      expect(html).not.toContain('role="tooltip"');
      expect(html).not.toContain('tabindex="0"');
    } finally {
      compiled.runtime.dispose();
    }
  });

  it('keeps interactive controls and reset actions by default', () => {
    const compiled = compile(SOURCE);
    try {
      mutateDocument(compiled);
      const html = render(compiled.document, compiled.runtime);

      expect(html).toMatch(/<input\b/);
      expect(html).toMatch(/<select\b/);
      expect(html).toMatch(/<textarea\b/);
      expect(html).toMatch(/<button\b/);
      expect(html).toContain('local-panel-reset');
      expect(html).toContain('>Reset<');
      expect(html).toContain('data-render-mode="interactive"');
      expect(html).toContain('<article class="md-document local-document" data-rmd-theme');
      expect(html).not.toContain('class="md-document local-document local-static"');

      // Print-only values carry the current runtime state.
      expect(html).toContain('local-print-value');
      expect(html).toContain('Grace Hopper');
      expect(html).toContain('Blue');
      expect(html).toContain('Alpha, Gamma');
      expect(html).toContain('Start: 3 · End: 7');
      expect(html).toContain('X: 2 · Y: -1');
      expect(html).toContain('30 seconds');
      expect(html).toContain('data-local-print-value');
    } finally {
      compiled.runtime.dispose();
    }
  });

  it('forwards static mode through LocalReactiveDocument', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument
        source={'<input bind="name" label="Name" initial="Ada">\n\n<toggle bind="on" label="On">'}
        mode="static"
      />,
    );
    expect(html).not.toMatch(/<input\b/);
    expect(html).not.toMatch(/<button\b/);
    expect(html).toContain('data-render-mode="static"');
    expect(html).toContain('local-static');
    expect(html).toContain('aria-label="Static document"');
    expect(html).toContain('Ada');
  });
});

describe('empty static values', () => {
  it('uses an em dash for empty input-like values', () => {
    const compiled = compile(
      '<input label="Empty" initial="">\n\n<date label="No date">\n\n<select label="Pick">\n<option value="a">A</option>\n</select>',
    );
    try {
      const html = render(compiled.document, compiled.runtime, 'static');
      expect(html).toContain('—');
      expect(html).not.toMatch(/<input\b/);
    } finally {
      compiled.runtime.dispose();
    }
  });
});

describe('image resolver', () => {
  const source =
    '![Chart](https://example.com/chart.png)\n\n[Site](https://example.com/page)\n\n' +
    '![Relative](./local.png)';

  it('keeps default image rejection unchanged without a policy', () => {
    const compiled = compile(source);
    try {
      const resolver = vi.fn<LocalImageResolver>(() => 'data:image/png;base64,AAAA');
      const html = render(compiled.document, compiled.runtime, 'static', { imageResolver: resolver });
      expect(html).not.toContain('<img');
      expect(html).toContain('Unsafe image rejected');
      expect(html).toContain('href="https://example.com/page"');
      expect(resolver).not.toHaveBeenCalled();
    } finally {
      compiled.runtime.dispose();
    }
  });

  it('maps only an image URL that passed the host policy', () => {
    const compiled = compile(source);
    try {
      const resolver = vi.fn<LocalImageResolver>((url) =>
        url === 'https://example.com/chart.png' ? 'data:image/png;base64,AAAA' : null,
      );
      const policy = vi.fn<LocalUrlPolicy>(() => true);
      const html = render(compiled.document, compiled.runtime, 'static', {
        imageResolver: resolver,
        urlPolicy: policy,
      });

      expect(html).toContain('<img class="md-image" src="data:image/png;base64,AAAA"');
      expect(html).toContain('alt="Chart"');
      expect(resolver).toHaveBeenCalledTimes(2);
      expect(resolver).toHaveBeenCalledWith('https://example.com/chart.png');
      expect(resolver).toHaveBeenCalledWith('./local.png');
      expect(resolver).not.toHaveBeenCalledWith('https://example.com/page');
      expect(policy).toHaveBeenCalledWith('https://example.com/page', 'link');
    } finally {
      compiled.runtime.dispose();
    }
  });

  it('falls back to a rejected image when the resolver throws or returns nothing', () => {
    const compiled = compile(source);
    try {
      const throwing = vi.fn<LocalImageResolver>(() => {
        throw new Error('nope');
      });
      const thrownHtml = render(compiled.document, compiled.runtime, 'static', {
        imageResolver: throwing,
        urlPolicy: () => true,
      });
      expect(thrownHtml).not.toContain('<img');
      expect(thrownHtml).toContain('Unsafe image rejected');

      const empty = vi.fn<LocalImageResolver>(() => '');
      const emptyHtml = render(compiled.document, compiled.runtime, 'static', {
        imageResolver: empty,
        urlPolicy: () => true,
      });
      expect(emptyHtml).not.toContain('<img');
      expect(emptyHtml).toContain('Unsafe image rejected');
    } finally {
      compiled.runtime.dispose();
    }
  });

  it('rejects remote and relative images without a host policy', () => {
    const compiled = compile(source);
    try {
      const resolver = vi.fn<LocalImageResolver>(() => 'data:image/png;base64,AAAA');
      const html = render(compiled.document, compiled.runtime, 'static', { imageResolver: resolver });
      expect(html).not.toContain('<img');
      expect(resolver).not.toHaveBeenCalled();
    } finally {
      compiled.runtime.dispose();
    }
  });
});
