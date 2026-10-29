import { describe, expect, it } from 'vitest';
import { checkLocalUpgrade, compileLocal, inspectLocalSourceVersion, migrateLocalSource, renameLocalBinding, type LocalDocument, createLocalRuntime } from '../src/local';

const header = '<!-- reactive-md: local-draft-3 -->';
const number = '<number bind="count" label="Count" initial="2" min="0" max="10">\n\n{{ count * 3 }}';

describe('source upgrade and migration APIs', () => {
  it('inspects versions without evaluating declarations', () => {
    expect(inspectLocalSourceVersion(`${header}\n<const name="bad" value="{{ 1 / 0 }}">`))
      .toMatchObject({ declaredVersion: 'local-draft-3', effectiveVersion: 'local-draft-3', supported: true, diagnostics: [] });
    expect(inspectLocalSourceVersion('<!-- reactive-md: local-draft-9 -->'))
      .toMatchObject({ declaredVersion: 'local-draft-9', supported: false });
    expect(inspectLocalSourceVersion(number)).toMatchObject({ declaredVersion: null, effectiveVersion: 'local-draft-3', supported: true });
  });

  it('pins unversioned source and preserves BOM, CRLF, code and body bytes', () => {
    const source = '\uFEFF<!-- author -->\r\n' + number.replaceAll('\n', '\r\n') + '\r\n\r\n```text\r\n{{ unchanged }}\r\n```\r\n';
    const result = migrateLocalSource(source, { fromVersion: 'local-draft-1' });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.source).toBe(`\uFEFF${header}\r\n\r\n${source.slice(1)}`);
    expect(result.edits).toEqual([{ range: { start: 1, end: 1 }, text: `${header}\r\n\r\n` }]);
    expect(compileLocal(result.source).ok).toBe(true);
    expect(migrateLocalSource(result.source)).toMatchObject({ ok: true, changed: false, edits: [], source: result.source });
  });

  it('replaces an old declaration and keeps all remaining bytes', () => {
    const old = '<!-- reactive-md: local-draft-1 -->';
    const source = `<!-- author -->\n${old}\n\n${number}`;
    const result = migrateLocalSource(source);
    expect(result).toMatchObject({ ok: true, fromVersion: 'local-draft-1', needsMigration: true, changed: true });
    expect(result.source).toBe(source.replace(old, header));
    expect(checkLocalUpgrade(result.source)).toMatchObject({ ok: true, needsMigration: false });
  });

  it.each([
    ['<number bind="sum" label="Cost">\n\n{{ sum }}', 'local.upgrade.reserved-binding'],
    ['<text color="red">Previously inert</text>', 'local.upgrade.tag'],
    ['<computed name="total" value="{{ 1 }}">', 'local.upgrade.tag'],
    ['<input bind="name" label="Name" max-length="10">', 'local.upgrade.text-length'],
    ['{{ sum([1, 2]) }}', 'local.upgrade.expression'],
    ['{{ missing }}', 'local.binding.unknown'],
    ['<!-- reactive-md: local-draft-99 -->\n# Future', 'local.upgrade.from-version'],
    ['# Late\n<!-- reactive-md: local-draft-1 -->', 'local.version.placement'],
  ])('refuses unsafe old-source upgrades and returns unchanged source: %s', (source, code) => {
    const result = migrateLocalSource(source, { fromVersion: 'local-draft-1' });
    expect(result.ok).toBe(false);
    expect(result.source).toBe(source);
    expect(result.changed).toBe(false);
    expect(result.edits).toEqual([]);
    expect(result.diagnostics.map(item => item.code)).toContain(code);
  });

  it('allows only an explicitly accepted counting change and keeps its warning', () => {
    const source = '<input bind="name" label="Name" initial="😀" max-length="1">';
    const result = migrateLocalSource(source, { fromVersion: 'local-draft-1', allowSemanticChanges: true });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'local.upgrade.text-length', severity: 'warning' }));
    expect(migrateLocalSource('<text color="red">Literal</text>', { fromVersion: 'local-draft-1', allowSemanticChanges: true }).ok).toBe(false);
  });

  it('does not mistake strings, code or fallback content for new active expressions', () => {
    const source = '{{ "sum([1, 2])" }}\n\n`<text color="red">literal</text>`\n\n<future>\n<computed name="n" value="{{ 2 }}">\n</future>';
    expect(migrateLocalSource(source, { fromVersion: 'local-draft-1' }).ok).toBe(true);
  });

  it('migrates local-draft-2 source and blocks newly active external tags', () => {
    const draft2 = '<!-- reactive-md: local-draft-2 -->\n\n# Draft two\n';
    const migrated = migrateLocalSource(draft2);
    expect(migrated).toMatchObject({ ok: true, fromVersion: 'local-draft-2', changed: true });
    expect(migrated.source).toContain('<!-- reactive-md: local-draft-3 -->');

    const withExternal = '<!-- reactive-md: local-draft-2 -->\n\n<external name="rate" type="number">\n';
    const blocked = migrateLocalSource(withExternal);
    expect(blocked.ok).toBe(false);
    expect(blocked.source).toBe(withExternal);
    expect(blocked.diagnostics.map((item) => item.code)).toContain('local.upgrade.tag');
  });

  it('rejects an explicit source-version override conflict and invalid options', () => {
    expect(checkLocalUpgrade(`${header}\n${number}`, { fromVersion: 'local-draft-1' }).ok).toBe(false);
    expect(checkLocalUpgrade(number, null as never).ok).toBe(false);
    expect(checkLocalUpgrade(number, { allowSemanticChanges: 'yes' } as never).ok).toBe(false);
  });

  it('keeps unversioned current capabilities when no historical version is requested', () => {
    expect(migrateLocalSource('<const name="rate" value="{{ 3 }}">\n\n{{ rate }}').ok).toBe(true);
  });

  it('rejects hand-built documents explicitly marked for a different runtime revision', () => {
    const result = compileLocal(number);
    if (!result.ok) throw new Error('Expected valid fixture');
    expect(() => createLocalRuntime({ ...result.document, syntaxVersion: 'local-draft-99' } as unknown as LocalDocument)).toThrow(/migrate/i);
  });

  it('does not let author rename edit an unsupported revision', () => {
    expect(() => renameLocalBinding(`<!-- reactive-md: local-draft-99 -->\n${number}`, 'count', 'people')).toThrow(/safely/);
  });
});
