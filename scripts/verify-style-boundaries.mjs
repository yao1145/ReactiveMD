import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';

const source = fileURLToPath(new URL('../src/', import.meta.url));
const layerBootstrap = path.join(source, 'themes', 'layers.css');
const bootstrap = postcss.parse(await readFile(layerBootstrap, 'utf8'));
const layerOrder = bootstrap.nodes.find(node => node.type === 'atrule' && node.name === 'layer')?.params;
async function cssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? cssFiles(path.join(directory, entry.name))
    : entry.name.endsWith('.css') ? [path.join(directory, entry.name)] : []));
  return nested.flat();
}

const failures = [];
const files = await cssFiles(source);
for (const file of files) {
  const relative = path.relative(source, file);
  const css = await readFile(file, 'utf8');
  let root;
  try {
    root = postcss.parse(css, { from: file });
  } catch (error) {
    failures.push(`${relative}:${error.line ?? 0}:${error.column ?? 0}: ${error.reason ?? error.message}`);
    continue;
  }
  if (file.endsWith('.module.css') || relative === path.join('standalone', 'standalone.css')) {
    const firstDefinition = root.nodes.findIndex(node => node.type === 'rule' || node.type === 'atrule' && node.nodes);
    const orderDeclaration = root.nodes.findIndex(node => node.type === 'atrule' && (
      node.name === 'layer' && !node.nodes && node.params === layerOrder
      || node.name === 'import' && (() => {
        const imported = /^['"]([^'"]+)['"]\s*$/.exec(node.params);
        return imported && path.resolve(path.dirname(file), imported[1]) === layerBootstrap;
      })()
    ));
    if (orderDeclaration < 0 || firstDefinition >= 0 && orderDeclaration > firstDefinition) {
      failures.push(`${relative}: independently loaded stylesheet must bootstrap the public layer order first`);
    }
  }
  root.walkRules(rule => {
    if (/\[data-rmd-theme\s*=\s*["']?default["']?\]/.test(rule.selector)) {
      failures.push(`${relative}:${rule.source.start.line}: default-theme-only rule`);
    }
    let ancestor = rule.parent;
    while (ancestor && !(ancestor.type === 'atrule' && ancestor.name === 'layer')) ancestor = ancestor.parent;
    if (!ancestor) failures.push(`${relative}:${rule.source.start.line}: rule outside the cascade layers`);
    if (!file.endsWith('.module.css') && relative !== path.join('standalone', 'standalone.css')) {
      let parent = rule.parent;
      while (parent && !(parent.type === 'atrule' && /keyframes$/i.test(parent.name))) parent = parent.parent;
      if (!parent && rule.selectors.some(selector => !/\.(?:md-document|local-document|reactive-md-theme)(?![\w-])/.test(selector))) {
        failures.push(`${relative}:${rule.source.start.line}: shared rule outside document scope`);
      }
    }
  });
  if (!relative.startsWith(`themes${path.sep}default${path.sep}`)) {
    root.walkDecls(declaration => {
      const radius = declaration.prop === 'border-radius';
      const shadow = declaration.prop === 'box-shadow'
        || declaration.prop === 'filter' && declaration.value.includes('drop-shadow(');
      if (!radius && !shadow) return;
      const concreteLength = [...declaration.value.matchAll(/(-?(?:\d+(?:\.\d+)?|\.\d+))(?:px|%)/g)]
        .some(match => Number(match[1]) !== 0);
      const concreteColor = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(declaration.value);
      if (concreteLength || shadow && concreteColor) {
        failures.push(`${relative}:${declaration.source.start.line}: concrete ${declaration.prop} default belongs in themes/default`);
      }
    });
  }
  root.walkAtRules('import', rule => {
    if (/^(?:["'](?:katex|mafs)\/)/.test(rule.params) && !/\blayer\(/.test(rule.params)) {
      failures.push(`${relative}:${rule.source.start.line}: vendor import outside the cascade layers`);
    }
  });
}
if (failures.length) throw new Error(`${failures.length} style boundary violations:\n${failures.slice(0, 20).join('\n')}`);
console.log(`PASS ${files.length} core stylesheets use shared cascade layers without default-theme gates`);
