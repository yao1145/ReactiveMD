import { readLocalConfig } from '../sdk/config';
import { getLocalComponentRegistry } from '../sdk/registry';
import type { LocalConfig } from '../sdk/types';
import { failed, passed, skipped } from './cases';
import {
  LOCAL_BROWSER_SPEC_PROTOCOL,
  LOCAL_COMPLIANCE_PROTOCOL,
  MAX_LOCAL_COMPLIANCE_CASES,
  MAX_LOCAL_COMPLIANCE_ERROR_PATTERNS,
  MAX_LOCAL_COMPLIANCE_EXPRESSION_LENGTH,
  MAX_LOCAL_COMPLIANCE_SELECTOR_LENGTH,
  MAX_LOCAL_COMPLIANCE_STRING_LENGTH,
  type LocalComplianceCaseResult,
  type LocalComplianceSuiteResult,
  type LocalComplianceValue,
} from './types';
import {
  checkKeys,
  readBoolean,
  readCaseId,
  readComplianceValue,
  readErrorMessage,
  readInteger,
  readString,
  readStringList,
  requireRecord,
  sameComplianceValue,
} from './values';

/**
 * Portable browser driver contract.
 *
 * A driver may adapt Playwright, WebDriver, a remote grid or an in-process DOM.
 * The compliance runner only sees these bounded operations; it never imports a
 * browser framework.
 */
export interface LocalBrowserPageDriver {
  goto(url: string): Promise<void>;
  reload(): Promise<void>;
  waitFor(selector: string, timeoutMs: number): Promise<void>;
  count(selector: string): Promise<number>;
  text(selector: string): Promise<string | null>;
  attribute(selector: string, name: string): Promise<string | null>;
  visible(selector: string): Promise<boolean>;
  enabled(selector: string): Promise<boolean>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  evaluate<T = unknown>(expression: string): Promise<T>;
}

export interface LocalBrowserSessionDriver {
  readonly page: LocalBrowserPageDriver;
  readonly errors: readonly string[];
  readonly requests: readonly string[];
  readonly offline: boolean;
  close(): Promise<void>;
}

export interface LocalBrowserOpenOptions {
  readonly url: string;
  readonly offline: boolean;
  readonly javaScriptEnabled?: boolean;
  readonly timeoutMs: number;
}

export interface LocalBrowserDriver {
  readonly name: string;
  open(options: LocalBrowserOpenOptions): Promise<LocalBrowserSessionDriver>;
}

export type LocalBrowserPhase =
  | 'mount'
  | 'hydration'
  | 'edit'
  | 'hide-show'
  | 'disabled'
  | 'reset'
  | 'descendant-error'
  | 'unmount';

export type LocalBrowserCaseKind =
  | 'visible'
  | 'text'
  | 'attribute'
  | 'count'
  | 'enabled'
  | 'wait'
  | 'click'
  | 'fill'
  | 'press'
  | 'evaluate'
  | 'isolation'
  | 'unmount';

export interface LocalBrowserCase {
  readonly id: string;
  readonly phase: LocalBrowserPhase;
  readonly kind: LocalBrowserCaseKind;
  readonly selector?: string;
  readonly name?: string;
  readonly value?: string;
  readonly key?: string;
  readonly expression?: string;
  readonly expected?: LocalComplianceValue;
  readonly trigger?: string;
  readonly placeholder?: string;
  readonly survivor?: string;
}

export interface LocalBrowserSpec {
  readonly protocol: typeof LOCAL_BROWSER_SPEC_PROTOCOL;
  /** A local file: or data: URL. Offline compliance must never use the network. */
  readonly url: string;
  readonly offline: boolean;
  readonly javaScriptEnabled?: boolean;
  readonly timeoutMs?: number;
  readonly cases: readonly LocalBrowserCase[];
  /** Error substrings a descendant-error phase may legitimately emit. */
  readonly expectedErrors?: readonly string[];
  /** Defaults to a built-in unmount hook, then removing the document root. */
  readonly unmountExpression?: string;
  /** Phases the report must prove; defaults to the full lifecycle. */
  readonly requiredPhases?: readonly LocalBrowserPhase[];
}

export interface LocalBrowserComplianceOptions {
  readonly driver: LocalBrowserDriver;
  readonly spec: LocalBrowserSpec | unknown;
  /** Optional: used for the report's config key and component identity. */
  readonly config?: LocalConfig | unknown;
  readonly component?: string;
}

const SPEC_KEYS = new Set([
  'protocol', 'url', 'offline', 'javaScriptEnabled', 'timeoutMs', 'cases',
  'expectedErrors', 'unmountExpression', 'requiredPhases',
]);
const CASE_KEYS = new Set([
  'id', 'phase', 'kind', 'selector', 'name', 'value', 'key', 'expression',
  'expected', 'trigger', 'placeholder', 'survivor',
]);
const PHASES: readonly LocalBrowserPhase[] = [
  'mount', 'hydration', 'edit', 'hide-show', 'disabled', 'reset',
  'descendant-error', 'unmount',
];
const PHASE_SET = new Set<string>(PHASES);
const LIFECYCLE_PHASES: readonly LocalBrowserPhase[] = [
  'mount', 'edit', 'hide-show', 'disabled', 'reset', 'descendant-error', 'unmount',
];
const KINDS = new Set<string>([
  'visible', 'text', 'attribute', 'count', 'enabled', 'wait', 'click', 'fill',
  'press', 'evaluate', 'isolation', 'unmount',
]);
const DEFAULT_UNMOUNT = `(() => {
  const hook = globalThis.__reactiveMdTestUnmount;
  if (typeof hook === 'function') { hook(); return true; }
  const root = document.querySelector('#reactive-md-document, reactive-md-doc');
  if (root && root.parentNode) { root.remove(); return true; }
  return false;
})()`;

function readSelector(value: unknown, path: string): string {
  const selector = readString(value, path, MAX_LOCAL_COMPLIANCE_SELECTOR_LENGTH);
  if (selector.trim() === '') throw new TypeError(`${path} must not be empty.`);
  if (/[\u0000\r\n]/.test(selector)) throw new TypeError(`${path} contains an unsupported character.`);
  return selector;
}

function readScalarExpected(value: unknown, path: string): LocalComplianceValue {
  const parsed = readComplianceValue(value, path);
  if (Array.isArray(parsed)) throw new TypeError(`${path} must be a scalar.`);
  return parsed;
}

function readBrowserCase(value: unknown, index: number, seen: Set<string>): LocalBrowserCase {
  const path = `spec.cases[${index}]`;
  const record = requireRecord(value, path);
  checkKeys(record, CASE_KEYS, path);
  const kind = readString(record.kind, `${path}.kind`, 32) as LocalBrowserCaseKind;
  if (!KINDS.has(kind)) throw new TypeError(`${path}.kind is not supported.`);
  const phase = readString(record.phase, `${path}.phase`, 32) as LocalBrowserPhase;
  if (!PHASE_SET.has(phase)) throw new TypeError(`${path}.phase is not supported.`);
  const id = readCaseId(record.id, `${path}.id`, seen, `browser.${index}.${kind}`);
  const base = { id, phase, kind };
  switch (kind) {
    case 'visible':
    case 'enabled': {
      if (typeof record.expected !== 'boolean') throw new TypeError(`${path}.expected must be a boolean.`);
      return Object.freeze({ ...base, selector: readSelector(record.selector, `${path}.selector`), expected: record.expected });
    }
    case 'text': {
      return Object.freeze({
        ...base,
        selector: readSelector(record.selector, `${path}.selector`),
        expected: readString(record.expected, `${path}.expected`, MAX_LOCAL_COMPLIANCE_STRING_LENGTH),
      });
    }
    case 'attribute': {
      const expected = record.expected;
      if (expected !== null && typeof expected !== 'string') {
        throw new TypeError(`${path}.expected must be a string or null.`);
      }
      return Object.freeze({
        ...base,
        selector: readSelector(record.selector, `${path}.selector`),
        name: readString(record.name, `${path}.name`, 128),
        expected: expected === null ? null : readString(expected, `${path}.expected`, MAX_LOCAL_COMPLIANCE_STRING_LENGTH),
      });
    }
    case 'count': {
      return Object.freeze({
        ...base,
        selector: readSelector(record.selector, `${path}.selector`),
        expected: readInteger(record.expected, `${path}.expected`, 0, 10_000),
      });
    }
    case 'wait':
    case 'click': {
      return Object.freeze({ ...base, selector: readSelector(record.selector, `${path}.selector`) });
    }
    case 'fill': {
      return Object.freeze({
        ...base,
        selector: readSelector(record.selector, `${path}.selector`),
        value: readString(record.value, `${path}.value`, MAX_LOCAL_COMPLIANCE_STRING_LENGTH),
      });
    }
    case 'press': {
      const key = readString(record.key, `${path}.key`, 32);
      if (key.trim() === '') throw new TypeError(`${path}.key must not be empty.`);
      return Object.freeze({ ...base, selector: readSelector(record.selector, `${path}.selector`), key });
    }
    case 'evaluate': {
      const expression = readString(record.expression, `${path}.expression`, MAX_LOCAL_COMPLIANCE_EXPRESSION_LENGTH);
      if (expression.trim() === '') throw new TypeError(`${path}.expression must not be empty.`);
      return Object.freeze({
        ...base,
        expression,
        expected: readScalarExpected(record.expected, `${path}.expected`),
      });
    }
    case 'isolation': {
      return Object.freeze({
        ...base,
        trigger: readSelector(record.trigger, `${path}.trigger`),
        placeholder: readSelector(record.placeholder, `${path}.placeholder`),
        survivor: readSelector(record.survivor, `${path}.survivor`),
      });
    }
    case 'unmount':
      return Object.freeze({ ...base });
    default:
      throw new TypeError(`${path}.kind is not supported.`);
  }
}

/** Validate a browser spec before opening a browser. */
export function readLocalBrowserSpec(value: unknown): LocalBrowserSpec {
  const record = requireRecord(value, 'spec');
  checkKeys(record, SPEC_KEYS, 'spec');
  if (record.protocol !== LOCAL_BROWSER_SPEC_PROTOCOL) {
    throw new TypeError(`spec.protocol must be "${LOCAL_BROWSER_SPEC_PROTOCOL}".`);
  }
  const url = readString(record.url, 'spec.url', 2048);
  if (!/^(?:file|data):/i.test(url)) {
    throw new TypeError('spec.url must be a local file: or data: URL.');
  }
  const offline = readBoolean(record.offline, 'spec.offline');
  const javaScriptEnabled = record.javaScriptEnabled === undefined
    ? undefined
    : readBoolean(record.javaScriptEnabled, 'spec.javaScriptEnabled');
  const timeoutMs = record.timeoutMs === undefined
    ? 5_000
    : readInteger(record.timeoutMs, 'spec.timeoutMs', 1_000, 60_000);
  if (!Array.isArray(record.cases)) throw new TypeError('spec.cases must be an array.');
  if (record.cases.length === 0) throw new TypeError('spec.cases must not be empty.');
  if (record.cases.length > MAX_LOCAL_COMPLIANCE_CASES) {
    throw new TypeError(`spec.cases accepts at most ${MAX_LOCAL_COMPLIANCE_CASES} entries.`);
  }
  const seen = new Set<string>();
  const cases = Object.freeze(record.cases.map((item, index) => readBrowserCase(item, index, seen)));
  const expectedErrors = record.expectedErrors === undefined
    ? undefined
    : readStringList(record.expectedErrors, 'spec.expectedErrors', MAX_LOCAL_COMPLIANCE_ERROR_PATTERNS);
  const unmountExpression = record.unmountExpression === undefined
    ? undefined
    : readString(record.unmountExpression, 'spec.unmountExpression', MAX_LOCAL_COMPLIANCE_EXPRESSION_LENGTH);
  let requiredPhases: readonly LocalBrowserPhase[] | undefined;
  if (record.requiredPhases !== undefined) {
    if (!Array.isArray(record.requiredPhases)) throw new TypeError('spec.requiredPhases must be an array.');
    const phases: LocalBrowserPhase[] = [];
    const phaseSeen = new Set<string>();
    for (const entry of record.requiredPhases) {
      if (typeof entry !== 'string' || !PHASE_SET.has(entry)) {
        throw new TypeError('spec.requiredPhases contains an unknown phase.');
      }
      if (phaseSeen.has(entry)) throw new TypeError(`spec.requiredPhases repeats "${entry}".`);
      phaseSeen.add(entry);
      phases.push(entry as LocalBrowserPhase);
    }
    requiredPhases = Object.freeze(phases);
  }
  return Object.freeze({
    protocol: LOCAL_BROWSER_SPEC_PROTOCOL,
    url,
    offline,
    ...(javaScriptEnabled === undefined ? {} : { javaScriptEnabled }),
    timeoutMs,
    cases,
    ...(expectedErrors === undefined ? {} : { expectedErrors }),
    ...(unmountExpression === undefined ? {} : { unmountExpression }),
    ...(requiredPhases === undefined ? {} : { requiredPhases }),
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms: ${label}`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

interface CaseOutcome {
  readonly issues: readonly string[];
  readonly observed?: Readonly<Record<string, LocalComplianceValue>>;
}

function scalarResult(value: unknown): LocalComplianceValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return Object.freeze(value.map((item) => item as string)) as readonly string[];
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return Object.freeze(value.map((item) => item as number)) as readonly number[];
  }
  return undefined;
}

async function executeCase(
  page: LocalBrowserPageDriver,
  item: LocalBrowserCase,
  timeoutMs: number,
  unmountExpression: string,
): Promise<CaseOutcome> {
  switch (item.kind) {
    case 'visible': {
      const actual = await page.visible(item.selector!);
      return actual === item.expected
        ? { issues: [], observed: { visible: actual } }
        : { issues: [`Expected ${item.selector} visible=${item.expected}, got ${actual}.`], observed: { visible: actual } };
    }
    case 'enabled': {
      const actual = await page.enabled(item.selector!);
      return actual === item.expected
        ? { issues: [], observed: { enabled: actual } }
        : { issues: [`Expected ${item.selector} enabled=${item.expected}, got ${actual}.`], observed: { enabled: actual } };
    }
    case 'text': {
      const raw = await page.text(item.selector!);
      if (raw === null) return { issues: [`No element matched ${item.selector}.`] };
      const actual = raw.trim();
      const expected = String(item.expected).trim();
      return actual === expected
        ? { issues: [], observed: { text: actual } }
        : { issues: [`Expected text ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`], observed: { text: actual } };
    }
    case 'attribute': {
      const actual = await page.attribute(item.selector!, item.name!);
      return actual === item.expected
        ? { issues: [], observed: { attribute: actual ?? null } }
        : { issues: [`Expected ${item.selector} [${item.name}] = ${JSON.stringify(item.expected)}, got ${JSON.stringify(actual)}.`], observed: { attribute: actual ?? null } };
    }
    case 'count': {
      const actual = await page.count(item.selector!);
      return actual === item.expected
        ? { issues: [], observed: { count: actual } }
        : { issues: [`Expected ${item.expected} matches for ${item.selector}, got ${actual}.`], observed: { count: actual } };
    }
    case 'wait':
      await page.waitFor(item.selector!, timeoutMs);
      return { issues: [] };
    case 'click':
      await page.click(item.selector!);
      return { issues: [] };
    case 'fill':
      await page.fill(item.selector!, item.value!);
      return { issues: [] };
    case 'press':
      await page.press(item.selector!, item.key!);
      return { issues: [] };
    case 'evaluate': {
      const raw: unknown = await page.evaluate(item.expression!);
      const actual = scalarResult(raw);
      if (actual === undefined) {
        return { issues: ['The evaluated expression did not return a bounded scalar.'] };
      }
      return sameComplianceValue(actual, item.expected)
        ? { issues: [], observed: { result: actual } }
        : { issues: [`Expected ${JSON.stringify(item.expected)}, got ${JSON.stringify(actual)}.`], observed: { result: actual } };
    }
    case 'isolation': {
      await page.click(item.trigger!);
      await page.waitFor(item.placeholder!, timeoutMs);
      const placeholder = await page.visible(item.placeholder!);
      const survivor = await page.visible(item.survivor!);
      const issues: string[] = [];
      if (!placeholder) issues.push(`The descendant error placeholder ${item.placeholder} is not visible.`);
      if (!survivor) issues.push(`The surviving sibling ${item.survivor} is not visible.`);
      return issues.length === 0
        ? { issues: [], observed: { placeholder, survivor } }
        : { issues, observed: { placeholder, survivor } };
    }
    case 'unmount': {
      const result: unknown = await page.evaluate(unmountExpression);
      return result === true
        ? { issues: [] }
        : { issues: ['The unmount expression did not return true.'] };
    }
    default:
      return { issues: [`Unknown case kind ${String(item.kind)}.`] };
  }
}

function assertionsIn(cases: readonly LocalComplianceCaseResult[], phase: LocalBrowserPhase, kinds: readonly LocalBrowserCaseKind[]): boolean {
  return cases.some((item) =>
    item.status === 'passed'
    && item.id.startsWith(`browser.${phase}.`)
    && kinds.some((kind) => item.id.startsWith(`browser.${phase}.${kind}`)));
}

function observationsFor(
  cases: readonly LocalComplianceCaseResult[],
  phase: LocalBrowserPhase,
  key: string,
): LocalComplianceValue[] {
  return cases
    .filter((item) => item.status === 'passed' && item.id.startsWith(`browser.${phase}.`))
    .map((item) => item.observed?.[key])
    .filter((value): value is LocalComplianceValue => value !== undefined);
}

function idIsKind(id: string, phase: LocalBrowserPhase, kinds: readonly LocalBrowserCaseKind[]): boolean {
  return kinds.some((kind) => id.startsWith(`browser.${phase}.${kind}`));
}

function actionThenAssertion(
  cases: readonly LocalComplianceCaseResult[],
  phase: LocalBrowserPhase,
): boolean {
  const ordered = cases.filter((item) => item.status === 'passed' && item.id.startsWith(`browser.${phase}.`));
  for (let index = 0; index < ordered.length; index += 1) {
    if (!idIsKind(ordered[index].id, phase, ['click', 'fill', 'press', 'evaluate'])) continue;
    if (ordered.slice(index + 1).some((item) =>
      idIsKind(item.id, phase, ['visible', 'text', 'attribute', 'count', 'enabled', 'evaluate']))) {
      return true;
    }
  }
  return false;
}

function phaseSatisfied(
  phase: LocalBrowserPhase,
  cases: readonly LocalComplianceCaseResult[],
): boolean {
  switch (phase) {
    case 'mount':
    case 'hydration':
      return assertionsIn(cases, phase, ['visible', 'text', 'attribute', 'count', 'enabled', 'evaluate']);
    case 'edit':
      return actionThenAssertion(cases, phase)
        && assertionsIn(cases, phase, ['text', 'attribute', 'count', 'enabled', 'evaluate']);
    case 'hide-show': {
      const values = observationsFor(cases, phase, 'visible');
      return values.includes(true) && values.includes(false);
    }
    case 'disabled': {
      const values = observationsFor(cases, phase, 'enabled');
      return values.includes(true) && values.includes(false);
    }
    case 'reset':
      return assertionsIn(cases, phase, ['click', 'evaluate'])
        && assertionsIn(cases, phase, ['text', 'attribute', 'count', 'enabled', 'evaluate']);
    case 'descendant-error':
      return assertionsIn(cases, phase, ['isolation']);
    case 'unmount':
      return assertionsIn(cases, phase, ['unmount'])
        && (assertionsIn(cases, phase, ['count', 'visible'])
          || assertionsIn(cases, phase, ['evaluate']));
    default:
      return false;
  }
}

function componentRef(configInput: unknown, component: string | undefined) {
  if (configInput === undefined || component === undefined) return null;
  const config = readLocalConfig(configInput);
  const definition = getLocalComponentRegistry(config).find((item) => item.name === component);
  return definition
    ? Object.freeze({ id: definition.id, name: definition.name, version: definition.version })
    : null;
}

function configKeyOf(configInput: unknown): string {
  if (configInput === undefined) return 'browser';
  return readLocalConfig(configInput).key;
}

/**
 * Execute a portable browser compliance scenario.
 *
 * Required lifecycle phases are proven from passed cases, not declarations.
 * Offline evidence additionally requires an offline context, a hydration pass,
 * no unexpected page errors and zero http(s)/ws requests.
 */
export async function runLocalBrowserCompliance(
  options: LocalBrowserComplianceOptions,
): Promise<LocalComplianceSuiteResult> {
  if (!options || typeof options !== 'object') {
    throw new TypeError('runLocalBrowserCompliance requires an options object.');
  }
  const driver = options.driver;
  if (!driver || typeof driver !== 'object' || typeof driver.open !== 'function') {
    throw new TypeError('options.driver must implement open().');
  }
  const spec = readLocalBrowserSpec(options.spec);
  const configKey = configKeyOf(options.config);
  const component = componentRef(options.config, options.component);
  const cases: LocalComplianceCaseResult[] = [];
  const timeoutMs = spec.timeoutMs ?? 5_000;
  const unmountExpression = spec.unmountExpression ?? DEFAULT_UNMOUNT;
  let session: LocalBrowserSessionDriver | null = null;

  try {
    session = await withTimeout(driver.open({
      url: spec.url,
      offline: spec.offline,
      ...(spec.javaScriptEnabled === undefined ? {} : { javaScriptEnabled: spec.javaScriptEnabled }),
      timeoutMs,
    }), timeoutMs, 'driver.open');
  } catch (error) {
    cases.push(failed('browser.open', 'browser', `Could not open the document: ${readErrorMessage(error)}`));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'browser',
      configKey,
      component,
      cases: Object.freeze(cases),
    });
  }

  if (!session) {
    cases.push(failed('browser.open', 'browser', 'The driver did not return a session.'));
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'browser',
      configKey,
      component,
      cases: Object.freeze(cases),
    });
  }
  const active = session;

  try {
    for (let index = 0; index < spec.cases.length; index += 1) {
      const item = spec.cases[index];
      const caseId = `browser.${item.phase}.${item.kind}.${item.id.replace(/^browser\./, '')}`;
      try {
        const outcome = await withTimeout(
          executeCase(active.page, item, timeoutMs, unmountExpression),
          timeoutMs,
          caseId,
        );
        cases.push(outcome.issues.length === 0
          ? passed(caseId, 'browser', outcome.observed === undefined ? {} : { observed: outcome.observed })
          : failed(caseId, 'browser', outcome.issues.join(' ')));
      } catch (error) {
        cases.push(failed(caseId, 'browser', readErrorMessage(error)));
      }
    }

    if (spec.offline) {
      if (active.offline !== true) {
        cases.push(failed('browser.offline-context', 'browser',
          'The driver session was not opened in an offline context.'));
      } else {
        cases.push(passed('browser.offline-context', 'browser'));
      }
      const network = active.requests.filter((url) => /^(?:https?|wss?):/i.test(url));
      cases.push(network.length === 0
        ? passed('browser.network', 'browser', { observed: { requests: 0 } })
        : failed('browser.network', 'browser', 'The offline document made network requests.', [
          { code: 'testing.browser-network', message: network.slice(0, 10).join(' ') },
        ]));
    }

    const expectedErrors = spec.expectedErrors ?? [];
    const unexpected = active.errors.filter((message) =>
      !expectedErrors.some((expected) => message.includes(expected)));
    cases.push(unexpected.length === 0
      ? passed('browser.errors', 'browser')
      : failed('browser.errors', 'browser', 'Unexpected page or console errors.', [
        { code: 'testing.browser-errors', message: unexpected.slice(0, 10).join(' | ') },
      ]));
  } finally {
    try {
      await active.close();
    } catch (error) {
      cases.push(failed('browser.close', 'browser', readErrorMessage(error)));
    }
  }

  const required = spec.requiredPhases ?? PHASES;
  for (const phase of required) {
    if (phaseSatisfied(phase, cases)) {
      cases.push(passed(`browser.phase.${phase}`, 'browser'));
    } else if (!cases.some((item) => item.id.startsWith(`browser.${phase}.`))) {
      cases.push(skipped(`browser.phase.${phase}`, 'browser',
        `No ${phase} case was executed.`));
    } else {
      cases.push(failed(`browser.phase.${phase}`, 'browser',
        `The ${phase} cases did not prove the required behavior.`));
    }
  }

  const interactiveSatisfied = LIFECYCLE_PHASES.every((phase) => phaseSatisfied(phase, cases));
  const blocking = cases.some((item) => item.status === 'failed');
  if (interactiveSatisfied && !blocking) {
    cases.push(passed('browser.interactive', 'browser', { capabilities: ['interactive'] }));
  } else {
    cases.push(skipped('browser.interactive', 'browser',
      'Interactive evidence requires mount, edit, hide/show, disabled, reset, descendant error and unmount phases without failures.',
      ['interactive']));
  }

  const hydration = phaseSatisfied('hydration', cases);
  if (spec.offline && interactiveSatisfied && hydration && !blocking) {
    cases.push(passed('browser.offline', 'browser', { capabilities: ['offline'] }));
  } else {
    cases.push(skipped('browser.offline', 'browser',
      spec.offline
        ? 'Offline evidence requires hydration, the full interactive lifecycle, an offline context and no network requests or unexpected errors.'
        : 'The spec did not open the document in an offline context.',
      ['offline']));
  }

  return Object.freeze({
    protocol: LOCAL_COMPLIANCE_PROTOCOL,
    suite: 'browser',
    configKey,
    component,
    cases: Object.freeze(cases),
  });
}

/* ------------------------------------------------------- Playwright adapter */

export interface LocalPlaywrightLocatorLike {
  count(): Promise<number>;
  first(): LocalPlaywrightLocatorLike;
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
}

export interface LocalPlaywrightPageLike {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  reload(options?: { timeout?: number }): Promise<unknown>;
  waitForSelector(selector: string, options?: { state?: 'attached' | 'visible'; timeout?: number }): Promise<unknown>;
  locator(selector: string): LocalPlaywrightLocatorLike;
  evaluate<T = unknown>(expression: string): Promise<T>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  close(): Promise<void>;
}

export interface LocalPlaywrightContextLike {
  newPage(): Promise<LocalPlaywrightPageLike>;
  setOffline?(offline: boolean): Promise<void>;
}

/**
 * Optional Playwright adapter. It takes an already-created browser context and
 * never imports Playwright, so `reactive-md/testing/browser` has no hard
 * dependency. Create the context with `offline: true` for offline compliance.
 */
export function createPlaywrightBrowserDriver(
  context: LocalPlaywrightContextLike,
): LocalBrowserDriver {
  if (!context || typeof context.newPage !== 'function') {
    throw new TypeError('createPlaywrightBrowserDriver requires a browser context.');
  }
  return Object.freeze({
    name: 'playwright',
    async open(options: LocalBrowserOpenOptions): Promise<LocalBrowserSessionDriver> {
      if (options.offline) {
        if (typeof context.setOffline !== 'function') {
          throw new TypeError('Offline compliance requires a browser context with setOffline().');
        }
        await context.setOffline(true);
      }
      const page = await context.newPage();
      const errors: string[] = [];
      const requests: string[] = [];
      page.on('pageerror', (error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
      });
      page.on('console', (message: unknown) => {
        const entry = message as { type?: () => string; text?: () => string };
        try {
          if (entry.type?.() === 'error') errors.push(entry.text?.() ?? 'console.error');
        } catch {
          /* ignore console objects that do not follow the Playwright shape */
        }
      });
      page.on('request', (request: unknown) => {
        const entry = request as { url?: () => string };
        try {
          const url = entry.url?.();
          if (typeof url === 'string' && /^(?:https?|wss?):/i.test(url)) requests.push(url);
        } catch {
          /* ignore malformed request objects */
        }
      });
      try {
        await page.goto(options.url, { waitUntil: 'load', timeout: options.timeoutMs });
      } catch (error) {
        await page.close();
        throw error;
      }

      const locator = (selector: string): LocalPlaywrightLocatorLike => page.locator(selector);
      const pageDriver: LocalBrowserPageDriver = {
        async goto(url) {
          await page.goto(url, { waitUntil: 'load', timeout: options.timeoutMs });
        },
        async reload() {
          await page.reload({ timeout: options.timeoutMs });
        },
        async waitFor(selector, timeoutMs) {
          await page.waitForSelector(selector, { state: 'attached', timeout: timeoutMs });
        },
        async count(selector) {
          return locator(selector).count();
        },
        async text(selector) {
          if ((await locator(selector).count()) === 0) return null;
          return locator(selector).first().textContent();
        },
        async attribute(selector, name) {
          if ((await locator(selector).count()) === 0) return null;
          return locator(selector).first().getAttribute(name);
        },
        async visible(selector) {
          if ((await locator(selector).count()) === 0) return false;
          return locator(selector).first().isVisible();
        },
        async enabled(selector) {
          if ((await locator(selector).count()) === 0) return false;
          return locator(selector).first().isEnabled();
        },
        async click(selector) {
          await locator(selector).first().click();
        },
        async fill(selector, value) {
          await locator(selector).first().fill(value);
        },
        async press(selector, key) {
          await locator(selector).first().press(key);
        },
        async evaluate<T = unknown>(expression: string): Promise<T> {
          return page.evaluate<T>(expression);
        },
      };

      return Object.freeze({
        page: pageDriver,
        get errors(): readonly string[] { return Object.freeze([...errors]); },
        get requests(): readonly string[] { return Object.freeze([...requests]); },
        offline: options.offline,
        async close() {
          await page.close();
        },
      });
    },
  });
}
