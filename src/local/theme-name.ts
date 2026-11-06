/**
 * Theme name grammar shared by document parsing and host manifests.
 *
 * This module is deliberately dependency-free so the compiler kernel can
 * validate `<theme name="...">` without loading theme definitions, CSS or host
 * code. `theme.ts` re-exports it for the existing public surface.
 */
const THEME_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const MAX_THEME_NAME_LENGTH = 64;

/** Bounded, URL-free theme identifier used by documents and host manifests. */
export function isLocalThemeName(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_THEME_NAME_LENGTH
    && THEME_NAME.test(value)
  );
}
