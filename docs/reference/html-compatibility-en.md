# Partial HTML compatibility and temporary routing policy

This feature targets the next release. Documents use Markdown, ReactiveMD controls and expressions by default, with the P0 HTML subset below. Host applications can enable author CSS, JavaScript and extended HTML separately. All three options default to `false`.

## Temporary routing policy

This release routes whole documents to avoid mixed parsing and rendering conflicts between author CSS, JavaScript, extended HTML and ReactiveMD.

| Compile options | Document behavior |
| --- | --- |
| All three options omitted or `false` | ReactiveMD parsing and the existing React renderer, including P0 HTML |
| Any option `true` | Native HTML for the entire source, rendered in an isolated iframe |

In native HTML mode, `# headings`, `**emphasis**`, LaTeX and `{{ expressions }}` remain ordinary text. Elements such as `input` and `table` use HTML semantics. ReactiveMD components establish no bindings. Turning all options off recompiles the document in the default mode. This is a transitional policy for this release; mixed compatibility can be evaluated later.

Options are host capabilities. Source tags and parameter state files cannot grant them. The demo displays the active mode and resets all three capabilities when the page reloads.

## Options and API

```ts
import { compileLocal } from 'reactive-md';

// Markdown, ReactiveMD and P0 HTML.
const reactive = compileLocal(source);

// Native HTML for the entire source; author CSS is enabled.
const html = compileLocal(source, {
  enableCss: true,
  enableJavaScript: false,
  enableExtendedHtml: false,
});
```

| Option | Default | Capability |
| --- | --- | --- |
| `enableCss` | `false` | Author CSS |
| `enableJavaScript` | `false` | Author scripts and event handlers |
| `enableExtendedHtml` | `false` | P1 elements, embeds, forms, SVG/MathML and whole-page HTML features |

Each option must be boolean. Enabling one does not enable the others. Styled extended elements require both extended HTML and CSS; scripts in extended elements require both extended HTML and JavaScript. Built-in styles, interactions, chart SVG and formula MathML continue to work independently of these author capabilities.

Source-length limits and `limits.maxSyntaxNodes` still apply. The HTML path counts traversed parse-tree nodes, with a cumulative budget shared by nested `srcdoc` documents.

The React convenience component accepts the same settings through `compileOptions`:

```tsx
<LocalReactiveDocument
  source={source}
  compileOptions={{ enableCss: true }}
/>
```

Lower-level hosts pass the compiled document to `LocalDocumentView`. Native HTML documents have a `document.html` field with the three normalized flags and empty parameter and binding collections. This field is runtime metadata. Store the original source and host settings when saving a document.

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

Mixing Markdown table rows and HTML table structure in one table is an error. Native tables reject component attributes such as `bind`, `key`, `label`, `searchable`, `sortable` and `page-size`; use `caption` for a title or `aria-label` for an accessible name. Structural tags inside code examples never determine the table type.

## Extended HTML

`enableExtendedHtml` controls the following author syntax:

- Definition lists: `dl`, `dt`, `dd`.
- Additional text semantics: `small`, `kbd`, `samp`, `var`, `abbr`, `q`, `cite`, `ins`.
- Figures and structure: `figure`, `figcaption`, `article`, `section`, `aside`, `header`, `footer`, `ruby`, `rt`, `rp`, `wbr`.
- Native forms, `iframe`, `object`, `embed`, `dialog`, arbitrary SVG/MathML and whole-page HTML features.

In the default mode, `table` distinguishes native and ReactiveMD syntax by its body; existing components such as `section`, `input` and `select` retain their current meanings. In native HTML mode, these names use browser semantics.

## Isolation and export

Author HTML runs inside a sandboxed iframe without `allow-same-origin`. Whole-page structure, styles and scripts apply to this isolated document. CSP and sandbox restrictions still govern resources, form submission and navigation. Extended HTML does not grant unrestricted network access.

This release supports inline CSS and JavaScript. Enabling the options does not automatically load external scripts, stylesheets, images, media or embedded resources. Extended HTML permits HTTP(S) form submission and `base` URL resolution inside the isolated document while retaining host-access and top-navigation restrictions. Iframes can use `srcdoc` for inline content; external `object` and `embed` resources remain subject to CSP.

Once arbitrary JavaScript is enabled, scripts can create elements and styles dynamically. The other options primarily constrain author source; they do not promise to block individual runtime DOM operations. Host isolation remains in place.

Interactive export preserves compile options and the selected rendering path. Native HTML static export retains built-in browser disclosure and form behavior while disabling author JavaScript. These documents have no ReactiveMD parameters to save. Older export payloads without compile options use the default with all three capabilities off.

See [integration](../integration/local-integration-en.md), [shareable export](../integration/shareable-export-en.md) and [security](../../SECURITY.md).
