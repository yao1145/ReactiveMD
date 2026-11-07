import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfig, type ViteDevServer } from 'vite';
import { reactiveMd } from '../src/vite';

const HOST = '\0virtual:reactive-md/host';
const REGISTRATION = '\0virtual:reactive-md/registration';

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'rmd-vite-'));
  mkdirSync(join(root, 'theme', 'paper'), { recursive: true });
  writeFileSync(join(root, 'theme', 'paper', 'theme.css'), '.paper { color: black; }');
  mkdirSync(join(root, 'plugin', 'card'), { recursive: true });
  writeFileSync(join(root, 'plugin', 'card', 'index.ts'), 'export default { components: [] };');
  writeFileSync(join(root, 'plugin', 'card', 'component.css'), '.card { color: blue; }');
  return root;
}

function createServer() {
  const send = vi.fn();
  const invalidateModule = vi.fn();
  const listeners = new Map<string, (file: string) => void>();
  const close = vi.fn();
  const watcher = {
    add: vi.fn(),
    on: vi.fn((event: string, listener: (file: string) => void) => { listeners.set(event, listener); }),
    off: vi.fn(),
    once: vi.fn(),
  };
  const server = {
    ws: { send },
    moduleGraph: { getModuleById: vi.fn(() => undefined), invalidateModule },
    watcher,
    httpServer: { once: vi.fn((_event: string, listener: () => void) => { close.mockImplementation(listener); }) },
    config: { logger: { error: vi.fn() } },
  } as unknown as ViteDevServer;
  return { server, send, invalidateModule, listeners, close, watcher };
}

function hotContext(server: ViteDevServer, file: string) {
  return { file, server, modules: [], timestamp: 0, read: async () => '' } as never;
}

describe('ReactiveMD Vite adapter', () => {
  it('merges dependency settings and supplies a host module with managed styles', async () => {
    const plugin = reactiveMd({ extensions: './extensions.ts' });
    const resolved = await resolveConfig({ configFile: false, root: process.cwd(), plugins: [plugin],
      resolve: { dedupe: ['user-package'] }, optimizeDeps: { exclude: ['user-excluded'] } }, 'serve');
    expect(resolved.resolve.dedupe).toEqual(expect.arrayContaining(['user-package', 'react', 'react-dom']));
    expect(resolved.optimizeDeps.exclude).toEqual(expect.arrayContaining(['user-excluded', 'reactive-md/sdk', 'reactive-md/presets/default', 'reactive-md/vite']));
    expect(resolved.optimizeDeps.include).toEqual(expect.arrayContaining(['react', 'react-dom', 'react-dom/client']));
    const watched = vi.fn();
    const load = plugin.load as (this: { addWatchFile(file: string): void }, id: string) => Promise<string | null>;
    const source = await load.call({ addWatchFile: watched }, HOST);
    expect(source).toContain('export {host,extensions}');
    expect(source).toContain('style.textContent=host.css');
    expect(source).toContain('hot.dispose');
    expect(watched).toHaveBeenCalledWith(expect.stringContaining('extensions.ts'));
    expect(await load.call({ addWatchFile: watched }, 'unrelated')).toBeNull();
  });

  it('requires an explicit local registration module', () => {
    expect(() => reactiveMd({ extensions: '' })).toThrow('local extensions');
    expect(() => reactiveMd({ extensions: 'https://example.com/plugin.js' })).toThrow('local extensions');
  });

  it('defaults to directory mode and rejects mixed or escaping options', () => {
    expect(() => reactiveMd()).not.toThrow();
    expect(() => reactiveMd({})).not.toThrow();
    expect(() => reactiveMd({ themeDir: 'themes', pluginDir: 'plugins' })).not.toThrow();
    expect(() => reactiveMd({ extensions: './extensions.ts', themeDir: 'theme' })).toThrow(/cannot mix/);
    expect(() => reactiveMd({ extensions: './extensions.ts', pluginDir: 'plugin' })).toThrow(/cannot mix/);
    expect(() => reactiveMd({ unknown: true } as never)).toThrow(/does not accept/);
    expect(() => reactiveMd({ themeDir: '' })).toThrow(/non-empty/);
    expect(() => reactiveMd({ themeDir: '../outside' })).toThrow(/relative directory/);
    expect(() => reactiveMd({ pluginDir: 'https://example.com/plugin' })).toThrow(/relative directory/);
    expect(() => reactiveMd(null as never)).toThrow(/must be an object/);
  });

  it('generates one registration module from the default directories', async () => {
    const root = createFixture();
    try {
      const plugin = reactiveMd();
      await resolveConfig({ configFile: false, root, plugins: [plugin] }, 'serve');
      const addWatchFile = vi.fn();
      const load = plugin.load as (this: { addWatchFile(file: string): void }, id: string) => Promise<string | null>;
      const host = await load.call({ addWatchFile }, HOST);
      expect(host).toContain('virtual:reactive-md/registration');
      const registration = await load.call({ addWatchFile }, REGISTRATION);
      expect(registration).toContain('plugin/card/index.ts');
      expect(registration).toContain('theme/paper');
      expect(registration).toContain('directory-plugin/card.css');
      expect(registration).toContain('directory-theme/paper.css');
      expect(registration).toContain('createReactHost');
      expect(registration).toContain('reactive-md:themes');
      expect(addWatchFile).toHaveBeenCalledWith(expect.stringContaining('theme'));
      expect(await load.call({ addWatchFile }, 'unrelated')).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refreshes theme CSS without a full reload and reloads structural entries', async () => {
    const root = createFixture();
    try {
      const plugin = reactiveMd();
      await resolveConfig({ configFile: false, root, plugins: [plugin] }, 'serve');
      const { server, send } = createServer();
      const handle = plugin.handleHotUpdate as unknown as (context: never) => Promise<unknown>;
      await handle.call({}, hotContext(server, join(root, 'theme', 'paper', 'theme.css')));
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'custom', event: 'reactive-md:themes' }));
      expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'full-reload' }));
      const payload = send.mock.calls.at(-1)?.[0] as { data: { themes: { theme: { name: string } }[] } };
      expect(payload.data.themes.map((entry) => entry.theme.name)).toContain('paper');

      await handle.call({}, hotContext(server, join(root, 'plugin', 'card', 'index.ts')));
      expect(send).toHaveBeenCalledWith({ type: 'full-reload' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('watches missing roots for creation and removes directory listeners on close', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rmd-vite-empty-'));
    try {
      const plugin = reactiveMd();
      await resolveConfig({ configFile: false, root, plugins: [plugin] }, 'serve');
      const { server, send, listeners, watcher, close } = createServer();
      (plugin.configureServer as unknown as (server: ViteDevServer) => void).call({}, server);
      expect(watcher.add).toHaveBeenCalledWith(expect.arrayContaining([join(root, 'theme'), join(root, 'plugin')]));
      const onDirectory = listeners.get('addDir');
      expect(onDirectory).toBeTruthy();
      onDirectory?.(join(root, 'theme'));
      expect(send).toHaveBeenCalledWith({ type: 'full-reload' });
      const onAdd = listeners.get('add');
      const onUnlink = listeners.get('unlink');
      onAdd?.(join(root, 'plugin', 'card', 'index.ts'));
      onUnlink?.(join(root, 'plugin', 'card', 'index.ts'));
      expect(send).toHaveBeenCalledTimes(3);
      close();
      expect(watcher.off).toHaveBeenCalledWith('addDir', onDirectory);
      expect(watcher.off).toHaveBeenCalledWith('unlinkDir', onDirectory);
      expect(watcher.off).toHaveBeenCalledWith('add', onAdd);
      expect(watcher.off).toHaveBeenCalledWith('unlink', onUnlink);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
