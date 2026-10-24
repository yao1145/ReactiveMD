import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  createLocalStateFile,
  serializeLocalState,
  type LocalDocument,
  type LocalStateFile,
  type LocalValue,
} from 'reactive-md';
import { useCopy, useLanguage } from './i18n';
import {
  buildShareableHtml,
  countDocumentImages,
  countParameterDifferences,
  formatBuildError,
  prepareShareableHtmlAssets,
  DEMO_GENERATOR_NAME,
  type ShareableColorScheme,
  type ShareableHtmlMode,
} from './export-html';

type BaselineChoice = 'initial' | 'current';
type AssetsState = 'loading' | 'ready' | 'error';

export interface ExportDialogProps {
  open: boolean;
  source: string;
  /** File name stem for downloaded documents, e.g. the selected example id. */
  baseName: string;
  /** Exact document for the current source; null while compiling or on errors. */
  document: LocalDocument | null;
  /** Live preview values for that same document, or null when unavailable. */
  currentState: Readonly<Record<string, LocalValue>> | null;
  pending: boolean;
  compileError: string | null;
  dark: boolean;
  onClose(): void;
  onDownloadMarkdown(): void;
}

function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportDialog({
  open,
  source,
  baseName,
  document: compiledDocument,
  currentState,
  pending,
  compileError,
  dark,
  onClose,
  onDownloadMarkdown,
}: ExportDialogProps) {
  const copy = useCopy().exportDialog;
  const language = useLanguage();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const taskRef = useRef(0);
  const titleId = useId();
  const descriptionId = useId();
  const summaryId = useId();
  const [mode, setMode] = useState<ShareableHtmlMode>('interactive');
  const [baseline, setBaseline] = useState<BaselineChoice>('initial');
  const [assetsState, setAssetsState] = useState<AssetsState>('loading');
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [packageVersion, setPackageVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const requestClose = useCallback(() => {
    // Invalidate an in-flight render so closing never downloads later.
    taskRef.current += 1;
    onClose();
  }, [onClose]);

  // Reset the dialog choices after each close so reopening starts from the
  // documented defaults (interactive HTML, author initial values).
  useEffect(() => {
    if (open) return;
    taskRef.current += 1;
    setMode('interactive');
    setBaseline('initial');
    setAssetsState('loading');
    setAssetsError(null);
    setPackageVersion(null);
    setBusy(false);
    setBuildError(null);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      const target = previousFocus.current;
      previousFocus.current = null;
      if (target?.isConnected) target.focus();
      return;
    }
    previousFocus.current = globalThis.document.activeElement instanceof HTMLElement
      ? globalThis.document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-export-initial-focus]')?.focus();
  }, [open]);

  useEffect(() => () => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    const target = previousFocus.current;
    previousFocus.current = null;
    if (target?.isConnected) target.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAssetsState('loading');
    setAssetsError(null);
    setPackageVersion(null);
    prepareShareableHtmlAssets(mode)
      .then((prepared) => {
        if (cancelled) return;
        setPackageVersion(prepared.version);
        setAssetsState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAssetsError(formatBuildError(error));
        setAssetsState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  useEffect(() => {
    if (!currentState && baseline === 'current') setBaseline('initial');
  }, [currentState, baseline]);

  const images = useMemo(
    () => (compiledDocument ? countDocumentImages(compiledDocument) : 0),
    [compiledDocument],
  );
  const publicNames = useMemo(
    () => (compiledDocument
      ? Object.keys(compiledDocument.bindings).filter((name) => !name.startsWith('@')).sort()
      : []),
    [compiledDocument],
  );
  const differences = useMemo(
    () => (compiledDocument && currentState
      ? countParameterDifferences(compiledDocument.initialState, currentState, publicNames)
      : null),
    [compiledDocument, currentState, publicNames],
  );
  const effectiveBaseline: BaselineChoice = currentState && compiledDocument ? baseline : 'initial';
  const compileProblem = compiledDocument
    ? null
    : pending
      ? copy.compilePending
      : compileError
        ? copy.compileFailed(compileError)
        : copy.compileUnavailable;

  let parameterSummary = copy.noParameters;
  if (compiledDocument && publicNames.length > 0) {
    parameterSummary = currentState
      ? differences === 0
        ? copy.unchanged(publicNames.length)
        : copy.changed(differences ?? 0, publicNames.length)
      : copy.noCurrent;
  }
  const imageSummary = images === 0 ? copy.imageNone : copy.imageBlocked(images);
  const outputSummary = copy.output(
    mode === 'interactive' ? copy.outputInteractive : copy.outputStatic,
    effectiveBaseline === 'current' ? copy.outputCurrent : copy.outputInitial,
  );
  const htmlDisabled = !compiledDocument
    || images > 0
    || assetsState !== 'ready'
    || packageVersion === null
    || busy;

  const handleExport = async () => {
    if (!compiledDocument || !packageVersion || htmlDisabled) return;
    const task = taskRef.current + 1;
    taskRef.current = task;
    setBusy(true);
    setBuildError(null);
    try {
      const generator = { name: DEMO_GENERATOR_NAME, version: packageVersion };
      const values = effectiveBaseline === 'current' && currentState
        ? currentState
        : compiledDocument.initialState;
      const state: LocalStateFile = createLocalStateFile(compiledDocument, values, generator);
      const colorScheme: ShareableColorScheme = dark ? 'dark' : 'light';
      const result = await buildShareableHtml({
        source,
        state,
        mode,
        locale: language,
        colorScheme,
      });
      if (task !== taskRef.current) return;
      downloadText(`${baseName}.html`, result.html, 'text/html;charset=utf-8');
      onClose();
    } catch (error) {
      if (task === taskRef.current) setBuildError(formatBuildError(error));
    } finally {
      if (task === taskRef.current) setBusy(false);
    }
  };

  const handleMarkdown = () => {
    if (busy) return;
    taskRef.current += 1;
    onDownloadMarkdown();
    onClose();
  };

  const handleState = () => {
    if (!compiledDocument || !currentState || !packageVersion || busy) return;
    setBuildError(null);
    try {
      const file = createLocalStateFile(
        compiledDocument,
        currentState,
        { name: DEMO_GENERATOR_NAME, version: packageVersion },
      );
      downloadText(
        `${baseName}.state.json`,
        `${serializeLocalState(file)}\n`,
        'application/json;charset=utf-8',
      );
    } catch (error) {
      setBuildError(formatBuildError(error));
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="export-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      <header className="export-dialog-head">
        <div>
          <h2 id={titleId}>{copy.title}</h2>
          <p id={descriptionId} className="export-dialog-intro">{copy.description}</p>
        </div>
        <button
          type="button"
          className="export-dialog-close"
          aria-label={copy.close}
          onClick={requestClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="export-dialog-body">
        <fieldset className="export-fieldset" disabled={busy}>
          <legend>{copy.formatLegend}</legend>
          <label className={`export-option${mode === 'interactive' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name={`${titleId}-format`}
              value="interactive"
              checked={mode === 'interactive'}
              data-export-initial-focus
              onChange={() => setMode('interactive')}
            />
            <span className="export-option-copy">
              <strong>{copy.interactive}</strong>
              <span className="export-option-hint">{copy.interactiveHint}</span>
            </span>
          </label>
          <label className={`export-option${mode === 'static' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name={`${titleId}-format`}
              value="static"
              checked={mode === 'static'}
              onChange={() => setMode('static')}
            />
            <span className="export-option-copy">
              <strong>{copy.static}</strong>
              <span className="export-option-hint">{copy.staticHint}</span>
            </span>
          </label>
        </fieldset>

        <fieldset className="export-fieldset" disabled={busy}>
          <legend>{copy.stateLegend}</legend>
          <label className={`export-option${effectiveBaseline === 'initial' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name={`${titleId}-baseline`}
              value="initial"
              checked={effectiveBaseline === 'initial'}
              onChange={() => setBaseline('initial')}
            />
            <span className="export-option-copy">
              <strong>{copy.authorInitial}</strong>
              <span className="export-option-hint">{copy.authorInitialHint}</span>
            </span>
          </label>
          <label
            className={
              `export-option${effectiveBaseline === 'current' ? ' is-selected' : ''}` +
              (currentState ? '' : ' is-disabled')
            }
          >
            <input
              type="radio"
              name={`${titleId}-baseline`}
              value="current"
              checked={effectiveBaseline === 'current'}
              disabled={!currentState}
              onChange={() => setBaseline('current')}
            />
            <span className="export-option-copy">
              <strong>{copy.currentPreview}</strong>
              <span className="export-option-hint">
                {currentState ? copy.currentPreviewHint : copy.currentUnavailable}
              </span>
            </span>
          </label>
        </fieldset>

        <section className="export-summary" aria-labelledby={summaryId}>
          <h3 id={summaryId}>{copy.summaryLegend}</h3>
          <dl className="export-summary-list">
            <div className="export-summary-row">
              <dt>{copy.summaryParameters}</dt>
              <dd>{parameterSummary}</dd>
            </div>
            <div className="export-summary-row">
              <dt>{copy.summaryImages}</dt>
              <dd>{imageSummary}</dd>
            </div>
          </dl>
          <p className="export-output">{outputSummary}</p>
        </section>

        {images > 0 ? (
          <div className="export-warning">
            <p>{copy.imageCommandBefore}</p>
            <code className="export-command">{copy.imageCommand}</code>
          </div>
        ) : null}

        {compileProblem ? (
          <p className="export-status is-error" role="alert">{compileProblem}</p>
        ) : null}
        {assetsState === 'loading' ? (
          <p className="export-status" role="status">{copy.assetsLoading}</p>
        ) : null}
        {assetsState === 'error' ? (
          <p className="export-status is-error" role="alert">
            {copy.assetsFailed(assetsError ?? '')}
          </p>
        ) : null}
        {buildError ? (
          <p className="export-status is-error" role="alert">
            {copy.buildFailed(buildError)}
          </p>
        ) : null}
      </div>

      <footer className="export-dialog-actions">
        <div className="export-secondary-actions">
          <button
            type="button"
            className="button button-quiet export-markdown"
            onClick={handleMarkdown}
            disabled={busy}
          >
            {copy.exportMarkdown}
          </button>
          <button
            type="button"
            className="button button-quiet export-state"
            onClick={handleState}
            disabled={busy || !compiledDocument || !currentState || !packageVersion}
            title={currentState ? copy.exportStateHint : copy.exportStateUnavailable}
          >
            {copy.exportState}
          </button>
        </div>
        <div className="export-action-group">
          <button type="button" className="button button-secondary" onClick={requestClose}>
            {copy.cancel}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={handleExport}
            disabled={htmlDisabled}
          >
            {busy ? copy.preparing : copy.exportHtml}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
