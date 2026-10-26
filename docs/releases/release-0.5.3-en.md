# 0.5.3 preview release

Install with `npm install reactive-md@0.5.3` or `npm install reactive-md@next`. This preview keeps syntax revision `local-draft-2`, component protocol `component-protocol-2` and theme protocol `reactive-md-theme-1`. The `latest` channel remains `0.4.0`.

## Host integration

- Set `markdownBreaks: true` in `LocalCompileOptions` to render Markdown soft line breaks as line breaks. The option travels through compilation, React preview, workers and cache keys. Source offsets retain their original UTF-16 positions; the default is `false`.
- Use `reactive-md/react/unstyled` for the React renderer with no stylesheet dependency. Import `reactive-md/screen.css` (also available as `reactive-md/styles.css`) for document styles, and opt into `reactive-md/print.css` for print layout and page margins. Screen styles no longer set global `@page` rules. Standalone HTML retains its own print styling.
- Import `localCompileOptionsKey` from `reactive-md` and `LocalRenderContext` from either React entry.

## Author tools

The `reactive-md/authoring` entry provides the schema, component catalog, template helpers, insertion commands and their types without loading React or CSS. CM6 and other host editors can use these functions independently of the built-in editor.

Pass the same optional `LocalCompileOptions` to `analyzeLocalSource(source, options)`, `completeLocalSource(source, offset, options)`, `renameLocalBinding(source, oldName, newName, options)` and `formatLocalSource(source, options)` as to preview compilation. Host schemas, native HTML routing and resource limits then use the same rules.

## Math diagnostics

Display math reports source-ranged warnings for unsupported commands or environments and rendering-budget fallbacks. Formulas remain readable as escaped text when rendering falls back. Computation support and display support are checked separately.

## Compatibility

Existing package entries remain available. Hosts that need document print layout should explicitly import the optional print stylesheet. No source syntax or protocol migration is required.

See the [changelog](../../CHANGELOG.md), [author tools](../integration/author-tools-en.md) and [integration guide](../integration/local-integration-en.md).