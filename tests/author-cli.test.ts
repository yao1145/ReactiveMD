import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/reactive-md.mjs', import.meta.url));
let directory: string;
const run = (args: string[], input?: string) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', input, windowsHide: true,
});

beforeAll(() => { directory = mkdtempSync(join(tmpdir(), 'rmd-lint-')); });
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe('published author lint command', () => {
  it('lints multiple paths including spaces without changing their source', async () => {
    const good = join(directory, 'good document.reactive.md');
    const bad = join(directory, 'bad.reactive.md');
    writeFileSync(good, '<slider bind="count" label="Count">\n\n{{ count }}');
    writeFileSync(bad, '{{ missing }}');
    const result = run(['lint', '--json', good, bad]);
    expect(result.status, result.stderr).toBe(1);
    const reports = JSON.parse(result.stdout);
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ file: good, ok: true, diagnostics: [] });
    expect(reports[1]).toMatchObject({ file: bad, ok: false });
    expect(reports[1].diagnostics[0]).toMatchObject({ severity: 'error', line: 1, column: expect.any(Number) });
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(bad, 'utf8')).toBe('{{ missing }}');
  });

  it('reads stdin, shares compiler source positions, and reports success', () => {
    expect(run(['lint', '-'], '# Hello').status).toBe(0);
    const result = run(['lint', '--json', '-'], '你好😀\n\n{{ absent }}');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)[0].diagnostics[0]).toMatchObject({ line: 3, column: expect.any(Number) });
    expect(run(['lint', '-'], '{{ absent }}').stdout).toMatch(/<stdin>:1:\d+: error/);
  });

  it('supports warnings as errors without changing compiler diagnostic severity', () => {
    const source = '<unknown>raw content</unknown>';
    const normal = run(['lint', '--json', '-'], source);
    expect(normal.status, normal.stderr).toBe(0);
    const strict = run(['lint', '--warnings-as-errors', '--json', '-'], source);
    expect(strict.status).toBe(1);
    expect(JSON.parse(strict.stdout)[0].diagnostics.some((d: { severity: string }) => d.severity === 'warning')).toBe(true);
  });

  it('returns exit 2 for usage and IO failures, while continuing other files', () => {
    expect(run(['lint']).status).toBe(2);
    expect(run(['lint', '--bogus']).status).toBe(2);
    expect(run(['lint', '-', '-'], '# Hello').status).toBe(2);
    const result = run(['lint', '--json', join(directory, 'missing.md'), '-'], '# Hello');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject([
      { ok: false, diagnostics: [{ code: 'cli.io', line: 1, column: 1 }] },
      { file: '<stdin>', ok: true },
    ]);
    expect(run(['--help']).status).toBe(0);
  });
});
