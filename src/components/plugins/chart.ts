import { ChartView } from '../shared/visuals';
import { selectOfficialPreset } from '../../presets/plugin-packs';
import { mountOfficialPreset } from '../mount-preset';
import visualsCss from '../shared/visuals.css?inline';
import chartCss from '../chart/chart.css?inline';

const views = {
  chart: ChartView,
};
const preset = selectOfficialPreset('reactive-md/chart', Object.keys(views));

export default mountOfficialPreset(preset, views, [
  { id: 'reactive-md/visuals.css', css: visualsCss },
  { id: 'reactive-md/chart.css', css: chartCss },
]);
