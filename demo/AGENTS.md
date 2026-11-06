# Reactive MD Demo repository conventions

- Development uses `superpowers-lite`. Clear, local and reversible work proceeds directly.
- Writing, translation and documentation edits use `C:/Users/yaozi/.codex/skills/anti-defensive-writing/SKILL.md`.
- Preserve unrelated changes. Commit, push and deploy only when the task authorizes them.
- The engine and editor packages are consumed from `vendor/`. Edit them in their own repositories, not here.
- Two independent workflows exist: `ci.yml` verifies install, tests and build; `site.yml` builds and uploads the static site artifact. Neither deploys to production.

## Content layout

- `content/examples/local/` holds the Playground articles.
- `content/guides/` holds the bilingual user guide.
- `src/examples.ts` owns navigation titles, hints and section assignment.
- `extensions.ts` registers the Tetris and 2048 packages.

## Build and local checks

1. Confirm the change scope with `git status --short` and diff.
2. Install with `npm ci --legacy-peer-deps` (the committed game tarballs declare a `0.7.x` engine peer range).
3. Run `npm test` and `npm run build` for source changes.
4. Most browser checks target `http://127.0.0.1:5173`; start `npm run dev` first or set `DEMO_URL`. `test:browser:smoke`, `test:interactions` and `test:extensions` start their own server. Select a channel with `PLAYWRIGHT_CHANNEL=msedge` or `chromium`. Reports go to `artifacts/`.
5. Use `npm run test:browser:smoke` for a quick desktop and mobile pass.

## Site build

`npm run build` writes `dist/`. The site workflow uploads that directory as an artifact. Production deployment stays manual.

Generate `dist/release.json` after the final build and before packaging:

```powershell
$taskCommit = git rev-parse HEAD
$taskRelease = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $taskCommit.Substring(0, 7) + '-demo'
$taskDirty = [bool](git status --porcelain --untracked-files=normal)
New-Item -ItemType Directory -Force artifacts | Out-Null
@{
  release = $taskRelease
  commit = $taskCommit
  builtAt = [DateTime]::UtcNow.ToString('o')
  fix = 'Describe this change'
  workingTreeChanges = $taskDirty
} | ConvertTo-Json | Set-Content -Encoding utf8 dist/release.json
tar -czf "artifacts/$taskRelease.tar.gz" -C dist .
Get-FileHash "artifacts/$taskRelease.tar.gz" -Algorithm SHA256
scp "artifacts/$taskRelease.tar.gz" "rocky2-ts:/tmp/$taskRelease.tar.gz"
```

The metadata must match the built content. A rebuild clears `dist/`, so write `release.json` again.

## Deployment target

- Public site: `https://yaozi.raricy.com`.
- SSH: `ssh rocky2-ts`, using the existing local SSH configuration.
- Release directory: `/opt/reactive-md/releases/<release>`.
- Current site: `/opt/reactive-md/site`, a relative symlink to `releases/<release>`.
- Origin: `http://127.0.0.1:8081`; the static container is `reactive-md-web`.

Read the current link and metadata before every update, and keep the previous target for rollback:

```powershell
ssh rocky2-ts 'readlink /opt/reactive-md/site; cat /opt/reactive-md/site/release.json'
```

## Atomic switch and rollback

Run this on the server. Replace the release name and SHA256 with the local values. The release name uses only letters, digits, dots, underscores and hyphens.

```bash
set -eu
release='release-name'
expected_sha256='local-tarball-sha256'
previous=$(readlink /opt/reactive-md/site)
printf 'Rollback target: %s\n' "$previous"
printf '%s  %s\n' "$expected_sha256" "/tmp/$release.tar.gz" | sha256sum -c -
test ! -e "/opt/reactive-md/releases/$release"
mkdir "/opt/reactive-md/releases/$release"
tar -xzf "/tmp/$release.tar.gz" -C "/opt/reactive-md/releases/$release"
chmod -R a+rX "/opt/reactive-md/releases/$release"
test -f "/opt/reactive-md/releases/$release/index.html"
test -f "/opt/reactive-md/releases/$release/release.json"
ln -s "releases/$release" "/opt/reactive-md/site-next-$release"
mv -Tf "/opt/reactive-md/site-next-$release" /opt/reactive-md/site
curl -fsS http://127.0.0.1:8081/release.json
```

- Use the relative symlink `releases/<release>`. Container mount paths differ from host paths; absolute host paths produced 404 responses after an earlier switch.
- Publish to a new directory, verify the uploaded SHA256 and static files, then switch. Keep old release directories. Static file updates normally need no container restart.
- If the origin check or a core behavior fails, create another temporary relative symlink to the saved previous target and replace `site` with `mv -Tf`. Recheck the origin and public site.
- Keep existing credentials out of output and the repository.

## Online acceptance

1. Request `https://yaozi.raricy.com/release.json`; confirm the release name and commit match the build. Check the home page and its static assets.
2. Repeat the changed operation on the public site at desktop and mobile widths, and inspect page errors. HTTP 200 and a successful build do not replace behavioral verification.
3. Scripts that support `DEMO_URL` can test the live site:

   ```powershell
   $env:DEMO_URL = 'https://yaozi.raricy.com'
   node scripts/smoke-browser.mjs
   Remove-Item Env:DEMO_URL
   ```
