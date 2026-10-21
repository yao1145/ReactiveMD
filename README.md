# Reactive MD

用 Markdown 写交互文档。声明状态、绑定输入、连接计算关系，让文字、表单、比较卡片、图表和图解随读者的操作变化。文档作者无需编写 JavaScript 或 CSS。

Reactive MD 使用 TypeScript 实现，标准 Markdown 由 remark 解析。v0.2 提供 44 个内置组件、JSON 状态、集合动作、异步宿主接口、持久化与流式会话。

## 从这里开始

- [详细语言用法指南](docs/guide.md)：从第一份文档到表单、集合、图表和异步交互，附完整示例与排错方法。
- [语言参考](docs/language-reference.md)：快速查阅语法、表达式和运行语义。
- [组件参考](docs/components.md)：由 schema 自动生成的 44 个组件契约。
- [宿主集成](docs/integration.md)：TypeScript API、React 渲染、存储和外部服务。
- [语言示例](examples) · [Demo 说明](demo/README.md)。

## 写一份文档

````markdown
```reactive-md
version: "0.2"
state:
  count: 0
actions:
  increment:
    - set: count
      value: "=count + 1"
```

当前数值：:value{value="=count"}。

::button[加一]{on-click="increment"}
````

`state` 保存可变值，`computed` 声明计算关系，`bind` 将输入关联到状态，事件引用命名动作。外部效果由宿主注册的 capability 执行。

## 安装与构建

需要 Node.js 22.12 或更新版本。在仓库根目录执行：

```sh
npm install
npm run build
npm test
npm run test:package
npm run test:docs
```

`build` 只构建语言包，输出到 `dist-library/`。`reactive-md` 入口提供编译器、运行时和文档会话，`reactive-md/react` 提供 React 渲染器。组件样式通过 `reactive-md/styles.css` 引入。包尚未发布到 npm，本地应用可使用工作区或本地文件依赖。

## 体验 Demo

```sh
npm run dev
```

该命令先构建语言包，再启动独立的 `demo/` 应用，地址为 `http://127.0.0.1:5173`。`/embed.html` 展示嵌入方式。Demo 的页面、编辑器、演示服务、资产和浏览器检查均在 `demo/`，通过语言包的公开入口集成。

```text
src/           语言核心、文档会话和可复用 React 组件
examples/      可复制的语言示例，与 demo 应用无关
docs/         用法指南、语言参考与集成文档
tests/        语言与渲染器测试
demo/         独立的 Playground 应用
```

更多开发与测试命令见 [Demo README](demo/README.md)。

## 许可证

[MIT](LICENSE)
