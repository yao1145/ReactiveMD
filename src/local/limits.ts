/** Shared limits for source compilation, runtime values and visual work. */
export const MAX_LOCAL_DOCUMENT_LENGTH = 1_000_000;
export const MAX_LOCAL_STRING_LENGTH = 100_000;
export const MAX_LOCAL_ARRAY_LENGTH = 10_000;
export const MAX_LOCAL_VALUE_CHARACTERS = 100_000;
export const MAX_LOCAL_DIAGNOSTICS = 100;
export const MAX_LOCAL_DIAGNOSTIC_LENGTH = 2_000;
export const MAX_LOCAL_PLOT_CURVES = 16;
export const MAX_LOCAL_PLOT_POINTS = 20_000;
export const MAX_LOCAL_PLOT_STEPS = 2_000_000;
export const MAX_LOCAL_EMAIL_LENGTH = 254;

/** Linear validation; the final dot must have text on both sides in the domain. */
export function isLocalEmail(value: string): boolean {
  if (value.length > MAX_LOCAL_EMAIL_LENGTH || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const dot = value.lastIndexOf('.');
  return dot > at + 1 && dot < value.length - 1;
}
