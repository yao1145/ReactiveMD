import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten-core';
import { MAX_LOCAL_ARRAY_LENGTH, MAX_LOCAL_STRING_LENGTH } from '../../contracts/limits';
import type { LocalValue } from '../types';
import {
  COUNTER_ACTIONS,
  type AuthorAction,
  type AuthorActionRegistration,
  type AuthorBindingReply,
  type AuthorBindingRequest,
} from './author-script-protocol';

const MAX_REQUESTS = 128;
const MAX_JOBS = 1024;
const STEP_MILLISECONDS = 1_000;
const MAX_BLOCKS = 128;
const MAX_ACTION_HANDLERS = 128;
const MAX_NAME_LENGTH = 128;

type ScriptHandlers = {
  registration: AuthorActionRegistration;
  callback: QuickJSHandle;
  block: number;
};

function authorName(vm: QuickJSContext, value: QuickJSHandle | undefined): string {
  if (!value || vm.typeof(value) !== 'string') throw new Error('Expected a name.');
  const name = vm.getString(value);
  if (name.length > MAX_NAME_LENGTH || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error('Invalid name.');
  }
  return name;
}

function readValue(vm: QuickJSContext, isArray: QuickJSHandle, value: QuickJSHandle | undefined): LocalValue {
  if (!value) throw new Error('Expected a binding value.');
  switch (vm.typeof(value)) {
    case 'string': {
      const text = vm.getString(value);
      if (text.length > MAX_LOCAL_STRING_LENGTH) throw new Error('Binding value is too long.');
      return text;
    }
    case 'boolean':
      return vm.eq(value, vm.true);
    case 'number': {
      const number = vm.getNumber(value);
      if (!Number.isFinite(number)) throw new Error('Expected a finite number.');
      return number;
    }
    case 'object':
      if (vm.eq(value, vm.null)) return null;
  }
  if (vm.typeof(value) !== 'object'
    || !vm.unwrapResult(vm.callFunction(isArray, vm.undefined, value)).consume(result => vm.eq(result, vm.true))) {
    throw new Error('Expected a scalar or a homogeneous array.');
  }
  const length = vm.getLength(value);
  if (length === undefined || length > MAX_LOCAL_ARRAY_LENGTH) throw new Error('Binding array is too large.');
  const items: (number | string)[] = [];
  for (let index = 0; index < length; index++) {
    using item = vm.getProp(value, index);
    const kind = vm.typeof(item);
    if (kind !== 'number' && kind !== 'string') throw new Error('Expected an array of strings or numbers.');
    const scalar = readValue(vm, isArray, item) as number | string;
    if (items.length && typeof items[0] !== typeof scalar) throw new Error('Expected a homogeneous array.');
    items.push(scalar);
  }
  return items as string[] | number[];
}

function guestValue(vm: QuickJSContext, value: LocalValue | undefined): QuickJSHandle {
  if (value === undefined) return vm.undefined;
  if (value === null) return vm.null;
  if (typeof value === 'boolean') return value ? vm.true : vm.false;
  if (typeof value === 'number') return vm.newNumber(value);
  if (typeof value === 'string') return vm.newString(value);
  const array = vm.newArray();
  for (const [index, item] of value.entries()) {
    using handle = guestValue(vm, item);
    vm.setProp(array, index, handle);
  }
  return array;
}

function guestError(vm: QuickJSContext, error: QuickJSHandle): Error {
  // Reading a guest exception through JSON would invoke its own accessors.
  if (vm.typeof(error) === 'string') return new Error(vm.getString(error).slice(0, 300));
  try {
    using message = vm.getProp(error, 'message');
    if (vm.typeof(message) === 'string') return new Error(vm.getString(message).slice(0, 300));
  } catch {
    // A thrown proxy may reject inspection.
  }
  return new Error('Author JavaScript threw an exception.');
}

export async function createAuthorScriptVm(
  targets: readonly string[],
  request: (value: AuthorBindingRequest) => Promise<AuthorBindingReply>,
  register: (registrations: AuthorActionRegistration[]) => void,
  report: (block: number, message: string) => void,
) {
  const module = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  const vm = runtime.newContext();
  let deadline = 0;
  runtime.setInterruptHandler(() => performance.now() > deadline);
  const allowed = new Set(targets);
  const handlers: ScriptHandlers[] = [];
  let staging: ScriptHandlers[] | undefined;
  let block = 0;
  let requestCount = 0;
  let pending = new Set<Promise<void>>();
  let failure: Error | undefined;
  deadline = performance.now() + STEP_MILLISECONDS;
  const isArray = vm.unwrapResult(vm.evalCode('Array.isArray'));
  using api = vm.newObject();

  function bridge(value: AuthorBindingRequest): QuickJSHandle {
    if (++requestCount > MAX_REQUESTS) throw new Error('Author JavaScript exceeded the binding request budget.');
    const deferred = vm.newPromise();
    const result = deferred.handle.dup();
    const requests = pending;
    const complete = request(value).then(reply => {
      if (!deferred.alive) return;
      if (reply.ok) {
        using handle = guestValue(vm, reply.value);
        deferred.resolve(handle);
      } else {
        using error = vm.newError(reply.message.slice(0, 300));
        deferred.reject(error);
      }
    }).catch(error => {
      failure = error instanceof Error ? error : new Error('Binding request failed.');
    }).finally(() => {
      deferred.dispose();
      requests.delete(complete);
    });
    requests.add(complete);
    return result;
  }

  using get = vm.newFunction('get', name => bridge({ operation: 'get', name: authorName(vm, name) }));
  using set = vm.newFunction('set', (name, value) => bridge({
    operation: 'set', name: authorName(vm, name), value: readValue(vm, isArray, value),
  }));
  using setMany = vm.newFunction('setMany', handle => {
    if (!handle || vm.typeof(handle) !== 'object' || vm.eq(handle, vm.null)) throw new Error('Expected a binding record.');
    using names = vm.unwrapResult(vm.getOwnPropertyNames(handle, { strings: true, onlyEnumerable: true }));
    if (names.length > MAX_REQUESTS) throw new Error('Too many bindings in one update.');
    const values: Record<string, LocalValue> = Object.create(null);
    for (const key of names) {
      const name = authorName(vm, key);
      using value = vm.getProp(handle, key);
      values[name] = readValue(vm, isArray, value);
    }
    return bridge({ operation: 'setMany', values });
  });
  const action = (takeover: boolean, targetValue: QuickJSHandle, actionValue: QuickJSHandle, callback: QuickJSHandle) => {
    const target = authorName(vm, targetValue);
    const name = authorName(vm, actionValue) as AuthorAction;
    if (!staging) throw new Error('Register actions during script initialization.');
    if (!allowed.has(target) || !COUNTER_ACTIONS.includes(name) || !callback || vm.typeof(callback) !== 'function') {
      throw new Error('Invalid action registration.');
    }
    if (handlers.length + staging.length >= MAX_ACTION_HANDLERS) throw new Error('Too many action handlers.');
    if (takeover && [...handlers, ...staging].some(({ registration: item }) =>
      item.takeover && item.target === target && item.action === name)) throw new Error('This action already has a handler.');
    staging.push({ registration: { target, action: name, takeover }, callback: callback.dup(), block });
  };
  using handleAction = vm.newFunction('handleAction', (...args) => action(true, args[0], args[1], args[2]));
  using observeAction = vm.newFunction('observeAction', (...args) => action(false, args[0], args[1], args[2]));
  vm.setProp(api, 'get', get);
  vm.setProp(api, 'set', set);
  vm.setProp(api, 'setMany', setMany);
  vm.setProp(api, 'handleAction', handleAction);
  vm.setProp(api, 'observeAction', observeAction);
  vm.setProp(vm.global, 'rmd', api);
  vm.evalCode('Object.defineProperty(globalThis, "rmd", { value: Object.freeze(rmd), writable: false, configurable: false });').dispose();

  async function settle(output: QuickJSHandle): Promise<void> {
    let jobs = 0;
    for (;;) {
      if (failure) throw failure;
      if (performance.now() > deadline || jobs >= MAX_JOBS) throw new Error('Author JavaScript exceeded its execution budget.');
      if (runtime.hasPendingJob()) {
        const result = runtime.executePendingJobs(Math.min(64, MAX_JOBS - jobs));
        if (result.error) {
          using error = result.error;
          throw guestError(vm, error);
        }
        jobs += result.value;
      }
      const state = vm.getPromiseState(output);
      if (state.type === 'rejected') {
        using error = state.error;
        throw guestError(vm, error);
      }
      if (state.type === 'fulfilled') {
        if (state.value !== output) state.value.dispose();
        if (!pending.size && !runtime.hasPendingJob()) return;
      } else if (!pending.size && !runtime.hasPendingJob()) {
        throw new Error('Author JavaScript is waiting for an unavailable operation.');
      }
      if (pending.size) {
        const waitingSince = performance.now();
        await Promise.race(pending);
        deadline += performance.now() - waitingSince;
      }
    }
  }

  async function run(index: number, evaluate: () => ReturnType<QuickJSContext['evalCode']>): Promise<boolean> {
    deadline = performance.now() + STEP_MILLISECONDS;
    pending = new Set();
    failure = undefined;
    requestCount = 0;
    try {
      const result = evaluate();
      if (result.error) {
        using error = result.error;
        throw guestError(vm, error);
      }
      using output = result.value;
      await settle(output);
      return true;
    } catch (error) {
      report(index, error instanceof Error ? error.message.slice(0, 300) : 'Author JavaScript failed.');
      // Drain replies for requests already sent before moving to the next block.
      await Promise.all(pending);
      if (runtime.hasPendingJob()) {
        // A failed step can leave queued guest work. End the VM before another
        // step could execute it with the new step's write permissions.
        throw new Error('Author JavaScript left pending jobs after a failed step.');
      }
      return false;
    }
  }

  return {
    async initialize(blocks: readonly string[]) {
      if (blocks.length > MAX_BLOCKS) throw new Error('Too many author JavaScript blocks.');
      for (block = 0; block < blocks.length; block++) {
        staging = [];
        const text = blocks[block];
        try {
          if (await run(block, () => vm.evalCode(
            `(async () => {\n"use strict";\n${text}\n})()`,
            `document-block-${block + 1}.js`,
          ))) {
            handlers.push(...staging);
            if (staging.length) register(staging.map(item => item.registration));
            staging = undefined;
          }
        } finally {
          staging?.forEach(item => item.callback.dispose());
          staging = undefined;
        }
      }
    },
    async dispatch(target: string, name: AuthorAction) {
      const candidates = handlers.filter(({ registration }) => registration.target === target && registration.action === name);
      candidates.sort((a, b) => Number(b.registration.takeover) - Number(a.registration.takeover));
      for (const item of candidates) await run(item.block, () => vm.callFunction(item.callback, vm.undefined));
    },
    dispose() {
      handlers.forEach(item => item.callback.dispose());
      isArray.dispose();
      vm.dispose();
      runtime.dispose();
    },
  };
}
