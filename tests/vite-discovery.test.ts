import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { discoverDirectories } from '../src/vite/discovery';

let base: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'rmd-discovery-')));
});

afterAll(async () => {
  if (base) await rm(base, { recursive: true, force: true });
});

async function project(name: string): Promise<string> {
  const root = join(base, name);
  await mkdir(root, { recursive: true });
  return root;
}

async function write(root: string, path: string, content = ''): Promise<string> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return target;
}

const folderOf = (file: string): string => basename(dirname(file));

describe('discoverDirectories', () => {
  it('returns empty results but keeps absent root paths for watches', async () => {
    const root = await project('missing-roots');
    const discovery = await discoverDirectories(root);
    expect(discovery.themes).toEqual([]);
    expect(discovery.plugins).toEqual([]);
    expect(discovery.files).toEqual([]);
    expect(discovery.assets).toEqual([]);
    expect(discovery.directories).toEqual([
      join(root, 'plugin'),
      join(root, 'theme'),
    ].sort());
  });

  it('honors custom directory names and omits missing ones from files', async () => {
    const root = await project('custom-dirs');
    const discovery = await discoverDirectories(root, {
      themeDir: 'styles/theme',
      pluginDir: 'extensions',
    });
    expect(discovery.directories).toEqual([
      join(root, 'extensions'),
      join(root, 'styles/theme'),
    ].sort());
    expect(discovery.files).toEqual([]);
  });

  it('discovers a minimal theme, scopes and freezes it, and records watch candidates', async () => {
    const root = await project('minimal-theme');
    const stylesheet = await write(
      root,
      'theme/paper/theme.css',
      '[data-rmd-theme="paper"]{--paper-ink:#111}\n'
      + '[data-rmd-theme="paper"][data-color-scheme="dark"]{--paper-ink:#eee}\n',
    );
    const discovery = await discoverDirectories(root);

    expect(discovery.themes).toHaveLength(1);
    const discovered = discovery.themes[0];
    expect(discovered.file).toBe(stylesheet);
    expect(discovered.theme.id).toBe('local/theme/paper');
    expect(discovered.theme.name).toBe('paper');
    expect(discovered.theme.version).toBe('0.0.0');
    expect(discovered.theme.protocol).toBe('reactive-md-theme-1');
    expect(discovered.theme.colorSchemes).toEqual(['light', 'dark']);
    expect(discovered.theme.css.map((resource) => resource.id)).toEqual(['directory-theme/paper.css']);
    expect(discovered.theme.css[0].css).toContain('[data-rmd-theme="paper"]');
    expect(discovered.theme.css[0].css).toContain('[data-color-scheme="dark"]');
    expect(Object.isFrozen(discovered.theme)).toBe(true);
    expect(Object.isFrozen(discovered.theme.css[0])).toBe(true);

    expect(discovery.files).toContain(stylesheet);
    expect(discovery.files).toContain(join(root, 'theme/paper/theme.json'));
    expect(discovery.assets.map((asset) => asset.path)).toEqual(['theme/paper/theme.css']);
    expect(discovery.directories).toContain(join(root, 'theme/paper'));
  });

  it('lets theme.json override identity metadata and leaves dark mode to the author', async () => {
    const root = await project('theme-metadata');
    await write(root, 'theme/custom/theme.css', '.surface{color:var(--ink)}');
    const metadata = await write(root, 'theme/custom/theme.json', JSON.stringify({
      id: 'acme/night-paper',
      name: 'night-paper',
      version: '1.2.3',
      protocol: 'reactive-md-theme-1',
      colorSchemes: ['dark', 'light'],
    }));
    const discovery = await discoverDirectories(root);

    expect(discovery.themes).toHaveLength(1);
    const theme = discovery.themes[0].theme;
    expect(theme.id).toBe('acme/night-paper');
    expect(theme.name).toBe('night-paper');
    expect(theme.version).toBe('1.2.3');
    expect(theme.colorSchemes).toEqual(['dark', 'light']);
    expect(theme.css[0].id).toBe('directory-theme/custom.css');
    expect(theme.css[0].css).toContain('[data-rmd-theme="night-paper"]');
    expect(discovery.files).toContain(metadata);
  });

  it('sorts themes, plugins, files and directories by code-unit order', async () => {
    const root = await project('sorting');
    await write(root, 'theme/b/theme.css', '[data-rmd-theme="b"]{color:red}');
    await write(root, 'theme/a/theme.css', '[data-rmd-theme="a"]{color:blue}');
    await write(root, 'plugin/z/index.ts', 'not evaluated');
    await write(root, 'plugin/y/index.mjs', 'not evaluated');

    const discovery = await discoverDirectories(root);
    expect(discovery.themes.map((item) => folderOf(item.file))).toEqual(['a', 'b']);
    expect(discovery.plugins.map((item) => folderOf(item.file))).toEqual(['y', 'z']);
    expect(discovery.files).toEqual([...discovery.files].sort());
    expect(discovery.directories).toEqual([...discovery.directories].sort());
    expect(discovery.themes.map((item) => item.theme.name)).toEqual(['a', 'b']);
  });

  it('only inspects conventional entries, theme.css and component.css', async () => {
    const root = await project('conventional-only');
    await write(root, 'theme/skip/style.css', '[data-rmd-theme="skip"]{color:red}');
    await write(root, 'plugin/skip/other.ts', 'export default {}');
    await write(root, 'plugin/skip/component.css', '.skip{display:block}');

    const discovery = await discoverDirectories(root);
    expect(discovery.themes).toEqual([]);
    expect(discovery.plugins).toEqual([]);
    expect(discovery.files).toEqual([]);
  });

  it('rejects ambiguous plugin entries and names every candidate', async () => {
    const root = await project('ambiguous-entry');
    const directory = join(root, 'plugin', 'dupe');
    await write(root, 'plugin/dupe/index.ts', 'export default {}');
    await write(root, 'plugin/dupe/index.js', 'export default {}');

    await expect(discoverDirectories(root)).rejects.toThrow(
      /Plugin directory .*dupe declares more than one entry: .*index\.ts.*index\.js/,
    );
    await expect(discoverDirectories(root)).rejects.toThrow(directory);
  });

  it('reports both files when two themes declare the same name', async () => {
    const root = await project('duplicate-theme-name');
    await write(root, 'theme/one/theme.css', '.one{color:red}');
    const first = await write(root, 'theme/one/theme.json', JSON.stringify({ name: 'paper' }));
    await write(root, 'theme/two/theme.css', '.two{color:blue}');
    const second = await write(root, 'theme/two/theme.json', JSON.stringify({ name: 'paper' }));

    const failure = discoverDirectories(root);
    await expect(failure).rejects.toThrow(/Theme name "paper" is declared by both/);
    await expect(discoverDirectories(root)).rejects.toThrow(first);
    await expect(discoverDirectories(root)).rejects.toThrow(second);
  });

  it('reports both files when two themes declare the same id', async () => {
    const root = await project('duplicate-theme-id');
    await write(root, 'theme/one/theme.css', '.one{color:red}');
    const first = await write(root, 'theme/one/theme.json', JSON.stringify({ id: 'acme/shared' }));
    await write(root, 'theme/two/theme.css', '.two{color:blue}');
    const second = await write(root, 'theme/two/theme.json', JSON.stringify({ id: 'acme/shared' }));

    await expect(discoverDirectories(root)).rejects.toThrow(/Theme id "acme\/shared" is declared by both/);
    await expect(discoverDirectories(root)).rejects.toThrow(first);
    await expect(discoverDirectories(root)).rejects.toThrow(second);
  });

  it('rejects invalid theme.json syntax and points at theme.json', async () => {
    const root = await project('invalid-json');
    await write(root, 'theme/broken/theme.css', '.broken{color:red}');
    const metadata = await write(root, 'theme/broken/theme.json', '{ not json');

    await expect(discoverDirectories(root)).rejects.toThrow(/Invalid theme metadata .*theme\.json/);
    await expect(discoverDirectories(root)).rejects.toThrow(metadata);
  });

  it('rejects invalid metadata values and points at theme.json', async () => {
    const root = await project('invalid-metadata');
    await write(root, 'theme/bad/theme.css', '.bad{color:red}');
    const metadata = await write(root, 'theme/bad/theme.json', JSON.stringify({ version: 3 }));

    await expect(discoverDirectories(root)).rejects.toThrow(/Invalid theme .*theme\.json/);
    await expect(discoverDirectories(root)).rejects.toThrow(metadata);
    await expect(discoverDirectories(root)).rejects.toThrow(/version/);
  });

  it('inlines local imports and url assets and records them as watch dependencies', async () => {
    const root = await project('local-resources');
    const stylesheet = await write(
      root,
      'theme/asset/theme.css',
      '@import "./parts/base.css";\n'
      + '[data-rmd-theme="asset"]{background:url("./images/tile.svg")}\n',
    );
    const imported = await write(root, 'theme/asset/parts/base.css', '.base{color:blue}');
    const image = await write(root, 'theme/asset/images/tile.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');

    const discovery = await discoverDirectories(root);
    expect(discovery.themes).toHaveLength(1);
    const css = discovery.themes[0].theme.css[0].css;
    expect(css).toContain('.base');
    expect(css).toContain('data:image/svg+xml;base64,');
    expect(css).not.toContain('@import');

    expect(discovery.assets.map((asset) => asset.path)).toEqual([
      'theme/asset/images/tile.svg',
      'theme/asset/parts/base.css',
      'theme/asset/theme.css',
    ]);
    expect(discovery.files).toContain(stylesheet);
    expect(discovery.files).toContain(imported);
    expect(discovery.files).toContain(image);
  });

  it('rejects remote url() and path traversal through the shared budgets', async () => {
    const remote = await project('remote-resource');
    const remoteStylesheet = await write(
      remote,
      'theme/remote/theme.css',
      '[data-rmd-theme="remote"]{background:url("https://example.com/a.png")}',
    );
    await expect(discoverDirectories(remote)).rejects.toThrow(/remote/);
    await expect(discoverDirectories(remote)).rejects.toThrow(remoteStylesheet);

    const escape = await project('traversal-resource');
    const escapeStylesheet = await write(
      escape,
      'theme/escape/theme.css',
      '@import "../../../../outside.css";',
    );
    await expect(discoverDirectories(escape)).rejects.toThrow(/outside the declared root/);
    await expect(discoverDirectories(escape)).rejects.toThrow(escapeStylesheet);
  });

  it('keeps scan locations inside the project root', async () => {
    const root = await project('path-constraints');
    await expect(discoverDirectories(root, { themeDir: '../outside' }))
      .rejects.toThrow(/themeDir .*outside the project root/);
    await expect(discoverDirectories(root, { pluginDir: resolve(base, 'elsewhere') }))
      .rejects.toThrow(/pluginDir .*outside the project root/);
    await expect(discoverDirectories(root, { themeDir: '  ' }))
      .rejects.toThrow(/themeDir must be a non-empty directory path/);
  });

  it('returns plugin entry paths without evaluating them and inlines component.css', async () => {
    const root = await project('plugin-package');
    const entry = await write(
      root,
      'plugin/slider/index.ts',
      'throw new Error("the discovery adapter must not evaluate plugin entries");',
    );
    await write(
      root,
      'plugin/slider/component.css',
      '.slider{gap:4px;background:url("./icon.svg")}',
    );
    const icon = await write(root, 'plugin/slider/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');

    const discovery = await discoverDirectories(root);
    expect(discovery.plugins).toHaveLength(1);
    expect(discovery.plugins[0].file).toBe(entry);
    expect(discovery.plugins[0].resources).toHaveLength(1);
    expect(discovery.plugins[0].resources[0].id).toBe('directory-plugin/slider.css');
    expect(discovery.plugins[0].resources[0].css).toContain('.slider');
    expect(discovery.plugins[0].resources[0].css).toContain('data:image/svg+xml;base64,');
    expect(discovery.files).toContain(entry);
    expect(discovery.files).toContain(join(root, 'plugin/slider/component.css'));
    expect(discovery.files).toContain(icon);
  });

  it('returns empty plugin resources when component.css is absent but still watches it', async () => {
    const root = await project('plugin-no-css');
    const entry = await write(root, 'plugin/plain/index.jsx', 'export default {}');

    const discovery = await discoverDirectories(root);
    expect(discovery.plugins).toEqual([Object.freeze({ file: entry, resources: Object.freeze([]) })]);
    expect(discovery.files).toContain(entry);
    expect(discovery.files).toContain(join(root, 'plugin/plain/component.css'));
  });
});
