import { localComponentDigest, MAX_LOCAL_SDK_COMPONENTS } from '../sdk/manifest';
import { readLocalConfig } from '../sdk/config';
import type { LocalConfig, LocalExtensionRequirements } from '../sdk/types';
import type { Diagnostic } from '../local/types';

export function extensionDiagnostic(code: string, message: string): Diagnostic {
  return { code, message, severity: 'error', range: { start: 0, end: 0 }, line: 1, column: 1 };
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
