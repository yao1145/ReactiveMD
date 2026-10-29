import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, formatLocalDiagnostic } from '../src/local';

const header = '<!-- reactive-md: local-draft-3 -->';

describe('source syntax revision gate', () => {
  it('rejects an unsupported explicit version before evaluating declarations', () => {
    const result = compileLocal('<!-- reactive-md: local-draft-99 -->\n<const name="bad" value="{{ 1 / 0 }}">');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(item => item.code)).toEqual(['local.version.unsupported']);
    expect(formatLocalDiagnostic(result.diagnostics[0], 'zh')).toContain('local-draft-99');
  });

  it('requires migration for an explicitly historical revision', () => {
    expect(compileLocal('<!-- reactive-md: local-draft-1 -->\n# Old').diagnostics)
      .toEqual([expect.objectContaining({ code: 'local.version.unsupported', severity: 'error' })]);
  });

  it('accepts an explicit revision, BOM, comments and a theme without shifting positions', () => {
    const source = `\uFEFF<!-- note -->\r\n${header}\r\n<theme name="default">\r\n<number bind="n" label="Count" initial="2">\r\n\r\n{{ n * 3 }}`;
    const result = compileLocal(source);
    expect(result.diagnostics).toEqual([]);
    if (!result.ok) throw new Error('Expected a valid document');
    expect(result.document.syntaxVersion).toBe('local-draft-3');
    expect(result.document.versionDeclaration).toEqual({
      version: 'local-draft-3', range: { start: source.indexOf(header), end: source.indexOf(header) + header.length },
    });
    expect(result.document.nodes.find(node => node.name === 'number')?.range.start).toBe(source.indexOf('<number'));
    const runtime = createLocalRuntime(result.document);
    try { expect(runtime.evaluate('n * 3')).toBe(6); } finally { runtime.dispose(); }
  });

  it('keeps unversioned sources compatible without a new warning', () => {
    const result = compileLocal('<number bind="n" label="Count">');
    expect(result.diagnostics).toEqual([]);
    if (!result.ok) throw new Error('Expected a valid document');
    expect(result.document.syntaxVersion).toBe('local-draft-3');
    expect(result.document.versionDeclaration).toBeUndefined();
  });

  it.each([
    [`${header}\n${header}\n# Body`, 'local.version.duplicate'],
    ['<!-- reactive-md: something -->\n# Body', 'local.version.malformed'],
    ['<!-- reactive-md local-draft-99 -->\n# Body', 'local.version.malformed'],
    ['<!-- reactive-md: local-draft-3\n# Body', 'local.version.malformed'],
    [`# Body\n${header}`, 'local.version.placement'],
    [`<theme name="default">\n${header}\n# Body`, 'local.version.placement'],
    [`<panel>\n${header}\n</panel>`, 'local.version.placement'],
  ])('rejects invalid declaration placement/shape: %s', (source, code) => {
    const result = compileLocal(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(item => item.code)).toContain(code);
  });

  it('ignores directive examples inside code, math and unknown fallback regions', () => {
    const source = `\`${header}\`\n\n\`\`\`markdown\n<!-- reactive-md: local-draft-99 -->\n\`\`\`\n\n$$\n${header}\n$$\n\n<future>\n${header}\n</future>`;
    expect(compileLocal(source).diagnostics.filter(item => item.code.startsWith('local.version.'))).toEqual([]);
  });
});
