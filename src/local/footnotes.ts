import type { LocalDocument, LocalNode } from './types';

/**
 * Footnote identity fields. The core parser adds them to `LocalNode`; the
 * optional shape keeps this module usable with hand-built trees and with
 * documents compiled before the fields existed.
 */
interface FootnoteFields {
  identifier?: string;
  label?: string;
}

type FootnoteNode = LocalNode & FootnoteFields;

/** One rendered reference occurrence and the endnote it points at. */
export interface LocalFootnoteReferenceSite {
  node: LocalNode;
  /** Unique, instance-scoped DOM id for this occurrence. */
  id: string;
}

/** One referenced definition, numbered by first reference order. */
export interface LocalFootnoteEntry {
  identifier: string;
  /** 1-based number shared by every reference to this identifier. */
  number: number;
  definition: LocalNode;
  /** Instance-scoped DOM id of the endnote list item. */
  id: string;
  references: LocalFootnoteReferenceSite[];
}

/** What a single `footnoteReference` node renders as. */
export interface LocalFootnoteSite {
  /** Unique DOM id of the reference link; empty for an undefined reference. */
  id: string;
  /** The matching entry, or `null` when no definition exists. */
  entry: LocalFootnoteEntry | null;
  /** Original label, shown as `[^label]` for undefined references. */
  label: string;
}

export interface LocalFootnoteIndex {
  /** Referenced definitions in first-reference order. */
  entries: LocalFootnoteEntry[];
  siteFor(node: LocalNode): LocalFootnoteSite | undefined;
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** A hand-built node may still carry the original `[^label]` source in `value`. */
function unwrapMarker(value: string): string {
  const match = /^\[\^([\s\S]*)\]$/.exec(value.trim());
  return match ? match[1] : value;
}

function record(node: LocalNode): FootnoteFields {
  return node as FootnoteNode;
}

function attrField(node: LocalNode, name: string): string | undefined {
  return textField(node.attrs?.[name]);
}

/**
 * The parser already normalizes identifiers, but a hand-built tree may carry
 * raw labels. Whitespace runs collapse and case is folded so references and
 * definitions still meet; the renderer never uses this value in HTML.
 */
export function normalizeFootnoteIdentifier(value: string): string {
  return value.replace(/[\t\n\r ]+/g, ' ').replace(/^ | $/g, '').toLowerCase().toUpperCase().toLowerCase();
}

function rawIdentifier(node: LocalNode): string {
  const fields = record(node);
  const stored = textField(node.value);
  return textField(fields.identifier)
    ?? textField(fields.label)
    ?? attrField(node, 'identifier')
    ?? attrField(node, 'label')
    ?? (stored ? unwrapMarker(stored) : '');
}

/** Normalized, non-empty identifier used to pair references and definitions. */
export function footnoteIdentifier(node: LocalNode): string {
  return normalizeFootnoteIdentifier(rawIdentifier(node));
}

/** Original label shown to readers; never used to build a DOM id. */
export function footnoteLabelText(node: LocalNode): string {
  const fields = record(node);
  const stored = textField(node.value);
  const raw = textField(fields.label)
    ?? textField(fields.identifier)
    ?? attrField(node, 'label')
    ?? attrField(node, 'identifier')
    ?? (stored ? unwrapMarker(stored) : '');
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Collect definitions and references for one document instance.
 *
 * Numbering follows the order references become visible: body references in
 * source order first, then references exposed inside already-numbered endnote
 * bodies. References inside a definition that is never displayed therefore do
 * not create an endnote or a dangling backlink. Duplicate definitions keep the
 * first one; unresolved references render as `[^label]` and are not numbered.
 */
export function collectLocalFootnotes(
  document: LocalDocument,
  instanceId: string,
): LocalFootnoteIndex {
  const definitions = new Map<string, LocalNode>();
  const topReferences: LocalNode[] = [];
  const nestedReferences = new Map<LocalNode, LocalNode[]>();
  const definitionStack: LocalNode[] = [];

  const walk = (nodes: LocalNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === 'footnoteDefinition') {
        const identifier = footnoteIdentifier(node);
        if (identifier && !definitions.has(identifier)) definitions.set(identifier, node);
        definitionStack.push(node);
        walk(node.children);
        definitionStack.pop();
        continue;
      }
      if (node.type === 'footnoteReference') {
        const owner = definitionStack[definitionStack.length - 1];
        if (owner) {
          const list = nestedReferences.get(owner);
          if (list) list.push(node);
          else nestedReferences.set(owner, [node]);
        } else {
          topReferences.push(node);
        }
        // A reference renders itself only; nested nodes would never get an id,
        // so they must not be numbered either.
        continue;
      }
      walk(node.children);
    }
  };
  walk(document.nodes);

  const entries: LocalFootnoteEntry[] = [];
  const entryByIdentifier = new Map<string, LocalFootnoteEntry>();
  const sites = new Map<LocalNode, LocalFootnoteSite>();
  const occurrences = new Map<string, number>();

  const activate = (identifier: string): LocalFootnoteEntry | null => {
    const definition = definitions.get(identifier);
    if (!definition) return null;
    const existing = entryByIdentifier.get(identifier);
    if (existing) return existing;
    const entry: LocalFootnoteEntry = {
      identifier,
      number: entries.length + 1,
      definition,
      id: `${instanceId}-fn-${entries.length + 1}`,
      references: [],
    };
    entries.push(entry);
    entryByIdentifier.set(identifier, entry);
    return entry;
  };

  const resolve = (node: LocalNode) => {
    const identifier = footnoteIdentifier(node);
    const entry = identifier ? activate(identifier) : null;
    if (!entry) {
      sites.set(node, { id: '', entry: null, label: footnoteLabelText(node) });
      return;
    }
    const occurrence = (occurrences.get(identifier) ?? 0) + 1;
    occurrences.set(identifier, occurrence);
    const id = `${instanceId}-fnref-${entry.number}-${occurrence}`;
    entry.references.push({ node, id });
    sites.set(node, { id, entry, label: footnoteLabelText(node) });
  };

  for (const node of topReferences) resolve(node);
  // Entries appended while resolving nested references are processed in turn,
  // so every displayed endnote body is scanned exactly once.
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    for (const node of nestedReferences.get(entry.definition) ?? []) resolve(node);
  }

  return {
    entries,
    siteFor(node: LocalNode): LocalFootnoteSite | undefined {
      return sites.get(node);
    },
  };
}
