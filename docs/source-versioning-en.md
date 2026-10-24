# Source revisions and migration

This page covers explicit source revisions, how the compiler treats them, and the pure core and CLI migration tools in the `0.4.0` development preview. Syntax rules are in the [syntax specification](local-interaction-syntax-en.md); package and API compatibility rules are in [Versions and compatibility](compatibility-en.md); the component upgrade checklist is in [0.4.0 development preview and migration](release-0.4.0-en.md).

## Declaring a revision

A source declares its revision with one HTML comment on its own line:

```markdown
<!-- reactive-md: local-draft-2 -->
```

The directive belongs to the document prologue, before the `<theme>` declaration and before any body content. A BOM, blank lines and ordinary Markdown comments may precede it. Exactly one directive is allowed.

Code spans and fences, math regions and inert fallback examples are not directives. Showing the line in documentation does not version the surrounding document.

Compilation behavior:

| Source | Result |
| --- | --- |
| No directive | Parsed as the current revision `local-draft-2`, as before; no new warning |
| `local-draft-2` | Parsed normally |
| `local-draft-1` or another explicit older revision | Rejected with a `local.version.*` diagnostic |
| Unknown, malformed, duplicate or misplaced directive | Rejected with a `local.version.*` diagnostic |

A rejected version declaration constructs no runtime. Declaring an old revision does not select an old parser, and it does not make the document readable under current rules. Migrate the source first.

Readers built before this declaration existed, including `0.3.1`, treat the comment as an inert HTML comment. They do not validate it, do not reject old revisions and do not enforce this guard. A declaration protects documents opened in this build and later builds; migrate old documents before relying on the check.

## Inspect the declared revision

`inspectLocalSourceVersion` is exported from `reactive-md` and does not compile or create a runtime:

```ts
import { inspectLocalSourceVersion } from 'reactive-md';

const info = inspectLocalSourceVersion(source);
// {
//   declaredVersion: string | null,
//   effectiveVersion: string,
//   supported: boolean,
//   range: SourceRange | null,
//   diagnostics: Diagnostic[]
// }
```

- `declaredVersion` is the revision named by the directive, or `null` when the source is unversioned.
- `effectiveVersion` is the revision used for interpretation decisions: the declared revision when present, otherwise the current revision. When `supported` is `false`, no interpretation takes place.
- `supported` is `true` when this compiler accepts that revision.
- `range` locates the directive in the original source, or is `null` when there is none.
- `diagnostics` reports malformed, duplicate, misplaced, old or unknown declarations using the `local.version.*` prefix.

An unversioned source reports `declaredVersion: null`, `effectiveVersion: 'local-draft-2'`, `supported: true` and no version diagnostic.

## Check an upgrade

```ts
import { checkLocalUpgrade } from 'reactive-md';

const check = checkLocalUpgrade(source);
// {
//   ok: boolean,
//   fromVersion: string,
//   toVersion: 'local-draft-2',
//   needsMigration: boolean,
//   diagnostics: Diagnostic[]
// }
```

`fromVersion` defaults to the declared revision, or to the current revision when the source is unversioned. Pass `LocalUpgradeOptions` to override it:

```ts
type LocalUpgradeOptions = {
  fromVersion?: string;
  allowSemanticChanges?: boolean;
};

const check = checkLocalUpgrade(oldSource, { fromVersion: 'local-draft-1' });
```

An unversioned historical document requires `fromVersion: 'local-draft-1'` to receive the draft-1 checks. When an explicit `fromVersion` disagrees with the declaration, the check is rejected. Only `local-draft-1` and the current `local-draft-2` are accepted as migration sources; legacy YAML revisions and unknown names are rejected.

`needsMigration` is `true` when the source needs a new or different directive. An unversioned source needs the current directive stamped; a current source is already complete; a draft-1 source needs its directive replaced. `ok` is `false` when a blocker prevents a safe migration even though the version change itself is recognized.

## Migrate source

```ts
import { migrateLocalSource } from 'reactive-md';

const result = migrateLocalSource(oldSource, { fromVersion: 'local-draft-1' });
// {
//   ok: boolean,
//   fromVersion: string,
//   toVersion: 'local-draft-2',
//   needsMigration: boolean,
//   diagnostics: Diagnostic[],
//   source: string,
//   changed: boolean,
//   edits: { range: SourceRange; text: string }[]
// }
```

Migration stamps or replaces the metadata comment and preserves the body. It keeps original body bytes, a UTF-8 BOM and CRLF line endings, and is idempotent: migrating an already current source returns `changed: false` and the same text. `edits` locates each replacement. A blocked migration produces no migrated output, and the caller's input remains unchanged.

Before moving `local-draft-1` source to `local-draft-2`, migration blocks:

- bindings that use one of the 17 newly reserved expression names: `sum`, `average`, `minOf`, `maxOf`, `formatNumber`, `formatPercent`, `formatScientific`, `formatCurrency`, `trim`, `lower`, `upper`, `startsWith`, `endsWith`, `replace`, `slice`, `dateCompare`, `dateDiff`;
- the 15 newly recognized tag names outside code: `jump`, `anchor`, `text`, `section`, `multi-select`, `range-slider`, `coordinate`, `quiz`, `steps`, `step`, `computed`, `const`, `validation`, `data-table`, `column`;
- array syntax or calls to newly introduced built-ins in expressions; text inside string literals does not trigger this check;
- current compile errors in the source.

Diagnostics report precise source positions. Migration does not rename identifiers, rewrite expressions or activate formerly inert tags. Those are source changes for the author.

Text controls need one explicit compatibility decision. An `input` or `textarea` with `min-length` greater than zero, or with a `max-length`, changes reader semantics for astral Unicode: draft-2 counts Unicode code points while draft-1 counted UTF-16 code units. Migration blocks these controls unless semantic changes are allowed:

```ts
migrateLocalSource(oldSource, {
  fromVersion: 'local-draft-1',
  allowSemanticChanges: true,
});
```

With that option, migration proceeds and returns a warning for each affected control. Use it when the new code-point limits are the intended reader behavior.

Completed checklist styling is a documented compatibility exception. The visual change alone does not block migration and is not treated as a core runtime-semantic failure.

Migration changes the source digest. Existing `reactive-md-state/v1` files then fail digest validation, so export a fresh state file after migrating. Migration never rewrites state files.

## CLI

```sh
reactive-md migrate doc.reactive.md
reactive-md migrate - --from local-draft-1 -o doc.reactive.md
reactive-md migrate doc.reactive.md --check
reactive-md migrate doc.reactive.md --check --json
reactive-md migrate old.reactive.md --from local-draft-1 --accept-semantic-changes -o new.reactive.md
```

| Option | Meaning |
| --- | --- |
| `[file\|-]` | Input file, or `-` for standard input |
| `--from local-draft-1\|local-draft-2` | Source revision; defaults to the declaration or the current revision |
| `--check` | Report whether migration is needed; never writes |
| `--json` | Structured report on standard output; the only stdout content |
| `-o, --output <file>` | Create a new file; refuses any existing path, including the input |
| `--accept-semantic-changes` | Allow the text-control length change and report warnings |
| `--locale en\|zh` | Language for displayed diagnostics and summaries |

By default, migrated source goes to standard output. The input file is never overwritten; `-o` uses exclusive creation, so an existing file is an error. Without `-o`, redirect stdout to keep the result.

`--check` never writes. It prints diagnostics and a summary, or a JSON report with `--json`. It exits `1` when changes are needed or migration is blocked, and `0` when the source is already current. A normal migration exits `1` when blocked and `0` on success. Usage and I/O errors exit `2`. Do not mix source text with the JSON report.

The command migrates one source at a time. This build has no `--write` mode, no in-place overwrite and no destructive batch operation.

## Scope

Migration handles the declared metadata change and checks whether the body can cross the revision boundary. It is not a legacy reader: it does not interpret YAML `state`/`data`/`computed`/`actions` blocks, directives or other pre-draft syntax, and it does not rewrite the body. Source that already fails to compile under `local-draft-2` stays blocked until the author fixes the reported positions.

The `0.4.0` package remains an unreleased development preview. This page documents the tools in that preview; it does not announce a published release.
