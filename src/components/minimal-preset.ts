import { InputView, TextareaView, NumberView, SliderView, ToggleView, DateView, SelectView } from './controls/controls';
import { OptionView, TextView, IfView, AlertView, BadgeView, PanelView, CardView, GridView, SectionView, JumpView, AnchorView } from './layout/layout';
import { minimalPreset } from '../presets/minimal';
import { mountOfficialPreset } from './mount-preset';

export const minimalReactPresetPackage = mountOfficialPreset(minimalPreset, {
  input: InputView,
  textarea: TextareaView,
  number: NumberView,
  slider: SliderView,
  toggle: ToggleView,
  date: DateView,
  select: SelectView,
  option: OptionView,
  text: TextView,
  if: IfView,
  alert: AlertView,
  badge: BadgeView,
  panel: PanelView,
  card: CardView,
  grid: GridView,
  section: SectionView,
  jump: JumpView,
  anchor: AnchorView,
});

export default minimalReactPresetPackage;
