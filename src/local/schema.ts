import type { LocalComponentForm, LocalComponentSchema } from './schema-core';
import type { LocalValue } from './types';
import { DEFAULT_COMPONENT_DEFINITIONS } from '../presets/default-components';
import { componentSchemaFromDefinition } from '../sdk/registry-core';
import { LOCAL_KERNEL_DECLARATIONS, closestName } from './schema-core';

export type {
  LocalComponentForm,
  LocalChildRule,
  LocalPropKind,
  LocalPropSchema,
  LocalBindingFamily,
  LocalBindingSchema,
  LocalBindingSlotSchema,
  LocalInitialRule,
  LocalComponentSchema,
} from './schema-core';
export { LOCAL_KERNEL_DECLARATIONS, closestName } from './schema-core';

/**
 * Static description of the `local-draft-1` component set, derived from the
 * default preset manifests. The compatibility fields (`childRule`, `label`,
 * `parent`, `binding`, `slots`, `initialRule`) are projections of `structure`
 * and `bindings`; the authoritative declarations live in
 * `src/presets/default-components.ts`.
 *
 * The theme-free vocabulary and the manifest projection live in
 * `schema-core.ts` / `sdk/registry-core.ts`; this module keeps the preset
 * snapshot and name-based suggestions for the compatibility entry.
 */

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

function buildComponents(): readonly LocalComponentSchema[] {
  const projected = DEFAULT_COMPONENT_DEFINITIONS.map(componentSchemaFromDefinition);
  const validationIndex = projected.findIndex((component) => component.name === 'validation');
  const insertAt = validationIndex < 0 ? projected.length : validationIndex;
  return Object.freeze([
    ...projected.slice(0, insertAt),
    ...LOCAL_KERNEL_DECLARATIONS,
    ...projected.slice(insertAt),
  ]);
}

const components = buildComponents();

export const LOCAL_COMPONENTS: Readonly<Record<string, LocalComponentSchema>> = Object.freeze(
  Object.fromEntries(components.map((component) => [component.name, Object.freeze(component)])),
);

export const LOCAL_COMPONENT_NAMES: readonly string[] = Object.freeze(
  components.map((component) => component.name),
);

/**
 * Frozen names grouped by tag shape. The parser derives its void, paired and
 * inline tag sets from the registry, so `form` here is the single declarative
 * source for accepted tag syntax.
 */
const namesByForm: Readonly<Record<LocalComponentForm, readonly string[]>> = Object.freeze({
  leaf: Object.freeze(components.filter((component) => component.form === 'leaf').map((component) => component.name)),
  inline: Object.freeze(components.filter((component) => component.form === 'inline').map((component) => component.name)),
  container: Object.freeze(components.filter((component) => component.form === 'container').map((component) => component.name)),
});

/** Component names with the given tag shape, in declaration order. */
export function localComponentNames(form: LocalComponentForm): readonly string[] {
  return namesByForm[form];
}

export function getLocalComponent(name: string): LocalComponentSchema | undefined {
  return Object.hasOwn(LOCAL_COMPONENTS, name) ? LOCAL_COMPONENTS[name] : undefined;
}

export function getPropDefault(component: LocalComponentSchema, prop: string): LocalValue | undefined {
  return component.props[prop]?.default;
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

export function suggestComponent(name: string): string | undefined {
  return closestName(name, LOCAL_COMPONENT_NAMES);
}

export function suggestAttribute(component: LocalComponentSchema, name: string): string | undefined {
  return closestName(name, Object.keys(component.props));
}
