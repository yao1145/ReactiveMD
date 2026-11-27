import type { LocalEmbeddingOptions } from '../types';

export const LOCAL_EMBEDDING_PROFILE_VERSION = 1;

const defaults: Readonly<Required<LocalEmbeddingOptions>> = Object.freeze({
  expressions: 'evaluate',
  onUnsupported: 'error',
  allowImages: true,
  allowInteractive: true,
});

export function readEmbedding(value: unknown): Readonly<Required<LocalEmbeddingOptions>> | null {
  if (value === undefined) return defaults;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const profile = { ...defaults };
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(defaults, key)) return null;
    if (item === undefined) continue;
    switch (key) {
      case 'expressions':
        if (item !== 'evaluate' && item !== 'literal') return null;
        profile.expressions = item;
        break;
      case 'onUnsupported':
        if (item !== 'error' && item !== 'fallback') return null;
        profile.onUnsupported = item;
        break;
      case 'allowImages':
      case 'allowInteractive':
        if (typeof item !== 'boolean') return null;
        profile[key] = item;
        break;
    }
  }
  return Object.keys(defaults).every(key => profile[key as keyof LocalEmbeddingOptions] === defaults[key as keyof LocalEmbeddingOptions])
    ? defaults : Object.freeze(profile);
}

export function embeddingKey(value: unknown): string {
  const profile = readEmbedding(value);
  if (!profile) return ':embedding=invalid';
  return profile === defaults ? '' : `:embedding=${LOCAL_EMBEDDING_PROFILE_VERSION}:${Object.values(profile).join(':')}`;
}
