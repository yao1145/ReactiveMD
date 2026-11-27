# Deprecation and migration policy

[中文](deprecation-ch.md) · **English**

This policy takes effect with `reactive-md@0.9.2` and `reactive-md-editor@0.2.1` for the [stable public API](api-stability-en.md). Each package tracks its own release versions and notice periods.

## Announcement, notice period and removal

1. Announce a deprecation in the changelog and the associated API documentation. Record the affected entry or symbol, first announced release, replacement, earliest possible removal and actionable migration steps. Mark applicable TypeScript declarations with `@deprecated` and point to the replacement.
2. Keep the deprecated interface for at least 90 days and for one complete minor release line after the initial announcement. It continues to receive compatibility and security fixes in patches on that line.
3. Remove the deprecated interface in a later minor or major release once both conditions are met. Record the removal and migration path in the changelog. For example, a deprecation announced in `0.9.x` stays available through `0.10.x` and can be removed in `0.11.0` once 90 days have elapsed.

Security vulnerabilities, data corruption and mandatory upstream platform changes can require a shorter window. Release notes record the reason, affected scope and available fallback or migration. A security issue may be disclosed when the fix ships. Other incompatible changes in 0.x minor releases also list the old usage, replacement and affected versions.

## Current host migrations

Editor `0.2.1` requires engine `0.9.2` or a later `0.9.x` release through its `^0.9.2` peer. Upgrade the packages together or keep editor `0.2.0` with engine `0.9.0` or `0.9.1`. This pairing change is documented for the current release. Existing editor entry points and component imports remain available.

`LocalComponentPropValue` is the deprecated phase-one scalar alias. New extensions can use `LocalComponentValue` and narrow it where a scalar is required. The notice period for the alias starts with its first recorded release under this policy.

Source migrations follow their own syntax revisions. Run the [source revision and migration tools](source-versioning-en.md) before upgrading across revisions. Export a fresh state file after migration to record the new source digest. Engine `0.9.3` keeps `local-draft-3` and `reactive-md-state/v1`.
