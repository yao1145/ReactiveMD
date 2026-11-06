import type { SourceFacts } from '../source/source-context';
import type { LocalRecovery, SourceRange } from '../contracts/types';
import { HTML_RAW_TEXT_ELEMENTS, htmlCommentEnd } from '../html/html-policy';
import { mathTokenEnd, scanInterpolationEnd } from './lexical';

/**
 * One tag-shaped token found by the tolerant structural planner. `complete`
 * is false when the closing `>` was never found (or an attribute quote stayed
 * open); such a tag always uses the conservative boundary rule.
 */
export interface RmdTagScan {
  readonly name: string;
  readonly closing: boolean;
  readonly self: boolean;
  readonly end: number;
  readonly complete: boolean;
}

/** Lexical services owned by the parser; the planner never re-parses source. */
export interface RmdRecoveryHooks {
  readonly facts: SourceFacts;
  /** Root footnote definitions are literal bodies, not structural RMD. */
  readonly definitions: readonly SourceRange[];
  isKnown(name: string): boolean;
  /** False for registered leaf components, which never require a closing tag. */
  isPaired(name: string): boolean;
  isHtmlName(lower: string): boolean;
  isVoidHtml(lower: string): boolean;
  /** End offset of a raw-text HTML body, or null when it never closes. */
  rawHtmlEnd(lower: string, bodyStart: number, insideContainer: boolean): number | null;
  /** Fenced/inline code or escape ending at `offset`, if any. */
  protectedEnd(offset: number, insideContainer: boolean): number | null;
  /** Document-wide Markdown code range ending at `offset`, if any. */
  codeEndAt(offset: number): number | null;
  readTag(offset: number): RmdTagScan | null;
  beginsLine(offset: number): boolean;
  charge(units: number, start: number, end: number): void;
}

export interface RmdRecoveryPlan {
  readonly recoveries: readonly LocalRecovery[];
  /** Non-overlapping ranges, sorted by start; each is consumed literally. */
  readonly ranges: readonly SourceRange[];
  /** Exact range-start lookup used by the region scanner. */
  readonly byStart: ReadonlyMap<number, number>;
}

type Boundary = LocalRecovery['boundary'];

const RMD_TAG_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Mirrors the parser's tag-name budget; longer names stay fatal. */
const MAX_TAG_NAME = 128;
const RECOVERY_UNCLOSED = 'local.recovery.unclosed';
const RECOVERY_MISMATCH = 'local.recovery.mismatch';
const RECOVERY_STRAY_CLOSE = 'local.recovery.stray-close';

interface OpenTag {
  readonly name: string;
  readonly lower: string;
  readonly start: number;
  readonly end: number;
  readonly kind: 'rmd' | 'html';
  readonly known: boolean;
  /** An unknown inline tag without a pair is prose, never a recovery point. */
  readonly structural: boolean;
  readonly complete: boolean;
  /** Recovery records appended since this unknown tag opened (pairing is opaque). */
  readonly pendingMark: number;
}

/** Line lookup on the shared physical-line facts (LF, CRLF and CR). */
function factLineIndex(facts: SourceFacts, offset: number): number {
  const lines = facts.lines;
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (lines[middle].from <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Mirror of the parser's `{{ ... }}` shield; an unclosed opener skips two units. */
function interpolationEnd(source: string, start: number): number {
  const end = scanInterpolationEnd(source, start, source.length);
  return end < 0 ? start + 2 : end;
}

/** ATX heading at the content start of a physical line (container prefixes removed). */
function atxHeadingAt(source: string, line: SourceFacts['lines'][number]): boolean {
  const text = source.slice(line.from, line.to);
  let cursor = 0;
  // Blockquote markers may repeat; at most three spaces may precede each.
  for (;;) {
    let probe = cursor;
    for (let spaces = 0; spaces < 3 && text[probe] === ' '; spaces += 1) probe += 1;
    if (text[probe] !== '>') break;
    probe += 1;
    if (text[probe] === ' ') probe += 1;
    cursor = probe;
  }
  let probe = cursor;
  while (text[probe] === ' ' || text[probe] === '\t') probe += 1;
  const indent = probe - cursor;
  if (indent > 3 && line.depth === 0) return false;
  const marker = /^(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(text.slice(probe));
  if (marker) probe += marker[0].length;
  return /^#{1,6}(?:[ \t]+|$)/.test(text.slice(probe));
}

/** Physical lines that only carry container markers count as blank separators. */
function isBlankSeparator(line: SourceFacts['lines'][number] | undefined): boolean {
  return line !== undefined && (line.blank || /^[ \t]*(?:>[ \t]*)*$/.test(line.text));
}

function findLastIndex(stack: readonly OpenTag[], predicate: (tag: OpenTag) => boolean, charge: () => void): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    charge();
    if (predicate(stack[index])) return index;
  }
  return -1;
}

/**
 * Plan the structure-only recovery for one document. The scan is single-pass
 * and uses the parser's existing lexical guards, so code, comments,
 * interpolations, formulas and raw HTML never become sync points. It returns
 * literal ranges plus stable recovery records; nothing here mutates source.
 */
export function planRmdRecovery(source: string, hooks: RmdRecoveryHooks): RmdRecoveryPlan {
  const recoveries: LocalRecovery[] = [];
  const stack: OpenTag[] = [];
  // One deterministic charge covers the single structural pass.
  hooks.charge(source.length, 0, Math.max(1, source.length));

  const record = (
    code: string,
    cause: SourceRange,
    affected: SourceRange,
    boundary: Boundary,
  ): void => {
    if (affected.end <= affected.start) return;
    recoveries.push({
      code,
      causeRange: { start: cause.start, end: cause.end },
      affectedRange: { start: affected.start, end: affected.end },
      action: 'literal-fallback',
      boundary,
    });
  };

  const classify = (name: string, lower: string): 'rmd' | 'html' | 'theme' | 'ignore' => {
    if (lower === 'theme') return 'theme';
    if (hooks.isKnown(name)) return 'rmd';
    if (hooks.isHtmlName(lower)) return 'html';
    if (!RMD_TAG_NAME.test(name)) return 'ignore';
    return 'rmd';
  };

  /** Unclosed inner tags before a matched close become literal; the close stays. */
  const recoverBeforeClose = (matchedIndex: number, closeStart: number): void => {
    const firstInner = stack[matchedIndex + 1];
    if (!firstInner) return;
    const structural = stack.slice(matchedIndex + 1)
      .filter((entry) => entry.kind === 'rmd' && entry.structural);
    if (!structural.length) return;
    const start = firstInner.start;
    for (const entry of structural) {
      record(RECOVERY_MISMATCH, { start: entry.start, end: entry.end }, { start, end: closeStart }, 'container-end');
    }
  };

  let definitionIndex = 0;
  let index = 0;
  while (index < source.length) {
    while (definitionIndex < hooks.definitions.length && hooks.definitions[definitionIndex].end <= index) {
      definitionIndex += 1;
    }
    const definition = hooks.definitions[definitionIndex];
    if (definition && definition.start <= index) {
      index = definition.end;
      continue;
    }

    const insideContainer = stack.length > 0;
    if (!insideContainer) {
      const codeEnd = hooks.codeEndAt(index);
      if (codeEnd !== null && codeEnd > index) { index = Math.min(codeEnd, source.length); continue; }
    }
    // TeX delimiters precede the generic backslash escape guard: `\\[` and
    // `\(` must hide their whole formula, not just the first two units.
    const math = mathTokenEnd(source, index, source.length);
    if (math !== null) { index = math; continue; }
    const shield = hooks.protectedEnd(index, insideContainer);
    if (shield !== null && shield > index) { index = Math.min(shield, source.length); continue; }
    if (source.startsWith('<!--', index)) {
      index = htmlCommentEnd(source, index, source.length);
      continue;
    }
    if (source.startsWith('{{', index)) { index = interpolationEnd(source, index); continue; }
    if (source[index] !== '<') { index += 1; continue; }

    const tag = hooks.readTag(index);
    if (!tag) { index += 1; continue; }
    const lower = tag.name.toLowerCase();
    const kind = classify(tag.name, lower);
    const next = Math.max(tag.end, index + 1);
    if (kind === 'theme' || kind === 'ignore' || tag.name.length > MAX_TAG_NAME) {
      index = next;
      continue;
    }

    if (!tag.complete) {
      // A missing `>` or an open attribute quote consumes the rest of the
      // source. Only a structural opener is recoverable; prose stays text.
      if (kind === 'html') { index = next; continue; }
      if (tag.closing && !hooks.isKnown(tag.name) && !hooks.beginsLine(index)) {
        index = next;
        continue;
      }
      if (!tag.closing && !hooks.isKnown(tag.name) && !hooks.beginsLine(index)) {
        index = next;
        continue;
      }
      // A broken inner quote cannot consume a known outer closing delimiter.
      // Search tag-shaped delimiters without treating quoted text as new RMD.
      let outerClose: number | null = null;
      for (let cursor = source.indexOf('<', next); cursor >= 0; cursor = source.indexOf('<', cursor + 1)) {
        const line = hooks.facts.lines[factLineIndex(hooks.facts, cursor)];
        if (line?.fenced || hooks.codeEndAt(cursor) !== null) continue;
        if (source.startsWith('<!--', cursor)) {
          const stop = source.indexOf('-->', cursor + 4);
          if (stop < 0) break;
          cursor = stop + 2;
          continue;
        }
        const closing = /^<\/([a-z][a-z0-9-]*)\s*>/.exec(source.slice(cursor, cursor + 256));
        if (closing && findLastIndex(stack, entry => entry.name === closing[1], () => hooks.charge(1, cursor, cursor + closing[0].length)) >= 0) {
          outerClose = cursor; break;
        }
      }
      const fallback = outerClose ?? containerBoundary(source, index, index, hooks);
      record(
        RECOVERY_UNCLOSED,
        { start: index, end: next },
        { start: index, end: fallback ?? source.length },
        outerClose !== null ? 'container-end' : fallback === null ? 'eof' : 'fragment',
      );
      if (outerClose !== null) { index = outerClose; continue; }
      break;
    }

    if (kind === 'html') {
      if (tag.closing) {
        const matched = findLastIndex(stack, (entry) => entry.kind === 'html' && entry.lower === lower, () => hooks.charge(1, index, next));
        if (matched >= 0) {
          recoverBeforeClose(matched, index);
          stack.length = matched;
        }
        // Stray HTML closers belong to the HTML recovery policy.
        index = next;
        continue;
      }
      if (tag.self || hooks.isVoidHtml(lower)) { index = next; continue; }
      if (HTML_RAW_TEXT_ELEMENTS.has(lower)) {
        // Raw text and P0 `<pre>`/`<code>` bodies never expose RMD structure.
        const stop = hooks.rawHtmlEnd(lower, tag.end, insideContainer);
        index = stop === null ? source.length : Math.max(stop, next);
        continue;
      }
      stack.push({
        name: tag.name,
        lower,
        start: index,
        end: tag.end,
        kind: 'html',
        known: false,
        structural: false,
        complete: true,
        pendingMark: recoveries.length,
      });
      index = next;
      continue;
    }

    if (tag.closing) {
      const matched = findLastIndex(stack, (entry) => entry.kind === 'rmd' && entry.name === tag.name, () => hooks.charge(1, index, next));
      if (matched < 0) {
        // A closing tag for a registered leaf is a shape error, not a
        // structure repair; leave it for the existing validation.
        if (!hooks.isPaired(tag.name)) { index = next; continue; }
        // An isolated closing tag degrades only itself.
        record(RECOVERY_STRAY_CLOSE, { start: index, end: tag.end }, { start: index, end: tag.end }, 'token');
      } else {
        const entry = stack[matched];
        if (!entry.known) {
          // A paired unknown tag is one opaque lazy range in strict mode;
          // reject any inner recovery records that pairing made irrelevant.
          recoveries.length = entry.pendingMark;
        } else {
          recoverBeforeClose(matched, index);
        }
        stack.length = matched;
      }
      index = next;
      continue;
    }

    // A paired tag written with `/>` keeps its existing shape diagnostic; leaf
    // and container form checks are not part of the structure whitelist.
    if (tag.self || !hooks.isPaired(tag.name)) { index = next; continue; }
    const known = hooks.isKnown(tag.name);
    stack.push({
      name: tag.name,
      lower,
      start: index,
      end: tag.end,
      kind: 'rmd',
      known,
      structural: known || hooks.beginsLine(index),
      complete: true,
      pendingMark: recoveries.length,
    });
    index = next;
  }

  // An unclosed tail resynchronizes at the next eligible ATX heading; without
  // one it stays literal to the end of the document.
  let coveredEnd = -1;
  for (const firstStructural of stack) {
    if (firstStructural.kind !== 'rmd' || !firstStructural.structural || firstStructural.start < coveredEnd) continue;
    let end = source.length;
    let boundary: Boundary = 'eof';
    if (firstStructural.complete) {
      const heading = findHeadingSync(source, firstStructural.end, firstStructural.start, hooks);
      if (heading !== null) {
        end = heading;
        boundary = 'heading';
      }
    }
    if (boundary === 'eof') {
      const fragment = containerBoundary(source, firstStructural.end, firstStructural.start, hooks);
      if (fragment !== null) {
        end = fragment;
        boundary = 'fragment';
      }
    }
    record(RECOVERY_UNCLOSED, { start: firstStructural.start, end: firstStructural.end }, { start: firstStructural.start, end }, boundary);
    coveredEnd = end;
  }

  return finalize(recoveries);
}

/**
 * End of the enclosing Markdown blockquote/list, when the opener sits inside
 * one. Top-level damage has no reliable boundary short of EOF.
 */
function containerBoundary(
  source: string,
  from: number,
  openStart: number,
  hooks: RmdRecoveryHooks,
): number | null {
  const { facts } = hooks;
  const openLine = facts.lines[factLineIndex(facts, openStart)];
  if (!openLine || (openLine.quoteDepth === 0 && openLine.depth === 0)) return null;
  let lineIndex = factLineIndex(facts, Math.min(from, source.length)) + 1;
  for (; lineIndex < facts.lines.length; lineIndex += 1) {
    const line = facts.lines[lineIndex];
    if (!line || line.blank || line.fenced) continue;
    if (line.quoteDepth < openLine.quoteDepth || line.depth < openLine.depth) return line.from;
  }
  return null;
}

/** First ATX heading that can safely resume parsing after an unclosed opener. */
function findHeadingSync(
  source: string,
  from: number,
  openStart: number,
  hooks: RmdRecoveryHooks,
): number | null {
  const { facts } = hooks;
  const lines = facts.lines;
  if (!lines.length) return null;
  const openLine = lines[factLineIndex(facts, openStart)];
  const startLine = factLineIndex(facts, Math.min(from, source.length));
  let lineIndex = startLine + 1;
  if (lineIndex >= lines.length) return null;
  hooks.charge(Math.max(1, source.length - from), Math.max(0, from), source.length);

  let definitionIndex = 0;
  let index = lines[lineIndex].from;
  while (index < source.length) {
    while (definitionIndex < hooks.definitions.length && hooks.definitions[definitionIndex].end <= index) {
      definitionIndex += 1;
    }
    const definition = hooks.definitions[definitionIndex];
    if (definition && definition.start <= index) { index = definition.end; continue; }

    lineIndex = factLineIndex(facts, index);
    const line = lines[lineIndex];
    if (line && index === line.from) {
      const previous = lineIndex > 0 ? lines[lineIndex - 1] : undefined;
      if (line.quoteDepth === openLine.quoteDepth && line.depth === openLine.depth
        && !line.fenced && isBlankSeparator(previous) && atxHeadingAt(source, line)) {
        return line.from;
      }
    }

    const insideContainer = line !== undefined && line.depth > 0;
    const codeEnd = hooks.codeEndAt(index);
    if (codeEnd !== null && codeEnd > index) { index = Math.min(codeEnd, source.length); continue; }
    const math = mathTokenEnd(source, index, source.length);
    if (math !== null) { index = math; continue; }
    const shield = hooks.protectedEnd(index, insideContainer);
    if (shield !== null && shield > index) { index = Math.min(shield, source.length); continue; }
    if (source.startsWith('<!--', index)) {
      index = htmlCommentEnd(source, index, source.length);
      continue;
    }
    if (source.startsWith('{{', index)) { index = interpolationEnd(source, index); continue; }
    if (source[index] === '<') {
      const tag = hooks.readTag(index);
      if (!tag) { index += 1; continue; }
      // An unterminated tag (open quote) makes every later heading unsafe.
      if (!tag.complete) return null;
      const lower = tag.name.toLowerCase();
      if (!tag.closing && HTML_RAW_TEXT_ELEMENTS.has(lower) && hooks.isHtmlName(lower) && !tag.self) {
        const stop = hooks.rawHtmlEnd(lower, tag.end, insideContainer);
        if (stop === null) return null;
        index = Math.max(stop, index + 1);
        continue;
      }
      index = Math.max(tag.end, index + 1);
      continue;
    }
    index += 1;
  }
  return null;
}

function finalize(records: LocalRecovery[]): RmdRecoveryPlan {
  const ordered = records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => left.record.affectedRange.start - right.record.affectedRange.start
      || left.record.affectedRange.end - right.record.affectedRange.end
      || left.record.causeRange.start - right.record.causeRange.start
      || left.index - right.index);
  const recoveries: LocalRecovery[] = [];
  for (const { record } of ordered) {
    const last = recoveries[recoveries.length - 1];
    if (last && record.affectedRange.start < last.affectedRange.end) {
      if (record.affectedRange.end > last.affectedRange.end) {
        last.affectedRange = { start: last.affectedRange.start, end: record.affectedRange.end };
      }
      continue;
    }
    recoveries.push({
      code: record.code,
      causeRange: { start: record.causeRange.start, end: record.causeRange.end },
      affectedRange: { start: record.affectedRange.start, end: record.affectedRange.end },
      action: record.action,
      boundary: record.boundary,
    });
  }
  const ranges = recoveries.map(({ affectedRange }) => affectedRange);
  const byStart = new Map<number, number>();
  for (const range of ranges) byStart.set(range.start, range.end);
  return { recoveries, ranges, byStart };
}
