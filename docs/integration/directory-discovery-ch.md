# 按目录接入主题和组件

宿主项目启用一次 Vite 插件：

```ts
import { reactiveMd } from 'reactive-md/vite';
export default { plugins: [reactiveMd()] };
```

目录属于使用 ReactiveMD 的项目。默认扫描 Vite root 下的 `theme/` 和 `plugin/` 的直接子目录：

```text
theme/paper/theme.css
theme/paper/theme.json       # 可选
plugin/tetris/index.ts
plugin/tetris/component.css # 可选
plugin/tetris/assets/
```

`theme.css` 是主题的最小入口。主题名默认取目录名，包 ID 为 `local/theme/<目录名>`，版本为 `0.0.0`。可选 `theme.json` 可以声明 `id`、`name`、`version`、`protocol` 和 `colorSchemes`。内部用 `defineLocalTheme` 校验、作用域化并冻结。作者按主题协议编写深浅模式；发现主题后，文档通过 `<theme name="paper">` 选择它。

```css
[data-rmd-theme="paper"][data-color-scheme="light"] { --accent: #345678; }
[data-rmd-theme="paper"][data-color-scheme="dark"] { --accent: #abcdef; }
```

组件入口导出一个 `LocalReactPackage`。推荐默认导出；也接受唯一的命名包导出，同一对象的别名只计算一次。组件继续用 `defineReactComponentPackage` 声明标签、属性、能力和渲染函数。辅助代码由入口正常导入。

```ts
// plugin/tetris/index.ts
export { tetrisPackage as default } from 'reactive-md-tetris-package/react';
```

入口识别 `index.ts`、`index.tsx`、`index.js`、`index.jsx`、`index.mts`、`index.mjs`。同一目录有多个入口会报错。`component.css` 自动加入资源；包自身的 CSS、主题和 notices 继续生效。入口还可导出 `notices` 数组。注册组件后，文档中使用对应标签才会创建实例。

应用保持原来的读取方式：

```tsx
import { host } from 'virtual:reactive-md/host';
// React: host.reactConfig
// 编译、编辑器和 Worker: host.compileOptions
// SSR/导出: host.resources、host.notices
```

Worker 接收可序列化的 `host.config`，React 实现留在主线程。`virtual:reactive-md/bundle` 和生产输出的离线包使用同一发现结果。基础样式仍由应用导入 `reactive-md/styles.css`。虚拟模块类型使用 `reactive-md/vite/client`。

资源按目录名固定排序。CSS 相对引用和本地 `@import` 在构建期解析、内联，资源清单记录来源、摘要和字节数。远程引用、超出允许目录的路径和超预算资源会报错；CSS 继续遵循 SDK 的作用域与安全规则。主题名、主题 ID、组件 ID、标签冲突会指出双方入口。同 ID、不同 CSS 的资源也会报错。

开发服务器监听入口增删和重命名。主题 CSS 及其资源变化更新样式并失效离线包缓存；注册结构变化触发重载。浏览器和纯编译器均不扫描文件系统。

需要自定义目录时用 `reactiveMd({ themeDir: 'themes', pluginDir: 'components' })`。高级宿主仍可选择 `reactiveMd({ extensions: './extensions.ts' })`，由该模块导出 `host = createReactHost(...)`。手动模式与目录选项互斥。宿主自己的样例导航等元数据可从普通应用模块导入。

Demo 的 `plugin/tetris/`、`plugin/game-2048/` 和 `theme/sci-fi/` 是现有包的目录接入案例。主题 CSS 来自已安装 sci-fi 包的公开 CSS 入口；更新主题包后应同步这份宿主主题资源。
