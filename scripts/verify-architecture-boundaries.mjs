import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleDependencies } from './module-specifiers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

async function filesUnder(relativeRoot) {
  const pending = [path.join(root, relativeRoot)];
  const files = [];
  while (pending.length) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(file);
    }
  }
  return files;
}

/**
 * Allowed outgoing directories per layer. Anything not listed is a violation,
 * so a new import fails the check instead of silently widening the graph.
 *
 * The layering is contracts -> sdk -> local -> assemblies -> presets ->
 * components -> react. A layer may only reference itself and the layers left of
 * it, with the two documented exceptions in `files` below.
 */
const rules = [
  {
    root: 'src/contracts',
    label: 'shared contracts',
    allow: [],
  },
  {
    root: 'src/sdk',
    label: 'SDK',
    allow: ['contracts', 'themes', 'assemblies'],
    // The compatibility facades are the only SDK files allowed to reach the
    // default assembly; every other SDK module stays pure.
    files: { assemblies: ['src/sdk/config.ts', 'src/sdk/registry.ts'] },
  },
  {
    root: 'src/local',
    label: 'local core',
    allow: ['(root)', 'contracts', 'sdk', 'themes', 'runtime-services', 'presets', 'assemblies'],
    // The language core owns no default preset. Only these files read the
    // default assembly, and only to revalidate options or resolve the public
    // default manifests; every other local module stays assembly-free.
    files: {
      assemblies: [
        'src/local/index.ts',
        'src/local/compilation/compiler.ts',
        'src/local/compilation/session/incremental.ts',
        'src/local/configuration/portable-options.ts',
        'src/local/parsing/parse-session.ts',
        'src/local/parsing/parser.ts',
        'src/local/runtime/retention.ts',
        'src/local/runtime/runtime-values.ts',
        'src/local/source/authoring.ts',
        'src/local/transport/worker-job.ts',
      ],
    },
  },
  {
    root: 'src/presets',
    label: 'preset definitions',
    allow: ['contracts', 'sdk'],
  },
  {
    root: 'src/assemblies',
    label: 'default assemblies',
    allow: ['contracts', 'sdk', 'local', 'presets'],
  },
  {
    root: 'src/runtime-services',
    label: 'runtime services',
    allow: ['contracts', 'sdk', 'local'],
  },
  {
    root: 'src/themes',
    label: 'themes',
    allow: ['contracts', 'sdk', 'local'],
  },
  {
    root: 'src/components',
    label: 'builtin components',
    allow: ['contracts', 'sdk', 'local', 'presets', 'react', 'runtime-services'],
  },
  {
    root: 'src/react',
    label: 'React layer',
    allow: [
      'contracts', 'sdk', 'local', 'assemblies', 'presets',
      'components', 'runtime-services', 'themes', 'export', '(root)',
    ],
  },
];

/** `src/local/...` -> `local`; a file directly in `src/` -> `(root)`. */
function layerOf(absolutePath) {
  const relative = path.relative(root, absolutePath).replaceAll('\\', '/');
  const parts = relative.split('/');
  return parts.length > 2 ? parts[1] : '(root)';
}

for (const rule of rules) {
  for (const file of await filesUnder(rule.root)) {
    const source = await readFile(file, 'utf8');
    const relativeFile = path.relative(root, file).replaceAll('\\', '/');
    for (const dependency of moduleDependencies(source, path.basename(file))) {
      if (!dependency.specifier.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), dependency.specifier);
      const targetLayer = layerOf(target);
      if (targetLayer === rule.root.split('/')[1]) continue;
      const where = `${rule.label} boundary violation in ${relativeFile} -> ${dependency.specifier}`;
      assert.ok(
        rule.allow.includes(targetLayer),
        `${where} (${targetLayer} is not an allowed layer)`,
      );
      const pinned = rule.files?.[targetLayer];
      if (pinned) {
        assert.ok(
          pinned.includes(relativeFile),
          `${where} (only ${pinned.join(', ')} may import ${targetLayer})`,
        );
      }
    }
  }
}

console.log('Architecture dependency boundaries are valid.');
