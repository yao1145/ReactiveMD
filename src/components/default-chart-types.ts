/** Private view contract; compilation, validation and selection writes stay in ChartView. */
export interface DefaultChartRow {
  index: number;
  label: string;
  xValue: number | null;
  values: (number | null)[];
  keyValue: string;
}

export interface DefaultChartProps {
  kind: 'bar' | 'line' | 'area' | 'scatter' | 'donut' | 'pie';
  title: string;
  xLabel: string;
  yLabel: string;
  rows: readonly DefaultChartRow[];
  seriesNames: readonly string[];
  numericX: boolean;
  selectionEnabled: boolean;
  selectedRowKey: string;
  onSelect(key: string): void;
  resetToken: number;
  t(en: string, zh: string): string;
}
