# Demo extension packages

The Demo installs Tetris from the committed npm tarball in this directory.
Its filename includes a SHA256 prefix; `package-lock.json` records the full npm
integrity value. Installation uses the package's built JavaScript, declarations,
CSS and notices, so a fresh checkout does not need to build the example first.

To update the package from [examples/tetris-package](../../examples/tetris-package/README.md), run from the repository root:

```sh
npm run update:demo-tetris
```

This builds the SDK and Tetris, packs the distribution, installs it in the Demo
and updates the dependency and lockfile. Commit the replacement tarball with
those changes. Preview and export consume the installed snapshot; source edits
take effect after this update command.
