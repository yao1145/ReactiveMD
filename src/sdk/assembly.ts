import { localHash } from './hash';
import { findLocalCompatProfile } from './compat-profile';
import type { LocalCompatProfile } from './compat-profile';
import {
  isLocalComponentId,
  localComponentDigest,
  localComponentRequirement,
  localStructureFromChildren,
  readLocalComponentManifest,
} from './manifest';
import { localPresetDigest, readLocalPresetPackage } from './preset-core';
import type { LocalStyleResource, LocalThemePackage } from './theme';
import {
  LOCAL_ASSEMBLY_PROTOCOL,
  LOCAL_CONFIG_PROTOCOL,
  LOCAL_CONFIG_PROTOCOL_V2,
  LOCAL_SDK_VERSION,
  isLocalVersion,
  localVersionSatisfies,
  parseLocalVersionRange,
} from './version';
import type {
  LocalAssemblySnapshot,
  LocalComponentAuthoring,
  LocalComponentDefinition,
  LocalComponentProp,
  LocalComponentReplacement,
  LocalComponentRequirement,
  LocalLegacyConfigKey,
  LocalReplacementRecord,
  LocalResolvedPreset,
} from './types';

/**
 * Deterministic assembly resolver.
 *
 * The resolver is the only place that turns pre-replacement contributions into
 * an active registry. Both the SDK reader and the compiler reader use it, so a
 * transported snapshot cannot acquire a different meaning at a second entry
 * point.
 */

export interface ResolvedLocalAssembly {
  readonly presets: readonly LocalResolvedPreset[];
  readonly components: readonly LocalComponentDefinition[];
  readonly replacements: readonly LocalReplacementRecord[];
  readonly registry: readonly LocalComponentDefinition[];
  readonly themes: readonly LocalThemePackage[];
  readonly key: string;
}

interface PresetOrigin {
  readonly kind: 'preset';
  readonly id: string;
}

interface ExternalOrigin {
  readonly kind: 'external';
}

type ContributionOrigin = PresetOrigin | ExternalOrigin;

interface Contribution {
  readonly definition: LocalComponentDefinition;
  readonly origin: ContributionOrigin;
  readonly index: number;
}

interface ActiveContribution extends Contribution {
  readonly position: number;
  /** Authoring after preset overrides and replacement fallback. */
  readonly authoring?: LocalComponentAuthoring;
}

const SNAPSHOT_KEYS = new Set(['protocol', 'presets', 'components', 'replacementPolicy', 'themes']);
const MAX_ASSEMBLY_PRESETS = 32;
const MAX_ASSEMBLY_COMPONENTS = 256;
const MAX_ASSEMBLY_THEMES = 32;

function fail(path: string, message: string): never {
  throw new Error(`Invalid local SDK config (${path}): ${message}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortById<T>(items: readonly T[], id: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareText(id(a), id(b)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(compareText)) out[key] = stableValue(value[key]);
    return out;
  }
  return value;
}

function sameSemantics(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function readAssemblyPresets(value: unknown): readonly import('./types').LocalPresetPackage[] {
  if (!Array.isArray(value)) fail('assembly.presets', 'must be an array.');
  if (value.length > MAX_ASSEMBLY_PRESETS) {
    fail('assembly.presets', `accepts at most ${MAX_ASSEMBLY_PRESETS} packages.`);
  }
  const presets = sortById(value.map((entry, index) => {
    try {
      return readLocalPresetPackage(entry);
    } catch (error) {
      fail(`assembly.presets[${index}]`, error instanceof Error ? error.message : String(error));
    }
  }), (preset) => preset.id);
  const seen = new Set<string>();
  for (const preset of presets) {
    if (seen.has(preset.id)) fail('assembly.presets', `preset "${preset.id}" is selected more than once.`);
    seen.add(preset.id);
  }
  return Object.freeze(presets);
}

function readAssemblyComponents(value: unknown): readonly LocalComponentDefinition[] {
  if (!Array.isArray(value)) fail('assembly.components', 'must be an array.');
  if (value.length > MAX_ASSEMBLY_COMPONENTS) {
    fail('assembly.components', `accepts at most ${MAX_ASSEMBLY_COMPONENTS} components.`);
  }
  const components = sortById(value.map((entry, index) => {
    try {
      return readLocalComponentManifest(entry);
    } catch (error) {
      fail(`assembly.components[${index}]`, error instanceof Error ? error.message : String(error));
    }
  }), (component) => component.id);
  return Object.freeze(components);
}

/**
 * Host themes are opaque bounded data at this layer. The full SDK reader
 * revalidates them through `defineLocalTheme`; the compiler projection must not
 * load theme CSS validation.
 */
function readAssemblyThemes(value: unknown): readonly LocalThemePackage[] {
  if (!Array.isArray(value)) fail('assembly.themes', 'must be an array.');
  if (value.length > MAX_ASSEMBLY_THEMES) fail('assembly.themes', `accepts at most ${MAX_ASSEMBLY_THEMES} themes.`);
  const ids = new Set<string>();
  return Object.freeze(sortById(value.map((entry, index) => {
    if (!isRecord(entry)) fail(`assembly.themes[${index}]`, 'must be an object.');
    const id = entry.id;
    const name = entry.name;
    const version = entry.version;
    if (typeof id !== 'string' || id.length === 0) fail(`assembly.themes[${index}].id`, 'must be a non-empty string.');
    if (typeof name !== 'string' || name.length === 0) fail(`assembly.themes[${index}].name`, 'must be a non-empty string.');
    if (typeof version !== 'string' || !isLocalVersion(version)) {
      fail(`assembly.themes[${index}].version`, 'must be a semantic version.');
    }
    if (ids.has(id)) fail('assembly.themes', `theme id "${id}" is declared more than once.`);
    ids.add(id);
    return Object.freeze({ ...entry }) as unknown as LocalThemePackage;
  }), (theme) => theme.id));
}

/** Validate and freeze a transported assembly snapshot. */
export function readLocalAssemblySnapshot(value: unknown): LocalAssemblySnapshot {
  if (!isRecord(value)) fail('assembly', 'must be an object.');
  for (const key of Object.keys(value)) {
    if (!SNAPSHOT_KEYS.has(key)) fail('assembly', `unknown field "${key}".`);
  }
  if (value.protocol !== LOCAL_ASSEMBLY_PROTOCOL) {
    fail('assembly.protocol', `must be "${LOCAL_ASSEMBLY_PROTOCOL}".`);
  }
  const replacementPolicy = value.replacementPolicy;
  if (replacementPolicy !== 'allow' && replacementPolicy !== 'forbid') {
    fail('assembly.replacementPolicy', 'must be "allow" or "forbid".');
  }
  return Object.freeze({
    protocol: LOCAL_ASSEMBLY_PROTOCOL,
    presets: readAssemblyPresets(value.presets),
    components: readAssemblyComponents(value.components),
    replacementPolicy,
    themes: readAssemblyThemes(value.themes),
  });
}

function orderPresets(
  presets: readonly import('./types').LocalPresetPackage[],
): readonly import('./types').LocalPresetPackage[] {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const state = new Map<string, 'visiting' | 'done'>();
  const ordered: import('./types').LocalPresetPackage[] = [];
  const visit = (id: string): void => {
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') fail('assembly.presets', `preset dependency cycle at "${id}".`);
    const preset = byId.get(id);
    if (!preset) fail('assembly.presets', `missing preset dependency "${id}".`);
    state.set(id, 'visiting');
    for (const dependency of sortById(preset.dependencies ?? [], (item) => item.id)) {
      const target = byId.get(dependency.id);
      if (!target) fail('assembly.presets', `preset "${preset.id}" requires missing preset "${dependency.id}".`);
      if (!isLocalVersion(dependency.version)) {
        fail('assembly.presets', `preset dependency "${dependency.id}" must use an exact version.`);
      }
      if (target.version !== dependency.version) {
        fail(
          'assembly.presets',
          `preset "${preset.id}" requires "${dependency.id}" ${dependency.version}, but ${target.version} is installed.`,
        );
      }
      visit(dependency.id);
    }
    state.set(id, 'done');
    ordered.push(preset);
  };
  for (const id of [...byId.keys()].sort(compareText)) visit(id);
  return Object.freeze(ordered);
}

function defineOrigin(contribution: Contribution): string {
  return contribution.origin.kind === 'preset' ? `preset:${contribution.origin.id}` : 'external';
}

function propSemantics(prop: LocalComponentProp): unknown {
  const { description: _description, ...rest } = prop;
  return rest;
}

function structureOf(definition: LocalComponentDefinition): unknown {
  return definition.structure ?? localStructureFromChildren(definition.children) ?? null;
}

function capabilitySuperset(
  replacement: LocalComponentDefinition,
  target: LocalComponentDefinition,
): boolean {
  for (const key of ['interactive', 'static', 'ssr', 'offline'] as const) {
    if (target.capabilities[key] && !replacement.capabilities[key]) return false;
  }
  return true;
}

function assertReplacementCompatible(
  target: Contribution,
  replacement: Contribution,
): void {
  const base = target.definition;
  const next = replacement.definition;
  const path = `assembly.replacements["${base.id}"]`;
  if (base.id !== next.id || base.name !== next.name) {
    fail(path, 'the replacement must keep the target id and tag name.');
  }
  if (base.form !== next.form) fail(path, 'the replacement must keep the target form.');
  for (const name of Object.keys(base.props)) {
    const targetProp = base.props[name];
    const nextProp = next.props[name];
    if (!nextProp) fail(path, `the replacement removed prop "${name}".`);
    if (!sameSemantics(propSemantics(targetProp), propSemantics(nextProp))) {
      fail(path, `the replacement changed the semantics of prop "${name}".`);
    }
  }
  for (const name of Object.keys(next.props)) {
    if (Object.hasOwn(base.props, name)) continue;
    if (next.props[name].required === true) {
      fail(path, `the replacement added required prop "${name}".`);
    }
  }
  const baseBindings = base.bindings ?? {};
  const nextBindings = next.bindings ?? {};
  const baseSlots = Object.keys(baseBindings).sort(compareText);
  const nextSlots = Object.keys(nextBindings).sort(compareText);
  if (!sameSemantics(baseSlots, nextSlots)) {
    fail(path, 'the replacement must keep the target binding slots unchanged.');
  }
  for (const slot of baseSlots) {
    if (!sameSemantics(baseBindings[slot], nextBindings[slot])) {
      fail(path, `the replacement changed binding slot "${slot}".`);
    }
  }
  if (!sameSemantics(structureOf(base), structureOf(next))) {
    fail(path, 'the replacement changed the target child structure.');
  }
  if (!sameSemantics(base.rules ?? [], next.rules ?? [])) {
    fail(path, 'the replacement changed semantic rules.');
  }
  if (!sameSemantics(base.slotRelations ?? [], next.slotRelations ?? [])) {
    fail(path, 'the replacement changed slot relations.');
  }
  if ((base.legacyHost === true) !== (next.legacyHost === true)) {
    fail(path, 'the replacement changed legacyHost.');
  }
  if (!capabilitySuperset(next, base)) {
    fail(path, 'the replacement downgraded a declared capability.');
  }
}

function replacementMatches(target: LocalComponentDefinition, replacement: LocalComponentReplacement): boolean {
  if (target.id !== replacement.id) return false;
  if (replacement.version === undefined) return true;
  if (parseLocalVersionRange(replacement.version) === null) return false;
  return localVersionSatisfies(target.version, replacement.version);
}

function replacementRecord(target: Contribution, replacement: Contribution): LocalReplacementRecord {
  return Object.freeze({
    id: target.definition.id,
    name: target.definition.name,
    fromVersion: target.definition.version,
    toVersion: replacement.definition.version,
    fromDigest: localComponentDigest(target.definition),
    toDigest: localComponentDigest(replacement.definition),
    ...(target.origin.kind === 'preset' ? { fromPreset: target.origin.id } : {}),
    ...(replacement.origin.kind === 'preset' ? { toPreset: replacement.origin.id } : {}),
  });
}

function collectContributions(
  presets: readonly import('./types').LocalPresetPackage[],
  components: readonly LocalComponentDefinition[],
): Contribution[] {
  const contributions: Contribution[] = [];
  let index = 0;
  for (const preset of presets) {
    for (const definition of preset.components) {
      contributions.push({ definition, origin: { kind: 'preset', id: preset.id }, index });
      index += 1;
    }
  }
  for (const definition of sortById(components, (item) => item.id)) {
    contributions.push({ definition, origin: { kind: 'external' }, index });
    index += 1;
  }
  return contributions;
}

type PresetAuthoringIndex = ReadonlyMap<string, ReadonlyMap<string, LocalComponentAuthoring>>;

/** Preset authoring entries indexed by preset id and component id. */
function indexPresetAuthoring(
  presets: readonly import('./types').LocalPresetPackage[],
): PresetAuthoringIndex {
  const index = new Map<string, ReadonlyMap<string, LocalComponentAuthoring>>();
  for (const preset of presets) {
    if (preset.authoring === undefined || preset.authoring.length === 0) continue;
    index.set(
      preset.id,
      new Map(preset.authoring.map((entry) => [entry.componentId, entry.authoring] as const)),
    );
  }
  return index;
}

/**
 * Field-level authoring merge. Fields present on the override win; missing
 * fields keep the base value. Authoring never enters digests or keys.
 */
function mergeAuthoring(
  base: LocalComponentAuthoring | undefined,
  override: LocalComponentAuthoring | undefined,
): LocalComponentAuthoring | undefined {
  if (override === undefined) return base;
  if (base === undefined) return override;
  return Object.freeze({
    ...(base.title !== undefined ? { title: base.title } : {}),
    ...(base.description !== undefined ? { description: base.description } : {}),
    ...(base.category !== undefined ? { category: base.category } : {}),
    ...(base.insertText !== undefined ? { insertText: base.insertText } : {}),
    ...(override.title !== undefined ? { title: override.title } : {}),
    ...(override.description !== undefined ? { description: override.description } : {}),
    ...(override.category !== undefined ? { category: override.category } : {}),
    ...(override.insertText !== undefined ? { insertText: override.insertText } : {}),
  });
}

/** Manifest authoring with the contributing preset's override applied. */
function effectiveAuthoring(
  contribution: Contribution,
  presetAuthoring: PresetAuthoringIndex,
): LocalComponentAuthoring | undefined {
  const presetOverride = contribution.origin.kind === 'preset'
    ? presetAuthoring.get(contribution.origin.id)?.get(contribution.definition.id)
    : undefined;
  return mergeAuthoring(contribution.definition.authoring, presetOverride);
}

/** Revalidate and freeze a manifest carrying merged authoring. */
function withResolvedAuthoring(
  definition: LocalComponentDefinition,
  authoring: LocalComponentAuthoring | undefined,
): LocalComponentDefinition {
  if (authoring === undefined || authoring === definition.authoring) return definition;
  return readLocalComponentManifest({ ...definition, authoring });
}

function resolveContributions(
  contributions: readonly Contribution[],
  replacementPolicy: 'allow' | 'forbid',
  presetAuthoring: PresetAuthoringIndex,
): {
  readonly active: readonly ActiveContribution[];
  readonly replacements: readonly LocalReplacementRecord[];
} {
  const groups = new Map<string, Contribution[]>();
  for (const contribution of contributions) {
    const group = groups.get(contribution.definition.id);
    if (group) group.push(contribution);
    else groups.set(contribution.definition.id, [contribution]);
  }
  const active: ActiveContribution[] = [];
  const replacements: LocalReplacementRecord[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const only = group[0];
      if (only.definition.replaces !== undefined) {
        if (replacementPolicy === 'forbid') {
          fail('assembly.replacements', `replacement for "${only.definition.id}" is forbidden.`);
        }
        fail('assembly.replacements', `replacement for "${only.definition.id}" has no base contribution.`);
      }
      const authoring = effectiveAuthoring(only, presetAuthoring);
      active.push({
        ...only,
        position: only.index,
        ...(authoring !== undefined ? { authoring } : {}),
      });
      continue;
    }
    const replacers = group.filter((item) => item.definition.replaces !== undefined);
    if (replacementPolicy === 'forbid' && replacers.length > 0) {
      fail('assembly.replacements', `replacement for "${group[0].definition.id}" is forbidden.`);
    }
    if (replacers.length === 0) {
      fail('assembly.components', `component id "${group[0].definition.id}" is declared more than once.`);
    }
    if (replacers.length > 1) {
      fail('assembly.replacements', `component id "${group[0].definition.id}" has more than one replacement.`);
    }
    if (group.length > 2) {
      fail('assembly.replacements', `component id "${group[0].definition.id}" has ambiguous base contributions.`);
    }
    const replacement = replacers[0];
    const targets = group.filter((item) => item !== replacement);
    if (targets.length !== 1) {
      fail('assembly.replacements', `component id "${group[0].definition.id}" must have exactly one base.`);
    }
    const target = targets[0];
    if (target.definition.replaces !== undefined) {
      fail('assembly.replacements', `component id "${group[0].definition.id}" uses a replacement chain.`);
    }
    const declaration = replacement.definition.replaces as LocalComponentReplacement;
    if (!replacementMatches(target.definition, declaration)) {
      fail(
        'assembly.replacements',
        `replacement for "${target.definition.id}" does not match base version ${target.definition.version}.`,
      );
    }
    assertReplacementCompatible(target, replacement);
    const authoring = mergeAuthoring(
      effectiveAuthoring(target, presetAuthoring),
      effectiveAuthoring(replacement, presetAuthoring),
    );
    active.push({
      ...replacement,
      position: target.index,
      ...(authoring !== undefined ? { authoring } : {}),
    });
    replacements.push(replacementRecord(target, replacement));
  }
  active.sort((left, right) => left.position - right.position);
  return {
    active: Object.freeze(active),
    replacements: Object.freeze(sortById(replacements, (item) => item.id)),
  };
}

function validateActiveRegistry(active: readonly ActiveContribution[]): void {
  const names = new Map<string, ActiveContribution>();
  const byId = new Map(active.map((item) => [item.definition.id, item.definition]));
  for (const item of active) {
    const definition = item.definition;
    const previous = names.get(definition.name);
    if (previous !== undefined) {
      if (previous.origin.kind === 'preset' || item.origin.kind === 'preset') {
        fail(
          'assembly.components',
          `name "${definition.name}" conflicts with a built-in component "${previous.definition.id}".`,
        );
      }
      fail(
        'assembly.components',
        `component name "${definition.name}" is declared more than once by "${previous.definition.id}" and "${definition.id}".`,
      );
    }
    names.set(definition.name, item);
    const kernel = definition.requires?.kernel;
    if (kernel !== undefined && !localVersionSatisfies(LOCAL_SDK_VERSION, kernel)) {
      fail('assembly.components', `component "${definition.id}" requires kernel ${kernel}, but ${LOCAL_SDK_VERSION} is installed.`);
    }
    for (const dependency of definition.dependencies ?? []) {
      const installed = byId.get(dependency.id);
      if (!installed) {
        fail('assembly.dependencies', `component "${definition.id}" requires missing component "${dependency.id}".`);
      }
      if (dependency.version !== undefined && !localVersionSatisfies(installed.version, dependency.version)) {
        fail(
          'assembly.dependencies',
          `component "${definition.id}" requires "${dependency.id}" ${dependency.version}, but version ${installed.version} is installed.`,
        );
      }
    }
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: readonly string[]): void => {
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') fail('assembly.dependencies', `dependency cycle: ${[...path, id].join(' -> ')}.`);
    state.set(id, 'visiting');
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (byId.has(dependency.id)) visit(dependency.id, [...path, id]);
    }
    state.set(id, 'done');
  };
  for (const id of [...byId.keys()].sort(compareText)) visit(id, []);
}

function mergeThemes(
  presets: readonly import('./types').LocalPresetPackage[],
  hostThemes: readonly LocalThemePackage[],
): readonly LocalThemePackage[] {
  const byId = new Map<string, LocalThemePackage>();
  const byName = new Map<string, LocalThemePackage>();
  const add = (theme: LocalThemePackage, origin: string): void => {
    const existingId = byId.get(theme.id);
    if (existingId) fail('assembly.themes', `theme id "${theme.id}" is declared by both ${origin} and another source.`);
    const existingName = byName.get(theme.name);
    if (existingName) fail('assembly.themes', `theme name "${theme.name}" is declared by both ${origin} and another source.`);
    byId.set(theme.id, theme);
    byName.set(theme.name, theme);
  };
  for (const preset of presets) {
    for (const theme of preset.themes ?? []) add(theme, `preset:${preset.id}`);
  }
  for (const theme of hostThemes) add(theme, 'external');
  return Object.freeze(sortById([...byId.values()], (theme) => theme.id));
}

function presetDigests(presets: readonly import('./types').LocalPresetPackage[]): readonly LocalResolvedPreset[] {
  return Object.freeze(sortById(presets.map((preset) => ({
    id: preset.id,
    version: preset.version,
    digest: localPresetDigest(preset),
  })), (item) => item.id));
}

/** Stable semantic configuration key. */
export function localAssemblyKey(
  presets: readonly LocalResolvedPreset[],
  registry: readonly LocalComponentDefinition[],
  replacements: readonly LocalReplacementRecord[],
): string {
  const canonical = JSON.stringify({
    protocol: LOCAL_CONFIG_PROTOCOL_V2,
    presets: sortById(presets, (item) => item.id),
    registry: [...registry]
      .map((component) => ({
        id: component.id,
        name: component.name,
        version: component.version,
        digest: localComponentDigest(component),
      }))
      .sort((a, b) => compareText(a.id, b.id)),
    replacements: sortById(replacements, (item) => item.id),
  });
  return localHash(canonical);
}

/**
 * Legacy v1 key for the default-only profile. It is emitted as an alias, never
 * as the primary identity of a v2 configuration.
 */
export function localLegacyV1Key(
  preset: { readonly id: string; readonly version: string },
  components: readonly LocalComponentDefinition[],
): string {
  const canonical = JSON.stringify({
    protocol: LOCAL_CONFIG_PROTOCOL,
    presets: [{ id: preset.id, version: preset.version }],
    components: [...components]
      .map((component) => ({
        id: component.id,
        version: component.version,
        digest: localComponentDigest(component),
      }))
      .sort((a, b) => compareText(a.id, b.id)),
  });
  return localHash(canonical);
}

export interface ResolveAssemblyOptions {
  /** Compatibility profiles that may claim a single-preset v1 alias. */
  readonly legacyProfiles?: readonly LocalCompatProfile[];
}

/** Resolve a validated snapshot into a frozen registry and semantic identity. */
export function resolveLocalAssembly(
  snapshot: LocalAssemblySnapshot,
  options: ResolveAssemblyOptions = {},
): ResolvedLocalAssembly & { readonly legacyKeys: readonly LocalLegacyConfigKey[] } {
  const ordered = orderPresets(snapshot.presets);
  const contributions = collectContributions(ordered, snapshot.components);
  const resolved = resolveContributions(
    contributions,
    snapshot.replacementPolicy,
    indexPresetAuthoring(ordered),
  );
  validateActiveRegistry(resolved.active);
  const registry = Object.freeze(resolved.active.map((item) =>
    withResolvedAuthoring(item.definition, item.authoring)));
  const components = Object.freeze(sortById(
    resolved.active.filter((item) => item.origin.kind === 'external').map((item) => item.definition),
    (item) => item.id,
  ));
  const presets = presetDigests(ordered);
  const themes = mergeThemes(ordered, snapshot.themes);
  const key = localAssemblyKey(presets, registry, resolved.replacements);
  const legacyKeys: LocalLegacyConfigKey[] = [];
  const legacyProfile = options.legacyProfiles === undefined
    || ordered.length !== 1
    || resolved.replacements.length !== 0
    ? undefined
    : findLocalCompatProfile({ id: ordered[0].id, version: ordered[0].version }, options.legacyProfiles);
  const legacyRule = legacyProfile?.legacyKeys[0];
  if (legacyProfile !== undefined && legacyRule !== undefined) {
    legacyKeys.push(Object.freeze({
      profile: legacyRule.profile,
      key: localLegacyV1Key(legacyProfile.preset, components),
    }));
  }
  return Object.freeze({
    presets,
    components,
    replacements: resolved.replacements,
    registry,
    themes,
    key,
    legacyKeys: Object.freeze(legacyKeys),
  });
}

/**
 * Compact, transportable identity of one resolved assembly. It is safe to
 * embed in bundle seals, restoration requirements and state sidecars; it
 * contains no React functions, CSS or file paths.
 */
export interface LocalAssemblyIdentity {
  readonly protocol: 'reactive-md-assembly-seal/v1';
  readonly configKey: string;
  readonly presets: readonly LocalResolvedPreset[];
  readonly components: readonly LocalComponentRequirement[];
  readonly replacements: readonly LocalReplacementRecord[];
  readonly legacyKeys: readonly LocalLegacyConfigKey[];
}

type AssemblyIdentityInput = {
  readonly key: string;
  readonly presets: readonly LocalResolvedPreset[];
  readonly registry: readonly LocalComponentDefinition[];
  readonly replacements: readonly LocalReplacementRecord[];
  readonly legacyKeys: readonly LocalLegacyConfigKey[];
};

export function localAssemblyIdentity(input: AssemblyIdentityInput): LocalAssemblyIdentity {
  return Object.freeze({
    protocol: 'reactive-md-assembly-seal/v1',
    configKey: input.key,
    presets: Object.freeze(sortById(input.presets, (item) => item.id)),
    components: Object.freeze(sortById(input.registry.map(localComponentRequirement), (item) => item.id)),
    replacements: Object.freeze(sortById(input.replacements, (item) => item.id)),
    legacyKeys: Object.freeze(sortById(input.legacyKeys, (item) => item.key)),
  });
}

/** Deterministic digest over the assembly identity. */
export function localAssemblySeal(input: AssemblyIdentityInput): string {
  return localHash(JSON.stringify(localAssemblyIdentity(input)));
}

/** Accept both the primary v2 key and its supported legacy aliases. */
export function localConfigKeyMatches(input: AssemblyIdentityInput, key: string): boolean {
  return input.key === key || input.legacyKeys.some((entry) => entry.key === key);
}

/** Apply the active registry to authoring metadata, keeping manifest identity. */
export function localAssemblyAuthoring(
  registry: readonly LocalComponentDefinition[],
): ReadonlyMap<string, LocalComponentAuthoring> {
  const authoring = new Map<string, LocalComponentAuthoring>();
  for (const component of registry) {
    if (component.authoring) authoring.set(component.id, component.authoring);
  }
  return authoring;
}

export type { LocalStyleResource };
