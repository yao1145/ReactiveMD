import { describe, expect, it } from 'vitest';
import { createStandardCompiler } from '../src/compiler/standard';

const cases = {
  checklist: '<checklist bind="tasks" label="Tasks">\n- [x] First\n- [ ] Second\n</checklist>',
  'checklist mixed body': '<checklist bind="tasks" label="Tasks">\nExtra\n\n- [x] First\n  - [ ] Nested\n- Ordinary\n</checklist>',
  choices: '<choices bind="choice" label="Choice">\n<option value="a">Alpha</option>\n<option value="b">Beta</option>\n</choices>',
  'choices invalid children': '<choices bind="choice" label="Choice">\nText\n<option value="a">Alpha</option>\n<option value="a">Duplicate</option>\n<option>Missing</option>\n<badge>Unexpected</badge>\n</choices>',
  'quiz choice': '<quiz label="Question" answer="b">\n<option value="a">Alpha</option>\n<option value="b">Beta</option>\n</quiz>',
  'quiz invalid answer': '<quiz label="Question" answer="missing">\n<option value="a">Alpha</option>\n<option value="a">Duplicate</option>\n</quiz>',
  'quiz numeric body': '<quiz label="Question" type="number" answer="bad" tolerance="-1">\nUnexpected\n</quiz>',
  diagram: '<diagram bind="selected" label="Graph">\n<node id="a" label="Alpha"></node>\n<node id="b" label="Beta"></node>\n<edge from="a" to="b">\n</diagram>',
  'diagram invalid references': '<diagram bind="selected" label="Graph">\n<node id="a" label="Alpha"></node>\n<node id="a" label="Duplicate"></node>\n<edge from="missing" to="a">\n<edge from="missing" to="a">\nUnexpected\n</diagram>',
  tabs: '<tabs bind="tab" label="Tabs">\n<tab label="First">One</tab>\n<tab label="Second" value="second">Two</tab>\n</tabs>',
  'tabs duplicate values': '<tabs bind="tab" label="Tabs">\n<tab label="First" value="same">One</tab>\n<tab label="Second" value="same">Two</tab>\nUnexpected\n</tabs>',
  'grid invalid children': '<grid>\nText\n<panel title="Unexpected">Body</panel>\n</grid>',
};

/** Normalize allocation ids while retaining diagnostic order and locations. */
function canonical(value: unknown): unknown {
  const ids = new Map<string, string>();
  const rename = (text: string): string => {
    if (!/^local-\d+$/.test(text)) return text;
    if (!ids.has(text)) ids.set(text, `node-${ids.size}`);
    return ids.get(text)!;
  };
  const visit = (input: unknown): unknown => {
    if (typeof input === 'string') return rename(input);
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([key, child]) => [rename(key), visit(child)]));
    }
    return input;
  };
  return visit(value);
}

describe.each([true, false])('component structure contract, strict=%s', (strict) => {
  it.each(Object.entries(cases))('%s', (name, source) => {
    const result = createStandardCompiler({ strict }).compile(source);
    expect(result.ok).toBe(['checklist', 'choices', 'quiz choice', 'diagram', 'tabs'].includes(name));
    expect(canonical({
      ok: result.ok,
      status: result.status,
      diagnostics: result.diagnostics,
      recoveries: result.recoveries,
      ...(result.ok ? {
        bindings: result.document.bindings,
        initialState: result.document.initialState,
        componentConfigKey: result.document.componentConfigKey,
        kernel: result.document.kernel,
        extensions: result.document.extensions,
      } : {}),
    })).toMatchSnapshot();
  });
});
