import { prepareLocalPrintHtml, waitForLocalPrintImages } from './export/print-document';

/** A problem that only the print engine can observe, with no document position. */
export interface LocalPdfDiagnostic {
  readonly code: 'local.pdf.image-decode';
  readonly message: string;
}

export interface LocalPdfOptions {
  readonly format?: string;
  readonly landscape?: boolean;
  readonly margin?: { readonly top?: string; readonly right?: string; readonly bottom?: string; readonly left?: string };
  readonly printBackground?: boolean;
  /** Treat reported problems as fatal, like the CLI's --strict. */
  readonly strict?: boolean;
  /** Called once per problem; a relaxed export still writes its PDF. */
  readonly onDiagnostic?: (diagnostic: LocalPdfDiagnostic) => void;
}

/**
 * Chromium keeps CSS `@page` margins ahead of the print parameters, and the
 * bundled print stylesheet sets 18mm/16mm. An explicit margin must win, so it
 * is appended after the document styles as a later `@page` rule. Values are
 * re-validated here because callers may bypass the CLI.
 */
const CSS_LENGTH = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|in|cm|mm)?$/i;

function printLength(value: unknown, side: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`LocalPdfOptions.margin.${side} must be a non-negative CSS length such as "12mm".`);
  }
  const length = value.trim();
  if (!CSS_LENGTH.test(length)) {
    throw new TypeError(`LocalPdfOptions.margin.${side} must be a non-negative CSS length such as "12mm".`);
  }
  // A unitless non-zero length is pixels in Chromium's print parameters too.
  return length === '0' || /[a-z]$/i.test(length) ? length : `${length}px`;
}

function printMargins(margin: LocalPdfOptions['margin']): string[] {
  const declarations: string[] = [];
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = margin?.[side];
    if (value !== undefined) declarations.push(`margin-${side}: ${printLength(value, side)} !important;`);
  }
  return declarations;
}

/** Print self-contained static HTML using a caller-installed Chromium. */
export async function renderLocalPdf(html: string, options: LocalPdfOptions = {}): Promise<Uint8Array> {
  const margins = printMargins(options.margin);
  const { chromium } = await import('playwright').catch((cause: unknown) => {
    throw new Error('PDF export requires Playwright. Install it with "npm install playwright" and run "npx playwright install chromium".', { cause });
  });
  const browser = await chromium.launch({ headless: true }).catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Cannot launch Chromium for PDF export. Run "npx playwright install chromium". ${message}`, { cause });
  });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true, serviceWorkers: 'block' });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.emulateMedia({ media: 'print' });
    // A native document otherwise lives in a sandboxed srcdoc frame, which
    // Chromium prints as one clipped viewport. Lift it before printing.
    await page.setContent(prepareLocalPrintHtml(html), { waitUntil: 'load' });
    if (margins.length > 0) {
      await page.evaluate(css => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
      }, `@page { ${margins.join(' ')} }`);
    }
    const broken = await page.evaluate(waitForLocalPrintImages);
    const diagnostics: LocalPdfDiagnostic[] = broken.map((label) => ({
      code: 'local.pdf.image-decode',
      message: `Image "${label}" could not be decoded by Chromium; it is missing from the PDF.`,
    }));
    for (const diagnostic of diagnostics) options.onDiagnostic?.(diagnostic);
    if (options.strict === true && diagnostics.length > 0) {
      throw new Error(
        `Strict PDF export stopped because ${broken.length} image(s) could not be decoded: ${broken.join(', ')}.`,
      );
    }
    return await page.pdf({
      format: options.format ?? 'A4',
      landscape: options.landscape,
      margin: options.margin,
      printBackground: options.printBackground ?? true,
    });
  } finally {
    await browser.close();
  }
}
