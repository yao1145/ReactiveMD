import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServer } from 'vite';
import { reactiveMd } from '../src/vite';

describe('directory stylesheet ownership', () => {
  it.each(['package', 'preset'])('keeps component.css for an unstyled %s manifest', async (kind) => {
    const parent = path.resolve('artifacts/vite-directory-resources');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'consumer-'));
    const plugin = path.join(root, 'plugin', 'board');
    await mkdir(plugin, { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(plugin, 'index.ts'), kind === 'package'
      ? 'export default { components: [] };'
      : `import { defineReactPreset } from 'reactive-md/react';
import { defineLocalPreset } from 'reactive-md/sdk';
export default defineReactPreset({
  protocol: 'reactive-md-react-preset/v1',
  preset: defineLocalPreset({ protocol: 'reactive-md-preset/v1', id: 'fixture/board', version: '1.0.0', components: [] }),
  components: [],
});`);
    await writeFile(path.join(plugin, 'component.css'), '.local-document .board { display: grid; }');
    const server = await createServer({
      root, configFile: false, logLevel: 'silent',
      plugins: [reactiveMd({ defaultPreset: false })],
      resolve: { alias: [
        { find: /^reactive-md\/react$/, replacement: path.resolve('src/react/index.ts') },
        { find: /^reactive-md\/sdk$/, replacement: path.resolve('src/sdk/index.ts') },
      ] },
      server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true },
    });
    try {
      const { host } = await server.ssrLoadModule('virtual:reactive-md/host');
      expect(host.config.registry).toEqual([]);
      expect(host.resources).toEqual([
        { id: 'directory-plugin/board.css', css: '.local-document .board { display: grid; }' },
      ]);
      expect(host.css).toContain('display: grid');
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
