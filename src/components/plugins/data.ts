import { ColumnView } from '../layout/layout';
import { DataTableView } from '../table/data-table';
import { TableView, TimelineView } from '../shared/visuals';
import { selectOfficialPreset } from '../../presets/plugin-packs';
import { mountOfficialPreset } from '../mount-preset';
import visualsCss from '../shared/visuals.css?inline';

const views = {
  column: ColumnView,
  'data-table': DataTableView,
  table: TableView,
  timeline: TimelineView,
};
const preset = selectOfficialPreset('reactive-md/data', Object.keys(views));

export default mountOfficialPreset(preset, views, [
  { id: 'reactive-md/visuals.css', css: visualsCss },
]);
