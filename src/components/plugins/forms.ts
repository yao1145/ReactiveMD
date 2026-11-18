import { RangeSliderView, CheckboxView, ChoicesView, RadioGroupView, MultiSelectView, ProgressView, TimerView, QuizView, CounterView, ChecklistView } from '../controls/controls';
import { selectOfficialPreset } from '../../presets/plugin-packs';
import { MINIMAL_PRESET_ID } from '../../presets/identity';
import { mountOfficialPreset } from '../mount-preset';

const views = {
  'range-slider': RangeSliderView,
  checkbox: CheckboxView,
  choices: ChoicesView,
  'radio-group': RadioGroupView,
  'multi-select': MultiSelectView,
  progress: ProgressView,
  timer: TimerView,
  quiz: QuizView,
  counter: CounterView,
  checklist: ChecklistView,
};
const preset = selectOfficialPreset('reactive-md/forms', Object.keys(views), [MINIMAL_PRESET_ID]);

export default mountOfficialPreset(preset, views);
