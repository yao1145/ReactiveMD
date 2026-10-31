/**
 * Node/SSR entry. Built by `scripts/build.mjs` and imported by
 * `scripts/verify.mjs`; it uses only public `reactive-md` entries.
 */
export {
  brokenReactConfig,
  componentCss,
  config,
  reactConfig,
  Tetris,
  TetrisStatic,
  tetrisImplementation,
  tetrisPackage,
} from './components';
export { tetris } from './manifests';
export { source } from './sample';
