import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Inline export assets through the engine's public package exports. */
const PREFIX = 'virtual:reactive-md-assets/';
const assets = {
  'base-css': 'reactive-md/styles.css',
  'print-css': 'reactive-md/print.css',
  notices: 'reactive-md/notices',
  'package-json': 'reactive-md/package.json',
  runtime: 'reactive-md/assets/standalone.js',
} as const;
export function exportAssets(): Plugin {
  return {
    name: 'reactive-md-demo-export-assets',
    resolveId(id) { return id.startsWith(PREFIX) ? '\0' + id : null; },
    load(id) {
      if (!id.startsWith('\0' + PREFIX)) return null;
      const name = id.slice(PREFIX.length + 1) as keyof typeof assets;
      if (!(name in assets)) throw new Error('Unknown engine export asset: ' + name);
      const file = fileURLToPath(import.meta.resolve(assets[name]));
      this.addWatchFile(file);
      return 'export default ' + JSON.stringify(readFileSync(file, 'utf8')) + ';';
    },
  };
}
