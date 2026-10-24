import { randomUUID } from 'node:crypto';
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError, EXIT, fsFailure, usageError } from './errors.mjs';

/**
 * Read an input file as UTF-8. The caller controls the exit code because
 * documents/states are input data (4) while built artifacts are installation
 * failures (3).
 *
 * @param {string} filePath
 * @param {{label: string, exitCode?: number}} options
 */
export async function readTextFile(filePath, { label, exitCode = EXIT.IO }) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    throw fsFailure(label, filePath, error, exitCode);
  }
}

/** @param {string} candidate */
function pathKey(candidate) {
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** @param {string} a @param {string} b */
function samePath(a, b) {
  return pathKey(a) === pathKey(b);
}

/** @param {string} filePath */
async function realpathOrNull(filePath) {
  try {
    return await realpath(filePath);
  } catch {
    return null;
  }
}

/**
 * Refuse to overwrite the input document, including through a symlink or a
 * symlinked parent directory. Comparison is case-insensitive on Windows.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 */
export async function assertDistinctPaths(inputPath, outputPath) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  if (samePath(resolvedInput, resolvedOutput)) {
    throw usageError(`Output path must differ from the input document: "${resolvedInput}".`);
  }

  const inputReal = await realpathOrNull(resolvedInput);
  if (!inputReal) return;
  const outputReal = await realpathOrNull(resolvedOutput);
  if (outputReal && samePath(inputReal, outputReal)) {
    throw usageError(`Output path resolves to the input document: "${resolvedOutput}".`);
  }
  const parentReal = await realpathOrNull(path.dirname(resolvedOutput));
  if (parentReal && samePath(inputReal, path.join(parentReal, path.basename(resolvedOutput)))) {
    throw usageError(`Output path resolves to the input document: "${resolvedOutput}".`);
  }
}

/**
 * Require the output directory to already exist. This CLI deliberately does not
 * create directories because a typo in a nested output path should not scatter
 * empty directories across the filesystem.
 *
 * @param {string} outputPath
 */
export async function assertOutputDirectory(outputPath) {
  const absolute = path.resolve(outputPath);
  const directory = path.dirname(absolute);
  let info;
  try {
    info = await stat(directory);
  } catch (error) {
    throw new CliError(
      `Output directory does not exist: "${directory}". Create it before running build.`,
      EXIT.IO,
      { cause: error },
    );
  }
  if (!info.isDirectory()) {
    throw new CliError(`Output parent is not a directory: "${directory}".`, EXIT.IO);
  }

  try {
    const existing = await stat(absolute);
    if (existing.isDirectory()) {
      throw new CliError(`Output path is a directory: "${absolute}".`, EXIT.IO);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code !== 'ENOENT') {
      throw fsFailure('Cannot inspect output path', absolute, error, EXIT.IO);
    }
  }
}

/**
 * Write UTF-8 through a unique temporary file in the destination directory and
 * rename it into place. The temporary file is removed on every failure path.
 *
 * @param {string} outputPath
 * @param {string} content
 */
export async function atomicWriteUtf8(outputPath, content) {
  const absolute = path.resolve(outputPath);
  await assertOutputDirectory(absolute);
  const directory = path.dirname(absolute);
  const temporary = path.join(
    directory,
    `.${path.basename(absolute)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, absolute);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      /* The temporary file may not have been created or may already be gone. */
    }
    throw fsFailure('Cannot write output file', absolute, error, EXIT.IO);
  }
}
