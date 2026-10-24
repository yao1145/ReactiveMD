import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/reactive-md.mjs', import.meta.url));
let directory: string;
const run = (args: string[], input?: string) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', input, windowsHide: true,
});
const file = (name: string, content: string) => {
  const target = join(directory, name);
  writeFileSync(target, content);
  return target;
};

beforeAll(() => { directory = mkdtempSync(join(tmpdir(), 'rmd-migrate-')); });
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe('published migrate command usage', () => {
  it('documents migrate in the main help and its own help', () => {
    const main = run(['--help']);
    expect(main.status, main.stderr).toBe(0);
    expect(main.stdout).toContain('migrate');

    const help = run(['migrate', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: reactive-md migrate');
    expect(help.stdout).toContain('--accept-semantic-changes');
    expect(help.stdout).toContain('--check');
    expect(help.stdout).not.toContain('--write');
  });

  it('localizes help, usage and read errors', () => {
    const help = run(['migrate', '--locale', 'zh', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('用法：reactive-md migrate');

    const missing = run(['migrate', '--locale', 'zh']);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('请提供一个输入文档');

    const unreadable = run(['migrate', '--locale', 'zh', join(directory, 'absent.md')]);
    expect(unreadable.status).toBe(2);
    expect(unreadable.stderr).toContain('无法读取输入');

    expect(run(['migrate', '--locale', 'fr', '--help']).status).toBe(2);
  });

  it('rejects missing, multiple and empty inputs with exit 2', () => {
    expect(run(['migrate']).status).toBe(2);
    const one = file('one.reactive.md', '# One\n');
    const two = file('two.reactive.md', '# Two\n');
    expect(run(['migrate', one, two]).status).toBe(2);
    expect(run(['migrate', '']).status).toBe(2);
  });

  it('rejects unknown options, invalid revisions, and check with output', () => {
    const input = file('options.reactive.md', '# Options\n');
    expect(run(['migrate', '--bogus', input]).status).toBe(2);
    expect(run(['migrate', '--from', 'local-draft-9', input]).status).toBe(2);
    expect(run(['migrate', '--from', input]).status).toBe(2);
    expect(run(['migrate', '--from=local-draft-9', input]).status).toBe(2);
    const conflict = run(['migrate', '--check', '-o', join(directory, 'never.md'), input]);
    expect(conflict.status).toBe(2);
    expect(conflict.stderr).toContain('--check never writes output');
  });
});

describe('published migrate command migration', () => {
  it('writes the migrated source to stdout and preserves BOM, line endings and body', () => {
    const bom = String.fromCharCode(0xfeff);
    const source = `${bom}<!-- reactive-md: local-draft-1 -->\r\n\r\n# Title\r\n\r\nBody text\r\n`;
    const result = run(['migrate', '-'], source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.startsWith(bom)).toBe(true);
    expect(result.stdout).toContain('<!-- reactive-md: local-draft-2 -->');
    expect(result.stdout).toContain('# Title\r\n\r\nBody text\r\n');
    expect(result.stdout).not.toContain('local-draft-1');
    expect(result.stderr).toBe('');
  });

  it('stamps the directive for an unversioned document with an explicit --from', () => {
    const result = run(['migrate', '--from', 'local-draft-1', '-'], '# Legacy\r\n');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('<!-- reactive-md: local-draft-2 -->');
    expect(result.stdout).toContain('# Legacy\r\n');
  });

  it('never overwrites the input and creates a new output exclusively', () => {
    const source = '<!-- reactive-md: local-draft-1 -->\n\n# Kept\n';
    const input = file('input.reactive.md', source);
    const output = join(directory, 'migrated.reactive.md');
    const result = run(['migrate', input, '-o', output]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    expect(readFileSync(input, 'utf8')).toBe(source);
    expect(readFileSync(output, 'utf8')).toContain('local-draft-2');

    const again = run(['migrate', input, '-o', output]);
    expect(again.status).toBe(2);
    expect(again.stderr).toMatch(/already exists/i);

    const same = run(['migrate', input, '-o', input]);
    expect(same.status).toBe(2);
    expect(readFileSync(input, 'utf8')).toBe(source);
  });
});

describe('published migrate --check and --json reports', () => {
  it('reports needed changes with exit 1 and current documents with exit 0', () => {
    const old = file('old.reactive.md', '<!-- reactive-md: local-draft-1 -->\n\n# Old\n');
    const current = file('current.reactive.md', '<!-- reactive-md: local-draft-2 -->\n\n# Current\n');
    const unversioned = file('unversioned.reactive.md', '# Unversioned\n');

    const needs = run(['migrate', '--check', old]);
    expect(needs.status, needs.stderr).toBe(1);
    expect(needs.stdout).toMatch(/Migration needed: local-draft-1 -> local-draft-2/);
    expect(readFileSync(old, 'utf8')).toContain('local-draft-1');

    const upToDate = run(['migrate', '--check', current]);
    expect(upToDate.status).toBe(0);
    expect(upToDate.stdout).toMatch(/Already current: local-draft-2/);

    const implicit = run(['migrate', '--check', unversioned]);
    expect(implicit.status).toBe(1);
    expect(implicit.stdout).toMatch(/Migration needed/);
  });

  it('returns a structured check report without mixing source into JSON', () => {
    const old = file('json-check.reactive.md', '<!-- reactive-md: local-draft-1 -->\n\n# Json\n');
    const result = run(['migrate', '--check', '--json', old]);
    expect(result.status).toBe(1);
    expect(result.stdout.trimStart().startsWith('{')).toBe(true);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      mode: 'check',
      ok: expect.any(Boolean),
      needsMigration: true,
      fromVersion: 'local-draft-1',
      toVersion: 'local-draft-2',
    });
    expect(Array.isArray(report.diagnostics)).toBe(true);
    expect(report).not.toHaveProperty('source');
    expect(report).not.toHaveProperty('edits');
  });

  it('returns the migrated source as a JSON field in migration mode', () => {
    const result = run(['migrate', '--json', '-'], '<!-- reactive-md: local-draft-1 -->\n\n# Json\n');
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      mode: 'migrate',
      ok: true,
      changed: true,
      fromVersion: 'local-draft-1',
      toVersion: 'local-draft-2',
    });
    expect(Array.isArray(report.edits)).toBe(true);
    expect(report.source).toContain('<!-- reactive-md: local-draft-2 -->');
    expect(report.source).toContain('# Json');
  });

  it('reports an output path instead of source when writing a file', () => {
    const input = file('json-output.reactive.md', '<!-- reactive-md: local-draft-1 -->\n\n# Out\n');
    const output = join(directory, 'json-output.migrated.md');
    const result = run(['migrate', '--json', input, '-o', output]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.output).toBe(output);
    expect(report).not.toHaveProperty('source');
    expect(readFileSync(output, 'utf8')).toContain('local-draft-2');
  });
});
