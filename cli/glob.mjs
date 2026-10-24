import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { CliError, EXIT, fsFailure } from './errors.mjs';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'dist-library']);
const GLOB_MAGIC = /[*?]/;
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** @param {string} input */
export function hasGlobMagic(input) {
  return GLOB_MAGIC.test(input);
}

/** Normalize separators so one glob syntax works on every platform. */
function normalizePattern(pattern) {
  return pattern.replace(/\\/g, '/');
}

/** @param {string} character */
function escapeRegExp(character) {
  return character.replace(REGEXP_SPECIAL, '\\$&');
}

/**
 * Convert a simple glob (`*`, `?`, `**`) to a regular expression over a
 * forward-slash relative path. `**` crosses directory boundaries, `*` and `?`
 * do not.
 *
 * @param {string} pattern
 */
export function globToRegExp(pattern) {
  const normalized = normalizePattern(pattern);
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        index += 1;
        if (normalized[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(character);
    }
  }
  return new RegExp(`${source}$`);
}

/**
 * @param {string} pattern
 * @returns {{base: string, tail: string}}
 */
function splitGlob(pattern) {
  const normalized = normalizePattern(pattern);
  const segments = normalized.split('/');
  const prefix = [];
  let index = 0;
  for (; index < segments.length; index += 1) {
    if (GLOB_MAGIC.test(segments[index])) break;
    prefix.push(segments[index]);
  }

  let baseText = prefix.join('/');
  if (baseText === '') baseText = normalized.startsWith('/') ? '/' : '.';
  if (/^[A-Za-z]:$/.test(baseText)) baseText += '/';
  const tail = segments.slice(index).join('/');
  return { base: path.resolve(baseText), tail };
}

/** @param {string} file */
function isReactiveDocument(file) {
  return path.basename(file).toLowerCase().endsWith('.reactive.md');
}

/**
 * Walk a directory tree, skipping package/build/VCS directories. Symlinked
 * directories are not followed; symlinked files are included as files.
 *
 * @param {string} base
 * @param {{maxDepth?: number, filter?: (file: string) => boolean, topLevel?: boolean}} [options]
 * @returns {Promise<string[]>}
 */
export async function walkFiles(base, options = {}) {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const filter = options.filter ?? (() => true);
  const topLevel = options.topLevel !== false;
  const files = [];

  /** @param {string} directory @param {number} depth */
  async function visit(directory, depth) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (depth === 0 && topLevel) {
        throw fsFailure('Cannot read directory', directory, error, EXIT.IO);
      }
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (depth + 1 < maxDepth) await visit(full, depth + 1);
        continue;
      }
      if (entry.isFile()) {
        if (filter(full)) files.push(full);
        continue;
      }
      if (entry.isSymbolicLink()) {
        let info;
        try {
          info = await stat(full);
        } catch {
          continue;
        }
        if (info.isFile() && filter(full)) files.push(full);
      }
    }
  }

  await visit(base, 0);
  return files;
}

/** @param {string} pattern */
function globDepth(tail) {
  if (tail.includes('**')) return Number.POSITIVE_INFINITY;
  return Math.max(1, tail.split('/').length);
}

/**
 * Expand lint inputs into a deduplicated, sorted list of absolute file paths.
 * Explicit missing files/directories are I/O errors; a glob that matches
 * nothing is simply empty.
 *
 * @param {string[]} inputs
 * @returns {Promise<string[]>}
 */
export async function expandLintInputs(inputs) {
  /** @type {Map<string, string>} */
  const files = new Map();
  const add = (file) => {
    const absolute = path.resolve(file);
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (!files.has(key)) files.set(key, absolute);
  };

  for (const input of inputs) {
    if (hasGlobMagic(input)) {
      const { base, tail } = splitGlob(input);
      let info;
      try {
        info = await stat(base);
      } catch (error) {
        throw fsFailure('Glob base does not exist', base, error, EXIT.IO);
      }
      if (!info.isDirectory()) continue;

      const matcher = globToRegExp(tail);
      const matches = await walkFiles(base, {
        maxDepth: globDepth(tail),
        filter: (file) => matcher.test(path.relative(base, file).split(path.sep).join('/')),
        topLevel: true,
      });
      for (const file of matches) add(file);
      continue;
    }

    const absolute = path.resolve(input);
    let info;
    try {
      info = await stat(absolute);
    } catch (error) {
      throw new CliError(
        `No such file or directory: "${input}".`,
        EXIT.IO,
        { cause: error },
      );
    }
    if (info.isDirectory()) {
      const matches = await walkFiles(absolute, { filter: isReactiveDocument, topLevel: true });
      for (const file of matches) add(file);
    } else if (info.isFile()) {
      add(absolute);
    } else {
      throw new CliError(`Lint input is not a regular file or directory: "${input}".`, EXIT.IO);
    }
  }

  return [...files.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
