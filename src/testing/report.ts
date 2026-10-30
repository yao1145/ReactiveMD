import { readLocalConfig } from '../sdk/config';
import { localComponentDigest } from '../sdk/manifest';
import { getLocalComponentRegistry } from '../sdk/registry';
import type { LocalComponentDefinition } from '../sdk/types';
import { failed, localCase } from './cases';
import {
  LOCAL_COMPLIANCE_PROTOCOL,
  type LocalCapabilityEvidence,
  type LocalComplianceCapability,
  type LocalComplianceCaseResult,
  type LocalComplianceComponentRef,
  type LocalComplianceDiagnostic,
  type LocalComplianceParityMismatch,
  type LocalComplianceParityResult,
  type LocalComplianceReport,
  type LocalComplianceReportInput,
  type LocalComplianceStatus,
  type LocalComplianceSuiteResult,
  type LocalComplianceSummary,
} from './types';
import { readErrorMessage, sameComplianceRecord } from './values';

const CAPABILITY_ORDER: readonly LocalComplianceCapability[] = ['interactive', 'static', 'ssr', 'offline'];
const CAPABILITY_SET = new Set<string>(CAPABILITY_ORDER);
const STATUS_SET = new Set<string>(['passed', 'failed', 'skipped', 'unsupported']);
const SUITE_SET = new Set<string>(['manifest', 'behavior', 'react', 'browser']);

function componentRef(definition: LocalComponentDefinition): LocalComplianceComponentRef {
  return Object.freeze({ id: definition.id, name: definition.name, version: definition.version });
}

function declaredCapabilities(definition: LocalComponentDefinition): readonly LocalComplianceCapability[] {
  return Object.freeze(CAPABILITY_ORDER.filter((capability) => definition.capabilities[capability] === true));
}

function readCapabilityList(value: unknown, path: string): readonly LocalComplianceCapability[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  const seen = new Set<string>();
  const out: LocalComplianceCapability[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !CAPABILITY_SET.has(entry)) {
      throw new TypeError(`${path} contains an unknown capability.`);
    }
    if (seen.has(entry)) throw new TypeError(`${path} repeats "${entry}".`);
    seen.add(entry);
    out.push(entry as LocalComplianceCapability);
  }
  return Object.freeze(out);
}

function readSuites(value: unknown): readonly LocalComplianceSuiteResult[] {
  if (!Array.isArray(value)) throw new TypeError('report.suites must be an array.');
  if (value.length > 16) throw new TypeError('report.suites accepts at most 16 suites.');
  for (let index = 0; index < value.length; index += 1) {
    const suite = value[index] as Partial<LocalComplianceSuiteResult> | null;
    if (!suite || typeof suite !== 'object' || Array.isArray(suite)) {
      throw new TypeError(`report.suites[${index}] must be a suite result.`);
    }
    if (suite.protocol !== LOCAL_COMPLIANCE_PROTOCOL) {
      throw new TypeError(`report.suites[${index}] has an unsupported protocol.`);
    }
    if (typeof suite.suite !== 'string' || !SUITE_SET.has(suite.suite)) {
      throw new TypeError(`report.suites[${index}] has an unknown suite name.`);
    }
    if (!Array.isArray(suite.cases) || suite.cases.length > 512) {
      throw new TypeError(`report.suites[${index}].cases must be an array.`);
    }
    for (const item of suite.cases) {
      if (!item || typeof item.id !== 'string' || typeof item.status !== 'string' || !STATUS_SET.has(item.status)) {
        throw new TypeError(`report.suites[${index}] contains an invalid case.`);
      }
    }
  }
  return value as readonly LocalComplianceSuiteResult[];
}

function mergeCases(
  suites: readonly LocalComplianceSuiteResult[],
): LocalComplianceCaseResult[] {
  const merged: LocalComplianceCaseResult[] = [];
  const seen = new Set<string>();
  for (const suite of suites) {
    for (const item of suite.cases) {
      if (seen.has(item.id)) {
        merged.push(failed('report.duplicate-case', 'manifest',
          `Case id "${item.id}" appears more than once; evidence is ambiguous.`));
        continue;
      }
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

function capabilityEvidence(
  capability: LocalComplianceCapability,
  cases: readonly LocalComplianceCaseResult[],
): LocalCapabilityEvidence {
  const related = cases.filter((item) => item.capabilities?.includes(capability));
  const passedCases = related.filter((item) => item.status === 'passed');
  if (passedCases.length > 0) {
    return Object.freeze({
      capability,
      status: 'passed' as const,
      cases: Object.freeze(passedCases.map((item) => item.id)),
    });
  }
  let status: LocalComplianceStatus = 'unsupported';
  if (related.some((item) => item.status === 'failed')) status = 'failed';
  else if (related.some((item) => item.status === 'unsupported')) status = 'unsupported';
  else if (related.some((item) => item.status === 'skipped')) status = 'skipped';
  const reason = related.length === 0
    ? `No compliance suite executed a case for "${capability}".`
    : `Declared capability "${capability}" has no passed evidence (${status}).`;
  return Object.freeze({
    capability,
    status,
    cases: Object.freeze(related.map((item) => item.id)),
    reason,
  });
}

function summarize(cases: readonly LocalComplianceCaseResult[]): LocalComplianceSummary {
  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let unsupportedCount = 0;
  for (const item of cases) {
    if (item.status === 'passed') passedCount += 1;
    else if (item.status === 'failed') failedCount += 1;
    else if (item.status === 'skipped') skippedCount += 1;
    else unsupportedCount += 1;
  }
  return Object.freeze({
    passed: passedCount,
    failed: failedCount,
    skipped: skippedCount,
    unsupported: unsupportedCount,
  });
}

function collectDiagnostics(
  cases: readonly LocalComplianceCaseResult[],
  capabilityEvidenceList: readonly LocalCapabilityEvidence[],
): readonly LocalComplianceDiagnostic[] {
  const out: LocalComplianceDiagnostic[] = [];
  const seen = new Set<string>();
  const add = (diagnostic: LocalComplianceDiagnostic): void => {
    const key = `${diagnostic.code}\u0000${diagnostic.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(diagnostic);
  };
  for (const item of cases) {
    if (item.status !== 'failed') continue;
    if (item.diagnostics.length === 0) {
      add({ code: 'testing.case-failed', message: item.message ?? item.id });
      continue;
    }
    for (const diagnostic of item.diagnostics) add(diagnostic);
  }
  for (const evidence of capabilityEvidenceList) {
    if (evidence.status === 'passed') continue;
    add({
      code: 'testing.capability-evidence',
      message: evidence.reason ?? `No passed evidence for capability "${evidence.capability}".`,
    });
  }
  return Object.freeze(out);
}

/**
 * Aggregate suite results into one report.
 *
 * A declared capability is satisfied only by a passed case that names it.
 * Missing suites therefore produce an explicit unsupported/skipped evidence
 * entry and, by default, make the report fail. Callers can pass an explicit
 * capability subset for an intentionally partial run.
 */
export function createLocalComplianceReport(input: LocalComplianceReportInput): LocalComplianceReport {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('createLocalComplianceReport requires an options object.');
  }
  const config = readLocalConfig(input.config);
  const registry = getLocalComponentRegistry(config);
  let definition: LocalComponentDefinition | undefined;
  let requested: string;
  if (typeof input.component === 'string') {
    requested = input.component;
    definition = registry.find((item) => item.name === input.component);
  } else {
    const component = input.component;
    requested = component.id;
    definition = registry.find((item) => item.id === component.id || item.name === component.name);
  }
  if (!definition) {
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      ok: false,
      complete: false,
      configKey: config.key,
      component: null,
      capabilities: Object.freeze([]),
      cases: Object.freeze([]),
      summary: Object.freeze({ passed: 0, failed: 0, skipped: 0, unsupported: 0 }),
      diagnostics: Object.freeze([{
        code: 'testing.component-missing',
        message: `Component "${requested}" is not installed in this configuration.`,
      }]),
    });
  }

  const suites = readSuites(input.suites);
  const validSuites: LocalComplianceSuiteResult[] = [];
  const mismatches: LocalComplianceCaseResult[] = [];
  for (const [index, suite] of suites.entries()) {
    const component = suite.component;
    const expectedKey = suite.suite === 'manifest' ? localComponentDigest(definition) : config.key;
    if (!component || component.id !== definition.id || component.name !== definition.name
      || component.version !== definition.version || suite.configKey !== expectedKey) {
      mismatches.push(failed(`report.suite-contract.${index}`, 'manifest', 'Suite evidence belongs to another component, version or configuration.',
        [{ code: 'testing.suite-contract', message: 'Run the suite with the same installed component and configuration.' }]));
    } else validSuites.push(suite);
  }
  const cases = [...mergeCases(validSuites), ...mismatches];
  const required = input.capabilities === undefined
    ? declaredCapabilities(definition)
    : readCapabilityList(input.capabilities, 'report.capabilities');
  const requiredSet = new Set(required);
  const evidence = CAPABILITY_ORDER
    .filter((capability) => requiredSet.has(capability))
    .map((capability) => capabilityEvidence(capability, cases));
  const requireCapabilities = input.requireCapabilities !== false;
  const missing = requireCapabilities ? evidence.filter((item) => item.status !== 'passed') : [];
  const hasFailedCase = cases.some((item) => item.status === 'failed');
  const diagnostics = collectDiagnostics(cases, missing);

  return Object.freeze({
    protocol: LOCAL_COMPLIANCE_PROTOCOL,
    ok: !hasFailedCase && missing.length === 0,
    complete: !hasFailedCase && requireCapabilities && declaredCapabilities(definition).every(capability =>
      requiredSet.has(capability) && evidence.some(item => item.capability === capability && item.status === 'passed')),
    configKey: config.key,
    component: componentRef(definition),
    capabilities: Object.freeze(evidence),
    cases: Object.freeze(cases),
    summary: summarize(cases),
    diagnostics,
  });
}

/**
 * Compare two suite results case by case. Case ids and observed values are
 * stable, so a built-in component and an external alias of the same contract
 * must produce the same statuses and observed parameter values.
 */
export function compareLocalComplianceParity(
  left: LocalComplianceSuiteResult,
  right: LocalComplianceSuiteResult,
): LocalComplianceParityResult {
  const leftCases = new Map(left.cases.map((item) => [item.id, item]));
  const rightCases = new Map(right.cases.map((item) => [item.id, item]));
  const ids = [...new Set([...leftCases.keys(), ...rightCases.keys()])].sort();
  const mismatches: LocalComplianceParityMismatch[] = [];
  for (const id of ids) {
    const a = leftCases.get(id);
    const b = rightCases.get(id);
    if (!a || !b) {
      mismatches.push(Object.freeze({
        case: id,
        message: `Case "${id}" exists only in the ${a ? 'left' : 'right'} result.`,
      }));
      continue;
    }
    if (a.status !== b.status) {
      mismatches.push(Object.freeze({
        case: id,
        message: `Status differs: ${a.status} vs ${b.status}.`,
      }));
      continue;
    }
    const leftCapabilities = [...(a.capabilities ?? [])].sort().join(',');
    const rightCapabilities = [...(b.capabilities ?? [])].sort().join(',');
    if (leftCapabilities !== rightCapabilities) {
      mismatches.push(Object.freeze({
        case: id,
        message: `Capability evidence differs: [${leftCapabilities}] vs [${rightCapabilities}].`,
      }));
      continue;
    }
    if (!sameComplianceRecord(a.observed ?? {}, b.observed ?? {})) {
      mismatches.push(Object.freeze({
        case: id,
        message: 'Observed values differ.',
      }));
    }
  }
  return Object.freeze({
    ok: mismatches.length === 0,
    mismatches: Object.freeze(mismatches),
  });
}

/** Exposed for hosts that want one-line diagnostics without reading cases. */
export function describeLocalComplianceCase(item: LocalComplianceCaseResult): string {
  const message = item.message ?? item.diagnostics.map((diagnostic) => diagnostic.message).join(' ');
  return message ? `${item.id}: ${message}` : item.id;
}

/** Defensive helper used by adapters that catch asynchronous errors. */
export function localErrorCase(
  id: string,
  suite: LocalComplianceSuiteResult['suite'],
  error: unknown,
): LocalComplianceCaseResult {
  const message = readErrorMessage(error);
  return localCase({
    id,
    suite,
    status: 'failed',
    message,
    diagnostics: [{ code: 'testing.suite-error', message }],
  });
}
