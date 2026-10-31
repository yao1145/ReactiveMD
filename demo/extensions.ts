/** Register packages here. Preview, authoring and export share this module. */
import { createReactHost } from 'reactive-md/react';
import { source, tetrisPackage } from 'reactive-md-tetris-package/react';
import tetrisNotices from 'reactive-md-tetris-package/notices?raw';
import { game2048Package, source as game2048Source } from 'reactive-md-game-2048-package/react';
import game2048Notices from 'reactive-md-game-2048-package/notices?raw';
import type { PlaygroundExample } from './src/examples';

export const host = createReactHost({
  packages: [tetrisPackage, game2048Package],
  notices: [
    { id: 'reactive-md-tetris-package', license: 'MIT', text: tetrisNotices },
    { id: 'reactive-md-game-2048-package', license: 'MIT', text: game2048Notices },
  ],
});

/** Host metadata stays beside the registration; the virtual module exposes it. */
export const examples: readonly PlaygroundExample[] = [{
  id: 'tetris', section: 'reference',
  title: 'Tetris plugin', titleZh: '俄罗斯方块插件',
  hint: 'An external component, including offline export.',
  hintZh: '体验外部组件及其离线导出。',
  source,
  sourceZh: source.replace('# Tetris component sample', '# 俄罗斯方块组件示例'),
}, {
  id: 'game-2048', section: 'reference',
  title: '2048 plugin', titleZh: '2048 插件',
  hint: 'A second external component with keyboard and pointer controls.',
  hintZh: '第二个外部组件，支持键盘与按钮操作。',
  source: game2048Source,
  sourceZh: game2048Source.replace('# 2048 component sample', '# 2048 组件示例'),
}];
