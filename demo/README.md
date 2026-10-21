# Reactive MD Demo

本目录是独立的 Playground 应用，通过 `reactive-md` 和 `reactive-md/react` 的公开入口使用语言包。编辑器、主题工具栏、示例选择器、本地目录查询服务与浏览器脚本都属于此应用。

## 启动

在仓库根目录执行：

```sh
npm install
npm run dev
```

根命令先构建语言包，再启动本目录的 Vite 开发服务器。打开 `http://127.0.0.1:5173`，嵌入示例位于 `/embed.html`。服务器使用固定端口；已有旧服务器占用端口时，先停止该服务器。

语言包已经构建时，也可在本目录执行 `npm run dev`；工作区依赖应先在根目录安装。

## 目录边界

```text
 demo/
   package.json        应用依赖与运行命令
   index.html          Playground 入口
   embed.html          嵌入示例入口
   src/
     App.tsx           编辑器、预览、诊断与状态观察
     main.tsx          应用挂载
     embed.tsx         两个独立实例与宿主组件示例
     examples.ts       引用根 examples/ 中的语言文档
     demo-capabilities.ts  可取消的本地异步目录查询
     author-tools.tsx  导入导出、格式化、主题和清单
     styles.css        应用布局与编辑器样式
     author.css        工具栏、简洁视图和应用主题样式
   public/             演示图片等静态资产
   tests/              示例选择器与错误示例检查
   scripts/            浏览器交互回归
   artifacts/          浏览器报告、导出文件与截图（生成）
   dist/               生产静态页面（生成）
```

应用源码只从公开包导入语言接口。语言的实现、组件 schema、表达式和可复用样式保留在根 `src/`，语言包构建不会包含本目录。根 `examples/` 是独立语言示例，供指南、语言测试和本应用共同使用。

## 开发语言包

demo 使用 `dist-library/` 中的实际库产物，不通过别名绕过包入口。修改 demo 源码会自动热更新。修改语言源码后，可在根目录重新执行 `npm run build:lib`；持续修改时使用两个终端：

```sh
# 终端一，启动 demo
npm run dev

# 终端二，监听并重建语言包
npm run dev:lib
```

语言库重新构建后 demo 会重新加载，兼容状态仍可由文档 ID 恢复。公开类型声明由 `npm run build:lib` 或 `npm run build` 更新。

## 构建与检查

以下命令均在仓库根目录执行：

| 命令 | 内容 |
| --- | --- |
| `npm run build` | 语言包与类型声明，输出 `dist-library/` |
| `npm run build:demo` | 先构建语言包，再构建应用，输出 `demo/dist/` |
| `npm run preview` | 预览已构建的 demo，默认端口 4173 |
| `npm test` | 语言、状态、会话与渲染器测试 |
| `npm run test:docs` | 文档本地链接与导航锚点检查 |
| `npm run test:package` | 检查库产物、公开入口及 demo/样式边界；需先构建 |
| `npm run test:demo` | 构建语言包并检查 demo 中的 12 个文档条目 |
| `npm run test:browser` | 基础交互、编辑、输入与诊断的浏览器回归 |
| `npm run test:intelligent` | 表单、集合、图表、异步、流式和嵌入的扩展回归 |

浏览器脚本需要本机 Edge 和已启动的服务器，默认检查 `http://127.0.0.1:5173`。可通过 `DEMO_URL` 指向其他地址，例如生产预览服务器。脚本的工作目录是 `demo/`，报告与截图写入 `demo/artifacts/`。

拆分前的构建和截图保留在 `demo/artifacts/before-separation/`。

## 体验建议

在示例选择器中依次体验并排比较、表单、集合、图表、交互图解、异步动作与计划。左侧源码修改后重新编译，右侧控件直接更新运行时。导入导出、格式化、组件清单和流式播放都经过真实编译器。

本地目录查询通过可取消的 Promise 模拟服务延迟，输入 `error` 可测试失败与重试。语言的外部服务入口由宿主注册，本应用没有配置远程模型或后端凭据。小游戏和地图不在当前范围。

写文档请阅读 [详细指南](../docs/guide.md)，应用开发请阅读 [宿主集成](../docs/integration.md)。
