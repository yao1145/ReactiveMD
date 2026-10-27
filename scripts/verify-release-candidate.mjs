import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Check the exact archive validated by packed-consumer tests before OIDC
// publication. The manifest binds the archive to the checked-out source commit.
const directory = path.resolve('artifacts/release-package');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const verification = JSON.parse(await readFile(path.join(directory, 'package-verification.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(directory, 'release-manifest.json'), 'utf8'));
const filename = `reactive-md-${pkg.version}.tgz`;
assert.equal(verification.name, 'reactive-md');
assert.equal(verification.version, pkg.version);
assert.equal(verification.filename, filename);
assert.ok(Array.isArray(verification.checks) && verification.checks.length > 0);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.commit, execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim());
const archive = await readFile(path.join(directory, filename));
const sha256 = createHash('sha256').update(archive).digest('hex');
const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
assert.equal(sha256, verification.sha256);
assert.equal(sha256, manifest.sha256);
assert.equal(integrity, verification.integrity);
assert.equal(integrity, manifest.integrity);
console.log(`Verified ${filename} from ${manifest.commit}: SHA256 ${sha256}`);
