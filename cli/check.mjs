import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CliError, EXIT, errorText, fsFailure, usageError } from './errors.mjs';
import { checkHelp } from './help.mjs';

const CHECK_SPEC = new Map([
  ['--locale', { key: 'locale' }],
  ['-h', { key: 'help', boolean: true }],
  ['--help', { key: 'help', boolean: true }],
]);

/**
 * @param {string[]} argv
 */
function parseCheckOptions(argv) {
  const positionals = [];
  const options = {};
  let literal = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (literal) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      literal = true;
      continue;
    }
    if (token === '-' || !token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    let name = token;
    let inlineValue;
    if (token.startsWith('--')) {
      const equals = token.indexOf('=');
      if (equals > 2) {
        name = token.slice(0, equals);
        inlineValue = token.slice(equals + 1);
      }
    }
    const entry = CHECK_SPEC.get(name);
    if (!entry) {
      throw usageError(`Unknown option "${name}". Run "reactive-md check --help" for usage.`);
    }
    if (entry.boolean) {
      if (inlineValue !== undefined) throw usageError(`Option "${name}" does not take a value.`);
      options[entry.key] = true;
      continue;
    }
    let value = inlineValue;
    if (value === undefined) {
      if (index + 1 >= argv.length) throw usageError(`Option "${name}" requires a value.`);
      value = argv[index + 1];
      index += 1;
    }
    options[entry.key] = value;
  }

  return { positionals, options };
}

/** @param {unknown} value */
function parseLocale(value) {
  if (value === undefined) return 'en';
  const normalized = String(value).trim().toLowerCase();
  if (normalized !== 'en' && normalized !== 'zh') {
    throw usageError(`Invalid value for "--locale": "${value}". Expected en or zh.`);
  }
  return normalized;
}

/** @param {string} message */
function checkFailure(message) {
  return new CliError(message, EXIT.DOCUMENT);
}

/**
 * @param {string} packageRoot
 */
async function loadSdk(packageRoot) {
  const file = path.join(packageRoot, 'dist-library', 'reactive-md-sdk.js');
  try {
    return await import(pathToFileURL(file).href);
  } catch (error) {
    throw new CliError(
      `Cannot load the SDK build at "${file}": ${errorText(error)}. Run "npm run build" from a source checkout.`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }
}

/**
 * @param {string} target
 */
async function readPackage(target) {
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    throw fsFailure('Cannot inspect package path', target, error, EXIT.IO);
  }
  const directory = info.isDirectory() ? target : path.dirname(target);
  const file = info.isDirectory() ? path.join(target, 'package.json') : target;
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw fsFailure('Cannot read package metadata', file, error, EXIT.IO);
  }
  let metadata;
  try {
    metadata = JSON.parse(text);
  } catch (error) {
    throw checkFailure(`Package metadata at "${file}" is not valid JSON: ${errorText(error)}.`);
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw checkFailure(`Package metadata at "${file}" must be a JSON object.`);
  }
  if (typeof metadata.name !== 'string' || metadata.name === '') {
    throw checkFailure(`Package metadata at "${file}" does not declare a name.`);
  }
  if (typeof metadata.version !== 'string' || metadata.version === '') {
    throw checkFailure(`Package metadata at "${file}" does not declare a version.`);
  }
  return { directory, file, metadata };
}

/**
 * @param {Record<string, any>} metadata
 */
function readExports(metadata) {
  const exported = metadata.exports;
  if (!exported || typeof exported !== 'object' || Array.isArray(exported)) {
    throw checkFailure(`Package "${metadata.name}" does not declare an exports map.`);
  }
  const entries = new Map();
  for (const [key, entry] of Object.entries(exported)) {
    if (key === './package.json') continue;
    let target;
    let types;
    if (typeof entry === 'string') {
      target = entry;
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      target = typeof entry.import === 'string' ? entry.import : typeof entry.default === 'string' ? entry.default : undefined;
      types = typeof entry.types === 'string' ? entry.types : undefined;
    }
    if (target === undefined && types === undefined) continue;
    entries.set(key, { target, types });
  }
  if (!entries.has('.')) {
    throw checkFailure(`Package "${metadata.name}" must export "." for its public entry.`);
  }
  return entries;
}

/**
 * @param {string} directory
 * @param {string} key
 * @param {string} field
 * @param {string | undefined} relative
 */
async function assertExportFile(directory, key, field, relative) {
  if (relative === undefined) return;
  if (!relative.startsWith('./')) {
    throw checkFailure(`Export "${key}" ${field} must be a relative path starting with "./": "${relative}".`);
  }
  const file = path.resolve(directory, relative);
  const inside = path.relative(directory, file);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw checkFailure(`Export "${key}" ${field} escapes the package directory: "${relative}".`);
  }
  let info;
  try {
    info = await stat(file);
  } catch {
    throw checkFailure(`Export "${key}" ${field} points to a missing file: "${file}".`);
  }
  if (!info.isFile()) {
    throw checkFailure(`Export "${key}" ${field} is not a regular file: "${file}".`);
  }
}

/**
 * @param {string} file
 * @param {string} label
 */
async function importModule(file, label) {
  try {
    return await import(pathToFileURL(file).href);
  } catch (error) {
    throw new CliError(`Cannot load ${label} at "${file}": ${errorText(error)}`, EXIT.DOCUMENT, { cause: error });
  }
}

function isPreset(value, sdk) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && value.protocol === sdk.LOCAL_PRESET_PROTOCOL && Array.isArray(value.components);
}

function isReactPreset(value, sdk) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && value.protocol === sdk.LOCAL_REACT_PRESET_PROTOCOL && isPreset(value.preset, sdk);
}

function isComponentDefinition(value, sdk) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && value.protocol === sdk.LOCAL_COMPONENT_PROTOCOL
    && typeof value.id === 'string' && typeof value.name === 'string';
}

function isComponentPackage(value, sdk) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && isComponentDefinition(value.definition, sdk) && Array.isArray(value.components);
}

/**
 * @param {any} config
 * @param {any} sdk
 */
function verifyRoundtrip(config, sdk) {
  let structured;
  let json;
  try {
    structured = sdk.readLocalConfig(structuredClone(config));
  } catch (error) {
    throw checkFailure(`structuredClone round-trip failed: ${errorText(error)}`);
  }
  try {
    json = sdk.readLocalConfig(JSON.parse(JSON.stringify(config)));
  } catch (error) {
    throw checkFailure(`JSON round-trip failed: ${errorText(error)}`);
  }
  if (structured.key !== config.key || json.key !== config.key) {
    throw checkFailure('The configuration key changed after a structuredClone or JSON round-trip.');
  }
  const registry = sdk.getLocalComponentRegistry(structured);
  const expected = config.registry.map((component) => component.id);
  const rebuilt = registry.map((component) => component.id);
  if (expected.length !== rebuilt.length || expected.some((id, index) => id !== rebuilt[index])) {
    throw checkFailure('The active registry changed after the configuration round-trip.');
  }
  return { structured, json, registry };
}

/**
 * @param {readonly any[]} definitions
 * @param {readonly any[]} implementations
 * @param {readonly any[]} resources
 * @param {any} sdk
 * @param {string} label
 */
function verifyImplementations(definitions, implementations, resources, sdk, label) {
  const semantic = new Map(definitions.map((definition) => [definition.id, definition]));
  const seen = new Set();
  for (const implementation of implementations) {
    const definition = implementation?.definition;
    if (!definition || typeof definition.id !== 'string' || !semantic.has(definition.id)) {
      throw checkFailure(`local.config.implementation-mismatch: ${label} has an implementation without a matching semantic component.`);
    }
    if (seen.has(definition.id)) {
      throw checkFailure(`local.config.implementation-duplicate: ${label} implements "${definition.id}" more than once.`);
    }
    if (implementation.digest !== sdk.localComponentDigest(definition)) {
      throw checkFailure(`local.config.implementation-mismatch: implementation digest for "${definition.id}" does not match its manifest.`);
    }
    seen.add(definition.id);
  }
  const missing = definitions.filter((definition) => !seen.has(definition.id)).map((definition) => definition.id);
  if (missing.length > 0) {
    throw checkFailure(`local.config.implementation-missing: ${label} is missing implementations for: ${missing.join(', ')}.`);
  }

  const available = new Map(resources.map((resource) => [resource.id, resource.css]));
  const required = [];
  for (const definition of definitions) {
    for (const id of definition.styles ?? []) {
      if (!required.includes(id)) required.push(id);
      if (!available.has(id)) {
        throw checkFailure(`local.config.resource-missing: ${label} does not provide style resource "${id}".`);
      }
    }
  }
  return { implementations: seen.size, requiredResources: required.length };
}

/**
 * @param {string[]} argv
 * @param {{packageRoot?: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream}} context
 */
export async function runCheck(argv, context) {
  const { positionals, options } = parseCheckOptions(argv);
  const locale = parseLocale(options.locale);
  if (options.help) {
    context.stdout.write(checkHelp(locale));
    return EXIT.OK;
  }
  if (positionals.length === 0) {
    throw usageError('Missing package path. Usage: reactive-md check <package>.');
  }
  if (positionals.length > 1) {
    throw usageError(`Expected one package path, received ${positionals.length}.`);
  }

  const sdk = await loadSdk(context.packageRoot);
  // Installed packages resolve their own dependencies. The fallback only
  // applies to scaffolds checked from a source checkout.
  register(new URL('./package-loader.mjs', import.meta.url), {
    parentURL: import.meta.url,
    data: { packageRoot: context.packageRoot },
  });

  const { directory, metadata } = await readPackage(path.resolve(positionals[0]));
  const exports = readExports(metadata);
  for (const [key, entry] of exports) {
    await assertExportFile(directory, key, 'import', entry.target);
    await assertExportFile(directory, key, 'types', entry.types);
  }

  const mainExport = exports.get('.');
  if (typeof mainExport.target !== 'string') {
    throw checkFailure(`Package "${metadata.name}" must declare an import target for ".".`);
  }
  const mainEntry = path.resolve(directory, mainExport.target);
  const main = await importModule(mainEntry, 'package entry');

  /** @type {'preset' | 'react-preset' | 'component'} */
  let kind;
  let preset;
  let reactPreset;
  let componentPackage;
  let definition;
  const mainValues = [main.reactPreset, main.preset, main.default, main.componentPackage, main.manifest];
  const reactMain = mainValues.find((value) => isReactPreset(value, sdk));
  const presetMain = mainValues.find((value) => isPreset(value, sdk));
  const packageMain = mainValues.find((value) => isComponentPackage(value, sdk));
  const definitionMain = mainValues.find((value) => isComponentDefinition(value, sdk));
  if (reactMain) {
    kind = 'react-preset';
    reactPreset = reactMain;
    preset = reactMain.preset;
  } else if (presetMain) {
    kind = 'preset';
    preset = presetMain;
  } else if (packageMain) {
    kind = 'component';
    componentPackage = packageMain;
    definition = packageMain.definition;
  } else if (definitionMain) {
    kind = 'component';
    definition = definitionMain;
  } else {
    throw checkFailure(`Package entry "${mainEntry}" does not export a preset or component package.`);
  }

  const notes = [];
  if (exports.has('./react')) {
    const reactEntry = path.resolve(directory, exports.get('./react').target);
    const reactModule = await importModule(reactEntry, 'React package entry');
    const value = reactModule.componentPackage ?? reactModule.reactPreset ?? reactModule.default;
    if (kind === 'component') {
      if (isComponentPackage(value, sdk)) {
        componentPackage = value;
        definition = value.definition;
      } else if (isComponentDefinition(value, sdk)) {
        definition = value;
      } else {
        throw checkFailure(`Export "./react" must load a component package, but "${reactEntry}" does not.`);
      }
    } else if (isReactPreset(value, sdk)) {
      if (reactPreset === undefined) reactPreset = value;
    } else {
      throw checkFailure(`Export "./react" must load a React preset package, but "${reactEntry}" does not.`);
    }
  } else if (kind !== 'react-preset') {
    notes.push('No "./react" export was declared; implementation coverage was not checked.');
  }

  let config;
  let implementationStats = { implementations: 0, requiredResources: 0 };
  if (kind === 'component') {
    if (!definition) throw checkFailure('The component package does not declare a manifest definition.');
    try {
      config = sdk.createLocalConfig({ presets: [], components: [definition] });
    } catch (error) {
      throw checkFailure(`Invalid component configuration: ${errorText(error)}`);
    }
    if (componentPackage) {
      implementationStats = verifyImplementations(
        [componentPackage.definition ?? definition],
        componentPackage.components,
        componentPackage.resources ?? [],
        sdk,
        `component "${definition.id}"`,
      );
    } else {
      notes.push('The package does not provide a React component package; implementation and resource coverage was not checked.');
    }
  } else {
    try {
      preset = sdk.defineLocalPreset(preset);
      config = sdk.createLocalConfig({ presets: [preset] });
    } catch (error) {
      throw checkFailure(`Invalid preset configuration: ${errorText(error)}`);
    }
    if (reactPreset) {
      if (reactPreset.preset.id !== preset.id || reactPreset.preset.version !== preset.version) {
        throw checkFailure(
          `local.config.implementation-mismatch: React pairing declares "${reactPreset.preset.id}@${reactPreset.preset.version}", `
          + `but the semantic preset is "${preset.id}@${preset.version}".`,
        );
      }
      implementationStats = verifyImplementations(
        preset.components,
        reactPreset.components,
        reactPreset.resources ?? [],
        sdk,
        `preset "${preset.id}"`,
      );
    } else if (kind === 'preset') {
      notes.push('No React pairing was declared; implementation and resource coverage was not checked.');
    }
  }

  const roundtrip = verifyRoundtrip(config, sdk);
  const label = kind === 'component' ? 'component' : 'preset';
  context.stdout.write(`Checked ${label} package "${metadata.name}@${metadata.version}" at "${directory}".\n`);
  context.stdout.write(`  exports: ${[...exports.keys()].join(', ')}\n`);
  context.stdout.write(`  config: key=${config.key}, presets=${config.presets.length}, registry=${roundtrip.registry.length}\n`);
  context.stdout.write('  roundtrip: structuredClone ok, JSON ok, registry rebuilt\n');
  if (kind !== 'component' && reactPreset) {
    context.stdout.write(`  implementations: ${implementationStats.implementations}/${preset.components.length}\n`);
  } else if (kind === 'component' && componentPackage) {
    context.stdout.write(`  implementations: ${implementationStats.implementations}\n`);
  }
  context.stdout.write(`  resources: ${implementationStats.requiredResources} required, 0 missing\n`);
  for (const note of notes) context.stdout.write(`  note: ${note}\n`);
  return EXIT.OK;
}
