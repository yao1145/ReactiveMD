import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Last-resort resolution for `reactive-md/*` imports in a package that is
 * being checked from a source checkout without a local node_modules. Normal
 * resolution always runs first, so an installed copy keeps winning.
 */

let packageRoot;
let exportsMap;

export function initialize(data) {
  packageRoot = data?.packageRoot;
}

async function fallbackUrl(specifier) {
  if (packageRoot === undefined) return null;
  if (specifier !== 'reactive-md' && !specifier.startsWith('reactive-md/')) return null;
  if (exportsMap === undefined) {
    const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    exportsMap = metadata.exports ?? {};
  }
  const key = specifier === 'reactive-md' ? '.' : `./${specifier.slice('reactive-md/'.length)}`;
  const entry = exportsMap[key];
  if (entry === undefined) return null;
  const target = typeof entry === 'string' ? entry : entry.import ?? entry.default;
  if (typeof target !== 'string') return null;
  return pathToFileURL(path.resolve(packageRoot, target)).href;
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const url = await fallbackUrl(specifier);
    if (url === null) throw error;
    return { url, shortCircuit: true };
  }
}
