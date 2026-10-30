import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const template = path.join(root, 'examples', 'component-package');
const PUBLIC_ENTRIES = new Set([
  'reactive-md',
  'reactive-md/sdk',
  'reactive-md/presets/default',
  'reactive-md/react',
  'reactive-md/react/server',
  'reactive-md/standalone',
  'reactive-md/styles.css',
  'reactive-md/testing',
  'reactive-md/testing/react',
  'reactive-md/testing/browser',
  'reactive-md/build',
  'reactive-md/export',
]);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

async function sourceFiles(): Promise<string[]> {
  const files = await walk(path.join(template, 'src'));
  files.push(...(await walk(path.join(template, 'scripts'))).filter((file) => file.endsWith('.mjs')));
  return files.filter((file) => /\.(?:ts|tsx|mjs)$/.test(file));
}

/** Specifiers in import/export statements, including dynamic import('...'). */
function specifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) out.push(match[1]);
  }
  return out;
}

describe('component package template stays on public entries', () => {
  it('imports only public reactive-md entries and package-local files', async () => {
    const failures: string[] = [];
    for (const file of await sourceFiles()) {
      const source = await readFile(file, 'utf8');
      const rel = path.relative(template, file);
      for (const specifier of specifiers(source)) {
        if (specifier.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), specifier.replace(/\?.*$/, ''));
          if (!resolved.startsWith(template)) failures.push(`${rel}: relative import escapes the package: ${specifier}`);
          continue;
        }
        if (specifier.startsWith('node:') || specifier === 'react' || specifier === 'react-dom' || specifier === 'vite') continue;
        if (specifier.startsWith('@playwright/test')) continue;
        if (!PUBLIC_ENTRIES.has(specifier)) failures.push(`${rel}: non-public import ${specifier}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('declares manifest, theme, local asset and notices', async () => {
    const manifests = await readFile(path.join(template, 'src', 'manifests.ts'), 'utf8');
    expect(manifests).toContain('defineLocalComponent');
    expect(manifests).toContain("name: 'rating'");
    expect(manifests).toContain("name: 'note'");
    expect(manifests).toContain("form: 'container'");
    expect(manifests).toMatch(/disabled:\s*\{\s*kind:\s*'boolean',\s*dynamic:\s*true/);
    expect(await readFile(path.join(template, 'src', 'theme.ts'), 'utf8')).toContain('defineLocalTheme');
    expect(await readFile(path.join(template, 'src', 'assets', 'notice.svg'), 'utf8')).toContain('<svg');
    expect(await readFile(path.join(template, 'NOTICES.md'), 'utf8')).toContain('MIT');
    const sample = await readFile(path.join(template, 'sample', 'document.reactive.md'), 'utf8');
    expect(sample).toContain('<theme name="paper">');
    expect(sample).toContain('<rating');
    expect(sample).toContain('<note');
    expect(sample).toContain('disabled="{{ lock }}"');
    const noteStart = sample.indexOf('<note');
    const ratingStart = sample.indexOf('<rating');
    expect(sample.indexOf('<if')).toBeLessThan(noteStart);
    expect(noteStart).toBeLessThan(ratingStart);
    expect(sample.indexOf('</note>')).toBeGreaterThan(ratingStart);
  });

  it('requires browser evidence for the full run instead of faking it', async () => {
    const verify = await readFile(path.join(template, 'scripts', 'verify.mjs'), 'utf8');
    expect(verify).toContain('runLocalBrowserCompliance');
    expect(verify).toContain("'offline'");
    expect(verify).toContain('process.exit(1)');
    expect(verify).toContain('Offline and browser lifecycle evidence was not executed.');
    expect(verify).toContain('const noteSpec = {');
    expect(verify).toContain("selector: '[data-note] [data-rating-up]'");
    expect(verify).toContain("name: 'data-note-disabled'");
    expect(verify).toMatch(/spec:\s*noteSpec[^}]*component:\s*'note'/);
    const pkg = JSON.parse(await readFile(path.join(template, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.test).toContain('verify.mjs');
    expect(pkg.scripts.test).not.toContain('--no-browser');
    expect(pkg.scripts['test:node']).toContain('--no-browser');
  });
});
