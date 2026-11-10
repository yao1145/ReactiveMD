/**
 * Document-level runtime services. The compiler never imports this module.
 */

import type { Diagnostic } from '../local/contracts/types';
import {
  fnv1a32,
  localSourceDigest,
  resolveDocumentId,
} from './identity';
import {
  createLocalComponentStateRegistry,
  type LocalComponentStateDocument,
  type LocalComponentStateRegistry,
  type LocalComponentStateStorage,
} from './component-state';
import {
  createLocalScheduler,
  type LocalClock,
  type LocalScheduler,
  type LocalSchedulerOptions,
} from './scheduler';

export interface LocalRuntimeServices {
  /** Stable identity used to scope component state. */
  readonly documentId: string;
  /** Digest of the exact source that created the runtime. */
  readonly sourceDigest: string;
  /** Host document seed; explicit component `seed` props still win. */
  readonly randomSeed: number;
  readonly clock: LocalClock;
  readonly scheduler: LocalScheduler;
  readonly state: LocalComponentStateRegistry;
}

export interface CreateLocalRuntimeServicesOptions {
  readonly documentId?: string;
  readonly sourceDigest: string;
  readonly randomSeed?: number;
  /** Restore a component-state sidecar before the first render. */
  readonly componentState?: unknown;
  /** Persistence port for component state; omitted keeps everything in memory. */
  readonly componentStateStorage?: LocalComponentStateStorage;
  /** Keys currently present in the document; unknown saved keys are skipped. */
  readonly knownStateKeys?: ReadonlySet<string> | (() => ReadonlySet<string>);
  /** Current semantic configuration key written to and checked against sidecars. */
  readonly configKey?: string;
  /** Legacy configuration identities accepted when restoring a sidecar. */
  readonly legacyConfigKeys?: readonly string[];
  /** Inject a scheduler, for example a fake clock in tests. */
  readonly scheduler?: LocalScheduler;
  readonly schedulerOptions?: LocalSchedulerOptions;
}

function clockFor(scheduler: LocalScheduler): LocalClock {
  return {
    now: () => scheduler.now(),
    activeNow: () => scheduler.activeNow(),
    get suspended(): boolean {
      return scheduler.suspended;
    },
  };
}

export function createLocalRuntimeServices(
  options: CreateLocalRuntimeServicesOptions,
): LocalRuntimeServices {
  const documentId = resolveDocumentId(options);
  const scheduler = options.scheduler ?? createLocalScheduler(options.schedulerOptions);
  const randomSeed = typeof options.randomSeed === 'number' && Number.isFinite(options.randomSeed)
    ? Math.trunc(options.randomSeed) >>> 0
    : fnv1a32(documentId);
  return Object.freeze({
    documentId,
    sourceDigest: options.sourceDigest,
    randomSeed,
    clock: clockFor(scheduler),
    scheduler,
    state: createLocalComponentStateRegistry({
      documentId,
      sourceDigest: options.sourceDigest,
      initial: options.componentState,
      ...(options.componentStateStorage === undefined ? {} : { storage: options.componentStateStorage }),
      ...(options.knownStateKeys === undefined ? {} : { knownKeys: options.knownStateKeys }),
      ...(options.configKey === undefined ? {} : { configKey: options.configKey }),
      ...(options.legacyConfigKeys === undefined ? {} : { legacyConfigKeys: options.legacyConfigKeys }),
    }),
  });
}

/**
 * Services for hand-built contexts that have no runtime-owned environment.
 * The scheduler is inert; saving state stays in memory.
 */
export function createDetachedRuntimeServices(
  options?: { documentId?: string; sourceDigest?: string; randomSeed?: number },
): LocalRuntimeServices {
  const sourceDigest = options?.sourceDigest ?? localSourceDigest('');
  const scheduler = createLocalScheduler({
    ports: {
      now: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => {},
      isHidden: () => false,
      subscribeVisibility: () => () => {},
    },
  });
  return createLocalRuntimeServices({
    ...options,
    sourceDigest,
    scheduler,
  });
}

export type { Diagnostic, LocalComponentStateDocument };
