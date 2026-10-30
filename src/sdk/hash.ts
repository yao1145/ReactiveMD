/**
 * Deterministic, non-cryptographic digest for SDK semantic identity.
 *
 * The digest is stable across processes and platforms (unlike object identity
 * or `Math.random`), and is used only to detect contract changes. It is not a
 * security primitive: document payloads must still be validated by the
 * receiving side.
 */
export function localHash(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  const length = text.length;
  first ^= length;
  first = Math.imul(first, 0x01000193) >>> 0;
  second ^= length;
  second = Math.imul(second, 0xc2b2ae35) >>> 0;
  return `rmd-${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}
