# Demo extension packages

The Demo installs Tetris and 2048 from the committed npm tarballs in this
directory. Filenames include a SHA256 prefix; `package-lock.json` records the
full npm integrity value. Installation uses each package's built JavaScript,
declarations, CSS and notices, so a fresh checkout does not need to build the
examples first.

The same directory carries the engine and editor snapshots the Demo builds
against:

| File | Package | Version |
| --- | --- | --- |
| `reactive-md-0.8.0-next.0.tgz` | `reactive-md` | `0.8.0-next.0` |
| `reactive-md-editor-0.1.0-next.0.tgz` | `reactive-md-editor` | `0.1.0-next.0` |

Build a new engine or editor tarball in its own repository, copy it here with
the versioned filename, update `package.json` and regenerate the lockfile. The
game packages keep their own source repositories; replace their tarballs the
same way when a new game build is released.

Install with `npm ci --legacy-peer-deps` (or `npm install --legacy-peer-deps`
on a checkout without a lockfile). The committed game tarballs still declare a
`reactive-md` peer range of `^0.7.0`, while this Demo runs the `0.8.0-next.0`
engine. The game runtime API used by the Demo is unchanged.

Candidate tarball filenames include a SHA256 prefix. Use the exact vendor filenames in package.json; update those paths and lockfile integrity whenever package contents change.
