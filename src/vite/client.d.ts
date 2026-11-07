declare module 'virtual:reactive-md/host' {
  /** Host-owned metadata exports; never sent to the compiler or Worker. */
  /** Manual mode only: the explicit `extensions` module namespace. */
  export const extensions: Readonly<Record<string, unknown>>;
  export const host: import('reactive-md/react').LocalReactHost;
  export const config: typeof host.config;
  export const reactConfig: typeof host.reactConfig;
  export const resources: typeof host.resources;
  export const css: string;
  export const notices: typeof host.notices;
  /**
   * Directory mode snapshot facts. Undefined in manual mode. The export is
   * refreshed in place after a theme stylesheet update.
   */
  export const discovery: {
    readonly files: readonly string[];
    readonly directories: readonly string[];
    readonly themes: readonly {
      readonly file: string;
      readonly id: string;
      readonly name: string;
    }[];
    readonly plugins: readonly {
      readonly file: string;
      readonly resources: readonly string[];
    }[];
    readonly assets: readonly import('reactive-md/build').LocalBuildAsset[];
  } | undefined;
}
declare module 'virtual:reactive-md/bundle' {
  const bundle: import('reactive-md/build').LocalStandaloneBuild | {
    readonly error: string;
    readonly diagnostics: readonly import('reactive-md').Diagnostic[];
  };
  export default bundle;
}
