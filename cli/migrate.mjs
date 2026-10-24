import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { displayPath, formatDiagnostic } from './document.mjs';
import { CliError, EXIT, fsFailure, usageError } from './errors.mjs';
import { assertDistinctPaths } from './fs-utils.mjs';
import { migrateHelp } from './help.mjs';
import { loadCore } from './package.mjs';

const FROM_VERSIONS = ['local-draft-1', 'local-draft-2'];

const MESSAGES = {
  missingInput: {
    en: (_value, help) => `Supply one input document or - for stdin.\n${help}`,
    zh: (_value, help) => `请提供一个输入文档，或用 - 读取标准输入。\n${help}`,
  },
  multipleInputs: {
    en: (value, help) => `Expected one input document, received ${value}.\n${help}`,
    zh: (value, help) => `只能提供一个输入文档，实际收到 ${value} 个。\n${help}`,
  },
  emptyInput: {
    en: (_value, help) => `The input path must not be empty.\n${help}`,
    zh: (_value, help) => `输入路径不能为空。\n${help}`,
  },
  unknownOption: {
    en: (value, help) => `Unknown option: ${value}\n${help}`,
    zh: (value, help) => `未知选项：${value}\n${help}`,
  },
  missingValue: {
    en: (value, help) => `Option "${value}" requires a value.\n${help}`,
    zh: (value, help) => `选项 "${value}" 需要一个值。\n${help}`,
  },
  emptyValue: {
    en: (value, help) => `Option "${value}" requires a non-empty value.\n${help}`,
    zh: (value, help) => `选项 "${value}" 的值不能为空。\n${help}`,
  },
  invalidFrom: {
    en: (value, help) => `Invalid --from value: ${value}. Use ${FROM_VERSIONS.join(' or ')}.\n${help}`,
    zh: (value, help) => `--from 的值无效：${value}。请使用 ${FROM_VERSIONS.join(' 或 ')}。\n${help}`,
  },
  invalidLocale: {
    en: (value, help) => `Invalid --locale value: ${value}. Use en or zh.\n${help}`,
    zh: (value, help) => `--locale 的值无效：${value}。请使用 en 或 zh。\n${help}`,
  },
  checkWithOutput: {
    en: (_value, help) => `--check never writes output; remove --output.\n${help}`,
    zh: (_value, help) => `--check 不写入文件；请去掉 --output。\n${help}`,
  },
  readFailed: {
    en: (value) => `Cannot read input: ${value}`,
    zh: (value) => `无法读取输入：${value}`,
  },
  blocked: {
    en: (value) => `Migration blocked by ${value} diagnostic(s).`,
    zh: (value) => `迁移被 ${value} 条诊断阻止。`,
  },
  notApplied: {
    en: (value) => `Migration was not applied: ${value}.`,
    zh: (value) => `未执行迁移：${value}。`,
  },
  needed: {
    en: (value) => `Migration needed: ${value}.`,
    zh: (value) => `需要迁移：${value}。`,
  },
  current: {
    en: (value) => `Already current: ${value}.`,
    zh: (value) => `已是最新版本：${value}。`,
  },
};

function message(kind, locale, value, help) {
  return MESSAGES[kind][locale === 'zh' ? 'zh' : 'en'](value, help);
}

/** Extract --locale before validation so usage errors use the requested language. */
function extractLocale(args) {
  let locale = 'en';
  let invalid;
  const rest = [];
  let pathsOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!pathsOnly && arg === '--') {
      pathsOnly = true;
      rest.push(arg);
      continue;
    }
    if (!pathsOnly && arg === '--locale') {
      const value = args[index + 1];
      if (value !== 'en' && value !== 'zh') {
        invalid = value === undefined ? '' : value;
        break;
      }
      locale = value;
      index += 1;
      continue;
    }
    if (!pathsOnly && arg.startsWith('--locale=')) {
      const value = arg.slice('--locale='.length);
      if (value !== 'en' && value !== 'zh') {
        invalid = value;
        break;
      }
      locale = value;
      continue;
    }
    rest.push(arg);
  }
  return { locale, invalid, args: rest };
}

/** @param {string[]} args @param {object} help @param {'en'|'zh'} locale */
function parseArgs(args, help, locale) {
  const positionals = [];
  const options = { check: false, json: false, acceptSemanticChanges: false, help: false };
  let literal = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
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
    if (token === '-h' || token === '--help') {
      options.help = true;
      continue;
    }
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--accept-semantic-changes') {
      options.acceptSemanticChanges = true;
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
    if (name !== '-o' && name !== '--output' && name !== '--from') {
      throw usageError(message('unknownOption', locale, name, help));
    }
    let value = inlineValue;
    if (value === undefined) {
      if (index + 1 >= args.length) {
        throw usageError(message('missingValue', locale, name, help));
      }
      value = args[index + 1];
      index += 1;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw usageError(message('emptyValue', locale, name, help));
    }
    if (name === '--from') {
      if (!FROM_VERSIONS.includes(value)) {
        throw usageError(message('invalidFrom', locale, value, help));
      }
      options.from = value;
    } else {
      options.output = value;
    }
  }

  return { positionals, options };
}

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let source = '';
  for await (const chunk of process.stdin) source += chunk;
  return source;
}

/**
 * Exclusive creation: never overwrite an existing file, including the input.
 * @param {string} inputPath `-` for stdin
 * @param {string} outputPath
 * @param {string} content
 */
async function writeNewFile(inputPath, outputPath, content) {
  const absolute = path.resolve(outputPath);
  if (inputPath !== '-') await assertDistinctPaths(inputPath, absolute);
  try {
    await writeFile(absolute, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'EEXIST') {
      throw new CliError(`Output file already exists: "${absolute}". Migration never overwrites files.`, EXIT.USAGE, { cause: error });
    }
    throw fsFailure('Cannot write output file', absolute, error, EXIT.USAGE);
  }
}

/**
 * `reactive-md migrate <file|->`
 *
 * @param {string[]} args Arguments after the `migrate` command.
 * @param {{packageRoot: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream}} context
 */
export async function runMigrate(args, { packageRoot, stdout, stderr }) {
  const { locale, invalid, args: rest } = extractLocale(args);
  const help = migrateHelp(locale);
  if (invalid !== undefined) {
    stderr.write(message('invalidLocale', locale, invalid, help));
    return EXIT.USAGE;
  }

  let parsed;
  try {
    parsed = parseArgs(rest, help, locale);
  } catch (error) {
    if (error instanceof CliError) {
      stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  }
  const { positionals, options } = parsed;

  if (options.help) {
    stdout.write(help);
    return EXIT.OK;
  }
  if (positionals.length === 0) {
    stderr.write(message('missingInput', locale, '', help));
    return EXIT.USAGE;
  }
  if (positionals.length > 1) {
    stderr.write(message('multipleInputs', locale, positionals.length, help));
    return EXIT.USAGE;
  }
  const input = positionals[0];
  if (input.trim() === '') {
    stderr.write(message('emptyInput', locale, '', help));
    return EXIT.USAGE;
  }
  if (options.check && options.output !== undefined) {
    stderr.write(message('checkWithOutput', locale, '', help));
    return EXIT.USAGE;
  }

  let source;
  if (input === '-') {
    source = await readStdin();
  } else {
    try {
      source = await readFile(input, 'utf8');
    } catch (error) {
      const detail = locale === 'zh'
        ? (typeof error?.code === 'string' ? error.code : '读取失败')
        : (error instanceof Error ? error.message : String(error));
      stderr.write(`${message('readFailed', locale, detail)}\n`);
      return EXIT.USAGE;
    }
  }

  const required = options.check
    ? ['checkLocalUpgrade', 'formatLocalDiagnostic']
    : ['migrateLocalSource', 'formatLocalDiagnostic'];
  const core = await loadCore(packageRoot, required);
  const coreOptions = {};
  if (options.from !== undefined) coreOptions.fromVersion = options.from;
  if (options.acceptSemanticChanges) coreOptions.allowSemanticChanges = true;

  const result = options.check
    ? core.checkLocalUpgrade(source, coreOptions)
    : core.migrateLocalSource(source, coreOptions);
  if (!result || typeof result !== 'object' || !Array.isArray(result.diagnostics)) {
    throw new CliError('The core build returned an invalid migration result. Run "npm run build" again.', EXIT.DOCUMENT);
  }
  if (!options.check && typeof result.source !== 'string') {
    throw new CliError('The core build returned a migration result without source. Run "npm run build" again.', EXIT.DOCUMENT);
  }

  const label = input === '-' ? '<stdin>' : displayPath(input);
  const diagnostics = result.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    message: core.formatLocalDiagnostic(diagnostic, locale),
  }));
  const ok = result.ok === true;

  if (options.json) {
    const report = {
      file: label,
      mode: options.check ? 'check' : 'migrate',
      ok,
      fromVersion: result.fromVersion,
      toVersion: result.toVersion,
      needsMigration: result.needsMigration === true,
      diagnostics,
    };
    if (options.check) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return !ok || result.needsMigration === true ? 1 : 0;
    }
    report.changed = result.changed === true;
    report.edits = Array.isArray(result.edits) ? result.edits : [];
    if (!ok) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 1;
    }
    if (options.output !== undefined) {
      report.output = path.resolve(options.output);
      await writeNewFile(input, options.output, result.source);
    } else {
      report.source = result.source;
    }
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return EXIT.OK;
  }

  if (options.check) {
    for (const diagnostic of diagnostics) {
      stdout.write(`${formatDiagnostic(label, diagnostic)}\n`);
    }
    if (!ok) {
      if (diagnostics.length === 0) {
        stdout.write(`${message('notApplied', locale, label)}\n`);
      } else {
        stdout.write(`${message('blocked', locale, diagnostics.filter((item) => item.severity === 'error').length || diagnostics.length)}\n`);
      }
      return 1;
    }
    if (result.needsMigration === true) {
      stdout.write(`${message('needed', locale, `${result.fromVersion} -> ${result.toVersion}`)}\n`);
      return 1;
    }
    stdout.write(`${message('current', locale, result.toVersion)}\n`);
    return EXIT.OK;
  }

  if (!ok) {
    for (const diagnostic of diagnostics) {
      stderr.write(`${formatDiagnostic(label, diagnostic)}\n`);
    }
    if (diagnostics.length === 0) {
      stderr.write(`reactive-md: ${message('notApplied', locale, label)}\n`);
    }
    return 1;
  }

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'warning') stderr.write(`${formatDiagnostic(label, diagnostic)}\n`);
  }
  if (options.output !== undefined) {
    await writeNewFile(input, options.output, result.source);
  } else {
    stdout.write(result.source);
  }
  return EXIT.OK;
}
