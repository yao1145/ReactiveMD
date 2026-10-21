import type { ComponentSchema } from './schema';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type StateValue = Json;
export type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
export interface SourceRange { start: number; end: number }
export interface Diagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  range: SourceRange;
  line: number;
  column: number;
}
export type ValueSource =
  | { kind: 'literal'; value: Json }
  | { kind: 'expression'; expression: string };
export interface DocumentNode {
  type: string;
  id: string;
  range: SourceRange;
  children?: DocumentNode[];
  value?: string;
  name?: string;
  label?: string;
  props?: Record<string, ValueSource>;
  binding?: string;
  events?: Record<string, string>;
  depth?: number;
  ordered?: boolean;
  start?: number;
  url?: string;
  title?: string | null;
  alt?: string;
  lang?: string;
  checked?: boolean | null;
  align?: ('left' | 'center' | 'right' | null)[];
}
export type ActionStep =
  | { set: string; value: ValueSource; range: SourceRange }
  | { reset: string[]; range: SourceRange }
  | { append: string; value: ValueSource; range: SourceRange }
  | { remove: string; at: ValueSource; range: SourceRange }
  | { update: string; at: ValueSource; value: ValueSource; range: SourceRange }
  | { call: string; input: Record<string, ValueSource>; range: SourceRange };
export interface BindingConstraint {
  componentId: string;
  state: string;
  type: ValueKind;
  range: SourceRange;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}
export interface CompiledDocument {
  source: string;
  nodes: DocumentNode[];
  data: Record<string, Json>;
  initialState: Record<string, StateValue>;
  computed: Record<string, string>;
  actions: Record<string, ActionStep[]>;
  computedOrder: string[];
  bindings: BindingConstraint[];
  /** Schema snapshot taken at compile time; unregistering a component cannot invalidate this document. */
  componentSchemas: Record<string, ComponentSchema>;
}
export type CompileResult =
  | { ok: true; document: CompiledDocument; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };
export interface RuntimeSnapshot {
  revision: number;
  state: Readonly<Record<string, StateValue>>;
  computed: Readonly<Record<string, Json>>;
  resources: Readonly<Record<string, ResourceSnapshot>>;
}
export interface ResourceSnapshot {
  status: 'idle' | 'pending' | 'success' | 'error';
  data: Json;
  error: string | null;
  requestId: number;
}
export type Capability = (input: Json, context: { signal: AbortSignal; action: string }) => Json | Promise<Json>;
export interface RuntimeOptions {
  initialState?: Record<string, Json>;
  capabilities?: Record<string, Capability>;
}
export type DispatchResult =
  | { ok: true; revision: number }
  | { ok: false; diagnostics: Diagnostic[] };
export interface Runtime {
  snapshot(): RuntimeSnapshot;
  dispatch(actionName: string, locals?: Record<string, Json>): DispatchResult;
  dispatchAsync(actionName: string, locals?: Record<string, Json>): Promise<DispatchResult>;
  cancel(actionName: string): void;
  writeBinding(componentId: string, value: StateValue, locals?: Record<string, Json>): DispatchResult;
  evaluate(value: ValueSource, locals?: Record<string, Json>): Json;
  subscribe(names: readonly string[], listener: () => void): () => void;
  dispose(): void;
}
