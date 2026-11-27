export interface LocalPackStyleManifest {
  readonly components: Readonly<Record<string, readonly string[]>>;
  readonly packs: Readonly<Record<string, { readonly file: string; readonly resources: readonly string[] }>>;
  readonly resources: Readonly<Record<string, { readonly file: string; readonly selectors: readonly string[] }>>;
}
