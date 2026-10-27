# 0.6.1 release

`reactive-md@0.6.1` replaces native MathML formula display with KaTeX. It updates both `latest` and `next`. Syntax revision `local-draft-2`, component protocol `component-protocol-2` and theme protocol `reactive-md-theme-1` stay unchanged.

```sh
npm install reactive-md
# or pin the version
npm install reactive-md@0.6.1
```

For offline installation, use the [npm tarball](https://registry.npmjs.org/reactive-md/-/reactive-md-0.6.1.tgz).

## Formula display

KaTeX typesets inline and display formulas with its math fonts. Visual HTML is paired with MathML for assistive technology and an annotation containing the original LaTeX. Integrals, fractions, matrices, alignment, equation tags and mhchem chemistry use the same renderer. Formula display and compiler diagnostics now share KaTeX's supported syntax, including `matrix`, `\overset`, `\displaystyle` and `\limits`.

The standard stylesheet embeds 20 WOFF2 font faces. Preview, print and single-file HTML exports can display formulas offline, including static HTML with JavaScript disabled. Inline formulas follow the text baseline and wrap at KaTeX break points. Wide display formulas scroll horizontally; equation tags reserve space beside the formula.

## Compatibility

Existing imports keep working. Load `reactive-md/styles.css` when using the unstyled React entry, or provide KaTeX styles and fonts in the host. The bundled renderer and fonts increase download size.

`align` numbers rows automatically. Use `align*` or `aligned` for unnumbered alignment. Explicit `\tag` belongs in display formulas. Invalid or unsupported formulas now fall back to bounded source text for the whole formula, with a `local.math.display` warning at the source range.

Plot evaluation keeps the existing parser, supported functions and parameter updates. Author-defined macros, HTML, file and network commands remain disabled. Input size, nesting, token count, macro expansion and user-specified dimensions are bounded. See the [syntax reference](../reference/local-interaction-syntax-en.md) and [security policy](../../SECURITY.md).

KaTeX and its fonts replace the separate `mhchemparser` dependency. The bundled mhchem extension's upstream copyright and Apache-2.0 notice are retained in `THIRD_PARTY_NOTICES.md`.
