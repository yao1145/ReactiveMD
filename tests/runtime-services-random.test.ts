import { describe, expect, it } from 'vitest';
import {
  componentStateKey,
  createRandom,
  deriveRandom,
  deriveSeed,
  localSourceDigest,
  nextRandom,
  normalizeRandomState,
  normalizeStateKey,
  randomInt,
  resolveComponentSeed,
  shuffleRandom,
} from '../src/runtime-services';

describe('runtime service identity', () => {
  it('keeps the state-file digest shape', () => {
    expect(localSourceDigest('')).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(localSourceDigest('same')).toBe(localSourceDigest('same'));
    expect(localSourceDigest('same')).not.toBe(localSourceDigest('other'));
  });

  it('uses explicit state keys across edits and node ids otherwise', () => {
    const withKey = componentStateKey({
      documentId: 'workshop',
      sourceDigest: 'fnv1a32:00000000',
      nodeId: 'local-1',
      stateKey: 'demo',
    });
    expect(withKey).toContain('state:demo');
    expect(withKey).not.toContain('local-1');

    const withoutKey = componentStateKey({
      documentId: 'workshop',
      sourceDigest: 'fnv1a32:00000000',
      nodeId: 'local-1',
    });
    expect(withoutKey).toContain('node:local-1');
  });

  it('keeps long document ids inside the state-key budget', () => {
    const input = {
      documentId: '中'.repeat(256),
      sourceDigest: 'fnv1a32:00000000',
      nodeId: 'local-1',
      stateKey: 'demo',
    };
    const first = componentStateKey(input);
    expect(first.length).toBeLessThanOrEqual(512);
    expect(first).toBe(componentStateKey(input));
  });

  it('normalizes only conservative state-key spellings', () => {
    expect(normalizeStateKey('demo')).toBe('demo');
    expect(normalizeStateKey(' demo ')).toBe('demo');
    expect(normalizeStateKey('demo-2')).toBe('demo-2');
    expect(normalizeStateKey('has space')).toBeUndefined();
    expect(normalizeStateKey('')).toBeUndefined();
    expect(normalizeStateKey(undefined)).toBeUndefined();
  });

  it('derives stable, independent seeds without call-order dependence', () => {
    const a = deriveSeed(7, 'left');
    const b = deriveSeed(7, 'right');
    expect(a).not.toBe(b);
    expect(deriveSeed(7, 'left')).toBe(a);
    expect(deriveRandom(7, 'left').state).toBe(a);
    expect(resolveComponentSeed({
      documentSeed: 7,
      componentId: 'example/game',
      nodeId: 'local-1',
      stateKey: 'demo',
    })).toBe(resolveComponentSeed({
      documentSeed: 7,
      componentId: 'example/game',
      nodeId: 'local-9',
      stateKey: 'demo',
    }));
  });

  it('lets an explicit component seed win', () => {
    expect(resolveComponentSeed({
      explicitSeed: 42,
      documentSeed: 1,
      componentId: 'example/game',
      nodeId: 'local-1',
    })).toBe(42);
  });
});

describe('seeded randomness', () => {
  it('is a pure state machine', () => {
    const start = createRandom(7);
    const first = nextRandom(start);
    const again = nextRandom(start);
    expect(first.value).toBe(again.value);
    expect(first.state).toEqual(again.state);
    expect(first.value).toBeGreaterThanOrEqual(0);
    expect(first.value).toBeLessThan(1);
  });

  it('produces the same sequence for the same seed', () => {
    const sequence = (seed: number): number[] => {
      let state = createRandom(seed);
      const values: number[] = [];
      for (let index = 0; index < 8; index += 1) {
        const step = nextRandom(state);
        values.push(step.value);
        state = step.state;
      }
      return values;
    };
    expect(sequence(7)).toEqual(sequence(7));
    expect(sequence(7)).not.toEqual(sequence(8));
  });

  it('returns inclusive integers and shuffles a copy', () => {
    let state = createRandom(11);
    const values = new Set<number>();
    for (let index = 0; index < 100; index += 1) {
      const step = randomInt(state, 3, 5);
      values.add(step.value);
      state = step.state;
    }
    expect([...values].sort()).toEqual([3, 4, 5]);
    expect(randomInt(createRandom(1), Number.NaN, 5).value).toBe(0);

    const input = [1, 2, 3, 4, 5];
    const shuffled = shuffleRandom(createRandom(3), input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect(shuffled.items.slice().sort()).toEqual(input);
  });

  it('validates saved random state', () => {
    const state = createRandom(9);
    expect(normalizeRandomState(state)).toEqual(state);
    expect(normalizeRandomState({ ...state, state: -1 })).toBeNull();
    expect(normalizeRandomState({ ...state, algorithm: 'other' })).toBeNull();
    expect(normalizeRandomState({ ...state, version: 2 })).toBeNull();
  });
});
