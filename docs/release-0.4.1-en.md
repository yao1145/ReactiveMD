# 0.4.1 release notes

`reactive-md@0.4.1` is a compatible patch for 0.4.0. It keeps `local-draft-2`, `component-protocol-1` and `reactive-md-theme-1`; existing 0.4.0 documents need no migration.

```sh
npm install reactive-md@0.4.1
```

The release is available on `latest` and `next`. For offline installation, use the [npm tarball](https://registry.npmjs.org/reactive-md/-/reactive-md-0.4.1.tgz).

## Changes

Documents use quieter surfaces, fewer borders, muted chart colors and smoother control transitions. Fields and buttons have rounded ends; sliders have custom tracks that honor their `color` attribute. Tables fill their container with balanced columns and triangle sort indicators. Donut charts use more of the available space.

LaTeX uses the body font size and black/white ink, and piecewise expressions keep their conditions separate. Coordinate controls gain a grid, arrow axes, dashed projections and a labeled draggable point. Quiz inputs fill the container and the question and actions are vertically centered. The Playground preserves editor scroll after toolbar insertion and fits date inputs on narrow screens.

These are visual and interaction changes; the compiler, runtime and state-file contracts remain unchanged. Hosts with custom styles should review the revised defaults. See the [changelog](../CHANGELOG.md) and the [0.4.0 migration guide](release-0.4.0-en.md) when upgrading from an earlier minor release.

## Validation and limits

Release verification covers core and demo tests, types, package exports, documentation links, offline tarball consumers, static SSR, standalone HTML and browser interactions. CI targets Node 22.12 and 24 with Chromium; local browser checks use Microsoft Edge on Windows. General SSR hydration outside exported HTML, Firefox and WebKit remain unverified.

The project remains a 0.x preview. Security boundaries and host responsibilities are documented in [SECURITY.md](../SECURITY.md).
