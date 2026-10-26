# Author tools

[中文](author-tools-ch.md)

Install `reactive-md@0.5.3` to use the CLI and the React-free `reactive-md/authoring` entry. To work from this repository, build the package first:

```sh
npm ci
npm run build
npm run lint -- examples/local/planning.reactive.md
```

## Command line

The package provides `reactive-md lint`. Pass one or more document paths, or `-` to read stdin:

```sh
reactive-md lint "my document.reactive.md" other.reactive.md
reactive-md lint --json --warnings-as-errors document.reactive.md
reactive-md lint --locale zh document.reactive.md
cat document.reactive.md | reactive-md lint -
```

Text output includes the file, line, column, severity and diagnostic code. JSON output is an array of `{ file, ok, diagnostics }` reports. Diagnostics use the compiler's original UTF-16 source ranges and one-based line/column positions. The command reads documents without changing them.

`--locale en|zh` selects diagnostic messages and defaults to English. Codes, severity and locations stay identical across languages. See [Diagnostics and counting rules](../reference/diagnostics-counting-en.md) for the compatibility contract and budget units.

| Exit code | Meaning |
| --- | --- |
| 0 | No errors; warnings are allowed by default |
| 1 | Compiler errors, or warnings with `--warnings-as-errors` |
| 2 | Invalid arguments or a file-read failure |

## Editor integration

The core entry exposes DOM-independent functions:

```js
import {
  analyzeLocalSource, completeLocalSource,
  renameLocalBinding, formatLocalSource,
} from 'reactive-md/authoring';

const analysis = analyzeLocalSource(source, compileOptions);
const suggestions = completeLocalSource(source, cursorOffset, compileOptions);
const renamed = renameLocalBinding(source, 'people', 'attendees', compileOptions);
const formatted = formatLocalSource(renamed.source, compileOptions);
```

Analysis returns ordered highlight tokens, bindings with declaration/reference ranges, and compiler diagnostics. Completions contain `label`, `kind`, `insertText` and the `range` to replace. Apply edits against the same source version that produced their ranges.

Rename updates active binding declarations, expression references and computed plot parameters, preserving literal text and display formulas. Plot parameters use `\mathrm{newName}` after a rename. Invalid names and collisions throw an error. Formatting normalizes spacing inside recognized component tags; Markdown layout, quoted content, formulas, code and fallback regions retain their source. Keep the original source as the editable document.

## Playground

Run `npm run dev` and choose **Show source**. The source editor provides highlighting, completion, binding locations, rename, formatting, diagnostic navigation and a live preview. Use the completion button or Ctrl+Space, arrow keys and Enter to insert a suggestion, and Escape to close the list. Rename and formatting participate in editor undo/redo.

## Host editor configuration

The `reactive-md/authoring` entry also exports `LOCAL_COMPONENTS`, `getLocalComponent`, `getNativeComponentCatalog`, `renderNativeSnippet`, `insertTemplate` and their types. It loads without React or CSS. Pass the preview's `LocalCompileOptions` as the last argument to analysis, completion, rename and formatting; omitted options keep the existing defaults. This includes host schemas, HTML mode, resource limits and `markdownBreaks`.

For full entry and stylesheet details, see the [0.5.3 release notes](../releases/release-0.5.3-en.md).
