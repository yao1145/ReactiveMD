declare module 'virtual:demo-extension-bundle' {
  const bundle: import('reactive-md/build').LocalStandaloneBuild | {
    readonly error: string;
    readonly diagnostics: readonly import('reactive-md').Diagnostic[];
  };
  export default bundle;
}
