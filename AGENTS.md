# AGENTS.md

# ICON Repository Agent Instructions

This repository implements the ICON 1.5 rules engine, character-management
surface, and rules-driven VTT.

The rules engine is the authority. UI/VTT code consumes the engine; it must not
reimplement game rules independently.

Read this file before making changes.

---

## 0. Commit Directive

After every change, propose a detailed commit message, up to a paragraph.

---

## 1. Project Direction

The project is rules-first.

Phase 1 is complete only when the rules engine can represent and validate the
ICON content required for encounters. Completing the character-sheet UI alone
is not sufficient.

The VTT is a consumer and test harness for the rules engine, not an independent
rules implementation.

Broad architecture:

    source content
        ↓
      content
        ↓
      kernels
        ↓
    primitives

Preserve this direction.

Do not introduce reverse dependencies.

---

## 2. Architecture Boundary

The intended dependency direction is:

    content → kernels → primitives

### primitives/

Primitives contain:

- source-ID-free vocabulary;
- pure calculations;
- generic builders;
- generic state-transition structures.

Primitives must not know about named ICON abilities, Jobs, Classes, foes,
relics, trophies, or source IDs.

### kernels/

Kernels contain:

- shared reusable mechanics;
- reusable registries;
- common execution folds;
- generic timing/lifecycle machinery.

Kernels must remain source-ID-free in their behavior.

A content-owned provenance/source string may be carried opaquely where required
for audit/replay, but kernels must never branch on or interpret source IDs.

### content/

Content contains:

- exact source-ID keyed recipes;
- source-specific declarative rows;
- registration glue;
- source-backed parameterization of generic mechanics.

Source-specific knowledge belongs here.

Do not move generic mechanics into content merely because only one current
source unit uses them.

---

## 3. Rules Authority

ICON source text is semantic authority.

Implementation code is execution authority.

Automation audits are coverage authority.

Documentation is not execution authority.

Never change implementation merely to make stale documentation correct.
Update the documentation instead.

Never mark a source unit executable because part of its rules text works.

A source unit is executable only when its COMPLETE mechanical semantics that
the engine claims to automate are represented.

If exact semantics cannot currently be expressed:

- leave the source unit unresolved;
- identify the minimum missing reusable capability;
- document the blocker;
- do not approximate the source rule merely to improve coverage.

---

## 4. Source IDs and Bespoke Logic

Do not put source-ID branches into primitives or kernels.

Bad:

    if (sourceId === "some-job:some-ability:talent:1") ...

Bad:

    switch (abilityName) ...

Prefer:

    content row
        → typed reusable recipe
        → generic kernel
        → primitive mutations

Do not create a per-content resolver solely to increase audit coverage.

A source-specific resolver is a last resort, not the default solution.

Before declaring a rule irreducibly source-specific, look for reusable modifier
families such as:

- timing override;
- range override;
- area/shape override;
- target-count override;
- damage modifier;
- repeat/effect-count modifier;
- movement modifier;
- interrupt-rank override;
- action-cost/type override;
- duration modifier;
- condition modifier;
- resource-cost modifier;
- trigger-threshold modifier.

Treat "irreducible" as:

    not yet decomposed into the current reusable vocabulary

unless genuinely demonstrated otherwise.

---

## 5. Existing Recipe Builders

Existing content recipe systems may use bounded `build` functions that emit
typed `RuleMutation[]`.

The existence of a build callback is not itself an architectural violation.

However, do not use `build` as a generic escape hatch.

Content builders should primarily:

- select source-defined targets;
- supply source-defined constants;
- construct existing typed mutations;
- perform trivial parameterization.

If multiple rows repeat meaningful rules algorithms such as:

- spatial selection;
- free-cell calculation;
- area geometry;
- placement rules;
- state-machine logic;
- lifecycle calculations;
- targeting authority;

prefer extracting the repeated source-independent logic into a shared helper,
kernel, or primitive.

Do not duplicate rules authority across content rows.

---

## 6. Determinism and Replay

Encounter execution must remain deterministic under replay.

Random results must be recorded once and replayed, not rerolled.

Player choices that affect execution must be represented durably where required.

Do not create:

- hidden second RNG paths;
- replay-only rule implementations;
- callbacks that rerun random decisions;
- state transitions dependent on unrecorded ambient state.

When adding a mechanic with randomness or meaningful branching, test replay.

---

## 7. Encounter Semantics

Shared encounter authority must be reused rather than bypassed.

In particular, use existing shared systems for:

- targeting;
- range;
- line of sight / line of effect;
- areas;
- movement;
- damage;
- conditions;
- saves;
- resources;
- lifecycle;
- triggers;
- defeat;
- replay.

Do not reproduce these calculations locally in an ability unless the existing
shared abstraction genuinely cannot represent the source rule.

`src/rules/encounter.ts` is already a major architectural hotspot.

Do not refactor it merely because it is large.

Extract code only along real reusable mechanic seams.

---

## 8. Movement Entry

Movement-entry triggers currently cover voluntary MOVE/DASH entry.

The source text for Party Favor and Symphony uses unqualified "enters", so
forced-movement entry remains an incomplete semantic boundary unless/until the
generic forced-movement fold is implemented.

Do not describe this boundary as source-complete.

One-shot movement-entry triggers must not fire twice when the same consumed
trigger cell is re-entered during one movement.

Distinct trigger sources must remain independently capable of firing.

---

## 9. Coverage and Blocker Census

The Class/Job blocker census is a live dependency graph.

Do not treat a previous census report as permanent truth after implementation
changes.

For unresolved source units, use conjunctive blocker sets:

    {
      sourceId,
      kind,
      blockers: [...]
    }

A blocker set represents the complete MINIMAL SET of missing reusable
capabilities required before that source unit can become executable.

Do not say a primitive "unlocks" a unit merely because the unit mentions that
mechanic.

A unit becomes executable only when its entire blocker set is empty.

After implementing a reusable Class/Job primitive:

1. promote exact source units whose complete semantics are now representable;
2. harvest compound units whose last blocker was removed;
3. run verification;
4. regenerate the canonical blocker census from the updated repository;
5. recompute marginal unlocks and greedy ordering;
6. choose the next primitive from the NEW census.

Never blindly follow a stale greedy order.

---

## 10. Coverage Accounting

Coverage must remain conservative.

Do not count:

- parser recognition;
- prose extraction;
- manual/table-facing documentation;
- partial implementations;
- unsupported clauses hidden behind generic programs;

as executable automation.

The automation audit is authoritative for current executable coverage.

Any expected audit delta must be reconciled with exact source IDs.

If a task expects +20 but only +14 source units are genuinely complete, +14 is
the correct result.

Never distort semantics to hit the expected number.

---

## 11. Tests

For newly executable source-backed mechanics, prefer:

- exact source fixture;
- positive execution test;
- meaningful negative/boundary case;
- replay test when state/randomness/timing is involved.

Regression tests should establish the actual semantic claim being made.

Tests must not merely assert that a recipe exists.

Where a source unit becomes audit-complete, ensure the tests justify that
authority.

---

## 12. Architecture Audit

The repository has an architecture audit enforcing dependency direction.

Do not bypass it.

Run after architectural changes:

    npm run audit:architecture

If the audit rejects a dependency, first assume the dependency is wrong rather
than weakening the audit.

---

## 13. Standard Verification

Unless the task is explicitly documentation-only, finish with:

    npm run audit:architecture
    npm run audit:automation
    npm run audit:source-fidelity -- --strict
    npm run typecheck
    npm test
    npm run build
    git diff --check

If the canonical Class/Job census command exists, also run:

    npm run audit:class-job-census

Do not report success while relevant introduced failures remain.

### Source-fidelity audit (strict)

The strict semantic audit (`npm run audit:source-fidelity -- --strict`)
derives capability/closure status from an evidence graph in
`src/rules/fidelity/`: atomic source obligations (stable IDs + SHA-256
passage fingerprints) → explicit disposition → typed consumer registration →
independent semantic contract → statically verified proof records → computed
status. Its rules:

- Passing implementation tests are NOT evidence of source fidelity on their
  own; a claim of deterministic execution requires a registered consumer,
  an independent contract, and the proof kinds its contract class demands.
- `unclassified` never counts as supported. A newly relevant obligation must
  be classified before any scope containing it can close.
- Source conflicts are executable only through an ADOPTED adjudication in
  `src/rules/source-adjudications.ts`, linked from the obligation.
- Strong status labels are COMPUTED, never asserted. Documentation may not
  claim CLOSED/COMPLETE/AUTHORITATIVE for a registered scope beyond the
  computed status; `docs/source-fidelity.md` is GENERATED and must be
  regenerated (`npm run audit:source-fidelity -- --write`) whenever evidence
  changes.
- Legitimate incompleteness lowers status; it does not fail the build.
  INCONSISTENT CLAIMS OF COMPLETENESS (executable without consumer, proven
  without required proof, conflict without adjudication, dangling references,
  doc/status mismatch) DO fail strict mode.
- To promote content: decompose source text into curated obligations in
  `src/rules/fidelity/world.ts`, classify them, register the consumer, write
  the independent contract, and record real proof. Never auto-promote from
  allowlists or compilation results.

---

## 14. Worktree Discipline

Before editing:

    git status
    git diff

Preserve unrelated user or agent changes.

Do not reset, discard, or rewrite unrelated worktree changes.

Avoid opportunistic refactors unrelated to the task.

Keep diffs narrowly aligned with the requested mechanic.

---

## 15. Documentation

Update documentation when behavior, coverage, blocker state, or architectural
boundaries change.

Prefer current-state documentation over implementation diaries.

Delete stale claims rather than accumulating contradictory historical prose.

Important documentation includes:

- TODO.md — currently actionable backlog
- docs/roadmap.md — phase sequencing, priorities, and gate definitions
- docs/deliverables.md — concrete artifacts and encounter-closure slices
- docs/rules-foundations.md — foundation maturity, missing kernels/primitives,
  architecture-debt ledger
- docs/rules-coverage.md — content coverage by capability ladder
- docs/blocker-census.md — GENERATED Class/Job census
  (`npm run audit:class-job-census`; never hand-edit)
- docs/source-fidelity.md — GENERATED canonical source-fidelity status
  (`npm run audit:source-fidelity -- --write`; never hand-edit)
- docs/source-adjudications.md — genuine source contradictions only
- docs/glossary-executable-inventory.md — per-term combat-glossary status

Do not change phase gates, schemas, or implementation solely to make a document
easier to update.

---

## 16. Phase Gates

`#/lab` is deliberately a local/public human-test surface and is phase-exempt.

`#/vtt/:encounterId` is the authoritative/shared VTT and remains phase-gated.

Do not weaken production VTT gates to make testing easier.

Use the lab/test surfaces instead.

---

## 17. Infrastructure Direction

Current intended deployment responsibilities:

- GitHub Pages: static TypeScript frontend;
- Supabase: persistent/versioned character and checkpoint data;
- Render: live tabletop/server authority and save breakpoints.

Persistence rule: VTT/Supabase checkpoints store only the current authoritative
room state. They must not include the encounter replay/event log or duplicate
replay archive; replay remains a runtime/transport concern and is never part of
the durable checkpoint payload. Any future persistence adapter must apply the
same current-state projection before serialization.

Do not casually collapse these responsibilities into a different architecture.

---

## 18. Agent Task Strategy

Prefer:

    one reusable primitive
    → exact consumer harvest
    → adversarial review
    → full verification
    → census regeneration

over:

    large batch of unrelated mechanics

For bulk conversion tasks:

- use existing architecture;
- stop when the architecture no longer expresses exact semantics;
- report the missing reusable capability rather than inventing a local workaround.

For foundational mechanics:

- inspect exact source first;
- design the smallest general representation;
- implement one or a few representative consumers;
- verify replay/boundaries;
- only then harvest broadly.

---

## 19. Things Agents Must Not Do

Do not:

- approximate ICON rules to improve coverage;
- infer rules from names when source text is available;
- create source-ID switches in generic code;
- introduce arbitrary callback escape hatches;
- create parallel damage/targeting/movement/condition systems;
- mark partially supported source units complete;
- reroll during replay;
- silently weaken phase gates;
- rewrite unrelated architecture;
- treat documentation counts as more authoritative than audits;
- treat old blocker censuses as current after code changes;
- implement hundreds of bespoke resolvers because a census says
  "irreducible";
- claim completion without running the relevant verification suite.

---

## 20. When Uncertain

If exact source semantics and current engine capability disagree:

1. preserve source semantics;
2. preserve architectural invariants;
3. leave the source unit unresolved;
4. identify the smallest missing reusable capability;
5. add or update the blocker classification;
6. report the boundary clearly.

Correctly unresolved is better than incorrectly executable.