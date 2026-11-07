/**
 * Serializable seeded randomness.
 *
 * The random state lives in component state. These are pure functions: the
 * host never owns a mutable, implicitly advancing generator, so React state
 * updaters and Strict Mode double invocations stay deterministic.
 */

import { deriveSeed, toUint32 } from './identity';

export const LOCAL_RANDOM_ALGORITHM = 'mulberry32' as const;
export const LOCAL_RANDOM_VERSION = 1 as const;

export interface LocalRandomState {
  readonly algorithm: typeof LOCAL_RANDOM_ALGORITHM;
  readonly version: typeof LOCAL_RANDOM_VERSION;
  /** Current 32-bit generator position. */
  readonly state: number;
}

export interface LocalRandomStep {
  readonly value: number;
  readonly state: LocalRandomState;
}

export interface LocalRandomIntStep {
  readonly value: number;
  readonly state: LocalRandomState;
}

export interface LocalRandomShuffleStep<T> {
  readonly items: T[];
  readonly state: LocalRandomState;
}

export function createRandom(seed: number): LocalRandomState {
  return Object.freeze({
    algorithm: LOCAL_RANDOM_ALGORITHM,
    version: LOCAL_RANDOM_VERSION,
    state: toUint32(seed),
  });
}

/** Validate and normalize a saved random state. */
export function normalizeRandomState(value: unknown): LocalRandomState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.algorithm !== LOCAL_RANDOM_ALGORITHM) return null;
  if (record.version !== LOCAL_RANDOM_VERSION) return null;
  if (typeof record.state !== 'number' || !Number.isFinite(record.state)) return null;
  const state = toUint32(record.state);
  if (state !== record.state) return null;
  return Object.freeze({
    algorithm: LOCAL_RANDOM_ALGORITHM,
    version: LOCAL_RANDOM_VERSION,
    state,
  });
}

/** Mulberry32: one 32-bit word of state, uniform in [0, 1). */
export function nextRandom(random: LocalRandomState): LocalRandomStep {
  const state = toUint32(random.state + 0x6d2b79f5);
  let value = Math.imul(state ^ (state >>> 15), state | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  const unit = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  return {
    value: unit,
    state: Object.freeze({
      algorithm: LOCAL_RANDOM_ALGORITHM,
      version: LOCAL_RANDOM_VERSION,
      state,
    }),
  };
}

/** Inclusive integer range. Invalid or reversed bounds are normalized. */
export function randomInt(
  random: LocalRandomState,
  min: number,
  max: number,
): LocalRandomIntStep {
  const step = nextRandom(random);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { value: 0, state: step.state };
  }
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  if (high < low) {
    return { value: low, state: step.state };
  }
  return {
    value: low + Math.floor(step.value * (high - low + 1)),
    state: step.state,
  };
}

/** Fisher-Yates over a copy; the input array is never mutated. */
export function shuffleRandom<T>(
  random: LocalRandomState,
  items: readonly T[],
): LocalRandomShuffleStep<T> {
  const output = items.slice();
  let state = random;
  for (let index = output.length - 1; index > 0; index -= 1) {
    const step = randomInt(state, 0, index);
    state = step.state;
    const swap = output[index];
    output[index] = output[step.value];
    output[step.value] = swap;
  }
  return { items: output, state };
}

/** Create an independent stream from a base seed and label. */
export function deriveRandom(seed: number, label: string): LocalRandomState {
  return createRandom(deriveSeed(seed, label));
}

export function randomBool(
  random: LocalRandomState,
  probability = 0.5,
): { value: boolean; state: LocalRandomState } {
  const step = nextRandom(random);
  return { value: step.value < probability, state: step.state };
}
