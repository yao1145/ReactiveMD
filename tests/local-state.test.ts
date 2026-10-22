import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import type { LocalDocument, LocalNode } from '../src/local/types';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function codes(source: string): string[] {
  return compileLocal(source).diagnostics.map((diagnostic) => diagnostic.code);
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function find(document: LocalDocument, name: string, index = 0): LocalNode {
  const matches = all(document.nodes).filter((node) => node.type === 'component' && node.name === name);
  if (!matches[index]) throw new Error(`找不到第 ${index} 个 <${name}>`);
  return matches[index];
}

function keyOf(node: LocalNode): string {
  return node.attrs?.bind ?? `@${node.id}`;
}

describe('local compiler bindings', () => {
  it('initializes named, anonymous and shared controls before expressions', () => {
    const document = compile(
      '正文先读取：**{{ people }}**。\n\n<slider bind="people" label="人数" initial="2" min="1" max="20">\n<number bind="people" label="再次输入" min="1" max="20">\n<counter label="内部计数" initial="3">',
    );
    expect(document.initialState.people).toBe(2);
    expect(document.bindings.people.nodeIds).toHaveLength(2);
    expect(document.bindings.people.min).toBe(1);
    expect(document.bindings.people.max).toBe(20);
    const counter = find(document, 'counter');
    expect(document.initialState[`@${counter.id}`]).toBe(3);
    expect(document.bindings[`@${counter.id}`]).toBeDefined();
  });

  it('keeps anonymous controls independent and lets shared inputs synchronize', () => {
    const document = compile(
      '<slider bind="n" label="A" initial="1" min="0" max="10">\n<slider bind="n" label="B" min="0" max="10">\n<counter label="C" initial="4">',
    );
    const runtime = createLocalRuntime(document);
    const first = find(document, 'slider', 0);
    const second = find(document, 'slider', 1);
    const counter = find(document, 'counter');
    expect(runtime.set(first, 7)).toEqual([]);
    expect(runtime.get(second)).toBe(7);
    expect(runtime.get(counter)).toBe(4);
    expect(runtime.set(counter, 9)).toEqual([]);
    expect(runtime.get(counter)).toBe(9);
    expect(runtime.get(first)).toBe(7);
    runtime.dispose();
  });

  it('resolves forward references and initializes hidden branches', () => {
    const document = compile(
      '<if when="{{ flag }}">\n<slider bind="secret" label="隐藏参数" initial="4" min="0" max="10">\n</if>\n<toggle bind="flag" label="显示">',
    );
    expect(document.initialState.flag).toBe(false);
    expect(document.initialState.secret).toBe(4);
    expect(document.bindings.secret.nodeIds).toHaveLength(1);
  });

  it('keeps an explicit initial only once and reports both locations', () => {
    const result = compileLocal(
      '<slider bind="a" label="A" initial="1" min="0" max="10">\n<slider bind="a" label="B" initial="2" min="0" max="10">',
    );
    expect(result.ok).toBe(false);
    const duplicates = result.diagnostics.filter((diagnostic) => diagnostic.code === 'local.initial.duplicate');
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((diagnostic) => diagnostic.line > 0 && diagnostic.column > 0)).toBe(true);
  });

  it('rejects incompatible shared constraints and exclusive owners', () => {
    expect(
      codes('<slider bind="n" label="A" min="0" max="10">\n<slider bind="n" label="B" min="0" max="20">'),
    ).toContain('local.binding.constraint');
    expect(
      codes('<timer bind="t" label="A" duration="60">\n<timer bind="t" label="B" duration="60">'),
    ).toContain('local.binding.exclusive');
    expect(
      codes('<toggle bind="v" label="A">\n<slider bind="v" label="B">'),
    ).toContain('local.binding.type');
  });
});

describe('local compiler diagnostics', () => {
  it('reports unknown bindings, components, attributes and types', () => {
    expect(codes('<slider bind="seats" label="人数">\n\n当前：{{ seat }}')).toContain('local.binding.unknown');
    expect(codes('<slidr label="拼错" />')).toContain('local.component.unknown');
    expect(codes('<counter label="计数" on-click="increment">')).toContain('local.attribute.unknown');
    expect(
      codes('<toggle bind="flag" label="开关">\n<if when="{{ flag }}">条件</if>'),
    ).not.toContain('local.type');
    expect(
      codes('<slider bind="seats" label="人数">\n<if when="{{ seats }}">条件</if>'),
    ).toContain('local.type');
  });

  it('validates initial ranges and numeric constraints', () => {
    expect(
      codes('<slider bind="ratio" label="比例" initial="12" min="0" max="10">'),
    ).toContain('local.initial.range');
    expect(
      codes('<slider bind="ratio" label="比例" initial="1.5" min="0" max="10" step="1">'),
    ).toContain('local.initial.step');
    expect(
      codes('<number bind="n" label="数值" min="10" max="1">'),
    ).toContain('local.constraint');
  });

  it('requires a complete boolean interpolation for if.when', () => {
    expect(codes('<if when="true">条件</if>')).toContain('local.attribute.interpolation');
    expect(codes('<if when="{{ 1 + 1 }}">条件</if>')).toContain('local.type');
  });

  it('rejects arrays in text and unknown table values', () => {
    expect(
      codes('<checklist bind="done" label="清单">\n- [ ] 一\n</checklist>\n\n{{ done }}'),
    ).toContain('local.type');
    expect(
      codes(
        '<chart title="费用">\n| 项目 | 费用 |\n| --- | ---: |\n| 内容 | 20 元 |\n</chart>',
      ),
    ).toContain('local.chart.numeric');
  });
});

describe('local compiler tables, diagrams and plots', () => {
  it('accepts typed numeric table cells and minimal diagram wiring', () => {
    const document = compile(
      [
        '<chart kind="bar" title="费用">',
        '| 方案 | 费用 |',
        '| --- | ---: |',
        '| 基础 | {{ people * 20 }} |',
        '</chart>',
        '',
        '<diagram bind="selected" initial="input" label="流程">',
        '<node id="input" label="输入">',
        '说明。',
        '</node>',
        '<edge from="input" to="input" label="自环">',
        '</diagram>',
        '<slider bind="people" label="人数" initial="2" min="1" max="20">',
      ].join('\n'),
    );
    expect(document.initialState.selected).toBe('input');
    expect(document.bindings.selected.options).toEqual(['input']);
  });

  it('reports missing diagram endpoints, duplicate tabs and unsupported plot math', () => {
    expect(
      codes(
        '<diagram label="错误">\n<node id="input" label="输入">\n</node>\n<edge from="input" to="missing">\n</diagram>',
      ),
    ).toContain('local.diagram.edge');
    expect(
      codes('<tabs>\n<tab label="一" value="x">A</tab>\n<tab label="二" value="x">B</tab>\n</tabs>'),
    ).toContain('local.tab.value');
    const integral = compileLocal('<plot label="积分">\n$$ y = \\int_0^x t^2\\,dt $$\n</plot>');
    expect(integral.ok).toBe(false);
    expect(integral.diagnostics.some((diagnostic) => diagnostic.code === 'local.math')).toBe(true);
  });

  it('accepts supported plot math and validates its numeric dependencies', () => {
    const document = compile(
      '<slider bind="a" label="振幅" initial="1" min="0" max="5">\n<plot min="-10" max="10">\n$$ y = a \\sin x $$\n</plot>',
    );
    expect(document.initialState.a).toBe(1);
    expect(
      codes('<toggle bind="a" label="开关">\n<plot>\n$$ y = a \\sin x $$\n</plot>'),
    ).toContain('local.math.binding');
  });
});

describe('local runtime', () => {
  it('validates set values and rejects use after dispose', () => {
    const document = compile('<slider bind="n" label="数值" initial="2" min="0" max="10" step="1">');
    const runtime = createLocalRuntime(document);
    const slider = find(document, 'slider');
    expect(runtime.set(slider, 11)[0]?.code).toBe('local.runtime.value');
    expect(runtime.get(slider)).toBe(2);
    expect(runtime.set(slider, 1.5)[0]?.code).toBe('local.runtime.value');
    expect(runtime.set(slider, 6)).toEqual([]);
    expect(runtime.get(slider)).toBe(6);
    runtime.dispose();
    expect(() => runtime.snapshot()).toThrow();
    expect(() => runtime.set(slider, 1)).toThrow();
  });

  it('evaluates expressions and renders scalar text', () => {
    const document = compile('<slider bind="n" label="数值" initial="3" min="0" max="10">');
    const runtime = createLocalRuntime(document);
    expect(runtime.evaluate('n * 4')).toBe(12);
    expect(runtime.text('当前 {{ n }} 人')).toBe('当前 3 人');
    runtime.dispose();
  });

  it('resets a panel subtree atomically and bumps descendant tokens once', () => {
    const document = compile(
      [
        '<panel title="面板">',
        '<slider bind="a" label="A" initial="2" min="0" max="10">',
        '<toggle bind="b" label="B">',
        '<tabs>',
        '<tab label="一" value="one">A</tab>',
        '<tab label="二" value="two">B</tab>',
        '</tabs>',
        '</panel>',
      ].join('\n'),
    );
    const runtime = createLocalRuntime(document);
    const panel = find(document, 'panel');
    const slider = find(document, 'slider');
    const toggle = find(document, 'toggle');
    const tabs = find(document, 'tabs');
    runtime.set(slider, 8);
    runtime.set(toggle, true);
    runtime.set(tabs, 'two');
    const beforeRevision = runtime.snapshot().revision;
    const tabsToken = runtime.resetToken(tabs);
    runtime.reset(panel);
    const after = runtime.snapshot();
    expect(after.revision).toBe(beforeRevision + 1);
    expect(runtime.get(slider)).toBe(2);
    expect(runtime.get(toggle)).toBe(false);
    expect(runtime.get(tabs)).toBe('one');
    expect(runtime.resetToken(tabs)).toBe(tabsToken + 1);
    expect(runtime.resetToken(panel)).toBe(1);
    runtime.dispose();
  });

  it('provides a stable snapshot between changes', () => {
    const document = compile('<slider bind="n" label="数值" initial="2" min="0" max="10">');
    const runtime = createLocalRuntime(document);
    const slider = find(document, 'slider');
    const first = runtime.snapshot();
    expect(runtime.snapshot()).toBe(first);
    let calls = 0;
    const unsubscribe = runtime.subscribe(() => calls++);
    runtime.set(slider, 3);
    const second = runtime.snapshot();
    expect(second).not.toBe(first);
    expect(calls).toBe(1);
    expect(Object.isFrozen(second.state)).toBe(true);
    unsubscribe();
    runtime.dispose();
  });

  it('validates checklist membership and date values', () => {
    const checklist = compile(
      '<checklist bind="done" label="清单">\n- [x] 一\n- [ ] 二\n</checklist>',
    );
    expect(checklist.initialState.done).toEqual(['item-1']);
    const runtime = createLocalRuntime(checklist);
    const node = find(checklist, 'checklist');
    expect(runtime.set(node, ['item-1', 'item-2'])).toEqual([]);
    expect(runtime.set(node, ['item-9'])[0]?.code).toBe('local.runtime.value');
    runtime.dispose();

    expect(codes('<date bind="day" label="日期" initial="2026-13-40">')).toContain('local.initial.date');
  });

  it('uses first tab and first diagram node as defaults', () => {
    const document = compile(
      '<tabs>\n<tab label="一">A</tab>\n<tab label="二">B</tab>\n</tabs>\n<diagram>\n<node id="first" label="一">\n</node>\n<node id="second" label="二">\n</node>\n</diagram>',
    );
    const tabs = find(document, 'tabs');
    const diagram = find(document, 'diagram');
    expect(document.initialState[keyOf(tabs)]).toBe('tab-1');
    expect(document.initialState[keyOf(diagram)]).toBe('first');
    const runtime = createLocalRuntime(document);
    expect(runtime.set(diagram, 'second')).toEqual([]);
    expect(runtime.get(diagram)).toBe('second');
    expect(runtime.set(diagram, 'absent')[0]?.code).toBe('local.runtime.value');
    runtime.dispose();
  });
});
