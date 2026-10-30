import { useEffect, useState } from 'react';
import { createLocalConfig, defineLocalComponent, type LocalComponentDefinition } from 'reactive-md/sdk';
import { defaultPreset } from 'reactive-md/presets/default';
import { createReactConfig, defineReactComponent, type LocalComponentContext } from 'reactive-md/react';

// Reuse public contracts to prove that their semantics also apply to external names.
function extend(name: string, next: string): LocalComponentDefinition {
  const original = defaultPreset.components.find(item => item.name === name);
  if (!original) throw new Error(`Missing default component ${name}`);
  return defineLocalComponent({ ...original, id: `example/${next}`, name: next, version: '1.0.0',
    authoring: { title: { en: next, zh: next }, insertText: next === 'vector-pad'
      ? '<vector-pad label="Vector" bind-x="pointX" bind-y="pointY">'
      : next === 'basket' ? '<basket label="Basket"><option value="one">One</option></basket>'
        : '<memo-box title="Memo">\n**Markdown**\n</memo-box>' },
  });
}
export const vector = extend('coordinate', 'vector-pad');
export const basket = extend('multi-select', 'basket');
export const memo = extend('card', 'memo-box');
export const series = defineLocalComponent({
  id: 'example/number-series', name: 'number-series', version: '1.0.0', protocol: 'reactive-md-component/v1', form: 'leaf',
  props: {}, bindings: { value: { kind: 'number-array', family: 'collection', bind: 'bind', initial: 'initial',
    initialRule: 'empty-array', exclusive: true, maxItems: { literal: 2 } } },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: { title: { en: 'Number series' }, insertText: '<number-series bind="samples" initial="[1,2]">' },
});

let mounted = 0;
export const activeVectors = () => mounted;

function Vector(ctx: LocalComponentContext) {
  const [message, setMessage] = useState('');
  useEffect(() => { mounted++; return () => { mounted--; }; }, []);
  useEffect(() => setMessage(''), [ctx.resetToken, ctx.visible]);
  const x = ctx.bindings.get('x');
  const y = ctx.bindings.get('y');
  const move = (nextX: number, nextY: number) => {
    const result = ctx.bindings.setMany({ x: nextX, y: nextY });
    setMessage(result.ok ? 'accepted' : 'rejected');
  };
  return <div data-vector data-reset-token={ctx.resetToken}>
    <output aria-label="Vector value">{String(x)}, {String(y)}</output>
    <button disabled={ctx.disabled || ctx.bindings.isReadOnly} onClick={() => move(2, 3)}>Move vector</button>
    <button disabled={ctx.disabled || ctx.bindings.isReadOnly} onClick={() => move(4, 99)}>Invalid vector</button>
    <output aria-label="Vector result">{message}</output>
  </div>;
}
function Basket(ctx: LocalComponentContext) {
  const value = ctx.bindings.value.get();
  const selected = Array.isArray(value) ? value as readonly string[] : [];
  const [message, setMessage] = useState('');
  useEffect(() => setMessage(''), [ctx.resetToken]);
  return <fieldset data-basket disabled={ctx.disabled || ctx.bindings.isReadOnly}><legend>{String(ctx.props.label)}</legend>
    {ctx.children.options().map(option => <label key={option.value}>
      <input type="checkbox" checked={selected.includes(option.value)} onChange={() => {
        const next = selected.includes(option.value) ? selected.filter(item => item !== option.value) : [...selected, option.value];
        const result = ctx.bindings.value.set(next);
        setMessage(result.ok ? 'accepted' : 'rejected');
      }}/>{option.render()}
    </label>)}
    <output aria-label="Basket value">{selected.join(',')}</output>
    <output aria-label="Basket result">{message}</output>
  </fieldset>;
}
function Memo(ctx: LocalComponentContext) {
  return <aside data-memo><h3>{String(ctx.props.title)}</h3>{ctx.children.render()}</aside>;
}
function Series(ctx: LocalComponentContext) {
  const value = ctx.bindings.value.get();
  const [message, setMessage] = useState('');
  useEffect(() => setMessage(''), [ctx.resetToken]);
  return <div data-series>
    <output aria-label="Series value">{Array.isArray(value) ? value.join(',') : 'invalid'}</output>
    <button disabled={ctx.disabled || ctx.bindings.isReadOnly} onClick={() => setMessage(ctx.bindings.value.set([3, 4]).ok ? 'accepted' : 'rejected')}>Set series</button>
    <button disabled={ctx.disabled || ctx.bindings.isReadOnly} onClick={() => setMessage(ctx.bindings.value.set([3, Infinity]).ok ? 'accepted' : 'rejected')}>Invalid series</button>
    <output aria-label="Series result">{message}</output>
  </div>;
}
export const advancedConfig = createLocalConfig({ components: [vector, basket, memo, series] });
export const advancedReactConfig = createReactConfig(advancedConfig, { components: [
  defineReactComponent(vector, { render: Vector, renderStatic: Vector }),
  defineReactComponent(basket, { render: Basket, renderStatic: Basket }),
  defineReactComponent(memo, { render: Memo, renderStatic: Memo }),
  defineReactComponent(series, { render: Series, renderStatic: Series }),
] });
export const advancedSource = `<toggle bind="shown" label="Show vector" initial="true">
<toggle bind="blocked" label="Disable vector">
<panel title="Advanced SDK">
<if when="{{ shown }}">
<vector-pad label="Vector" bind-x="pointX" bind-y="pointY" disabled="{{ blocked }}">
</if>
<basket label="Basket" bind="picked" max-selected="2" initial="one">
<option value="one">One</option>
<option value="two">Two</option>
<option value="three">Three</option>
</basket>
<number-series bind="samples" initial="[1,2]">
<memo-box title="Memo">
Coordinates: **{{ pointX }}, {{ pointY }}**.
</memo-box>
</panel>`;
