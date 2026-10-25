import path from 'node:path';
import { collectImageNodes, collectInlineAssets, createAssetPolicy } from './assets.mjs';
import { displayPath, extractDocumentTitle, formatDiagnostic } from './document.mjs';
import { CliError, EXIT, errorText } from './errors.mjs';
import {
  assertDistinctPaths,
  assertOutputDirectory,
  atomicWriteUtf8,
  readTextFile,
} from './fs-utils.mjs';
import {
  loadCore,
  loadReact,
  loadReactRenderer,
  readArtifactText,
  readNotices,
  readPackageInfo,
} from './package.mjs';

/** @param {NodeJS.WritableStream} stream @param {string} file @param {any[]} diagnostics */
function writeDiagnostics(stream, file, diagnostics) {
  for (const diagnostic of diagnostics) {
    stream.write(`${formatDiagnostic(file, diagnostic)}\n`);
  }
}

/**
 * `reactive-md build`
 * @param {any} options
 * @param {{packageRoot: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream}} context
 */
export async function runBuild(options, context) {
  const { packageRoot, stdout, stderr } = context;
  const inputPath = path.resolve(options.input);
  const outputPath = path.resolve(options.output);
  const fileLabel = displayPath(inputPath);

  const source = await readTextFile(inputPath, {
    label: 'Cannot read input document',
    exitCode: EXIT.IO,
  });
  await assertDistinctPaths(inputPath, outputPath);
  await assertOutputDirectory(outputPath);

  const packageInfo = await readPackageInfo(packageRoot);
  const generator = { name: 'reactive-md', version: packageInfo.version };

  const core = await loadCore(packageRoot, [
    'compileLocal',
    'createLocalRuntime',
    'createLocalStateFile',
    'resolveLocalStateBaseline',
    'createShareableHtml',
  ]);

  let compiled;
  try {
    compiled = core.compileLocal(source);
  } catch (error) {
    throw new CliError(
      `The compiler failed on "${fileLabel}": ${errorText(error)}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }
  if (!compiled || typeof compiled !== 'object' || !Array.isArray(compiled.diagnostics)) {
    throw new CliError('The core build returned an invalid compile result. Run "npm run build" again.', EXIT.DOCUMENT);
  }

  const diagnostics = compiled.diagnostics;
  const errors = diagnostics.filter((diagnostic) => diagnostic?.severity === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic?.severity === 'warning');
  if (compiled.ok !== true || errors.length > 0) {
    writeDiagnostics(stderr, fileLabel, diagnostics);
    if (diagnostics.length === 0) {
      stderr.write(`reactive-md: error: "${fileLabel}" could not be compiled.\n`);
    }
    throw new CliError('', EXIT.DOCUMENT, { reported: true });
  }
  if (warnings.length > 0) {
    writeDiagnostics(stderr, fileLabel, warnings);
    if (options.strict) {
      stderr.write('reactive-md: error: warnings are treated as errors because --strict is set.\n');
      throw new CliError('', EXIT.DOCUMENT, { reported: true });
    }
  }

  /* ------------------------------------------------------------ state baseline */
  let outcome;
  let stateLabel = fileLabel;
  try {
    if (options.stateFile !== undefined) {
      const statePath = path.resolve(options.stateFile);
      stateLabel = displayPath(statePath);
      const stateText = await readTextFile(statePath, {
        label: 'Cannot read state file',
        exitCode: EXIT.IO,
      });
      outcome = core.resolveLocalStateBaseline(compiled.document, stateText);
    } else {
      const generated = core.createLocalStateFile(
        compiled.document,
        compiled.document.initialState,
        generator,
      );
      outcome = core.resolveLocalStateBaseline(compiled.document, generated);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      `Cannot resolve the exported state for "${fileLabel}": ${errorText(error)}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }

  if (!outcome || outcome.ok !== true || !outcome.baseline) {
    const stateDiagnostics = Array.isArray(outcome?.diagnostics) ? outcome.diagnostics : [];
    if (stateDiagnostics.length > 0) {
      for (const diagnostic of stateDiagnostics) {
        // Parsing/digest/parameter-set failures belong to the state file.
        // Runtime constraint failures keep their document node position.
        const code = typeof diagnostic?.code === 'string' ? diagnostic.code : '';
        const diagnosticFile = code.startsWith('local.state.') ? stateLabel : fileLabel;
        stderr.write(`${formatDiagnostic(diagnosticFile, diagnostic)}\n`);
      }
    } else {
      stderr.write(`reactive-md: error: the exported state could not be resolved for "${fileLabel}".\n`);
    }
    throw new CliError('', EXIT.DOCUMENT, { reported: true });
  }

  const baseline = outcome.baseline;
  let stateFile;
  try {
    stateFile = core.createLocalStateFile(baseline.document, baseline.state, generator);
  } catch (error) {
    throw new CliError(
      `Cannot finalize the exported state for "${fileLabel}": ${errorText(error)}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }

  /* ------------------------------------------------------------------- assets */
  const imageNodes = collectImageNodes(baseline.document.nodes);
  /** @type {Map<string, string>} */
  let byUrl = new Map();
  // The shell records how many image nodes the document contains, including
  // images the author chose to omit. Inline payloads are deduplicated
  // separately by content.
  const imageCount = imageNodes.length;

  if (options.assets === 'omit') {
    if (imageNodes.length > 0) {
      stderr.write(
        `reactive-md: warning: ${imageNodes.length} image(s) will render as alt text because --assets omit was selected.\n`,
      );
      if (options.strict) {
        throw new CliError(
          `--strict treats omitted images as an error; ${imageNodes.length} image(s) would not be inlined. `
          + 'Re-run without --assets omit or without --strict.',
          EXIT.ASSET,
        );
      }
    }
  } else if (imageNodes.length > 0) {
    const collected = await collectInlineAssets({
      document: baseline.document,
      inputPath,
      assetRoot: options.assetRoot,
    });
    byUrl = collected.byUrl;
  }
  const { urlPolicy, imageResolver } = createAssetPolicy(byUrl);

  /* ------------------------------------------------------------- build inputs */
  const css = `${await readArtifactText(packageRoot, 'css')}\n${await readArtifactText(packageRoot, 'printCss')}`;
  let runtimeScript;
  if (options.mode === 'interactive') {
    runtimeScript = await readArtifactText(packageRoot, 'standalone');
  }
  // The shared shell records verified image URLs in the auto-mount payload so
  // the standalone renderer can hydrate the same data URLs without a global
  // image-policy relaxation. Static output needs only the SSR markup.
  const embeddedImages = options.mode === 'interactive' && byUrl.size > 0
    ? Object.fromEntries(byUrl)
    : undefined;
  const { createElement, renderToString } = await loadReact();
  const { LocalDocumentView } = await loadReactRenderer(packageRoot);
  const notices = await readNotices(packageRoot);

  /* -------------------------------------------------------------------- render */
  let runtime;
  try {
    runtime = core.createLocalRuntime(baseline.document);
  } catch (error) {
    throw new CliError(
      `Cannot create the document runtime for "${fileLabel}": ${errorText(error)}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }

  let staticMarkup;
  try {
    const props = {
      document: baseline.document,
      runtime,
      mode: options.mode,
      locale: options.locale,
      colorScheme: options.colorScheme,
      urlPolicy,
      imageResolver,
    };
    if (options.mode === 'interactive') props.staticFirst = true;
    staticMarkup = renderToString(createElement(LocalDocumentView, props));
  } catch (error) {
    throw new CliError(
      `HTML rendering failed for "${fileLabel}": ${errorText(error)}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  } finally {
    try {
      runtime.dispose();
    } catch {
      /* Disposal is always best effort; the render error is more important. */
    }
  }

  if (typeof staticMarkup !== 'string' || staticMarkup.trim() === '') {
    throw new CliError(`The React renderer produced empty markup for "${fileLabel}".`, EXIT.DOCUMENT);
  }

  const explicitTitle = options.title !== undefined ? options.title.trim() : '';
  const title = explicitTitle || extractDocumentTitle(baseline.document, path.basename(inputPath));

  let html;
  try {
    html = core.createShareableHtml({
      title,
      source: baseline.document.source,
      state: stateFile,
      staticMarkup,
      css,
      mode: options.mode,
      ...(runtimeScript === undefined ? {} : { runtimeScript }),
      locale: options.locale,
      colorScheme: options.colorScheme,
      generator,
      assets: options.assets,
      imageCount,
      ...(embeddedImages === undefined ? {} : { images: embeddedImages }),
      notices,
    });
  } catch (error) {
    throw new CliError(
      `Cannot assemble the shareable HTML for "${fileLabel}": ${errorText(error)}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }

  await atomicWriteUtf8(outputPath, html);
  stdout.write(`Wrote ${options.output}\n`);
  return EXIT.OK;
}
