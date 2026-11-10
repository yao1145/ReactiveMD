const EXIT_CODES = `Exit codes:
  0  success
  2  usage or argument error
  3  document compile, render, React or build-artifact error
  4  input or output file I/O error
  5  asset or security policy error`;

/** @param {string} version */
export function mainHelp(version) {
  return `reactive-md ${version}

Usage:
  reactive-md build <doc.reactive.md> -o <doc.html> [options]
  reactive-md lint [--json] [--warnings-as-errors] [--locale en|zh] <file... | ->
  reactive-md migrate <file | -> [options]
  reactive-md check <package> [options]
  reactive-md init component <directory> [options]
  reactive-md init preset <directory> [options]
  reactive-md build --help
  reactive-md lint --help
  reactive-md migrate --help
  reactive-md check --help
  reactive-md init --help
  reactive-md --version

Commands:
  build    Compile one local document into a single, self-contained HTML file.
  lint     Compile documents and report diagnostics.
  migrate  Migrate a document's syntax revision metadata.
  check    Validate an installed preset or component package.
  init     Create a component or preset package scaffold.

Run "reactive-md build --help", "reactive-md lint --help",
"reactive-md migrate --help", "reactive-md check --help" or
"reactive-md init --help" for the options and the document diagnostic format.
"format" is not part of this release.

Build ${EXIT_CODES.toLowerCase()}
Lint exit codes: 0 clean, 1 diagnostics, 2 usage or file-read error.
Migrate exit codes: 0 success, 1 migration needed or blocked, 2 usage or I/O error.
Check exit codes: 0 success, 2 usage error, 3 package check failure, 4 I/O error.
Init exit codes: 0 success, 2 usage error, 4 I/O error.
`;
}

export function buildHelp() {
  return `Usage: reactive-md build <doc.reactive.md> -o <doc.html> [options]

Compile one document with the packaged core, optionally validate a parameter
state file, verify and inline local images, server-render the document with
React 19, and write one UTF-8 HTML file. The output is assembled through the
same shareable-HTML shell used by the interactive runtime (CSP, escaped JSON,
notices and print styles included).

Options:
  -o, --output <file>              Output HTML path (required). The parent
                                   directory must already exist.
      --mode <interactive|static>  Output mode (default interactive). Static
                                   output has no runtime script and no
                                   auto-mount payload.
      --state-file <file.json>     Export this validated state as the baseline
                                   instead of the document's initial values.
      --component-state-file <file.json>
                                   Embed a reactive-md-component-state/v1
                                   sidecar for interactive output. Requires
                                   --mode interactive.
      --document-id <id>           Stable document identity used to scope
                                   component state (default: source digest).
      --random-seed <uint32>       Document-level component random seed.
      --assets <inline|omit>       Image handling (default inline). "omit"
                                   skips all image reads and leaves the
                                   renderer's normal alt fallback.
      --asset-root <dir>           Extra local directory that relative image
                                   URLs may resolve inside. URLs and remote
                                   image roots are not supported.
      --locale <en|zh>             UI locale (default en).
      --color-scheme <auto|light|dark>
                                   Document color scheme (default auto).
      --title <text>               Override the document title. By default the
                                   first heading is rendered as plain text, or
                                   the input file name is used.
      --strict                     Treat compile warnings as errors. With
                                   --assets omit, omitted images also fail.
  -h, --help                       Show this help.

Interactive HTML requires React 19 and react-dom, plus the prebuilt
dist-standalone IIFE. Every build requires the prebuilt dist-library artifacts.
From a source checkout, run "npm run build" before building documents.

${EXIT_CODES}
`;
}

const MIGRATE_HELP = {
  en: `Usage: reactive-md migrate <file | -> [options]

Migrate a document's syntax revision metadata. By default the migrated source
is written to stdout and the input file is left unchanged. Use - for stdin.

Options:
      --from <local-draft-1|local-draft-2>
                                   Source revision to migrate from (default: the
                                   declared revision, or the current revision
                                   when none is declared). Unversioned
                                   historical documents require --from
                                   local-draft-1.
      --check                      Report whether migration is needed or
                                   blocked, without writing output.
      --json                       Print one structured JSON report. The
                                   migrated source appears only as a JSON field.
  -o, --output <file>              Write the migrated source to a new file.
                                   Existing files, including the input, are
                                   refused.
      --accept-semantic-changes    Allow migrations that change reader
                                   semantics, and report a warning.
      --locale <en|zh>             Message language (default en).
  -h, --help                       Show this help.

Migration replaces only the metadata comment. It preserves the body, BOM and
line endings and is idempotent. A blocked migration leaves the source
unchanged. Migration never rewrites state files; export fresh state after a
source digest change.

Exit codes: 0 success, 1 migration needed or blocked, 2 usage or I/O error.
`,
  zh: `用法：reactive-md migrate <文件 | -> [选项]

迁移文档的语法修订版本元数据。默认将迁移后的源文本写到标准输出，不修改输入
文件。用 - 读取标准输入。

选项：
      --from <local-draft-1|local-draft-2>
                                   迁移的起始修订版本（默认取文档声明的版本；
                                   未声明时取当前版本）。未声明的历史文档必须
                                   指定 --from local-draft-1。
      --check                      只报告是否需要迁移或被阻止，不写输出。
      --json                       输出一个结构化 JSON 报告。迁移后的源文本
                                   只作为 JSON 字段出现。
  -o, --output <文件>              将迁移后的源文本写入新文件。已存在的文件
                                   （包括输入文件）一律拒绝。
      --accept-semantic-changes    允许会改变读者语义的迁移，并给出警告。
      --locale <en|zh>             消息语言（默认 en）。
  -h, --help                       显示此帮助。

迁移只替换元数据注释，保留正文、BOM 和换行符，并且幂等。迁移被阻止时源文本
保持不变。迁移不改写状态文件；源摘要变化后请重新导出状态。

退出码：0 成功，1 需要迁移或被阻止，2 用法或 I/O 错误。
`,
};

/** @param {'en'|'zh'} [locale] */
export function migrateHelp(locale = 'en') {
  return MIGRATE_HELP[locale === 'zh' ? 'zh' : 'en'];
}

const INIT_HELP = {
  en: `Usage: reactive-md init component <directory> [options]
       reactive-md init preset <directory> [options]

Create a runnable package scaffold. The component form creates a pure-data
manifest, a React view, scoped CSS, a Vite extension host, a browser preview,
declaration and package build scripts, and a Node/SSR compliance check. The
preset form creates a pure semantic entry built with defineLocalPreset, a React
pairing entry built with defineReactPreset, and minimal typecheck, check and
export scripts.

The target directory must not exist. Validation runs before anything is
written, and a failed write leaves the directory in place for inspection.

Options:
      --name <tag>                 Component tag name or preset name in
                                   lowercase kebab-case. Defaults to a name
                                   derived from the directory.
      --id <namespace/name>        Component id such as "example/counter", or
                                   preset id such as "example/theme". Defaults
                                   to "local/<name>".
      --form <leaf|inline|container>
                                   Component form (default leaf). Inline and
                                   container forms render their children.
      --props <json>               JSON object of prop declarations, for
                                   example '{"label":{"kind":"string","default":"Count"}}'.
                                   Defaults to {}.
      --capabilities <list>        Comma-separated subset of interactive, static,
                                   ssr and offline (default all four). At least
                                   one of interactive or static is required.
      --version <semver>           Preset package version (default 0.1.0).
                                   Only accepted by the preset form.
      --locale <en|zh>             Help language (default en).
  -y, --yes                        Accept defaults without prompting.
  -h, --help                       Show this help.

On a terminal, a missing name, id, form or preset version is asked
interactively. Without a terminal, the documented defaults apply; an invalid
value is a usage error.

Generated component layout:
  src/manifest.ts       pure-data component manifest
  src/<name>.tsx        React view and defineReactComponentPackage
  src/<name>.css        scoped component styles
  extensions.ts         export const host = createReactHost({ packages })
  main/plugin/<name>/index.ts  automatically discovered preview package
  main/index.html       browser preview
  scripts/build.mjs     dist/node entries and dist/types declarations
  scripts/verify.mjs    manifest and React/SSR compliance
  scripts/build-export.mjs  preview build exported through the public Vite API

Generated preset layout:
  src/preset.js         pure semantic preset built with defineLocalPreset
  src/react.js          React pairing built with defineReactPreset
  src/*.d.ts            declarations for both public entries
  scripts/build-export.mjs  config identity and resource report via public APIs

Exit codes: 0 success, 2 usage error, 4 I/O error.
`,
  zh: `用法：reactive-md init component <目录> [选项]
      reactive-md init preset <目录> [选项]

创建可运行的包脚手架。component 形式生成纯数据清单、React 视图、作用域
CSS、Vite 扩展宿主、浏览器预览、声明/打包脚本和 Node/SSR 合规检查。preset
形式生成 defineLocalPreset 纯语义入口、defineReactPreset React 配对入口，以及
最小的 typecheck、check 和导出脚本。

目标目录必须不存在。写入前完成全部校验；写入失败时目录会保留以便检查。

选项：
      --name <名称>                小写 kebab-case 的组件标签名或预设名。默认
                                   从目录名推导。
      --id <命名空间/名称>         组件 id（如 "example/counter"）或预设 id
                                   （如 "example/theme"）。默认 "local/<名称>"。
      --form <leaf|inline|container>
                                   组件形式（默认 leaf）。inline 和 container
                                   形式会渲染子内容。
      --props <json>               属性声明 JSON 对象，例如
                                   '{"label":{"kind":"string","default":"Count"}}'。
                                   默认 {}。
      --capabilities <列表>        逗号分隔的 interactive、static、ssr、offline
                                   子集（默认全部四项）。至少需要 interactive
                                   或 static 之一。
      --version <语义版本>         预设包版本（默认 0.1.0）。仅 preset 形式
                                   接受此项。
      --locale <en|zh>             帮助语言（默认 en）。
  -y, --yes                        接受默认值，不进行交互提问。
  -h, --help                       显示此帮助。

在终端中，缺少名称、id、组件形式或预设版本时会交互询问。没有终端时使用
文档中的默认值；非法值按用法错误处理。

component 生成内容：
  src/manifest.ts       纯数据组件清单
  src/<名称>.tsx        React 视图与 defineReactComponentPackage
  src/<名称>.css        作用域组件样式
  extensions.ts         export const host = createReactHost({ packages })
  main/plugin/<名称>/index.ts  自动发现的预览包
  main/index.html       浏览器预览
  scripts/build.mjs     dist/node 入口与 dist/types 声明
  scripts/verify.mjs    清单与 React/SSR 合规检查
  scripts/build-export.mjs  通过公开 Vite API 导出预览构建

preset 生成内容：
  src/preset.js         由 defineLocalPreset 构建的纯语义预设
  src/react.js          由 defineReactPreset 构建的 React 配对
  src/*.d.ts            两个公开入口的声明
  scripts/build-export.mjs  通过公开 API 生成配置身份与资源报告

退出码：0 成功，2 用法错误，4 I/O 错误。
`,
};

/** @param {'en'|'zh'} [locale] */
export function initHelp(locale = 'en') {
  return INIT_HELP[locale === 'zh' ? 'zh' : 'en'];
}

const CHECK_HELP = {
  en: `Usage: reactive-md check <package> [options]

Check one installed preset or component package without a browser run. The
command reads package.json, verifies every declared export entry exists, loads
the package entry, rebuilds a full SDK configuration, round-trips it through
structuredClone and JSON, rebuilds the active registry, and verifies declared
React implementations and style resources.

Options:
      --locale <en|zh>             Help and message language (default en).
  -h, --help                       Show this help.

<package> is a package directory or its package.json. Package entries may use
"reactive-md/*" imports even when the package has no local node_modules; the
installed reactive-md artifacts are used as a fallback. Browser suites are not
run here. Declared interactive or offline evidence still needs a browser run.

Exit codes: 0 success, 2 usage error, 3 package check failure, 4 I/O error.
`,
  zh: `用法：reactive-md check <包> [选项]

检查一个已安装的预设包或组件包，不运行浏览器套件。命令读取 package.json，
确认声明的每个导出入口存在，加载包入口，重建完整 SDK 配置，用 structuredClone
和 JSON 做往返，重建激活 registry，并核对声明的 React 实现和样式资源。

选项：
      --locale <en|zh>             帮助与消息语言（默认 en）。
  -h, --help                       显示此帮助。

<包> 可以是包目录或其中的 package.json。包入口即使没有本地 node_modules 也可
使用 "reactive-md/*" 导入；此时回退到已安装的 reactive-md 产物。此处不运行
浏览器套件；声明的 interactive 或 offline 证据仍需浏览器运行。

退出码：0 成功，2 用法错误，3 包检查失败，4 I/O 错误。
`,
};

/** @param {'en'|'zh'} [locale] */
export function checkHelp(locale = 'en') {
  return CHECK_HELP[locale === 'zh' ? 'zh' : 'en'];
}
