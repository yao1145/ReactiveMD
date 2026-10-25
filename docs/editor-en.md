# React source editor

`reactive-md/editor` is a controlled React 19 editor for Reactive MD source. It comes from the Playground editor and provides source highlighting, a formatting and insertion toolbar, completion, binding navigation, rename and format commands, undo and redo, line numbers and scroll synchronization. The host keeps the source text and owns preview, persistence and export.

The editor has its own stylesheet at `reactive-md/editor/styles.css`. It is separate from `reactive-md/styles.css`, so a page that only edits source does not load document rendering styles.

The editor is part of the `0.5.0` preview, which targets the `next` channel. `latest` remains `0.4.0`. Existing `reactive-md`, `reactive-md/react` and `reactive-md/styles.css` imports are unchanged.

## Install

```sh
npm install reactive-md@next
npm install react@19 react-dom@19
```

Pin the preview with `npm install reactive-md@0.5.0`. The package ships ESM only and needs Node.js 22.12 or newer for tooling and server rendering.

## Minimal controlled editor

```tsx
import { useState } from 'react';
import { ReactiveMarkdownEditor } from 'reactive-md/editor';
import 'reactive-md/editor/styles.css';

const initialSource = `# Cost estimate

<slider bind="people" label="People" initial="2" min="1" max="20">

Monthly cost: **{{ people * 100 }} USD**.`;

export function SourceEditor() {
  const [source, setSource] = useState(initialSource);

  return (
    <ReactiveMarkdownEditor
      value={source}
      onChange={setSource}
      ariaLabel="Document source"
    />
  );
}
```

`value` and `onChange` are required. The component renders a textarea and keeps its own undo history. The source text stays in your state. Built-in labels default to English.

## Entries

| Entry | Contents | Dependency |
| --- | --- | --- |
| `reactive-md/editor` | `ReactiveMarkdownEditor` and its types | React 19 |
| `reactive-md/editor/styles.css` | Editor styles, scoped to the editor root | Imported explicitly by the host |

Import the stylesheet once in the application or in the component module that renders the editor. A bundler or framework that handles CSS imports can place it with the editor module.

## Ref handle

```tsx
import { useRef, useState } from 'react';
import {
  ReactiveMarkdownEditor,
  type ReactiveMarkdownEditorHandle,
} from 'reactive-md/editor';

export function SourceEditor() {
  const [source, setSource] = useState('');
  const editor = useRef<ReactiveMarkdownEditorHandle>(null);

  return (
    <>
      <button type="button" onClick={() => editor.current?.focus()}>Focus</button>
      <button type="button" onClick={() => editor.current?.undo()}>Undo</button>
      <button type="button" onClick={() => editor.current?.selectRange({ start: 0, end: 5 })}>
        Select heading
      </button>
      <ReactiveMarkdownEditor ref={editor} value={source} onChange={setSource} />
    </>
  );
}
```

| Method | Behavior |
| --- | --- |
| `focus(selection?)` | Focuses the textarea. Applies the optional selection. |
| `selectRange(range)` | Selects a source range. Ranges use the same UTF-16 half-open offsets as compile diagnostics. |
| `getSelection()` | Returns the current selection. |
| `getTextarea()` | Returns the underlying textarea, or `null` before mount. |
| `undo()` / `redo()` | Moves through this instance's history and emits the resulting value through `onChange`. Both are no-ops at the ends of the history and while `readOnly` or `disabled` is set. |

The entry also exports `ReactiveMarkdownEditorProps`, `ReactiveMarkdownEditorHandle`, `EditorLocale`, `EditorTheme` and `EditorSelection` types.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `value` | `string` | required | Controlled source text. |
| `onChange` | `(value: string) => void` | required | Receives the next source for typing, toolbar commands and undo or redo. |
| `locale` | `'en' \| 'zh'` | `'en'` | Built-in labels for this instance. Source text is unchanged. |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Sets `data-editor-theme` on the editor root. `auto` follows the system preference. |
| `id` | `string` | generated | Textarea id. The instance uses it for its internal labels and gutter. |
| `className` | `string` | none | Added to the `.reactive-md-editor` root. |
| `style` | `CSSProperties` | none | Inline styles for the root. |
| `height` | `number \| string` | `560` | A number is pixels. A string accepts any CSS length. |
| `minHeight` | `number \| string` | `280` | Minimum editor height, in the same units as `height`. |
| `placeholder` | `string` | none | Placeholder for an empty source. |
| `ariaLabel` | `string` | localized label | Accessible name for the textarea. |
| `readOnly` | `boolean` | `false` | Keeps text selectable and copyable while blocking changes. |
| `disabled` | `boolean` | `false` | Blocks focus and editing. |
| `documentKey` | `string \| number` | none | Change it when the editor switches to an independent source document. The change resets undo history and selection. |
| `diagnostics` | `readonly Diagnostic[]` | none | Marks diagnostic lines in the gutter. It does not block typing or replace host validation. |
| `document` | `LocalDocument \| null` | `null` | Compiled document used to show binding value types in the authoring tools. The editor does not compile it. |
| `toolbar` | `boolean` | `true` | Shows the formatting and insertion toolbar, including its export action. |
| `authoring` | `boolean` | `true` | Enables completion, binding navigation, rename and format tools. |
| `onExport` | `() => void` | none | Called by the toolbar export action. Use it to open your export dialog or write the file yourself. |
| `textareaRef` | `RefObject<HTMLTextAreaElement \| null>` | none | Receives the underlying textarea for advanced host code. |

## Controlled value and history

Every edit calls `onChange` with the next source: typing, toolbar formatting, insertion templates, rename, format and undo or redo. Pass that value back into `value`. The editor treats the edits it emits as part of the current session, so a normal controlled round trip keeps undo steps.

An external change to `value` updates the displayed text. When the host replaces the text with an independent document, update `documentKey` in the same render. A key change clears undo and redo, resets the selection and adopts the new value.

```tsx
const [documentKey, setDocumentKey] = useState('estimate');
const [source, setSource] = useState(loadSource('estimate'));

function openDocument(key: string, text: string) {
  setDocumentKey(key);
  setSource(text);
}

<ReactiveMarkdownEditor
  value={source}
  onChange={setSource}
  documentKey={documentKey}
/>
```

Undo history belongs to the mounted instance. It is not saved, not shared between instances and not derived from the whole `value` prop. Use `documentKey` for document switches rather than remounting on every keystroke.

## Locale and theme

Each instance applies its own locale and theme. The editor does not change the document `data-theme` attribute, does not write browser storage and does not read the Playground language setting.

```tsx
<ReactiveMarkdownEditor
  value={source}
  onChange={setSource}
  locale="zh"
  theme="dark"
/>
```

`theme="auto"` follows the system color preference, including preference changes. Two editors on one page can use different values. The theme is set through the local `data-editor-theme` attribute on the `.reactive-md-editor` root.

## Read-only and disabled

`readOnly` keeps the source visible, focusable and selectable. Typing, the toolbar, completion, rename, format and the ref `undo` and `redo` methods cannot change the value.

`disabled` also blocks focus and pointer interaction. Both modes disable the toolbar export action. Neither mode changes the value or the history on its own. Use them when a host is not allowed to edit source, for example while a read-only preview is shown.

Replacing `value` externally or changing `documentKey` resets history, selection and the editor's scroll position. Echoing a value received through `onChange` preserves them. The export button is hidden until `onExport` is provided.

## Diagnostics and compiled document

The optional authoring tools analyze source locally, including syntax checks. The host manages compilation for its preview and can pass that result when it wants line markers or binding value types:

```tsx
import { compileLocal } from 'reactive-md';

const result = compileLocal(source);

<ReactiveMarkdownEditor
  value={source}
  onChange={setSource}
  diagnostics={result.diagnostics}
  document={result.ok ? result.document : null}
/>
```

`diagnostics` marks the reported lines in the gutter. Incomplete source remains editable, and a compile error does not lock the textarea. `document` supplies binding value types for the authoring inspection panel. Both props are optional; pass neither when the editor is used only to edit Markdown.

## Sizing and layout

The editor fills the width of its container. `height` defaults to `560px` and `minHeight` to `280px`; numbers are pixels and strings can use `vh`, `rem` or other CSS lengths. The gutter follows line count, and soft-wrapped lines keep their line number and highlighting aligned during scrolling.

Use `className` or `style` for margins and placement in a host layout. Internal element class names are implementation details.

## Toolbar and authoring tools

`toolbar={false}` removes the formatting and insertion toolbar, including its export action. `authoring={false}` keeps the textarea and toolbar but disables syntax highlighting, completion, binding navigation, rename and format. Both default to enabled.

The toolbar formats Markdown, inserts lists, tables, links, images and the built-in component templates, and exposes undo and redo. Formatting commands use the current selection and return the next source through `onChange`.

## Host responsibilities

The editor edits source. The host handles the rest:

- Preview: compile `value` and render it with `reactive-md/react` or your own runtime.
- Persistence: store the source. The editor does not auto-save, write local storage or send the source anywhere.
- Export: pass `onExport` to connect the toolbar action to your HTML export, download dialog or file service. The editor does not build a shareable HTML file.

Compilation scheduling and debouncing also stay in the host. See [Local mode integration](local-integration-en.md) and [Shareable documents and static export](shareable-export-en.md). A complete editor, preview and document-switching example is in [react-editor.tsx](../examples/integration/react-editor.tsx).

## Server rendering

The editor entry has no top-level `window` or `document` access. Importing it and rendering the initial textarea with `react-dom/server` is safe. Focus, selection, completion, layout measurement and toolbar menus run after the component mounts in a browser, so interactive checks and browser tests need a client.

## Styles and scope

`reactive-md/editor/styles.css` contains the editor's own tokens and rules. All selectors are scoped to `.reactive-md-editor` or its descendants, so the stylesheet does not restyle host buttons, inputs or the page body. The theme comes from the instance attribute described above.

If the same page also renders a document preview, import `reactive-md/styles.css` as well. The two stylesheets are independent and can be loaded in either order.

## Compatibility

`0.5.0` adds the editor entry and keeps `local-draft-2`, `component-protocol-1` and `reactive-md-theme-1`. Projects that only render documents can upgrade without changing imports or source. The editor is new, so it has no older API to migrate from. See the [0.5.0 release notes](release-0.5.0-en.md) and [Versions and compatibility](compatibility-en.md).
