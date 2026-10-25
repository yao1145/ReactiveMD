# 0.5.0 preview release

`reactive-md@0.5.0` is a 0.x preview that targets the `next` channel. It keeps syntax revision `local-draft-2`, component protocol `component-protocol-1` and theme protocol `reactive-md-theme-1`. Existing 0.4.x imports and documents need no migration. `latest` remains `0.4.0`.

```sh
npm install reactive-md@next
# or pin the preview
npm install reactive-md@0.5.0
```

For offline installation, use the [npm tarball](https://registry.npmjs.org/reactive-md/-/reactive-md-0.5.0.tgz).

## Editor entry

`0.5.0` adds `reactive-md/editor`, a controlled React 19 source editor extracted from the Playground. It handles source highlighting, Markdown formatting, component insertion templates, completion, binding navigation, rename, format, undo and redo, line numbers and scroll synchronization. Locale and theme are configured per instance.

The editor has an independent stylesheet at `reactive-md/editor/styles.css`. Its rules are scoped to the editor root, so it can be loaded without the document renderer styles. A host that shows a preview imports `reactive-md/styles.css` as before.

`ReactiveMarkdownEditor` takes `value` and `onChange` and exposes a ref handle for focus, selection, textarea access, undo and redo. Optional `diagnostics` and `document` props add gutter markers and binding value types. Authoring tools analyze source locally; the host manages preview, storage and the toolbar export action through `onExport`. See [React source editor](editor-en.md) for the full prop table, history rules, read-only modes and server rendering notes.

## Document rendering

Documents now preserve ordinary generic or comparison text and currency instead of reading it as a component tag or formula. Attribute-free `<b>`, `<i>`, `<u>`, `<s>`, `<mark>` and `<br>` are supported as basic HTML formatting. Markdown footnotes render with rich definitions, numbering, repeated references and return links.

These additions extend prose parsing and document rendering. The syntax revision, component protocol and theme protocol keep their current versions.

Fenced code blocks highlight common languages, including JavaScript, TypeScript, Python, JSON, Bash, HTML and CSS. A copy button copies the original text with success or failure feedback. Unknown languages and blocks longer than 20,000 characters remain plain text. Static output keeps highlighting; copy controls are omitted from static output and printing.

Images approved by the host URL policy open in a modal viewer. Enter or Space opens the image; the close button, Escape or the backdrop dismisses it and restores focus. Linked images keep their link navigation. Static output keeps ordinary images. See the [author guide](local-guide-en.md) and [host integration](local-integration-en.md) for usage.

## Compatibility

Existing `reactive-md`, `reactive-md/react` and `reactive-md/styles.css` imports keep working, and the renderer entry is unchanged. Documents written for `0.4.x` need no edit. The release adds a public entry; projects that only render documents can upgrade without changes.

The editor requires React 19. The core `reactive-md` entry still does not depend on React. See the [changelog](../CHANGELOG.md) and [Versions and compatibility](compatibility-en.md) for the version axes.

## Validation and limits

The 0.5.0 release gate covers core and renderer tests, the editor entry, type checking, package exports, documentation links, offline tarball consumers, static rendering and browser interaction. CI targets Node 22.12 and 24 with Chromium; local browser checks use Microsoft Edge. General SSR hydration outside exported HTML, Firefox and WebKit remain unverified.

The project remains a 0.x preview. Security boundaries and host responsibilities are documented in [SECURITY.md](../SECURITY.md).
