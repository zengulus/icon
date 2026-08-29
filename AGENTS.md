# ICON Repository Agent Instructions

This repository implements the ICON 1.5 rules engine, character-management
surface, source compendium, rules-driven VTT, and authoritative multiplayer
service.

This file is the repository constitution: stable authority rules, architectural
boundaries, specialization routing, and completion standards. Task procedures
belong in `SKILLS.md`. Current blocker counts, temporary implementation gaps,
and tranche-specific facts belong in the live docs and generated audits, not
here.

Read this file before making changes.

---

## 0. Working Protocol

Before editing:

1. Read this file.
2. Classify the task using **Specializations** below.
3. Select the matching procedure(s) from `SKILLS.md`.
4. Run `git status` and `git diff`.
5. If game semantics are involved, inspect the exact ICON source passage before
   designing the change.
6. Inspect the current implementation and the live foundation/coverage docs;
   do not reason from stale task notes.

After every change:

- run the verification required by the task class;
- reconcile any coverage/status delta with exact source units;
- update non-generated documentation when the current state changed;
- propose a detailed commit message, up to a paragraph.

Preserve unrelated user or agent changes. Never reset, discard, or rewrite
unrelated worktree state.

---

## 1. Authority Hierarchy

When sources disagree, use this order:

1. **`ICON 1.5.pdf` — semantic authority.**
2. **Adopted source adjudications — authority only for genuine source
   contradictions.**
3. **Implementation — execution authority.**
4. **Automation/fidelity audits — coverage authority.**
5. **Documentation — explanation and planning authority only.**

Consequences:

- Never change implementation merely to make stale prose correct.
- Never change source semantics to improve audit counts.
- Never infer a rule from an ability name when source text exists.
- Never promote a partially represented source unit as executable.
- If exact semantics are not representable, leave the unit unresolved and
  identify the smallest missing reusable capability.

ICON has distinct narrative and tactical modes. Do not transfer mechanics from
one mode into the other by analogy unless the source explicitly connects them.

---

## 2. Core Architecture

The rules project is rules-first. UI, VTT, transport, and persistence consume
rules authority; they do not independently implement it.

The intended rules dependency direction is:

    source-backed content
            ↓
          content
            ↓
          kernels
            ↓
        primitives

### `src/rules/automation/primitives/`

Owns source-ID-free semantic vocabulary, pure calculations, typed values,
generic builders, and generic state-transition structures.

Primitives must not know named ICON Jobs, abilities, talents, masteries,
Relics, foes, source IDs, or display names.

### `src/rules/automation/kernels/`

Owns reusable ICON mechanics, query/evaluation authorities, execution folds,
registries, timing/lifecycle machinery, and composition over primitives.

Kernels must remain source-ID-free in behavior. Source provenance may pass
through opaquely for audit/replay, but kernels must never branch on it.

### `src/rules/automation/content/`

Owns exact source-ID keyed recipes, source-defined constants, declarative rows,
and registration glue.

Content may select source-defined targets and parameters and compose existing
typed mechanics. It must not become a second rules engine.

### Shared rules/domain authorities

Targeting, range, LoS/LoE, areas, movement, placement, attack resolution,
damage, saves, resources, statuses, entities, terrain, lifecycle, triggers,
defeat, and replay must each have one shared execution authority for their
scope. Do not create local parallel implementations to unblock one source
unit.

### Consumer layers

`src/vtt/`, React UI, `server/`, Supabase adapters, and presentation code may
project, validate, transport, persist, or display rules state. They must not
recalculate game semantics independently when the engine already owns them.

---

## 3. Genericity Rule

A source rule should normally compile through:

    content row
      → typed reusable recipe/operation
      → generic kernel/domain authority
      → primitive values/mutations

Before creating a new primitive, kernel, callback, or resolver family, consult
`docs/generic-underlays.md` and apply its design test. Prefer composition over
new semantic authorities.

A source-specific resolver is a last resort. "Irreducible" means demonstrated
non-decomposability, not merely "not yet represented by the current
vocabulary".

Existing content `build` functions may emit typed `RuleMutation[]`, but `build`
is not an escape hatch for algorithms that belong in shared mechanics.

---

## 4. Determinism, Choice, and Replay

Encounter execution must be deterministic under replay.

- Random outcomes are decided once, recorded, then replayed.
- Player/GM choices that affect execution are explicit and durable where the
  continuation requires them.
- Optional source language must remain optional; never silently choose a
  default for a player.
- Do not invent deterministic tie-breaks where the source grants a choice.
- Do not derive later execution from unrecorded ambient UI/session state.
- `applyEvents` must apply recorded authority, not rerun rules decisions.

Any mechanic involving randomness, timing, delayed effects, branching,
interrupts, or persisted choice requires replay-oriented testing.

---

## 5. Specializations

Specializations are engineering hats, not silos. Every task has one **lead**
specialization and may require one or more secondary specializations. Use the
lead to decide where authority belongs; use `SKILLS.md` for the procedure.

| Specialization | Owns | Does not own |
| --- | --- | --- |
| **S1 — Source & Fidelity** | Exact source interpretation, obligation decomposition, provenance, conflicts/adjudications, semantic contracts, proof requirements | Inventing engine semantics or promoting unsupported behavior |
| **S2 — Rules Substrate** | Underlays, primitives, kernels, domain authorities, reusable query points, architecture de-duplication | Named-source shortcuts, coverage inflation |
| **S3 — Content Automation** | Jobs, Classes, abilities, talents, masteries, Relics, foe recipes, source-ID keyed parameterization | Generic algorithms that belong in S2/S4 |
| **S4 — Encounter Runtime & Replay** | Reducer semantics, lifecycle, scheduler, triggers, windows, continuations, ordering, event recording/replay, encounter adapters | UI-owned state or transport-specific rule forks |
| **S5 — Character & Narrative** | Character identity/schema rules, creation/advancement, Bonds/actions, narrative rolls/resources, expedition/interlude rules represented by the app | Tactical semantics by analogy |
| **S6 — Extraction & Catalogs** | PDF identity, reproducible extraction, generated catalogs, source IDs, parsing, byte-for-byte evidence | Declaring parsed prose executable |
| **S7 — Multiplayer & Persistence** | Protocol schemas, authority/authentication, room ownership, revisions, redaction, checkpoints, Supabase migrations/adapters | Reimplementing encounter rules on server or database |
| **S8 — Frontend & VTT UX** | React surfaces, interaction flows, read models, presentation, local lab UX, tactical viewport | Independent targeting/damage/movement/rules calculations |
| **S9 — Verification & Documentation** | Audits, generated status docs, blocker census, phase gates, CI/release checks, current-state documentation | Overriding source or implementation to satisfy documentation |

### Dispatch rules

- **Exact rule meaning unclear:** S1 leads.
- **Missing reusable capability:** S2 leads; S4 joins when timing/state/replay is
  involved.
- **Named source unit can already be expressed exactly:** S3 leads, with S1
  checking source fidelity.
- **Encounter ordering/lifecycle/event semantics change:** S4 leads.
- **Character creation/advancement/narrative behavior changes:** S5 leads.
- **PDF extraction/catalog/source identity changes:** S6 leads.
- **WebSocket/server/checkpoint/database authority changes:** S7 leads; S4 joins
  if encounter semantics cross the boundary.
- **Presentation or interaction only:** S8 leads.
- **Audit/status/phase-gate/generated-doc work:** S9 leads, with the affected
  domain specialization responsible for the underlying claim.

If a task crosses several boundaries, do not solve it in the first layer that
can technically host code. Put each semantic responsibility in its owning
specialization.

---

## 6. Mandatory Handoffs and Stop Conditions

### Content → substrate handoff

If a named source unit needs a mechanic the shared engine cannot express:

1. stop source-unit wiring;
2. identify the minimum reusable capability;
3. record/update the blocker;
4. implement the shared capability under S2/S4 if the task permits it;
5. only then return to S3 promotion.

Do not bury the missing capability in a source-specific callback.

### UI/server → rules handoff

If UI or transport needs a value that is semantically derived by the game:
expose/project it from rules authority. Do not recompute it independently.

### Source conflict handoff

If two authoritative passages genuinely conflict, do not silently pick one.
Create or update an adopted adjudication and link the affected fidelity
obligation before executable use.

### Phase/tranche restrictions

Current planning documents may intentionally forbid source-unit promotion while
substrate work is underway. Honor the live gate in `docs/roadmap.md`,
`docs/underlay-completion-plan.md`, and `TODO.md`. Do not copy temporary gate
facts into this file.

---

## 7. Source IDs and Persistent Identity

Source IDs are content identity, not behavior switches.

Never put source-ID/name branches in primitives or kernels:

```ts
// forbidden
if (sourceId === "some-job:some-ability:talent:1") { ... }
```

Persisted player-selectable IDs are compatibility contracts. Display labels are
not identities. Renaming/removing/reusing a released ID requires an explicit
schema migration; do not guess legacy values during migration.

Parser recognition, catalog presence, and selectable identity do not imply
executable automation.

---

## 8. Coverage and Fidelity

Coverage is conservative and computed.

Do not count as executable:

- parser recognition;
- prose extraction;
- documentation/table-facing handling;
- recipe registration without complete semantics;
- positive tests that omit known clauses;
- unsupported clauses hidden behind generic programs.

A source unit is executable only when every mechanical clause the engine claims
to automate is represented.

The blocker census is a live dependency graph. Treat blocker sets as conjunctive
minimal sets. After a reusable capability lands, regenerate the census before
using any old marginal-unlock or greedy ordering.

Strong source-fidelity labels are computed from the evidence graph in
`src/rules/fidelity/`. Never assert them manually.

---

## 9. Testing Standard

Tests should prove semantic claims, not file existence.

For newly executable source-backed behavior, prefer:

1. exact source-backed fixture;
2. positive execution case;
3. meaningful negative/boundary case;
4. choice/tie case where applicable;
5. replay case when state, randomness, timing, or continuation is involved;
6. integration case when authority crosses engine/transport/persistence.

A regression test should fail for the semantic bug it claims to prevent.

---

## 10. Verification Matrix

Use the matching `SKILLS.md` procedure for targeted checks. For cross-boundary
rules work, default to the full suite:

```sh
npm run audit:architecture
npm run audit:automation
npm run audit:source-fidelity -- --strict
npm run typecheck
npm test
npm run build
git diff --check
```

When Class/Job executable coverage may change, also run:

```sh
npm run audit:class-job-census
```

Additional task-class checks:

- source extraction/regeneration: `npm run verify:source-artifacts` and, with
  the source PDF available, `npm run verify:extraction`;
- server/protocol changes: `npm run test:e2e:transport`;
- shared VTT/client-server changes: `npm run test:e2e:browser` or
  `npm run test:e2e` as appropriate.

Documentation-only work does not require pretending to have verified runtime
semantics, but generated docs must be regenerated by their owning command and
`git diff --check` must pass.

Do not report success while relevant introduced failures remain.

---

## 11. Documentation Discipline

Prefer current-state documentation over implementation diaries.

Key live documents include:

- `TODO.md` — actionable backlog;
- `docs/roadmap.md` — sequencing and phase gates;
- `docs/deliverables.md` — concrete closure slices;
- `docs/rules-foundations.md` — foundation maturity and architecture debt;
- `docs/generic-underlays.md` — reusable semantic ontology/design test;
- `docs/underlay-completion-plan.md` — current substrate execution plan;
- `docs/rules-coverage.md` — capability/content coverage;
- `docs/blocker-census.md` — generated Class/Job blocker census;
- `docs/source-fidelity.md` — generated fidelity status;
- `docs/source-adjudications.md` — genuine source contradictions;
- `docs/glossary-executable-inventory.md` — combat glossary status.

Never hand-edit generated status files when a generator owns them.

Delete stale claims instead of accumulating contradictory prose.

---

## 12. Phase Gates and Infrastructure

`#/lab` is deliberately a browser-local/public human-test surface and is
phase-exempt.

`#/vtt/:encounterId` is the authoritative/shared VTT and remains phase-gated.
Do not weaken production gates to make development easier; use lab/test
surfaces.

Current infrastructure responsibility remains:

- GitHub Pages — static client;
- Supabase — auth and durable/versioned application data;
- Render — authoritative realtime room/server authority.

Durable VTT checkpoints store the current authoritative room-state projection,
not a second replay/event-log archive. Replay remains runtime/transport
concern unless the architecture is deliberately changed.

---

## 13. Hotspots and Refactoring

Large files are not automatically architectural defects.

In particular, do not refactor a hotspot merely because it is large. Extract
only along a demonstrated reusable semantic seam, with behavior-preserving
tests before and after.

Avoid opportunistic refactors unrelated to the requested task.

---

## 14. Prohibited Patterns

Do not:

- approximate ICON rules to improve coverage;
- infer tactical rules from narrative rules, or vice versa, without source
  authority;
- branch on source IDs/names in generic code;
- add arbitrary callbacks as a rules escape hatch;
- create parallel targeting, movement, damage, save, condition, lifecycle, or
  replay systems;
- invent a tie-break or default where the source grants a choice;
- mark partially supported units complete;
- reroll or re-decide during replay;
- make UI/server/database code a second rules authority;
- weaken phase gates silently;
- hand-edit generated coverage/fidelity documents;
- follow a stale blocker census after implementation changes;
- mass-produce bespoke resolvers because a blocker label looks unique;
- claim completion without running the relevant verification.

---

## 15. When Uncertain

When exact source semantics and current engine capability disagree:

1. preserve source semantics;
2. preserve architectural invariants;
3. fail closed rather than guess;
4. leave the source unit unresolved;
5. identify the smallest missing reusable capability;
6. update the blocker/fidelity classification as appropriate;
7. report the boundary clearly.

**Correctly unresolved is better than incorrectly executable.**