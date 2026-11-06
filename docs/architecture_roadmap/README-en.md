# ReactiveMD architecture and implementation plan

**English** · [中文](README-ch.md)

Updated: 2026-11-05.

The current implementation entry is the [near-term plan: compiler kernel, local recovery and repository split](near-term-plan-en.md). That document consolidates the original compiler kernel design and folds in the original long-term roadmap; implementation rules and phase status are maintained there.

| Reading purpose | Location in the near-term plan |
| --- | --- |
| First handover and source orientation | Section 1: Quick start |
| Responsibilities of the compiler, editor and Demo | Section 2: Target architecture and repository boundaries |
| Compiler configuration and return values | Section 3: Compiler interface and result contract |
| strict, HTML recovery and RMD text fallback | Section 4: Implementation rules |
| Incremental compilation, Worker and state retention | Section 5: Consistency rules |
| Execution order and completion criteria | Sections 6–8: Roadmap, verification and handover |
| Themes, authoring tools, catalogs and 1.0 | Section 9: Follow-up directions and references |

Near-term work proceeds as "fixed baseline → one-shot compilation → local recovery → execution and host consistency → package boundaries → Demo repository migration → editor repository migration". Three repositories are the target maintenance shape; public-package consumption verification is a prerequisite for migration.

Long-term work continues around an embeddable interactive document system: shared language semantics, versioned component and theme contracts, a complete authoring workflow, and verifiable distribution. The original schedule is replaced by the phase acceptance in the near-term plan; later capabilities proceed according to real usage needs.
