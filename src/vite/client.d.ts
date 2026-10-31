declare module 'virtual:reactive-md/host' {
  /** Host-owned metadata exports; never sent to the compiler or Worker. */
  export const extensions: Readonly<Record<string, unknown>>;
  export const host: import('reactive-md/react').LocalReactHost;
  export const config: typeof host.config;
  export const reactConfig: typeof host.reactConfig;
  export const resources: typeof host.resources;
  export const css: string;
  export const notices: typeof host.notices;
}
declare module 'virtual:reactive-md/bundle' {
  const bundle: import('reactive-md/build').LocalStandaloneBuild | {
    readonly error: string;
    readonly diagnostics: readonly import('reactive-md').Diagnostic[];
  };
  export default bundle;
}
