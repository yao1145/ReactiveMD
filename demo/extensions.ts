/** Register packages here. Preview, authoring and export share this module. */
import { createReactHost } from 'reactive-md/react';
import { source, tetrisPackage } from 'reactive-md-tetris-package/react';
import tetrisNotices from 'reactive-md-tetris-package/notices?raw';
import type { PlaygroundExample } from './src/examples';

export const host = createReactHost({
  packages: [tetrisPackage],
  notices: [{ id: 'reactive-md-tetris-package', license: 'MIT', text: tetrisNotices }],
});

/** Host metadata stays beside the registration; the virtual module exposes it. */
export const examples: readonly PlaygroundExample[] = [{
  id: 'tetris', section: 'reference',
  title: 'Tetris plugin', titleZh: '俄罗斯方块插件',
  hint: 'An external component, including offline export.',
  hintZh: '体验外部组件及其离线导出。',
  source,
  sourceZh: source.replace('# Tetris component sample', '# 俄罗斯方块组件示例'),
}];
