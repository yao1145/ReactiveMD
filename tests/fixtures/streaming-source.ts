import type { LocalCompileOptions } from '../../src/local/types';

/**
 * One deterministic streaming generation round. Snapshots are complete
 * sources delivered in order; `finalSource` is the fully generated source.
 * Streaming compilation must stabilize every snapshot without losing the
 * renderable prefix, and the completed source must compile exactly like the
 * historical final path.
 */
export interface StreamingSourceCase {
  readonly name: string;
  readonly snapshots: readonly string[];
  readonly finalSource: string;
  readonly options?: LocalCompileOptions;
  /** Expected streaming status for every snapshot in this round. */
  readonly expected: 'partial' | 'failed';
  /** Codes that must show up in `transientDiagnostics` across the round. */
  readonly transientCodes?: readonly string[];
  /** Codes expected from the completed source's final compile. */
  readonly finalCodes?: readonly string[];
  /** The completed source is a loose-mode recovery rather than a clean parse. */
  readonly recovers?: boolean;
}

export const STREAMING_SOURCE_CASES: readonly StreamingSourceCase[] = [
  {
    name: 'mid-word truncation',
    snapshots: [
      'A senten',
      'A sentence that gro',
      'A sentence that grows',
    ],
    finalSource: 'A sentence that grows **bolder** with every chunk.',
    expected: 'partial',
  },
  {
    name: 'unclosed code fence',
    snapshots: [
      'Intro\n\n```ts\nconst answer = 42',
      'Intro\n\n```ts\nconst answer = 42\n```',
    ],
    finalSource: 'Intro\n\n```ts\nconst answer = 42\n```\n\nAfter the fence.',
    expected: 'partial',
  },
  {
    name: 'unclosed link and emphasis',
    snapshots: [
      'Read [the guide',
      'Read [the guide](https://example.com/docs) and **important',
    ],
    finalSource: 'Read [the guide](https://example.com/docs) and **important notes**.',
    expected: 'partial',
  },
  {
    name: 'component tag without closing bracket',
    snapshots: [
      '# Notes\n\n<card title="Streamed"',
      '# Notes\n\n<card title="Streamed">\n\nBody',
    ],
    finalSource: '# Notes\n\n<card title="Streamed">\n\nBody\n\n</card>',
    expected: 'partial',
    transientCodes: ['local.tag.unclosed'],
  },
  {
    name: 'attribute quote truncation',
    snapshots: [
      '<slider bind="volume" label="Vol',
      '<slider bind="volume" label="Volume">',
    ],
    finalSource: '<slider bind="volume" label="Volume">',
    expected: 'partial',
    transientCodes: ['local.tag.unclosed'],
  },
  {
    name: 'interpolation without close',
    snapshots: [
      'Total: {{ 1 +',
      'Total: {{ 1 + 2 }}',
    ],
    finalSource: 'Total: {{ 1 + 2 }}',
    expected: 'partial',
    transientCodes: ['local.interpolation'],
  },
  {
    name: 'unclosed display math',
    snapshots: [
      'Formula:\n\n$$x + y',
      'Formula:\n\n$$x + y$$',
    ],
    finalSource: 'Formula:\n\n$$x + y$$\n\nDone.',
    expected: 'partial',
    transientCodes: ['local.math.unclosed'],
  },
  {
    name: 'unclosed inline math',
    snapshots: [
      'Inline \\(a + b',
      'Inline \\(a + b\\)',
    ],
    finalSource: 'Inline \\(a + b\\) complete.',
    expected: 'partial',
    transientCodes: ['local.math.unclosed'],
  },
  {
    name: 'declaration not yet arrived',
    snapshots: [
      'Current total: {{ total }}',
      '<number bind="total" label="Total">\n\nCurrent total: {{ total }}',
    ],
    finalSource: '<number bind="total" label="Total">\n\nCurrent total: {{ total }}',
    expected: 'partial',
    transientCodes: ['local.binding.unknown'],
  },
  {
    name: 'unclosed paired component',
    snapshots: [
      '<panel>\n\nBody **text**',
      '<panel>\n\nBody **text**\n\n</panel>',
    ],
    finalSource: '<panel>\n\nBody **text**\n\n</panel>',
    expected: 'partial',
    transientCodes: ['local.tag.unclosed'],
  },
  {
    name: 'mismatched closing tag',
    snapshots: [
      '<panel title="P">\n\n<card>\n\nBody\n\n</panel>',
      '<panel title="P">\n\n<card>\n\nBody\n\n</card>\n\n</panel>',
    ],
    finalSource: '<panel title="P">\n\n<card>\n\nBody\n\n</card>\n\n</panel>',
    expected: 'partial',
    transientCodes: ['local.tag.mismatch'],
  },
  {
    name: 'genuinely final option error',
    snapshots: [
      'hello',
    ],
    finalSource: 'hello',
    options: { limits: { maxSyntaxNodes: 1 } },
    expected: 'failed',
    finalCodes: ['local.budget'],
  },
  {
    name: 'genuinely final config error',
    snapshots: [
      'hello',
    ],
    finalSource: 'hello',
    options: { config: 'not-a-config' } as unknown as LocalCompileOptions,
    expected: 'failed',
    finalCodes: ['local.options.invalid'],
  },
  {
    name: 'loose-mode recovery',
    snapshots: [
      '<card>\n正文\n\n## 后续\n\n后文 **粗体**',
    ],
    finalSource: '<card>\n正文\n\n## 后续\n\n后文 **粗体**',
    options: { strict: false },
    expected: 'partial',
    finalCodes: ['local.recovery.unclosed'],
    recovers: true,
  },
];

export const STREAMING_SOURCE_CASE_NAMES = STREAMING_SOURCE_CASES.map(sourceCase => sourceCase.name);