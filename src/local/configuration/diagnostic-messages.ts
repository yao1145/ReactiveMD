/**
 * Diagnostic language resources.
 *
 * Bilingual templates and compatibility aliases are data only: the
 * construction, lookup and formatting logic lives in `diagnostics.ts`. Keeping
 * translations here makes it possible to move them to an external resource
 * file without changing any caller.
 */

export const LOCAL_DIAGNOSTIC_MESSAGES = {
  'local.version.unsupported': { en: 'This reader accepts {supported}; migrate {declared} or use a compatible reader.', zh: '此阅读器支持 {supported}；请迁移 {declared} 或使用兼容的阅读器。' },
  'local.version.malformed': { en: 'Use <!-- reactive-md: local-draft-3 --> on one line.', zh: '请在单独一行使用 <!-- reactive-md: local-draft-3 -->。' },
  'local.version.duplicate': { en: 'Only one source syntax declaration is allowed.', zh: '源码只能声明一次语法版本。' },
  'local.version.placement': { en: 'The syntax declaration must be on its own line before the theme and document body.', zh: '语法版本声明必须独占一行，位于主题声明和正文之前。' },
  'local.upgrade.from-version': { en: 'Cannot migrate from {from}: {detail}.', zh: '无法从 {from} 迁移：{detail}。' },
  'local.upgrade.reserved-binding': { en: 'Binding {name} becomes reserved in local-draft-2; rename it with a compatible old editor before migration.', zh: '绑定 {name} 在 local-draft-2 中成为保留名；迁移前请用兼容旧版本的编辑器重命名。' },
  'local.upgrade.tag': { en: 'Tag {name} was inert in the older revision and becomes active in a newer one; preserve it as literal code before migration.', zh: '标签 {name} 在旧版本中不执行，在较新版本中会激活；迁移前请将其保留为代码原文。' },
  'local.upgrade.text-length': { en: 'Text length constraints change from UTF-16 units to Unicode code points; explicitly accept this semantic change before migration.', zh: '文本长度约束从 UTF-16 单元改为 Unicode 码点计数；迁移前须明确接受这一语义变化。' },
  'local.upgrade.expression': { en: 'This expression uses array syntax or a function introduced in local-draft-2; it is outside automatic draft-1 migration.', zh: '此表达式使用了 local-draft-2 新增的数组语法或函数，不属于 draft-1 自动迁移范围。' },
  'local.upgrade.version-missing': { en: 'The source has no syntax declaration; migration will pin {version}.', zh: '源码尚未声明语法版本；迁移将固定为 {version}。' },
  'capability.html': {
    en: 'This compiler assembly does not include the native HTML document branch.',
    zh: '当前编译器装配不包含原生 HTML 文档分支。',
  },
  'capability.plot': {
    en: 'This compiler assembly does not include plot formula support.',
    zh: '当前编译器装配不包含绘图公式支持。',
  },
  'parse.sourceType': {
    en: 'Document source must be a string.',
    zh: '文档源必须是字符串。',
  },
  'parse.markdownFailed': {
    en: 'Cannot parse the Markdown document.',
    zh: '无法解析 Markdown 文档。',
  },
  'parse.failed': {
    en: 'Cannot parse document: {detail}',
    zh: '无法解析文档：{detail}',
  },
  'budget.document': {
    en: 'Document exceeds the {limit}-character limit.',
    zh: '文档超过 {limit} 个字符的上限。',
  },
  'budget.syntaxNodes': {
    en: 'Syntax nodes exceed the limit of {limit}.',
    zh: '语法节点数量超过上限 {limit}。',
  },
  'budget.parseWork': {
    en: 'Parsing work exceeds the limit of {limit}.',
    zh: '解析工作量超过上限 {limit}。',
  },
  'budget.markdownDepth': {
    en: 'Markdown nesting exceeds the {limit}-level limit.',
    zh: 'Markdown 嵌套超过 {limit} 层上限。',
  },
  'budget.nesting': {
    en: 'Component nesting exceeds the {limit}-level limit.',
    zh: '组件嵌套超过 {limit} 层上限。',
  },
  'options.notObject': {
    en: 'Compile options must be an object.',
    zh: '编译选项必须是对象。',
  },
  'options.limitsNotObject': {
    en: 'Compile option limits must be an object.',
    zh: '编译选项 limits 必须是对象。',
  },
  'options.maxSyntaxNodes': {
    en: 'Compile option limits.maxSyntaxNodes must be a positive safe integer.',
    zh: '编译选项 limits.maxSyntaxNodes 必须是正安全整数。',
  },
  'options.maxParseWork': {
    en: 'Compile option limits.maxParseWork must be a positive safe integer.',
    zh: '编译选项 limits.maxParseWork 必须是正安全整数。',
  },
  'options.maxMarkdownDepth': {
    en: 'Compile option limits.maxMarkdownDepth must be a positive safe integer.',
    zh: '编译选项 limits.maxMarkdownDepth 必须是正安全整数。',
  },
  'options.unknownLimit': {
    en: 'Compile option limits.{detail} is not supported.',
    zh: '编译选项 limits.{detail} 不受支持。',
  },
  'options.hostComponents': {
    en: 'Compile option hostComponents is invalid: {detail}',
    zh: '编译选项 hostComponents 无效：{detail}',
  },

  'theme.expression': {
    en: 'Theme names must be static text, not expressions.',
    zh: '主题名称必须是静态文本，不能是表达式。',
  },
  'theme.nameRequired': {
    en: 'A theme declaration requires a quoted name attribute.',
    zh: '主题声明需要一个带引号的 name 属性。',
  },
  'theme.attributeOnly': {
    en: 'Theme declarations only accept a quoted name attribute.',
    zh: '主题声明只接受带引号的 name 属性。',
  },
  'theme.nameInvalid': {
    en: 'Theme name "{name}" must use lowercase letters, digits and single hyphens (maximum {limit} characters).',
    zh: '主题名称“{name}”只能使用小写字母、数字和单个连字符（最多 {limit} 个字符）。',
  },
  'theme.malformedMissingClose': {
    en: 'Theme declaration is missing >.',
    zh: '主题声明缺少 >。',
  },
  'theme.malformedClosing': {
    en: 'A theme declaration cannot be a closing tag.',
    zh: '主题声明不能是结束标签。',
  },
  'theme.malformedStandalone': {
    en: 'A theme declaration must be on its own line before the document content.',
    zh: '主题声明必须单独占一行并位于文档内容之前。',
  },
  'theme.duplicateDeclaration': {
    en: 'Only one theme declaration is allowed before the document content; this declaration is ignored.',
    zh: '文档内容之前只允许一个主题声明；此声明将被忽略。',
  },
  'theme.late': {
    en: 'Theme declarations after document content are ignored.',
    zh: '文档内容之后的主题声明将被忽略。',
  },
  'theme.nested': {
    en: 'Theme declarations inside document content are ignored.',
    zh: '文档内容内部的主题声明将被忽略。',
  },
  'theme.invalidDeclaration': {
    en: 'Invalid theme declaration.',
    zh: '无效的主题声明。',
  },

  'attribute.lowercase': {
    en: 'Attribute names must use lowercase kebab-case.',
    zh: '属性名必须使用小写 kebab-case。',
  },
  'budget.attributeName': {
    en: 'Attribute name exceeds the {limit}-character limit.',
    zh: '属性名超过 {limit} 个字符的上限。',
  },
  'attribute.nameInvalid': {
    en: 'Attribute name {name} must use lowercase kebab-case.',
    zh: '属性名 {name} 必须使用小写 kebab-case。',
  },
  'attribute.valueQuoted': {
    en: 'Attribute {name} value must be quoted.',
    zh: '属性 {name} 的值必须加引号。',
  },
  'attribute.valueUnclosed': {
    en: 'Attribute {name} is missing a closing quote.',
    zh: '属性 {name} 缺少结束引号。',
  },
  'attribute.duplicate': {
    en: 'Duplicate attribute {name}.',
    zh: '重复的属性 {name}。',
  },
  'attribute.separator': {
    en: 'Attributes must be separated by whitespace.',
    zh: '属性之间必须用空白分隔。',
  },
  'budget.tagName': {
    en: 'Tag name exceeds the {limit}-character limit.',
    zh: '标签名超过 {limit} 个字符的上限。',
  },
  'tag.missingClose': {
    en: 'Tag {name} is missing >.',
    zh: '标签 {name} 缺少 >。',
  },
  'tag.closingAttributes': {
    en: 'Closing tag </{name}> cannot have attributes.',
    zh: '结束标签 </{name}> 不能带属性。',
  },
  'tag.nameInvalid': {
    en: 'Tag name {name} must use lowercase kebab-case.',
    zh: '标签名 {name} 必须使用小写 kebab-case。',
  },
  'tag.unclosedPaired': {
    en: '<{name}> is missing </{name}>.',
    zh: '<{name}> 缺少 </{name}>。',
  },
  'tag.mismatchRoot': {
    en: 'Closing tag </{name}> does not match the document root.',
    zh: '结束标签 </{name}> 与文档根不匹配。',
  },
  'tag.mismatchParent': {
    en: 'Closing tag </{name}> does not match <{parent}>.',
    zh: '结束标签 </{name}> 与 <{parent}> 不匹配。',
  },
  'tag.requiresClose': {
    en: '<{name}> requires a closing tag.',
    zh: '<{name}> 需要结束标签。',
  },

  'footnote.unsupported': {
    en: 'Footnotes are not part of the local interaction syntax and are shown as source.',
    zh: '脚注不属于本地交互语法，将按源文本显示。',
  },
  'interpolation.unclosed': {
    en: 'Interpolation is missing }}.',
    zh: '插值缺少 }}。',
  },
  'math.unclosed': {
    en: 'Formula is missing its closing delimiter.',
    zh: '公式缺少结束定界符。',
  },
  'math.whitespace': {
    en: 'Inline math cannot start or end with whitespace.',
    zh: '行内公式不能以空白开头或结尾。',
  },
  'budget.math': {
    en: 'Formula exceeds the {limit}-character limit.',
    zh: '公式超过 {limit} 个字符的上限。',
  },
  'html.raw': {
    en: 'Raw HTML is not part of the local interaction syntax.',
    zh: '原始 HTML 不属于本地交互语法。',
  },
  'html.fallback': {
    en: 'Native HTML was safely converted to inert source text.',
    zh: '原生 HTML 已安全回退为惰性源码文本。',
  },
  'html.fallbackAttribute': {
    en: 'Native HTML attribute {name} is unsupported; the element was safely converted to inert source text.',
    zh: '原生 HTML 属性 {name} 不受支持；该元素已安全回退为惰性源码文本。',
  },
  'html.table.structure': { en: 'Invalid native HTML table structure in <{tag}>.', zh: '原生 HTML 表格的 <{tag}> 结构无效。' },
  'html.table.mixed': { en: 'Keep text and Markdown inside cells or captions; native HTML table structure cannot mix with Markdown table rows.', zh: '文字和 Markdown 应写在单元格或标题内；原生 HTML 表格结构不能混用 Markdown 表格行。' },
  'html.table.attribute': { en: 'Attribute {name} is not supported on native HTML <{tag}>. ReactiveMD table options require a Markdown table body.', zh: '原生 HTML <{tag}> 不支持属性 {name}。ReactiveMD 表格选项只适用于 Markdown 表格正文。' },
  'html.table.value': { en: 'Invalid value for {name} on native HTML <{tag}>.', zh: '原生 HTML <{tag}> 的 {name} 属性值无效。' },
  'html.table.unclosed': { en: 'Native HTML table is missing </table>.', zh: '原生 HTML 表格缺少 </table>。' },
  'html.extended': {
    en: 'HTML element <{name}> requires enableExtendedHtml in this mode; it is shown as source.',
    zh: '此模式下 HTML 元素 <{name}> 需要启用 enableExtendedHtml；已按源码显示。',
  },
  'html.attribute': {
    en: 'HTML attribute {name} on <{tag}> is not supported; the element is shown as source.',
    zh: '<{tag}> 上的 HTML 属性 {name} 不受支持；该元素已按源码显示。',
  },
  'html.unsafeUrl': {
    en: 'Unsafe URL in attribute {name} was removed.',
    zh: '属性 {name} 中的不安全 URL 已移除。',
  },
  'html.capability': {
    en: 'Author {feature} was disabled by the compile options.',
    zh: '编译选项已禁用作者提供的{feature}。',
  },
  'recovery.unclosed': {
    en: 'An unclosed RMD fragment was rendered as literal source; its components and expressions are inactive.',
    zh: '未闭合的 RMD 片段已按原文显示，片段中的组件和表达式不执行。',
  },
  'recovery.mismatch': {
    en: 'A fragment with mismatched tags was rendered as literal source; its components and expressions are inactive.',
    zh: '标签不匹配的片段已按原文显示，片段中的组件和表达式不执行。',
  },
  'recovery.strayClose': {
    en: 'A stray closing tag was rendered as literal source.',
    zh: '孤立的结束标签已按原文显示。',
  },
  'recovery.htmlRepair': {
    en: 'Malformed native HTML was structurally repaired for display.',
    zh: 'HTML 结构已修复后显示。',
  },
  'recovery.htmlLiteral': {
    en: 'Native HTML could not be safely repaired and was rendered as literal source.',
    zh: 'HTML 片段无法安全恢复，已按原文显示。',
  },
  'options.htmlFlag': {
    en: 'Compile option {name} must be a boolean.',
    zh: '编译选项 {name} 必须是布尔值。',
  },
  'options.markdownBreaks': {
    en: 'Compile option markdownBreaks must be a boolean.',
    zh: '编译选项 markdownBreaks 必须为布尔值。',
  },
  'options.strict': {
    en: 'Compile option strict must be a boolean.',
    zh: '编译选项 strict 必须为布尔值。',
  },
  'component.unknownSuggestion': {
    en: 'Unknown component <{name}>. Did you mean <{suggestion}>?',
    zh: '未知组件 <{name}>。是否想使用 <{suggestion}>？',
  },
  'component.unknownPlain': {
    en: 'Unknown component <{name}>. This mode only accepts local interaction components.',
    zh: '未知组件 <{name}>。此模式只接受本地交互组件。',
  },

  'legacy.fence': {
    en: 'Legacy reactive-md configuration fences (state/data/computed/actions, etc.) are not part of the local interaction syntax; select legacy mode explicitly in the host.',
    zh: '旧版 reactive-md 配置围栏（state/data/computed/actions 等）不属于本地交互语法；请在宿主中显式选择旧版模式。',
  },
  'attribute.unknownSuggestion': {
    en: 'Component <{component}> does not support attribute {name}. Did you mean {suggestion}?',
    zh: '组件 <{component}> 不支持属性 {name}。是否想使用 {suggestion}？',
  },
  'attribute.unknownPlain': {
    en: 'Component <{component}> does not support attribute {name}.',
    zh: '组件 <{component}> 不支持属性 {name}。',
  },
  'budget.attribute': {
    en: 'Attribute {name} on component <{component}> exceeds the {limit}-character limit.',
    zh: '组件 <{component}> 的属性 {name} 超过 {limit} 个字符的上限。',
  },
  'attribute.color': {
    en: 'Attribute {name} on component <{component}> must be a standard CSS named color or #RGB/#RRGGBB, got "{value}".',
    zh: '组件 <{component}> 的属性 {name} 必须是标准 CSS 命名颜色或 #RGB/#RRGGBB，当前为“{value}”。',
  },
  'attribute.required': {
    en: 'Component <{component}> is missing required attribute {name}.',
    zh: '组件 <{component}> 缺少必需属性 {name}。',
  },
  'label.requiredMissing': {
    en: 'Component <{name}> requires a label.',
    zh: '组件 <{name}> 需要 label。',
  },
  'label.requiredEmpty': {
    en: 'Component <{name}> label cannot be empty.',
    zh: '组件 <{name}> 的 label 不能为空。',
  },
  'attribute.static': {
    en: 'Attribute {name} is static and cannot contain interpolations.',
    zh: '属性 {name} 是静态的，不能包含插值。',
  },
  'host.attributeUnknown': {
    en: 'Component <{component}> does not support attribute {name}.',
    zh: '组件 <{component}> 不支持属性 {name}。',
  },
  'host.attributeRequired': {
    en: 'Component <{component}> is missing required attribute {name}.',
    zh: '组件 <{component}> 缺少必需属性 {name}。',
  },
  'host.attributeStatic': {
    en: 'Attribute {name} is static and cannot contain interpolations.',
    zh: '属性 {name} 是静态的，不能包含插值。',
  },
  'host.attributeType': {
    en: 'Attribute {name} requires a {kind}, got "{value}".',
    zh: '属性 {name} 需要 {kind}，当前为“{value}”。',
  },
  'host.attributeEnum': {
    en: 'Attribute {name} must be one of {values}, got "{value}".',
    zh: '属性 {name} 必须是 {values} 之一，当前为“{value}”。',
  },
  'host.attributePattern': {
    en: 'Attribute {name} must match pattern {pattern}.',
    zh: '属性 {name} 必须匹配模式 {pattern}。',
  },
  'host.attributeInterpolation': {
    en: 'Attribute {name} must be a literal matching {pattern} or one full interpolation.',
    zh: '属性 {name} 必须是匹配 {pattern} 的字面值，或一个完整插值。',
  },
  'expression.emptyAttribute': {
    en: 'Attribute {name} interpolation cannot be empty.',
    zh: '属性 {name} 的插值不能为空。',
  },
  'expression.emptyInterpolation': {
    en: 'Interpolation expression cannot be empty.',
    zh: '插值表达式不能为空。',
  },
  'attribute.numberInvalid': {
    en: 'Attribute {name} requires a number, got "{value}".',
    zh: '属性 {name} 需要数字，当前为“{value}”。',
  },
  'attribute.numberInterpolationInvalid': {
    en: 'Attribute {name} requires a number or a full number interpolation, got "{value}".',
    zh: '属性 {name} 需要数字或完整的数字插值，当前为“{value}”。',
  },
  'attribute.integer': {
    en: 'Attribute {name} requires an integer.',
    zh: '属性 {name} 需要整数。',
  },
  'attribute.positive': {
    en: 'Attribute {name} requires a positive number.',
    zh: '属性 {name} 需要正数。',
  },
  'attribute.rangeMin': {
    en: 'Attribute {name} must be at least {min}.',
    zh: '属性 {name} 必须至少为 {min}。',
  },
  'attribute.rangeMax': {
    en: 'Attribute {name} must be at most {max}.',
    zh: '属性 {name} 必须至多为 {max}。',
  },
  'attribute.booleanInvalid': {
    en: 'Attribute {name} requires true or false.',
    zh: '属性 {name} 需要 true 或 false。',
  },
  'attribute.booleanInterpolationInvalid': {
    en: 'Attribute {name} requires true or false, or a full boolean interpolation.',
    zh: '属性 {name} 需要 true 或 false，或完整的布尔插值。',
  },
  'attribute.enumInvalid': {
    en: 'Attribute {name} must be one of {values}, got "{value}".',
    zh: '属性 {name} 必须是 {values} 之一，当前为“{value}”。',
  },
  'attribute.dateLower': {
    en: 'Date lower bound {value} is not a valid YYYY-MM-DD.',
    zh: '日期下界 {value} 不是有效的 YYYY-MM-DD。',
  },
  'attribute.dateUpper': {
    en: 'Date upper bound {value} is not a valid YYYY-MM-DD.',
    zh: '日期上界 {value} 不是有效的 YYYY-MM-DD。',
  },
  'constraint.componentMinMax': {
    en: 'Component <{name}> min cannot exceed max.',
    zh: '组件 <{name}> 的 min 不能大于 max。',
  },
  'constraint.componentStep': {
    en: 'Component <{name}> step must be greater than 0.',
    zh: '组件 <{name}> 的 step 必须大于 0。',
  },
  'constraint.lengthRange': {
    en: 'max-length cannot be less than min-length.',
    zh: 'max-length 不能小于 min-length。',
  },
  'constraint.dateOrder': {
    en: 'Date min cannot be later than max.',
    zh: '日期 min 不能晚于 max。',
  },
  'constraint.progressRange': {
    en: 'progress value must be between 0 and {max}, got {value}.',
    zh: 'progress 的 value 必须在 0 到 {max} 之间，当前为 {value}。',
  },
  'constraint.plotRange': {
    en: 'plot min must be less than max.',
    zh: 'plot 的 min 必须小于 max。',
  },
  'constraint.timerDuration': {
    en: 'timer duration must be a positive whole number of seconds.',
    zh: 'timer 的 duration 必须是正整数秒。',
  },
  'constraint.rangeSliderOrder': {
    en: 'range-slider min cannot exceed max.',
    zh: 'range-slider 的 min 不能大于 max。',
  },
  'constraint.rangeSliderStep': {
    en: 'range-slider step must be a finite positive number.',
    zh: 'range-slider 的 step 必须是有限正数。',
  },
  'constraint.coordinateOrder': {
    en: 'coordinate {axis}-min cannot exceed {axis}-max.',
    zh: 'coordinate 的 {axis}-min 不能大于 {axis}-max。',
  },
  'constraint.coordinateStep': {
    en: 'coordinate step must be a finite positive number.',
    zh: 'coordinate 的 step 必须是有限正数。',
  },
  'constraint.multiSelectMax': {
    en: 'multi-select max-selected must be a nonnegative whole number.',
    zh: 'multi-select 的 max-selected 必须是非负整数。',
  },
  'constraint.quizTolerance': {
    en: '<quiz> tolerance must be a nonnegative finite number.',
    zh: '<quiz> 的 tolerance 必须是非负有限数。',
  },
  'selection.keyNeedsKey': {
    en: '<{component}> {name} requires a key attribute naming the selection column.',
    zh: '<{component}> 的 {name} 需要 key 属性来指定选择列。',
  },
  'structure.parent': {
    en: '<{name}> can only appear directly inside {parents}.',
    zh: '<{name}> 只能直接位于 {parents} 内。',
  },
  'structure.noBody': {
    en: '<{name}> does not accept body content.',
    zh: '<{name}> 不接受正文内容。',
  },
  'structure.inlineOnly': {
    en: '<{name}> only accepts inline Markdown.',
    zh: '<{name}> 只接受行内 Markdown。',
  },
  'structure.noNestedComponents': {
    en: 'The body of <{name}> cannot contain other interactive components.',
    zh: '<{name}> 的正文不能包含其他交互组件。',
  },
  'structure.noComponents': {
    en: 'The body of <{name}> cannot contain interactive components.',
    zh: '<{name}> 的正文不能包含交互组件。',
  },
  'structure.childrenMinimum': {
    en: '<{name}> requires at least {min} {children}.',
    zh: '<{name}> 至少需要 {min} 个 {children}。',
  },
  'structure.childrenOnly': {
    en: 'Direct children of <{name}> must be {children}.',
    zh: '<{name}> 的直接子元素必须是 {children}。',
  },
  'structure.sequenceMinimum': {
    en: '<{name}> requires at least one <{child}>.',
    zh: '<{name}> 至少需要一个 <{child}>。',
  },
  'structure.sequenceOnly': {
    en: '<{name}> can only contain <{child}>.',
    zh: '<{name}> 只能包含 <{child}>。',
  },
  'structure.accordionNeedsDisclosure': {
    en: '<accordion> requires at least one <disclosure>.',
    zh: '<accordion> 至少需要一个 <disclosure>。',
  },
  'structure.accordionOnly': {
    en: '<accordion> can only contain <disclosure>.',
    zh: '<accordion> 只能包含 <disclosure>。',
  },
  'structure.gridNeedsCard': {
    en: '<grid> requires at least one <card>.',
    zh: '<grid> 至少需要一个 <card>。',
  },
  'structure.gridOnlyCard': {
    en: 'Direct children of <grid> must be <card>.',
    zh: '<grid> 的直接子元素必须是 <card>。',
  },
  'structure.exactlyOneTable': {
    en: 'The body of <{name}> must be exactly one Markdown table.',
    zh: '<{name}> 的正文必须恰好是一个 Markdown 表格。',
  },
  'structure.plotNeedsFormula': {
    en: '<plot> requires at least one $$...$$ formula block.',
    zh: '<plot> 至少需要一个 $$...$$ 公式块。',
  },
  'structure.plotOnlyFormulas': {
    en: 'The body of <plot> can only contain blank lines and $$...$$ formula blocks.',
    zh: '<plot> 的正文只能包含空行和 $$...$$ 公式块。',
  },
  'structure.nodeNoComponents': {
    en: 'The description of <node> cannot contain interactive components.',
    zh: '<node> 的描述不能包含交互组件。',
  },
  'structure.optionsNeeded': {
    en: '<{name}> requires at least one <option value="...">.',
    zh: '<{name}> 至少需要一个 <option value="...">。',
  },
  'structure.optionsOnly': {
    en: '<{name}> can only contain <option>.',
    zh: '<{name}> 只能包含 <option>。',
  },
  'budget.options': {
    en: '<{name}> options exceed the limit of {limit}.',
    zh: '<{name}> 的选项数量超过上限 {limit}。',
  },
  'option.valueRequired': {
    en: '<option> requires a non-empty value.',
    zh: '<option> 需要非空 value。',
  },
  'option.valueComma': {
    en: '<multi-select> option values cannot contain commas: "{value}".',
    zh: '<multi-select> 的选项值不能包含逗号：“{value}”。',
  },
  'option.valueDuplicate': {
    en: 'Option values in <{name}> must be unique; duplicate value "{value}".',
    zh: '<{name}> 的选项值必须唯一；重复值“{value}”。',
  },
  'structure.optionNoComponents': {
    en: 'The body of <option> cannot contain interactive components.',
    zh: '<option> 的正文不能包含交互组件。',
  },
  'structure.tabsNeedsTab': {
    en: '<tabs> requires at least one <tab>.',
    zh: '<tabs> 至少需要一个 <tab>。',
  },
  'structure.tabsOnly': {
    en: '<tabs> can only contain <tab>.',
    zh: '<tabs> 只能包含 <tab>。',
  },
  'tab.valueDuplicate': {
    en: 'Tab values in <tabs> must be unique; duplicate value "{value}".',
    zh: '<tabs> 的标签值必须唯一；重复值“{value}”。',
  },
  'structure.stepsNeedsStep': {
    en: '<steps> requires at least one <step>.',
    zh: '<steps> 至少需要一个 <step>。',
  },
  'structure.stepsOnly': {
    en: '<steps> can only contain <step>.',
    zh: '<steps> 只能包含 <step>。',
  },
  'step.valueDuplicate': {
    en: 'Step values in <steps> must be unique; duplicate value "{value}".',
    zh: '<steps> 的步骤值必须唯一；重复值“{value}”。',
  },
  'quiz.answerRequired': {
    en: '<quiz> requires a non-empty answer.',
    zh: '<quiz> 需要非空 answer。',
  },
  'structure.quizNumericNoBody': {
    en: 'A numeric <quiz> cannot have body content; use type="choice" for option-based quizzes.',
    zh: '数值型 <quiz> 不能有正文内容；基于选项的测验请使用 type="choice"。',
  },
  'quiz.answerNumeric': {
    en: 'A numeric <quiz> answer must be a finite number.',
    zh: '数值型 <quiz> 的 answer 必须是有限数字。',
  },
  'quiz.answerNotOption': {
    en: '<quiz> answer "{answer}" is not one of the option values: {options}.',
    zh: '<quiz> 的 answer“{answer}”不在选项值中：{options}。',
  },
  'diagram.needsNode': {
    en: '<diagram> requires at least one <node>.',
    zh: '<diagram> 至少需要一个 <node>。',
  },
  'structure.diagramOnly': {
    en: '<diagram> can only contain <node> and <edge>.',
    zh: '<diagram> 只能包含 <node> 和 <edge>。',
  },
  'diagram.nodeInvalid': {
    en: 'Node ID "{id}" may only contain letters, digits, underscores and hyphens, and cannot start with a digit.',
    zh: '节点 ID“{id}”只能包含字母、数字、下划线和连字符，且不能以数字开头。',
  },
  'diagram.nodeDuplicate': {
    en: 'Duplicate node ID "{id}".',
    zh: '重复的节点 ID“{id}”。',
  },
  'diagram.edgeFromUnknown': {
    en: 'Edge from references unknown node "{id}".',
    zh: '连线起点引用了未知节点“{id}”。',
  },
  'diagram.edgeToUnknown': {
    en: 'Edge to references unknown node "{id}".',
    zh: '连线终点引用了未知节点“{id}”。',
  },
  'diagram.edgeDuplicate': {
    en: 'Duplicate edge: {from} → {to}{label}.',
    zh: '重复的连线：{from} → {to}{label}。',
  },
  'checklist.bodySingle': {
    en: 'The body of <checklist> must be exactly one single-level Markdown task list.',
    zh: '<checklist> 的正文必须恰好是一个单层 Markdown 任务列表。',
  },
  'checklist.needsItem': {
    en: '<checklist> requires at least one task list item.',
    zh: '<checklist> 至少需要一个任务列表项。',
  },
  'budget.checklistItems': {
    en: '<checklist> items exceed the limit of {limit}.',
    zh: '<checklist> 的任务项数量超过上限 {limit}。',
  },
  'checklist.taskOnly': {
    en: '<checklist> can only contain task list items (- [ ] / - [x]).',
    zh: '<checklist> 只能包含任务列表项（- [ ] / - [x]）。',
  },
  'checklist.noNested': {
    en: '<checklist> does not support nested lists.',
    zh: '<checklist> 不支持嵌套列表。',
  },
  'checklist.noComponents': {
    en: '<checklist> items cannot contain interactive components.',
    zh: '<checklist> 的任务项不能包含交互组件。',
  },
  'budget.identifier': {
    en: 'Parameter name exceeds the {limit}-character limit.',
    zh: '参数名超过 {limit} 个字符的上限。',
  },
  'binding.nameInvalid': {
    en: 'Parameter name "{name}" must match [A-Za-z_][A-Za-z0-9_]*.',
    zh: '参数名“{name}”必须匹配 [A-Za-z_][A-Za-z0-9_]*。',
  },
  'binding.reserved': {
    en: 'Parameter name "{name}" is reserved; choose another name.',
    zh: '参数名“{name}”是保留名称；请换一个名称。',
  },
  'binding.typeConflict': {
    en: 'Parameter "{key}" is already declared as {kind} by <{first}> and cannot also bind <{second}>.',
    zh: '参数“{key}”已由 <{first}> 声明为 {kind}，不能再绑定 <{second}>。',
  },
  'binding.exclusive': {
    en: 'Parameter "{key}" of <{first}> can only be owned by one component and cannot be shared with <{second}>.',
    zh: '<{first}> 的参数“{key}”只能由一个组件拥有，不能与 <{second}> 共享。',
  },
  'binding.slotExclusive': {
    en: 'Parameter "{key}" of the {slot} slot of <{name}> is exclusive and cannot be shared with another control.',
    zh: '<{name}> 的 {slot} 槽参数“{key}”是独占的，不能与另一个控件共享。',
  },
  'binding.constraintConflict': {
    en: 'Parameter "{key}" must use the same numeric range and step: <{first}> has {firstConstraints}, <{second}> has {secondConstraints}.',
    zh: '参数“{key}”必须使用相同的数值范围和步长：<{first}> 为 {firstConstraints}，<{second}> 为 {secondConstraints}。',
  },
  'binding.optionConflict': {
    en: 'Parameter "{key}" must use the same option set in the same order.',
    zh: '参数“{key}”必须使用相同顺序的同一组选项。',
  },
  'initial.duplicate': {
    en: 'Parameter "{key}" has multiple explicit initial values ({count} in total).',
    zh: '参数“{key}”有多个显式初值（共 {count} 个）。',
  },
  'initial.duplicatePeers': {
    en: 'Parameter "{key}" has multiple explicit initial values ({count} in total; see also line {lines}).',
    zh: '参数“{key}”有多个显式初值（共 {count} 个；另见第 {lines} 行）。',
  },
  'initial.rangeNoStep': {
    en: 'Parameter "{key}" has no valid step value within range [{min}, {max}].',
    zh: '参数“{key}”在范围 [{min}, {max}] 内没有有效的步长值。',
  },
  'initial.cannotDerive': {
    en: 'Cannot derive a default initial value for <{name}> parameter "{key}".',
    zh: '无法为 <{name}> 的参数“{key}”推导默认初值。',
  },
  'initial.typeFiniteNumber': {
    en: 'Initial value of parameter "{key}" must be a finite number.',
    zh: '参数“{key}”的初值必须是有限数字。',
  },
  'initial.belowMin': {
    en: 'Initial value {value} of parameter "{key}" is below the minimum {min}.',
    zh: '参数“{key}”的初值 {value} 小于最小值 {min}。',
  },
  'initial.aboveMax': {
    en: 'Initial value {value} of parameter "{key}" exceeds the maximum {max}.',
    zh: '参数“{key}”的初值 {value} 超过最大值 {max}。',
  },
  'initial.offStep': {
    en: 'Initial value {value} of parameter "{key}" is not on step {step} (based at {base}).',
    zh: '参数“{key}”的初值 {value} 不在步长 {step} 上（基准 {base}）。',
  },
  'initial.typeBoolean': {
    en: 'Initial value of parameter "{key}" must be a boolean.',
    zh: '参数“{key}”的初值必须是布尔值。',
  },
  'initial.notAmongOptions': {
    en: 'Initial value "{value}" of parameter "{key}" is not among the available values {options}.',
    zh: '参数“{key}”的初值“{value}”不在可用值 {options} 中。',
  },
  'initial.typeWrong': {
    en: 'Initial value of parameter "{name}" has the wrong type.',
    zh: '参数“{name}”的初值类型不正确。',
  },
  'initial.typeCollection': {
    en: 'Initial value of parameter "{key}" must be a JSON array.',
    zh: '参数“{key}”的初值必须是 JSON 数组。',
  },
  'initial.typeStringArray': {
    en: 'Initial value of parameter "{key}" must be an array of strings.',
    zh: '参数“{key}”的初值必须是字符串数组。',
  },
  'initial.typeNumberArray': {
    en: 'Initial value of parameter "{key}" must be an array of finite numbers.',
    zh: '参数“{key}”的初值必须是有限数字组成的数组。',
  },
  'initial.maxItems': {
    en: 'Initial value of parameter "{key}" exceeds the limit of {max} items.',
    zh: '参数“{key}”的初值超过 {max} 项的上限。',
  },
  'initial.dateInvalid': {
    en: 'Initial date "{value}" is not a valid YYYY-MM-DD.',
    zh: '初值日期“{value}”不是有效的 YYYY-MM-DD。',
  },
  'initial.notAvailableOption': {
    en: 'Initial value "{value}" is not an available option: {options}.',
    zh: '初值“{value}”不是可用选项：{options}。',
  },
  'initial.multiSelectOption': {
    en: 'Initial value "{value}" of parameter "{key}" is not an option of <multi-select>.',
    zh: '参数“{key}”的初值“{value}”不是 <multi-select> 的选项。',
  },
  'initial.rangeSliderOrder': {
    en: '<range-slider> start {start} cannot be greater than end {end}.',
    zh: '<range-slider> 的 start {start} 不能大于 end {end}。',
  },
  'initial.slotBelowMin': {
    en: 'Initial value {value} of <{name}> {slot} is below the minimum {min}.',
    zh: '<{name}> 的 {slot} 初值 {value} 小于最小值 {min}。',
  },
  'initial.slotAboveMax': {
    en: 'Initial value {value} of <{name}> {slot} exceeds the maximum {max}.',
    zh: '<{name}> 的 {slot} 初值 {value} 超过最大值 {max}。',
  },
  'initial.slotOffStep': {
    en: 'Initial value {value} of <{name}> {slot} is not on step {step} (based at {base}).',
    zh: '<{name}> 的 {slot} 初值 {value} 不在步长 {step} 上（基准 {base}）。',
  },
  'initial.lengthBelow': {
    en: 'Initial value of parameter "{key}" has length {length}, below the minimum length {min} required by <{name}>.',
    zh: '参数“{key}”的初值长度为 {length}，小于 <{name}> 要求的最小长度 {min}。',
  },
  'initial.lengthAbove': {
    en: 'Initial value of parameter "{key}" has length {length}, exceeding the maximum length {max} allowed by <{name}>.',
    zh: '参数“{key}”的初值长度为 {length}，超过 <{name}> 允许的最大长度 {max}。',
  },
  'initial.email': {
    en: 'Initial value of parameter "{key}" is not a valid email address.',
    zh: '参数“{key}”的初值不是有效的电子邮件地址。',
  },
  'initial.dateBelow': {
    en: 'Initial value {value} of parameter "{key}" is earlier than the minimum date {min} of <date>.',
    zh: '参数“{key}”的初值 {value} 早于 <date> 的最小日期 {min}。',
  },
  'initial.dateAbove': {
    en: 'Initial value {value} of parameter "{key}" is later than the maximum date {max} of <date>.',
    zh: '参数“{key}”的初值 {value} 晚于 <date> 的最大日期 {max}。',
  },
  'initial.multiSelectExceeds': {
    en: 'Initial values of <multi-select> exceed max-selected {max}.',
    zh: '<multi-select> 的初值数量超过 max-selected {max}。',
  },
  'expression.error': {
    en: 'Expression error: {detail}',
    zh: '表达式错误：{detail}',
  },
  'binding.unknownSuggestion': {
    en: 'Reference to undeclared parameter {name}. Did you mean {suggestion}?',
    zh: '引用了未声明的参数 {name}。是否想使用 {suggestion}？',
  },
  'binding.unknownPlain': {
    en: 'Reference to undeclared parameter {name}.',
    zh: '引用了未声明的参数 {name}。',
  },
  'type.number': {
    en: 'Expected a number here, but the expression evaluates to {kind}.',
    zh: '此处需要数字，但表达式结果为 {kind}。',
  },
  'type.boolean': {
    en: 'Expected a boolean here, but the expression evaluates to {kind}.',
    zh: '此处需要布尔值，但表达式结果为 {kind}。',
  },
  'type.string': {
    en: 'Expected a string here, but the expression evaluates to {kind}.',
    zh: '此处需要字符串，但表达式结果为 {kind}。',
  },
  'type.arrayNoDisplay': {
    en: 'Arrays cannot be displayed directly; convert them first with a function such as len.',
    zh: '数组不能直接显示；请先用 len 等函数转换。',
  },
  'attribute.fullInterpolation': {
    en: 'The {name} attribute of <{component}> must be a full interpolation.',
    zh: '<{component}> 的 {name} 属性必须是完整插值。',
  },
  'anchor.idInvalid': {
    en: 'Anchor id "{id}" must match [A-Za-z_][A-Za-z0-9_-]*.',
    zh: '锚点 id“{id}”必须匹配 [A-Za-z_][A-Za-z0-9_-]*。',
  },
  'anchor.duplicate': {
    en: 'Duplicate anchor id "{id}".',
    zh: '重复的锚点 id“{id}”。',
  },
  'anchor.headingCollision': {
    en: 'Anchor id "{id}" collides with an automatic heading target.',
    zh: '锚点 id“{id}”与自动标题目标冲突。',
  },
  'jump.empty': {
    en: '<jump> target cannot be empty.',
    zh: '<jump> 的目标不能为空。',
  },
  'jump.badTarget': {
    en: '<jump> target "{target}" must be a bare heading slug or anchor id without "#" or whitespace.',
    zh: '<jump> 的目标“{target}”必须是不含“#”或空白的标题 slug 或锚点 id。',
  },
  'jump.unresolved': {
    en: '<jump> target "{target}" does not resolve to a heading or explicit anchor in this document.',
    zh: '<jump> 的目标“{target}”无法解析到本文档中的标题或显式锚点。',
  },
  'budget.plotCurves': {
    en: '<plot> supports at most {limit} curves, but has {count}.',
    zh: '<plot> 最多支持 {limit} 条曲线，当前有 {count} 条。',
  },
  'budget.plotPoints': {
    en: "The document's total plot sample count exceeds the limit of {limit}.",
    zh: '文档的绘图采样点总数超过上限 {limit}。',
  },
  'math.formulaShape': {
    en: '<plot> formulas must be an equation: y = f(x), a parametric cases block, or an implicit equation in x and y.',
    zh: '<plot> 的公式必须是方程：y = f(x)、参数方程 cases 块，或关于 x 和 y 的隐式方程。',
  },
  'math.computeFailed': {
    en: 'Cannot compute plot formula: {detail}',
    zh: '无法计算绘图公式（错误代码 {code}）：{detail}',
  },
  'math.bindingUnknown': {
    en: 'Plot formula references undeclared parameter "{name}".',
    zh: '绘图公式引用了未声明的参数“{name}”。',
  },
  'math.bindingType': {
    en: 'Plot parameter "{name}" must be a number, but is {kind}.',
    zh: '绘图参数“{name}”必须是数字，但当前为 {kind}。',
  },
  'math.displayUnsupportedCommand': {
    en: 'Formula command \\{name} is not supported; it is displayed as literal text.',
    zh: '公式命令 \\{name} 不受支持；已按原文显示。',
  },
  'math.displayUnsupportedEnvironment': {
    en: 'Formula environment {name} is not supported; it is displayed as literal text.',
    zh: '公式环境 {name} 不受支持；已按原文显示。',
  },
  'math.displayBudget': {
    en: 'Formula exceeds a display resource limit ({limit}); it is displayed as literal text.',
    zh: '公式超过显示资源上限（{limit}）；已按原文显示。',
  },
  'math.displayStrayEnd': {
    en: 'Formula has an unmatched \\end; it is displayed as literal text.',
    zh: '公式中存在未匹配的 \\end；已按原文显示。',
  },
  'math.displayEnvironmentUnclosed': {
    en: 'Formula environment {name} is missing its closing brace; it is displayed as literal text.',
    zh: '公式环境 {name} 缺少结束花括号；已按原文显示。',
  },
  'math.displayEnvironmentMissingName': {
    en: 'Formula environment is missing its name; \\begin is displayed as literal text.',
    zh: '公式环境缺少名称；\\begin 已按原文显示。',
  },
  'math.displaySyntax': {
    en: 'Formula structure cannot be displayed and is shown as literal text.',
    zh: '公式结构无法显示，已按原文显示。',
  },
  'table.missingHeader': {
    en: 'The table for <{name}> is missing a header.',
    zh: '<{name}> 的表格缺少表头。',
  },
  'table.headerInterpolation': {
    en: 'Table headers cannot contain interpolations.',
    zh: '表格表头不能包含插值。',
  },
  'table.headerEmpty': {
    en: 'Table headers cannot be empty.',
    zh: '表格表头不能为空。',
  },
  'table.headerDuplicate': {
    en: 'Duplicate table header "{name}".',
    zh: '重复的表格表头“{name}”。',
  },
  'table.rowColumnMismatch': {
    en: 'Table row has a different column count: header has {header} columns, this row has {row}.',
    zh: '表格行的列数不一致：表头有 {header} 列，此行有 {row} 列。',
  },
  'chart.numericExpression': {
    en: 'Chart column "{name}" requires a number in row {row}, but the expression evaluates to {kind}.',
    zh: '图表列“{name}”第 {row} 行需要数字，但表达式结果为 {kind}。',
  },
  'timeline.numericExpression': {
    en: 'Timeline column "{name}" requires a number in row {row}, but the expression evaluates to {kind}.',
    zh: '时间线列“{name}”第 {row} 行需要数字，但表达式结果为 {kind}。',
  },
  'chart.numericPlain': {
    en: 'Chart column "{name}" requires a plain number in row {row}, got "{value}".',
    zh: '图表列“{name}”第 {row} 行需要普通数字，当前为“{value}”。',
  },
  'timeline.numericPlain': {
    en: 'Timeline column "{name}" requires a plain number in row {row}, got "{value}".',
    zh: '时间线列“{name}”第 {row} 行需要普通数字，当前为“{value}”。',
  },
  'selection.keyEmpty': {
    en: '<{component}> key cannot be empty.',
    zh: '<{component}> 的 key 不能为空。',
  },
  'selection.keyMissingColumn': {
    en: '<{component}> key column "{name}" does not exist in its table.',
    zh: '<{component}> 的 key 列“{name}”在表格中不存在。',
  },
  'selection.keyInterpolation': {
    en: '<{component}> key column "{name}" must contain static text; row {row} contains an interpolation.',
    zh: '<{component}> 的 key 列“{name}”必须包含静态文本；第 {row} 行包含插值。',
  },
  'selection.keyEmptyCell': {
    en: '<{component}> key column "{name}" cannot be empty in row {row}.',
    zh: '<{component}> 的 key 列“{name}”在第 {row} 行不能为空。',
  },
  'selection.keyDuplicate': {
    en: '<{component}> key column "{name}" must be unique; duplicate value "{value}".',
    zh: '<{component}> 的 key 列“{name}”必须唯一；重复值“{value}”。',
  },
  'initial.selectionNotValue': {
    en: 'Initial selection "{value}" of <{component}> is not a value of key column "{name}".',
    zh: '<{component}> 的初始选择“{value}”不是 key 列“{name}”中的值。',
  },
  'chart.columnComma': {
    en: 'Chart column names cannot contain commas: "{name}".',
    zh: '图表列名不能包含逗号：“{name}”。',
  },
  'chart.xMissing': {
    en: 'Chart x column "{name}" does not exist.',
    zh: '图表 x 列“{name}”不存在。',
  },
  'chart.yRequired': {
    en: 'Chart y requires a column name.',
    zh: '图表 y 需要列名。',
  },
  'chart.yMissing': {
    en: 'Chart y column "{name}" does not exist.',
    zh: '图表 y 列“{name}”不存在。',
  },
  'chart.needsNumeric': {
    en: 'Chart requires at least one numeric column.',
    zh: '图表至少需要一个数值列。',
  },
  'chart.scatterXMissing': {
    en: 'Scatter chart x column "{name}" does not exist.',
    zh: '散点图的 x 列“{name}”不存在。',
  },
  'chart.scatterNeedsNumeric': {
    en: 'Scatter chart requires at least one numeric column.',
    zh: '散点图至少需要一个数值列。',
  },
  'chart.donutNeedsColumns': {
    en: 'Donut chart requires a label column and a value column.',
    zh: '环形图需要一个标签列和一个数值列。',
  },
  'chart.donutYOne': {
    en: 'Donut chart y can only specify one numeric column.',
    zh: '环形图的 y 只能指定一个数值列。',
  },
  'chart.donutNeedY': {
    en: 'A donut chart with more than two columns must use y to specify the single numeric column.',
    zh: '超过两列的环形图必须用 y 指定唯一的数值列。',
  },
  'chart.negative': {
    en: 'Donut chart values cannot be negative; row {row} is {value}.',
    zh: '环形图的数值不能为负；第 {row} 行为 {value}。',
  },
  'timeline.headerMissing': {
    en: 'Timeline requires either Task, Start and Duration columns or 事项, 开始 and 时长 columns, with optional Notes or 说明.',
    zh: '时间线需要 Task、Start、Duration 列，或 事项、开始、时长 列，并可选 Notes 或 说明。',
  },
  'timeline.columnUnsupported': {
    en: 'Timeline does not support column "{name}".',
    zh: '时间线不支持列“{name}”。',
  },
  'timeline.negative': {
    en: 'Timeline column "{name}" cannot be negative in row {row}.',
    zh: '时间线列“{name}”在第 {row} 行不能为负。',
  },

  'runtime.bindingNoWritable': {
    en: 'This component has no writable binding state.',
    zh: '此组件没有可写的绑定状态。',
  },
  'runtime.bindingNeedsSlot': {
    en: 'This multi-slot component requires a slot such as start/end or x/y.',
    zh: '此多槽组件需要 start/end 或 x/y 之类的槽位。',
  },
  'runtime.bindingUnknownSlot': {
    en: 'This component has no writable slot "{slot}".',
    zh: '此组件没有可写的槽位“{slot}”。',
  },
  'runtime.bindingNoMultiSlot': {
    en: 'This component does not support multiple slots.',
    zh: '此组件不支持多个槽位。',
  },
  'runtime.dateInvalid': {
    en: 'Date must be a valid YYYY-MM-DD or an empty string.',
    zh: '日期必须是有效的 YYYY-MM-DD 或空字符串。',
  },
  'runtime.dateRequired': {
    en: 'This date is required.',
    zh: '此日期为必填项。',
  },
  'runtime.dateEarlier': {
    en: 'Date cannot be earlier than {min}.',
    zh: '日期不能早于 {min}。',
  },
  'runtime.dateLater': {
    en: 'Date cannot be later than {max}.',
    zh: '日期不能晚于 {max}。',
  },
  'runtime.fieldRequired': {
    en: 'This field is required.',
    zh: '此字段为必填项。',
  },
  'runtime.minLength': {
    en: 'At least {min} characters.',
    zh: '至少 {min} 个字符。',
  },
  'runtime.maxLength': {
    en: 'At most {max} characters.',
    zh: '至多 {max} 个字符。',
  },
  'runtime.emailLength': {
    en: 'Email address cannot exceed {limit} characters.',
    zh: '电子邮件地址不能超过 {limit} 个字符。',
  },
  'runtime.emailInvalid': {
    en: 'Enter a valid email address.',
    zh: '请输入有效的电子邮件地址。',
  },
  'runtime.finiteNumber': {
    en: 'Parameter "{name}" requires a finite number.',
    zh: '参数“{name}”需要有限数字。',
  },
  'runtime.min': {
    en: 'Parameter "{name}" must be at least {min}.',
    zh: '参数“{name}”必须至少为 {min}。',
  },
  'runtime.max': {
    en: 'Parameter "{name}" must be at most {max}.',
    zh: '参数“{name}”必须至多为 {max}。',
  },
  'runtime.step': {
    en: 'Parameter "{name}" must be a multiple of step {step} (base {base}).',
    zh: '参数“{name}”必须是步长 {step} 的倍数（基准 {base}）。',
  },
  'runtime.boolean': {
    en: 'Parameter "{name}" requires a boolean.',
    zh: '参数“{name}”需要布尔值。',
  },
  'runtime.string': {
    en: 'Parameter "{name}" requires a string.',
    zh: '参数“{name}”需要字符串。',
  },
  'runtime.array': {
    en: 'Parameter "{name}" requires an array of strings.',
    zh: '参数“{name}”需要字符串数组。',
  },
  'runtime.arrayMembers': {
    en: 'Parameter "{name}" members must be strings.',
    zh: '参数“{name}”的成员必须是字符串。',
  },
  'runtime.numberArray': {
    en: 'Parameter "{name}" requires an array of finite numbers.',
    zh: '参数“{name}”需要有限数字数组。',
  },
  'runtime.numberArrayMembers': {
    en: 'Parameter "{name}" members must be finite numbers.',
    zh: '参数“{name}”的成员必须是有限数字。',
  },
  'runtime.null': {
    en: 'Parameter "{name}" requires null.',
    zh: '参数“{name}”需要 null。',
  },
  'runtime.checklistOption': {
    en: 'Checklist item "{value}" does not exist.',
    zh: '清单项“{value}”不存在。',
  },
  'runtime.maxItems': {
    en: 'Parameter "{name}" allows at most {max} selected values.',
    zh: '参数“{name}”最多允许选择 {max} 个值。',
  },
  'runtime.unsupportedType': {
    en: 'Parameter "{name}" has an unsupported value type.',
    zh: '参数“{name}”的值类型不受支持。',
  },
  'runtime.option': {
    en: 'Value "{value}" is not among the options: {options}.',
    zh: '值“{value}”不在选项中：{options}。',
  },
  'runtime.budget': {
    en: 'Parameter "{name}": {detail}',
    zh: '参数“{name}”：{detail}',
  },
  'runtime.rangeOrder': {
    en: 'The range start cannot be greater than its end.',
    zh: '范围起点不能大于终点。',
  },

  'budget.string': {
    en: 'String exceeds the {limit}-character limit.',
    zh: '字符串超过 {limit} 个字符的上限。',
  },
  'budget.array': {
    en: 'Array exceeds the {limit}-item limit.',
    zh: '数组超过 {limit} 个项的上限。',
  },
  'budget.arrayMember': {
    en: 'Array member exceeds the {limit}-character limit.',
    zh: '数组成员超过 {limit} 个字符的上限。',
  },
  'budget.arrayContents': {
    en: 'Array contents exceed the {limit}-character limit.',
    zh: '数组内容超过 {limit} 个字符的上限。',
  },

  'theme.missing': {
    en: 'Theme "{name}" is not registered by the host; using the default theme.',
    zh: '宿主未注册主题“{name}”；将使用默认主题。',
  },
  'theme.registryUnreadable': {
    en: 'The host theme registry could not be read; using the default theme.',
    zh: '无法读取宿主主题注册表；将使用默认主题。',
  },
  'theme.invalidDefinition': {
    en: 'The selected theme "{name}" is not a valid definition; using the default theme.',
    zh: '所选主题“{name}”不是有效定义；将使用默认主题。',
  },
  'theme.duplicateRegistration': {
    en: 'Theme "{name}" is registered more than once; using the default theme.',
    zh: '主题“{name}”被多次注册；将使用默认主题。',
  },
  'theme.protocol': {
    en: 'Theme "{name}" does not support the {protocol} protocol; using the default theme.',
    zh: '主题“{name}”不支持 {protocol} 协议；将使用默认主题。',
  },
  'theme.modes': {
    en: 'Theme "{name}" must supply both light and dark color schemes; using the default theme.',
    zh: '主题“{name}”必须同时提供浅色和深色配色；将使用默认主题。',
  },
  'theme.selectedUnreadable': {
    en: 'The selected theme "{name}" could not be read; using the default theme.',
    zh: '所选主题“{name}”无法读取；将使用默认主题。',
  },
  // Nested errors are selected by their structured codes, never English text.
  'error.expression-syntax': { en: 'Check expression operators, parentheses and arguments.', zh: '表达式语法不正确，请检查运算符、括号或参数是否完整。' },
  'error.expression-index': { en: 'An array index must be a finite safe integer.', zh: '数组索引必须为有限的安全整数。' },
  'error.expression-cycle': { en: 'Named calculations contain a dependency cycle.', zh: '命名计算中存在循环依赖。' },
  'error.array.homogeneous': { en: 'Array elements must all be strings or all be numbers.', zh: '数组元素必须全部为字符串或全部为数字。' },
  'error.array.finite': { en: 'Array members must be finite numbers.', zh: '数字数组元素必须为有限数值。' },
  'error.array.members': { en: 'Array members must be strings or finite numbers.', zh: '数组元素必须为字符串或有限数值。' },
  'error.expression-number': { en: 'A numeric literal must be finite and valid.', zh: '数字字面量无效，必须是有限数值。' },
  'error.expression-string': { en: 'Check the string quotes and escape sequences.', zh: '字符串格式不正确，请检查引号和转义。' },
  'error.expression-budget': { en: 'The expression exceeded a resource budget.', zh: '表达式超过长度、节点、深度或求值步数预算，请简化表达式。' },
  'error.expression-assignment': { en: 'Assignment is not allowed in expressions.', zh: '表达式不能执行赋值，请使用比较运算符。' },
  'error.expression-property': { en: 'Property access is not allowed.', zh: '表达式不支持属性访问，请直接引用绑定名称。' },
  'error.expression-empty': { en: 'An expression is required.', zh: '此处需要非空表达式。' },
  'error.expression-unknown-function': { en: 'Use a supported built-in function.', zh: '函数不受支持，请使用语言内置函数。' },
  'error.expression-arity': { en: 'Check the function argument count.', zh: '函数参数数量不正确。' },
  'error.expression-forbidden-name': { en: 'The name is forbidden.', zh: '此名称属于禁止访问的名称，请使用已声明的绑定。' },
  'error.expression-type': { en: 'Operand or argument types do not match.', zh: '操作数或函数参数的类型不匹配，请检查绑定类型。' },
  'error.expression-unknown-name': { en: 'The binding is not declared.', zh: '引用了未声明的绑定。' },
  'error.expression-value': { en: 'The binding value is not supported.', zh: '绑定值不符合表达式支持的类型或数值范围。' },
  'error.expression-eval': { en: 'The expression cannot be evaluated.', zh: '表达式无法求值，请检查输入和运算条件。' },
  'error.expression-domain': { en: 'A value lies outside the function domain.', zh: '参数超出函数定义域。' },
  'error.expression-divide-by-zero': { en: 'Division by zero is undefined.', zh: '除数不能为零。' },
  'error.expression-interpolation': { en: 'Check interpolation delimiters and content.', zh: '插值格式不正确，请检查分隔符和表达式内容。' },
  'error.latex-budget': { en: 'The formula exceeded a resource budget.', zh: '公式超过长度、记号、节点、深度或计算步数预算，请简化公式。' },
  'error.latex-syntax': { en: 'Check formula syntax and delimiters.', zh: '公式语法不正确，请检查命令、括号和分隔符。' },
  'error.latex-empty': { en: 'A formula is required.', zh: '公式不能为空。' },
  'error.latex-relation': { en: 'Check the formula relation.', zh: '公式中的关系式不符合计算语法。' },
  'error.latex-number': { en: 'A formula number must be finite.', zh: '公式中的数字必须是有限数值。' },
  'error.latex-name': { en: 'Use a valid formula parameter name.', zh: '公式参数名称无效，请使用合法绑定名。' },
  'error.latex-unsupported': { en: 'The LaTeX structure is not computable.', zh: '此 LaTeX 结构不支持计算，请改用支持的函数和运算。' },
  'error.latex-variable': { en: 'A numeric formula parameter is missing or invalid.', zh: '公式引用的参数缺失或不是有限数字。' },
  'error.latex-type': { en: 'A formula parameter has the wrong type.', zh: '公式参数类型不正确，计算参数必须为数字。' },
  'error.latex-divide-by-zero': { en: 'Division by zero is undefined.', zh: '公式中的除数不能为零。' },
  'error.latex-domain': { en: 'A formula value lies outside the function domain.', zh: '公式参数超出函数定义域。' },
  'error.latex-undefined': { en: 'The formula is undefined at this point.', zh: '公式在此点没有有限定义值。' },
  'error.latex-plot-range': { en: 'Plot bounds must be finite and increasing.', zh: '绘图区间必须由有限数值构成，且最小值小于最大值。' },
  'error.latex-plot-samples': { en: 'The sample count must be an integer from 2 to 2000.', zh: '采样点数必须为 2 至 2000 的整数。' },
  'local.external.placement': { en: '<external> declarations must be standalone tags at the document top level.', zh: '<external> 声明必须独占一行，位于文档顶层。' },
  'local.external.name': { en: 'External name "{name}" must match [A-Za-z_][A-Za-z0-9_]*.', zh: '外部名称“{name}”必须匹配 [A-Za-z_][A-Za-z0-9_]*。' },
  'local.external.reserved': { en: 'External name "{name}" is reserved; choose another name.', zh: '外部名称“{name}”为保留名称，请更换。' },
  'local.external.duplicate': { en: 'External name "{name}" is declared more than once.', zh: '外部名称“{name}”被重复声明。' },
  'local.external.conflict': { en: 'External name "{name}" conflicts with a control parameter of the same name.', zh: '外部名称“{name}”与同名控件参数冲突。' },
  'local.external.type': { en: 'External "{name}" must declare type string, number, boolean, string-array or number-array.', zh: '外部声明“{name}”必须声明 string、number、boolean、string-array 或 number-array 类型。' },
  'local.host.structure.leaf': { en: 'Host component <{component}> is a leaf and cannot have body content.', zh: '宿主组件 <{component}> 是叶子组件，不能包含正文内容。' },
  'local.runtime.external': { en: 'External value {name} cannot be written.', zh: '无法写入外部数据 {name}。' },
  'local.runtime.external-value': { en: 'External value {name} must be {kind}.', zh: '外部数据 {name} 必须是 {kind} 类型。' },
  'local.runtime.external-budget': { en: 'External value {name} exceeds a resource limit.', zh: '外部数据 {name} 超过资源限制。' },
  'local.runtime.value.constraint': { en: 'Dynamic {attribute} constraint failed for parameter {name}.', zh: '参数 {name} 的动态 {attribute} 约束无法计算。' },
  'local.runtime.value.constraint-range': { en: 'Dynamic constraints for parameter {name} produce an invalid range.', zh: '参数 {name} 的动态约束产生无效范围。' },
  'local.runtime.value.constraint-date': { en: 'Dynamic {attribute} date bound for parameter {name} is not a valid YYYY-MM-DD value.', zh: '参数 {name} 的动态 {attribute} 日期边界不是合法的 YYYY-MM-DD。' },
} as const satisfies Record<string, { en: string; zh: string }>;

export type LocalDiagnosticMessageKey = keyof typeof LOCAL_DIAGNOSTIC_MESSAGES;

export const LOCAL_DIAGNOSTIC_TEMPLATE_ALIASES = {
  'local.options.invalid.object': 'options.notObject',
  'local.options.invalid.limits': 'options.limitsNotObject',
  'local.options.invalid.max-syntax-nodes': 'options.maxSyntaxNodes',
  'local.options.invalid.max-parse-work': 'options.maxParseWork',
  'local.options.invalid.max-markdown-depth': 'options.maxMarkdownDepth',
  'local.options.invalid.limits-unknown': 'options.unknownLimit',
  'local.options.invalid.host-components': 'options.hostComponents',
  'local.budget.document': 'budget.document',
  'local.budget.nodes': 'budget.syntaxNodes',
  'local.budget.parse-work': 'budget.parseWork',
  'local.budget.markdown-depth': 'budget.markdownDepth',
  'local.budget.nesting': 'budget.nesting',
  'local.budget.name.attribute': 'budget.attributeName',
  'local.budget.name.tag': 'budget.tagName',
  'local.budget.math': 'budget.math',
  'local.budget.attribute': 'budget.attribute',
  'local.budget.array.options': 'budget.options',
  'local.budget.array.checklist': 'budget.checklistItems',
  'local.budget.identifier': 'budget.identifier',
  'local.budget.plot.curves': 'budget.plotCurves',
  'local.budget.plot.points': 'budget.plotPoints',
  'local.budget.value.string': 'budget.string',
  'local.budget.value.array': 'budget.array',
  'local.budget.value.array-member': 'budget.arrayMember',
  'local.budget.value.array-contents': 'budget.arrayContents',
  'local.capability.html': 'capability.html',
  'local.capability.plot': 'capability.plot',
  'local.parse.source': 'parse.sourceType',
  'local.parse.markdown': 'parse.markdownFailed',
  'local.parse.document': 'parse.failed',
  'local.legacy': 'legacy.fence',
  'local.theme.expression': 'theme.expression',
  'local.theme.name.missing': 'theme.nameRequired',
  'local.theme.attribute': 'theme.attributeOnly',
  'local.theme.name.invalid': 'theme.nameInvalid',
  'local.theme.name': 'theme.nameInvalid',
  'local.theme.malformed.unclosed': 'theme.malformedMissingClose',
  'local.theme.malformed.closing': 'theme.malformedClosing',
  'local.theme.malformed.placement': 'theme.malformedStandalone',
  'local.theme.duplicate.declaration': 'theme.duplicateDeclaration',
  'local.theme.duplicate': 'theme.duplicateRegistration',
  'local.theme.late': 'theme.late',
  'local.theme.nested': 'theme.nested',
  'local.theme.invalid': 'theme.invalidDeclaration',
  'local.theme.missing': 'theme.missing',
  'local.theme.manifest.unreadable': 'theme.registryUnreadable',
  'local.theme.manifest.definition': 'theme.invalidDefinition',
  'local.theme.manifest.selected': 'theme.selectedUnreadable',
  'local.theme.protocol': 'theme.protocol',
  'local.theme.modes': 'theme.modes',
  'local.tag.missing-close': 'tag.missingClose',
  'local.tag.unclosed.open': 'tag.missingClose',
  'local.tag.unclosed.pair': 'tag.unclosedPaired',
  'local.tag.closing': 'tag.closingAttributes',
  'local.tag.name': 'tag.nameInvalid',
  'local.tag.mismatch.root': 'tag.mismatchRoot',
  'local.tag.mismatch.parent': 'tag.mismatchParent',
  'local.tag.shape': 'tag.requiresClose',
  'local.interpolation.unclosed': 'interpolation.unclosed',
  'local.math.unclosed': 'math.unclosed',
  'local.math.whitespace': 'math.whitespace',
  'local.footnote.unsupported': 'footnote.unsupported',
  'local.html': 'html.raw',
  'local.html.fallback': 'html.fallback',
  'local.html.fallback.attribute': 'html.fallbackAttribute',
  'local.html.table': 'html.table.structure',
  'local.html.extended': 'html.extended',
  'local.html.attribute': 'html.attribute',
  'local.html.unsafe-url': 'html.unsafeUrl',
  'local.html.capability': 'html.capability',
  'local.recovery.unclosed': 'recovery.unclosed',
  'local.recovery.mismatch': 'recovery.mismatch',
  'local.recovery.stray-close': 'recovery.strayClose',
  'local.html.repair': 'recovery.htmlRepair',
  'local.html.literal': 'recovery.htmlLiteral',
  'local.options.invalid.html-flag': 'options.htmlFlag',
  'local.options.invalid.markdown-breaks': 'options.markdownBreaks',
  'local.options.invalid.strict': 'options.strict',
  'local.component.unknown.suggestion': 'component.unknownSuggestion',
  'local.component.unknown': 'component.unknownPlain',
  'local.attribute.format': 'attribute.lowercase',
  'local.attribute.name': 'attribute.nameInvalid',
  'local.attribute.value-quoted': 'attribute.valueQuoted',
  'local.attribute.closing-quote': 'attribute.valueUnclosed',
  'local.attribute.duplicate': 'attribute.duplicate',
  'local.attribute.separator': 'attribute.separator',
  'local.attribute.unknown.suggestion': 'attribute.unknownSuggestion',
  'local.attribute.unknown': 'attribute.unknownPlain',
  'local.attribute.color': 'attribute.color',
  'local.attribute.required': 'attribute.required',
  'local.attribute.static': 'attribute.static',
  'local.host.attribute.unknown': 'host.attributeUnknown',
  'local.host.attribute.required': 'host.attributeRequired',
  'local.host.attribute.static': 'host.attributeStatic',
  'local.host.attribute.type': 'host.attributeType',
  'local.host.attribute.enum': 'host.attributeEnum',
  'local.host.attribute.pattern': 'host.attributePattern',
  'local.host.attribute.interpolation': 'host.attributeInterpolation',
  'local.attribute.type.number': 'attribute.numberInvalid',
  'local.attribute.type.number-interpolation': 'attribute.numberInterpolationInvalid',
  'local.attribute.type.integer': 'attribute.integer',
  'local.attribute.type.positive': 'attribute.positive',
  'local.attribute.type.boolean': 'attribute.booleanInvalid',
  'local.attribute.type.boolean-interpolation': 'attribute.booleanInterpolationInvalid',
  'local.attribute.type.enum': 'attribute.enumInvalid',
  'local.attribute.type.date-lower': 'attribute.dateLower',
  'local.attribute.type.date-upper': 'attribute.dateUpper',
  'local.attribute.range.min': 'attribute.rangeMin',
  'local.attribute.range.max': 'attribute.rangeMax',
  'local.attribute.interpolation': 'attribute.fullInterpolation',
  'local.label.required.missing': 'label.requiredMissing',
  'local.label.required.empty': 'label.requiredEmpty',
  'local.expression.empty.attribute': 'expression.emptyAttribute',
  'local.expression.empty': 'expression.emptyInterpolation',
  'local.expression.error': 'expression.error',
  'local.constraint.number-min-max': 'constraint.componentMinMax',
  'local.constraint.number-step': 'constraint.componentStep',
  'local.constraint.length-order': 'constraint.lengthRange',
  'local.constraint.date-order': 'constraint.dateOrder',
  'local.constraint.progress-range': 'constraint.progressRange',
  'local.constraint.plot-range': 'constraint.plotRange',
  'local.constraint.timer-duration': 'constraint.timerDuration',
  'local.constraint.range-slider-min-max': 'constraint.rangeSliderOrder',
  'local.constraint.range-slider-step': 'constraint.rangeSliderStep',
  'local.constraint.coordinate-axis': 'constraint.coordinateOrder',
  'local.constraint.coordinate-step': 'constraint.coordinateStep',
  'local.constraint.multi-select': 'constraint.multiSelectMax',
  'local.constraint.quiz-tolerance': 'constraint.quizTolerance',
  'local.selection.key.required': 'selection.keyNeedsKey',
  'local.selection.key.empty': 'selection.keyEmpty',
  'local.selection.key.missing-column': 'selection.keyMissingColumn',
  'local.selection.key.interpolation': 'selection.keyInterpolation',
  'local.selection.key.empty-cell': 'selection.keyEmptyCell',
  'local.selection.key.duplicate': 'selection.keyDuplicate',
  'local.selection.key.initial': 'initial.selectionNotValue',
  'local.structure.parent': 'structure.parent',
  'local.structure.no-body': 'structure.noBody',
  'local.structure.inline-only': 'structure.inlineOnly',
  'local.structure.no-nested-components': 'structure.noNestedComponents',
  'local.structure.no-components': 'structure.noComponents',
  'local.structure.children.minimum': 'structure.childrenMinimum',
  'local.structure.children.only': 'structure.childrenOnly',
  'local.structure.sequence.minimum': 'structure.sequenceMinimum',
  'local.structure.sequence.only': 'structure.sequenceOnly',
  'local.structure.accordion.needs-disclosure': 'structure.accordionNeedsDisclosure',
  'local.structure.accordion.only-disclosure': 'structure.accordionOnly',
  'local.structure.grid.needs-card': 'structure.gridNeedsCard',
  'local.structure.grid.only-card': 'structure.gridOnlyCard',
  'local.structure.table.single': 'structure.exactlyOneTable',
  'local.structure.plot.needs-formula': 'structure.plotNeedsFormula',
  'local.structure.plot.only-formulas': 'structure.plotOnlyFormulas',
  'local.structure.node.no-components': 'structure.nodeNoComponents',
  'local.structure.options.needed': 'structure.optionsNeeded',
  'local.structure.options.only': 'structure.optionsOnly',
  'local.structure.option.no-components': 'structure.optionNoComponents',
  'local.structure.tabs.needs-tab': 'structure.tabsNeedsTab',
  'local.structure.tabs.only-tab': 'structure.tabsOnly',
  'local.structure.steps.needs-step': 'structure.stepsNeedsStep',
  'local.structure.steps.only-step': 'structure.stepsOnly',
  'local.structure.quiz.numeric-no-body': 'structure.quizNumericNoBody',
  'local.structure.diagram.only': 'structure.diagramOnly',
  'local.option.value.required': 'option.valueRequired',
  'local.option.value.comma': 'option.valueComma',
  'local.option.value.duplicate': 'option.valueDuplicate',
  'local.tab.value.duplicate': 'tab.valueDuplicate',
  'local.step.value.duplicate': 'step.valueDuplicate',
  'local.quiz.answer.required': 'quiz.answerRequired',
  'local.quiz.answer.numeric': 'quiz.answerNumeric',
  'local.quiz.answer.not-option': 'quiz.answerNotOption',
  'local.diagram.node.required': 'diagram.needsNode',
  'local.diagram.node.invalid': 'diagram.nodeInvalid',
  'local.diagram.node.duplicate': 'diagram.nodeDuplicate',
  'local.diagram.edge.from': 'diagram.edgeFromUnknown',
  'local.diagram.edge.to': 'diagram.edgeToUnknown',
  'local.diagram.edge.duplicate': 'diagram.edgeDuplicate',
  'local.checklist.body.single': 'checklist.bodySingle',
  'local.checklist.body.item-required': 'checklist.needsItem',
  'local.checklist.body.items-limit': 'budget.checklistItems',
  'local.checklist.body.task-only': 'checklist.taskOnly',
  'local.checklist.body.no-nested': 'checklist.noNested',
  'local.checklist.body.no-components': 'checklist.noComponents',
  'local.binding.name': 'binding.nameInvalid',
  'local.binding.reserved': 'binding.reserved',
  'local.binding.type': 'binding.typeConflict',
  'local.binding.exclusive': 'binding.exclusive',
  'local.binding.exclusive.slot': 'binding.slotExclusive',
  'local.binding.constraint': 'binding.constraintConflict',
  'local.binding.option': 'binding.optionConflict',
  'local.binding.unknown.suggestion': 'binding.unknownSuggestion',
  'local.binding.unknown': 'binding.unknownPlain',
  'local.initial.duplicate': 'initial.duplicate',
  'local.initial.duplicate-peers': 'initial.duplicatePeers',
  'local.initial.no-step': 'initial.rangeNoStep',
  'local.initial.cannot-derive': 'initial.cannotDerive',
  'local.initial.type.number': 'initial.typeFiniteNumber',
  'local.initial.type.boolean': 'initial.typeBoolean',
  'local.initial.type': 'initial.typeWrong',
  'local.initial.type.collection': 'initial.typeCollection',
  'local.initial.type.array': 'initial.typeStringArray',
  'local.initial.type.number-array': 'initial.typeNumberArray',
  'local.initial.value.max-items': 'initial.maxItems',
  'local.initial.range.min': 'initial.belowMin',
  'local.initial.range.max': 'initial.aboveMax',
  'local.initial.range.step': 'initial.offStep',
  'local.initial.value.options': 'initial.notAmongOptions',
  'local.initial.date': 'initial.dateInvalid',
  'local.initial.value.option': 'initial.notAvailableOption',
  'local.initial.option.multi-select': 'initial.multiSelectOption',
  'local.initial.range-slider': 'initial.rangeSliderOrder',
  'local.initial.slot.min': 'initial.slotBelowMin',
  'local.initial.slot.max': 'initial.slotAboveMax',
  'local.initial.slot.step': 'initial.slotOffStep',
  'local.initial.length.min': 'initial.lengthBelow',
  'local.initial.length.max': 'initial.lengthAbove',
  'local.initial.email': 'initial.email',
  'local.initial.date.min': 'initial.dateBelow',
  'local.initial.date.max': 'initial.dateAbove',
  'local.initial.multi-select': 'initial.multiSelectExceeds',
  'local.type.number': 'type.number',
  'local.type.boolean': 'type.boolean',
  'local.type.string': 'type.string',
  'local.type.array': 'type.arrayNoDisplay',
  'local.anchor.id': 'anchor.idInvalid',
  'local.anchor.duplicate': 'anchor.duplicate',
  'local.anchor.heading-collision': 'anchor.headingCollision',
  'local.jump.empty': 'jump.empty',
  'local.jump.bad-target': 'jump.badTarget',
  'local.jump.unresolved': 'jump.unresolved',
  'local.math.formula.shape': 'math.formulaShape',
  'local.math.compute': 'math.computeFailed',
  'local.math.binding.unknown': 'math.bindingUnknown',
  'local.math.binding.type': 'math.bindingType',
  'local.math.display.unsupported-command': 'math.displayUnsupportedCommand',
  'local.math.display.unsupported-environment': 'math.displayUnsupportedEnvironment',
  'local.math.display.budget': 'math.displayBudget',
  'local.math.display.stray-end': 'math.displayStrayEnd',
  'local.math.display.environment-unclosed': 'math.displayEnvironmentUnclosed',
  'local.math.display.environment-missing-name': 'math.displayEnvironmentMissingName',
  'local.math.display.syntax': 'math.displaySyntax',
  'local.table.header.missing': 'table.missingHeader',
  'local.table.header.interpolation': 'table.headerInterpolation',
  'local.table.header.empty': 'table.headerEmpty',
  'local.table.header.duplicate': 'table.headerDuplicate',
  'local.table.row.mismatch': 'table.rowColumnMismatch',
  'local.chart.numeric.expression': 'chart.numericExpression',
  'local.timeline.numeric.expression': 'timeline.numericExpression',
  'local.chart.numeric.plain': 'chart.numericPlain',
  'local.timeline.numeric.plain': 'timeline.numericPlain',
  'local.chart.column.comma': 'chart.columnComma',
  'local.chart.column.x-missing': 'chart.xMissing',
  'local.chart.column.y-required': 'chart.yRequired',
  'local.chart.column.y-missing': 'chart.yMissing',
  'local.chart.column.needs-numeric': 'chart.needsNumeric',
  'local.chart.column.scatter-x-missing': 'chart.scatterXMissing',
  'local.chart.column.scatter-needs-numeric': 'chart.scatterNeedsNumeric',
  'local.chart.column.donut-columns': 'chart.donutNeedsColumns',
  'local.chart.column.donut-y': 'chart.donutYOne',
  'local.chart.column.donut-need-y': 'chart.donutNeedY',
  'local.chart.negative': 'chart.negative',
  'local.timeline.header.missing': 'timeline.headerMissing',
  'local.timeline.header.column': 'timeline.columnUnsupported',
  'local.timeline.value.negative': 'timeline.negative',
  'local.runtime.binding.no-writable': 'runtime.bindingNoWritable',
  'local.runtime.binding.needs-slot': 'runtime.bindingNeedsSlot',
  'local.runtime.binding.unknown-slot': 'runtime.bindingUnknownSlot',
  'local.runtime.binding.no-multi-slot': 'runtime.bindingNoMultiSlot',
  'local.runtime.value.date-invalid': 'runtime.dateInvalid',
  'local.runtime.value.date-required': 'runtime.dateRequired',
  'local.runtime.value.date-earlier': 'runtime.dateEarlier',
  'local.runtime.value.date-later': 'runtime.dateLater',
  'local.runtime.value.field-required': 'runtime.fieldRequired',
  'local.runtime.value.min-length': 'runtime.minLength',
  'local.runtime.value.max-length': 'runtime.maxLength',
  'local.runtime.value.email-length': 'runtime.emailLength',
  'local.runtime.value.email-invalid': 'runtime.emailInvalid',
  'local.runtime.value.finite-number': 'runtime.finiteNumber',
  'local.runtime.value.min': 'runtime.min',
  'local.runtime.value.max': 'runtime.max',
  'local.runtime.value.step': 'runtime.step',
  'local.runtime.value.boolean': 'runtime.boolean',
  'local.runtime.value.string': 'runtime.string',
  'local.runtime.value.array': 'runtime.array',
  'local.runtime.value.array-members': 'runtime.arrayMembers',
  'local.runtime.value.number-array': 'runtime.numberArray',
  'local.runtime.value.number-array-members': 'runtime.numberArrayMembers',
  'local.runtime.value.null': 'runtime.null',
  'local.runtime.value.checklist-option': 'runtime.checklistOption',
  'local.runtime.value.max-items': 'runtime.maxItems',
  'local.runtime.value.unsupported-type': 'runtime.unsupportedType',
  'local.runtime.value.option': 'runtime.option',
  'local.runtime.value.budget': 'runtime.budget',
  'local.runtime.value.range-order': 'runtime.rangeOrder',
} as const satisfies Record<string, LocalDiagnosticMessageKey>;

export type LocalDiagnosticTemplateKey = keyof typeof LOCAL_DIAGNOSTIC_TEMPLATE_ALIASES;
