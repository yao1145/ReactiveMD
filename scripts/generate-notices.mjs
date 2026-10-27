import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Markdown is bundled by core; renderer code highlighting bundles lowlight.
// The standalone IIFE also bundles React/DOM.
const roots = ['remark-gfm', 'remark-parse', 'unified', 'parse5', 'lowlight', 'elkjs', 'mhchemparser', 'react', 'react-dom'];
const visited = new Map();
async function findPackage(name, from) {
  let current = from;
  while (true) {
    const candidate = join(current, 'node_modules', name, 'package.json');
    try { await access(candidate); return dirname(candidate); } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error(`Cannot resolve installed dependency ${name}`);
    current = parent;
  }
}
async function collect(name, from) {
  const directory = await findPackage(name, from);
  if (visited.has(directory)) return;
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const licenseFiles = (await readdir(directory)).filter(file => /^(?:licen[cs]e|copying)(?:\.|$)/i.test(file)).sort();
  if (!licenseFiles.length) throw new Error(`No license text found for ${pkg.name}@${pkg.version}`);
  const texts = await Promise.all(licenseFiles.map(file => readFile(join(directory, file), 'utf8')));
  visited.set(directory, { name: pkg.name, version: pkg.version, license: pkg.license, texts });
  for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) await collect(dependency, directory);
}
for (const name of roots) await collect(name, root);
const packages = [...visited.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
const notice = [
  '# Third-party notices',
  '',
  'Reactive MD bundles its Markdown, HTML parsing, syntax-highlighting, diagram-layout and chemical-formula parsing dependencies. The standalone HTML runtime also bundles React, React DOM and scheduler. This file preserves license texts for those installed dependency trees, including supporting type packages. The library React entry uses host-provided React and React DOM peers.',
  '',
  'Regenerate after dependency updates with `node scripts/generate-notices.mjs`.',
  '',
  ...packages.flatMap(pkg => [
    `## ${pkg.name}@${pkg.version}`,
    '',
    `Declared license: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}`,
    '',
    ...(pkg.name === 'elkjs' ? ['ELK source is available under the Eclipse Public License 2.0 at https://github.com/kieler/elkjs and https://github.com/eclipse-elk/elk.', ''] : []),
    ...pkg.texts.flatMap(license => ['```text', license.trim(), '```', '']),
  ]),
].join('\n');
await writeFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), notice);
console.log(`Preserved third-party license texts for ${packages.length} packages.`);
