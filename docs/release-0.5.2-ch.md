# 0.5.2 预览版发布

`reactive-md@0.5.2` 是面向 `next` 渠道的 0.x 预览版。语法修订仍为 `local-draft-2`，主题协议仍为 `reactive-md-theme-1`；因新增宿主组件扩展轴，组块协议提升到 `component-protocol-2`。现有 0.5.x 导入和文档无需迁移。`latest` 仍为 `0.4.0`。

```sh
npm install reactive-md@next
# 或固定预览版
npm install reactive-md@0.5.2
```

离线安装可使用 [npm tarball](https://registry.npmjs.org/reactive-md/-/reactive-md-0.5.2.tgz)。

## 宿主组件

`compileLocal(source, { hostComponents })` 增加一条可选的宿主叶子标签扩展轴。Schema 是普通数据：名称、`form: 'leaf'`，以及声明 `kind`、`required`、`static`、`enum` 和 `pattern` 的属性表。名称必须是唯一的小写 kebab-case，不能复用 48 个作者标签名、P0 HTML 标签名或主题名；单次编译最多接受 32 个 Schema。

不传 `hostComponents` 时行为不变：标签仍是未知标签并按原文降级。传入后，解析器生成 `hostComponent` 叶子节点，编译器校验其属性。属性失败使用 `local.host.attribute`，Schema 非法使用 `local.options.invalid`。合法宿主节点计为一个语法节点，宿主属性同样受共享字符串长度预算约束。`pattern` 限制在线性时间安全子集内，拒绝反向引用、环视、命名组、嵌套量词和被量词修饰的分支。

`LocalDocumentView` 和 `LocalReactiveDocument` 接受 `hostData`（按 `${kind}:${ref}` 索引的 JSON 安全数据）与仅客户端的 `hostRenderer(node, data, ctx)`。缺少 renderer、缺少数据或 renderer 抛错时显示可见占位，不会让文档失败。`mode="static"` 走同一分派。Schema 会随编译请求进入 worker；renderer 和宿主数据不会。

完整契约见[本地模式集成](local-integration-ch.md#宿主组件)与[组块协议](component-protocol-ch.md)。

## 协议修订

组块协议现为 `component-protocol-2`。语法修订仍为 `local-draft-2`，机器验收基线 `component-protocol-1.json` 继续冻结，用于 48 个作者组块。宿主组件不提供可移植机器用例，因为渲染由宿主拥有。

## 兼容性

现有 `reactive-md`、`reactive-md/react`、`reactive-md/editor`、`reactive-md/styles.css` 和 `reactive-md/editor/styles.css` 导入继续有效。为 `0.5.x` 编写的文档无需修改；宿主扩展为可选能力。核心入口仍不依赖 React。详见[变更日志](../CHANGELOG-ch.md)与[版本与兼容性](compatibility-ch.md)。

## 验证与限制

发布门槛覆盖类型检查、完整测试套件、文档链接、包构建和打包安装冒烟检查。单文件导出之外的通用 SSR 水合、Firefox 和 WebKit 仍未验证。

项目仍是 0.x 预览版。安全边界与宿主责任见[SECURITY-ch.md](../SECURITY-ch.md)。
