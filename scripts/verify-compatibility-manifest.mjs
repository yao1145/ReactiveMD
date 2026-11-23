import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Check the machine-readable compatibility manifest against the engine
 * constants, the editor package and the Demo vendor candidates.
 */

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = path.resolve(root, '..');
const requireWorkspace = process.argv.includes('--require-workspace');
const manifestPath = 'docs/compatibility/compatibility-manifest.json';
const failures = [];
const checks = [];
const skips = [];

const fail = (message) => failures.push(message);
const pass = (message) => checks.push(message);
const skip = (message) => skips.push(message);

async function readText(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function readTextAt(absolute) {
  return readFile(absolute, 'utf8');
}

async function readJson(relative) {
  return JSON.parse(await readText(relative));
}

async function readJsonAt(absolute) {
  return JSON.parse(await readTextAt(absolute));
}

async function sha256(absolute) {
  return createHash('sha256').update(await readFile(absolute)).digest('hex');
}

function constant(source, name, file) {
  const match = new RegExp(`export const ${name}\\s*=\\s*'([^']+)'`).exec(source);
  if (!match) {
    fail(`${file} does not export ${name} as a string literal.`);
    return null;
  }
  return match[1];
}

function equal(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(`${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`);
}

function truth(value, label, reason) {
  if (value) pass(label);
  else fail(`${label}: ${reason}`);
}

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function satisfiesCaret(version, range) {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(String(range).trim());
  const actual = versionParts(version);
  if (!match || !actual) return false;
  const base = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (compareVersions(actual, base) < 0) return false;
  const upper = base[0] > 0
    ? [base[0] + 1, 0, 0]
    : base[1] > 0
      ? [0, base[1] + 1, 0]
      : [0, 0, base[2] + 1];
  return compareVersions(actual, upper) < 0;
}

function versionFromTarball(filename, packageName) {
  const pattern = new RegExp(`^${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(.+)-([0-9a-f]+)\\.tgz$`);
  return pattern.exec(filename)?.[1] ?? null;
}

const manifest = await readJson(manifestPath);
equal(manifest.schema, 'reactive-md-compatibility/v1', 'manifest schema');

const enginePackage = await readJson('package.json');
equal(enginePackage.name, manifest.engine.name, 'engine package name');
equal(enginePackage.version, manifest.engine.version, 'engine version');
equal(enginePackage.peerDependencies?.react, manifest.install.packages.react, 'engine React peer');
equal(enginePackage.peerDependencies?.['react-dom'], manifest.install.packages['react-dom'], 'engine react-dom peer');
equal(enginePackage.peerDependencies?.vite, manifest.install.optional.vite, 'engine Vite peer');

const sdkSource = await readText('src/sdk/version.ts');
equal(constant(sdkSource, 'LOCAL_SDK_VERSION', 'src/sdk/version.ts'), manifest.protocols.sdk, 'SDK protocol');
const syntaxSource = await readText('src/local/types.ts');
equal(constant(syntaxSource, 'LOCAL_SYNTAX_VERSION', 'src/local/types.ts'), manifest.protocols.syntax, 'syntax revision');
const themeSource = await readText('src/themes/document-theme.ts');
equal(constant(themeSource, 'LOCAL_THEME_PROTOCOL', 'src/themes/document-theme.ts'), manifest.protocols.theme, 'theme protocol');

const componentDocs = [
  ['docs/development/component-protocol-en.md', /Protocol revision\s+`([^`]+)`\s*·\s*applicable syntax\s+`([^`]+)`\s*·\s*current package version\s+`([^`]+)`/],
  ['docs/development/component-protocol-ch.md', /协议修订\s+`([^`]+)`\s*·\s*适用语法\s+`([^`]+)`\s*·\s*当前包版本\s+`([^`]+)`/],
];
for (const [file, pattern] of componentDocs) {
  const match = pattern.exec(await readText(file));
  if (!match) {
    fail(`${file} does not contain the protocol revision header.`);
    continue;
  }
  equal(match[1], manifest.protocols.component, `${file} component protocol`);
  equal(match[2], manifest.protocols.syntax, `${file} syntax revision`);
  equal(match[3], manifest.engine.version, `${file} package version`);
}

const editorRoot = path.join(workspace, manifest.editor.repository);
if (!existsSync(editorRoot)) {
  const message = `editor checkout is missing at ${manifest.editor.repository}.`;
  if (requireWorkspace) fail(`${message} Run from the workspace or omit --require-workspace.`);
  else skip(message);
} else {
  const editorPackage = await readJsonAt(path.join(editorRoot, 'package.json'));
  equal(editorPackage.name, manifest.editor.name, 'editor package name');
  equal(editorPackage.version, manifest.editor.version, 'editor version');
  equal(editorPackage.peerDependencies?.['reactive-md'], manifest.editor.enginePeer, 'editor engine peer');
  truth(satisfiesCaret(manifest.engine.version, manifest.editor.enginePeer), 'engine version satisfies editor peer', `${manifest.engine.version} is outside ${manifest.editor.enginePeer}.`);
  equal(editorPackage.peerDependencies?.react, manifest.install.packages.react, 'editor React peer');
  equal(editorPackage.peerDependencies?.['react-dom'], manifest.install.packages['react-dom'], 'editor react-dom peer');

  const candidate = editorPackage.devDependencies?.['reactive-md'];
  if (typeof candidate !== 'string' || !candidate.startsWith('file:')) {
    fail('editor devDependencies.reactive-md is not a file: candidate.');
  } else {
    const relative = candidate.slice('file:'.length);
    const candidatePath = path.join(editorRoot, relative);
    if (!existsSync(candidatePath)) {
      fail(`editor engine candidate is missing: ${relative}.`);
    } else {
      const version = versionFromTarball(path.basename(candidatePath), 'reactive-md');
      truth(version !== null && satisfiesCaret(version, manifest.editor.enginePeer), 'editor engine candidate satisfies peer', `${version ?? 'unknown'} is outside ${manifest.editor.enginePeer}.`);
    }
  }
}

const demoRoot = path.join(workspace, manifest.demo.repository);
if (!existsSync(demoRoot)) {
  const message = `demo checkout is missing at ${manifest.demo.repository}.`;
  if (requireWorkspace) fail(`${message} Run from the workspace or omit --require-workspace.`);
  else skip(message);
} else {
  const demoPackage = await readJsonAt(path.join(demoRoot, 'package.json'));
  const candidates = [
    ['engine', manifest.demo.candidates.engine, manifest.engine.version, manifest.engine.name],
    ['editor', manifest.demo.candidates.editor, manifest.editor.version, manifest.editor.name],
  ];
  for (const [role, candidate, expectedVersion, expectedName] of candidates) {
    equal(candidate.package, expectedName, `demo ${role} candidate package`);
    equal(candidate.version, expectedVersion, `demo ${role} candidate version`);
    equal(demoPackage.dependencies?.[candidate.package], `file:${candidate.tarball}`, `demo ${role} candidate path`);
    const tarballPath = path.join(demoRoot, candidate.tarball);
    if (!existsSync(tarballPath)) {
      fail(`demo ${role} candidate is missing: ${candidate.tarball}.`);
      continue;
    }
    equal(await sha256(tarballPath), candidate.sha256, `demo ${role} candidate SHA256`);
    equal(versionFromTarball(path.basename(candidate.tarball), candidate.package), candidate.version, `demo ${role} tarball version`);
  }
  const demoReact = demoPackage.dependencies?.react ?? demoPackage.devDependencies?.react;
  if (typeof demoReact === 'string') {
    truth(satisfiesCaret(demoReact, manifest.install.packages.react), 'demo React satisfies recommended range', `${demoReact} is outside ${manifest.install.packages.react}.`);
  } else {
    fail('demo package.json does not pin React.');
  }
}

const expectedCommand = `npm install ${Object.entries(manifest.install.packages)
  .map(([name, range]) => `${name}@${range}`)
  .join(' ')}`;
equal(manifest.install.command, expectedCommand, 'recommended install command');
equal(manifest.install.packages['reactive-md'], manifest.engine.version, 'install engine version');
equal(manifest.install.packages['reactive-md-editor'], manifest.editor.version, 'install editor version');
equal(manifest.install.optional.vite, enginePackage.peerDependencies?.vite, 'install optional Vite peer');

for (const message of skips) process.stdout.write(`skip: ${message}\n`);
if (failures.length > 0) {
  for (const message of failures) process.stderr.write(`compatibility check failed: ${message}\n`);
  process.exitCode = 1;
} else {
  for (const message of checks) process.stdout.write(`ok: ${message}\n`);
  process.stdout.write(`Compatibility manifest verified: ${manifest.engine.name} ${manifest.engine.version}, ${manifest.editor.name} ${manifest.editor.version}, SDK ${manifest.protocols.sdk}, syntax ${manifest.protocols.syntax}, component ${manifest.protocols.component}, theme ${manifest.protocols.theme}.\n`);
}