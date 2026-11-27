import manifest from '../../package.json';
import { LOCAL_COMPONENT_PROTOCOL, LOCAL_SDK_VERSION } from '../sdk/version';
import { LOCAL_THEME_PROTOCOL } from '../themes/document-theme';
import { LOCAL_SYNTAX_VERSION, type Diagnostic } from './types';
import { localSourceDigest } from '../runtime-services/identity';
import { formatObservabilityMessage, type LocalObservabilityMessageKey } from './observability-messages';
import { MAX_LOCAL_DIAGNOSTICS } from '../contracts/limits';
import { isLocalDiagnosticCode, localDiagnosticTemplate } from './configuration/diagnostics';
import { isReportOnlyDiagnosticCode } from './observability-codes';
import type { LocalTraceEvent } from './observability-core';
export { createLocalTraceId, emitLocalDiagnostic, emitLocalTrace } from './observability-core';
export type { LocalObserver, LocalTraceEvent } from './observability-core';

export interface LocalDiagnosticReport {
  schema: 'reactive-md-diagnostic/v1';
  generatedAt: string;
  traceId?: string;
  package: { engine: string; sdk: string; syntax: string; component: string; theme: string; editor?: string; react?: string; vite?: string };
  environment: { runtime: 'browser' | 'node' | 'worker'; userAgent?: string; node?: string; platform?: string };
  document: { sourceBytes: number; sourceDigest: string; sourceRevision?: string };
  diagnostics: readonly (Pick<Diagnostic, 'code' | 'severity' | 'range'>
    & Partial<Pick<Diagnostic, 'phase' | 'recoverable' | 'line' | 'column' | 'messageKey' | 'details'>>)[];
  events?: readonly LocalTraceEvent[];
}

export interface DiagnosticReportOptions {
  traceId?: string;
  sourceRevision?: string;
  package?: Partial<LocalDiagnosticReport['package']>;
  diagnostics?: readonly Diagnostic[];
  events?: readonly LocalTraceEvent[];
}

export function createLocalObservabilityDiagnostic(
  code: LocalObservabilityMessageKey,
  details: NonNullable<Diagnostic['details']> = {},
): Diagnostic {
  return {
    code,
    phase: code.startsWith('local.worker.') ? 'worker' : code.startsWith('local.export.') ? 'export' : 'resource',
    severity: code === 'local.worker.stale-response' ? 'warning' : 'error',
    recoverable: true,
    messageKey: code,
    message: formatObservabilityMessage(code, 'en', details),
    details,
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
  };
}

const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+/@-]{0,63}$/;
const SAFE_DIAGNOSTIC_DETAILS = new Set([
  'budget', 'limit', 'actual', 'unit', 'timeoutMs', 'requestId', 'sourceRevision', 'currentRevision', 'stage', 'format', 'mode',
]);
const SAFE_UNITS = new Set(['bytes', 'nodes', 'files', 'depth', 'steps', 'work', 'codeUnits']);
const SAFE_STAGES = new Set(['compile', 'assets', 'bundle', 'render', 'download', 'pdf']);
const SAFE_EVENT_TYPES = new Set<LocalTraceEvent['type']>([
  'compile-start', 'compile-end', 'worker-request', 'worker-response', 'worker-timeout',
  'worker-stale-response', 'worker-cancel', 'worker-error', 'export-start', 'export-end',
  'export-cancel', 'export-error',
  'worker-spawn', 'worker-ready', 'worker-warmup', 'component-load-start', 'component-load-end', 'render-mount', 'render-unmount',
]);
const SAFE_COMPONENT_NAME = /^[a-z][a-z0-9-]{0,63}$/;

function reportDetails(details: Diagnostic['details']): Diagnostic['details'] | undefined {
  if (!details) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_DIAGNOSTIC_DETAILS.has(key)) continue;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
    else if (key === 'unit' && typeof value === 'string' && SAFE_UNITS.has(value)) safe[key] = value;
    else if ((key === 'stage' && typeof value === 'string' && SAFE_STAGES.has(value))
      || (key === 'budget' && typeof value === 'string' && SAFE_CODE.test(value))
      || (key === 'format' && (value === 'html' || value === 'pdf'))
      || (key === 'mode' && (value === 'interactive' || value === 'static'))) safe[key] = value;
    if (Object.keys(safe).length >= 12) break;
  }
  return Object.keys(safe).length ? safe : undefined;
}

/** `detail` stays observer-only free text and is never copied into a report. */
function safeEvent(event: LocalTraceEvent): LocalTraceEvent | undefined {
  if (!event || !SAFE_ID.test(event.traceId) || !SAFE_EVENT_TYPES.has(event.type)
    || !Number.isSafeInteger(event.timestamp) || event.timestamp < 0) return undefined;
  const code = typeof event.code === 'string' && SAFE_CODE.test(event.code) ? event.code : undefined;
  const stage = typeof event.stage === 'string' && SAFE_STAGES.has(event.stage) ? event.stage : undefined;
  const status = typeof event.status === 'string' && /^(?:ok|failed|stale|timeout|disposed|fallback|retry|cancelled|printed|ready|degraded|superseded|budget-rejected|worker-failed)$/.test(event.status)
    ? event.status : undefined;
  return {
    type: event.type,
    traceId: event.traceId.slice(0, 96),
    ...(Number.isSafeInteger(event.requestId) && (event.requestId ?? -1) >= 0 ? { requestId: event.requestId } : {}),
    ...(Number.isSafeInteger(event.sourceRevision) && (event.sourceRevision ?? -1) >= 0 ? { sourceRevision: event.sourceRevision } : {}),
    ...(typeof event.documentId === 'string' && SAFE_ID.test(event.documentId) ? { documentId: event.documentId } : {}),
    ...(Number.isSafeInteger(event.workerId) && (event.workerId ?? -1) >= 0 ? { workerId: event.workerId } : {}),
    ...(typeof event.componentName === 'string' && SAFE_COMPONENT_NAME.test(event.componentName) ? { componentName: event.componentName } : {}),
    ...(typeof event.componentVersion === 'string' && SAFE_VERSION.test(event.componentVersion) ? { componentVersion: event.componentVersion } : {}),
    ...(Number.isSafeInteger(event.subscribers) && (event.subscribers ?? -1) >= 0 ? { subscribers: event.subscribers } : {}),
    ...(event.environment === 'development' || event.environment === 'production' ? { environment: event.environment } : {}),
    timestamp: event.timestamp,
    ...(Number.isSafeInteger(event.durationMs) && (event.durationMs ?? -1) >= 0 ? { durationMs: event.durationMs } : {}),
    ...(Number.isSafeInteger(event.parseMs) && (event.parseMs ?? -1) >= 0 ? { parseMs: event.parseMs } : {}),
    ...(Number.isSafeInteger(event.semanticMs) && (event.semanticMs ?? -1) >= 0 ? { semanticMs: event.semanticMs } : {}),
    ...(code ? { code } : {}), ...(status ? { status } : {}), ...(stage ? { stage } : {}),
  };
}

/** Copy an explicitly allowlisted, bounded field set. Free text can contain source. */
export function createDiagnosticReport(source: string, options: DiagnosticReportOptions = {}): LocalDiagnosticReport {
  if (typeof source !== 'string') {
    throw new TypeError('Diagnostic reports require a source string.');
  }
  const workerGlobal = typeof self !== 'undefined' && typeof (self as unknown as { importScripts?: unknown }).importScripts === 'function';
  const runtime = workerGlobal ? 'worker' : typeof window !== 'undefined' ? 'browser' : 'node';
  const nodeEnvironment = (globalThis as { process?: { versions?: { node?: string }; platform?: string } }).process;
  const environment: LocalDiagnosticReport['environment'] = { runtime };
  if (runtime === 'node') {
    if (nodeEnvironment?.versions?.node) environment.node = nodeEnvironment.versions.node.slice(0, 64);
    if (nodeEnvironment?.platform) environment.platform = nodeEnvironment.platform.slice(0, 64);
  } else if (typeof navigator !== 'undefined') {
    environment.userAgent = navigator.userAgent.slice(0, 512);
    environment.platform = navigator.platform.slice(0, 64);
  }
  const safePackage = Object.fromEntries(Object.entries(options.package ?? {}).filter(([key, value]) =>
    ['editor', 'react', 'vite'].includes(key) && typeof value === 'string' && SAFE_VERSION.test(value),
  ));
  const safeDiagnostics = (Array.isArray(options.diagnostics) ? options.diagnostics : []).slice(0, Math.min(MAX_LOCAL_DIAGNOSTICS, 1_000))
    .flatMap((diagnostic) => {
      if (!diagnostic || !(isLocalDiagnosticCode(diagnostic.code) || isReportOnlyDiagnosticCode(diagnostic.code))
        || (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning')
        || !diagnostic.range || !Number.isSafeInteger(diagnostic.range.start) || !Number.isSafeInteger(diagnostic.range.end)) return [];
      const start = Math.max(0, Math.min(source.length, diagnostic.range.start));
      const end = Math.max(start, Math.min(source.length, diagnostic.range.end));
      const line = Number.isSafeInteger(diagnostic.line) && diagnostic.line > 0 ? diagnostic.line : undefined;
      const column = Number.isSafeInteger(diagnostic.column) && diagnostic.column > 0 ? diagnostic.column : undefined;
      const details = reportDetails(diagnostic.details);
      const phase = diagnostic.phase && ['source', 'parse', 'semantic', 'runtime', 'worker', 'resource', 'export', 'host'].includes(diagnostic.phase)
        ? diagnostic.phase : undefined;
      return [{
        code: diagnostic.code,
        severity: diagnostic.severity,
        ...(phase ? { phase } : {}),
        ...(typeof diagnostic.recoverable === 'boolean' ? { recoverable: diagnostic.recoverable } : {}),
        range: { start, end }, ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }),
        ...(typeof diagnostic.messageKey === 'string' && localDiagnosticTemplate(diagnostic.messageKey) !== undefined
          ? { messageKey: diagnostic.messageKey } : {}),
        ...(details ? { details } : {}),
      }];
    });
  const safeTraceId = options.traceId && SAFE_ID.test(options.traceId) ? options.traceId : undefined;
  const safeRevision = typeof options.sourceRevision === 'string' && SAFE_ID.test(options.sourceRevision) ? options.sourceRevision : undefined;
  const safeEvents = (Array.isArray(options.events) ? options.events : []).slice(-50).flatMap(event => {
    const safe = safeEvent({ ...event, type: event?.type?.slice(0, 64), traceId: event?.traceId?.slice(0, 96), status: event?.status?.slice(0, 32), stage: event?.stage?.slice(0, 32), code: event?.code?.slice(0, 128) });
    return safe ? [safe] : [];
  });
  const report: LocalDiagnosticReport = {
    schema: 'reactive-md-diagnostic/v1',
    generatedAt: new Date().toISOString(),
    ...(safeTraceId ? { traceId: safeTraceId } : {}),
    package: {
      engine: manifest.version,
      sdk: LOCAL_SDK_VERSION,
      syntax: LOCAL_SYNTAX_VERSION,
      component: LOCAL_COMPONENT_PROTOCOL,
      theme: LOCAL_THEME_PROTOCOL,
      ...safePackage,
    },
    environment,
    document: { sourceBytes: new TextEncoder().encode(source).byteLength, sourceDigest: localSourceDigest(source), ...(safeRevision ? { sourceRevision: safeRevision } : {}) },
    diagnostics: safeDiagnostics,
    ...(safeEvents.length ? { events: safeEvents } : {}),
  };
  while (new TextEncoder().encode(JSON.stringify(report)).byteLength > 64 * 1024) {
    if (report.events?.length) report.events = report.events.slice(1);
    else if (report.diagnostics.length) report.diagnostics = report.diagnostics.slice(0, -1);
    else throw new RangeError('The diagnostic report exceeded its size limit.');
  }
  return report;
}
