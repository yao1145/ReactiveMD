import {
  LOCAL_CONFIG_PROTOCOL,
  LOCAL_CONFIG_PROTOCOL_V2,
} from './version';

/**
 * Versioned, SDK-built-in compatibility profiles for legacy configuration
 * protocols.
 *
 * A profile is plain data. It records the old preset identity and the legacy
 * key profile the SDK is allowed to accept; old identities are never inferred
 * from `LOCAL_SDK_VERSION`. The optional component snapshot is a complete view
 * of the legacy default preset's semantic manifests. When present, a reader
 * must verify it against the installed default components before emitting an
 * alias.
 */

export interface LocalCompatPresetIdentity {
  readonly id: string;
  readonly version: string;
}

export interface LocalCompatLegacyKeyProfile {
  /** Value emitted in `LocalConfig.legacyKeys[].profile`. */
  readonly profile: string;
  /** Serialization rules used for that alias. */
  readonly algorithm: 'external-components/v1';
}

export interface LocalCompatComponentSemantics {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

export interface LocalCompatProfile {
  readonly name: string;
  /** Legacy configuration protocol this profile reads. */
  readonly protocol: typeof LOCAL_CONFIG_PROTOCOL;
  /** Released SDK version range that produced artifacts for this profile. */
  readonly sdkRange: string;
  /** Map target configuration protocol. */
  readonly targetProtocol: typeof LOCAL_CONFIG_PROTOCOL_V2;
  /** SDK version range this profile may migrate to. */
  readonly targetSdkRange: string;
  /** Exact legacy default preset identity. */
  readonly preset: LocalCompatPresetIdentity;
  /** Legacy key profiles the SDK may emit or accept for this identity. */
  readonly legacyKeys: readonly LocalCompatLegacyKeyProfile[];
  /** Complete optional semantic snapshot of the legacy default components. */
  readonly components?: readonly LocalCompatComponentSemantics[];
  /** Provenance: tag and file that establish this entry. */
  readonly source: string;
}

/**
 * The only released SDK line that emitted `reactive-md-config/v1` is 0.7.0.
 * Tags v0.5.x and v0.6.x predate the SDK configuration protocol, so they have
 * no v1 artifact identity to map.
 */
export const LOCAL_COMPAT_PROFILES: readonly LocalCompatProfile[] = Object.freeze([
  Object.freeze({
    name: 'reactive-md-config/v1@0.7.0',
    protocol: LOCAL_CONFIG_PROTOCOL,
    sdkRange: '0.7.0',
    targetProtocol: LOCAL_CONFIG_PROTOCOL_V2,
    targetSdkRange: '0.7.0',
    preset: Object.freeze({ id: 'reactive-md/default', version: '0.7.0' }),
    legacyKeys: Object.freeze([
      Object.freeze({ profile: LOCAL_CONFIG_PROTOCOL, algorithm: 'external-components/v1' as const }),
    ]),
    source: 'git tag v0.7.0:src/presets/default.ts and src/sdk/config.ts; docs/compatibility/compatibility-ch.md',
  }),
]);

/** Find an exact preset-identity match; no version-range guessing. */
export function findLocalCompatProfile(
  preset: LocalCompatPresetIdentity,
  profiles: readonly LocalCompatProfile[] = LOCAL_COMPAT_PROFILES,
): LocalCompatProfile | undefined {
  for (const profile of profiles) {
    if (profile.preset.id === preset.id && profile.preset.version === preset.version) return profile;
  }
  return undefined;
}

/** SDK built-in profiles plus explicitly supplied extensions. */
export function localCompatProfiles(
  additional: readonly LocalCompatProfile[] = [],
): readonly LocalCompatProfile[] {
  return additional.length === 0
    ? LOCAL_COMPAT_PROFILES
    : Object.freeze([...LOCAL_COMPAT_PROFILES, ...additional]);
}
