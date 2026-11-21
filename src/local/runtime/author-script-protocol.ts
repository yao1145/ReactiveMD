import type { LocalValue } from '../types';

export const COUNTER_ACTIONS = ['increment', 'decrement', 'reset'] as const;
export type AuthorAction = (typeof COUNTER_ACTIONS)[number];

export type AuthorBindingRequest =
  | { operation: 'get'; name: string }
  | { operation: 'set'; name: string; value: LocalValue }
  | { operation: 'setMany'; values: Record<string, LocalValue> };

export type AuthorBindingReply = { ok: true; value?: LocalValue } | { ok: false; message: string };

export interface AuthorActionRegistration {
  target: string;
  action: AuthorAction;
  takeover: boolean;
}

export interface AuthorActionTarget {
  id: string;
  epoch: number;
}

export type AuthorWorkerInput =
  | { kind: 'start'; blocks: readonly string[]; targets: readonly string[] }
  | { kind: 'reply'; id: number; result: AuthorBindingReply }
  | { kind: 'action'; target: AuthorActionTarget; action: AuthorAction };

export type AuthorWorkerOutput =
  | { kind: 'request'; id: number; request: AuthorBindingRequest; target?: AuthorActionTarget }
  | { kind: 'registered'; registrations: AuthorActionRegistration[] }
  | { kind: 'diagnostic'; block: number; message: string }
  | { kind: 'failed'; message: string };
