/** Register packages here. Preview, authoring and export share this module. */
import { createReactHost } from 'reactive-md/react';
import { tetrisPackage } from 'reactive-md-tetris-package/react';
import tetrisNotices from 'reactive-md-tetris-package/notices?raw';
import { game2048Package } from 'reactive-md-game-2048-package/react';
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
  id: 'games', section: 'reference',
  title: 'Games', titleZh: '小游戏',
  hint: 'Tetris and 2048 in one document, with independent controls and offline export.',
  hintZh: '在同一篇文档中玩俄罗斯方块和 2048，分别操作，也可以离线导出。',
  source: gamesSource(false), sourceZh: gamesSource(true),
}];

function gamesSource(zh: boolean): string {
  const t = (en: string, cn: string) => zh ? cn : en;
  return `# ${t('Games', '小游戏')}

${t('Two games share this page. Their controls and progress are independent; click a board before using its keyboard controls.', '两款小游戏放在同一页中，操作和进度各自独立。使用键盘前，先点击要玩的棋盘。')}

## ${t('Tetris', '俄罗斯方块')}

${t('Use the arrows to move and rotate, Space to drop, P to pause and R to restart. The buttons also work with touch.', '方向键移动与旋转，空格键落下，P 暂停，R 重新开始；也可以使用棋盘旁的触控按钮。')}

<checkbox bind="showTetris" label="${t('Show tetris', '显示俄罗斯方块')}" initial="true">
<checkbox bind="lockTetris" label="${t('Lock tetris', '锁定俄罗斯方块')}">
<if when="{{ showTetris }}">
<tetris label="${t('Tetris', '俄罗斯方块')}" width="10" height="20" speed="600" seed="7" disabled="{{ lockTetris }}">
</if>

## 2048

${t('Use the arrows or W A S D to slide tiles. Equal tiles combine; try to reach 2048. Press R to restart.', '用方向键或 W A S D 移动方块，让相同数字合并，试着拼出 2048。R 重新开始。')}

<checkbox bind="show2048" label="${t('Show 2048', '显示 2048')}" initial="true">
<checkbox bind="lock2048" label="${t('Lock 2048', '锁定 2048')}">
<if when="{{ show2048 }}">
<game-2048 label="2048" size="4" seed="7" disabled="{{ lock2048 }}">
</if>
`;
}
