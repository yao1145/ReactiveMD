/**
 * Compatibility re-export.
 *
 * The extended catalog used to be a second hand-maintained list. Both arrays are
 * now projections of the default preset authoring data in
 * `src/presets/default-authoring.ts`; import from `native-components.ts` for
 * new code.
 */

export {
  EXTENDED_NATIVE_COMPONENTS,
  EXTENDED_NATIVE_COMPONENT_COPY_ZH,
} from './native-components';
