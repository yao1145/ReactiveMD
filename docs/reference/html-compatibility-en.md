# HTML compatibility and author capabilities

**English** · [中文](html-compatibility-ch.md)

ReactiveMD documents mix Markdown, RMD components, expressions and basic HTML. The host controls author capabilities independently.

| Option | Default | Capability |
| --- | --- | --- |
| `enableCss` | `true` | Document styles, component declarations and styles in granted HTML fragments |
| `enableJavaScript` | `false` | Author scripts in interactive mounts |
| `enableExtendedHtml` | `false` | Additional native HTML fragments |

Give a source view its grants through `LocalReactiveDocument.compileOptions`. Give a precompiled view its own grants through `LocalDocumentView.capabilityGrants`. A direct mount defaults to CSS on, JavaScript off and extended HTML off. Effective permission requires both compilation and mount permission. Changing only these capabilities preserves the source view's runtime state.

### Styles

Place paired `<css>` blocks before the body. Multiple blocks cascade in source order. A component's `css` attribute applies declarations to its visible root. Document selectors stop at nested document roots. Ordinary inheritance still applies when the host nests documents. External author stylesheets and CSS resource loads are outside the inline style policy. A late style block or a declaration on a node without a visible root produces a source diagnostic. A registered component named `css` or `javascript` keeps its tag. A component schema's own `css` property keeps its original meaning.

### Scripts

Place code in a paired `<javascript>` block. After an interactive mount restores its state, an isolated worker initializes the blocks in source order. Each block has its own lexical scope. Use `await rmd.get(name)`, `await rmd.set(name, value)` and `await rmd.setMany(values)` to operate on named bindings. Writes follow the component's existing validation and read-only rules.

The counter exposes `increment`, `decrement` and `reset`. Give a counter an `action-id` and register `rmd.handleAction(id, "increment", callback)` to take over that action on that instance. `rmd.observeAction` observes an action without changing its default handler. Revocation, script replacement and unmount end the session. Static HTML, PDF and the static phase of hydration use the supplied RMD state.

Set `LocalDocumentView.authorScriptPaused` to pause author actions and binding requests while an asynchronous preview recompiles. When the script is unchanged, resume the existing session. Restoring a counter's `action-id` restores its registration within that session.

## P0 HTML in the default mode

| Purpose | Elements |
| --- | --- |
| Inline text | `b`, `strong`, `i`, `em`, `s`, `del`, `u`, `mark`, `sup`, `sub` |
| Breaks | `br`, `hr` |
| Paragraphs and headings | `p`, `h1` through `h6` |
| Containers | `div`, `span` |
| Disclosures | `details`, `summary` |
| Quotations | `blockquote` |
| Code | `code`, `pre`, and `code` inside `pre` |
| Lists | `ul`, `ol`, `li`, including `ol[start]` |
| Links and images | `a`, `img`, using the default path's URL policy |
| Native tables | `table`, `caption`, `colgroup`, `col`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`; distinguished from ReactiveMD tables by their body structure |
| Other forms | HTML comments, named and numeric character references, case-insensitive HTML names and void-element spelling |

Container bodies continue to parse Markdown, formulas, interpolation and ReactiveMD controls. Code elements preserve literal content. `details` reuses the existing disclosure theme and interaction, with rich summaries, nesting and the `open` attribute. Static rendering expands the body. HTML boolean attributes use presence semantics, so `open="false"` still means open. Existing ReactiveMD component boolean rules stay unchanged.

See the runnable [HTML and ReactiveMD example](../../examples/local/html-compat.reactive.md).

`div`, `p` and `h1` through `h6` accept a static `align` attribute with `left`, `center`, `right` or `justify`. Values ignore case and surrounding whitespace. For example:

```html
<div align="center">Hello</div>
<p align="right">A right-aligned **Markdown** paragraph.</p>
```

Alignment works without enabling CSS or extended HTML. Markdown and bindings inside the container remain active, and nested elements can override the inherited alignment. The native HTML route accepts the same bounded values.

Common attributes use an allowlist for document identifiers, titles, language, direction and accessibility. Author styles, event-handler attributes and unsupported elements in the default mode remain inert source or produce positioned diagnostics. Images still require explicit host approval. Code and unsupported regions execute no scripts.

Anchors accept static `target` and `rel` attributes, for example `<a href="https://example.com" target="_self" rel="nofollow">Open here</a>`. An explicit `target` overrides the default opening behavior; `rel` accepts whitespace-separated relationship tokens. In the default mixed mode, HTTP(S) links without these attributes retain `_blank` and `noopener noreferrer`, while relative links open in the current page. A `_blank` target preserves author relationship tokens, merges `noopener noreferrer` and removes the conflicting `opener` token. The sandboxed HTML route also accepts these attributes, retaining its restrictions on `_top`, `_parent` navigation and popups.

## Two table syntaxes

A `<table>` containing a Markdown table remains a ReactiveMD component, with its existing search, sorting, pagination and row selection. A body with native table structure is parsed as an HTML table without enabling extended HTML or changing the whole document's mode:

```html
<table>
  <caption>Prices</caption>
  <tr><th scope="col">Item</th><th scope="col">Price</th></tr>
  <tr><td>Apple</td><td>5</td></tr>
  <tr><td colspan="2">**Note**: prices can follow document parameters.</td></tr>
</table>
```

Both syntaxes share the table frame, title, cell styles and narrow-screen scrolling. Plain numeric columns use the same automatic alignment rules. Merged cells preserve their structure; cells can set `align` explicitly. Native tables add no search, sorting, pagination or selection controls by default.

Supported attributes include `colspan`, `rowspan`, `scope`, `headers` and `span` on `col` / `colgroup`. `colspan` and `span` accept 1–1000; `rowspan` accepts 0–65534, with 0 extending to the end of the current row group. Cells and captions support Markdown, formulas, interpolation, images and controls. Omitted row groups, row ends and cell ends are normalized using HTML rules, while source locations retain their original offsets.

Mixing Markdown table rows and HTML table structure in one table produces a diagnostic and displays that table as source. Native tables reject component attributes such as `bind`, `key`, `label`, `searchable`, `sortable` and `page-size`; use `caption` for a title or `aria-label` for an accessible name. Structural tags inside code examples never determine the table type.

### Source fallback

Successful conversion to inert source emits a `local.html.fallback` warning. Unknown ReactiveMD components retain `local.component.unknown`; fatal compilation still returns `ok: false`. Hosts can explicitly allow the fallback warning without allowing component spelling errors. See the [diagnostic contract](diagnostics-counting-en.md#safe-native-html-fallback).

Native HTML fragments that cannot compile are displayed as their original text, while surrounding Markdown, formulas and controls continue to work. This covers unsupported tags or attributes, invalid native tables and incomplete HTML fragments. An unclosed fragment ends at the current paragraph boundary or the enclosing ReactiveMD container's closing tag. Markdown, `{{ expressions }}`, components and scripts inside a fallback fragment stay literal.

In the native HTML route, an unsupported attribute makes its element fall back to source while neighboring elements continue to render. If whole-document parsing, serialization or compilation budget checks fail, React previews and standalone mounts display the complete source with preserved line breaks and escaped tags. Error results from `compileLocal`, resource limits and `onDiagnostics` reports are retained. Invalid host options and ReactiveMD component syntax errors keep their existing behavior.

## Extended HTML and export

Registered components take precedence. For example, `<input bind="name">` remains an RMD input, and `details` keeps Markdown and expressions in its body. Sanitized definition lists and other inert structures render in the document. Embeds, fragment scripts and styles run inside a sandbox. Denied fragments appear as source at their original positions.

Use sanitized `srcdoc` for self-contained embeds. Grant exact remote HTTPS origins with the mount's `allowedFrameOrigins` option. Fragment styles and scripts require their respective grants. The sandbox governs navigation, forms and parent document access.

New interactive exports record `sourceSemantics: "mixed-rmd-v1"`, the capability flags and the chosen state baseline. Old v1/v2 files without the field retain their original interpretation, including whole-document HTML where a capability was enabled. The envelope version continues to distinguish restoration contracts.

See [local integration](../integration/local-integration-en.md), [shareable export](../integration/shareable-export-en.md) and the [security policy](../../SECURITY.md).
