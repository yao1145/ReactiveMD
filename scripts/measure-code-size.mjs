#!/usr/bin/env node
/**
 * Handwritten production size and compiler-entry reachability.
 *
 * Reports three numbers after every refactoring round:
 *   1. handwritten production lines under `src/` (tests excluded),
 *   2. modules reachable from the minimal and standard compiler entries,
 *   3. built bundle size for each entry (when `dist-library` exists).
 *
 * Usage: node scripts/measure-code-size.mjs [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist-library');
const json = process.argv.includes('--json');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function codeLines(file) {
  let count = 0;
  let block = false;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (block) {
      if (line.includes('*/')) block = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) block = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('*')) continue;
    count += 1;
  }
  return count;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

const production = walk(src);
const totalLines = production.reduce((sum, file) => sum + codeLines(file), 0);

function resolveRelative(from, specifier) {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importsOf(file) {
  const source = readFileSync(file, 'utf8');
  const found = [];
  for (const match of source.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
    found.push(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1]);
  return found;
}

function reachable(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolveRelative(file, specifier);
      if (target) pending.push(target);
    }
  }
  return [...seen].sort();
}

function bundleFiles(entry) {
  if (!existsSync(entry)) return { files: [], bytes: 0 };
  const seen = new Set();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s*["'](\.\/[^"']+)["']/g)) {
      pending.push(path.resolve(path.dirname(file), match[1]));
    }
  }
  const files = [...seen].sort();
  return { files, bytes: files.reduce((sum, file) => sum + statSync(file).size, 0) };
}

const entries = {
  minimal: path.join(src, 'compiler/index.ts'),
  standard: path.join(src, 'compiler/standard.ts'),
};

const reach = {};
for (const [name, entry] of Object.entries(entries)) {
  const files = reachable(entry);
  reach[name] = {
    modules: files.length,
    lines: files.reduce((sum, file) => sum + codeLines(file), 0),
    files: files.map(relative),
  };
}

const bundles = {
  minimal: bundleFiles(path.join(dist, 'reactive-md-compiler.js')),
  standard: bundleFiles(path.join(dist, 'reactive-md-compiler-standard.js')),
};

const report = {
  createdAt: new Date().toISOString(),
  production: { files: production.length, codeLines: totalLines },
  reachability: reach,
  bundles: Object.fromEntries(Object.entries(bundles).map(([name, value]) => [name, {
    files: value.files.map(relative),
    bytes: value.bytes,
  }])),
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`handwritten production: ${report.production.files} files, ${report.production.codeLines} code lines`);
  for (const [name, value] of Object.entries(reach)) {
    console.log(`${name} entry reachable: ${value.modules} modules, ${value.lines} code lines`);
  }
  for (const [name, value] of Object.entries(bundles)) {
    if (value.bytes > 0) console.log(`${name} bundle: ${value.bytes} bytes in ${value.files.length} files`);
  }
}
