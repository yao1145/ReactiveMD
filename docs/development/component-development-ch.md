# 五分钟跑通组件插件

[English](component-development-en.md) · [完整开发契约](component-development-reference-ch.md)

先用一个可以展开 Markdown 的提示容器跑通预览。扩展 SDK 随 `reactive-md@0.7.0` 发布，直接安装即可。

## 创建并启动

```sh
npx reactive-md init component ../my-note --name my-note --id acme/my-note --form container --props '{"label":{"kind":"string","default":"Note"}}' --yes
cd ../my-note
npm install reactive-md@0.7.0 react@^19 react-dom@^19
npm run dev
```

打开 Vite 打印的地址。你会看到提示容器和其中的 Markdown。可省略字段进入终端问答；`--yes` 使用非交互默认值，`init component --help` 列出选项。

## 改一个文件

把生成的 `src/my-note.tsx` 改为：

```tsx
import { useState } from 'react';
import { defineReactComponentPackage, type LocalComponentContext } from 'reactive-md/react';
import { manifest } from './manifest.js';

function Note(ctx: LocalComponentContext) {
  const [open, setOpen] = useState(true);
  const title = String(ctx.props.label);
  if (ctx.mode === 'static') {
    return <aside className="my-note" data-my-note>
      <strong>{title}</strong>{ctx.children.render()}
    </aside>;
  }
  return <aside className="my-note" data-my-note>
    <button disabled={ctx.disabled} onClick={() => setOpen(value => !value)}>
      {title}
    </button>
    {open ? ctx.children.render() : null}
  </aside>;
}

export const componentPackage = defineReactComponentPackage({
  ...manifest,
  render: Note,
  css: '.local-document .my-note { padding: 12px; color: var(--ink); border: 1px solid var(--accent); }',
});
```

点击标题可展开或收起 Markdown。组件通过 `ctx.mode` 复用同一个渲染函数完成静态输出，`renderStatic` 只在需要不同版式时提供。局部 React 状态和计时器由组件管理；共享绑定的写入由内核校验，静态模式拒绝写入。计时器 effect 应在静态模式直接返回，并在卸载时清理。

## 宿主只装配一次

脚手架已生成以下接线。新包在 `extensions.ts` 的数组中登记：

```ts
import { createReactHost } from 'reactive-md/react';
import { componentPackage } from './src/my-note.js';
export const host = createReactHost({ packages: [componentPackage] });
```

`reactiveMd({ extensions: './extensions.ts' })` 为 Vite 配置样式、依赖去重和离线运行时。应用从 `virtual:reactive-md/host` 读取 `host`，向预览传 `host.reactConfig`；自建编译器或 Worker 使用 `host.compileOptions`。形态、属性和能力在 `src/manifest.ts` 中修改。简单组件也可直接在便捷工厂中内联声明，协议和 leaf 形态有默认值；CSS 资源 ID 可从组件 ID 派生。

## 验证和打包

```sh
npm run typecheck
npm test
npm pack --ignore-scripts
```

将安装包交给另一个宿主，通过包的公开入口导入。能力声明、绑定与容器契约、纯声明入口、离线导出、样式资源和合规证据见[完整开发契约](component-development-reference-ch.md)。`<tetris>` 与 `<game-2048>` 的真实安装包案例见 [Demo 说明](https://github.com/yao1145/ReactiveMD/blob/main/demo/README.md)。
