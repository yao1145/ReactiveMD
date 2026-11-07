# Load themes and components from directories

Enable `reactiveMd()` from `reactive-md/vite` once in the consuming project's Vite config. It scans immediate child directories under `theme/` and `plugin/`, relative to Vite root.

```text
theme/paper/theme.css
theme/paper/theme.json       # optional
plugin/tetris/index.ts
plugin/tetris/component.css # optional
```

A theme needs only `theme.css`. Its directory supplies the name, `local/theme/<directory>` supplies the package ID, and the version defaults to `0.0.0`. Optional `theme.json` can set `id`, `name`, `version`, `protocol` and `colorSchemes`. The loader calls `defineLocalTheme` for validation, scoping and freezing. Write both color schemes using the theme protocol. A document selects a discovered theme with `<theme name="paper">`.

A component entry exports a `LocalReactPackage`, preferably as its default export. A single distinct named package export also works; aliases of the same object count once. Continue using `defineReactComponentPackage` to declare the tag, props, capabilities and React implementation. An installed package can be forwarded through its public entry:

```ts
// plugin/tetris/index.ts
export { tetrisPackage as default } from 'reactive-md-tetris-package/react';
```

Recognized entry names are `index.ts`, `index.tsx`, `index.js`, `index.jsx`, `index.mts` and `index.mjs`. Multiple entries in one directory are an error. Helper files are imported by the entry. Optional `component.css` is collected automatically. Package resources, themes and notices are preserved; an entry may also export a `notices` array.

The app reads `host` from `virtual:reactive-md/host`. React uses `host.reactConfig`; compilation and authoring use `host.compileOptions`. Workers receive the serializable `host.config`. SSR and exports use `host.resources` and `host.notices`. Import `reactive-md/styles.css` for the base styles and reference `reactive-md/vite/client` for virtual-module types. The offline bundle and browser host use the same discovery result.

Directories have a fixed sort order. Local CSS imports and relative assets are resolved and inlined at build time, with source paths, digests and byte sizes in the asset manifest. Remote references, paths outside the allowed directory and resource budget violations fail. SDK scoping and CSS rules still apply. Duplicate theme names, theme IDs, component IDs and tags identify both source entries; conflicting resource contents fail too.

The dev server watches entry creation, deletion and renaming. Theme CSS and asset changes update styles and invalidate the offline bundle cache; registration changes reload the page. Discovery makes themes available for selection and components available for authored tags.

Use `reactiveMd({ themeDir: 'themes', pluginDir: 'components' })` for alternate roots. Advanced hosts can keep `reactiveMd({ extensions: './extensions.ts' })`, whose module exports `host = createReactHost(...)`. Manual and directory options are mutually exclusive. Keep application metadata, such as example navigation, in ordinary application modules.

The Demo uses its existing Tetris and 2048 packages and sci-fi theme through these directories. Its local sci-fi CSS was copied from the installed theme package's public CSS entries; synchronize those files when updating that package.
