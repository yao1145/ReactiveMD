/**
 * Public, framework-neutral component compliance tools.
 *
 * This entry has no React, DOM or browser dependency. It validates manifests
 * and executes real compiler/runtime behavior for scalar, named and collection
 * bindings. Rendering evidence lives in `reactive-md/testing/react` and
 * `reactive-md/testing/browser`.
 */

export {
  LOCAL_COMPLIANCE_PROTOCOL,
  LOCAL_BEHAVIOR_SPEC_PROTOCOL,
  LOCAL_REACT_SPEC_PROTOCOL,
  LOCAL_BROWSER_SPEC_PROTOCOL,
  MAX_LOCAL_COMPLIANCE_CASES,
  MAX_LOCAL_COMPLIANCE_SOURCE_LENGTH,
  MAX_LOCAL_COMPLIANCE_STRING_LENGTH,
  MAX_LOCAL_COMPLIANCE_WRITES,
  MAX_LOCAL_COMPLIANCE_SLOTS,
  MAX_LOCAL_COMPLIANCE_MARKUP_PATTERNS,
  MAX_LOCAL_COMPLIANCE_SELECTOR_LENGTH,
  MAX_LOCAL_COMPLIANCE_EXPRESSION_LENGTH,
  MAX_LOCAL_COMPLIANCE_ERROR_PATTERNS,
  MAX_LOCAL_COMPLIANCE_ARRAY_LENGTH,
} from './types';
export type {
  LocalBehaviorSpec,
  LocalBehaviorWriteSpec,
  LocalCapabilityEvidence,
  LocalComplianceCapability,
  LocalComplianceCaseResult,
  LocalComplianceComponentRef,
  LocalComplianceDiagnostic,
  LocalComplianceParityMismatch,
  LocalComplianceParityResult,
  LocalComplianceReport,
  LocalComplianceReportInput,
  LocalComplianceStatus,
  LocalComplianceSuite,
  LocalComplianceSuiteResult,
  LocalComplianceSummary,
  LocalComplianceValue,
} from './types';

export { readLocalBehaviorSpec, runLocalBehaviorCompliance } from './behavior';
export { runLocalManifestCompliance } from './manifest';
export {
  compareLocalComplianceParity,
  createLocalComplianceReport,
  describeLocalComplianceCase,
} from './report';
