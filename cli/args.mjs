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

/** Playwright paper names are case-sensitive, so accept any case and spell them canonically. */
const PDF_PAPER_SIZES = Object.freeze([
  'Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
]);

/** @param {unknown} value */
function paperSize(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw usageError('Option "--pdf-paper" requires a paper size such as "A4" or "Letter".');
  }
  const normalized = value.trim().toLowerCase();
  const match = PDF_PAPER_SIZES.find((size) => size.toLowerCase() === normalized);
  if (!match) {
    throw usageError(`Invalid value for "--pdf-paper": "${value}". Expected ${PDF_PAPER_SIZES.join(', ')}.`);
  }
  return match;
}

const BUILD_SPEC = new Map([
  ['-o', { key: 'output' }],
  ['--output', { key: 'output' }],
  ['--mode', { key: 'mode' }],
  ['--format', { key: 'format' }],
  ['--project-root', { key: 'projectRoot' }],
  ['--pdf-paper', { key: 'pdfPaper' }],
  ['--pdf-landscape', { key: 'pdfLandscape', boolean: true }],
  ['--pdf-margin', { key: 'pdfMargin' }],
  ['--pdf-background', { key: 'pdfBackground' }],
  ['--state-file', { key: 'stateFile' }],
  ['--component-state-file', { key: 'componentStateFile' }],
  ['--document-id', { key: 'documentId' }],
  ['--random-seed', { key: 'randomSeed' }],
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
 *   format?: 'html'|'pdf', projectRoot?: string, pdf?: import('../dist-library/types/pdf.js').LocalPdfOptions,
 *   stateFile?: string, componentStateFile?: string, documentId?: string,
 *   randomSeed?: number, assets?: 'inline'|'omit', assetRoot?: string,
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
  const format = options.format === undefined ? 'html' : choice(options.format, '--format', ['html', 'pdf']);
  const mode = options.mode === undefined
    ? (format === 'pdf' ? 'static' : 'interactive')
    : choice(options.mode, '--mode', ['interactive', 'static']);
  if (format === 'pdf' && mode !== 'static') throw usageError('PDF output requires static mode.');
  const pdfKeys = ['pdfPaper', 'pdfLandscape', 'pdfMargin', 'pdfBackground'];
  if (format !== 'pdf' && pdfKeys.some((key) => options[key] !== undefined)) {
    throw usageError('PDF layout options require "--format pdf".');
  }
  const projectRoot = options.projectRoot === undefined ? undefined : requireText(options.projectRoot, '--project-root');
  if (projectRoot !== undefined && isUrlLike(projectRoot)) throw usageError('Option "--project-root" must be a local directory path.');
  const pdfMargin = options.pdfMargin === undefined ? undefined : requireText(options.pdfMargin, '--pdf-margin');
  if (pdfMargin !== undefined && !/^(?:\d+(?:\.\d+)?)(?:px|in|cm|mm)?$/i.test(pdfMargin)) {
    throw usageError('Option "--pdf-margin" requires a non-negative length such as "12mm".');
  }
  const pdf = format === 'pdf' ? {
    format: options.pdfPaper === undefined ? 'A4' : paperSize(options.pdfPaper),
    landscape: options.pdfLandscape === true,
    margin: pdfMargin === undefined ? undefined : { top: pdfMargin, right: pdfMargin, bottom: pdfMargin, left: pdfMargin },
    printBackground: options.pdfBackground === undefined
      ? true
      : choice(options.pdfBackground, '--pdf-background', ['on', 'off']) === 'on',
  } : undefined;
  const assets = options.assets === undefined ? 'inline' : choice(options.assets, '--assets', ['inline', 'omit']);
  const locale = options.locale === undefined ? 'en' : choice(options.locale, '--locale', ['en', 'zh']);
  const colorScheme = options.colorScheme === undefined
    ? 'auto'
    : choice(options.colorScheme, '--color-scheme', ['auto', 'light', 'dark']);

  let stateFile;
  if (options.stateFile !== undefined) stateFile = requireText(options.stateFile, '--state-file');
  let componentStateFile;
  if (options.componentStateFile !== undefined) {
    componentStateFile = requireText(options.componentStateFile, '--component-state-file');
    if (mode !== 'interactive') {
      throw usageError('Option "--component-state-file" requires "--mode interactive"; static output has no runtime.');
    }
  }
  let documentId;
  if (options.documentId !== undefined) {
    documentId = requireText(options.documentId, '--document-id');
    if (!/^[^\u0000-\u001f\u007f]{1,256}$/.test(documentId)) {
      throw usageError('Option "--document-id" must be 1-256 characters without control characters.');
    }
  }
  let randomSeed;
  if (options.randomSeed !== undefined) {
    const text = requireText(options.randomSeed, '--random-seed');
    if (!/^\d{1,10}$/.test(text)) {
      throw usageError('Option "--random-seed" must be a 32-bit unsigned integer.');
    }
    randomSeed = Number(text);
    if (!Number.isSafeInteger(randomSeed) || randomSeed > 0xffffffff) {
      throw usageError('Option "--random-seed" must be a 32-bit unsigned integer.');
    }
  }
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
    format,
    projectRoot,
    pdf,
    stateFile,
    componentStateFile,
    documentId,
    randomSeed,
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
