import type {
  LocalComplianceCapability,
  LocalComplianceCaseResult,
  LocalComplianceDiagnostic,
  LocalComplianceStatus,
  LocalComplianceSuite,
  LocalComplianceValue,
} from './types';

export interface LocalCaseInput {
  readonly id: string;
  readonly suite: LocalComplianceSuite;
  readonly status: LocalComplianceStatus;
  readonly message?: string;
  readonly diagnostics?: readonly LocalComplianceDiagnostic[];
  readonly capabilities?: readonly LocalComplianceCapability[];
  readonly observed?: Readonly<Record<string, LocalComplianceValue>>;
}

/** Build one bounded, frozen case result. */
export function localCase(input: LocalCaseInput): LocalComplianceCaseResult {
  return Object.freeze({
    id: input.id,
    suite: input.suite,
    status: input.status,
    ...(input.message === undefined ? {} : { message: input.message }),
    diagnostics: Object.freeze([...(input.diagnostics ?? [])]),
    ...(input.capabilities === undefined
      ? {}
      : { capabilities: Object.freeze([...input.capabilities]) }),
    ...(input.observed === undefined ? {} : { observed: Object.freeze({ ...input.observed }) }),
  });
}

export function passed(
  id: string,
  suite: LocalComplianceSuite,
  options: Omit<LocalCaseInput, 'id' | 'suite' | 'status'> = {},
): LocalComplianceCaseResult {
  return localCase({ id, suite, status: 'passed', ...options });
}

export function failed(
  id: string,
  suite: LocalComplianceSuite,
  message: string,
  diagnostics: readonly LocalComplianceDiagnostic[] = [],
): LocalComplianceCaseResult {
  return localCase({ id, suite, status: 'failed', message, diagnostics });
}

export function skipped(
  id: string,
  suite: LocalComplianceSuite,
  message: string,
  capabilities?: readonly LocalComplianceCapability[],
): LocalComplianceCaseResult {
  return localCase({ id, suite, status: 'skipped', message, capabilities });
}

export function unsupported(
  id: string,
  suite: LocalComplianceSuite,
  message: string,
  capabilities?: readonly LocalComplianceCapability[],
): LocalComplianceCaseResult {
  return localCase({ id, suite, status: 'unsupported', message, capabilities });
}
