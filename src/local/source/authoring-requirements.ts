import type { LocalComponentSchema, LocalPropSchema } from '../../contracts/schema-core';

/** Whether the component requires this attribute to be written in the source. */
export function requiresSourceAttribute(
  component: LocalComponentSchema,
  name: string,
  prop: LocalPropSchema,
  present?: ReadonlySet<string>,
): boolean {
  if (name === 'label' && (component.structure?.label ?? component.label) === 'required') return true;
  if (prop.required === true && prop.default === undefined) return true;
  const bindings = component.bindings ? Object.values(component.bindings) : [component.binding];
  return bindings.some(binding => binding?.required === true && binding.bind === name
    && !binding.requiresAttributes?.some(attribute => !present?.has(attribute)));
}
