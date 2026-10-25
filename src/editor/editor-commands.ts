/**
 * Pure text transformations behind the Markdown source toolbar.
 *
 * Every command receives the current source value and selection, clamps the
 * selection, and returns a new value plus the selection that should be
 * restored on the textarea. Nothing in this module touches the DOM.
 *
 * Commands that insert human-readable text accept an optional locale and
 * default to English, so direct callers keep their original output.
 */

import { EDITOR_COMMAND_COPY, type EditorCommandCopy } from './editor-i18n';
import type { EditorEdit, EditorLocale, EditorSelection } from './command-types';

export type { EditorEdit, EditorSelection } from './command-types';

export interface InsertTemplateOptions {
  block?: boolean;
}

interface LineInfo {
  start: number;
  end: number;
  text: string;
}

interface LineEdit {
  start: number;
  end: number;
  text: string;
  /** Length of the prefix (markers, indentation, ...) in the original line. */
  oldPrefixLength: number;
  /** Length of the prefix in the replacement line. */
  newPrefixLength: number;
}

interface ResolvedTemplate {
  text: string;
  select: EditorSelection | null;
  fallback: EditorSelection | null;
  caret: number | null;
}

function clampIndex(index: number, length: number): number {
  if (typeof index !== 'number' || Number.isNaN(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

function normalizeSelection(value: string, selection: EditorSelection): EditorSelection {
  const start = clampIndex(selection.start, value.length);
  const end = clampIndex(selection.end, value.length);
  return start <= end ? { start, end } : { start: end, end: start };
}

function commandCopy(locale: EditorLocale): EditorCommandCopy {
  return EDITOR_COMMAND_COPY[locale] ?? EDITOR_COMMAND_COPY.en;
}

// lastIndexOf('\n', -1) matches a newline at index 0 and skips the first line.
function lineStartAt(value: string, index: number): number {
  if (index <= 0) return 0;
  return value.lastIndexOf('\n', index - 1) + 1;
}

/** Collects the full lines touched by the selection. */
function collectLines(value: string, selection: EditorSelection): LineInfo[] {
  const firstStart = lineStartAt(value, selection.start);
  // A selection that ends just after a newline should not pull in the next line.
  const probe =
    selection.end > selection.start && value[selection.end - 1] === '\n'
      ? selection.end - 1
      : selection.end;
  const lastNewline = value.indexOf('\n', probe);
  const lastEnd = lastNewline === -1 ? value.length : lastNewline;
  const lines: LineInfo[] = [];
  let start = firstStart;
  for (;;) {
    const newline = value.indexOf('\n', start);
    const end = newline === -1 || newline > lastEnd ? lastEnd : newline;
    lines.push({ start, end, text: value.slice(start, end) });
    if (end >= lastEnd) break;
    start = end + 1;
  }
  return lines;
}

/**
 * Applies replacements of whole line bodies (newlines are never touched) and
 * maps both selection boundaries onto the transformed text. Boundary mapping
 * walks line by line so inserted/removed prefixes do not swallow content.
 */
function applyLineEdits(
  value: string,
  selection: EditorSelection,
  edits: LineEdit[],
): EditorEdit {
  if (edits.length === 0) return { value, selection };

  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let runningDelta = 0;
  const placed = sorted.map((edit) => {
    const newStart = edit.start + runningDelta;
    const deltaBefore = runningDelta;
    runningDelta += edit.text.length - (edit.end - edit.start);
    return { edit, newStart, deltaBefore };
  });

  let result = '';
  let cursor = 0;
  for (const item of placed) {
    result += value.slice(cursor, item.edit.start);
    result += item.edit.text;
    cursor = item.edit.end;
  }
  result += value.slice(cursor);

  const mapOffset = (offset: number): number => {
    for (const item of placed) {
      const { edit, newStart, deltaBefore } = item;
      if (offset < edit.start) return offset + deltaBefore;
      if (offset <= edit.end) {
        const local = offset - edit.start;
        const mapped =
          local <= edit.oldPrefixLength
            ? edit.newPrefixLength
            : local + (edit.newPrefixLength - edit.oldPrefixLength);
        return newStart + Math.min(Math.max(mapped, 0), edit.text.length);
      }
    }
    return offset + runningDelta;
  };

  return {
    value: result,
    selection: { start: mapOffset(selection.start), end: mapOffset(selection.end) },
  };
}

function lineEdit(
  line: LineInfo,
  text: string,
  oldPrefixLength: number,
  newPrefixLength: number,
): LineEdit | null {
  if (text === line.text) return null;
  return { start: line.start, end: line.end, text, oldPrefixLength, newPrefixLength };
}

/* ------------------------------------------------------------------ */
/* Inline markers                                                      */
/* ------------------------------------------------------------------ */

function markerBoundariesAreSafe(
  value: string,
  selection: EditorSelection,
  marker: string,
  exactWrap: boolean,
): boolean {
  // Keep a single `*` from eating one half of a `**bold**` marker.
  if (marker !== '*') return true;
  if (exactWrap) {
    return value[selection.start - 1] !== '*' && value[selection.end] !== '*';
  }
  return (
    value[selection.start - marker.length - 1] !== '*' &&
    value[selection.end + marker.length] !== '*'
  );
}

function toggleInlineMarker(
  value: string,
  rawSelection: EditorSelection,
  marker: string,
  placeholder: string,
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const size = marker.length;
  const { start, end } = selection;
  const selected = value.slice(start, end);

  if (start !== end) {
    const exactWrap =
      selected.length >= size * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker) &&
      !(marker === '*' && (selected.startsWith('**') || selected.endsWith('**'))) &&
      markerBoundariesAreSafe(value, selection, marker, true);
    if (exactWrap) {
      const inner = selected.slice(size, selected.length - size);
      return {
        value: value.slice(0, start) + inner + value.slice(end),
        selection: { start, end: start + inner.length },
      };
    }

    const outerStart = start - size;
    const outerEnd = end + size;
    const surroundingWrap =
      outerStart >= 0 &&
      outerEnd <= value.length &&
      value.slice(outerStart, start) === marker &&
      value.slice(end, outerEnd) === marker &&
      markerBoundariesAreSafe(value, selection, marker, false);
    if (surroundingWrap) {
      return {
        value: value.slice(0, outerStart) + selected + value.slice(outerEnd),
        selection: { start: outerStart, end: outerStart + selected.length },
      };
    }

    return {
      value: value.slice(0, start) + marker + selected + marker + value.slice(end),
      selection: { start: start + size, end: end + size },
    };
  }

  const insertion = marker + placeholder + marker;
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    selection: { start: start + size, end: start + size + placeholder.length },
  };
}

export function formatBold(
  value: string,
  selection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  return toggleInlineMarker(value, selection, '**', commandCopy(locale).boldPlaceholder);
}

export function formatItalic(
  value: string,
  selection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  return toggleInlineMarker(value, selection, '*', commandCopy(locale).italicPlaceholder);
}

export function formatStrike(
  value: string,
  selection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  return toggleInlineMarker(value, selection, '~~', commandCopy(locale).strikePlaceholder);
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return longest;
}

function backtickRunAt(text: string, index: number, step: 1 | -1): number {
  let length = 0;
  while (text[index] === '`') {
    length += 1;
    index += step;
  }
  return length;
}

function surroundingBackticks(
  value: string,
  selection: EditorSelection,
): { run: number; padding: number } | null {
  const { start, end } = selection;
  const selected = value.slice(start, end);
  const left = backtickRunAt(value, start - 1, -1);
  const right = backtickRunAt(value, end, 1);
  const direct = left > 0 && left === right ? { run: left, padding: 0 } : null;
  const paddedLeft = backtickRunAt(value, start - 2, -1);
  const paddedRight = backtickRunAt(value, end + 1, 1);
  const padded =
    value[start - 1] === ' ' &&
    value[end] === ' ' &&
    paddedLeft > 0 &&
    paddedLeft === paddedRight
      ? { run: paddedLeft, padding: 1 }
      : null;
  const outer = direct ?? padded;
  if (!outer || longestBacktickRun(selected) >= outer.run) return null;
  return outer;
}

export function formatInlineCode(
  value: string,
  rawSelection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const { start, end } = selection;
  const selected = value.slice(start, end);

  if (start === end) {
    const placeholder = commandCopy(locale).inlineCodePlaceholder;
    const insertion = `\`${placeholder}\``;
    return {
      value: value.slice(0, start) + insertion + value.slice(end),
      selection: { start: start + 1, end: start + 1 + placeholder.length },
    };
  }

  const leading = backtickRunAt(selected, 0, 1);
  const trailing = backtickRunAt(selected, selected.length - 1, -1);
  if (
    leading > 0 &&
    leading === trailing &&
    selected.length >= leading * 2 &&
    longestBacktickRun(selected.slice(leading, selected.length - leading)) < leading
  ) {
    let inner = selected.slice(leading, selected.length - leading);
    if (inner.startsWith(' ') && inner.endsWith(' ') && inner.trim().length > 0) {
      inner = inner.slice(1, -1);
    }
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      selection: { start, end: start + inner.length },
    };
  }

  const outer = surroundingBackticks(value, selection);
  if (outer) {
    const removed = outer.run + outer.padding;
    return {
      value: value.slice(0, start - removed) + selected + value.slice(end + removed),
      selection: { start: start - removed, end: start - removed + selected.length },
    };
  }

  const delimiter = '`'.repeat(longestBacktickRun(selected) + 1);
  const padding = /^[` ]|[` ]$/.test(selected) ? ' ' : '';
  const opening = delimiter + padding;
  return {
    value: value.slice(0, start) + opening + selected + padding + delimiter + value.slice(end),
    selection: { start: start + opening.length, end: start + opening.length + selected.length },
  };
}

/* ------------------------------------------------------------------ */
/* Headings                                                            */
/* ------------------------------------------------------------------ */

const HEADING_PREFIX = /^(#{1,6})[ \t]+/;

export function formatHeading(
  value: string,
  rawSelection: EditorSelection,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6,
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const edits: LineEdit[] = [];

  for (const line of collectLines(value, selection)) {
    const match = HEADING_PREFIX.exec(line.text);
    const oldPrefixLength = match ? match[0].length : 0;
    if (level === 0 && !match) continue;
    const content = line.text.slice(oldPrefixLength);
    const prefix = level === 0 ? '' : `${'#'.repeat(level)} `;
    const next = prefix + content;
    const edit = lineEdit(line, next, oldPrefixLength, prefix.length);
    if (edit) edits.push(edit);
  }

  return applyLineEdits(value, selection, edits);
}

/* ------------------------------------------------------------------ */
/* Lists, quotes and indentation                                       */
/* ------------------------------------------------------------------ */

interface PrefixMatch {
  indent: string;
  prefix: string;
  /** indent + prefix, i.e. where the line content begins. */
  prefixLength: number;
}

const BULLET_PREFIX = /^([ \t]*)([-*+] )/;
const ORDERED_PREFIX = /^([ \t]*)(\d+[.)] )/;
const TASK_PREFIX = /^([ \t]*)([-*+] \[[ xX]\] )/;
const QUOTE_PREFIX = /^([ \t]*)(> ?)/;

function matchPrefix(text: string, pattern: RegExp): PrefixMatch | null {
  const match = pattern.exec(text);
  if (!match) return null;
  const indent = match[1] ?? '';
  const prefix = match[2] ?? '';
  return { indent, prefix, prefixLength: indent.length + prefix.length };
}

function leadingWhitespace(text: string): string {
  const match = /^[ \t]*/.exec(text);
  return match ? match[0] : '';
}

function toggleLinePrefix(
  value: string,
  rawSelection: EditorSelection,
  match: (text: string) => PrefixMatch | null,
  makePrefix: (indent: string, index: number) => string,
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const lines = collectLines(value, selection);
  const matches = lines.map((line) => match(line.text));

  let considered = 0;
  let allPrefixed = true;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as LineInfo;
    if (matches[index] || line.text.trim().length > 0) {
      considered += 1;
      if (!matches[index]) allPrefixed = false;
    }
  }
  const remove = considered > 0 && allPrefixed;

  const edits: LineEdit[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as LineInfo;
    const current = matches[index] ?? null;

    if (remove) {
      if (!current) continue;
      const next = current.indent + line.text.slice(current.prefixLength);
      const edit = lineEdit(line, next, current.prefixLength, current.indent.length);
      if (edit) edits.push(edit);
      continue;
    }

    const indent = current ? current.indent : leadingWhitespace(line.text);
    const content = line.text.slice(current ? current.prefixLength : indent.length);
    const prefix = makePrefix(indent, index + 1);
    const next = indent + prefix + content;
    const edit = lineEdit(line, next, current ? current.prefixLength : indent.length, indent.length + prefix.length);
    if (edit) edits.push(edit);
  }

  return applyLineEdits(value, selection, edits);
}

export function formatBulletList(value: string, selection: EditorSelection): EditorEdit {
  return toggleLinePrefix(
    value,
    selection,
    (text) => matchPrefix(text, BULLET_PREFIX),
    () => '- ',
  );
}

export function formatOrderedList(value: string, selection: EditorSelection): EditorEdit {
  return toggleLinePrefix(
    value,
    selection,
    (text) => matchPrefix(text, ORDERED_PREFIX),
    (_indent, index) => `${index}. `,
  );
}

export function formatTaskList(value: string, selection: EditorSelection): EditorEdit {
  return toggleLinePrefix(
    value,
    selection,
    (text) => matchPrefix(text, TASK_PREFIX),
    () => '- [ ] ',
  );
}

export function formatQuote(value: string, selection: EditorSelection): EditorEdit {
  return toggleLinePrefix(
    value,
    selection,
    (text) => matchPrefix(text, QUOTE_PREFIX),
    () => '> ',
  );
}

export function indentSelection(value: string, rawSelection: EditorSelection): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const edits = collectLines(value, selection).map((line) => ({
    start: line.start,
    end: line.end,
    text: `  ${line.text}`,
    oldPrefixLength: 0,
    newPrefixLength: 2,
  }));
  return applyLineEdits(value, selection, edits);
}

function outdentLine(text: string): { text: string; removed: number } {
  if (text.startsWith('\t')) return { text: text.slice(1), removed: 1 };
  let removed = 0;
  while (removed < 2 && text[removed] === ' ') removed += 1;
  return { text: text.slice(removed), removed };
}

export function outdentSelection(value: string, rawSelection: EditorSelection): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const edits: LineEdit[] = [];
  for (const line of collectLines(value, selection)) {
    const next = outdentLine(line.text);
    if (next.removed === 0) continue;
    const edit = lineEdit(line, next.text, next.removed, 0);
    if (edit) edits.push(edit);
  }
  return applyLineEdits(value, selection, edits);
}

/* ------------------------------------------------------------------ */
/* Insertions                                                          */
/* ------------------------------------------------------------------ */

export function insertLink(
  value: string,
  rawSelection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const { start, end } = selection;
  const selected = value.slice(start, end);
  const url = 'https://example.com';

  if (selected.length > 0) {
    const insertion = `[${selected}](${url})`;
    const urlStart = start + 1 + selected.length + 2;
    return {
      value: value.slice(0, start) + insertion + value.slice(end),
      selection: { start: urlStart, end: urlStart + url.length },
    };
  }

  const label = commandCopy(locale).linkText;
  const insertion = `[${label}](${url})`;
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    selection: { start: start + 1, end: start + 1 + label.length },
  };
}

export function insertImage(
  value: string,
  rawSelection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const { start, end } = selection;
  const selected = value.slice(start, end);
  const url = 'images/example.png';

  if (selected.length > 0) {
    const insertion = `![${selected}](${url})`;
    const urlStart = start + 2 + selected.length + 2;
    return {
      value: value.slice(0, start) + insertion + value.slice(end),
      selection: { start: urlStart, end: urlStart + url.length },
    };
  }

  const alt = commandCopy(locale).imageAlt;
  const insertion = `![${alt}](${url})`;
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    selection: { start: start + 2, end: start + 2 + alt.length },
  };
}

export function insertCodeBlock(
  value: string,
  rawSelection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const selected = value.slice(selection.start, selection.end);
  const body = selected.length > 0 ? selected : commandCopy(locale).codeBlockPlaceholder;
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
  const opening = `${fence}text\n`;
  const insertion = `${opening}${body}\n${fence}`;
  return insertBlock(value, selection, insertion, {
    start: opening.length,
    end: opening.length + body.length,
  });
}

function buildTable(copy: EditorCommandCopy): string {
  return [
    `| ${copy.tableHeaders.join(' | ')} |`,
    `| ${copy.tableHeaders.map(() => '---').join(' | ')} |`,
    ...copy.tableRows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function blockPadding(
  value: string,
  selection: EditorSelection,
): { prefix: string; suffix: string } {
  const lineStart = lineStartAt(value, selection.start);
  const before = value.slice(lineStart, selection.start);
  const newline = value.indexOf('\n', selection.end);
  const lineEnd = newline === -1 ? value.length : newline;
  const after = value.slice(selection.end, lineEnd);

  let prefix = '';
  if (/\S/.test(before)) {
    prefix = '\n\n';
  } else if (lineStart > 0) {
    const previousStart = lineStartAt(value, lineStart - 1);
    if (/\S/.test(value.slice(previousStart, lineStart - 1))) prefix = '\n';
  }

  return {
    prefix,
    suffix: /\S/.test(after) ? '\n\n' : '',
  };
}

function insertBlock(
  value: string,
  selection: EditorSelection,
  text: string,
  target: EditorSelection,
): EditorEdit {
  const { prefix, suffix } = blockPadding(value, selection);
  const base = selection.start + prefix.length;
  return {
    value: value.slice(0, selection.start) + prefix + text + suffix + value.slice(selection.end),
    selection: { start: base + target.start, end: base + target.end },
  };
}

export function insertTable(
  value: string,
  rawSelection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const copy = commandCopy(locale);
  const table = buildTable(copy);
  const anchor = copy.tableRows[0][0];
  const cellOffset = table.indexOf(anchor);
  return insertBlock(value, selection, table, {
    start: cellOffset,
    end: cellOffset + anchor.length,
  });
}

export function insertDivider(value: string, rawSelection: EditorSelection): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const divider = '---';
  return insertBlock(value, selection, divider, { start: divider.length, end: divider.length });
}

export function insertText(
  value: string,
  rawSelection: EditorSelection,
  text: string,
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const caret = selection.start + text.length;
  return {
    value: value.slice(0, selection.start) + text + value.slice(selection.end),
    selection: { start: caret, end: caret },
  };
}

/* ------------------------------------------------------------------ */
/* Templates for native components                                     */
/* ------------------------------------------------------------------ */

// Only consume toolbar-owned tokens. Reactive expressions such as {{ 40 }} or
// outer interpolation wrappers around {{select:...}} must stay untouched.
const TEMPLATE_MARKER = /\{\{(selection(?::[^{}]*)?|caret|select:[^{}]*)\}\}/g;

function resolveTemplate(template: string, selectedText: string): ResolvedTemplate {
  let text = '';
  let lastIndex = 0;
  let select: EditorSelection | null = null;
  let fallback: EditorSelection | null = null;
  let caret: number | null = null;

  TEMPLATE_MARKER.lastIndex = 0;
  for (let match = TEMPLATE_MARKER.exec(template); match; match = TEMPLATE_MARKER.exec(template)) {
    const markerStart = match.index;
    text += template.slice(lastIndex, markerStart);
    lastIndex = markerStart + match[0].length;
    const body = match[1] ?? '';

    if (body === 'selection') {
      text += selectedText;
      continue;
    }

    if (body.startsWith('selection:')) {
      const fallbackText = body.slice('selection:'.length);
      if (selectedText.length > 0) {
        text += selectedText;
      } else {
        const start = text.length;
        text += fallbackText;
        if (!fallback) fallback = { start, end: text.length };
      }
      continue;
    }

    if (body === 'caret') {
      if (caret === null) caret = text.length;
      continue;
    }

    if (body.startsWith('select:')) {
      const content = body.slice('select:'.length);
      const start = text.length;
      text += content;
      if (!select) select = { start, end: text.length };
      continue;
    }

    // Unknown markers are left untouched instead of being silently dropped.
    text += match[0];
  }

  text += template.slice(lastIndex);
  return { text, select, fallback, caret };
}

export function insertTemplate(
  value: string,
  rawSelection: EditorSelection,
  template: string,
  options: InsertTemplateOptions = {},
): EditorEdit {
  const selection = normalizeSelection(value, rawSelection);
  const selected = value.slice(selection.start, selection.end);
  const resolved = resolveTemplate(template, selected);

  const padding =
    options.block === true && resolved.text.length > 0
      ? blockPadding(value, selection)
      : { prefix: '', suffix: '' };
  const base = selection.start + padding.prefix.length;

  let target: EditorSelection;
  if (resolved.select) {
    target = {
      start: base + resolved.select.start,
      end: base + resolved.select.end,
    };
  } else if (resolved.fallback) {
    target = {
      start: base + resolved.fallback.start,
      end: base + resolved.fallback.end,
    };
  } else if (resolved.caret !== null) {
    target = { start: base + resolved.caret, end: base + resolved.caret };
  } else {
    target = {
      start: base + resolved.text.length,
      end: base + resolved.text.length,
    };
  }

  return {
    value:
      value.slice(0, selection.start) +
      padding.prefix +
      resolved.text +
      padding.suffix +
      value.slice(selection.end),
    selection: target,
  };
}

/* ------------------------------------------------------------------ */
/* Current format state                                                */
/* ------------------------------------------------------------------ */

export type EditorListType = 'bullet' | 'ordered' | 'task';

export interface EditorFormatState {
  headingLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  inlineCode: boolean;
  list: EditorListType | null;
  quote: boolean;
}

type InlineMarkerKind = 'bold' | 'italic' | 'strike' | 'inlineCode';

interface MarkerRun {
  start: number;
  end: number;
  length: number;
}

/** Maximal runs of a single marker character, e.g. the `**` in `**bold**`. */
function markerRuns(text: string, char: string): MarkerRun[] {
  const runs: MarkerRun[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== char) {
      index += 1;
      continue;
    }
    const start = index;
    while (text[index] === char) index += 1;
    runs.push({ start, end: index, length: index - start });
  }
  return runs;
}

/**
 * Delimiters that can open or close the given inline format. A run of two
 * asterisks is bold, a single asterisk is italic, and an odd run such as
 * `***` carries both. Backtick spans close with a run of equal length.
 */
function inlineDelimiters(text: string, kind: InlineMarkerKind): MarkerRun[] {
  if (kind === 'inlineCode') return markerRuns(text, '`');
  const runs = markerRuns(text, kind === 'strike' ? '~' : '*');
  if (kind === 'italic') return runs.filter((run) => run.length % 2 === 1);
  return runs.filter((run) => run.length >= 2);
}

function selectionIsWrappedBy(start: number, end: number, delimiters: MarkerRun[]): boolean {
  if (start >= end) return false;
  return delimiters.some(
    (open) =>
      open.start === start &&
      delimiters.some(
        (close) => close.end === end && close.length === open.length && close.start >= open.end,
      ),
  );
}

function selectionIsSurroundedBy(start: number, end: number, delimiters: MarkerRun[]): boolean {
  if (start >= end) return false;
  return delimiters.some(
    (open) =>
      open.end === start &&
      delimiters.some(
        (close) => close.start === end && close.length === open.length && close.start >= open.end,
      ),
  );
}

/** True when the caret sits between an opening and a closing delimiter of equal length. */
function caretIsInsideMarkers(caret: number, delimiters: MarkerRun[]): boolean {
  let index = 0;
  while (index < delimiters.length) {
    const open = delimiters[index] as MarkerRun;
    let candidate = index + 1;
    while (
      candidate < delimiters.length &&
      (delimiters[candidate] as MarkerRun).length !== open.length
    ) {
      candidate += 1;
    }
    const close = delimiters[candidate];
    if (!close) {
      index += 1;
      continue;
    }
    if (caret >= open.end && caret <= close.start) return true;
    index = candidate + 1;
  }
  return false;
}

function readInlineMarker(
  value: string,
  selection: EditorSelection,
  line: LineInfo,
  kind: InlineMarkerKind,
): boolean {
  if (selection.start !== selection.end) {
    const delimiters = inlineDelimiters(value, kind);
    return (
      selectionIsWrappedBy(selection.start, selection.end, delimiters) ||
      selectionIsSurroundedBy(selection.start, selection.end, delimiters)
    );
  }
  const caret = Math.min(Math.max(selection.start - line.start, 0), line.text.length);
  const delimiters = inlineDelimiters(line.text, kind).filter(
    (run) => run.start >= lineContentStart(line.text),
  );
  return caretIsInsideMarkers(caret, delimiters);
}

/**
 * Index where the inline content of a line begins, after any combination of
 * quote and list markers. Keeps a `*` bullet from being read as emphasis.
 */
function lineContentStart(text: string): number {
  let index = 0;
  for (;;) {
    const rest = text.slice(index);
    const match =
      matchPrefix(rest, TASK_PREFIX) ??
      matchPrefix(rest, BULLET_PREFIX) ??
      matchPrefix(rest, ORDERED_PREFIX) ??
      matchPrefix(rest, QUOTE_PREFIX);
    if (!match) return index;
    index += match.prefixLength;
  }
}

function readLineListType(text: string): EditorListType | null {
  // The task prefix also matches the bullet prefix, so it has to win.
  if (matchPrefix(text, TASK_PREFIX)) return 'task';
  if (matchPrefix(text, BULLET_PREFIX)) return 'bullet';
  if (matchPrefix(text, ORDERED_PREFIX)) return 'ordered';
  return null;
}

/**
 * Reads the formatting that applies at the selection without changing the
 * document. Line-level state comes from the line holding `selection.start`;
 * inline state comes from markers around or enclosing the selection (or
 * around the caret when the selection is collapsed).
 */
export function readFormatState(
  value: string,
  rawSelection: EditorSelection,
): EditorFormatState {
  const selection = normalizeSelection(value, rawSelection);
  const line = collectLines(value, { start: selection.start, end: selection.start })[0] as LineInfo;
  const lineText = line.text;

  const heading = HEADING_PREFIX.exec(lineText);
  const headingLevel = (heading ? heading[1].length : 0) as EditorFormatState['headingLevel'];

  return {
    headingLevel,
    bold: readInlineMarker(value, selection, line, 'bold'),
    italic: readInlineMarker(value, selection, line, 'italic'),
    strike: readInlineMarker(value, selection, line, 'strike'),
    inlineCode: readInlineMarker(value, selection, line, 'inlineCode'),
    list: readLineListType(lineText),
    quote: matchPrefix(lineText, QUOTE_PREFIX) !== null,
  };
}
