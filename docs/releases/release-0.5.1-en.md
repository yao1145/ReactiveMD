# 0.5.1 preview release

`reactive-md@0.5.1` is a 0.x preview that targets the `next` channel. It keeps syntax revision `local-draft-2`, component protocol `component-protocol-1` and theme protocol `reactive-md-theme-1`. Existing 0.5.x imports and documents need no migration. `latest` remains `0.4.0`.

```sh
npm install reactive-md@next
# or pin the preview
npm install reactive-md@0.5.1
```

For offline installation, use the [npm tarball](https://registry.npmjs.org/reactive-md/-/reactive-md-0.5.1.tgz).

## Editor views and themes

`ReactiveMarkdownEditor` adds a status bar below the editing area. It shows the Unicode character count and a keyboard hint, and switches between Edit, Split and Preview. Pass `preview` to render host content inside the editor frame; `viewMode` and `onViewModeChange` control the mode from the host, while `defaultViewMode` sets the initial mode for an uncontrolled instance. Switching views keeps the source selection, undo history and preview component state.

Containers up to 600px wide offer only Edit and Preview. A source-only editor keeps the count and keyboard hint. Press Esc, then Tab in the source to move focus to the toolbar.

The editor source surface, gutter, syntax highlighting, toolbar and menus now follow the instance theme. Light mode uses a white editor surface, dark mode keeps the deep blue surface, and `auto` follows the system preference. The host page theme and the editor theme remain independent.

See [React source editor](../integration/editor-en.md) for the full prop table and view behavior.

## HTML compatibility

The default renderer now accepts a P0 HTML subset, including disclosures, containers, headings, code, lists, links and images. Three host-owned options add author CSS, JavaScript and extended HTML. All three are off by default. Enabling any one routes the whole document to isolated native HTML, which stops Markdown and ReactiveMD interpretation for that path.

This routing is a temporary policy for the next release. Static export disables author JavaScript. See [HTML compatibility](../reference/html-compatibility-en.md) for the supported subset, options and conflict rules.

## Compatibility

Existing `reactive-md`, `reactive-md/react`, `reactive-md/editor` and `reactive-md/styles.css` imports keep working. Documents written for `0.4.x` and `0.5.0` need no edit. The syntax revision, component protocol and theme protocol keep their current versions.

The editor requires React 19. The core `reactive-md` entry still does not depend on React. See the [changelog](../../CHANGELOG.md) and [Versions and compatibility](../compatibility/compatibility-en.md) for the version axes.

## Validation and limits

The 0.5.1 release gate covers core and renderer tests, the editor entry and its views, type checking, package exports, documentation links, offline tarball consumers, static rendering and browser interaction. CI targets Node 22.12 and 24 with Chromium; local browser checks use Microsoft Edge. General SSR hydration outside exported HTML, Firefox and WebKit remain unverified.

The project remains a 0.x preview. Security boundaries and host responsibilities are documented in [SECURITY.md](../../SECURITY.md).
