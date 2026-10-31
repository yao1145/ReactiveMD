# Build a component plugin in five minutes

[中文](component-development-ch.md) · [Full development contract](component-development-reference-en.md)

Start with a note container that can expand Markdown. The extension SDK ships in `reactive-md@0.7.0`; install the published package.

## Create and run

```sh
npx reactive-md init component ../my-note --name my-note --id acme/my-note --form container --props '{"label":{"kind":"string","default":"Note"}}' --yes
cd ../my-note
npm install reactive-md@0.7.0 react@^19 react-dom@^19
npm run dev
```

Open the address printed by Vite. The page shows a note with Markdown children. Omit fields to answer terminal prompts, or use `--yes` for noninteractive defaults. See `init component --help` for options.

## Edit one component

Replace the generated `src/my-note.tsx` with:

```tsx
import { useState } from 'react';
import { defineReactComponentPackage, type LocalComponentContext } from 'reactive-md/react';
import { manifest } from './manifest.js';

function Note(ctx: LocalComponentContext) {
  const [open, setOpen] = useState(true);
  const title = String(ctx.props.label);
  if (ctx.mode === 'static') {
    return <aside className="my-note" data-my-note>
      <strong>{title}</strong>{ctx.children.render()}
    </aside>;
  }
  return <aside className="my-note" data-my-note>
    <button disabled={ctx.disabled} onClick={() => setOpen(value => !value)}>
      {title}
    </button>
    {open ? ctx.children.render() : null}
  </aside>;
}

export const componentPackage = defineReactComponentPackage({
  ...manifest,
  render: Note,
  css: '.local-document .my-note { padding: 12px; color: var(--ink); border: 1px solid var(--accent); }',
});
```

Click the title to expand or collapse its Markdown. The same renderer handles static output through `ctx.mode`. Supply `renderStatic` when a different layout is needed. Components own local React state and timers; the kernel validates shared bindings and rejects writes in static mode. Timer effects should return immediately in static mode and clean up on unmount.

## Assemble the host once

The scaffold supplies this wiring. Register packages in `extensions.ts`:

```ts
import { createReactHost } from 'reactive-md/react';
import { componentPackage } from './src/my-note.js';
export const host = createReactHost({ packages: [componentPackage] });
```

`reactiveMd({ extensions: './extensions.ts' })` configures styles, deduplication and the offline runtime in Vite. The app reads `host` from `virtual:reactive-md/host` and passes `host.reactConfig` to the preview. Custom compilers and Workers use `host.compileOptions`. Edit form, props and capabilities in `src/manifest.ts`. Simple components may inline their manifest in the convenience factory, which defaults the protocol and leaf form and derives a CSS resource ID from the component ID.

## Check and pack

```sh
npm run typecheck
npm test
npm pack --ignore-scripts
```

Install the tarball in another host and import its public entries. See the [full development contract](component-development-reference-en.md) for bindings, containers, pure manifest entries, capabilities, resources, offline export and compliance evidence. The [Demo guide](https://github.com/yao1145/ReactiveMD/blob/main/demo/README.md) describes the installed-package cases for `<tetris>` and `<game-2048>`.
