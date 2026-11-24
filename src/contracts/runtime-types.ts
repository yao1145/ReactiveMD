/** Primitive values and source coordinates shared across compiler stages. */
export interface SourceRange { start: number; end: number }
export type LocalValue = string | number | boolean | null | string[] | number[];
/** `array` retains its existing meaning: a homogeneous string array. */
export type LocalValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'number-array';
export type LocalLocale = 'en' | 'zh';

/** Public host binding projection shared by SDK manifests and the compiler. */
export interface LocalHostBindingSchema {
  readonly kind: 'string' | 'number' | 'boolean';
  readonly initialRule?: 'empty' | 'false' | 'nearest-zero' | 'min' | 'first-option';
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly exclusive?: boolean;
}
