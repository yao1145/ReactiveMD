#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const help = `Usage: reactive-md lint [--json] [--warnings-as-errors] <file... | ->

Check ReactiveMD documents with the language compiler. Use - for stdin.
Options: --json               Print an array of file reports
         --warnings-as-errors Fail on warnings as well as errors
         --                   Treat remaining arguments as file paths
         --help, -h           Show this help
Exit codes: 0 clean, 1 diagnostics, 2 usage or file-read error.
`;

async function main(args) {
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
      process.stderr.write(`Unknown option: ${arg}\n${help}`);
      return 2;
    }
    files.push(arg);
  }
  if (!files.length || files.filter(file => file === '-').length > 1) {
    process.stderr.write(`Supply files or one stdin argument (-).\n${help}`);
    return 2;
  }

  const { compileLocal } = await import('../dist-library/reactive-md.js');
  const reports = [];
  let exitCode = 0;
  for (const file of files) {
    const name = file === '-' ? '<stdin>' : file;
    try {
      const source = file === '-' ? await readStdin() : await readFile(file, 'utf8');
      const result = compileLocal(source);
      const ok = result.ok && (!strict || !result.diagnostics.length);
      reports.push({ file: name, ok, diagnostics: result.diagnostics });
      if (!ok) exitCode = Math.max(exitCode, 1);
    } catch (error) {
      exitCode = 2;
      reports.push({ file: name, ok: false, diagnostics: [{
        code: 'cli.io', message: error instanceof Error ? error.message : String(error),
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
