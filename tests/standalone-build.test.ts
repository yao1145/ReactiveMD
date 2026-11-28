import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLocalStandaloneScript } from '../src/build/vite';
import type { Diagnostic } from '../src/local/types';

const CONFIG_KEY = 'rmd-0123456789abcdef';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function hostFixture(lines: readonly string[]): Promise<{ dir: string; host: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'reactive-md-host-'));
  const host = path.join(dir, 'host.mjs');
  await writeFile(host, lines.join('\n'));
  return { dir, host };
}

async function buildHost(host: string): Promise<{ script: string | null; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const vite = await import('vite');
  const script = await buildLocalStandaloneScript({
    root: REPO_ROOT,
    hostEntry: host,
    configKey: CONFIG_KEY,
  }, vite, diagnostics);
  return { script, diagnostics };
}

describe('standalone host browser safety', () => {
  it('rejects Node built-in modules with a host-browser diagnostic', async () => {
    const { dir, host } = await hostFixture([
      "import { fileURLToPath } from 'node:url';",
      'export const config = {};',
      'export const reactConfig = {};',
      'export const root = fileURLToPath(new URL(".", import.meta.url));',
    ]);
    try {
      const { script, diagnostics } = await buildHost(host);
      expect(script).toBeNull();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe('local.build.host-browser');
      expect(diagnostics[0]?.message).toContain('"node:url"');
      expect(diagnostics[0]?.message).toContain('new URL');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts the documented import.meta.url root', async () => {
    const { dir, host } = await hostFixture([
      'export const config = {};',
      'export const reactConfig = {};',
      'export const root = new URL(".", import.meta.url);',
    ]);
    try {
      const { script, diagnostics } = await buildHost(host);
      expect(diagnostics).toEqual([]);
      expect(script?.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
