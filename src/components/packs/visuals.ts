import { visualsPack } from '../../presets/packs';
import { EdgeView } from '../layout/structural-views';
import { ChartView, DiagramView, NodeView, PlotView } from '../shared/visuals';
import { mountOfficialPreset } from '../mount-preset';
import visualBaseCss from 'virtual:rmd-visual-styles/shared';
import graphicsCss from 'virtual:rmd-visual-styles/visuals';
import chartCss from '../chart/chart.css?inline';
import diagramCss from '../diagram/diagram.css?inline';
import mafsCoreCss from 'mafs/core.css?inline';
import mafsCss from '../plot/mafs.css?inline';

export const visualsReactPack = mountOfficialPreset(visualsPack, {
  chart: ChartView, plot: PlotView, diagram: DiagramView, node: NodeView, edge: EdgeView,
}, [
  { id: 'reactive-md/visual-base.css', css: visualBaseCss },
  { id: 'reactive-md/graphics.css', css: graphicsCss },
  { id: 'reactive-md/chart.css', css: chartCss },
  { id: 'reactive-md/diagram.css', css: diagramCss },
  { id: 'reactive-md/mafs-core.css', css: `@layer rmd.reset { ${mafsCoreCss} }` },
  { id: 'reactive-md/mafs.css', css: mafsCss },
]);
export default visualsReactPack;
