/**
 * Public authoring services, split across focused modules.
 *
 * - `catalog.ts`: manifest-derived insertion catalog, grouping, help and
 *   structural context filters.
 * - `insert.ts`: source insertion with fresh bindings and selection/caret
 *   tokens.
 *
 * This module keeps the historical import path stable.
 */

export {
  createLocalAuthoringLookup,
  createLocalComponentCatalog,
  createLocalComponentCatalogForOptions,
  filterLocalComponentCatalog,
  localCatalogAncestors,
  localComponentCatalogGroups,
  localComponentCatalogKey,
  localComponentHelp,
} from './catalog';
export type {
  LocalAttributeAuthoring,
  LocalAuthoringLookup,
  LocalComponentCatalogEntry,
  LocalComponentCatalogFilter,
  LocalComponentCatalogGroup,
  LocalComponentCatalogProp,
  LocalTagAuthoring,
} from './catalog';

export {
  insertLocalComponent,
  insertLocalComponentFromOptions,
} from './insert';
