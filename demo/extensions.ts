/** Register packages here. Preview, authoring and export use this same list. */
import { createDemoExtensions } from './src/extension-host';
import { componentCss, tetrisImplementation } from '../examples/tetris-package/src/components';
import { source } from '../examples/tetris-package/src/sample';
import tetrisNotices from '../examples/tetris-package/NOTICES.md?raw';

export const { config, reactConfig, resources, css, examples, notices } = createDemoExtensions([
  {
    components: [tetrisImplementation],
    resources: [{ id: 'example/tetris.css', css: componentCss }],
    notices: [{ id: 'reactive-md-tetris-package', license: 'MIT', text: tetrisNotices }],
    examples: [{
      id: 'tetris', section: 'reference',
      title: 'Tetris plugin', titleZh: '俄罗斯方块插件',
      hint: 'An external component, including offline export.',
      hintZh: '体验外部组件及其离线导出。',
      source,
      sourceZh: source.replace('# Tetris component sample', '# 俄罗斯方块组件示例'),
    }],
  },
]);
