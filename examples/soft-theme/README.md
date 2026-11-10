# SOFT theme

A host-registered theme that keeps Reactive MD's original default appearance.

SOFT carries no CSS resources: the look comes from the core baseline stylesheet.
The package only supplies the theme identity, so a document can declare
`<theme name="soft">` once the host registers the definition.

```tsx
import { softThemeDefinition } from './examples/soft-theme/src/theme';

<LocalReactiveDocument themes={[softThemeDefinition]} /* … */ />
```

`softTheme` is the same definition validated and frozen through
`defineLocalTheme`; `softThemeResources` is its (empty) resource list.
