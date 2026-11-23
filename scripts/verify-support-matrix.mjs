import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Verify the locally executable rows of the support matrix. The manifest below
 * is the single source of truth for the CLI listing, the docs check and the
 * evidence document. Nothing here touches CI.
 */

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const schema = 'reactive-md-support-evidence/v1';
const defaultEvidencePath = path.join(root, 'artifacts', 'support', 'latest.json');
const matrixDocs = ['docs/compatibility/support-matrix-en.md', 'docs/compatibility/support-matrix-ch.md'];
const profileNames = ['fast', 'release', 'all'];

const usage = `Usage: node scripts/verify-support-matrix.mjs [options]

Options:
  --list               Print every support check and exit without running any.
  --profile <name>     Select fast (default), release, or all checks.
  --only <ids>         Run only the comma-separated check ids, ignoring the profile.
  --include-external   Also run checks owned by the demo and editor repositories.
  --json               Print the evidence document to stdout.
  --out <path>         Write evidence to a custom path (default artifacts/support/latest.json).
  --help               Print this help and exit.
`;

class UsageError extends Error {}

function versionCore(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(version).trim());
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] };
}

function compareVersions(left, right) {
  const a = versionCore(left);
  const b = versionCore(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] < b.parts[index] ? -1 : 1;
  }
  if (a.prerelease === undefined && b.prerelease === undefined) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return a.prerelease === b.prerelease ? 0 : a.prerelease < b.prerelease ? -1 : 1;
}

function caretUpperBound(base) {
  const [major, minor, patch] = base.parts;
  if (major > 0) return [major + 1, 0, 0];
  if (minor > 0) return [0, minor + 1, 0];
  return [0, 0, patch + 1];
}

function satisfiesRange(version, range) {
  const text = String(range).trim();
  if (!versionCore(version)) return null;
  if (text.startsWith('>=')) {
    const order = compareVersions(version, text.slice(2));
    return order === null ? null : order >= 0;
  }
  if (text.startsWith('^')) {
    const base = versionCore(text.slice(1));
    if (!base) return null;
    if (compareVersions(version, text.slice(1)) < 0) return false;
    const [major, minor, patch] = caretUpperBound(base);
    return compareVersions(version, `${major}.${minor}.${patch}`) < 0;
  }
  return null;
}

async function readText(relative) {
  try {
    return await readFile(path.join(root, relative), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJson(relative) {
  const text = await readText(relative);
  return text === null ? null : JSON.parse(text);
}

async function checkNodeRuntime(context) {
  const range = context.packageInfo.engines?.node;
  const actual = process.versions.node;
  const details = { required: typeof range === 'string' ? range : null, actual, platform: process.platform, arch: process.arch };
  if (typeof range !== 'string' || range.length === 0) {
    return { status: 'fail', reason: 'package.json does not declare engines.node.', details };
  }
  const satisfied = satisfiesRange(actual, range);
  if (satisfied === null) return { status: 'fail', reason: `unsupported Node.js range "${range}".`, details };
  if (!satisfied) return { status: 'fail', reason: `Node.js ${actual} does not satisfy ${range}.`, details };
  return { status: 'pass', details };
}

async function checkPeerRange(context, dependency) {
  const range = context.packageInfo.peerDependencies?.[dependency];
  const installedFile = await readJson(`node_modules/${dependency}/package.json`);
  const installed = typeof installedFile?.version === 'string' ? installedFile.version : null;
  const details = { dependency, range: typeof range === 'string' ? range : null, installed };
  if (typeof range !== 'string' || range.length === 0) {
    return { status: 'fail', reason: `package.json does not declare peerDependencies.${dependency}.`, details };
  }
  if (installed === null) {
    return { status: 'fail', reason: `node_modules/${dependency}/package.json is missing; run npm ci.`, details };
  }
  const satisfied = satisfiesRange(installed, range);
  if (satisfied === null) return { status: 'fail', reason: `unsupported ${dependency} range "${range}".`, details };
  if (!satisfied) return { status: 'fail', reason: `${dependency} ${installed} does not satisfy ${range}.`, details };
  return { status: 'pass', details };
}

async function checkDocsMatrix() {
  const ids = manifest.map((check) => check.id);
  const documents = [];
  for (const relative of matrixDocs) {
    const text = await readText(relative);
    if (text === null) {
      documents.push({ path: relative, present: false, missing: ids });
      continue;
    }
    documents.push({ path: relative, present: true, missing: ids.filter((id) => !text.includes(id)) });
  }
  const missingFiles = documents.filter((document) => !document.present).map((document) => document.path);
  const missingIds = [...new Set(documents.flatMap((document) => document.missing))];
  const details = { documents };
  if (missingFiles.length === 0 && missingIds.length === 0) return { status: 'pass', details };
  const reasons = [];
  if (missingFiles.length > 0) reasons.push(`missing files: ${missingFiles.join(', ')}`);
  if (missingIds.length > 0) reasons.push(`check ids missing from the matrix: ${missingIds.join(', ')}`);
  return { status: 'fail', reason: `support matrix docs are incomplete; ${reasons.join('; ')}.`, details };
}

const manifest = [
  {
    id: 'node-runtime',
    label: 'Node.js 22.12+',
    owner: 'engine',
    profile: 'fast',
    kind: 'built-in',
    description: 'read engines.node from package.json and compare the running Node.js version.',
    run: checkNodeRuntime,
  },
  {
    id: 'react-range',
    label: 'React 19.x',
    owner: 'engine',
    profile: 'fast',
    kind: 'built-in',
    description: 'read peerDependencies.react and node_modules/react/package.json.',
    run: (context) => checkPeerRange(context, 'react'),
  },
  {
    id: 'vite-range',
    label: 'Vite 8.x',
    owner: 'engine',
    profile: 'fast',
    kind: 'built-in',
    description: 'read peerDependencies.vite and node_modules/vite/package.json.',
    run: (context) => checkPeerRange(context, 'vite'),
  },
  {
    id: 'docs-matrix',
    label: 'Support matrix docs',
    owner: 'engine',
    profile: 'fast',
    kind: 'built-in',
    description: 'require both support matrix documents to mention every check id.',
    run: checkDocsMatrix,
  },
  {
    id: 'worker-unit',
    label: 'Local compile worker tests',
    owner: 'engine',
    profile: 'fast',
    kind: 'command',
    command: 'npm run test -- tests/local-compile-worker.test.ts',
  },
  {
    id: 'compatibility-manifest',
    label: 'Compatibility manifest',
    owner: 'engine',
    profile: 'release',
    kind: 'command',
    command: 'node scripts/verify-compatibility-manifest.mjs --require-workspace',
  },
  {
    id: 'ssr-static',
    label: 'SSR static rendering',
    owner: 'engine',
    profile: 'release',
    kind: 'command',
    command: 'npm run test:boundary',
    note: 'requires npm run build first',
    requires: [{ path: 'dist-library', hint: 'run npm run build first' }],
  },
  {
    id: 'chromium-core',
    label: 'Chromium browser core',
    owner: 'engine',
    profile: 'release',
    kind: 'command',
    command: 'node scripts/verify-required-form-browser.mjs',
    env: { PLAYWRIGHT_ENGINE: 'chromium' },
  },
  {
    id: 'firefox-core',
    label: 'Firefox browser core',
    owner: 'engine',
    profile: 'release',
    kind: 'command',
    command: 'node scripts/verify-required-form-browser.mjs',
    env: { PLAYWRIGHT_ENGINE: 'firefox' },
  },
  {
    id: 'webkit-core',
    label: 'WebKit browser core',
    owner: 'engine',
    profile: 'release',
    kind: 'command',
    command: 'node scripts/verify-required-form-browser.mjs',
    env: { PLAYWRIGHT_ENGINE: 'webkit' },
  },
  {
    id: 'pdf-static',
    label: 'PDF export',
    owner: 'engine',
    profile: 'release',
    kind: 'command',
    command: 'node scripts/verify-pdf.mjs',
  },
  {
    id: 'demo-smoke',
    label: 'Demo browser smoke',
    owner: 'demo',
    profile: 'release',
    kind: 'command',
    command: 'npm run test:browser:smoke',
    cwd: '../ReactiveMD-Demo',
  },
  {
    id: 'editor-pack',
    label: 'Editor package check',
    owner: 'editor',
    profile: 'release',
    kind: 'command',
    command: 'npm run check',
    cwd: '../ReactiveMD-Editor',
  },
];

function parseArguments(argv) {
  const options = { list: false, profile: null, only: [], includeExternal: false, json: false, out: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const separator = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const inline = separator === -1 ? undefined : argument.slice(separator + 1);
    const readValue = () => {
      const value = inline ?? argv[++index];
      if (value === undefined || value.length === 0) throw new UsageError(`${flag} requires a value.`);
      return value;
    };
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--list') options.list = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--include-external') options.includeExternal = true;
    else if (flag === '--profile') options.profile = readValue();
    else if (flag === '--only') {
      const ids = readValue().split(',').map((id) => id.trim()).filter((id) => id.length > 0);
      if (ids.length === 0) throw new UsageError('--only requires at least one check id.');
      options.only.push(...ids);
    } else if (flag === '--out') options.out = readValue();
    else throw new UsageError(`unknown option "${argument}".`);
  }
  return options;
}

function readCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const commit = (result.stdout ?? '').trim();
  return commit.length > 0 ? commit : null;
}

function displayPath(target) {
  const relative = path.relative(root, target);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) return target;
  return relative.split(path.sep).join('/');
}

async function executeCheck(check, context, options) {
  if (check.kind === 'built-in') return check.run(context);
  if (check.owner !== 'engine' && !options.includeExternal) {
    return { status: 'skip', reason: `external check owned by ${check.owner}; pass --include-external to run it.` };
  }
  const cwd = check.cwd ? path.resolve(root, check.cwd) : root;
  if (check.cwd && !existsSync(cwd)) {
    return { status: 'skip', reason: `working directory ${check.cwd} is missing.` };
  }
  for (const requirement of check.requires ?? []) {
    if (!existsSync(path.join(root, requirement.path))) {
      return { status: 'fail', reason: `${requirement.path} is missing; ${requirement.hint}.` };
    }
  }
  const spawnOptions = { cwd, shell: true, env: { ...process.env, ...(check.env ?? {}) } };
  if (options.json) {
    spawnOptions.stdio = ['ignore', 'pipe', 'pipe'];
    spawnOptions.maxBuffer = 64 * 1024 * 1024;
  } else {
    spawnOptions.stdio = 'inherit';
  }
  const result = spawnSync(check.command, spawnOptions);
  if (options.json) {
    if (result.stdout?.length > 0) process.stderr.write(result.stdout);
    if (result.stderr?.length > 0) process.stderr.write(result.stderr);
  }
  if (result.error) return { status: 'fail', reason: `command failed to start: ${result.error.message}` };
  if (result.status !== 0) {
    const outcome = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
    return { status: 'fail', reason: `command exited with ${outcome}.` };
  }
  return { status: 'pass' };
}

async function runCheck(check, context, options) {
  const startedAt = performance.now();
  const result = await executeCheck(check, context, options);
  return {
    id: check.id,
    label: check.label,
    owner: check.owner,
    status: result.status,
    durationMs: Math.round(performance.now() - startedAt),
    ...(check.command ? { command: check.command } : {}),
    ...(result.details ? { details: result.details } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  process.stderr.write(`support:verify: ${error.message}\n\n${usage}`);
  process.exit(2);
}

if (options.help) {
  process.stdout.write(usage);
  process.exit(0);
}

if (options.list) {
  const lines = manifest.map((check) => {
    const target = check.kind === 'command'
      ? `${check.command}${check.note ? ` (${check.note})` : ''}`
      : check.description;
    return `${check.id}  ${check.owner}  ${check.profile}  ${check.kind}  ${target}`;
  });
  process.stdout.write(`${lines.join('\n')}\n${manifest.length} checks.\n`);
  process.exit(0);
}

const profile = options.profile ?? 'fast';
if (!profileNames.includes(profile)) {
  process.stderr.write(`support:verify: unknown profile "${profile}"; expected fast, release, or all.\n`);
  process.exit(2);
}

let selection = manifest;
if (options.only.length > 0) {
  const known = new Set(manifest.map((check) => check.id));
  const unknown = [...new Set(options.only)].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    process.stderr.write(`support:verify: unknown check id${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.\n`);
    process.stderr.write(`Known ids: ${[...known].join(', ')}.\n`);
    process.exit(2);
  }
  const wanted = new Set(options.only);
  selection = manifest.filter((check) => wanted.has(check.id));
} else if (profile !== 'all') {
  selection = manifest.filter((check) => check.profile === profile);
}

const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const context = { packageInfo };
const results = [];
for (const check of selection) results.push(await runCheck(check, context, options));

const evidence = {
  schema,
  generatedAt: new Date().toISOString(),
  repository: 'reactive-md',
  commit: readCommit(),
  package: { name: packageInfo.name, version: packageInfo.version },
  profile: options.only.length > 0 ? 'only' : profile,
  environment: {
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    playwrightChannel: process.env.PLAYWRIGHT_CHANNEL ?? null,
  },
  checks: results,
};

const evidencePath = options.out ? path.resolve(process.cwd(), options.out) : defaultEvidencePath;
await mkdir(path.dirname(evidencePath), { recursive: true });
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
await writeFile(evidencePath, serialized, 'utf8');
let archivePath = null;
if (!options.out) {
  const stamp = evidence.generatedAt.replace(/[:.]/g, '-');
  archivePath = path.join(path.dirname(defaultEvidencePath), `${stamp}.json`);
  await writeFile(archivePath, serialized, 'utf8');
}

const counts = results.reduce((summary, result) => {
  summary[result.status] += 1;
  return summary;
}, { pass: 0, fail: 0, skip: 0 });

if (options.json) {
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.stderr.write(`Evidence: ${displayPath(evidencePath)}\n`);
  if (archivePath !== null) process.stderr.write(`Archive: ${displayPath(archivePath)}\n`);
} else {
  const lines = results.map((result) => {
    const reason = result.reason ? ` - ${result.reason}` : '';
    return `${result.status.toUpperCase()} ${result.id} ${result.label} (${result.durationMs}ms)${reason}`;
  });
  lines.push('');
  const noun = results.length === 1 ? 'check' : 'checks';
  lines.push(`${results.length} ${noun}: ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped.`);
  lines.push(`Evidence: ${displayPath(evidencePath)}`);
  if (archivePath !== null) lines.push(`Archive: ${displayPath(archivePath)}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exitCode = counts.fail > 0 ? 1 : 0;