/**
 * Publish compiler-owned data as ordinary records and arrays. Internal maps can
 * keep null prototypes; React Server Component props require ordinary records.
 * Keep undefined fields, shared references and existing frozen metadata intact.
 */
export function plainCompiledData<T>(value: T, preserveFrozen = true): T {
  const seen = new WeakMap<object, object>();
  const pending: {input: object; output: object}[] = [];
  const allocate = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input;
    const existing = seen.get(input);
    if (existing) return existing;
    const output = Array.isArray(input) ? new Array(input.length) : {};
    seen.set(input, output);
    pending.push({input, output});
    return output;
  };
  const result = allocate(value);
  while (pending.length) {
    const {input, output} = pending.pop()!;
    for (const [key, child] of Object.entries(input)) {
      // Defining own data properties avoids invoking Object.prototype setters
      // for keys such as __proto__, without dropping source dictionary entries.
      Object.defineProperty(output, key, {
        value: allocate(child), enumerable: true, configurable: true, writable: true,
      });
    }
    if (preserveFrozen && Object.isFrozen(input)) Object.freeze(output);
  }
  return result as T;
}
