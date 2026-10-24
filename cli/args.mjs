import { usageError } from './errors.mjs';

/** A local asset root may be a Windows drive path; it must never be a URL. */
function isUrlLike(value) {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (!match) return false;
  // C:\docs and C:/docs are local drive paths, not URL schemes.
  if (match[1].length === 1 && /^[a-z]:[\\/]/i.test(value)) return false;
  return true;
}

/**
 * @param {string[]} argv
 * @param {Map<string, {key: string, boolean?: boolean}>} spec
 * @returns {{positionals: string[], options: Record<string, string | boolean>}}
 */
function parseOptions(argv, spec) {
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
    const entry = spec.get(name);
    if (!entry) {
      throw usageError(`Unknown option "${name}". Run "reactive-md build --help" or "reactive-md lint --help" for usage.`);
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
function requireText(value, option) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw usageError(`Option "${option}" requires a non-empty value.`);
  }
  return value;
}

/** @param {unknown} value @param {string} option @param {readonly string[]} choices */
function choice(value, option, choices) {
  const normalized = String(value).toLowerCase();
  if (!choices.includes(normalized)) {
    throw usageError(`Invalid value for "${option}": "${value}". Expected ${choices.join(' or ')}.`);
  }
  return normalized;
}

const BUILD_SPEC = new Map([
  ['-o', { key: 'output' }],
  ['--output', { key: 'output' }],
  ['--mode', { key: 'mode' }],
  ['--state-file', { key: 'stateFile' }],
  ['--assets', { key: 'assets' }],
  ['--asset-root', { key: 'assetRoot' }],
  ['--locale', { key: 'locale' }],
  ['--color-scheme', { key: 'colorScheme' }],
  ['--title', { key: 'title' }],
  ['--strict', { key: 'strict', boolean: true }],
  ['-h', { key: 'help', boolean: true }],
  ['--help', { key: 'help', boolean: true }],
]);

const LINT_SPEC = new Map([
  ['--json', { key: 'json', boolean: true }],
  ['--strict', { key: 'strict', boolean: true }],
  ['-h', { key: 'help', boolean: true }],
  ['--help', { key: 'help', boolean: true }],
]);

/**
 * @param {string[]} argv
 * @returns {{
 *   help: boolean, input?: string, output?: string, mode?: 'interactive'|'static',
 *   stateFile?: string, assets?: 'inline'|'omit', assetRoot?: string,
 *   locale?: 'en'|'zh', colorScheme?: 'auto'|'light'|'dark', title?: string,
 *   strict?: boolean
 * }}
 */
export function parseBuildArgs(argv) {
  const { positionals, options } = parseOptions(argv, BUILD_SPEC);
  if (options.help) return { help: true };

  if (positionals.length === 0) {
    throw usageError('Missing input document. Usage: reactive-md build <doc.reactive.md> -o <doc.html>.');
  }
  if (positionals.length > 1) {
    throw usageError(`Expected one input document, received ${positionals.length}: ${positionals.join(', ')}.`);
  }
  const input = requireText(positionals[0], 'input');
  if (options.output === undefined) {
    throw usageError('Missing required option "--output" (-o). Usage: reactive-md build <doc.reactive.md> -o <doc.html>.');
  }
  const output = requireText(options.output, '--output');
  const mode = options.mode === undefined ? 'interactive' : choice(options.mode, '--mode', ['interactive', 'static']);
  const assets = options.assets === undefined ? 'inline' : choice(options.assets, '--assets', ['inline', 'omit']);
  const locale = options.locale === undefined ? 'en' : choice(options.locale, '--locale', ['en', 'zh']);
  const colorScheme = options.colorScheme === undefined
    ? 'auto'
    : choice(options.colorScheme, '--color-scheme', ['auto', 'light', 'dark']);

  let stateFile;
  if (options.stateFile !== undefined) stateFile = requireText(options.stateFile, '--state-file');
  let assetRoot;
  if (options.assetRoot !== undefined) {
    assetRoot = requireText(options.assetRoot, '--asset-root');
    if (isUrlLike(assetRoot)) {
      throw usageError('Option "--asset-root" must be a local directory path; URLs are not supported.');
    }
  }

  return {
    help: false,
    input,
    output,
    mode,
    stateFile,
    assets,
    assetRoot,
    locale,
    colorScheme,
    title: typeof options.title === 'string' ? options.title : undefined,
    strict: options.strict === true,
  };
}

/**
 * @param {string[]} argv
 * @returns {{help: boolean, inputs?: string[], json?: boolean, strict?: boolean}}
 */
export function parseLintArgs(argv) {
  const { positionals, options } = parseOptions(argv, LINT_SPEC);
  if (options.help) return { help: true };
  if (positionals.length === 0) {
    throw usageError('Missing lint inputs. Usage: reactive-md lint <files-or-dirs-or-globs...>.');
  }
  if (positionals.some((input) => input.trim() === '')) {
    throw usageError('Lint input paths must not be empty.');
  }
  return {
    help: false,
    inputs: positionals,
    json: options.json === true,
    strict: options.strict === true,
  };
}
