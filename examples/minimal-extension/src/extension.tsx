import { createLocalConfig, defineLocalComponent } from 'reactive-md/sdk';
import { createReactConfig, defineReactComponent, type LocalComponentContext } from 'reactive-md/react';

/**
 * One leaf component. The manifest below is plain JSON data; the two render
 * functions are React code. `config` and `reactConfig` are the pair every host
 * needs, and both are built from the same manifest.
 */
export const ratingCard = defineLocalComponent({
  id: 'example/rating-card',
  name: 'rating-card',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    label: { kind: 'string', required: true },
    max: { kind: 'number', dynamic: true, default: 5, integer: true, min: 1, max: 10 },
  },
  bindings: {
    value: {
      kind: 'number',
      family: 'number',
      bind: 'bind',
      initial: 'initial',
      initialRule: 'nearest-zero',
      constraints: {
        min: { literal: 0 },
        max: { prop: 'max' },
        step: { literal: 1 },
      },
    },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Rating card', zh: '评分卡' },
    description: {
      en: 'A leaf card that increments one shared number.',
      zh: '递增一个共享数值的叶子卡片。',
    },
    category: 'input',
    insertText: '<rating-card bind="score" label="Score" max="5" initial="3">',
  },
});

function currentValue(context: LocalComponentContext): number {
  const value = context.bindings.value.get();
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function RatingCard(context: LocalComponentContext) {
  const value = currentValue(context);
  const maximum = typeof context.props.max === 'number' ? context.props.max : 5;
  const label = String(context.props.label ?? 'Rating');
  const locked = context.disabled || !context.visible || value >= maximum;
  return (
    <div className="rating-card" data-rating-card data-value={String(value)} role="group" aria-label={label}>
      <output data-rating-card-value>{String(value)}</output>
      <span aria-hidden="true">{'\u2605'.repeat(value)}{'\u2606'.repeat(Math.max(0, maximum - value))}</span>
      <button type="button" data-rating-card-up disabled={locked} onClick={() => context.bindings.value.set(value + 1)}>
        Add one
      </button>
      <button type="button" data-rating-card-reset onClick={() => context.runtime.reset(context.content)}>
        Reset
      </button>
    </div>
  );
}

export function RatingCardStatic(context: LocalComponentContext) {
  return (
    <span className="rating-card" data-rating-card-static>
      {String(context.props.label ?? 'Rating')}: {String(currentValue(context))}
    </span>
  );
}

const ratingCardImplementation = defineReactComponent(ratingCard, {
  render: RatingCard,
  renderStatic: RatingCardStatic,
});

/** Passed to compilers, editors and workers. The default preset stays enabled. */
export const config = createLocalConfig({ components: [ratingCard] });

/** Passed to preview, SSR and export rendering. */
export const reactConfig = createReactConfig(config, { components: [ratingCardImplementation] });

export { source } from './source';
