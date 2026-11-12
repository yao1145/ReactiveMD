import { defineLocalPreset } from '../sdk/preset-core';
import { LOCAL_PRESET_PROTOCOL } from '../sdk/version';
import { DEFAULT_COMPONENT_DEFINITIONS } from './default-components';
import { DEFAULT_PRESET_VERSION } from './identity';

/**
 * Named subsets of the default preset. Packs are ordinary presets: select one
 * or more, but never combine a pack with `defaultPreset`, because the shared
 * components would be declared twice.
 */

const CONTROL_NAMES = new Set([
  'input', 'textarea', 'number', 'slider', 'range-slider', 'coordinate',
  'toggle', 'checkbox', 'date', 'select', 'choices', 'radio-group',
  'multi-select', 'option', 'progress', 'timer', 'quiz', 'counter', 'checklist',
]);

const LAYOUT_NAMES = new Set([
  'jump', 'anchor', 'text', 'section', 'panel', 'card', 'grid', 'column',
  'tabs', 'tab', 'steps', 'step', 'accordion', 'disclosure', 'if', 'alert',
  'badge', 'tooltip', 'validation', 'gallery', 'gallery-item',
]);

const DATA_NAMES = new Set(['data-table', 'table', 'column', 'timeline']);

const VISUAL_NAMES = new Set(['chart', 'plot', 'diagram', 'node', 'edge']);

function pack(id: string, names: ReadonlySet<string>, dependencies: readonly string[] = []) {
  return defineLocalPreset({
    protocol: LOCAL_PRESET_PROTOCOL,
    id,
    version: DEFAULT_PRESET_VERSION,
    components: DEFAULT_COMPONENT_DEFINITIONS.filter((component) => names.has(component.name)),
    ...(dependencies.length === 0
      ? {}
      : { dependencies: dependencies.map((dependency) => ({ id: dependency, version: DEFAULT_PRESET_VERSION })) }),
  });
}

export const controlsPack = pack('reactive-md/default-controls', CONTROL_NAMES);
export const layoutPack = pack('reactive-md/default-layout', LAYOUT_NAMES);
export const dataPack = pack('reactive-md/default-data', DATA_NAMES);
export const visualsPack = pack('reactive-md/default-visuals', VISUAL_NAMES, [dataPack.id]);
