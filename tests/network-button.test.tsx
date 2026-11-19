import { describe, expect, it, vi } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { minimalReactPresetPackage } from '../src/components/minimal-preset';
import network from '../src/components/plugins/network';
import { parseSubmissionFields, submitButtonDefinition } from '../src/components/network/submit-button';
import { createReactHost } from '../src/react/package';
import { renderLocalStaticDocument } from '../src/react/server';

function compileWithNetwork(source: string) {
  const host = createReactHost({ presets: [minimalReactPresetPackage, network] });
  const result = compileLocal(source, host.compileOptions);
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  return { document: result.document, host };
}

describe('official submit button', () => {
  it('parses a non-empty, duplicate-free public field list', () => {
    expect(parseSubmissionFields('choice comment')).toEqual(['choice', 'comment']);
    expect(parseSubmissionFields('  choice\tcomment ')).toEqual(['choice', 'comment']);
    expect(parseSubmissionFields('')).toBeNull();
    expect(parseSubmissionFields('   ')).toBeNull();
    expect(parseSubmissionFields('choice choice')).toBeNull();
    expect(parseSubmissionFields('choice,comment')).toBeNull();
    expect(parseSubmissionFields(undefined)).toBeNull();
  });

  it('declares a static channel and field list on a leaf manifest', () => {
    expect(submitButtonDefinition.name).toBe('submit-button');
    expect(submitButtonDefinition.form).toBe('leaf');
    expect(submitButtonDefinition.props.channel).toMatchObject({ kind: 'string', static: true, required: true });
    expect(submitButtonDefinition.props.fields).toMatchObject({ kind: 'string', static: true, required: true });
    expect(submitButtonDefinition.props.label).toMatchObject({ kind: 'string' });
    expect(submitButtonDefinition.props.label?.required).toBeUndefined();
  });

  it('rejects a missing or empty channel and field list', () => {
    const { host } = compileWithNetwork('<submit-button channel="answers" fields="choice">');
    const missingFields = compileLocal('<submit-button channel="answers">', host.compileOptions);
    expect(missingFields.ok).toBe(false);
    expect(missingFields.diagnostics.map((item) => item.code)).toContain('local.attribute.required');
    const empty = compileLocal('<submit-button channel="" fields="">', host.compileOptions);
    expect(empty.ok).toBe(false);
    expect(empty.diagnostics.map((item) => item.code)).toContain('local.constraint');
  });

  it('renders a non-interactive representation in static export', () => {
    const { document, host } = compileWithNetwork(
      '<submit-button channel="answers" fields="choice" label="Send">\n\nAfter',
    );
    const runtime = createLocalRuntime(document);
    try {
      const rendered = renderLocalStaticDocument({
        document,
        runtime,
        reactConfig: host.reactConfig,
      });
      if (!rendered.ok) throw new Error(rendered.diagnostics.map((item) => item.message).join('; '));
      expect(rendered.markup).toContain('data-rmd-static-submit');
      expect(rendered.markup).toContain('Send');
      expect(rendered.markup).not.toContain('md-button-primary');
      expect(rendered.markup).not.toContain('data-rmd-component="submit-button"');
    } finally {
      runtime.dispose();
    }
  });

  it('never requests during static rendering even with a live channel', () => {
    const send = vi.fn(() => ({ ok: true } as const));
    const { document, host } = compileWithNetwork(
      '<submit-button channel="answers" fields="choice" label="Send">',
    );
    const runtime = createLocalRuntime(document, {
      network: { channels: { answers: { submit: { validate: () => true, send } } } },
    });
    try {
      renderLocalStaticDocument({ document, runtime, reactConfig: host.reactConfig });
      expect(send).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
    }
  });

  it('stays out of the minimal presets', () => {
    expect(minimalReactPresetPackage.preset.components.map((item) => item.name))
      .not.toContain('submit-button');
  });
});
