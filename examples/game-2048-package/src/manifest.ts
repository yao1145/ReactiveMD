import { defineLocalComponent } from 'reactive-md/sdk';

/**
 * `<game-2048>`: a self-contained interactive 2048 board.
 *
 * Component names must start with a letter (`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`),
 * so the familiar `<2048>` spelling is not a valid tag. `<game-2048>` keeps
 * the number in the name while satisfying the SDK contract.
 *
 * The manifest is plain JSON data. It declares every authored attribute and
 * the accepted ranges; the React implementation and the pure engine live in
 * `components.tsx` and `game-engine.ts`.
 */
export const game2048 = defineLocalComponent({
  id: 'example/game-2048',
  name: 'game-2048',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    label: { kind: 'string', default: '2048' },
    size: {
      kind: 'number',
      dynamic: true,
      default: 4,
      integer: true,
      min: 3,
      max: 6,
      description: {
        en: 'Board size in cells per side.',
        zh: '棋盘每边格数。',
      },
    },
    target: {
      kind: 'number',
      dynamic: true,
      default: 2048,
      integer: true,
      min: 8,
      max: 131072,
      description: {
        en: 'Tile value that completes the game.',
        zh: '达成胜利所需的方块数值。',
      },
    },
    seed: {
      kind: 'number',
      dynamic: true,
      default: 7,
      integer: true,
      min: 0,
      max: 99999,
      description: {
        en: 'Seed for tile placement; the same seed produces the same game.',
        zh: '方块生成种子；同一种子产生相同局面。',
      },
    },
    debug: {
      kind: 'boolean',
      dynamic: true,
      default: false,
      description: {
        en: 'Show the error-isolation probe used by compliance tests.',
        zh: '显示供合规测试使用的错误隔离探针。',
      },
    },
    disabled: {
      kind: 'boolean',
      dynamic: true,
      default: false,
    },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: '2048', zh: '2048' },
    description: {
      en: 'A seeded 2048 board with keyboard, pointer controls and a static preview.',
      zh: '带随机种子、键盘与按钮控制，并提供静态预览的 2048。',
    },
    category: 'interactive',
    insertText: '<game-2048 label="2048" size="4" seed="7">',
  },
  styles: ['example/game-2048.css'],
});
