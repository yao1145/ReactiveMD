import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const groups = new Map();

async function count(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await count(file);
      continue;
    }
    const kind = /\.tsx?$/.test(entry.name) ? 'typescript' : entry.name.endsWith('.css') ? 'css' : undefined;
    if (!kind) continue;
    const relative = path.relative(root, file);
    const group = relative.includes(path.sep) ? relative.split(path.sep)[0] : '(entries and styles)';
    const row = groups.get(group) ?? { typescript: 0, css: 0 };
    const source = (await readFile(file, 'utf8')).trimEnd();
    row[kind] += source ? source.split('\n').length : 0;
    groups.set(group, row);
  }
}

await count(root);
const directories = Object.fromEntries([...groups].sort(([left], [right]) => left.localeCompare(right, 'en')));
const total = { typescript: 0, css: 0 };
for (const row of Object.values(directories)) {
  total.typescript += row.typescript;
  total.css += row.css;
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ directories, total }, null, 2));
} else {
  console.table({ ...directories, TOTAL: total });
}
