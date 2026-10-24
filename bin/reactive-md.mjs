#!/usr/bin/env node
/*
 * reactive-md command-line interface.
 *
 * Exit codes:
 *   0  success
 *   2  usage or argument error
 *   3  document compile, render, React or build-artifact error
 *   4  input or output file I/O error
 *   5  asset or security policy error
 *
 * Build artifacts and the package metadata are located relative to this file's
 * installed package root (bin/..), never the current working directory.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, EXIT } from '../cli/errors.mjs';
import { runCli } from '../cli/main.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = {
  packageRoot,
  stdout: process.stdout,
  stderr: process.stderr,
};

try {
  process.exitCode = await runCli(process.argv.slice(2), context);
} catch (error) {
  if (error instanceof CliError) {
    if (!error.reported) {
      context.stderr.write(`reactive-md: ${error.message}\n`);
    }
    process.exitCode = error.exitCode;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    context.stderr.write(`reactive-md: unexpected error: ${message}\n`);
    process.exitCode = EXIT.DOCUMENT;
  }
}
