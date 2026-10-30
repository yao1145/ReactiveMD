import { defineLocalComponent } from 'reactive-md/sdk';

/**
 * `<tetris>`: a self-contained interactive component.
 *
 * The manifest is plain JSON data. It declares every authored attribute,
 * the accepted ranges and the editor metadata; the React implementation and
 * the game engine live in `components.tsx` and `tetris-engine.ts`.
 */
export const tetris = defineLocalComponent({
  id: 'example/tetris',
  name: 'tetris',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    label: { kind: 'string', default: 'Tetris' },
    width: {
      kind: 'number',
      dynamic: true,
      default: 10,
      integer: true,
      min: 6,
      max: 14,
      description: {
        en: 'Board width in cells.',
        zh: '棋盘宽度（格）。',
      },
    },
    height: {
      kind: 'number',
      dynamic: true,
      default: 20,
      integer: true,
      min: 12,
      max: 24,
      description: {
        en: 'Board height in cells.',
        zh: '棋盘高度（格）。',
      },
    },
    speed: {
      kind: 'number',
      dynamic: true,
      default: 600,
      integer: true,
      min: 100,
      max: 2000,
      description: {
        en: 'Gravity interval in milliseconds.',
        zh: '下落间隔（毫秒）。',
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
        en: 'Seed for the piece bag; the same seed produces the same game.',
        zh: '方块序列种子；同一种子产生相同局面。',
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
    title: { en: 'Tetris', zh: '俄罗斯方块' },
    description: {
      en: 'A seeded Tetris board with keyboard, pointer controls and a static preview.',
      zh: '带随机种子、键盘与按钮控制，并提供静态预览的俄罗斯方块。',
    },
    category: 'interactive',
    insertText: '<tetris label="Tetris" width="10" height="20" speed="600" seed="7">',
  },
  styles: ['example/tetris.css'],
});
