import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Keep the package version, the SDK contract version and the documented
 * protocol revisions in agreement. These versions are independent identities,
 * but the files that mention them must not drift apart.
 */

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const failures = [];
const checks = [];

const fail = (message) => failures.push(message);
const pass = (message) => checks.push(message);

async function read(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

function constant(source, name, file) {
  const match = new RegExp(`export const ${name}\\s*=\\s*'([^']+)'`).exec(source);
  if (!match) fail(`${file} does not export ${name} as a string literal.`);
  return match?.[1];
}

function cliConstant(source, name) {
  const match = new RegExp(`const ${name}\\s*=\\s*'([^']+)'`).exec(source);
  if (!match) fail(`cli/init.mjs does not declare ${name} as a string literal.`);
  return match?.[1];
}

function versionCore(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version);
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

function changelogHeadings(text) {
  return [...text.matchAll(/^##\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(.*)$/gm)]
    .map((match) => ({ version: match[1], unreleased: /unreleased|未发布/i.test(match[2]) }));
}

const packageInfo = JSON.parse(await read('package.json'));
if (typeof packageInfo.version !== 'string' || versionCore(packageInfo.version) === null) {
  fail('package.json does not declare a valid semantic version.');
}

const versionSource = await read('src/sdk/version.ts');
const sdkVersion = constant(versionSource, 'LOCAL_SDK_VERSION', 'src/sdk/version.ts');
const protocols = {
  LOCAL_COMPONENT_PROTOCOL: constant(versionSource, 'LOCAL_COMPONENT_PROTOCOL', 'src/sdk/version.ts'),
  LOCAL_CONFIG_PROTOCOL: constant(versionSource, 'LOCAL_CONFIG_PROTOCOL', 'src/sdk/version.ts'),
  LOCAL_CONFIG_PROTOCOL_V2: constant(versionSource, 'LOCAL_CONFIG_PROTOCOL_V2', 'src/sdk/version.ts'),
  LOCAL_PRESET_PROTOCOL: constant(versionSource, 'LOCAL_PRESET_PROTOCOL', 'src/sdk/version.ts'),
  LOCAL_REACT_PRESET_PROTOCOL: constant(versionSource, 'LOCAL_REACT_PRESET_PROTOCOL', 'src/sdk/version.ts'),
  LOCAL_ASSEMBLY_PROTOCOL: constant(versionSource, 'LOCAL_ASSEMBLY_PROTOCOL', 'src/sdk/version.ts'),
};
const expectedProtocols = {
  LOCAL_COMPONENT_PROTOCOL: 'reactive-md-component/v1',
  LOCAL_CONFIG_PROTOCOL: 'reactive-md-config/v1',
  LOCAL_CONFIG_PROTOCOL_V2: 'reactive-md-config/v2',
  LOCAL_PRESET_PROTOCOL: 'reactive-md-preset/v1',
  LOCAL_REACT_PRESET_PROTOCOL: 'reactive-md-react-preset/v1',
  LOCAL_ASSEMBLY_PROTOCOL: 'reactive-md-assembly/v1',
};
for (const [name, expected] of Object.entries(expectedProtocols)) {
  if (protocols[name] !== expected) fail(`${name} is "${protocols[name]}", expected "${expected}".`);
}
if (failures.length === 0) pass('protocol constants match their documented revisions.');

if (sdkVersion !== undefined && packageInfo.version !== undefined) {
  const order = compareVersions(sdkVersion, packageInfo.version);
  if (order === null) fail(`Cannot compare LOCAL_SDK_VERSION "${sdkVersion}" with package version "${packageInfo.version}".`);
  else if (order > 0) fail(`LOCAL_SDK_VERSION ${sdkVersion} is newer than the package version ${packageInfo.version}.`);
  else pass(`LOCAL_SDK_VERSION ${sdkVersion} is not newer than package version ${packageInfo.version}.`);
}

const initSource = await read('cli/init.mjs');
const scaffoldSdkVersion = cliConstant(initSource, 'SCAFFOLD_SDK_VERSION');
if (scaffoldSdkVersion !== sdkVersion) {
  fail(`cli/init.mjs scaffolds reactive-md@${scaffoldSdkVersion}, but LOCAL_SDK_VERSION is ${sdkVersion}.`);
} else if (scaffoldSdkVersion !== undefined) {
  pass(`scaffold SDK reference ${scaffoldSdkVersion} matches LOCAL_SDK_VERSION.`);
}
const scaffoldProtocols = {
  SCAFFOLD_COMPONENT_PROTOCOL: protocols.LOCAL_COMPONENT_PROTOCOL,
  SCAFFOLD_PRESET_PROTOCOL: protocols.LOCAL_PRESET_PROTOCOL,
  SCAFFOLD_REACT_PRESET_PROTOCOL: protocols.LOCAL_REACT_PRESET_PROTOCOL,
};
for (const [name, expected] of Object.entries(scaffoldProtocols)) {
  const actual = cliConstant(initSource, name);
  if (actual !== expected) fail(`cli/init.mjs ${name} is "${actual}", expected "${expected}".`);
}
if (failures.length === 0) pass('scaffold protocol references match the SDK constants.');

const changelogEn = changelogHeadings(await read('CHANGELOG.md'));
const changelogZh = changelogHeadings(await read('CHANGELOG-ch.md'));
if (changelogEn.length === 0 || changelogZh.length === 0) {
  fail('CHANGELOG.md and CHANGELOG-ch.md must start with a version heading.');
} else {
  if (changelogEn[0].version !== packageInfo.version) {
    fail(`CHANGELOG.md starts at ${changelogEn[0].version}, but package.json is ${packageInfo.version}.`);
  }
  if (changelogZh[0].version !== packageInfo.version) {
    fail(`CHANGELOG-ch.md starts at ${changelogZh[0].version}, but package.json is ${packageInfo.version}.`);
  }
  if (changelogEn[0].version === packageInfo.version && changelogZh[0].version === packageInfo.version) {
    pass(`changelogs start at package version ${packageInfo.version}.`);
  }
  const latest = changelogEn.find((entry) => !entry.unreleased);
  if (!latest) {
    fail('CHANGELOG.md must record at least one released version.');
  } else {
    for (const readme of ['README.md', 'README-ch.md']) {
      const text = await read(readme);
      const install = /npm install reactive-md@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(text);
      if (!install) {
        fail(`${readme} does not contain an "npm install reactive-md@<version>" line.`);
      } else if (install[1] !== latest.version) {
        fail(`${readme} installs reactive-md@${install[1]}, but the latest released changelog entry is ${latest.version}.`);
      }
    }
    if (latest.version !== undefined) pass(`README install version matches the latest released entry ${latest.version}.`);
  }
}

if (failures.length > 0) {
  for (const message of failures) process.stderr.write(`version check failed: ${message}\n`);
  process.exitCode = 1;
} else {
  for (const message of checks) process.stdout.write(`ok: ${message}\n`);
  process.stdout.write(`Versions in sync: package ${packageInfo.version}, SDK ${sdkVersion}.\n`);
}
