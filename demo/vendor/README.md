# Demo extension packages

The Demo installs Tetris and 2048 from the committed npm tarballs in this
directory. Filenames include a SHA256 prefix; `package-lock.json` records the
full npm integrity value. Installation uses each package's built JavaScript,
declarations, CSS and notices, so a fresh checkout does not need to build the
examples first.

To update a package from its source directory, run from the repository root:

```sh
npm run update:demo-tetris
npm run update:demo-2048
```

Each command packs the distribution, installs it in the Demo and updates the
dependency and lockfile. `update:demo-tetris` also rebuilds the SDK first;
`update:demo-2048` builds only the package. Commit the replacement tarball with
those changes. Preview and export consume the installed snapshot; source edits
take effect after the update command.
