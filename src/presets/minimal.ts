import { selectOfficialPreset } from './plugin-packs';
import { MINIMAL_PRESET_ID } from './identity';

export const minimalPreset = selectOfficialPreset(MINIMAL_PRESET_ID, [
  'input', 'textarea', 'number', 'slider', 'toggle', 'date', 'select', 'option',
  'text', 'if', 'alert', 'badge', 'panel', 'card', 'grid', 'section',
  'jump', 'anchor',
]);

export default minimalPreset;
