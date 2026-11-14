import type { MarkdownStructure } from '../markdown/markdown-blocks';
import type { LocalNode, LocalRecovery } from '../contracts/types';

/**
 * Optional parser abilities installed by the compiler assembly.
 *
 * The Markdown body, RMD structure, expressions and budgets are core. GFM
 * syntax, native HTML support and the Lezer block planner are capabilities:
 * the minimal entry installs none, while the standard and compatibility
 * entries install `STANDARD_PARSER_CAPABILITIES`.
 */

/** Structural signature of the raw HTML table reader. */
export type LocalHtmlTableReader = (
  source: string,
  start: number,
  limit: number,
  hooks: any,
) => { node: LocalNode; end: number } | null;

/** Structural signature of isolated HTML fragment repair. */
export type LocalHtmlFragmentRecovery = (
  source: string,
  start: number,
  end: number,
  createNode: (type: string, start: number, end: number, extra?: Partial<LocalNode>) => LocalNode,
  componentNames: ReadonlySet<string>,
  contextTag?: string,
) => { nodes: LocalNode[]; recovery: LocalRecovery; end: number } | null;

export interface LocalParserHtmlCapability {
  /** Browser-recognized tag names used to keep ordinary native HTML inert. */
  readonly nativeTagNames: ReadonlySet<string>;
  /** Decode character references without activating markup. */
  decodeEntities(value: string): string;
  /**
   * Decode character references in an attribute value (attribute grammar).
   * Optional; capabilities without it fall back to `decodeEntities`.
   */
  decodeAttribute?(value: string): string;
  /** Raw HTML table reader used before Markdown table handling. */
  readonly readTable: LocalHtmlTableReader;
  /** Isolated fragment repair for non-strict mode. */
  readonly recoverFragment: LocalHtmlFragmentRecovery;
}

/** A remark plugin attached to the core CommonMark processor. */
export type LocalMarkdownPlugin = (...args: any[]) => unknown;

export interface LocalParserCapabilities {
  /** remark plugins beyond CommonMark; the standard assembly adds GFM. */
  readonly markdownPlugins?: readonly LocalMarkdownPlugin[];
  readonly html?: LocalParserHtmlCapability;
  /** Advisory top-level block planning; omitted assemblies parse one block. */
  readonly markdownStructure?: (source: string) => MarkdownStructure;
}

/** Empty assembly used by the minimal compiler. */
export const NO_PARSER_CAPABILITIES: LocalParserCapabilities = Object.freeze({});
