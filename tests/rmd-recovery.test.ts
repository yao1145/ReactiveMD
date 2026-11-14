import { describe, expect, it } from 'vitest';
import { parseLocal, type ParsedLocal } from '../src/local/parsing/parser';
import { formatLocalDiagnostic } from '../src/local/configuration/diagnostics';
import type { Diagnostic, LocalNode } from '../src/local/contracts/types';

const flat = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap((node) => [node, ...flat(node.children ?? [])]);
const loose = { strict: false } as const;

/** Recovery codes that must surface as warning diagnostics in loose mode. */
const RECOVERY_WARNING_CODES = new Set([
  'local.recovery.unclosed',
  'local.recovery.mismatch',
  'local.recovery.stray-close',
  'local.html.repair',
  'local.html.literal',
]);

const recoveryKey = (code: string, range: { start: number; end: number }): string => `${code}@${range.start}-${range.end}`;

function recoveryWarnings(parsed: ParsedLocal): Diagnostic[] {
  return parsed.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'warning' && RECOVERY_WARNING_CODES.has(diagnostic.code),
  );
}

/**
 * Assert the exact one-warning-per-finalized-recovery contract: no recovery is
 * silent, no recovery warns twice, and every warning points at its cause range
 * with a registered, localized message.
 */
function expectRecoveryWarnings(parsed: ParsedLocal): Diagnostic[] {
  const recoveries = parsed.recoveries ?? [];
  const identities = new Set(recoveries.map((recovery) => [
    recoveryKey(recovery.code, recovery.causeRange),
    recovery.affectedRange.start,
    recovery.affectedRange.end,
    recovery.boundary,
  ].join(':')));
  const recoveryKeys = new Set(recoveries.map((recovery) => recoveryKey(recovery.code, recovery.causeRange)));
  const warnings = recoveryWarnings(parsed);
  expect(warnings).toHaveLength(identities.size);
  for (const warning of warnings) {
    expect(recoveryKeys.has(recoveryKey(warning.code, warning.range))).toBe(true);
    expect(warning.messageKey).toBeTypeOf('string');
    expect(warning.messageKey!.length).toBeGreaterThan(0);
    const zh = formatLocalDiagnostic(warning, 'zh');
    expect(zh).toMatch(/[㐀-鿿]/);
    expect(zh).not.toBe(warning.message);
  }
  return warnings;
}

describe('loose RMD structure recovery', () => {
  it.each(['pre', 'code', 'script', 'style', 'xmp'])('keeps an unclosed raw HTML %s region opaque across blank lines', tag => {
    const source = `<${tag}>\nliteral\n\n## Still raw\n\n<counter bind="hidden" label="Hidden" initial="1">`;
    const parsed = parseLocal(source, loose);
    expect(parsed.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(false);
    const nodes = flat(parsed.nodes);
    expect(nodes.some(item => item.name === 'counter')).toBe(false);
    expect(nodes.some(item => item.type === 'heading')).toBe(false);
    expect(parsed.recoveries?.length).toBeGreaterThan(0);
    expect(expectRecoveryWarnings(parsed).length).toBeGreaterThan(0);
  });

  it('charges unmatched closing-tag searches against the work budget', () => {
    const source = '<card>\n'.repeat(1000) + '</unknown>\n'.repeat(1000);
    const parsed = parseLocal(source, { strict: false, limits: { maxParseWork: source.length * 12 } });
    expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'local.budget' && diagnostic.severity === 'error')).toBe(true);
    expect(parsed.nodes).toEqual([]);
    expect(parsed.recoveries).toBeUndefined();
    expect(recoveryWarnings(parsed)).toEqual([]);
  });

  it('resynchronizes an unclosed container at a later ATX heading', () => {
    const source = '前文\n\n<card>\n片段 {{ hidden }}\n\n## 后续\n\n后文 **粗体**';
    const parsed = parseLocal(source, loose);

    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].code).toBe('local.recovery.unclosed');
    expect(parsed.recoveries?.[0].boundary).toBe('heading');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({
      start: source.indexOf('<card>'),
      end: source.indexOf('## 后续'),
    });
    const warnings = expectRecoveryWarnings(parsed);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'local.recovery.unclosed',
      severity: 'warning',
      range: { start: source.indexOf('<card>'), end: source.indexOf('<card>') + '<card>'.length },
    });
    expect(warnings[0].line).toBe(3);
    expect(warnings[0].column).toBe(1);

    const all = flat(parsed.nodes);
    expect(all.some((node) => node.name === 'card')).toBe(false);
    expect(all.some((node) => node.type === 'interpolation')).toBe(false);
    expect(all.find((node) => node.type === 'heading')?.depth).toBe(2);
    expect(all.some((node) => node.type === 'strong')).toBe(true);
  });

  it('resynchronizes at a root heading after a list that the blank line closed', () => {
    const source = '<alert>\nx\n\n- item\n\n## real\n\nok';
    const parsed = parseLocal(source, loose);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].boundary).toBe('heading');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({ start: 0, end: source.indexOf('## real') });
    expect(flat(parsed.nodes).find((node) => node.type === 'heading')?.depth).toBe(2);
  });

  it('keeps a legally paired container that spans headings', () => {
    const source = '<card>\n\n## 内部\n\n正文\n\n</card>\n\n后文';
    const parsed = parseLocal(source, loose);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.recoveries).toBeUndefined();
    expect(expectRecoveryWarnings(parsed)).toEqual([]);
    const card = parsed.nodes.find((node) => node.name === 'card');
    expect(card).toBeTruthy();
    expect(flat(card?.children ?? []).find((node) => node.type === 'heading')?.depth).toBe(2);
  });

  it('uses an outer closing tag to rescue the outer container', () => {
    const source = '<card>\n<alert>\n内文\n</card>';
    const parsed = parseLocal(source, loose);

    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].code).toBe('local.recovery.mismatch');
    expect(parsed.recoveries?.[0].boundary).toBe('container-end');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({
      start: source.indexOf('<alert>'),
      end: source.indexOf('</card>'),
    });
    const warnings = expectRecoveryWarnings(parsed);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'local.recovery.mismatch',
      severity: 'warning',
      range: { start: source.indexOf('<alert>'), end: source.indexOf('<alert>') + '<alert>'.length },
    });

    const all = flat(parsed.nodes);
    expect(all.find((node) => node.name === 'card')).toBeTruthy();
    expect(all.some((node) => node.name === 'alert')).toBe(false);
  });

  it('degrades only an isolated closing tag', () => {
    const source = '前文\n\n</alert>\n\n后文';
    const parsed = parseLocal(source, loose);

    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].code).toBe('local.recovery.stray-close');
    expect(parsed.recoveries?.[0].boundary).toBe('token');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({
      start: source.indexOf('</alert>'),
      end: source.indexOf('</alert>') + '</alert>'.length,
    });
    const warnings = expectRecoveryWarnings(parsed);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'local.recovery.stray-close',
      severity: 'warning',
      range: { start: source.indexOf('</alert>'), end: source.indexOf('</alert>') + '</alert>'.length },
    });
    expect(flat(parsed.nodes).some((node) => node.type === 'fallback')).toBe(true);
  });

  it('does not resynchronize at a heading inside fenced code or a comment', () => {
    const fenced = '<card>\n```md\n## 代码标题\n```\n\n正文';
    const parsedFence = parseLocal(fenced, loose);
    expect(parsedFence.recoveries?.[0].code).toBe('local.recovery.unclosed');
    expect(parsedFence.recoveries?.[0].boundary).toBe('eof');
    expect(parsedFence.recoveries?.[0].affectedRange.end).toBe(fenced.length);
    expect(flat(parsedFence.nodes).some((node) => node.type === 'heading')).toBe(false);
    expect(expectRecoveryWarnings(parsedFence)).toHaveLength(1);

    const commented = '<card>\n<!--\n## 注释标题\n-->\n\n正文';
    const parsedComment = parseLocal(commented, loose);
    expect(parsedComment.recoveries?.[0].code).toBe('local.recovery.unclosed');
    expect(parsedComment.recoveries?.[0].boundary).toBe('eof');
    expect(parsedComment.recoveries?.[0].affectedRange.end).toBe(commented.length);
    expect(expectRecoveryWarnings(parsedComment)).toHaveLength(1);
  });

  it('uses the conservative boundary when the opening tag is lexically incomplete', () => {
    const source = '<card title="never\n## 标题';
    const parsed = parseLocal(source, loose);

    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].code).toBe('local.recovery.unclosed');
    expect(parsed.recoveries?.[0].boundary).toBe('eof');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({ start: 0, end: source.length });
    expect(flat(parsed.nodes).some((node) => node.type === 'heading')).toBe(false);
    const warnings = expectRecoveryWarnings(parsed);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].range).toEqual(parsed.recoveries?.[0].causeRange);
  });

  it('recovers an unknown line-leading tag but keeps inline prose lazy', () => {
    const unclosed = '<widget>\n内容\n\n## 后续';
    const parsed = parseLocal(unclosed, loose);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].code).toBe('local.recovery.unclosed');
    expect(parsed.recoveries?.[0].boundary).toBe('heading');
    const warnings = expectRecoveryWarnings(parsed);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'local.recovery.unclosed',
      severity: 'warning',
      range: { start: unclosed.indexOf('<widget>'), end: unclosed.indexOf('<widget>') + '<widget>'.length },
    });

    const inline = '正文 <widget> 继续';
    const prose = parseLocal(inline, loose);
    expect(prose.recoveries).toBeUndefined();
    expect(prose.diagnostics).toEqual([]);
    expect(expectRecoveryWarnings(prose)).toEqual([]);
  });

  it('keeps registered leaf components and their shape errors out of recovery', () => {
    const leaf = '<input bind="x" label="X">\n\n正文';
    const parsedLeaf = parseLocal(leaf, loose);
    expect(parsedLeaf.recoveries).toBeUndefined();
    expect(expectRecoveryWarnings(parsedLeaf)).toEqual([]);
    expect(flat(parsedLeaf.nodes).some((node) => node.name === 'input')).toBe(true);

    const closing = '<input></input>';
    const parsedClosing = parseLocal(closing, loose);
    expect(parsedClosing.recoveries).toBeUndefined();
    expect(expectRecoveryWarnings(parsedClosing)).toEqual([]);
    expect(parsedClosing.diagnostics.some((item) => item.code === 'local.tag.mismatch')).toBe(true);
  });

  it('keeps strict diagnostics and adds no recoveries when strict is true', () => {
    const source = '<card>\n正文';
    const strict = parseLocal(source);
    expect(strict.recoveries).toBeUndefined();
    expect(expectRecoveryWarnings(strict)).toEqual([]);
    expect(strict.diagnostics.map((item) => item.code)).toContain('local.tag.unclosed');
    expect(strict.diagnostics.some((item) => item.code === 'local.tag.unclosed' && item.severity === 'error')).toBe(true);
  });

  it('preserves original UTF-16 ranges with Unicode and CRLF sources', () => {
    const source = '😀 前\r\n<card>\r\n文\r\n\r\n## 后\r\n尾';
    const parsed = parseLocal(source, loose);
    expect(parsed.recoveries).toHaveLength(1);
    expect(parsed.recoveries?.[0].code).toBe('local.recovery.unclosed');
    expect(parsed.recoveries?.[0].affectedRange).toEqual({
      start: source.indexOf('<card>'),
      end: source.indexOf('## 后'),
    });
    expect(source.slice(parsed.recoveries![0].affectedRange.start, parsed.recoveries![0].affectedRange.end))
      .toBe('<card>\r\n文\r\n\r\n');
    const warnings = expectRecoveryWarnings(parsed);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].range).toEqual(parsed.recoveries?.[0].causeRange);
    expect(source.slice(warnings[0].range.start, warnings[0].range.end)).toBe('<card>');
    expect(warnings[0].line).toBe(2);
    expect(warnings[0].column).toBe(1);
  });
});
