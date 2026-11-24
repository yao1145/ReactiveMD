import { LOCAL_HTML_NAMES } from '../../contracts/html-names';
import type { LocalNode } from '../types';
import type { LocalDiagnosticDetails } from '../configuration/diagnostics';
import type { FastMarkdownContext } from './fast-markdown';

export const MARK_OPEN = String.fromCharCode(0xe000);

export const MARK_CLOSE = String.fromCharCode(0xe001);

export const MARK_BOUNDARY = String.fromCharCode(0xe002);

export const HTML_NAMES = LOCAL_HTML_NAMES;

export const BLOCK_HTML_RESULTS = new Set(['paragraph', 'heading', 'div', 'details', 'blockquote', 'code', 'list', 'listItem', 'thematicBreak', 'htmlTable']);

export const NATIVE_HTML_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

export interface Token { start: number; end: number; block?: boolean; node: LocalNode }

export interface RegionResult { tokens: Token[]; end: number; contentEnd: number; indent: number }

/** Source range of one `[^label]:` definition block. */
export interface DefinitionRange { start: number; end: number }

export interface RegionOptions {
  /** Footnote bodies keep controls, interpolations and math as literal text. */
  footnote?: boolean;
  /** Base indentation removed from continuation lines when converting. */
  indent?: number;
  /** Container bodies use container-aware code fence detection. */
  container?: boolean;
  /** Definition blocks visible to this region. */
  definitions?: readonly DefinitionRange[];
  stripBlockquote?: boolean;
}

export interface ConvertOptions {
  /** Show raw HTML as text instead of diagnosing it (footnote bodies). */
  literalHtml?: boolean;
  /** Strip the enclosing Markdown quote markers before dedenting a note. */
  stripBlockquote?: boolean;
}

export class LocalBudgetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly start: number,
    readonly end: number,
    readonly key: string = code,
    readonly params?: Record<string, string | number | boolean | null>,
    readonly actual?: number,
  ) {
    super(message);
    this.name = 'LocalBudgetError';
  }
}

export type CreateNode = (type: string, start: number, end: number, extra?: Partial<LocalNode>) => LocalNode;

export type ParseDiagnostic = (code: string, message: string | LocalDiagnosticDetails, start: number, end?: number, details?: LocalDiagnosticDetails) => void;

export type ParseMarkdown = (text: string, tryFast?: boolean, fastContext?: FastMarkdownContext) => any;
