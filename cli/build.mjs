import path from 'node:path';
import { collectImageNodes, collectInlineAssets, createAssetPolicy } from './assets.mjs';
import { displayPath, extractDocumentTitle, formatDiagnostic } from './document.mjs';
import { CliError, EXIT, errorText } from './errors.mjs';
import {
  assertDistinctPaths,
  assertOutputDirectory,
  atomicWriteFile,
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
 * PDF adapter diagnostics carry a code and message but no document position.
 * Print one line each so a relaxed build still explains the dropped image and
 * a strict build reports the same problem as an error. Exported for the CLI
 * regression test; not part of the package API.
 *
 * @param {NodeJS.WritableStream} stream
 * @param {string} file
 * @param {{code: string, message: string}[]} diagnostics
 * @param {'warning'|'error'} severity
 */
export function reportPdfDiagnostics(stream, file, diagnostics, severity) {
  for (const diagnostic of diagnostics) {
    stream.write(`reactive-md: ${severity}: ${file}: ${diagnostic.code}: ${diagnostic.message}\n`);
  }
}

/** Adapter messages are printed verbatim; keep one bounded line per diagnostic. */
const MAX_PDF_DIAGNOSTIC_LENGTH = 500;

/** @param {unknown} diagnostic @returns {{code: string, message: string}} */
export function readPdfDiagnostic(diagnostic) {
  const record = diagnostic && typeof diagnostic === 'object' ? diagnostic : {};
  const rawCode = typeof record.code === 'string' ? record.code.trim() : '';
  const code = rawCode === '' ? 'local.pdf.diagnostic' : rawCode.slice(0, 128);
  const rawMessage = typeof record.message === 'string'
    ? record.message.replace(/\s*\r?\n\s*/g, ' ').trim()
    : '';
  const message = rawMessage === ''
    ? 'The PDF adapter reported a problem without a message.'
    : rawMessage.length > MAX_PDF_DIAGNOSTIC_LENGTH
      ? `${rawMessage.slice(0, MAX_PDF_DIAGNOSTIC_LENGTH)}...`
      : rawMessage;
  return { code, message };
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
  let project;
  if (options.projectRoot !== undefined) {
    try {
      const { loadLocalDirectoryHost } = await import('reactive-md/vite');
      project = await loadLocalDirectoryHost(options.projectRoot, {
        defaultPreset: 'minimal', interactive: options.mode === 'interactive',
      });
    } catch (error) {
      throw new CliError(
        `Cannot assemble project plugins: ${errorText(error)}. Directory export requires the optional Vite peer.`,
        EXIT.DOCUMENT, { cause: error },
      );
    }
  }

  const core = await loadCore(packageRoot, [
    'compileLocal',
    'createLocalRuntime',
    'createLocalStateFile',
    'resolveLocalStateBaseline',
    'resolveLocalComponentStateExport',
    'createShareableHtml',
  ]);

  let compiled;
  try {
    compiled = core.compileLocal(source, project?.host.compileOptions);
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

  /* --------------------------------------------------- component state sidecar */
  let componentState;
  if (options.componentStateFile !== undefined) {
    const componentStatePath = path.resolve(options.componentStateFile);
    const componentStateLabel = displayPath(componentStatePath);
    const componentStateText = await readTextFile(componentStatePath, {
      label: 'Cannot read component state file',
      exitCode: EXIT.IO,
    });
    let componentOutcome;
    try {
      componentOutcome = core.resolveLocalComponentStateExport(
        baseline.document,
        componentStateText,
        {
          documentId: options.documentId,
          ...(compiled.document.componentConfigKey === undefined
            ? {}
            : { configKey: compiled.document.componentConfigKey }),
        },
      );
    } catch (error) {
      throw new CliError(
        `Cannot read the component state for "${fileLabel}": ${errorText(error)}`,
        EXIT.DOCUMENT,
        { cause: error },
      );
    }
    const componentDiagnostics = Array.isArray(componentOutcome?.diagnostics)
      ? componentOutcome.diagnostics
      : [];
    const componentErrors = componentDiagnostics.filter((diagnostic) => diagnostic?.severity === 'error');
    const componentWarnings = componentDiagnostics.filter((diagnostic) => diagnostic?.severity !== 'error');
    if (componentOutcome?.ok !== true || componentErrors.length > 0) {
      writeDiagnostics(stderr, componentStateLabel, componentDiagnostics);
      if (componentDiagnostics.length === 0) {
        stderr.write(`reactive-md: error: the component state could not be resolved for "${fileLabel}".\n`);
      }
      throw new CliError('', EXIT.DOCUMENT, { reported: true });
    }
    if (componentWarnings.length > 0) {
      writeDiagnostics(stderr, componentStateLabel, componentWarnings);
      if (options.strict) {
        stderr.write('reactive-md: error: warnings are treated as errors because --strict is set.\n');
        throw new CliError('', EXIT.DOCUMENT, { reported: true });
      }
    }
    componentState = componentOutcome.componentState;
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
  const css = `${await readArtifactText(packageRoot, project ? 'minimalCss' : 'css')}\n${await readArtifactText(packageRoot, 'printCss')}`;
  let runtimeScript;
  if (options.mode === 'interactive' && project === undefined) {
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
    runtime = core.createLocalRuntime(baseline.document, {
      documentId: options.documentId,
      randomSeed: options.randomSeed,
      componentState,
      ...(compiled.document.componentConfigKey === undefined
        ? {}
        : { configKey: compiled.document.componentConfigKey }),
    });
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
      ...(project === undefined ? {} : { reactConfig: project.host.reactConfig }),
    };
    if (project !== undefined || options.format === 'pdf') {
      const { renderLocalStaticDocument } = await import('reactive-md/react/server');
      const rendered = renderLocalStaticDocument({ ...props, resources: project?.host.resources });
      writeDiagnostics(stderr, fileLabel, rendered.diagnostics);
      if (!rendered.ok || (options.strict && rendered.diagnostics.length > 0)) {
        throw new CliError('', EXIT.DOCUMENT, { reported: true });
      }
      staticMarkup = rendered.markup;
    } else {
      if (options.mode === 'interactive') props.staticFirst = true;
      staticMarkup = renderToString(createElement(LocalDocumentView, props));
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
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
    const htmlOptions = {
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
      ...(options.documentId === undefined ? {} : { documentId: options.documentId }),
      ...(options.randomSeed === undefined ? {} : { randomSeed: options.randomSeed }),
      ...(componentState === undefined ? {} : { componentState }),
      notices,
    };
    if (project === undefined) {
      html = core.createShareableHtml(htmlOptions);
    } else {
      const { createLocalShareableHtml } = await import('reactive-md/export');
      html = createLocalShareableHtml({
        ...htmlOptions,
        document: baseline.document,
        config: project.host.config,
        resources: project.host.resources,
        bundle: project.bundle,
        notices: [notices, ...project.host.notices.map((notice) => notice.text ?? notice.name ?? notice.id)].filter(Boolean).join('\n\n'),
      });
    }
  } catch (error) {
    throw new CliError(
      `Cannot assemble the shareable HTML for "${fileLabel}": ${errorText(error)}`,
      EXIT.DOCUMENT,
      { cause: error },
    );
  }

  let output = html;
  if (options.format === 'pdf') {
    /** @type {{code: string, message: string}[]} */
    const pdfDiagnostics = [];
    // Image-decode failures are warnings in a relaxed build and errors under
    // --strict. The adapter reports them through `onDiagnostic`; the CLI also
    // re-checks the collected list so a strict build never writes a PDF even
    // if the adapter returns bytes.
    const pdfOptions = {
      ...options.pdf,
      strict: options.strict,
      onDiagnostic(diagnostic) {
        pdfDiagnostics.push(readPdfDiagnostic(diagnostic));
      },
    };
    try {
      const { renderLocalPdf } = await import('reactive-md/pdf');
      output = await renderLocalPdf(html, pdfOptions);
    } catch (error) {
      // An adapter that fails after reporting keeps the same code. Under
      // --strict its own rejection is already fatal, so print the collected
      // diagnostics as errors and let the failure message name the cause.
      if (pdfDiagnostics.length > 0) {
        reportPdfDiagnostics(stderr, fileLabel, pdfDiagnostics, options.strict ? 'error' : 'warning');
      }
      throw new CliError(
        `PDF export failed for "${fileLabel}": ${errorText(error)}`,
        EXIT.DOCUMENT,
        { cause: error },
      );
    }
    if (pdfDiagnostics.length > 0) {
      if (options.strict) {
        reportPdfDiagnostics(stderr, fileLabel, pdfDiagnostics, 'error');
        stderr.write('reactive-md: error: PDF warnings are treated as errors because --strict is set.\n');
        throw new CliError('', EXIT.DOCUMENT, { reported: true });
      }
      reportPdfDiagnostics(stderr, fileLabel, pdfDiagnostics, 'warning');
    }
  }
  await atomicWriteFile(outputPath, output);
  stdout.write(`Wrote ${options.output}\n`);
  return EXIT.OK;
}
