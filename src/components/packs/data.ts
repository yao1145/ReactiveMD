import { dataPack } from '../../presets/packs';
import { ColumnView } from '../layout/structural-views';
import { DataTableView } from '../table/data-table';
import { TableView, TimelineView } from '../shared/data-visuals';
import { mountOfficialPreset } from '../mount-preset';
import visualBaseCss from 'virtual:rmd-visual-styles/shared';
import dataCss from 'virtual:rmd-visual-styles/data';

export const dataReactPack = mountOfficialPreset(dataPack, {
  column: ColumnView, 'data-table': DataTableView, table: TableView, timeline: TimelineView,
}, [
  { id: 'reactive-md/visual-base.css', css: visualBaseCss },
  { id: 'reactive-md/data-visuals.css', css: dataCss },
]);
export default dataReactPack;
