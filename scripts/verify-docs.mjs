import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const docs = ['README.md', 'README-en.md', 'README-ch.md', 'CONTRIBUTING.md', 'CONTRIBUTING-ch.md', 'SECURITY.md', 'SECURITY-ch.md', 'CHANGELOG.md', 'CHANGELOG-ch.md',
  '.github/pull_request_template.md',
  'demo/README.md', 'demo/IMPLEMENTATION.md', 'examples/local/README.md', 'examples/integration/README.md', 'examples/conformance/README.md',
  ...(await readdir('docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];
const parse = source => unified().use(remarkParse).parse(source);
function visit(node, type) { return [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap(child => visit(child, type))]; }
const text = node => node.value ?? (node.children ?? []).map(text).join('');
const slug = value => value.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
let links = 0;
for (const file of docs) {
  const tree = parse(await readFile(file, 'utf8'));
  for (const link of visit(tree, 'link')) {
    if (/^[a-z][a-z\d+.-]*:/i.test(link.url)) continue;
    const [path, fragment] = link.url.split('#');
    const target = path ? resolve(dirname(file), decodeURIComponent(path)) : resolve(file);
    await access(target);
    if (fragment && target.endsWith('.md')) {
      const targetTree = path ? parse(await readFile(target, 'utf8')) : tree;
      const anchors = visit(targetTree, 'heading').map(node => slug(text(node)));
      assert.ok(anchors.includes(decodeURIComponent(fragment)), `${file}: missing anchor ${link.url}`);
    }
    links++;
  }
}
console.log(`PASS ${links} local links and navigation anchors in ${docs.length} documents`);
