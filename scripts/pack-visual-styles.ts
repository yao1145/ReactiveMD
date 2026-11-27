import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import type { Plugin } from 'vite';

const prefix = 'virtual:rmd-visual-styles/';
const source = fileURLToPath(new URL('../src/components/shared/visuals.css', import.meta.url));
const common = new Set(['title', 'sr-only', 'message', 'alert', 'notes', 'cell-error', 'swatch']);
const data = /^(?:table|search|sort|select|pagination|timeline)(?:-|$)/;

function ownership(selector: string): 'shared' | 'data' | 'visuals' {
  const classes = [...selector.matchAll(/\.local-(visual-|static-)([\w-]+)/g)];
  if (classes.some(([, namespace, name]) => namespace === 'visual-' && !common.has(name) && !data.test(name))) return 'visuals';
  return classes.some(([, , name]) => data.test(name)) ? 'data' : 'shared';
}

/** Project pack styles from the same source used by the full stylesheet. */
export function packVisualStyles(): Plugin {
  return {
    name: 'reactive-md-pack-visual-styles',
    resolveId(id) { if (id.startsWith(prefix)) return `\0${id}`; },
    load(id) {
      if (!id.startsWith(`\0${prefix}`)) return;
      const group = id.slice(prefix.length + 1);
      if (group !== 'shared' && group !== 'data' && group !== 'visuals') throw new Error(`Unknown visual stylesheet ${group}`);
      this.addWatchFile(source);
      const css = postcss.parse(readFileSync(source, 'utf8'), { from: source });
      css.walkRules(rule => {
        const selectors = rule.selectors.filter(selector => ownership(selector) === group);
        if (selectors.length) rule.selectors = selectors;
        else rule.remove();
      });
      css.walkComments(comment => { comment.remove(); });
      css.walkAtRules(rule => { if (rule.nodes?.length === 0) rule.remove(); });
      return `export default ${JSON.stringify(css.toString())};`;
    },
  };
}
