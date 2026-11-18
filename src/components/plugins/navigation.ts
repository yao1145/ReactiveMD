import { TabsView, TabView, StepsView, StepView, AccordionView, DisclosureView, TooltipView, ValidationView } from '../layout/layout';
import { selectOfficialPreset } from '../../presets/plugin-packs';
import { mountOfficialPreset } from '../mount-preset';

const views = {
  tabs: TabsView,
  tab: TabView,
  steps: StepsView,
  step: StepView,
  accordion: AccordionView,
  disclosure: DisclosureView,
  tooltip: TooltipView,
  validation: ValidationView,
};
const preset = selectOfficialPreset('reactive-md/navigation', Object.keys(views));

export default mountOfficialPreset(preset, views);
