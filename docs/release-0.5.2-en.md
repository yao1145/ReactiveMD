# 0.5.2 preview release

`reactive-md@0.5.2` is a 0.x preview that targets the `next` channel. It keeps syntax revision `local-draft-2` and theme protocol `reactive-md-theme-1`, and raises the component protocol to `component-protocol-2` for the host component extension axis. Existing 0.5.x imports and documents need no migration. `latest` remains `0.4.0`.

```sh
npm install reactive-md@next
# or pin the preview
npm install reactive-md@0.5.2
```

For offline installation, use the [npm tarball](https://registry.npmjs.org/reactive-md/-/reactive-md-0.5.2.tgz).

## Host components

`compileLocal(source, { hostComponents })` adds an opt-in extension axis for host-defined leaf tags. A schema is plain data: a name, `form: 'leaf'` and a property table declaring `kind`, `required`, `static`, `enum` and `pattern`. Names must be unique lowercase kebab-case and cannot reuse the 48 author tag names, P0 HTML tag names or the theme name; one compilation accepts at most 32 schemas.

Without `hostComponents`, behavior is unchanged: the tag remains unknown and falls back to source. With the option, the parser produces a `hostComponent` leaf node and the compiler validates its attributes. Attribute failures use `local.host.attribute`; invalid schemas use `local.options.invalid`. A valid host node counts as one syntax node, and host attributes obey the shared string-length budget. `pattern` is restricted to a linear-time-safe regex subset that rejects backreferences, lookarounds, named groups, nested quantifiers and quantified alternation.

`LocalDocumentView` and `LocalReactiveDocument` accept `hostData`, JSON-safe data keyed `${kind}:${ref}`, and a client-only `hostRenderer(node, data, ctx)`. A missing renderer, missing data or a throwing renderer renders a visible placeholder instead of failing the document. `mode="static"` uses the same dispatch. Schemas travel through the compile worker; the renderer and host data never do.

See [Local mode integration](local-integration-en.md#host-components) and [Component protocol](component-protocol-en.md) for the full contract.

## Protocol revision

The component protocol is now `component-protocol-2`. The syntax revision remains `local-draft-2`, and the machine conformance baseline `component-protocol-1.json` stays frozen for the 48 author components. Host components have no portable machine cases because rendering is host-owned.

## Compatibility

Existing `reactive-md`, `reactive-md/react`, `reactive-md/editor`, `reactive-md/styles.css` and `reactive-md/editor/styles.css` imports keep working. Documents written for `0.5.x` need no edit; the host extension is opt-in. The core entry still does not depend on React. See the [changelog](../CHANGELOG.md) and [Versions and compatibility](compatibility-en.md).

## Validation and limits

The release gate covers type checking, the full test suite, documentation links, the package build and a packed-package smoke check. General SSR hydration outside exported HTML, Firefox and WebKit remain unverified.

The project remains a 0.x preview. Security boundaries and host responsibilities are documented in [SECURITY.md](../SECURITY.md).
