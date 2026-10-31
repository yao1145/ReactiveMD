import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/reactive-md.mjs', import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', windowsHide: true,
});

let directory: string;
beforeAll(() => { directory = mkdtempSync(join(tmpdir(), 'rmd-init-')); });
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function target(name: string): string {
  return join(directory, name);
}

function read(root: string, relative: string): string {
  return readFileSync(join(root, relative), 'utf8');
}

describe('reactive-md init component', () => {
  it('rejects a name owned by the default preset before creating files', () => {
    const root = target('reserved-name');
    const result = run(['init', 'component', root, '--name', 'slider', '--yes']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('conflicts with a built-in');
    expect(existsSync(root)).toBe(false);
  });

  it('prints help for both init forms and rejects an unknown target', () => {
    const help = run(['init', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('reactive-md init component <directory>');
    expect(help.stdout).toContain('--capabilities');
    expect(help.stdout).toContain('--props');

    const subHelp = run(['init', 'component', '--help']);
    expect(subHelp.status).toBe(0);
    expect(subHelp.stdout).toContain('defineReactComponentPackage');

    const unknown = run(['init', 'plugin', target('unknown-target')]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('Unknown init target');
    expect(existsSync(target('unknown-target'))).toBe(false);

    const mainHelp = run(['--help']);
    expect(mainHelp.status).toBe(0);
    expect(mainHelp.stdout).toContain('init component <directory>');
  });

  it('creates a complete component package from explicit options', () => {
    const root = target('explicit-example-counter');
    const result = run([
      'init', 'component', root,
      '--name', 'example-counter',
      '--id', 'acme/example-counter',
      '--form', 'container',
      '--props', '{"label":{"kind":"string","default":"Count"},"limit":{"kind":"number","required":true,"integer":true,"min":1}}',
      '--capabilities', 'interactive,static,ssr',
      '--yes',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('reactive-md:');
    expect(result.stdout).toContain('Created component scaffold "example-counter"');

    const expectedTop = [
      '.gitignore', 'LICENSE', 'README.md', 'extensions.ts', 'main', 'package.json', 'scripts', 'src',
      'tsconfig.build.json', 'tsconfig.json', 'vite.config.ts',
    ];
    expect(readdirSync(root).sort()).toEqual(expectedTop.sort());
    for (const relative of [
      'src/manifest.ts', 'src/example-counter.tsx', 'src/example-counter.css', 'src/env.d.ts',
      'extensions.ts', 'main/index.html', 'main/main.tsx', 'main/sample.reactive.md',
      'scripts/build.mjs', 'scripts/verify.mjs', 'tsconfig.json',
      'tsconfig.build.json', 'vite.config.ts', 'README.md',
    ]) {
      expect(existsSync(join(root, relative)), relative).toBe(true);
    }

    const manifest = read(root, 'src/manifest.ts');
    expect(manifest).toContain("const id = \"acme/example-counter\"");
    expect(manifest).toContain("name: \"example-counter\"");
    expect(manifest).toContain("form: \"container\"");
    expect(manifest).toContain("protocol: 'reactive-md-component/v1'");
    expect(manifest).toContain('"label"');
    expect(manifest).toContain('"limit"');
    expect(manifest).toContain("structure: { rule: 'any', label: 'optional' }");
    expect(manifest).toContain('interactive: true');
    expect(manifest).toContain('static: true');
    expect(manifest).toContain('ssr: true');
    expect(manifest).toContain('offline: false');
    expect(manifest).not.toContain("from 'react'");
    expect(manifest).not.toContain('defineReactComponentPackage');

    const component = read(root, 'src/example-counter.tsx');
    expect(component).toContain("from 'reactive-md/react'");
    expect(component).toContain("from './manifest.js'");
    expect(component).toContain("from './example-counter.css?inline'");
    expect(component).toContain('export function ExampleCounterView(ctx: LocalComponentContext)');
    expect(component).toContain('defineReactComponentPackage({');
    expect(component).toContain('render: ExampleCounterView');
    expect(component).toContain('data-example-counter');
    expect(component).toContain('ctx.children.render()');
    expect(component).toContain('export const { definition, components, resources } = componentPackage;');

    const extensions = read(root, 'extensions.ts');
    expect(extensions).toContain("import { createReactHost } from 'reactive-md/react';");
    expect(extensions).toContain("import { componentPackage } from './src/example-counter.js';");
    expect(extensions).toContain('export const host = createReactHost({ packages: [componentPackage] });');

    const vite = read(root, 'vite.config.ts');
    expect(vite).toContain("import { reactiveMd } from 'reactive-md/vite';");
    expect(vite).toContain('reactiveMd({ extensions })');
    expect(vite).toContain('./extensions.ts');

    const main = read(root, 'main/main.tsx');
    expect(main).toContain("from 'virtual:reactive-md/host'");
    expect(main).toContain('host.reactConfig');
    expect(main).toContain('LocalReactiveDocument');
    expect(main).toContain("const mode: 'interactive' | 'static' = 'interactive';");

    const verify = read(root, 'scripts/verify.mjs');
    expect(verify).toContain('runLocalReactCompliance');
    expect(verify).toContain('runLocalManifestCompliance');
    expect(verify).toContain('createLocalComplianceReport');
    expect(verify).toContain('host.config');
    expect(verify).toContain('data-example-counter');

    const build = read(root, 'scripts/build.mjs');
    expect(build).toContain("path.join(root, 'extensions.ts')");
    expect(build).toContain("'src', 'example-counter.tsx'");
    expect(build).toContain('tsconfig.build.json');

    const sample = read(root, 'main/sample.reactive.md');
    expect(sample).toContain('<example-counter limit="1">');
    expect(sample).toContain('**Markdown** children render here.');
    expect(sample).toContain('</example-counter>');

    const packageInfo = JSON.parse(read(root, 'package.json'));
    expect(packageInfo).toMatchObject({
      name: 'reactive-md-example-counter-component',
      type: 'module',
      private: true,
    });
    expect(packageInfo.exports).toMatchObject({
      '.': { types: './dist/types/src/manifest.d.ts', import: './dist/node/manifest.js' },
      './react': { types: './dist/types/src/example-counter.d.ts', import: './dist/node/react.js' },
      './host': { types: './dist/types/extensions.d.ts', import: './dist/node/host.js' },
      './styles.css': './src/example-counter.css',
    });
    expect(Object.keys(packageInfo.peerDependencies).sort())
      .toEqual(['react', 'react-dom', 'reactive-md']);
    expect(packageInfo.scripts.test).toContain('scripts/verify.mjs');
    expect(packageInfo.scripts.build).toContain('scripts/build.mjs');

    const readme = read(root, 'README.md');
    expect(readme).toContain('reactive-md-0.6.1.tgz');
    expect(readme).toContain('npm run dev');
    expect(readme).toContain('src/example-counter.tsx');
    expect(readme).toContain('## Edit these files');
    expect(readme).toContain('build plumbing');
  });

  it('uses documented defaults and derives the tag from the directory', () => {
    const root = target('Default_Widget');
    const result = run(['init', 'component', root]);
    expect(result.status, result.stderr).toBe(0);

    const manifest = read(root, 'src/manifest.ts');
    expect(manifest).toContain("const id = \"local/default-widget\"");
    expect(manifest).toContain("name: \"default-widget\"");
    expect(manifest).toContain("form: \"leaf\"");
    expect(manifest).toContain('props: {}');
    expect(manifest).toContain('interactive: true');
    expect(manifest).toContain('static: true');
    expect(manifest).toContain('ssr: true');
    expect(manifest).toContain('offline: true');

    expect(existsSync(join(root, 'src/default-widget.tsx'))).toBe(true);
    expect(read(root, 'src/default-widget.tsx')).not.toContain('-children');
    expect(read(root, 'main/main.tsx')).toContain("= 'interactive';");
    expect(JSON.parse(read(root, 'package.json')).name).toBe('reactive-md-default-widget-component');
  });

  it('generates inline form in an inline element and container form in a block element', () => {
    const inlineRoot = target('inline-note');
    expect(run(['init', 'component', inlineRoot, '--name', 'note', '--form', 'inline']).status).toBe(0);
    const inlineManifest = read(inlineRoot, 'src/manifest.ts');
    expect(inlineManifest).toContain("structure: { rule: 'inline' }");
    const inlineComponent = read(inlineRoot, 'src/note.tsx');
    expect(inlineComponent).toContain('<span className="note" data-note role="group">');
    expect(inlineComponent).toContain('<span className="note-children">{ctx.children.render()}</span>');
    expect(read(inlineRoot, 'main/sample.reactive.md'))
      .toContain('Preview text before <note>inline content</note> and after.');

    const staticRoot = target('static-note');
    expect(run([
      'init', 'component', staticRoot, '--name', 'note', '--capabilities', 'static',
    ]).status).toBe(0);
    expect(read(staticRoot, 'main/main.tsx')).toContain("= 'static';");
    const verify = read(staticRoot, 'scripts/verify.mjs');
    expect(verify).toContain("['static', 'ssr'].filter");
  });

  it('writes ready-to-use values for required props without defaults', () => {
    const root = target('required-props');
    const result = run([
      'init', 'component', root,
      '--name', 'field',
      '--props', JSON.stringify({
        label: { kind: 'string', required: true, pattern: '^[A-Za-z]+$' },
        count: { kind: 'number', required: true, integer: true, min: 2 },
        active: { kind: 'boolean', required: true },
        mode: { kind: 'enum', required: true, enum: ['compact', 'wide'] },
        optional: { kind: 'string', default: 'hello' },
      }),
    ]);
    expect(result.status, result.stderr).toBe(0);
    const sample = read(root, 'main/sample.reactive.md');
    expect(sample).toContain('label="example"');
    expect(sample).toContain('count="2"');
    expect(sample).toContain('active="true"');
    expect(sample).toContain('mode="compact"');
    expect(sample).not.toContain('optional=');
  });

  it('refuses an existing directory and leaves its contents untouched', () => {
    const root = target('existing');
    mkdirSync(root);
    writeFileSync(join(root, 'keep.txt'), 'keep me');

    const result = run(['init', 'component', root, '--name', 'thing']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Refusing to overwrite existing path');
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('keep me');
    expect(readdirSync(root)).toEqual(['keep.txt']);
  });

  it('refuses an existing file and leaves it untouched', () => {
    const file = target('existing-file');
    writeFileSync(file, 'not a directory');

    const result = run(['init', 'component', file, '--name', 'thing']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Refusing to overwrite existing path');
    expect(readFileSync(file, 'utf8')).toBe('not a directory');
  });

    const cases: Array<[string, string[]]> = [
      ['invalid-name-uppercase', ['--name', 'Thing']],
      ['invalid-name-leading-digit', ['--name', '1thing']],
      ['invalid-name-spaces', ['--name', 'my thing']],
      ['invalid-id', ['--id', 'Bad/Id']],
      ['invalid-form', ['--form', 'block']],
      ['invalid-props-json', ['--props', 'not json']],
      ['invalid-props-array', ['--props', '[]']],
      ['invalid-props-null', ['--props', 'null']],
      ['invalid-prop-name', ['--props', '{"Bad":{} }']],
      ['invalid-prop-kind', ['--props', '{"x":{"kind":"wat"}}']],
      ['invalid-prop-range', ['--props', '{"x":{"kind":"number","min":5,"max":1}}']],
      ['invalid-prop-default', ['--props', '{"x":{"kind":"string","default":1}}']],
      ['invalid-prop-enum', ['--props', '{"x":{"kind":"enum","enum":[]}}']],
      ['invalid-capability', ['--capabilities', 'interactive,banana']],
      ['duplicate-capability', ['--capabilities', 'static,static']],
      ['empty-capability', ['--capabilities', '']],
      ['no-render-capability', ['--capabilities', 'ssr']],
      ['unknown-option', ['--bogus']],
      ['missing-value', ['--name']],
      ['boolean-value', ['--yes=true']],
    ];
  it.each(cases)('rejects %s before creating the target directory', (name, args) => {
    const root = target(name);
    const result = run(['init', 'component', root, ...args]);
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(existsSync(root)).toBe(false);
  });

  it('rejects missing or multiple target directories', () => {
    const extra = run(['init', 'component', target('one'), target('two')]);
    expect(extra.status).toBe(2);
    expect(existsSync(target('one'))).toBe(false);
    expect(existsSync(target('two'))).toBe(false);
    const missing = run(['init', 'component']);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('Missing component directory');
  });

  it('accepts --option=value and --yes without prompting', () => {
    const root = target('equals');
    const result = run([
      'init', 'component', root, '--name=tagged', '--form=leaf', '--yes',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(read(root, 'src/manifest.ts')).toContain("name: \"tagged\"");
    expect(read(root, 'src/manifest.ts')).toContain("const id = \"local/tagged\"");
  });

  it('treats paths after -- literally', () => {
    const root = target('--literal-name');
    const result = run(['init', 'component', '--', root]);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(root, 'src/manifest.ts'))).toBe(true);
  });
});
