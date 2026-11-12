# Repository migration

**English** · [中文](repository-split-ch.md)

The language engine, editor and website have independent repositories, versions and release workflows:

| Repository | Prepared release | Responsibility |
| --- | --- | --- |
| [ReactiveMD](https://github.com/yao1145/ReactiveMD) | reactive-md@0.8.0 | Compiler, runtime, sessions, Worker, authoring services, SDK, React/SSR, export |
| [ReactiveMD-Editor](https://github.com/yao1145/ReactiveMD-Editor) | reactive-md-editor@0.1.0 | CodeMirror, toolbar, navigation, diagnostics, editor Worker |
| [ReactiveMD-Demo](https://github.com/yao1145/ReactiveMD-Demo) | Private website package 0.1.0 | Website, examples, extension assembly, deployment |

Engine 0.8 removes the old editor exports. Replace reactive-md/editor with reactive-md-editor, reactive-md/editor/codemirror with reactive-md-editor/codemirror, and the corresponding styles.css imports with the new package paths. Published 0.7 packages retain their original exports. The language syntax and state protocol keep their existing revisions.

The editor consumes only public reactive-md and reactive-md/authoring APIs. Pure commands/catalogs remain available from reactive-md/authoring without the editor UI.

Candidate consumers commit content-addressed vendor tarballs and lockfile integrity. The editor declares its engine peer range from public API compatibility; its development install and the Demo pin exact tarballs. Publish the 0.8.0 engine before the 0.1.0 editor. To update them: run the engine check and notices scripts, pack with --ignore-scripts, copy the package into the editor vendor directory, install in the editor, run its check and pack it, then update Demo/vendor if a website update is requested. Refresh tarballs and lockfiles whenever candidate contents change. After registry publication, switch to registry version ranges and verify a clean install.

Engine CI runs one Node24 job for types, build, retained regressions and actual package consumption. Editor checks own UI services and public-engine consumption. Demo checks the website, export and desktop/mobile interaction. Historical phase matrices and duplicated acceptance tests are retired; Git history preserves them.

The engine and editor each publish through a manual publish.yml workflow with npm OIDC. Configure a separate trusted publisher before the editor's first release. Website deployment follows the Demo AGENTS.md with SHA256 verification and an atomic relative-symlink switch. Repository pushes do not publish npm packages or deploy the website.

Candidate tarball filenames include a SHA256 prefix. Use the exact vendor filenames in package.json; update those paths and lockfile integrity whenever package contents change.
