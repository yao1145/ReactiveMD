import path from 'node:path';

/**
 * Stable, human-readable path used in diagnostics. Forward slashes keep lint
 * reports diffable across platforms.
 *
 * @param {string} filePath
 */
export function displayPath(filePath) {
  const absolute = path.resolve(filePath);
  const relative = path.relative(process.cwd(), absolute);
  return (relative === '' ? path.basename(absolute) : relative).split(path.sep).join('/');
}

/** @param {unknown} value */
function diagnosticLine(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

/** @param {unknown} value */
function diagnosticSeverity(value) {
  return value === 'warning' ? 'warning' : 'error';
}

/** @param {unknown} value */
function diagnosticText(value) {
  return String(value ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

/**
 * JSON-safe, deterministic diagnostic record for `lint --json`.
 * @param {{code?: unknown, message?: unknown, severity?: unknown, line?: unknown, column?: unknown}} diagnostic
 */
export function diagnosticToJson(diagnostic) {
  return {
    severity: diagnosticSeverity(diagnostic?.severity),
    code: diagnosticText(diagnostic?.code),
    message: diagnosticText(diagnostic?.message),
    line: diagnosticLine(diagnostic?.line),
    column: diagnosticLine(diagnostic?.column),
  };
}

/**
 * `relative-path:line:column severity code message`
 * @param {string} file
 * @param {{code?: unknown, message?: unknown, severity?: unknown, line?: unknown, column?: unknown}} diagnostic
 */
export function formatDiagnostic(file, diagnostic) {
  const severity = diagnosticSeverity(diagnostic?.severity);
  const code = diagnosticText(diagnostic?.code);
  const message = diagnosticText(diagnostic?.message);
  return `${file}:${diagnosticLine(diagnostic?.line)}:${diagnosticLine(diagnostic?.column)} ${severity} ${code} ${message}`;
}

/** Code-unit comparison; avoids locale-dependent report ordering. */
export function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort by source position, then code/message, independent of compiler order. */
export function compareDiagnostics(a, b) {
  return (
    diagnosticLine(a?.line) - diagnosticLine(b?.line)
    || diagnosticLine(a?.column) - diagnosticLine(b?.column)
    || compareText(diagnosticText(a?.code), diagnosticText(b?.code))
    || compareText(diagnosticText(a?.message), diagnosticText(b?.message))
  );
}

const TITLE_TEXT_NODES = new Set(['text', 'inlineCode', 'code', 'inlineMath', 'math', 'html', 'fallback']);

/**
 * @param {any} node
 * @param {string[]} parts
 */
function collectHeadingText(node, parts) {
  if (!node || typeof node !== 'object') return;
  if (TITLE_TEXT_NODES.has(node.type)) {
    if (typeof node.value === 'string') parts.push(node.value);
    return;
  }
  if (node.type === 'image') {
    if (typeof node.alt === 'string') parts.push(node.alt);
    return;
  }
  if (node.type === 'break') {
    parts.push(' ');
    return;
  }
  // Expressions are not evaluated here; their source is not plain title text.
  if (node.type === 'interpolation' || node.type === 'comment' || node.type === 'definition') return;
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectHeadingText(child, parts);
  }
}

/**
 * First heading in document order, pre-order, including headings nested in
 * blocks such as blockquotes.
 * @param {any[] | undefined} nodes
 * @returns {any | null}
 */
export function findFirstHeading(nodes) {
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    if (node?.type === 'heading') return node;
    const nested = findFirstHeading(node?.children);
    if (nested) return nested;
  }
  return null;
}

/**
 * Convert the first heading to plain text by walking the compiled node tree.
 * Markdown markers are already gone at this point; inline formatting nodes are
 * unwrapped and inline code/math contribute their visible value.
 *
 * @param {{nodes?: any[]}} document
 * @param {string} fallback
 */
export function extractDocumentTitle(document, fallback) {
  const heading = findFirstHeading(document?.nodes);
  if (!heading) return fallback;
  const parts = [];
  collectHeadingText(heading, parts);
  const text = parts.join('').replace(/\s+/g, ' ').trim();
  return text || fallback;
}
