import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Unified release gate.
 *
 * `npm run verify:release` builds once and runs every Node and browser check.
 * `--node` and `--browser` run the same steps as CI shards. Both shards build
 * their inputs themselves so each invocation is self-contained; pass
 * `--skip-build` when a caller already produced dist-library and demo/dist.
 */

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const demoRoot = path.join(projectRoot, 'demo');
const artifactsRoot = path.join(projectRoot, 'artifacts');
const logRoot = path.join(artifactsRoot, 'release-verification');
const reportPath = process.env.RELEASE_REPORT ?? path.join(artifactsRoot, 'release-verification.json');
const npmCli = locateNpmCli();

function locateNpmCli() {
  const candidates = [];
  if (process.env.npm_execpath && /\.(?:cjs|mjs|js)$/i.test(process.env.npm_execpath)) {
    candidates.push(process.env.npm_execpath);
  }
  const nodeDirectory = path.dirname(process.execPath);
  candidates.push(path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  candidates.push(path.join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  }
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error('Cannot locate npm-cli.js; run this gate through npm run verify:release.');
  return found;
}

const options = process.argv.slice(2).filter(Boolean);
const known = new Set(['--node', '--browser', '--skip-build']);
const unknown = options.filter(option => !known.has(option));
if (unknown.length > 0) {
  console.error(`verify:release: unknown option(s): ${unknown.join(', ')}`);
  console.error('Usage: npm run verify:release [-- --node | --browser] [--skip-build]');
  process.exit(2);
}

const runNode = options.includes('--node') || !options.includes('--browser');
const runBrowser = options.includes('--browser') || !options.includes('--node');
const skipBuild = options.includes('--skip-build');
const modeLabel = runNode && runBrowser ? 'full' : runNode ? 'node' : 'browser';

const report = {
  tool: 'verify:release',
  mode: modeLabel,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: 'running',
  steps: [],
  failures: [],
};
const children = new Set();
let interrupted = false;
let demoPreview = null;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true;
    for (const child of children) {
      try { child.kill('SIGTERM'); } catch { /* already exited */ }
    }
  });
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'step';
}

function npmStep(shard, label, npmArgs, index, cwd = projectRoot, env = {}) {
  return {
    shard,
    label,
    index,
    cwd,
    env,
    command: process.execPath,
    args: [npmCli, ...npmArgs],
    display: `npm ${npmArgs.join(' ')}`,
  };
}

async function runStep(step) {
  await mkdir(logRoot, { recursive: true });
  const logPath = path.join(logRoot, `${step.shard}-${String(step.index).padStart(2, '0')}-${slug(step.label)}.log`);
  const started = Date.now();
  console.log(`\n[${step.shard}] ${step.label}: ${step.display}`);

  const result = await new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
        ...step.env,
      },
    });
    children.add(child);
    let log = `$ ${step.display}\n`;
    let tail = '';
    const collect = (chunk, stream) => {
      log += chunk;
      stream.write(chunk);
      tail = `${tail}${chunk}`.split('\n').slice(-120).join('\n');
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => collect(chunk, process.stdout));
    child.stderr.on('data', chunk => collect(chunk, process.stderr));
    child.on('error', error => {
      children.delete(child);
      resolve({ code: 1, log: `${log}\n${error.stack ?? error.message}`, tail: error.message });
    });
    child.on('close', code => {
      children.delete(child);
      resolve({ code: code ?? 1, log, tail });
    });
  });

  const entry = {
    shard: step.shard,
    label: step.label,
    command: step.display,
    status: result.code === 0 ? 'passed' : 'failed',
    exitCode: result.code,
    durationMs: Date.now() - started,
    log: path.relative(projectRoot, logPath),
  };
  await writeFile(logPath, result.log, 'utf8');
  report.steps.push(entry);
  if (result.code !== 0) {
    entry.error = result.tail.trim();
    report.failures.push(`${step.shard}: ${step.label}`);
    throw new Error(`${step.label} failed with exit code ${result.code}.\n${entry.error}`);
  }
  console.log(`[${step.shard}] PASS ${step.label} (${entry.durationMs} ms)`);
  if (interrupted) throw new Error(`${step.label} was interrupted.`);
}

async function runSequence(shard, steps) {
  let index = 0;
  for (const [label, npmArgs, cwd, env] of steps) {
    index += 1;
    await runStep(npmStep(shard, label, npmArgs, index, cwd, env));
  }
}

async function startDemoPreview() {
  const { preview } = await import('vite');
  const server = await preview({
    configFile: path.join(demoRoot, 'vite.config.ts'),
    root: demoRoot,
    logLevel: 'error',
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  const reported = server.resolvedUrls?.local?.[0];
  assert.ok(reported, 'Vite preview did not report a local URL');
  const url = reported.replace(/\/$/, '');
  console.log(`\n[browser] Demo preview: ${url}`);
  return { server, url };
}

async function closeDemoPreview() {
  if (!demoPreview) return;
  const { server } = demoPreview;
  demoPreview = null;
  try { await server.close(); } catch { /* server already stopped */ }
}

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
}

const NODE_STEPS = [
  ['Third-party notices', ['run', 'notices']],
  ['Core unit tests', ['test', '--', '--maxWorkers=4']],
  ['Demo unit tests', ['run', 'test', '--workspace=@reactive-md/demo']],
  ['Package API contract', ['run', 'test:package']],
  ['Documentation links', ['run', 'test:docs']],
  ['Packed tarball consumers', ['run', 'test:packed']],
];

try {
  if (!skipBuild && (runNode || runBrowser)) {
    await runSequence('build', [['Build library and types', ['run', 'build']]]);
  } else if (skipBuild) {
    console.log('Skipping library build (--skip-build).');
  }

  if (runNode) {
    await runSequence('node', NODE_STEPS);
  }

  if (runBrowser) {
    if (!skipBuild) {
      await runSequence('build', [['Build demo', ['run', 'build', '--workspace=@reactive-md/demo']]]);
    }
    const preview = await startDemoPreview();
    demoPreview = preview;
    const { url } = preview;
    const browserEnv = { DEMO_URL: url };
    if (process.env.PLAYWRIGHT_CHANNEL) browserEnv.PLAYWRIGHT_CHANNEL = process.env.PLAYWRIGHT_CHANNEL;
    try {
      await runSequence('browser', [
        ['Editor toolbar browser', ['run', 'test:toolbar'], demoRoot, browserEnv],
        ['Demo browser suite', ['run', 'test:browser'], demoRoot, browserEnv],
        ['New component browser suite', ['run', 'test:v2'], demoRoot, browserEnv],
        ['Shareable export acceptance', ['run', 'test:shareable'], projectRoot, browserEnv],
        ['Computed values browser', ['run', 'test:computations-browser'], projectRoot, browserEnv],
        ['Constraints and collections browser', ['run', 'test:constraints-browser'], projectRoot, browserEnv],
        ['Theme browser', ['run', 'test:theme-browser'], projectRoot, browserEnv],
        ['Dependency rendering equivalence', ['run', 'verify:memo'], projectRoot, browserEnv],
        ['Release combination browser', ['run', 'test:release-browser'], projectRoot, browserEnv],
      ]);
    } finally {
      await closeDemoPreview();
    }
  }

  report.status = interrupted ? 'interrupted' : report.failures.length === 0 ? 'passed' : 'failed';
} catch (error) {
  report.status = interrupted ? 'interrupted' : 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  console.error(`\nverify:release FAILED: ${report.error}`);
} finally {
  await closeDemoPreview();
  if (interrupted) report.status = 'interrupted';
  await writeReport();
}

const summary = report.steps
  .map(step => `  ${step.status === 'passed' ? 'PASS' : 'FAIL'} ${step.shard}/${step.label}`)
  .join('\n');
console.log(`\n${report.status === 'passed' ? 'PASS' : 'FAIL'} verify:release (${modeLabel})\n${summary}`);
console.log(`Report: ${path.relative(projectRoot, reportPath)}`);

if (report.status !== 'passed') {
  process.exitCode = interrupted ? 130 : 1;
}
