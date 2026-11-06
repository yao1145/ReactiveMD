# Repository migration

**English** · [中文](repository-split-ch.md)

The language engine, editor and website have independent repositories, versions and release workflows:

| Repository | Candidate | Responsibility |
| --- | --- | --- |
| [ReactiveMD](https://github.com/yao1145/ReactiveMD) | reactive-md@0.8.0-next.0 | Compiler, runtime, sessions, Worker, authoring services, SDK, React/SSR, export |
| [ReactiveMD-Editor](https://github.com/yao1145/ReactiveMD-Editor) | reactive-md-editor@0.1.0-next.0 | CodeMirror, toolbar, navigation, diagnostics, editor Worker |
| [ReactiveMD-Demo](https://github.com/yao1145/ReactiveMD-Demo) | Private website package 0.1.0 | Website, examples, extension assembly, deployment |

Engine 0.8 removes the old editor exports. Replace reactive-md/editor with reactive-md-editor, reactive-md/editor/codemirror with reactive-md-editor/codemirror, and the corresponding styles.css imports with the new package paths. Published 0.7 packages retain their original exports. The language syntax and state protocol keep their existing revisions.

The editor consumes only public reactive-md and reactive-md/authoring APIs. Pure commands/catalogs remain available from reactive-md/authoring without the editor UI.

Candidate consumers commit vendor tarballs and lockfile integrity. The editor pins its engine peer to the exact prerelease; the Demo installs both candidates. These candidates have not been published to npm. To update them: run the engine check and notices scripts, pack with --ignore-scripts, copy the package into both vendor directories, install in the editor, run its check and pack it, copy the editor package into Demo/vendor, install and check the Demo. Refresh tarballs and lockfiles whenever candidate contents change. After registry publication, switch to registry version ranges and verify a clean install.

Engine CI runs one Node24 job for types, build, retained regressions and actual package consumption. Editor checks own UI services and public-engine consumption. Demo checks the website, export and desktop/mobile interaction. Historical phase matrices and duplicated acceptance tests are retired; Git history preserves them.

The engine and editor each publish through a manual publish.yml workflow with npm OIDC. Configure a separate trusted publisher before the editor's first release. Website deployment follows the Demo AGENTS.md with SHA256 verification and an atomic relative-symlink switch. Repository pushes do not publish npm packages or deploy the website.

Candidate tarball filenames include a SHA256 prefix. Use the exact vendor filenames in package.json; update those paths and lockfile integrity whenever package contents change.
