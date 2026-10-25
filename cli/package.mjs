import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError, EXIT, errorText } from './errors.mjs';

/**
 * Artifact locations are always relative to the installed package root
 * (bin/..), never the current working directory.
 */
export const ARTIFACTS = Object.freeze({
  core: { relative: 'dist-library/reactive-md.js', label: 'core build' },
  react: { relative: 'dist-library/reactive-md-react.js', label: 'React renderer build' },
  css: { relative: 'dist-library/reactive-md.css', label: 'stylesheet build' },
  printCss: { relative: 'dist-library/reactive-md-print.css', label: 'print stylesheet build' },
  standalone: { relative: 'dist-standalone/reactive-md-standalone.js', label: 'standalone runtime build' },
});

const BUILD_HINT = 'Run "npm run build" from a source checkout before building documents.';

/** @param {string} packageRoot @param {keyof typeof ARTIFACTS} key */
export function artifactPath(packageRoot, key) {
  return path.join(packageRoot, ARTIFACTS[key].relative);
}

/** @param {string} packageRoot */
export async function readPackageInfo(packageRoot) {
  const file = path.join(packageRoot, 'package.json');
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new CliError(
      `Cannot read package metadata at "${file}": ${errorText(error)}. Reinstall reactive-md.`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliError(
      `Package metadata at "${file}" is not valid JSON: ${errorText(error)}. Reinstall reactive-md.`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'string' || parsed.version === '') {
    throw new CliError(`Package metadata at "${file}" does not declare a version. Reinstall reactive-md.`, EXIT.DOCUMENT);
  }
  return {
    name: typeof parsed.name === 'string' ? parsed.name : 'reactive-md',
    version: parsed.version,
  };
}

/** @param {string} packageRoot @param {keyof typeof ARTIFACTS} key */
export async function assertArtifact(packageRoot, key) {
  const entry = ARTIFACTS[key];
  const file = artifactPath(packageRoot, key);
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    throw new CliError(`Missing ${entry.label}: "${file}". ${BUILD_HINT}`, EXIT.DOCUMENT, { cause: error });
  }
  if (!info.isFile()) {
    throw new CliError(`Missing ${entry.label}: "${file}" is not a regular file. ${BUILD_HINT}`, EXIT.DOCUMENT);
  }
}

/**
 * Import the core artifact and verify the exports this command needs.
 * @param {string} packageRoot
 * @param {string[]} requiredExports
 */
export async function loadCore(packageRoot, requiredExports = ['compileLocal']) {
  await assertArtifact(packageRoot, 'core');
  const file = artifactPath(packageRoot, 'core');
  let module;
  try {
    module = await import(pathToFileURL(file).href);
  } catch (error) {
    throw new CliError(
      `Cannot load the core build at "${file}": ${errorText(error)}. ${BUILD_HINT}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }
  for (const name of requiredExports) {
    if (typeof module?.[name] !== 'function') {
      throw new CliError(
        `The core build at "${file}" is missing the "${name}" export. ${BUILD_HINT}`,
        EXIT.DOCUMENT,
      );
    }
  }
  return module;
}

/** @param {string} packageRoot @param {keyof typeof ARTIFACTS} key */
export async function readArtifactText(packageRoot, key) {
  await assertArtifact(packageRoot, key);
  const file = artifactPath(packageRoot, key);
  try {
    const text = await readFile(file, 'utf8');
    if (text.trim() === '') {
      throw new CliError(`The ${ARTIFACTS[key].label} at "${file}" is empty. ${BUILD_HINT}`, EXIT.DOCUMENT);
    }
    return text;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      `Cannot read the ${ARTIFACTS[key].label} at "${file}": ${errorText(error)}. ${BUILD_HINT}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }
}

/**
 * Read the packaged notices file when present. The shareable shell escapes it;
 * a source checkout without generated notices simply omits the section.
 *
 * @param {string} packageRoot
 */
export async function readNotices(packageRoot) {
  try {
    return await readFile(path.join(packageRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  } catch {
    return '';
  }
}

/** @param {string} packageName @param {unknown} [error] */
function reactFailure(packageName, error) {
  const detail = error === undefined ? '' : ` (${errorText(error)})`;
  return new CliError(
    `HTML builds need React 19 installed. Cannot load "${packageName}"${detail}. `
    + 'Install "react@^19" and "react-dom@^19" in the project that installs reactive-md.',
    EXIT.DOCUMENT,
    error === undefined ? undefined : { cause: error },
  );
}

/**
 * Dynamically load React as an optional peer. Both interactive and static HTML
 * builds server-render the document, so both need React 19.
 */
export async function loadReact() {
  let reactModule;
  try {
    reactModule = await import('react');
  } catch (error) {
    throw reactFailure('react', error);
  }
  const React = reactModule?.default ?? reactModule;
  const createElement = reactModule?.createElement ?? React?.createElement;
  const version = reactModule?.version ?? React?.version;
  if (typeof createElement !== 'function') {
    throw reactFailure('react', new Error('the createElement export is missing'));
  }
  if (typeof version !== 'string' || !version.startsWith('19.')) {
    throw new CliError(
      `HTML builds need React 19 installed; found React ${version ?? 'unknown'}. `
      + 'Install "react@^19" and "react-dom@^19" in the project that installs reactive-md.',
      EXIT.DOCUMENT,
    );
  }

  let serverModule;
  try {
    serverModule = await import('react-dom/server');
  } catch (error) {
    throw reactFailure('react-dom/server', error);
  }
  const renderToString = serverModule?.renderToString ?? serverModule?.default?.renderToString;
  if (typeof renderToString !== 'function') {
    throw reactFailure('react-dom/server', new Error('the renderToString export is missing'));
  }

  return { createElement, renderToString, version };
}

/**
 * Load the built React renderer. It is a package artifact, so failures point at
 * the build rather than at the user's document.
 * @param {string} packageRoot
 */
export async function loadReactRenderer(packageRoot) {
  await assertArtifact(packageRoot, 'react');
  const file = artifactPath(packageRoot, 'react');
  let module;
  try {
    module = await import(pathToFileURL(file).href);
  } catch (error) {
    throw new CliError(
      `Cannot load the React renderer build at "${file}": ${errorText(error)}. ${BUILD_HINT}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }
  if (typeof module?.LocalDocumentView !== 'function') {
    throw new CliError(
      `The React renderer build at "${file}" is missing the "LocalDocumentView" export. ${BUILD_HINT}`,
      EXIT.DOCUMENT,
    );
  }
  return { LocalDocumentView: module.LocalDocumentView };
}
