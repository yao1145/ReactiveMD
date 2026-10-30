import { DEFAULT_COMPONENT_DEFINITIONS, DEFAULT_COMPONENT_NAMES } from '../presets/default-components';
import type { KernelBindingSchema, KernelComponentSchema, KernelPropSchema } from '../local/component-kernel';
import type { LocalComponentSchema, LocalBindingSlotSchema, LocalPropSchema } from '../local/schema';
import { readLocalConfig } from './config';
import { localStructureFromChildren } from './manifest';
import type {
  LocalComponentBinding,
  LocalComponentDefinition,
  LocalComponentProp,
  LocalComponentStructure,
  LocalConfig,
} from './types';

/** The 46 rendered/structural default manifests. */
export { DEFAULT_COMPONENT_DEFINITIONS, DEFAULT_COMPONENT_NAMES };

const schemaCache = new WeakMap<object, LocalComponentSchema>();

/** Convert a manifest prop to the kernel's compatibility prop shape. */
function schemaProp(prop: LocalComponentProp): LocalPropSchema {
  return {
    kind: prop.kind,
    ...(prop.required === true ? { required: true } : {}),
    ...(prop.static === true ? { static: true } : {}),
    ...(prop.dynamic !== undefined ? { dynamic: prop.dynamic } : {}),
    ...(prop.default !== undefined ? { default: prop.default } : {}),
    ...(prop.nullable === true ? { nullable: true } : {}),
    ...(prop.enum ? { values: [...prop.enum] } : {}),
    ...(prop.pattern !== undefined ? { pattern: prop.pattern } : {}),
    ...(prop.min !== undefined ? { min: prop.min } : {}),
    ...(prop.max !== undefined ? { max: prop.max } : {}),
    ...(prop.integer === true ? { integer: true } : {}),
    ...(prop.positive === true ? { positive: true } : {}),
    ...(prop.color === true ? { color: true } : {}),
    ...(prop.coerce !== undefined ? { coerce: prop.coerce } : {}),
  } as LocalPropSchema;
}

/** The old schema projection of one binding, keeping phase-one spelling. */
function schemaBinding(binding: LocalComponentBinding): KernelBindingSchema {
  return {
    kind: binding.kind,
    family: binding.family,
    bind: binding.bind,
    initial: binding.initial,
    initialRule: binding.initialRule,
    required: binding.required === true,
    ...(binding.exclusive === true ? { exclusive: true } : {}),
    ...(binding.options ? { options: binding.options } : {}),
    ...(binding.constraints ? { constraints: binding.constraints } : {}),
    ...(binding.maxItems ? { maxItems: binding.maxItems } : {}),
    ...(binding.requiresAttributes ? { requiresAttributes: binding.requiresAttributes } : {}),
    ...(binding.compare ? { compare: binding.compare } : {}),
    ...(binding.retain === false ? { retain: false } : {}),
  };
}

/** Attribute prop synthesized for an implicitly owned binding attribute. */
function bindingAttributeProp(binding: LocalComponentBinding, attribute: string): LocalPropSchema {
  if (attribute === binding.bind) return { kind: 'string', static: true } as LocalPropSchema;
  switch (binding.kind) {
    case 'number': return { kind: 'number', static: true } as LocalPropSchema;
    case 'boolean': return { kind: 'boolean', static: true } as LocalPropSchema;
    default: return { kind: 'string', static: true } as LocalPropSchema;
  }
}

/** Legacy child-rule projection of a structure declaration. */
function childRuleOf(structure: LocalComponentStructure | undefined, form: LocalComponentDefinition['form']): LocalComponentSchema['childRule'] {
  if (structure === undefined) return form === 'leaf' ? 'none' : 'any';
  switch (structure.rule) {
    case 'components':
      if (structure.child === 'card') return 'cards';
      if (structure.child === 'disclosure') return 'disclosures';
      if (structure.child === 'column') return 'columns';
      return 'any';
    default:
      return structure.rule as LocalComponentSchema['childRule'];
  }
}

/** Project a public manifest onto the legacy `LocalComponentSchema` view. */
export function componentSchemaFromDefinition(definition: LocalComponentDefinition): LocalComponentSchema {
  const predefined = schemaCache.get(definition);
  if (predefined !== undefined) return predefined;
  const bindings = definition.bindings ?? {};
  const structure = definition.structure ?? localStructureFromChildren(definition.children);
  const valueBinding = bindings.value;
  const namedSlots: LocalBindingSlotSchema[] = [];
  for (const [name, binding] of Object.entries(bindings)) {
    if (name === 'value') continue;
    namedSlots.push(Object.freeze({
      name,
      bind: binding.bind,
      initial: binding.initial,
      kind: binding.kind,
      family: binding.family,
      exclusive: binding.exclusive === true,
      initialRule: binding.initialRule,
    }));
  }
  const propTable: Record<string, LocalPropSchema> = {};
  for (const [name, prop] of Object.entries(definition.props)) propTable[name] = schemaProp(prop);
  for (const binding of Object.values(bindings)) {
    const attributes = [binding.bind, binding.initial];
    for (const attribute of attributes) {
      if (Object.hasOwn(propTable, attribute)) continue;
      // Old schemas omit `initial` for content-derived defaults.
      if (attribute === binding.initial && (binding.initialRule === 'checked' || binding.initialRule === 'duration')) continue;
      propTable[attribute] = bindingAttributeProp(binding, attribute);
    }
  }
  const schema: LocalComponentSchema = Object.freeze({
    name: definition.name,
    form: definition.form,
    props: Object.freeze(propTable),
    ...(valueBinding ? { binding: Object.freeze(schemaBinding(valueBinding)) } : {}),
    ...(Object.keys(bindings).length ? { bindings: Object.freeze({ ...bindings }) } : {}),
    ...(namedSlots.length ? { slots: Object.freeze(namedSlots) } : {}),
    ...(structure ? { structure } : {}),
    ...(definition.rules ? { rules: definition.rules as unknown as NonNullable<KernelComponentSchema['rules']> } : {}),
    ...(definition.slotRelations ? { slotRelations: definition.slotRelations } : {}),
    ...(definition.legacyHost === true ? { legacyHost: true } : {}),
    childRule: childRuleOf(structure, definition.form),
    label: structure?.label ?? 'none',
    ...(structure?.parents ? { parent: structure.parents } : {}),
    ...(valueBinding ? { initialRule: valueBinding.initialRule } : {}),
  });
  schemaCache.set(definition, schema);
  return schema;
}

/** Cached alias used by callers that already hold a manifest. */
export function localComponentSchema(definition: LocalComponentDefinition): LocalComponentSchema {
  return componentSchemaFromDefinition(definition);
}

function defaultRegistry(): readonly LocalComponentDefinition[] {
  return DEFAULT_COMPONENT_DEFINITIONS;
}

/**
 * Resolve the full validated component snapshot: the default preset followed by
 * instance-level external components. Builtins and extensions share one list.
 * A raw configuration cannot smuggle in invalid, duplicate or reserved
 * manifests through a forged `registry` field; the snapshot is rebuilt from
 * validated externally supplied components and cached per configuration.
 */
export function getLocalComponentRegistry(config?: LocalConfig): readonly LocalComponentDefinition[] {
  if (!config) return defaultRegistry();
  return readLocalConfig(config).registry;
}

/** Look up one definition by tag name in the resolved registry. */
export function getLocalComponentDefinition(name: string, config?: LocalConfig): LocalComponentDefinition | undefined {
  const registry = getLocalComponentRegistry(config);
  for (const definition of registry) {
    if (definition.name === name) return definition;
  }
  return undefined;
}

/** Name-keyed schema view of the resolved registry. */
export function localComponentSchemas(config?: LocalConfig): ReadonlyMap<string, LocalComponentSchema> {
  const map = new Map<string, LocalComponentSchema>();
  for (const definition of getLocalComponentRegistry(config)) {
    map.set(definition.name, componentSchemaFromDefinition(definition));
  }
  return map;
}
