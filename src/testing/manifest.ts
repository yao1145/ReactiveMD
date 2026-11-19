import type { LocalRuntime } from '../local/types';
import {
  defineLocalComponent,
  localComponentDigest,
  readLocalComponentManifest,
} from '../sdk/manifest';
import {
  resolveLocalComponentProp,
  resolveLocalComponentProps,
} from '../sdk/props';
import type { LocalComponentDefinition, LocalComponentProp } from '../sdk/types';
import { failed, passed } from './cases';
import {
  LOCAL_COMPLIANCE_PROTOCOL,
  type LocalComplianceCaseResult,
  type LocalComplianceComponentRef,
  type LocalComplianceSuiteResult,
} from './types';
import {
  readComplianceValue,
  readErrorMessage,
  sameComplianceValue,
} from './values';

const STUB_RUNTIME = {
  evaluate(): never {
    throw new Error('Expression evaluation is not available in manifest compliance.');
  },
  text(raw: string): string {
    return raw;
  },
} as Pick<LocalRuntime, 'evaluate' | 'text'>;

function refOf(definition: LocalComponentDefinition): LocalComplianceComponentRef {
  return Object.freeze({
    id: definition.id,
    name: definition.name,
    version: definition.version,
  });
}

function rejectCase(id: string, run: () => unknown, expected?: string): LocalComplianceCaseResult {
  try {
    run();
  } catch (error) {
    const message = readErrorMessage(error);
    if (expected !== undefined && !message.includes(expected)) {
      return failed(id, 'manifest', `Rejected with an unexpected message: ${message}`);
    }
    return passed(id, 'manifest');
  }
  return failed(id, 'manifest', 'Invalid manifest input was accepted.');
}

function acceptedCase(id: string, run: () => unknown): LocalComplianceCaseResult {
  try {
    run();
    return passed(id, 'manifest');
  } catch (error) {
    return failed(id, 'manifest', `Expected acceptance, got: ${readErrorMessage(error)}`);
  }
}

/** Candidate that must not satisfy a string pattern, or null when none exists. */
function invalidPatternValue(pattern: string): string | null {
  let expression: RegExp;
  try {
    expression = new RegExp(pattern);
  } catch {
    return null;
  }
  for (const candidate of ['', 'x', '!', '\u0000']) {
    if (!expression.test(candidate)) return candidate;
  }
  return null;
}

function invalidRawFor(prop: LocalComponentProp): string | undefined {
  switch (prop.kind) {
    case 'number':
      return 'not-a-number';
    case 'boolean':
      return 'maybe';
    case 'enum':
      return '__invalid__';
    case 'string':
      if (prop.color === true) return '#zzz';
      if (prop.pattern !== undefined) return invalidPatternValue(prop.pattern) ?? undefined;
      return undefined;
    default:
      return undefined;
  }
}

function invalidDefaultFor(prop: LocalComponentProp): unknown {
  switch (prop.kind) {
    case 'number':
      return 'not-a-number';
    case 'boolean':
      return 'yes';
    case 'enum':
      return '__invalid__';
    case 'string':
      return 42;
    default:
      return 42;
  }
}

function plainClone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function withOwnKey(record: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return record;
}

/**
 * Execute manifest-level compliance for one component definition.
 *
 * Every case calls the public manifest/prop readers. A definition either
 * normalizes to an identical semantic digest, applies its declared defaults,
 * rejects illegal input and rejects corrupted identity/default data, or the
 * case fails with the actual error text.
 */
export function runLocalManifestCompliance(input: unknown): LocalComplianceSuiteResult {
  let definition: LocalComponentDefinition;
  try {
    definition = readLocalComponentManifest(input);
  } catch (error) {
    const message = readErrorMessage(error);
    return Object.freeze({
      protocol: LOCAL_COMPLIANCE_PROTOCOL,
      suite: 'manifest',
      configKey: 'invalid',
      component: null,
      cases: Object.freeze([
        failed('manifest.normalize', 'manifest', message, [
          { code: 'testing.manifest', message },
        ]),
      ]),
    }) as LocalComplianceSuiteResult;
  }

  const cases: LocalComplianceCaseResult[] = [];
  const plain = plainClone(definition);
  const digest = localComponentDigest(definition);

  cases.push(acceptedCase('manifest.normalize', () => {
    const roundTrip = readLocalComponentManifest(plain);
    if (localComponentDigest(roundTrip) !== digest) {
      throw new Error('A plain JSON round trip changed the semantic digest.');
    }
  }));

  // Key order must not affect the digest; every reader sorts property names.
  const shuffled = plainClone(definition);
  const props = shuffled.props;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    const reversed: Record<string, unknown> = {};
    for (const key of Object.keys(props).reverse()) {
      reversed[key] = (props as Record<string, unknown>)[key];
    }
    shuffled.props = reversed;
  }
  cases.push(acceptedCase('manifest.key-order', () => {
    const reordered = readLocalComponentManifest(shuffled);
    if (localComponentDigest(reordered) !== digest) {
      throw new Error('Reordering props changed the semantic digest.');
    }
  }));

  const propNames = Object.keys(definition.props).sort();
  for (const name of propNames) {
    const prop = definition.props[name];
    const safeName = name.replace(/[^A-Za-z0-9._-]/g, '_');

    if (prop.default !== undefined) {
      cases.push((() => {
        try {
          const value = resolveLocalComponentProp(definition, name, undefined, STUB_RUNTIME);
          const expected = readComplianceValue(prop.default, `props.${name}.default`);
          if (!sameComplianceValue(value, expected)) {
            return failed(
              `manifest.default.${safeName}`,
              'manifest',
              `Declared default ${JSON.stringify(expected)} resolved as ${JSON.stringify(value)}.`,
            );
          }
          return passed(`manifest.default.${safeName}`, 'manifest');
        } catch (error) {
          return failed(`manifest.default.${safeName}`, 'manifest', readErrorMessage(error));
        }
      })());

      const invalid = invalidRawFor(prop);
      if (invalid !== undefined) {
        cases.push(rejectCase(
          `manifest.invalid-value.${safeName}`,
          () => resolveLocalComponentProp(definition, name, invalid, STUB_RUNTIME),
        ));
      }
    }

    if (prop.required === true && prop.default === undefined) {
      cases.push(rejectCase(
        `manifest.required.${safeName}`,
        () => resolveLocalComponentProp(definition, name, undefined, STUB_RUNTIME),
      ));
    }
  }

  cases.push(rejectCase(
    'manifest.unknown-attribute',
    () => resolveLocalComponentProps(definition, { __undeclared: 'x' }, STUB_RUNTIME),
  ));

  cases.push(rejectCase(
    'manifest.unknown-field',
    () => {
      const mutated = plainClone(definition);
      mutated.__undeclared = true;
      readLocalComponentManifest(mutated);
    },
    'unknown field',
  ));

  cases.push(rejectCase(
    'manifest.dangerous-key',
    () => readLocalComponentManifest(withOwnKey(plainClone(definition), '__proto__', 1)),
    'not allowed',
  ));

  for (const [suffix, mutate] of [
    ['id', (value: Record<string, unknown>) => { value.id = 'Bad/Id'; }],
    ['name', (value: Record<string, unknown>) => { value.name = 'Bad Name'; }],
    ['version', (value: Record<string, unknown>) => { value.version = '1'; }],
    ['protocol', (value: Record<string, unknown>) => { value.protocol = 'reactive-md-component/v2'; }],
    ['form', (value: Record<string, unknown>) => { value.form = 'box'; }],
  ] as const) {
    cases.push(rejectCase(`manifest.invalid-identity.${suffix}`, () => {
      const mutated = plainClone(definition);
      mutate(mutated);
      readLocalComponentManifest(mutated);
    }));
  }

  for (const name of propNames) {
    const prop = definition.props[name];
    if (prop.default === undefined) continue;
    const safeName = name.replace(/[^A-Za-z0-9._-]/g, '_');
    cases.push(rejectCase(`manifest.invalid-default.${safeName}`, () => {
      const mutated = plainClone(definition);
      const table = mutated.props as Record<string, Record<string, unknown>>;
      table[name] = { ...table[name], default: invalidDefaultFor(prop) };
      readLocalComponentManifest(mutated);
    }));
  }

  // A definition rebuilt from its normalized data is byte-for-byte stable.
  cases.push(acceptedCase('manifest.define-round-trip', () => {
    const rebuilt = defineLocalComponent(plain as unknown as LocalComponentDefinition);
    if (localComponentDigest(rebuilt) !== digest) {
      throw new Error('defineLocalComponent changed the semantic digest.');
    }
  }));

  return Object.freeze({
    protocol: LOCAL_COMPLIANCE_PROTOCOL,
    suite: 'manifest',
    configKey: digest,
    component: refOf(definition),
    cases: Object.freeze(cases),
  });
}
