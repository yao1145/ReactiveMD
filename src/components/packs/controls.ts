import { controlsPack } from '../../presets/packs';
import { CheckboxView, ChoicesView, ChecklistView, CounterView, DateView, InputView, MultiSelectView,
  NumberView, ProgressView, QuizView, RadioGroupView, RangeSliderView, SelectView, SliderView,
  TextareaView, TimerView, ToggleView } from '../controls/controls';
import { CoordinateView } from '../plot/coordinate';
import { OptionView } from '../layout/structural-views';
import { mountOfficialPreset } from '../mount-preset';
import controlsCss from '../controls/controls.css?inline';
import mafsCoreCss from 'mafs/core.css?inline';
import mafsCss from '../plot/mafs.css?inline';

export const controlsReactPack = mountOfficialPreset(controlsPack, {
  input: InputView, textarea: TextareaView, number: NumberView, slider: SliderView,
  'range-slider': RangeSliderView, coordinate: CoordinateView, toggle: ToggleView, checkbox: CheckboxView,
  date: DateView, select: SelectView, choices: ChoicesView, 'radio-group': RadioGroupView,
  'multi-select': MultiSelectView, option: OptionView, progress: ProgressView, timer: TimerView,
  quiz: QuizView, counter: CounterView, checklist: ChecklistView,
}, [
  { id: 'reactive-md/controls.css', css: controlsCss },
  { id: 'reactive-md/mafs-core.css', css: `@layer rmd.reset { ${mafsCoreCss} }` },
  { id: 'reactive-md/mafs.css', css: mafsCss },
]);
export default controlsReactPack;
