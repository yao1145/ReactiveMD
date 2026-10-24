import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import type {
  Diagnostic,
  LocalDocument,
  LocalNode,
  LocalRuntime,
  LocalValidation,
} from '../src/local/types';

/* ------------------------------------------------------------- fixtures */

const controlId = 'control-1';
const validationId = 'validation-1';

function numberControl(rangeStart = 0): LocalNode {
  return {
    type: 'component',
    id: controlId,
    name: 'number',
    range: { start: rangeStart, end: rangeStart + 10 },
    attrs: { bind: 'a', label: 'Amount', initial: '0' },
  };
}

function ruleNode(rangeStart: number, fields: string, message: string): LocalNode {
  return {
    type: 'component',
    id: validationId,
    name: 'validation',
    range: { start: rangeStart, end: rangeStart + 20 },
    attrs: { when: '{{ a > 0 }}', message, fields },
  };
}

function validationDocument(options: {
  fields?: string[];
  message?: string;
  nodes?: LocalNode[];
  validations?: LocalValidation[];
} = {}): LocalDocument {
  const range = { start: 40, end: 60 };
  return {
    syntax: 'local',
    source: '',
    initialState: { a: 0 },
    bindings: {
      a: { name: 'a', nodeIds: [controlId], type: 'number', initial: 0 },
    },
    nodes: options.nodes ?? [numberControl(), ruleNode(range.start, 'a', 'Amount must be positive')],
    validations: options.validations ?? [
      {
        nodeId: validationId,
        expression: 'a > 0',
        dependencies: ['a'],
        message: options.message ?? 'Amount must be positive',
        fields: options.fields ?? ['a'],
        range,
      },
    ],
  };
}

function diagnostic(code: string, range: { start: number; end: number }, message: string): Diagnostic {
  return { code, message, severity: 'error', range, line: 1, column: 1 };
}

function render(document: LocalDocument, validate: () => Diagnostic[]): string {
  const runtime = createLocalRuntime(document);
  runtime.validate = validate;
  try {
    return renderToStaticMarkup(<LocalDocumentView document={document} runtime={runtime} />);
  } finally {
    runtime.dispose();
  }
}

function validationHintId(html: string): string {
  const match = /<span[^>]*class="local-validation-hint"[^>]*>/.exec(html);
  if (!match) throw new Error(`Missing validation hint in ${html}`);
  const id = /\bid="([^"]+)"/.exec(match[0]);
  if (!id) throw new Error(`Missing validation hint id in ${match[0]}`);
  return id[1];
}

function hintTag(html: string): string {
  const match = /<span[^>]*class="local-validation-hint"[^>]*>/.exec(html);
  if (!match) throw new Error(`Missing validation hint tag in ${html}`);
  return match[0];
}

/* ------------------------------------------------------------ validation */

describe('validation hints', () => {
  it('announces a failed rule and associates its fields with a unique id', () => {
    const document = validationDocument();
    const rule = document.validations![0];
    const html = render(document, () => [
      diagnostic('local.validation.failed', rule.range, rule.message),
    ]);
    const id = validationHintId(html);

    expect(html).toContain('Amount must be positive');
    expect(hintTag(html)).toContain('role="status"');
    expect(hintTag(html)).toContain('aria-live="polite"');
    expect(html).toContain(`aria-describedby="${id}"`);
    expect(html).toContain('aria-invalid="true"');
  });

  it('keeps an empty hint span with its id when the rule passes', () => {
    const html = render(validationDocument(), () => []);
    const id = validationHintId(html);

    expect(hintTag(html)).not.toContain('role="status"');
    expect(hintTag(html)).not.toContain('aria-live');
    expect(html).not.toContain('Amount must be positive');
    expect(html).not.toContain(`aria-describedby="${id}"`);
    expect(html).not.toContain('aria-invalid="true"');
  });

  it('shows a visible error when the rule expression cannot be evaluated', () => {
    const document = validationDocument();
    const rule = document.validations![0];
    const html = render(document, () => [
      diagnostic('local.validation.expression', rule.range, 'Division by zero.'),
    ]);

    expect(html).toContain('This rule cannot be evaluated');
    expect(html).toContain('Division by zero.');
    expect(html).toContain('aria-invalid="true"');
    expect(hintTag(html)).toContain('role="status"');
  });

  it('does not announce a hint inside hidden content but keeps the rule association', () => {
    const range = { start: 60, end: 80 };
    const ifNode: LocalNode = {
      type: 'component',
      id: 'if-1',
      name: 'if',
      range: { start: 0, end: 9 },
      attrs: { when: '{{ show }}' },
      children: [numberControl(10), ruleNode(range.start, 'a', 'Amount must be positive')],
    };
    const document: LocalDocument = {
      syntax: 'local',
      source: '',
      initialState: { show: false, a: 0 },
      bindings: {
        show: { name: 'show', nodeIds: [], type: 'boolean', initial: false },
        a: { name: 'a', nodeIds: [controlId], type: 'number', initial: 0 },
      },
      nodes: [ifNode],
      validations: [
        {
          nodeId: validationId,
          expression: 'a > 0',
          dependencies: ['a'],
          message: 'Amount must be positive',
          fields: ['a'],
          range,
        },
      ],
    };
    const html = render(document, () => [
      diagnostic('local.validation.failed', range, 'Amount must be positive'),
    ]);

    // The association survives so the rule remains active while hidden.
    expect(html).toContain('aria-invalid="true"');
    expect(hintTag(html)).not.toContain('role="status"');
    expect(hintTag(html)).not.toContain('aria-live');
  });

  it('scopes hint ids to each document instance', () => {
    const document = validationDocument();
    const rule = document.validations![0];
    const runtime = createLocalRuntime(document);
    runtime.validate = () => [
      diagnostic('local.validation.failed', rule.range, rule.message),
    ];
    try {
      const html = renderToStaticMarkup(
        <>
          <LocalDocumentView document={document} runtime={runtime} />
          <LocalDocumentView document={document} runtime={runtime} />
        </>,
      );
      const tags = html.match(/<span[^>]*class="local-validation-hint"[^>]*>/g) ?? [];
      const ids = tags.map((tag) => /\bid="([^"]+)"/.exec(tag)?.[1] ?? '');
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    } finally {
      runtime.dispose();
    }
  });
});

/* ------------------------------------------------------------------ tone */

function toneDocument(
  name: 'badge' | 'alert',
  tone: string,
  bindings: LocalDocument['bindings'] = {},
): LocalDocument {
  return {
    syntax: 'local',
    source: '',
    initialState: {},
    bindings,
    nodes: [
      {
        type: 'component',
        id: `${name}-1`,
        name,
        range: { start: 0, end: 9 },
        attrs: { tone },
        children: [{ type: 'text', id: `${name}-text`, range: { start: 10, end: 14 }, value: 'Status' }],
      },
    ],
  };
}

function renderTone(document: LocalDocument, runtime?: LocalRuntime): string {
  const active = runtime ?? createLocalRuntime(document);
  try {
    return renderToStaticMarkup(<LocalDocumentView document={document} runtime={active} />);
  } finally {
    if (!runtime) active.dispose();
  }
}

function booleanBinding(initial: boolean): LocalDocument['bindings'] {
  return { flag: { name: 'flag', nodeIds: [], type: 'boolean', initial } };
}

function numberBinding(initial: number): LocalDocument['bindings'] {
  return { n: { name: 'n', nodeIds: [], type: 'number', initial } };
}

describe('controlled tone', () => {
  it('keeps the original static tones and their roles', () => {
    const badge = renderTone(toneDocument('badge', 'success'));
    expect(badge).toContain('md-badge-success');
    expect(badge).not.toContain('local-tone-error');

    const alert = renderTone(toneDocument('alert', 'warning'));
    expect(alert).toContain('local-alert-warning');
    expect(alert).toContain('role="alert"');
  });

  it('follows a dynamic expression between allowed enum values', () => {
    const warning = renderTone(
      toneDocument('badge', "{{ flag ? 'success' : 'warning' }}", booleanBinding(false)),
    );
    expect(warning).toContain('md-badge-warning');
    expect(warning).not.toContain('local-tone-error');

    const success = renderTone(
      toneDocument('badge', "{{ flag ? 'success' : 'warning' }}", booleanBinding(true)),
    );
    expect(success).toContain('md-badge-success');
    expect(success).not.toContain('local-tone-error');
  });

  it('falls back visibly for an out-of-enum dynamic value without injecting classes', () => {
    const html = renderTone(
      toneDocument('badge', "{{ n > 0 ? 'success' : 'danger' }}", numberBinding(0)),
    );
    expect(html).toContain('md-badge-neutral');
    expect(html).toContain('local-tone-error');
    expect(html).toContain('Invalid tone; using the default style');
    expect(html).not.toContain('danger');
  });

  it('falls back visibly when the tone expression fails', () => {
    const html = renderTone(toneDocument('alert', '{{ 1 / n }}', numberBinding(0)));
    expect(html).toContain('local-alert-info');
    expect(html).toContain('local-tone-error');
    expect(html).not.toContain('local-alert-success');
  });

  it('leaves an invalid static tone on the original silent fallback', () => {
    const html = renderTone(toneDocument('badge', 'danger'));
    expect(html).toContain('md-badge-neutral');
    expect(html).not.toContain('local-tone-error');
    expect(html).not.toContain('danger');
  });
});
