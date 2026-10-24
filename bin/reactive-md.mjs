#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const HELP = {
  en: `Usage: reactive-md lint [--json] [--warnings-as-errors] [--locale en|zh] <file... | ->

Check ReactiveMD documents with the language compiler. Use - for stdin.
Options: --json               Print an array of file reports
         --warnings-as-errors Fail on warnings as well as errors
         --locale en|zh       Language for messages (default: en)
         --                   Treat remaining arguments as file paths
         --help, -h           Show this help
Exit codes: 0 clean, 1 diagnostics, 2 usage or file-read error.
`,
  zh: `用法：reactive-md lint [--json] [--warnings-as-errors] [--locale en|zh] <文件... | ->

使用语言编译器检查 ReactiveMD 文档。用 - 读取标准输入。
选项：--json               输出文件报告数组
      --warnings-as-errors 警告也视为失败
      --locale en|zh       诊断消息语言（默认 en）
      --                   其后的参数都按文件路径处理
      --help, -h           显示此帮助
退出码：0 无问题，1 有诊断，2 用法或读取失败。
`,
};

const MESSAGES = {
  unknownOption: {
    en: (arg, help) => `Unknown option: ${arg}\n${help}`,
    zh: (arg, help) => `未知选项：${arg}\n${help}`,
  },
  supplyFiles: {
    en: (_value, help) => `Supply files or one stdin argument (-).\n${help}`,
    zh: (_value, help) => `请提供文件或一个标准输入参数（-）。\n${help}`,
  },
  invalidLocale: {
    en: (value, help) => `Invalid --locale value: ${value}. Use en or zh.\n${help}`,
    zh: (value, help) => `--locale 的值无效：${value}。请使用 en 或 zh。\n${help}`,
  },
  readFailed: {
    en: (detail) => `Cannot read input: ${detail}`,
    zh: (detail) => `无法读取输入：${detail}`,
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

async function main(rawArgs) {
  const { locale, invalid, args } = extractLocale(rawArgs);
  const help = HELP[locale === 'zh' ? 'zh' : 'en'];
  if (invalid !== undefined) {
    process.stderr.write(message('invalidLocale', locale, invalid, help));
    return 2;
  }
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(help);
    return 0;
  }
  if (args.shift() !== 'lint') {
    process.stderr.write(help);
    return 2;
  }
  let json = false;
  let strict = false;
  let pathsOnly = false;
  const files = [];
  for (const arg of args) {
    if (!pathsOnly && arg === '--') { pathsOnly = true; continue; }
    if (!pathsOnly && arg === '--json') { json = true; continue; }
    if (!pathsOnly && arg === '--warnings-as-errors') { strict = true; continue; }
    if (!pathsOnly && ['--help', '-h'].includes(arg)) { process.stdout.write(help); return 0; }
    if (!pathsOnly && arg.startsWith('-') && arg !== '-') {
      process.stderr.write(message('unknownOption', locale, arg, help));
      return 2;
    }
    files.push(arg);
  }
  if (!files.length || files.filter(file => file === '-').length > 1) {
    process.stderr.write(message('supplyFiles', locale, '', help));
    return 2;
  }

  const { compileLocal, formatLocalDiagnostic } = await import('../dist-library/reactive-md.js');
  const localizeDiagnostic = (diagnostic) => ({
    ...diagnostic,
    message: formatLocalDiagnostic(diagnostic, locale),
  });
  const reports = [];
  let exitCode = 0;
  for (const file of files) {
    const name = file === '-' ? '<stdin>' : file;
    try {
      const source = file === '-' ? await readStdin() : await readFile(file, 'utf8');
      const result = compileLocal(source);
      const ok = result.ok && (!strict || !result.diagnostics.length);
      reports.push({ file: name, ok, diagnostics: result.diagnostics.map(localizeDiagnostic) });
      if (!ok) exitCode = Math.max(exitCode, 1);
    } catch (error) {
      exitCode = 2;
      // The file is already in the report. Keep the OS code as data in Chinese
      // output instead of embedding an English operating-system sentence.
      const detail = locale === 'zh'
        ? (typeof error?.code === 'string' ? error.code : '读取失败')
        : (error instanceof Error ? error.message : String(error));
      reports.push({ file: name, ok: false, diagnostics: [{
        code: 'cli.io', message: message('readFailed', locale, detail),
        severity: 'error', range: { start: 0, end: 0 }, line: 1, column: 1,
      }] });
    }
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  } else {
    for (const report of reports) {
      for (const item of report.diagnostics) {
        // Escape control characters so paths and messages remain one terminal line.
        const clean = value => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
        process.stdout.write(`${clean(report.file)}:${item.line}:${item.column}: ${item.severity} ${clean(item.code)} ${clean(item.message)}\n`);
      }
      if (!report.diagnostics.length) process.stdout.write(`${JSON.stringify(report.file)}: OK\n`);
    }
  }
  return exitCode;
}

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let source = '';
  for await (const chunk of process.stdin) source += chunk;
  return source;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`reactive-md: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
