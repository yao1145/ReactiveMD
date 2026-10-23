import comparisonSource from '../../examples/local/comparison.reactive.md?raw';
import parametersSource from '../../examples/local/parameters.reactive.md?raw';
import checklistSource from '../../examples/local/checklist.reactive.md?raw';
import chartsSource from '../../examples/local/charts.reactive.md?raw';
import diagramSource from '../../examples/local/diagram.reactive.md?raw';
import catalogSource from '../../examples/local/catalog.reactive.md?raw';
import planningSource from '../../examples/local/planning.reactive.md?raw';
import componentsSource from '../../examples/local/components.reactive.md?raw';
import pricingSource from '../../examples/local/pricing.reactive.md?raw';
import counterSource from '../../examples/local/counter.reactive.md?raw';
import gallerySource from '../../examples/local/gallery.reactive.md?raw';
import diagnosticsSource from '../../examples/local/diagnostics.reactive.md?raw';

export interface PlaygroundExample {
  id: string;
  title: string;
  hint: string;
  source: string;
}

/** All playground documents use the explicit local-draft-1 syntax. */
export const EXAMPLES: PlaygroundExample[] = [
  { id: 'comparison', title: 'Side-by-side comparison and layout', hint: 'Grids, tabs and collapsible content', source: comparisonSource },
  { id: 'parameters', title: 'Forms and parameter panels', hint: 'Live parameters, text binding and conditional checklists', source: parametersSource },
  { id: 'checklist', title: 'Checklists and data tables', hint: 'Lists, progress, search, sorting and paging', source: checklistSource },
  { id: 'charts', title: 'Charts and savings curves', hint: 'Table charts, donut shares and LaTeX plots', source: chartsSource },
  { id: 'diagram', title: 'Interactive diagrams', hint: 'Node selection and parameter curves', source: diagramSource },
  { id: 'catalog', title: 'Local component catalog', hint: 'Local search, sorting and paging', source: catalogSource },
  { id: 'planning', title: 'Planning, timing and bill splitting', hint: 'Timelines, timers and live bill splitting', source: planningSource },
  { id: 'components', title: 'Content and helper components', hint: 'Tooltips, choices, disclosures and content structure', source: componentsSource },
  { id: 'pricing', title: 'Plan calculator', hint: 'Headcount, annual discount and live totals', source: pricingSource },
  { id: 'counter', title: 'Counter', hint: 'Smallest local state example', source: counterSource },
  { id: 'gallery', title: 'Common component gallery', hint: 'Inputs, standalone components and code as-is', source: gallerySource },
  { id: 'diagnostics', title: 'Diagnostics example', hint: 'Intentionally broken source', source: diagnosticsSource },
];

export const DEFAULT_EXAMPLE_ID = 'pricing';
