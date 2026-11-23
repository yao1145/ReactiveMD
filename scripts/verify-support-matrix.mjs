import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Verify the locally executable rows of the support matrix. The manifest below
 * is the single source of truth for the CLI listing, the docs check and the
 * evidence document. Nothing here touches CI.
 */

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const schema = 'reactive-md-support-evidence/v2';
const defaultEvidencePath = path.join(root, 'artifacts', 'support', 'latest.json');
const matrixDocs = ['docs/compatibility/support-matrix-en.md', 'docs/compatibility/support-matrix-ch.md'];
const profileNames = ['fast', 'release', 'optional', 'all'];

const usage = `Usage: node scripts/verify-support-matrix.mjs [options]

Options:
  --list               Print every support check and exit without running any.
  --profile <name>     Select fast (default), release, optional, or all checks.
                       release includes every fast check and the release checks.
  --only <ids>         Run only the comma-separated check ids, ignoring the profile.
  --include-external   Also run checks owned by the demo and editor repositories.
  --json               Print the evidence document to stdout.
  --out <path>         Write evidence to a custom path. A custom path leaves
                       artifacts/support/latest.json and the archive untouched.
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
  const line = actual.split('.')[0];
  const details = {
    required: typeof range === 'string' ? range : null,
    actual,
    line,
    platform: process.platform,
    arch: process.arch,
  };
  if (typeof range !== 'string' || range.length === 0) {
    return { status: 'fail', reason: 'package.json does not declare engines.node.', details };
  }
  const satisfied = satisfiesRange(actual, range);
  if (satisfied === null) return { status: 'fail', reason: `unsupported Node.js range "${range}".`, details };
  if (!satisfied) return { status: 'fail', reason: `Node.js ${actual} does not satisfy ${range}.`, details };
  // The matrix declares 22.x from 22.12.0 and 24.x. Other majors inside
  // engines.node still pass the range check, but the run is labelled so a
  // record for an undeclared major is not mistaken for a declared one.
  details.declaredLine = line === '22' || line === '24';
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
    label: 'Node.js 22.12+ or 24.x',
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
    id: 'documented-versions',
    label: 'Documented version consistency',
    owner: 'engine',
    profile: 'fast',
    kind: 'command',
    command: 'node scripts/check-versions.mjs',
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
    id: 'chrome-core',
    label: 'Google Chrome browser core',
    owner: 'engine',
    profile: 'release',
    kind: 'command',
    command: 'node scripts/verify-required-form-browser.mjs',
    env: { PLAYWRIGHT_ENGINE: 'chromium', PLAYWRIGHT_CHANNEL: 'chrome' },
    capture: { report: 'artifacts/required-form/chrome-core.json', engine: 'chromium', channel: 'chrome' },
  },
  {
    id: 'edge-core',
    label: 'Microsoft Edge browser core',
    owner: 'engine',
    profile: 'release',
    kind: 'command',
    command: 'node scripts/verify-required-form-browser.mjs',
    env: { PLAYWRIGHT_ENGINE: 'chromium', PLAYWRIGHT_CHANNEL: 'msedge' },
    capture: { report: 'artifacts/required-form/edge-core.json', engine: 'chromium', channel: 'msedge' },
  },
  {
    id: 'playwright-chromium-core',
    label: 'Playwright Chromium browser core',
    owner: 'engine',
    profile: 'optional',
    kind: 'command',
    command: 'node scripts/verify-required-form-browser.mjs',
    env: { PLAYWRIGHT_ENGINE: 'chromium', PLAYWRIGHT_CHANNEL: 'chromium' },
    note: 'needs the bundled Playwright Chromium downloads',
    capture: { report: 'artifacts/required-form/playwright-chromium-core.json', engine: 'chromium', channel: 'chromium' },
  },
  {
    id: 'firefox-core',
    label: 'Playwright Firefox browser core',
    owner: 'engine',
    profile: 'optional',
    kind: 'command',
    command: 'node scripts/verify-required-form-browser.mjs',
    env: { PLAYWRIGHT_ENGINE: 'firefox' },
    note: 'not a declared support environment',
    capture: { report: 'artifacts/required-form/firefox-core.json', engine: 'firefox', channel: null },
  },
  {
    id: 'webkit-core',
    label: 'Playwright WebKit browser core',
    owner: 'engine',
    profile: 'optional',
    kind: 'command',
    command: 'node scripts/verify-required-form-browser.mjs',
    env: { PLAYWRIGHT_ENGINE: 'webkit' },
    note: 'Playwright WebKit is not Safari',
    capture: { report: 'artifacts/required-form/webkit-core.json', engine: 'webkit', channel: null },
  },
  {
    id: 'pdf-static',
    label: 'PDF export',
    owner: 'engine',
    profile: 'release',
    kind: 'command',
    command: 'node scripts/verify-pdf.mjs',
    tools: [{ command: 'pdftotext', args: ['-v'], hint: 'install Poppler so pdftotext is on PATH' }],
  },
  {
    id: 'demo-smoke',
    label: 'Demo browser smoke',
    owner: 'demo',
    profile: 'release',
    kind: 'command',
    command: 'npm run test:browser:smoke',
    cwd: '../ReactiveMD-Demo',
    env: { PLAYWRIGHT_CHANNEL: 'msedge' },
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

function selectByProfile(profile) {
  if (profile === 'all') return manifest;
  if (profile === 'release') return manifest.filter((check) => check.profile === 'fast' || check.profile === 'release');
  return manifest.filter((check) => check.profile === profile);
}

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

function gitState(directory) {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: directory, encoding: 'utf8' });
  return {
    commit: commit.status === 0 ? (commit.stdout ?? '').trim() || null : null,
    dirty: status.status === 0 ? (status.stdout ?? '').trim().length > 0 : null,
  };
}

async function sourceAt(directory) {
  const packageFile = path.join(directory, 'package.json');
  if (!existsSync(packageFile)) return null;
  const info = JSON.parse(await readFile(packageFile, 'utf8'));
  return { name: info.name ?? null, version: info.version ?? null, ...gitState(directory) };
}

async function readManifestInfo() {
  const file = path.join(root, 'docs/compatibility/compatibility-manifest.json');
  if (!existsSync(file)) return null;
  const bytes = await readFile(file);
  const info = JSON.parse(bytes.toString('utf8'));
  return {
    path: displayPath(file),
    schema: info.schema ?? null,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function displayPath(target) {
  const relative = path.relative(root, target);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) return target;
  return relative.split(path.sep).join('/');
}

function toolAvailable(tool) {
  // Probing with a flag is unreliable: several tools print usage to stderr and
  // exit non-zero. A spawn without ENOENT is enough to know the tool exists.
  const result = spawnSync(tool.command, tool.args ?? [], { stdio: 'ignore' });
  return result.error === undefined;
}

async function readBrowserCapture(check) {
  if (!check.capture) return null;
  const reportFile = path.join(root, check.capture.report);
  let report;
  try {
    report = JSON.parse(await readFile(reportFile, 'utf8'));
  } catch {
    return { report: displayPath(reportFile), browserName: null, browserVersion: null, note: 'report was not written' };
  }
  const entry = Array.isArray(report)
    ? report.find((item) => item.engine === check.capture.engine && (item.channel ?? null) === check.capture.channel)
    : null;
  return {
    report: displayPath(reportFile),
    requestedChannel: check.capture.channel,
    browserName: entry?.browserName ?? check.capture.engine,
    browserVersion: entry?.browserVersion ?? null,
    status: entry?.status ?? null,
  };
}

async function executeCheck(check, context, options) {
  if (check.kind === 'built-in') return check.run(context);
  // A check named by --only is an explicit request: anything that prevents it
  // from running is a failure. Profile runs may skip unavailable optional
  // environments, and the skip reason is written to the evidence.
  const explicit = options.only.includes(check.id);
  const blocked = (reason) => (explicit
    ? { status: 'fail', reason: `explicitly requested but cannot run: ${reason}` }
    : { status: 'skip', reason });
  if (check.owner !== 'engine' && !options.includeExternal) {
    return blocked(`external check owned by ${check.owner}; pass --include-external to run it.`);
  }
  const missingTool = (check.tools ?? []).find((tool) => !toolAvailable(tool));
  if (missingTool) return blocked(`${missingTool.command} is not available; ${missingTool.hint}.`);
  const cwd = check.cwd ? path.resolve(root, check.cwd) : root;
  if (check.cwd && !existsSync(cwd)) return blocked(`working directory ${check.cwd} is missing.`);
  for (const requirement of check.requires ?? []) {
    if (!existsSync(path.join(root, requirement.path))) {
      return { status: 'fail', reason: `${requirement.path} is missing; ${requirement.hint}.` };
    }
  }
  const env = { ...check.env };
  if (check.capture) {
    const reportFile = path.join(root, check.capture.report);
    await mkdir(path.dirname(reportFile), { recursive: true });
    await rm(reportFile, { force: true });
    env.REQUIRED_FORM_REPORT = reportFile;
  }
  const spawnOptions = { cwd, shell: true, env: { ...process.env, ...env } };
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
  const details = check.capture ? { browser: await readBrowserCapture(check) } : null;
  return { status: 'pass', ...(details ? { details } : {}) };
}

async function runCheck(check, context, options) {
  const startedAt = performance.now();
  const result = await executeCheck(check, context, options);
  return {
    id: check.id,
    label: check.label,
    owner: check.owner,
    profile: check.profile,
    status: result.status,
    durationMs: Math.round(performance.now() - startedAt),
    ...(check.command ? { command: check.command } : {}),
    ...(check.env ? { env: check.env } : {}),
    ...(check.cwd ? { cwd: check.cwd } : {}),
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
    const env = check.env
      ? ` [${Object.entries(check.env).map(([name, value]) => `${name}=${value}`).join(' ')}]`
      : '';
    const target = check.kind === 'command'
      ? `${check.command}${env}${check.note ? ` (${check.note})` : ''}`
      : check.description;
    return `${check.id}  ${check.owner}  ${check.profile}  ${check.kind}  ${target}`;
  });
  process.stdout.write(`${lines.join('\n')}\n${manifest.length} checks.\n`);
  process.exit(0);
}

const profile = options.profile ?? 'fast';
if (!profileNames.includes(profile)) {
  process.stderr.write(`support:verify: unknown profile "${profile}"; expected fast, release, optional, or all.\n`);
  process.exit(2);
}

let selection = selectByProfile(profile);
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
}

const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const context = { packageInfo };
const results = [];
for (const check of selection) results.push(await runCheck(check, context, options));

const sources = {
  engine: await sourceAt(root),
  editor: await sourceAt(path.resolve(root, '..', 'ReactiveMD-Editor')),
  demo: await sourceAt(path.resolve(root, '..', 'ReactiveMD-Demo')),
};
const nodeLine = process.versions.node.split('.')[0];
const evidence = {
  schema,
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  repository: 'reactive-md',
  commit: sources.engine?.commit ?? null,
  sources,
  manifest: await readManifestInfo(),
  package: { name: packageInfo.name, version: packageInfo.version },
  profile: options.only.length > 0 ? 'only' : profile,
  environment: {
    node: process.versions.node,
    nodeLine,
    // The matrix declares Node 22.x from 22.12.0 and 24.x. A passing
    // node-runtime record on another major satisfies engines.node but is not
    // a declared line; the flag keeps the two apart.
    nodeLineDeclared: nodeLine === '22' || nodeLine === '24',
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