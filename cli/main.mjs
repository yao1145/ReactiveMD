import { parseBuildArgs, parseLintArgs } from './args.mjs';
import { runBuild } from './build.mjs';
import { EXIT, usageError } from './errors.mjs';
import { buildHelp, lintHelp, mainHelp } from './help.mjs';
import { runLint } from './lint.mjs';
import { readPackageInfo } from './package.mjs';

/**
 * Entry point shared by bin/reactive-md.mjs. The caller supplies streams so the
 * CLI stays testable without touching process state.
 *
 * @param {string[]} argv
 * @param {{packageRoot: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream}} context
 */
export async function runCli(argv, context) {
  const [command, ...rest] = argv;

  if (command === '--version' || command === '-v' || command === '-V') {
    const packageInfo = await readPackageInfo(context.packageRoot);
    context.stdout.write(`${packageInfo.version}\n`);
    return EXIT.OK;
  }

  if (command === '--help' || command === '-h') {
    const packageInfo = await readPackageInfo(context.packageRoot);
    context.stdout.write(mainHelp(packageInfo.version));
    return EXIT.OK;
  }

  if (command === undefined) {
    const packageInfo = await readPackageInfo(context.packageRoot);
    context.stderr.write(mainHelp(packageInfo.version));
    return EXIT.USAGE;
  }

  if (command === 'build') {
    const options = parseBuildArgs(rest);
    if (options.help) {
      context.stdout.write(buildHelp());
      return EXIT.OK;
    }
    return runBuild(options, context);
  }

  if (command === 'lint') {
    const options = parseLintArgs(rest);
    if (options.help) {
      context.stdout.write(lintHelp());
      return EXIT.OK;
    }
    return runLint(options, context);
  }

  throw usageError(`Unknown command "${command}". Run "reactive-md --help" for usage.`);
}
