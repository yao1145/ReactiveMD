import { defineLocalComponent } from '../sdk/manifest';
import type { LocalComponentDefinition } from '../sdk/types';
import { defaultManifestAuthoring } from './default-authoring';
import { DEFAULT_COMPONENT_NAMES, DEFAULT_SEMANTIC_COMPONENTS } from './default-semantics';

/**
 * Authored assembly of the default preset.
 *
 * Semantic declarations live in `default-semantics.ts` and import nothing from
 * authoring. This module adds the portable English titles, descriptions and
 * insertion templates that editor catalogs read. Compilers that only need
 * component semantics can import the semantic module without pulling authoring
 * copy into their graph.
 */

function withAuthoring(definition: LocalComponentDefinition): LocalComponentDefinition {
  const authoring = defaultManifestAuthoring(definition.name);
  return authoring ? defineLocalComponent({ ...definition, authoring }) : definition;
}

export const DEFAULT_COMPONENT_DEFINITIONS: readonly LocalComponentDefinition[] = Object.freeze(
  DEFAULT_SEMANTIC_COMPONENTS.map(withAuthoring),
);

export { DEFAULT_COMPONENT_NAMES };
