/** Binding, expression and runtime diagnostic templates. */
export const LOCAL_RUNTIME_DIAGNOSTIC_MESSAGES = {
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
    en: '<plot> formulas must be an equation: y = f(x), a parametric cases block, r = f(\\theta), or an implicit equation in x and y.',
    zh: '<plot> 的公式必须是方程：y = f(x)、参数方程 cases 块、r = f(\\theta)，或关于 x 和 y 的隐式方程。',
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
} as const;
