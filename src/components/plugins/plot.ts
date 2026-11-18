import { CoordinateView } from '../plot/coordinate';
import { PlotView } from '../shared/visuals';
import { selectOfficialPreset } from '../../presets/plugin-packs';
import { mountOfficialPreset } from '../mount-preset';
import visualsCss from '../shared/visuals.css?inline';
import mafsCoreCss from 'mafs/core.css?inline';
import mafsCss from '../plot/mafs.css?inline';

const views = {
  coordinate: CoordinateView,
  plot: PlotView,
};
const preset = selectOfficialPreset('reactive-md/plot', Object.keys(views));

export default mountOfficialPreset(preset, views, [
  { id: 'reactive-md/visuals.css', css: visualsCss },
  { id: 'reactive-md/mafs-core.css', css: `@layer rmd.reset { ${mafsCoreCss} }` },
  { id: 'reactive-md/mafs.css', css: mafsCss },
]);
