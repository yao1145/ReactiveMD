/**
 * Publish compiler-owned data as ordinary records and arrays. Internal maps can
 * keep null prototypes; React Server Component props require ordinary records.
 * Keep undefined fields, shared references and existing frozen metadata intact.
 */
export function plainCompiledData<T>(value: T): T {
  const seen = new WeakMap<object, object>();
  const visit = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input;
    const existing = seen.get(input);
    if (existing) return existing;
    const output = Array.isArray(input) ? [] : {};
    seen.set(input, output);
    for (const [key, child] of Object.entries(input)) {
      // Defining own data properties avoids invoking Object.prototype setters
      // for keys such as __proto__, without dropping source dictionary entries.
      Object.defineProperty(output, key, {
        value: visit(child), enumerable: true, configurable: true, writable: true,
      });
    }
    return Object.isFrozen(input) ? Object.freeze(output) : output;
  };
  return visit(value) as T;
}
