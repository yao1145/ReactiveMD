import type {
  LocalComponentRender,
  LocalReactComponent,
  LocalReactPreset,
} from '../react/component-api';
import { defineReactComponent } from '../react/component-api';
import { getLocalComponentRegistry } from '../sdk/registry';
import defaultPreset from '../presets/default';
import {
  CheckboxView,
  ChoicesView,
  ChecklistView,
  CoordinateView,
  CounterView,
  DateView,
  InputView,
  MultiSelectView,
  NumberView,
  ProgressView,
  QuizView,
  RadioGroupView,
  RangeSliderView,
  SelectView,
  SliderView,
  TextareaView,
  TimerView,
  ToggleView,
} from './controls';
import {
  AccordionView,
  AlertView,
  AnchorView,
  BadgeView,
  CardView,
  ColumnView,
  DisclosureView,
  EdgeView,
  GridView,
  IfView,
  JumpView,
  OptionView,
  PanelView,
  SectionView,
  StepView,
  StepsView,
  TabView,
  TabsView,
  TextView,
  TooltipView,
  ValidationView,
} from './layout';
import { DataTableView } from './data-table';
import {
  ChartView,
  DiagramView,
  NodeView,
  PlotView,
  TableView,
  TimelineView,
} from './visuals';

function NullView() {
  return null;
}

/** Public implementation table for the builtin preset, keyed by tag name. */
export const DEFAULT_COMPONENT_VIEWS: Readonly<Record<string, LocalComponentRender>> = Object.freeze({
  input: InputView,
  textarea: TextareaView,
  number: NumberView,
  slider: SliderView,
  'range-slider': RangeSliderView,
  coordinate: CoordinateView,
  toggle: ToggleView,
  checkbox: CheckboxView,
  date: DateView,
  select: SelectView,
  choices: ChoicesView,
  'radio-group': RadioGroupView,
  'multi-select': MultiSelectView,
  option: OptionView,
  counter: CounterView,
  timer: TimerView,
  checklist: ChecklistView,
  progress: ProgressView,
  jump: JumpView,
  anchor: AnchorView,
  text: TextView,
  section: SectionView,
  quiz: QuizView,
  panel: PanelView,
  card: CardView,
  grid: GridView,
  tabs: TabsView,
  tab: TabView,
  steps: StepsView,
  step: StepView,
  accordion: AccordionView,
  disclosure: DisclosureView,
  if: IfView,
  alert: AlertView,
  badge: BadgeView,
  tooltip: TooltipView,
  validation: ValidationView,
  'data-table': DataTableView,
  column: ColumnView,
  table: TableView,
  chart: ChartView,
  plot: PlotView,
  timeline: TimelineView,
  diagram: DiagramView,
  node: NodeView,
  edge: EdgeView,
  computed: NullView,
  const: NullView,
  external: NullView,
});

let cached: LocalReactPreset | null = null;

/**
 * Assemble the builtin React preset from the same public manifests the kernel
 * uses. Every builtin is bound with `defineReactComponent`; there is no
 * separate dispatch table or private default callback.
 */
export function createDefaultReactPreset(): LocalReactPreset {
  if (cached) return cached;
  const components: LocalReactComponent[] = [];
  for (const definition of getLocalComponentRegistry()) {
    const implementation = DEFAULT_COMPONENT_VIEWS[definition.name];
    if (!implementation) {
      throw new Error(
        `Default React preset has no implementation for builtin component <${definition.name}>.`,
      );
    }
    components.push(defineReactComponent(definition, { render: implementation }));
  }
  cached = Object.freeze({
    id: defaultPreset.id,
    version: defaultPreset.version,
    components: Object.freeze(components),
  });
  return cached;
}

export const defaultReactPreset: LocalReactPreset = createDefaultReactPreset();
