These private React controls adapt the free Arc UI registry components from
https://github.com/kuratlielia/arc-library and https://uiarc.dev.
The upstream MIT license is preserved in LICENSE.txt and the generated package
THIRD_PARTY_NOTICES.md.

The default-theme adapters keep ReactiveMD's bindings, validation, reset,
localization and static rendering in the owning component Views. Other themes
continue to use their existing controls. CSS Modules consume ReactiveMD semantic
tokens; the Arc foundation stylesheet and its global resets are not imported.

Slider numbers update as plain text, and thumbs keep the original theme accent
border. Selection and disclosure motion follows the default theme's short
150–220ms timing. Select menus remain inside their document's theme scope;
dates cross the adapter boundary as calendar dates, without a UTC conversion.

The source snapshots used for the initial integration are kept in the local
artifacts/uiarc-review-2026-11-11 evaluation directory. That directory is not
required to build or use this package.
