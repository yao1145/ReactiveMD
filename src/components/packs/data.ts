import { dataPack } from '../../presets/packs';
import { ColumnView } from '../layout/structural-views';
import { DataTableView } from '../table/data-table';
import { TableView, TimelineView } from '../shared/data-visuals';
import { mountOfficialPreset } from '../mount-preset';
import visualsCss from '../shared/visuals.css?inline';

export const dataReactPack = mountOfficialPreset(dataPack, {
  column: ColumnView, 'data-table': DataTableView, table: TableView, timeline: TimelineView,
}, [{ id: 'reactive-md/visuals.css', css: visualsCss }]);
export default dataReactPack;
