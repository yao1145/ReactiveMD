import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileLocal, createLocalRuntime, createLocalStateFile, createShareableHtml } from 'reactive-md';
import { renderLocalPdf } from 'reactive-md/pdf';
import { renderLocalStaticDocument } from 'reactive-md/react/server';

const cli = fileURLToPath(new URL('../bin/reactive-md.mjs', import.meta.url));
const printCss = readFileSync(new URL('../src/print.css', import.meta.url), 'utf8');
const directory = mkdtempSync(join(tmpdir(), 'reactive-md-pdf-check-'));

function cliPdf(input, name, ...flags) {
  const output = join(directory, name + '.pdf');
  const result = spawnSync(process.execPath, [cli, 'build', input, '--format', 'pdf', '-o', output, ...flags], { encoding: 'utf8' });
  assert.ifError(result.error);
  return { ...result, output };
}

function readPdf(path, ...options) {
  return execFileSync('pdftotext', [...options, path, '-'], { encoding: 'utf8' });
}

function boxForWord(path) {
  const xml = readPdf(path, '-bbox');
  const page = /<page width="([\d.]+)"/.exec(xml);
  const word = /<word xMin="(-?[\d.]+)" yMin="(-?[\d.]+)"[^>]*>MarginMarker<\/word>/.exec(xml);
  assert.ok(page && word, 'PDF did not contain the layout marker');
  return { width: Number(page[1]), x: Number(word[1]), y: Number(word[2]) };
}

try {
  const paragraphs = Array.from({ length: 160 }, (_, index) =>
    `<p>PdfParagraph${String(index + 1).padStart(4, '0')}</p>`).join('\n');
  const embedded = Array.from({ length: 80 }, (_, index) =>
    `<p>EmbeddedParagraph${String(index + 1).padStart(4, '0')}</p>`).join('');
  const source = [
    '<css>h3 { display: none; }</css>', '', '## People', '',
    '<slider bind="people" label="People" initial="2" min="1" max="20" css="max-width: 24rem">',
    '', 'People: {{ people }}', '', `<iframe title="Example" srcdoc="${embedded}"></iframe>`,
    '', '<javascript>await rmd.set("people", 10)</javascript>', '', '### HiddenByAuthorCss', '', paragraphs,
  ].join('\n');
  const compileOptions = { enableCss: true, enableJavaScript: true, enableExtendedHtml: true };
  const compiled = compileLocal(source, compileOptions);
  assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
  const runtime = createLocalRuntime(compiled.document);
  try {
    assert.deepEqual(runtime.setParameter('people', 7), []);
    const rendered = renderLocalStaticDocument({ document: compiled.document, runtime, capabilityGrants: compileOptions });
    assert.ok(rendered.ok, JSON.stringify(rendered.diagnostics));
    const html = createShareableHtml({
      title: 'Mixed document PDF', source, compileOptions, mode: 'static', css: printCss,
      staticMarkup: rendered.markup,
      state: createLocalStateFile(compiled.document, runtime.snapshot().state),
    });
    const pdf = join(directory, 'mixed.pdf');
    writeFileSync(pdf, await renderLocalPdf(html));
    const extracted = readPdf(pdf);
    assert.equal([...extracted.matchAll(/PdfParagraph\d{4}/g)].length, 160, 'Print lost or duplicated paragraphs');
    assert.match(extracted, /PdfParagraph0160/);
    assert.equal([...new Set(extracted.match(/EmbeddedParagraph\d{4}/g))].length, 80, 'Print lost embedded paragraphs');
    for (const marker of ['EmbeddedParagraph0001', 'EmbeddedParagraph0080']) {
      assert.equal(extracted.split(marker).length, 2, `${marker} must appear exactly once`);
    }
    assert.match(extracted, /People:\s*7/);
    assert.doesNotMatch(extracted, /People:\s*10|HiddenByAuthorCss/);
    assert.ok(readPdf(pdf, '-bbox').match(/<page\b/g)?.length > 1);
    console.log('PASS the mixed document preserves its static state, CSS and paginates both the embedded and surrounding paragraphs');
  } finally {
    runtime.dispose();
  }

  const article = join(directory, 'margins.reactive.md');
  writeFileSync(article, '# MarginMarker\n\nUse local-sdk-unavailable here.\n\n`data-rmd-extension-error=`');
  const noMargin = cliPdf(article, 'no-margin', '--pdf-paper', 'A4', '--pdf-margin', '0mm');
  const hugeMargin = cliPdf(article, 'large-margin', '--pdf-paper', 'a4', '--pdf-margin', '35mm');
  const letter = cliPdf(article, 'letter', '--pdf-paper', 'Letter');
  for (const result of [noMargin, hugeMargin, letter]) assert.equal(result.status, 0, result.stderr);
  const baselineBox = boxForWord(noMargin.output);
  const marginBox = boxForWord(hugeMargin.output);
  assert.ok(Math.abs(baselineBox.width - 595) < 2);
  assert.ok(Math.abs(boxForWord(letter.output).width - 612) < 2);
  for (const axis of ['x', 'y']) {
    const shift = marginBox[axis] - baselineBox[axis];
    assert.ok(shift > 96 && shift < 103, `Expected a 35 mm shift on ${axis}, got ${shift} pt`);
  }
  console.log('PASS A4 and Letter, explicit margins, and plain text containing diagnostic identifiers');

  const broken = join(directory, 'broken.reactive.md');
  writeFileSync(broken, '# Broken image\n\n![Broken raster](broken.png)');
  writeFileSync(join(directory, 'broken.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const relaxed = cliPdf(broken, 'broken-relaxed');
  assert.equal(relaxed.status, 0, relaxed.stderr);
  assert.match(relaxed.stderr, /local\.pdf\.image-decode/);
  assert.ok(existsSync(relaxed.output));
  const strict = cliPdf(broken, 'broken-strict', '--strict');
  assert.notEqual(strict.status, 0);
  assert.match(strict.stderr, /local\.pdf\.image-decode/);
  assert.ok(!existsSync(strict.output), 'Strict failure wrote a PDF');
  console.log('PASS corrupt images warn by default and stop strict export');
} finally {
  const name = relative(tmpdir(), directory);
  assert.ok(name.startsWith('reactive-md-pdf-check-') && !isAbsolute(name));
  rmSync(directory, { recursive: true, force: true });
}
