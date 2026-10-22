import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { compileLocal } from 'reactive-md';

export function article(sections = 600) {
  return '<slider bind="n" label="Parameter" initial="2" min="0" max="100">\n\n' +
    Array.from({ length: sections }, (_, i) => `## Section ${i + 1}\n\nA local document with **Markdown**, a computed value {{ n * ${i + 1} }}, and ordinary explanatory text.\n\n- Read the value\n- Adjust the parameter\n`).join('\n');
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/benchmark-large-documents.mjs')) {
  const results = [];
  for (const sections of [10, 100, 300, 600]) {
    const source = article(sections);
    const timings = [];
    for (let i = 0; i < 23; i++) {
      const started = performance.now();
      const result = compileLocal(source);
      const elapsed = performance.now() - started;
      assert.ok(result.ok, JSON.stringify(result.diagnostics));
      if (i >= 3) timings.push(elapsed);
    }
    timings.sort((a, b) => a - b);
    results.push({ sections, characters: source.length, medianMs: timings[9], p95Ms: timings[18] });
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(process.argv[2] ?? 'artifacts/benchmark-large-documents.json', JSON.stringify({ generatedAt: new Date().toISOString(), iterations: 20, warmups: 3, results }, null, 2));
  console.table(results);
}
