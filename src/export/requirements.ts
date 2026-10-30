import {
  localComponentDigest,
  localJsonByteLength,
  MAX_LOCAL_SDK_COMPONENTS,
  readLocalComponentManifest,
} from '../sdk/manifest';
import { readLocalConfig } from '../sdk/config';
import type {
  LocalComponentDefinition,
  LocalConfig,
  LocalExtensionRequirements,
} from '../sdk/types';
import type { Diagnostic, LocalDocument, LocalNode } from '../local/types';

/** A carried contract list must stay bounded like a configuration. */
const MAX_CARRIED_DEFINITIONS = MAX_LOCAL_SDK_COMPONENTS + 64;
const MAX_CARRIED_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_SCANNED_NODES = 500_000;

export function extensionDiagnostic(code: string, message: string): Diagnostic {
  return { code, message, severity: 'error', range: { start: 0, end: 0 }, line: 1, column: 1 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requirements select installed implementations; they never load or execute code. */
export function validateLocalExtensionRequirements(
  requirements: unknown,
  config?: LocalConfig,
): Diagnostic[] {
  if (requirements === undefined) return [];
  const diagnostics: Diagnostic[] = [];
  const fail = (message: string) => diagnostics.push(extensionDiagnostic('local.extension.requirements', message));
  try {
    if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) {
      fail('Extension requirements must be a plain object.');
      return diagnostics;
    }
    const value = requirements as LocalExtensionRequirements;
    if (value.protocol !== 'reactive-md-extensions/v1' || !Array.isArray(value.components) || value.components.length > MAX_LOCAL_SDK_COMPONENTS) {
      fail('Unsupported or oversized extension requirements.');
      return diagnostics;
    }
    const installed = config === undefined ? undefined : readLocalConfig(config);
    const seen = new Set<string>();
    for (const entry of value.components) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string'
        || typeof entry.name !== 'string' || typeof entry.version !== 'string' || typeof entry.digest !== 'string'
        || [entry.id, entry.name, entry.version, entry.digest].some(field => field.length > 256) || seen.has(entry.id)) {
        fail('Invalid or duplicate component requirement.');
        continue;
      }
      seen.add(entry.id);
      const definition = installed?.components.find(item => item.id === entry.id);
      if (!definition) {
        fail(`Component ${entry.id}@${entry.version} is not installed in this host.`);
      } else if (definition.name !== entry.name || definition.version !== entry.version
        || localComponentDigest(definition) !== entry.digest) {
        fail(`Component ${entry.id}@${entry.version} does not match the installed component contract.`);
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  return diagnostics;
}

/* ------------------------------------------------------------------ */
/* Compile-time contract preflight                                     */
/* ------------------------------------------------------------------ */

export interface LocalComponentContractCheck {
  readonly document: LocalDocument;
  /** Installed default preset plus external definitions for this host. */
  readonly installed: readonly LocalComponentDefinition[];
  /** Tag names of installed external components (not the default preset). */
  readonly externalNames?: ReadonlySet<string>;
}

interface CarriedDefinitions {
  readonly definitions: readonly LocalComponentDefinition[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Read the document-carried contract list without throwing. Invalid JSON-ish
 * metadata is diagnosed; callers can keep rendering with the installed
 * manifests.
 */
function readCarriedDefinitions(document: LocalDocument): CarriedDefinitions {
  const diagnostics: Diagnostic[] = [];
  const fail = (message: string) => diagnostics.push(
    extensionDiagnostic('local.extension.contract-metadata', message),
  );
  const raw = (document as { componentDefinitions?: unknown }).componentDefinitions;
  if (raw === undefined) return { definitions: [], diagnostics };
  if (!Array.isArray(raw)) {
    fail('Carried component definitions must be an array.');
    return { definitions: [], diagnostics };
  }
  if (raw.length > MAX_CARRIED_DEFINITIONS) {
    fail(`Carried component definitions exceed the ${MAX_CARRIED_DEFINITIONS}-entry budget.`);
    return { definitions: [], diagnostics };
  }
  const bytes = localJsonByteLength(raw);
  if (!Number.isFinite(bytes) || bytes > MAX_CARRIED_METADATA_BYTES) {
    fail(`Carried component definitions exceed the ${MAX_CARRIED_METADATA_BYTES}-byte budget.`);
    return { definitions: [], diagnostics };
  }
  const definitions: LocalComponentDefinition[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    try {
      definitions.push(readLocalComponentManifest(raw[index]));
    } catch (error) {
      fail(`Carried component definition ${index} is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }
  return { definitions, diagnostics };
}

function collectRequirementIndex(
  document: LocalDocument,
): Map<string, { id: string; name: string; version: string; digest: string }> {
  const index = new Map<string, { id: string; name: string; version: string; digest: string }>();
  const raw = document.extensions as unknown;
  if (!isRecord(raw) || raw.protocol !== 'reactive-md-extensions/v1'
    || !Array.isArray(raw.components) || raw.components.length > MAX_LOCAL_SDK_COMPONENTS) return index;
  for (const entry of raw.components) {
    if (!isRecord(entry)) continue;
    const { id, name, version, digest } = entry;
    if (typeof id !== 'string' || typeof name !== 'string'
      || typeof version !== 'string' || typeof digest !== 'string') continue;
    index.set(name, { id, name, version, digest });
  }
  return index;
}

function collectHostComponentNodes(
  document: LocalDocument,
): { names: Set<string>; diagnostics: Diagnostic[] } {
  const names = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  if (!Array.isArray(document.nodes)) {
    diagnostics.push(extensionDiagnostic('local.extension.contract-metadata', 'Document nodes must be an array.'));
    return { names, diagnostics };
  }
  const stack: LocalNode[] = [...document.nodes];
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    visited += 1;
    if (visited > MAX_SCANNED_NODES) {
      diagnostics.push(extensionDiagnostic('local.extension.contract-metadata', 'Document component scan exceeded its node budget.'));
      break;
    }
    if (node.type === 'hostComponent' || node.type === 'component') {
      const name = typeof node.name === 'string' ? node.name : '';
      if (name) names.add(name);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) stack.push(child);
    }
  }
  return { names, diagnostics };
}

/**
 * Preflight the compiled component contracts against the installed manifests.
 *
 * Carried `document.componentDefinitions` are never trusted to replace
 * installed semantics: each entry must revalidate through the public manifest
 * reader and match an installed id/name/version/digest. External component
 * nodes must be covered by matching extension requirements. Default-only
 * documents without carried definitions stay valid through the installed
 * default preset.
 */
export function validateLocalComponentContracts(
  check: LocalComponentContractCheck,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fail = (message: string) => diagnostics.push(
    extensionDiagnostic('local.extension.contract', message),
  );
  try {
    const { document, installed } = check;
    const carried = readCarriedDefinitions(document);
    diagnostics.push(...carried.diagnostics);

    const installedById = new Map<string, LocalComponentDefinition>();
    const installedByName = new Map<string, LocalComponentDefinition>();
    for (const definition of installed) {
      installedById.set(definition.id, definition);
      installedByName.set(definition.name, definition);
    }

    const carriedById = new Map<string, LocalComponentDefinition>();
    const carriedByName = new Map<string, LocalComponentDefinition>();
    for (const definition of carried.definitions) {
      if (carriedById.has(definition.id) || carriedByName.has(definition.name)) {
        fail(`Carried component definition ${definition.id} is declared more than once.`);
        continue;
      }
      carriedById.set(definition.id, definition);
      carriedByName.set(definition.name, definition);
      const installedDefinition =
        installedById.get(definition.id) ?? installedByName.get(definition.name);
      if (!installedDefinition) {
        fail(`Carried component ${definition.id}@${definition.version} is not installed in this host.`);
        continue;
      }
      if (installedDefinition.id !== definition.id
        || installedDefinition.name !== definition.name
        || installedDefinition.version !== definition.version
        || localComponentDigest(installedDefinition) !== localComponentDigest(definition)) {
        fail(`Carried component ${definition.id}@${definition.version} does not match the installed component contract.`);
      }
    }

    const externalNames = check.externalNames ?? new Set<string>();
    if (externalNames.size > 0) {
      const used = collectHostComponentNodes(document);
      diagnostics.push(...used.diagnostics);
      const requirements = collectRequirementIndex(document);
      for (const name of used.names) {
        if (!externalNames.has(name)) continue;
        const installedDefinition = installedByName.get(name);
        if (!installedDefinition) {
          fail(`Component <${name}> is used but no matching installed component contract exists.`);
          continue;
        }
        const requirement = requirements.get(name);
        if (!requirement) {
          fail(`Component <${name}> is used but the document has no extension requirement for ${installedDefinition.id}@${installedDefinition.version}.`);
          continue;
        }
        if (requirement.id !== installedDefinition.id
          || requirement.version !== installedDefinition.version
          || requirement.digest !== localComponentDigest(installedDefinition)) {
          fail(`Component <${name}> requirement does not match the installed ${installedDefinition.id}@${installedDefinition.version}.`);
        }
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  return diagnostics;
}
