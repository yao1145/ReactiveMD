/**
 * Framework-neutral compliance report types.
 *
 * A report is plain, bounded JSON data. Statuses are produced by executing
 * compiler/runtime behavior; a caller cannot mark a case as passed with a
 * boolean. Capability evidence is derived from passed cases only, so a
 * declared capability without executed evidence stays visibly missing.
 */

export const LOCAL_COMPLIANCE_PROTOCOL = 'reactive-md-compliance/v1' as const;
export const LOCAL_BEHAVIOR_SPEC_PROTOCOL = 'reactive-md-behavior-spec/v1' as const;
export const LOCAL_REACT_SPEC_PROTOCOL = 'reactive-md-react-spec/v1' as const;
export const LOCAL_BROWSER_SPEC_PROTOCOL = 'reactive-md-browser-spec/v1' as const;

/** Bounded spec budgets. */
export const MAX_LOCAL_COMPLIANCE_CASES = 128;
export const MAX_LOCAL_COMPLIANCE_SOURCE_LENGTH = 262_144;
export const MAX_LOCAL_COMPLIANCE_STRING_LENGTH = 4096;
export const MAX_LOCAL_COMPLIANCE_WRITES = 64;
export const MAX_LOCAL_COMPLIANCE_SLOTS = 16;
export const MAX_LOCAL_COMPLIANCE_MARKUP_PATTERNS = 16;
export const MAX_LOCAL_COMPLIANCE_SELECTOR_LENGTH = 512;
export const MAX_LOCAL_COMPLIANCE_EXPRESSION_LENGTH = 2048;
export const MAX_LOCAL_COMPLIANCE_ERROR_PATTERNS = 16;
export const MAX_LOCAL_COMPLIANCE_ARRAY_LENGTH = 10_000;

export type LocalComplianceStatus = 'passed' | 'failed' | 'skipped' | 'unsupported';
export type LocalComplianceCapability = 'interactive' | 'static' | 'ssr' | 'offline';
export type LocalComplianceSuite = 'manifest' | 'behavior' | 'react' | 'browser';

/** Scalar or flat collection value used by specs and observed results. */
export type LocalComplianceValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly number[];

export interface LocalComplianceDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface LocalComplianceCaseResult {
  readonly id: string;
  readonly suite: LocalComplianceSuite;
  readonly status: LocalComplianceStatus;
  /** Short human explanation, especially for skipped/unsupported cases. */
  readonly message?: string;
  readonly diagnostics: readonly LocalComplianceDiagnostic[];
  /**
   * Capabilities this passed case is evidence for. Failed, skipped and
   * unsupported cases may carry it to explain what is missing, but only a
   * passed case satisfies a declared capability.
   */
  readonly capabilities?: readonly LocalComplianceCapability[];
  /** Bounded values used by parity comparisons. */
  readonly observed?: Readonly<Record<string, LocalComplianceValue>>;
}

export interface LocalComplianceComponentRef {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface LocalComplianceSuiteResult {
  readonly protocol: typeof LOCAL_COMPLIANCE_PROTOCOL;
  readonly suite: LocalComplianceSuite;
  readonly configKey: string;
  readonly component: LocalComplianceComponentRef | null;
  readonly cases: readonly LocalComplianceCaseResult[];
}

export interface LocalCapabilityEvidence {
  readonly capability: LocalComplianceCapability;
  readonly status: LocalComplianceStatus;
  readonly cases: readonly string[];
  readonly reason?: string;
}

export interface LocalComplianceSummary {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly unsupported: number;
}

export interface LocalComplianceReport {
  readonly protocol: typeof LOCAL_COMPLIANCE_PROTOCOL;
  readonly ok: boolean;
  /** True only when every declared capability has executed evidence. */
  readonly complete: boolean;
  readonly configKey: string;
  readonly component: LocalComplianceComponentRef | null;
  readonly capabilities: readonly LocalCapabilityEvidence[];
  readonly cases: readonly LocalComplianceCaseResult[];
  readonly summary: LocalComplianceSummary;
  readonly diagnostics: readonly LocalComplianceDiagnostic[];
}

/* ------------------------------------------------------------ behavior spec */

export interface LocalBehaviorWriteSpec {
  /** Stable id used in reports and parity comparisons. */
  readonly id?: string;
  /** Single-slot write target; defaults to the main `value` slot. */
  readonly slot?: string;
  readonly value?: LocalComplianceValue;
  /** Atomic multi-slot write keyed by declared slot name. */
  readonly values?: Readonly<Record<string, LocalComplianceValue>>;
  /** Whether the runtime must accept the write. */
  readonly accepted: boolean;
  /** Optional expected public parameter values after the write. */
  readonly expect?: Readonly<Record<string, LocalComplianceValue>>;
}

export interface LocalBehaviorSpec {
  readonly protocol: typeof LOCAL_BEHAVIOR_SPEC_PROTOCOL;
  /** Tag name of the component under test. */
  readonly component: string;
  readonly source: string;
  /** Public binding name; defaults to the component's main binding. */
  readonly binding?: string;
  readonly writes?: readonly LocalBehaviorWriteSpec[];
  /** Require a reset after the writes (default true when a binding exists). */
  readonly reset?: boolean;
}

export interface LocalComplianceReportInput {
  readonly config: unknown;
  readonly component: string | LocalComplianceComponentRef;
  readonly suites: readonly LocalComplianceSuiteResult[];
  /** Overrides the manifest's declared capabilities for partial runs. */
  readonly capabilities?: readonly LocalComplianceCapability[];
  /** Defaults to true: every declared capability needs a passed case. */
  readonly requireCapabilities?: boolean;
}

export interface LocalComplianceParityMismatch {
  readonly case: string;
  readonly message: string;
}

export interface LocalComplianceParityResult {
  readonly ok: boolean;
  readonly mismatches: readonly LocalComplianceParityMismatch[];
}
