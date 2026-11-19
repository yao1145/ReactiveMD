import { DEFAULT_PRESET_VERSION } from '../../presets/identity';
import { defineLocalPreset } from '../../sdk/preset-core';
import { LOCAL_PRESET_PROTOCOL } from '../../sdk/version';
import { mountOfficialPreset } from '../mount-preset';
import { SubmitButtonView, submitButtonDefinition } from '../network/submit-button';
import networkCss from '../network/network.css?inline';

/**
 * Official optional network plugin. It is a standalone preset: the submit
 * button is not part of the default or minimal presets, and the host decides
 * which channels it may use at runtime.
 */
const preset = defineLocalPreset({
  id: 'reactive-md/network',
  version: DEFAULT_PRESET_VERSION,
  protocol: LOCAL_PRESET_PROTOCOL,
  components: [submitButtonDefinition],
});

export default mountOfficialPreset(
  preset,
  { 'submit-button': SubmitButtonView },
  [{ id: 'reactive-md/network.css', css: networkCss }],
);
