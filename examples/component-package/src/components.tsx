import { useState } from 'react';
import { createLocalConfig, collectLocalThemeCss } from 'reactive-md/sdk';
import { createReactConfig, defineReactComponent, type LocalComponentContext } from 'reactive-md/react';
import { defaultPreset } from 'reactive-md/presets/default';
import noticeSvg from './assets/notice.svg?raw';
import componentCssText from './component.css?raw';
import { note, rating } from './manifests';
import { paper } from './theme';

/** Inline local asset. No network request, valid in offline exports. */
export const noticeIcon = `data:image/svg+xml,${encodeURIComponent(noticeSvg)}`;
export const componentCss = componentCssText;
export const themeCss = collectLocalThemeCss(paper);

function valueOf(context: LocalComponentContext): number {
  const value = context.bindings.value.get();
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function RatingControl(context: LocalComponentContext) {
  const [exploded, setExploded] = useState(false);
  const value = valueOf(context);
  const maximum = typeof context.props.max === 'number' ? context.props.max : 5;
  const label = String(context.props.label ?? 'Rating');
  const locked = context.disabled || context.props.locked === true || !context.visible;
  if (exploded) {
    throw new Error('rating exploded during render');
  }
  const set = (next: number): void => {
    if (locked) return;
    context.bindings.value.set(Math.max(0, Math.min(maximum, Math.round(next))));
  };
  return (
    <div className="rmd-example-rating" data-rating data-value={String(value)} role="group" aria-label={label}>
      <output data-rating-value>{String(value)}</output>
      <button type="button" data-rating-up disabled={locked} onClick={() => set(value + 1)}>+</button>
      <button type="button" data-rating-invalid disabled={locked} onClick={() => context.bindings.value.set(maximum + 5)}>
        invalid
      </button>
      <button type="button" data-rating-break onClick={() => setExploded(true)}>break</button>
      <button type="button" data-rating-reset onClick={() => context.runtime.reset(context.content)}>reset</button>
    </div>
  );
}

export function RatingStatic(context: LocalComponentContext) {
  return (
    <span className="rmd-example-rating-static" data-rating-static>
      {String(context.props.label ?? 'Rating')}: {String(valueOf(context))}
    </span>
  );
}

export function Note(context: LocalComponentContext) {
  return (
    <aside
      className="rmd-example-note"
      data-note
      data-tone={String(context.props.tone ?? 'info')}
      data-note-disabled={context.disabled ? 'true' : 'false'}
    >
      <header>
        <img data-note-icon src={noticeIcon} alt="" width="16" height="16" />
        <strong data-note-title>{String(context.props.title ?? '')}</strong>
      </header>
      {context.children.render()}
    </aside>
  );
}

const ratingImplementation = defineReactComponent(rating, {
  render: RatingControl,
  renderStatic: RatingStatic,
});
const noteImplementation = defineReactComponent(note, {
  render: Note,
  renderStatic: Note,
});

export const config = createLocalConfig({
  presets: [defaultPreset],
  components: [rating, note],
  themes: [paper],
});

export const reactConfig = createReactConfig(config, {
  components: [ratingImplementation, noteImplementation],
});

/**
 * Used only by the server error probe. It keeps the same contract but throws
 * in the static implementation, proving the SSR pipeline reports a diagnostic
 * instead of leaking the exception.
 */
export const brokenReactConfig = createReactConfig(config, {
  components: [
    defineReactComponent(rating, {
      render: RatingControl,
      renderStatic: () => {
        throw new Error('rating exploded during server rendering');
      },
    }),
    noteImplementation,
  ],
});
