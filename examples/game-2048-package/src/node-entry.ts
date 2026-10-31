/**
 * Node/SSR entry. Built by `scripts/build.mjs` and imported by
 * `scripts/verify.mjs`; it uses only public `reactive-md` entries.
 */
export {
  brokenReactConfig,
  componentCss,
  config,
  Game2048,
  Game2048Static,
  game2048Implementation,
  game2048Package,
  reactConfig,
} from './components';
export { game2048 } from './manifest';
export {
  canMove,
  createGameState,
  move,
  restart,
  tileTier,
} from './game-engine';
export type {
  Cell2048,
  Direction2048,
  Game2048Options,
  Game2048State,
  Game2048Status,
} from './game-engine';
export { source } from './sample';
