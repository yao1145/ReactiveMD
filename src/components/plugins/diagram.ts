import { EdgeView } from '../layout/layout';
import { DiagramView, NodeView } from '../shared/visuals';
import { selectOfficialPreset } from '../../presets/plugin-packs';
import { mountOfficialPreset } from '../mount-preset';
import visualsCss from '../shared/visuals.css?inline';
import diagramCss from '../diagram/diagram.css?inline';

const views = {
  edge: EdgeView,
  diagram: DiagramView,
  node: NodeView,
};
const preset = selectOfficialPreset('reactive-md/diagram', Object.keys(views));

export default mountOfficialPreset(preset, views, [
  { id: 'reactive-md/visuals.css', css: visualsCss },
  { id: 'reactive-md/diagram.css', css: diagramCss },
]);
