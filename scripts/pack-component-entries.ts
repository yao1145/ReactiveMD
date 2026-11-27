import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { normalizePath, type Plugin } from 'vite';
import { controlsPack, dataPack, layoutPack, visualsPack } from '../src/presets/packs';
import type { LocalPackStyleManifest } from '../src/presets/pack-style-manifest';
import { LOCAL_STYLE_LAYER_ORDER } from '../src/themes/contract';
import { visualPackCss } from './pack-visual-styles';

const packs = { controls: controlsPack, layout: layoutPack, data: dataPack, visuals: visualsPack };
type PackName = keyof typeof packs;
const local = (path: string) => normalizePath(fileURLToPath(new URL(`../src/${path}`, import.meta.url)));
const prefix = local('components/packs/.generated/');
const virtual = '\0rmd-pack-entry/';
const manifestName = 'style-manifest';
const publicCss = 'reactive-md/presets/default/packs/css/';

const defaultViewModules: Record<PackName, string> = {
  controls: 'controls/controls.tsx', layout: 'layout/layout.tsx', data: 'shared/data-visuals.tsx', visuals: 'shared/visuals.tsx',
};
const viewModules: Readonly<Record<string, string>> = {
  coordinate: 'plot/coordinate.tsx', option: 'layout/structural-views.ts',
  slider: 'controls/numeric-sliders.tsx', 'range-slider': 'controls/numeric-sliders.tsx',
  gallery: 'gallery/gallery.tsx', 'gallery-item': 'gallery/gallery.tsx',
  column: 'layout/structural-views.ts', 'data-table': 'table/data-table.tsx', edge: 'layout/structural-views.ts',
};

const componentEntries = Object.entries(packs).flatMap(([pack, preset]) => preset.components.map(definition => ({
  pack: pack as PackName, name: definition.name, styles: definition.styles ?? [],
})));

export const packedComponentInputs = Object.fromEntries([
  ...componentEntries.map(({ name }) => [`reactive-md-react-component-${name}`, `${prefix}${name}`]),
  ['reactive-md-pack-style-manifest', `${prefix}${manifestName}`],
]);

function expandCss(file: string): string {
  const css = postcss.parse(readFileSync(file, 'utf8'), { from: file });
  css.walkAtRules('import', rule => {
    const imported = /^['"](\.[^'"]+)['"]$/.exec(rule.params)?.[1];
    if (!imported) throw new Error(`Unsupported pack CSS import: ${rule.params}`);
    rule.replaceWith(...postcss.parse(expandCss(resolve(dirname(file), imported))).nodes);
  });
  return css.toString();
}

interface StyleSource {
  importId: string;
  read: () => string;
  wrap?: (css: string) => string;
}

function source(path: string): StyleSource {
  const file = local(path);
  return { importId: `${file}?inline`, read: () => expandCss(file) };
}

function visual(group: Parameters<typeof visualPackCss>[0]): StyleSource {
  return { importId: `virtual:rmd-visual-styles/${group}`, read: () => visualPackCss(group) };
}

const styles: Readonly<Record<string, StyleSource>> = {
  'controls': source('components/controls/controls.css'),
  'gallery': source('components/gallery/gallery.css'),
  'layout': source('components/packs/layout.css'),
  'visual-base': visual('shared'),
  'data-visuals': visual('data'),
  'graphics': visual('visuals'),
  'chart': source('components/chart/chart.css'),
  'diagram': source('components/diagram/diagram.css'),
  'mafs-core': { importId: 'mafs/core.css?inline', read: () => expandCss(fileURLToPath(import.meta.resolve('mafs/core.css'))),
    wrap: css => `@layer rmd.reset { ${css} }` },
  'mafs': source('components/plot/mafs.css'),
};

function resourceName(id: string): string {
  const match = /^reactive-md\/([\w-]+)\.css$/.exec(id);
  if (!match || !Object.hasOwn(styles, match[1])) throw new Error(`Unknown pack style resource ${id}.`);
  return match[1];
}

function componentEntry({ name, pack, styles: used }: typeof componentEntries[number]): string {
  const view = name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('') + 'View';
  const lines = [
    `import { ${pack}Pack } from ${JSON.stringify(local('presets/packs.ts'))};`,
    `import { ${view} } from ${JSON.stringify(local(`components/${viewModules[name] ?? defaultViewModules[pack]}`))};`,
    `import { mountOfficialComponent } from ${JSON.stringify(local('components/mount-preset.ts'))};`,
  ];
  const resources = used.map((id, index) => {
    const style = styles[resourceName(id)];
    const binding = `css${index}`;
    lines.push(`import ${binding} from ${JSON.stringify(style.importId)};`);
    const css = style.wrap ? '`' + style.wrap('${' + binding + '}') + '`' : binding;
    return `{ id: ${JSON.stringify(id)}, css: ${css} }`;
  });
  lines.push(`export default /*#__PURE__*/ mountOfficialComponent(${pack}Pack, ${JSON.stringify(name)}, ${view}, [${resources.join(', ')}]);`);
  return lines.join('\n');
}

function selectors(css: string): string[] {
  const found = new Set<string>();
  postcss.parse(css).walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    for (const selector of rule.selectors) found.add(selector);
  });
  return [...found];
}

export function packComponentEntries(): Plugin {
  let catalog: { css: Map<string, string>; manifest: LocalPackStyleManifest } | undefined;
  function styleCatalog() {
    if (catalog) return catalog;
    const css = new Map<string, string>();
    const resources = Object.fromEntries(Object.entries(styles).map(([name, style]) => {
      const id = `reactive-md/${name}.css`;
      const text = style.read();
      const wrapped = style.wrap ? style.wrap(text) : text;
      css.set(id, wrapped);
      return [id, { file: `${publicCss}resources/${name}.css`, selectors: selectors(wrapped) }];
    }));
    const manifest: LocalPackStyleManifest = {
      components: Object.fromEntries(componentEntries.map(({ name, styles: used }) => [name, used])),
      packs: Object.fromEntries(Object.entries(packs).map(([name, pack]) => {
        const used = new Set(pack.components.flatMap(component => [...(component.styles ?? [])]));
        for (const id of used) resourceName(id);
        return [name, { file: `${publicCss}${name}.css`, resources: [...css.keys()].filter(id => used.has(id)) }];
      })),
      resources,
    };
    catalog = { css, manifest };
    return catalog;
  }
  return {
    name: 'reactive-md-pack-entries',
    enforce: 'pre',
    buildStart() { catalog = undefined; },
    resolveId(id) {
      const path = normalizePath(id);
      if (path.startsWith(prefix)) return virtual + path.slice(prefix.length);
    },
    load(id) {
      if (id === virtual + manifestName) return `export const packStyleManifest = ${JSON.stringify(styleCatalog().manifest)};`;
      if (!id.startsWith(virtual)) return;
      const entry = componentEntries.find(item => item.name === id.slice(virtual.length));
      if (!entry) throw new Error(`Unknown React pack entry ${id}.`);
      return componentEntry(entry);
    },
    generateBundle() {
      const { css, manifest } = styleCatalog();
      for (const [id, text] of css) this.emitFile({ type: 'asset', fileName: `rmd-pack-resource-${resourceName(id)}.css`,
        source: `${LOCAL_STYLE_LAYER_ORDER}\n${text}\n` });
      for (const [name, pack] of Object.entries(manifest.packs)) this.emitFile({ type: 'asset', fileName: `rmd-pack-${name}.css`,
        source: `${LOCAL_STYLE_LAYER_ORDER}\n${pack.resources.map(id => css.get(id)).join('\n')}\n` });
      for (const { name } of componentEntries) this.emitFile({ type: 'asset', fileName: `types/components/entries/${name}.d.ts`,
        source: "import type { LocalReactPresetPackage } from '../../react/package-core.js';\ndeclare const component: LocalReactPresetPackage;\nexport default component;\n" });
      this.emitFile({ type: 'asset', fileName: 'types/presets/pack-style-entry.d.ts', source:
        "import type { LocalPackStyleManifest } from './pack-style-manifest.js';\nexport type { LocalPackStyleManifest } from './pack-style-manifest.js';\nexport declare const packStyleManifest: LocalPackStyleManifest;\n" });
    },
  };
}
