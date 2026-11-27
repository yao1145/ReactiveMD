import { createLocalRuntime } from './runtime';
import { localDataEqual } from '../transport/compile-patch';
import type { LocalDocument, LocalRuntime, LocalRuntimeOptions } from '../types';

export interface LocalRuntimePoolOptions {
  readonly idleDisposeMs?: number;
  readonly maxIdle?: number;
}

export interface LocalRuntimeLease {
  readonly runtime: LocalRuntime;
  release(): void;
}

export interface LocalRuntimePool {
  acquire(document: LocalDocument, options?: LocalRuntimeOptions): LocalRuntimeLease;
  dispose(): void;
}

interface Entry {
  runtime: LocalRuntime;
  options: LocalRuntimeOptions;
  leases: number;
  timer?: ReturnType<typeof setTimeout>;
}

function equalOptions(left: LocalRuntimeOptions, right: LocalRuntimeOptions): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as (keyof LocalRuntimeOptions)[]);
  return [...keys].every(key => Object.is(left[key], right[key]));
}

export function createLocalRuntimePool({ idleDisposeMs = 0, maxIdle = 8 }: LocalRuntimePoolOptions = {}): LocalRuntimePool {
  if (!Number.isInteger(maxIdle) || maxIdle < 0 || !Number.isFinite(idleDisposeMs)
    || idleDisposeMs < 0 || idleDisposeMs > 2_147_483_647) throw new RangeError('Invalid runtime pool capacity or idle delay.');
  const entries = new Set<Entry>();
  const idle = new Set<Entry>();
  let disposed = false;

  function remove(entry: Entry): void {
    entries.delete(entry);
    idle.delete(entry);
    clearTimeout(entry.timer);
    entry.runtime.dispose();
  }

  return {
    acquire(document, options = {}) {
      if (disposed) throw new Error('The local runtime pool is disposed.');
      let entry = [...entries].find(candidate => candidate.runtime.document.source === document.source
        && equalOptions(candidate.options, options) && localDataEqual(candidate.runtime.document, document));
      if (!entry) {
        entry = { runtime: createLocalRuntime(document, options), options: { ...options }, leases: 0 };
        entries.add(entry);
      }
      const leased = entry;
      idle.delete(leased);
      clearTimeout(leased.timer);
      leased.leases++;
      let released = false;
      return {
        runtime: leased.runtime,
        release() {
          if (released) return;
          released = true;
          if (--leased.leases) return;
          if (disposed) { remove(leased); return; }
          idle.add(leased);
          leased.timer = setTimeout(() => remove(leased), idleDisposeMs);
          while (idle.size > maxIdle) remove(idle.values().next().value!);
        },
      };
    },
    dispose() {
      disposed = true;
      for (const entry of idle) remove(entry);
    },
  };
}
