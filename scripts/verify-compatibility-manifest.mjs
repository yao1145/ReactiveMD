import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Check the machine-readable compatibility manifest against its JSON Schema,
 * the engine constants, installed runtimes, the editor package and the Demo
 * vendor candidates.
 */

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = path.resolve(root, '..');
const requireWorkspace = process.argv.includes('--require-workspace');
const manifestPath = 'docs/compatibility/compatibility-manifest.json';
const schemaPath = 'docs/compatibility/compatibility-manifest.schema.json';
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

async function readJsonIfExistsAt(absolute) {
  return existsSync(absolute) ? readJsonAt(absolute) : null;
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

function satisfiesMinimum(version, range) {
  const match = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(String(range ?? '').trim());
  const actual = versionParts(version);
  if (!match || !actual) return false;
  return compareVersions(actual, [Number(match[1]), Number(match[2]), Number(match[3])]) >= 0;
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

function sha512Integrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function checkContentAddress(tarball, digest, label) {
  const prefix = /-([0-9a-f]{12})\.tgz$/.exec(path.basename(tarball))?.[1] ?? null;
  truth(prefix !== null, `${label} tarball name carries a content address`, `${tarball} does not end with a 12-character SHA256 prefix.`);
  if (prefix !== null) {
    truth(digest.startsWith(prefix), `${label} tarball name matches SHA256`, `${prefix} is not a prefix of ${digest}.`);
  }
}

function normalizeSpec(value) {
  return typeof value === 'string' ? value.split('\\').join('/') : value;
}

function checkLockEntry(lock, packageName, expectations, label) {
  const key = `node_modules/${packageName}`;
  const entry = lock?.packages?.[key];
  if (!isPlainObject(entry)) {
    fail(`${label} lock is missing packages["${key}"].`);
    return;
  }
  if (typeof expectations.version === 'string') {
    equal(entry.version, expectations.version, `${label} lock version`);
  }
  if (typeof expectations.resolved === 'string') {
    const resolved = normalizeSpec(entry.resolved);
    truth(typeof entry.resolved === 'string' && entry.resolved.startsWith('file:'), `${label} lock resolved is a file: spec`, `${JSON.stringify(entry.resolved)} is not a file: spec.`);
    equal(resolved, normalizeSpec(expectations.resolved), `${label} lock resolved`);
    const lockRoot = lock?.packages?.[''] ?? {};
    const declared = lockRoot.dependencies?.[packageName] ?? lockRoot.devDependencies?.[packageName];
    if (declared !== undefined) {
      equal(normalizeSpec(declared), normalizeSpec(expectations.resolved), `${label} lock root dependency`);
    }
  }
  if (typeof expectations.integrity === 'string') {
    equal(entry.integrity, expectations.integrity, `${label} lock integrity`);
  }
}

function readTarString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return slice.subarray(0, zero === -1 ? slice.length : zero).toString('utf8').trim();
}

async function readTarballPackageJson(absolute) {
  const archive = gunzipSync(await readFile(absolute));
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entry = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readTarString(header, 124, 12), 8) || 0;
    const dataStart = offset + 512;
    if (entry === 'package/package.json') {
      return JSON.parse(archive.subarray(dataStart, dataStart + size).toString('utf8'));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveRef(rootSchema, reference) {
  if (!reference.startsWith('#/')) return null;
  return reference
    .slice(2)
    .split('/')
    .reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), rootSchema);
}

function validateInstance(instance, schema, rootSchema, pointer, errors) {
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(rootSchema, schema.$ref);
    if (!target) {
      errors.push(`${pointer}: unresolved schema reference ${schema.$ref}.`);
      return;
    }
    validateInstance(instance, target, rootSchema, pointer, errors);
    return;
  }
  if ('const' in schema && instance !== schema.const) {
    errors.push(`${pointer}: expected ${JSON.stringify(schema.const)}, found ${JSON.stringify(instance)}.`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(instance)) {
    errors.push(`${pointer}: expected one of ${schema.enum.join(', ')}, found ${JSON.stringify(instance)}.`);
    return;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = types.some((type) => {
      if (type === 'object') return isPlainObject(instance);
      if (type === 'array') return Array.isArray(instance);
      if (type === 'string') return typeof instance === 'string';
      if (type === 'boolean') return typeof instance === 'boolean';
      if (type === 'number') return typeof instance === 'number';
      if (type === 'integer') return Number.isInteger(instance);
      return false;
    });
    if (!matches) {
      errors.push(`${pointer}: expected ${types.join(' or ')}, found ${Array.isArray(instance) ? 'array' : instance === null ? 'null' : typeof instance}.`);
      return;
    }
  }
  if (typeof instance === 'string') {
    if (typeof schema.minLength === 'number' && instance.length < schema.minLength) {
      errors.push(`${pointer}: expected at least ${schema.minLength} characters.`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(instance)) {
      errors.push(`${pointer}: does not match ${schema.pattern}.`);
    }
  }
  if (Array.isArray(instance)) {
    if (typeof schema.minItems === 'number' && instance.length < schema.minItems) {
      errors.push(`${pointer}: expected at least ${schema.minItems} items.`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      instance.forEach((item, index) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) errors.push(`${pointer}[${index}]: duplicate item.`);
        seen.add(key);
      });
    }
    if (schema.items) {
      instance.forEach((item, index) => validateInstance(item, schema.items, rootSchema, `${pointer}[${index}]`, errors));
    }
  }
  if (isPlainObject(instance)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in instance)) errors.push(`${pointer}: missing required property "${key}".`);
      }
    }
    if (schema.properties) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in instance) validateInstance(instance[key], childSchema, rootSchema, `${pointer}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(instance)) {
        if (!allowed.has(key)) errors.push(`${pointer}: unexpected property "${key}".`);
      }
    }
  }
}

const schema = await readJson(schemaPath);
const manifest = await readJson(manifestPath);
const schemaErrors = [];
validateInstance(manifest, schema, schema, 'manifest', schemaErrors);
if (schemaErrors.length > 0) {
  for (const message of schemaErrors) process.stderr.write(`compatibility check failed: ${message}\n`);
  process.exit(1);
}
pass(`manifest matches ${path.basename(schemaPath)}`);

const enginePackage = await readJson('package.json');
equal(enginePackage.name, manifest.engine.name, 'engine package name');
equal(enginePackage.version, manifest.engine.version, 'engine version');
equal(enginePackage.peerDependencies?.react, manifest.runtimes.react.declared, 'engine React peer');
equal(enginePackage.peerDependencies?.['react-dom'], manifest.runtimes['react-dom'].declared, 'engine react-dom peer');
equal(enginePackage.peerDependencies?.vite, manifest.runtimes.vite.declared, 'engine Vite peer');
equal(enginePackage.devDependencies?.react, manifest.runtimes.react.tested, 'engine React dev pin');
equal(enginePackage.devDependencies?.['react-dom'], manifest.runtimes['react-dom'].tested, 'engine react-dom dev pin');
equal(enginePackage.devDependencies?.vite, manifest.runtimes.vite.tested, 'engine Vite dev pin');
truth(satisfiesMinimum(manifest.verified.node, enginePackage.engines?.node), 'verified Node version satisfies engines.node', `${manifest.verified.node} is outside ${enginePackage.engines?.node}.`);
for (const name of ['react', 'react-dom', 'vite']) {
  truth(satisfiesCaret(manifest.runtimes[name].tested, manifest.runtimes[name].declared), `${name} tested version satisfies declared range`, `${manifest.runtimes[name].tested} is outside ${manifest.runtimes[name].declared}.`);
}

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

async function checkInstalledRuntime(directory, name, label) {
  const installed = await readJsonIfExistsAt(path.join(directory, 'node_modules', name, 'package.json'));
  if (installed === null) {
    fail(`${label} does not install ${name}.`);
    return;
  }
  equal(installed.version, manifest.runtimes[name].tested, `${label} ${name} tested version`);
}

await checkInstalledRuntime(root, 'react', 'engine');
await checkInstalledRuntime(root, 'react-dom', 'engine');
await checkInstalledRuntime(root, 'vite', 'engine');

const editorRoot = path.join(workspace, manifest.editor.repository);
let editorEngineDigest = null;
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
  equal(editorPackage.peerDependencies?.react, manifest.runtimes.react.declared, 'editor React peer');
  equal(editorPackage.peerDependencies?.['react-dom'], manifest.runtimes['react-dom'].declared, 'editor react-dom peer');
  equal(editorPackage.devDependencies?.react, manifest.runtimes.react.tested, 'editor React dev pin');
  equal(editorPackage.devDependencies?.['react-dom'], manifest.runtimes['react-dom'].tested, 'editor react-dom dev pin');
  equal(editorPackage.devDependencies?.vite, manifest.runtimes.vite.tested, 'editor Vite dev pin');
  await checkInstalledRuntime(editorRoot, 'react', 'editor');
  await checkInstalledRuntime(editorRoot, 'react-dom', 'editor');
  await checkInstalledRuntime(editorRoot, 'vite', 'editor');

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
      const bytes = await readFile(candidatePath);
      const digest = createHash('sha256').update(bytes).digest('hex');
      editorEngineDigest = digest;
      checkContentAddress(relative, digest, 'editor engine candidate');
      equal(digest, manifest.demo.candidates.engine.sha256, 'editor engine candidate matches demo engine candidate SHA256');
      const internal = await readTarballPackageJson(candidatePath).catch((error) => {
        fail(`editor engine candidate tarball cannot be read: ${error.message}.`);
        return null;
      });
      if (internal !== null) {
        equal(internal.name, manifest.engine.name, 'editor engine candidate package name');
        equal(internal.version, manifest.engine.version, 'editor engine candidate package version');
        if (version !== null) equal(version, internal.version, 'editor engine candidate tarball version');
      } else {
        fail('editor engine candidate tarball does not contain package/package.json.');
      }
      const editorLock = await readJsonIfExistsAt(path.join(editorRoot, 'package-lock.json'));
      if (editorLock === null) {
        fail(`editor package-lock.json is missing at ${manifest.editor.repository}.`);
      } else {
        checkLockEntry(editorLock, 'reactive-md', {
          version: internal?.version ?? version ?? undefined,
          resolved: candidate,
          integrity: sha512Integrity(bytes),
        }, 'editor engine candidate');
      }
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
  equal(demoPackage.dependencies?.react, manifest.runtimes.react.tested, 'demo React pin');
  equal(demoPackage.dependencies?.['react-dom'], manifest.runtimes['react-dom'].tested, 'demo react-dom pin');
  equal(demoPackage.devDependencies?.vite, manifest.runtimes.vite.tested, 'demo Vite dev pin');
  await checkInstalledRuntime(demoRoot, 'react', 'demo');
  await checkInstalledRuntime(demoRoot, 'react-dom', 'demo');
  await checkInstalledRuntime(demoRoot, 'vite', 'demo');

  const demoLock = await readJsonIfExistsAt(path.join(demoRoot, 'package-lock.json'));
  if (demoLock === null) fail(`demo package-lock.json is missing at ${manifest.demo.repository}.`);

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
    const bytes = await readFile(tarballPath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    equal(digest, candidate.sha256, `demo ${role} candidate SHA256`);
    checkContentAddress(candidate.tarball, digest, `demo ${role} candidate`);
    equal(versionFromTarball(path.basename(candidate.tarball), candidate.package), candidate.version, `demo ${role} tarball version`);
    let internal = null;
    try {
      internal = await readTarballPackageJson(tarballPath);
    } catch (error) {
      fail(`demo ${role} tarball cannot be read: ${error.message}.`);
      continue;
    }
    if (internal === null) {
      fail(`demo ${role} tarball does not contain package/package.json.`);
      continue;
    }
    equal(internal.name, candidate.package, `demo ${role} tarball package name`);
    equal(internal.version, candidate.version, `demo ${role} tarball package version`);
    if (role === 'editor') {
      equal(internal.peerDependencies?.['reactive-md'], manifest.editor.enginePeer, 'demo editor tarball engine peer');
    }
    if (demoLock !== null) {
      checkLockEntry(demoLock, candidate.package, {
        version: internal.version,
        resolved: demoPackage.dependencies?.[candidate.package],
        integrity: sha512Integrity(bytes),
      }, `demo ${role} candidate`);
    }
    if (role === 'engine' && editorEngineDigest !== null) {
      equal(editorEngineDigest, digest, 'editor and demo engine candidate bytes share SHA256');
    }
  }
}

const expectedCommand = `npm install ${Object.entries(manifest.install.packages)
  .map(([name, range]) => `${name}@${range}`)
  .join(' ')}`;
equal(manifest.install.command, expectedCommand, 'recommended install command');
equal(manifest.install.packages['reactive-md'], manifest.engine.version, 'install engine version');
equal(manifest.install.packages['reactive-md-editor'], manifest.editor.version, 'install editor version');
equal(manifest.install.packages.react, manifest.runtimes.react.declared, 'install React range');
equal(manifest.install.packages['react-dom'], manifest.runtimes['react-dom'].declared, 'install react-dom range');
equal(manifest.install.optional.vite, manifest.runtimes.vite.declared, 'install Vite range');

if (manifest.previous !== undefined) {
  const previous = manifest.previous;
  truth(satisfiesCaret(previous.engine, previous.enginePeer), 'previous engine satisfies previous editor peer', `${previous.engine} is outside ${previous.enginePeer}.`);
}

for (const message of skips) process.stdout.write(`skip: ${message}\n`);
if (failures.length > 0) {
  for (const message of failures) process.stderr.write(`compatibility check failed: ${message}\n`);
  process.exitCode = 1;
} else {
  for (const message of checks) process.stdout.write(`ok: ${message}\n`);
  process.stdout.write(`Compatibility manifest verified: ${manifest.engine.name} ${manifest.engine.version}, ${manifest.editor.name} ${manifest.editor.version}, Node ${manifest.verified.node}, React ${manifest.runtimes.react.tested}, React DOM ${manifest.runtimes['react-dom'].tested}, Vite ${manifest.runtimes.vite.tested}, SDK ${manifest.protocols.sdk}, syntax ${manifest.protocols.syntax}, component ${manifest.protocols.component}, theme ${manifest.protocols.theme}.\n`);
}