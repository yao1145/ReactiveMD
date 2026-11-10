/**
 * Validate a component-state sidecar for a single-file export.
 *
 * The exported HTML restores state through the standalone runtime, whose
 * document identity defaults to the source digest. This module applies the same
 * identity and the same known-component scope before the sidecar is embedded,
 * so an export never ships records the runtime would silently skip.
 */

import { walkLocalNodes } from '../local/source/node-walk';
import type { Diagnostic, LocalDocument } from '../local/contracts/types';
import {
  LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
  parseLocalComponentStateDocument,
  type LocalComponentStateDocument,
  type LocalComponentStateRecord,
} from '../runtime-services/component-state';
import { componentStateKey, localSourceDigest, resolveDocumentId } from '../runtime-services/identity';

export type LocalComponentStateExportOutcome =
  | {
    readonly ok: true;
    readonly componentState: LocalComponentStateDocument;
    /** Record-level problems. Warnings are skippable; errors are not. */
    readonly diagnostics: Diagnostic[];
  }
  | { readonly ok: false; readonly diagnostics: Diagnostic[] };

function warning(code: string, message: string): Diagnostic {
  return {
    code,
    message,
    severity: 'warning',
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
  };
}

/** State keys the compiled document can restore under one identity. */
function documentStateKeys(document: LocalDocument, documentId: string): Set<string> {
  const sourceDigest = localSourceDigest(document.source);
  const keys = new Set<string>();
  for (const node of walkLocalNodes(document.nodes)) {
    if (node.name === undefined) continue;
    keys.add(componentStateKey({
      documentId,
      sourceDigest,
      nodeId: node.id,
      stateKey: node.attrs?.['state-key'],
    }));
  }
  return keys;
}

export interface ResolveLocalComponentStateExportOptions {
  /** Host identity for this export; defaults to the source digest. */
  readonly documentId?: string;
  /**
   * Current semantic configuration key. When supplied, matching records are
   * stamped with it and records from another configuration are dropped.
   * Omitted leaves the sidecar's own `configKey` untouched.
   */
  readonly configKey?: string;
  /** Legacy configuration identities accepted while resolving. */
  readonly legacyConfigKeys?: readonly string[];
}

/**
 * Resolve the component-state sidecar embedded in an interactive export.
 *
 * Structural payload errors fail the export. Invalid records keep their
 * `error` severity; records for another document identity or for components
 * that no longer exist are dropped with a warning.
 */
export function resolveLocalComponentStateExport(
  document: LocalDocument,
  input: unknown,
  options?: ResolveLocalComponentStateExportOptions,
): LocalComponentStateExportOutcome {
  const parsed = parseLocalComponentStateDocument(input);
  if (!parsed.ok) return parsed;

  const sourceDigest = localSourceDigest(document.source);
  const documentId = resolveDocumentId({ documentId: options?.documentId, sourceDigest });
  const knownKeys = documentStateKeys(document, documentId);
  const diagnostics: Diagnostic[] = [...parsed.diagnostics];
  const records: Record<string, LocalComponentStateRecord> = {};

  const configKey = options?.configKey;
  const savedConfigKey = parsed.document.configKey;
  const legacyConfigKeys = options?.legacyConfigKeys ?? [];
  if (savedConfigKey !== undefined && configKey !== undefined
    && savedConfigKey !== configKey && !legacyConfigKeys.includes(savedConfigKey)) {
    diagnostics.push(warning(
      'local.runtime.state.config-mismatch',
      `Saved component state belongs to configuration "${savedConfigKey}", not "${configKey}".`,
    ));
    return {
      ok: true,
      componentState: Object.freeze({
        format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
        configKey,
        records: Object.freeze({}),
      }),
      diagnostics,
    };
  }

  for (const [key, record] of Object.entries(parsed.records)) {
    if (record.documentId !== undefined && record.documentId !== documentId) {
      diagnostics.push(warning(
        'local.runtime.state.document-mismatch',
        `Saved state key "${key}" belongs to a different document identity (${record.documentId}).`,
      ));
      continue;
    }
    if (!knownKeys.has(key)) {
      diagnostics.push(warning(
        'local.runtime.state.unknown-component',
        `Saved state key "${key}" does not match any component in this document.`,
      ));
      continue;
    }
    records[key] = record;
  }

  return {
    ok: true,
    componentState: Object.freeze({
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      ...((configKey ?? savedConfigKey) === undefined ? {} : { configKey: configKey ?? savedConfigKey }),
      records: Object.freeze(records),
    }),
    diagnostics,
  };
}
