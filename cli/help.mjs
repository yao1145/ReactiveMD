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
  reactive-md init component <directory> [options]
  reactive-md build --help
  reactive-md lint --help
  reactive-md migrate --help
  reactive-md init --help
  reactive-md --version

Commands:
  build    Compile one local document into a single, self-contained HTML file.
  lint     Compile documents and report diagnostics.
  migrate  Migrate a document's syntax revision metadata.
  init     Create a React component package scaffold.

Run "reactive-md build --help", "reactive-md lint --help",
"reactive-md migrate --help" or "reactive-md init --help" for the options and
the document diagnostic format. "format" is not part of this release.

Build ${EXIT_CODES.toLowerCase()}
Lint exit codes: 0 clean, 1 diagnostics, 2 usage or file-read error.
Migrate exit codes: 0 success, 1 migration needed or blocked, 2 usage or I/O error.
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

export function initHelp() {
  return `Usage: reactive-md init component <directory> [options]

Create a runnable React component package: a pure-data manifest, a React view,
scoped CSS, a Vite extension host, a browser preview, declaration and package
build scripts, and a Node/SSR compliance check.

The target directory must not exist. Validation runs before anything is
written, and a failed write leaves the directory in place for inspection.

Options:
      --name <tag>                 Component tag name in lowercase kebab-case.
                                   Defaults to a name derived from the
                                   directory.
      --id <namespace/name>        Component id such as "example/counter".
                                   Defaults to "local/<name>".
      --form <leaf|inline|container>
                                   Component form (default leaf). Inline and
                                   container forms render their children.
      --props <json>               JSON object of prop declarations, for
                                   example '{"label":{"kind":"string","default":"Count"}}'.
                                   Defaults to {}.
      --capabilities <list>        Comma-separated subset of interactive, static,
                                   ssr and offline (default all four). At least
                                   one of interactive or static is required.
  -y, --yes                        Accept defaults without prompting.
  -h, --help                       Show this help.

On a terminal, a missing name, id or form is asked interactively. Without a
terminal, the documented defaults apply; an invalid value is a usage error.

Generated layout:
  src/manifest.ts       pure-data component manifest
  src/<name>.tsx        React view and defineReactComponentPackage
  src/<name>.css        scoped component styles
  extensions.ts         export const host = createReactHost({ packages })
  main/index.html       browser preview
  scripts/build.mjs     dist/node entries and dist/types declarations
  scripts/verify.mjs    manifest and React/SSR compliance

Exit codes: 0 success, 2 usage error, 4 I/O error.
`;
}
