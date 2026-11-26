import type { FastMarkdownCache } from './fast-markdown';
import { DEFAULT_MAX_LOCAL_RAW_BODY_CHARS } from '../../contracts/limits';

/** Which deterministic parser budget a rejection belongs to. */
export type ParseBudgetKind = 'parse-work' | 'markdown-depth' | 'raw-body';

export interface ParseBudgetLimits {
  readonly maxParseWork: number;
  readonly maxMarkdownDepth: number;
  /** Raw container body source, in UTF-16 code units. */
  readonly maxRawBodyChars?: number;
}

/**
 * Deterministic budget failure. The parser converts this into a
 * `local.budget` diagnostic; it is never derived from wall-clock time, so a
 * document that fits the budget always compiles the same way.
 */
export class ParseBudgetError extends Error {
  constructor(
    readonly kind: ParseBudgetKind,
    readonly limit: number,
    readonly start: number,
    readonly end: number,
    /** Component name for `raw-body` failures. */
    readonly component?: string,
    /** Observed value for structured diagnostic details. */
    readonly actual?: number,
  ) {
    super(kind === 'parse-work'
      ? `Parsing work exceeds the limit of ${limit}.`
      : kind === 'markdown-depth'
        ? `Markdown nesting exceeds the ${limit}-level limit.`
        : `Raw body of <${component ?? 'component'}> exceeds the ${limit}-character limit.`);
    this.name = 'ParseBudgetError';
  }
}

/**
 * Per-parse work and depth accounting.
 *
 * Work units are deliberately abstract: roughly one source code unit scanned
 * or submitted to a general Markdown parse. Cache hits still charge the same
 * units as cache misses so that a session never changes whether a document is
 * accepted. Fenced code, inline code and indented code never contribute
 * Markdown depth; depth is observed from the shared `SourceContext` facts.
 */
export class ParseWorkBudget {
  private usedWork = 0;
  private observedDepth = 0;
  constructor(readonly limits: ParseBudgetLimits) {}

  get parseWork(): number { return this.usedWork; }
  get maxDepth(): number { return this.observedDepth; }

  charge(units: number, start: number, end: number): void {
    if (!Number.isFinite(units) || units <= 0) return;
    this.usedWork += Math.floor(units);
    if (this.usedWork > this.limits.maxParseWork) {
      throw new ParseBudgetError('parse-work', this.limits.maxParseWork, start, Math.max(start + 1, end));
    }
  }

  observeDepth(depth: number, start: number, end: number): void {
    if (!Number.isFinite(depth) || depth <= 0) {
      if (depth > this.observedDepth) this.observedDepth = depth;
      return;
    }
    if (depth > this.observedDepth) this.observedDepth = depth;
    if (depth > this.limits.maxMarkdownDepth) {
      throw new ParseBudgetError('markdown-depth', this.limits.maxMarkdownDepth, start, Math.max(start + 1, end));
    }
  }

  /**
   * Reject a raw container body whose source exceeds the configured budget.
   * The length is counted before common-indent removal and excludes the
   * opener and close tags.
   */
  checkRawBody(length: number, start: number, end: number, component: string): void {
    const limit = this.limits.maxRawBodyChars ?? DEFAULT_MAX_LOCAL_RAW_BODY_CHARS;
    if (length > limit) {
      throw new ParseBudgetError('raw-body', limit, start, Math.max(start + 1, end), component, length);
    }
  }
}

/** Cumulative counters exposed by a parse session to the parser. */
export interface ParseSessionCounters {
  readonly hits: number;
  readonly misses: number;
  readonly reusedBlocks: number;
  readonly reusedRows: number;
  readonly reusedItems: number;
  readonly reusedRowNodes: number;
  readonly reusedItemNodes: number;
  readonly reusedAst: number;
}

/**
 * Internal bridge between `parseLocal` and `LocalParseSession`.
 *
 * Only read-only intermediate data (fast plans, inline plans and remark ASTs)
 * is cached. Final `LocalNode` objects are never stored here because the
 * compiler mutates them; `parseLocal` always rebuilds nodes through its own
 * factory with fresh ids and the exact cumulative budget.
 */
export interface ParseSessionCache extends FastMarkdownCache {
  counters(): ParseSessionCounters;
  readTree(text: string): { readonly hit: true; readonly value: unknown } | { readonly hit: false };
  writeTree(text: string, value: unknown): void;
}
