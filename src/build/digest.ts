import { createHash } from 'node:crypto';

/** Byte length of one UTF-8 string; build budgets are byte based. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Stable content digest for build artifacts. */
export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
