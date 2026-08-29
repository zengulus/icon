# SKILLS.md

# ICON Agent Task Playbooks

`AGENTS.md` defines stable repository law. This file defines repeatable task
procedures.

For every task:

1. choose one lead specialization from `AGENTS.md`;
2. invoke the smallest matching skill(s) below;
3. read the listed current-state docs/code before editing;
4. stop at the stated boundary instead of inventing a workaround;
5. run the skill's verification plus any stricter checks required by a second
   skill.

Skills compose. A source-backed ability that exposes a missing delayed-choice
mechanic, for example, begins with **SK-01 Source Rule Analysis**, hands off to
**SK-02 Reusable Rules Capability** and **SK-04 Encounter Timing/Replay**, then
returns to **SK-03 Source Unit Promotion** only after the shared capability is
ready and current phase gates permit promotion.

---

## SK-01 — Source Rule Analysis

**Lead:** S1 Source & Fidelity

**Use when:** interpreting a rule, resolving ambiguity, scoping an
implementation, writing a blocker, or reviewing whether existing behavior is
source-correct.

### Read first

- the exact passage in `ICON 1.5.pdf`;
- nearby definitions and glossary entries referenced by the passage;
- relevant extracted catalog row(s);
- `docs/source-adjudications.md`;
- `docs/rules-foundations.md` and `docs/generic-underlays.md` if implementation
  shape is in question.

### Procedure

1. Identify the exact source unit and stable source ID, if one exists.
2. Read the entire mechanical text, not only the sentence that triggered the
   task.
3. Expand referenced glossary terms and global rules.
4. Decompose the rule into atomic semantic clauses. Check explicitly for:
   - actor roles: user/owner/controller/chooser/payer/target/recipient;
   - trigger and timing window;
   - effect/interrupt ordering;
   - required vs `may`/`can` optional behavior;
   - candidate query vs player choice;
   - ties and who resolves them;
   - range, adjacency, area, anchor, LoS and LoE;
   - movement/placement/teleport/shove semantics;
   - action/resource/usage cost;
   - attack/save/damage/armor/resistance order;
   - status, mark, stance, terrain, object/summon effects;
   - duration/scope and lifecycle cleanup;
   - defeat, immunity, intangibility, or other global exceptions;
   - delayed state that must be live vs captured;
   - randomness/choice facts that replay must preserve.
5. Separate deterministic engine semantics from player choice, GM-facing
   judgment, descriptive text, and table-facing text.
6. Compare the full clause set to current engine capability.
7. If passages genuinely conflict, use an adopted source adjudication; do not
   resolve the conflict silently in code.
8. Produce one of three outcomes:
   - exact behavior already expressible;
   - exact behavior requires a named reusable capability;
   - behavior is intentionally non-executable/table-facing.

### Output contract

A source analysis should be able to answer:

> What exactly must happen, who decides it, when does it happen, what shared
> authority owns each clause, and what remains unresolved?

### Stop conditions

Stop and hand off to SK-02/SK-04 when a shared capability is missing. Do not
encode the missing semantics inside content merely to continue.

---

## SK-02 — Add or Extend a Reusable Rules Capability

**Lead:** S2 Rules Substrate

**Secondary:** S4 Encounter Runtime & Replay when state/timing is involved

**Use when:** adding an underlay operation, primitive, kernel, domain-authority
query point, or removing duplicate semantic authority.

### Read first

- `docs/generic-underlays.md`;
- `docs/underlay-completion-plan.md`;
- the relevant section of `docs/rules-foundations.md`;
- existing primitive/kernel/domain authority and tests;
- exact source examples that motivate the capability.

### Procedure

1. State the missing semantic operation without any source ID or named ability.
2. Apply the `generic-underlays.md` design test in order. Prefer an extension of
   U1–U17 or an existing domain authority over a new top-level abstraction.
3. Identify every current duplicate implementation of that semantic operation.
4. Define the smallest typed vocabulary that can express the source-backed
   cases without becoming a universal DSL.
5. Decide which layer owns it:
   - primitive for vocabulary/pure semantics;
   - kernel for reusable execution/composition;
   - domain authority for game-system-specific rules;
   - structural subsystem only when the state model genuinely requires one.
6. Keep behavior source-ID-free.
7. Preserve fail-closed behavior. Missing required references/choices/roles are
   errors, not defaults.
8. For stateful behavior, specify recording/replay semantics before coding.
9. Add focused tests for the generic capability itself.
10. Migrate duplicate callers behavior-preservingly where the task permits.
11. If the current underlay/tranche plan forbids source promotion, stop after
    substrate + migration. Do not harvest content early.
12. Update foundation/architecture-debt docs to reflect actual maturity.

### Required tests

At minimum:

- positive generic case;
- invalid/missing-input case;
- boundary/tie case;
- source-ID independence;
- replay test for stateful/random/timed capability;
- behavior-preserving tests for migrated consumers.

Then run the full rules verification from `AGENTS.md`.

### Stop conditions

Do not create a new source-specific resolver when the general operation is
still undefined. Do not promote a new underlay merely because one prose clause
is awkward.

---

## SK-03 — Promote a Named Source Unit to Executable

**Lead:** S3 Content Automation

**Secondary:** S1 Source & Fidelity

**Use when:** implementing a Job/Class ability, talent, mastery, Relic, foe
ability/trait, or other exact source-ID keyed unit using existing shared
mechanics.

### Read first

- SK-01 source analysis for the exact unit;
- current extracted content row;
- relevant content recipe/registry;
- relevant kernel/domain authorities;
- `docs/blocker-census.md` and `docs/rules-coverage.md`;
- live phase/tranche restrictions.

### Procedure

1. Confirm promotion is allowed by the current phase plan.
2. Enumerate **all** mechanical clauses of the unit.
3. Confirm every clause maps to an existing exact shared capability.
4. Implement the content recipe using source-defined constants, targets, and
   typed operations only.
5. Do not duplicate query, geometry, targeting, movement, damage, lifecycle, or
   choice logic in the recipe.
6. Preserve explicit optionality and player choice.
7. Register the consumer through the established content registry.
8. Add source-backed tests that prove the complete semantic claim.
9. Add/update fidelity consumer, contract, obligation disposition, and proof
   records as required by the fidelity system.
10. Run audits.
11. Regenerate blocker census if Class/Job coverage changed.
12. Recompute current unlock state from the new census; never quote old greedy
    numbers.

### Required tests

- exact source fixture;
- positive execution;
- negative/boundary case for each meaningful gate;
- choice/tie case if applicable;
- replay fixture for any stateful/random/timed behavior.

### Stop conditions

If even one mechanical clause is not exactly representable, do **not** mark the
unit executable. Record the minimal blocker set and hand off to SK-02/SK-04.

---

## SK-04 — Encounter Timing, Lifecycle, Windows, and Replay

**Lead:** S4 Encounter Runtime & Replay

**Use when:** changing turn/round scheduling, trigger order, interrupts,
continuations, delayed effects, movement-entry reactions, defeat cleanup,
usage resets, persistent instances, or event/replay semantics.

### Read first

- exact ICON timing/global-rule passages;
- `src/rules/encounter.ts` and the relevant automation kernels;
- scheduler/lifecycle/trigger/window/continuation code;
- `docs/rules-foundations.md`;
- current tests and replay fixtures.

### Procedure

1. Write the event timeline before changing code: command → validation → choice
   or RNG → mutation/effect → trigger/window → event recording → replay.
2. Identify the owning temporal boundary precisely: action, ability, turn start,
   turn end, round start/end, slow turn, combat, expedition, etc.
3. Distinguish trigger detection from decision ownership from effect
   application.
4. Apply source-defined ordering; never rely on incidental array iteration.
5. Decide what must be recorded as durable fact versus recomputed from current
   state.
6. Make replay consume recorded decisions/results only.
7. Preserve one-shot/usage semantics across repeated entry or repeated
   evaluation.
8. Test simultaneous/competing triggers and defeat/cleanup boundaries where
   relevant.
9. If network clients can answer a decision window, ensure the semantic chooser
   is represented independently of socket/session identity; SK-09 joins.

### Required tests

- ordering test;
- same-trigger/tie test;
- cleanup/reset boundary;
- duplicate-fire prevention where applicable;
- replay equality;
- transport integration if a remote decision is involved.

Run the full rules verification.

---

## SK-05 — Character, Advancement, and Narrative Rules

**Lead:** S5 Character & Narrative

**Use when:** changing character creation, canonical selection IDs,
advancement/AP/mastery/relic slots, Bonds/action ratings, narrative rolls,
Effort/Strain/Burdens, gear, camps, expeditions, interludes, or narrative
persistence.

### Read first

- exact Book of Tales / Book of Adventure passages;
- `src/rules/character.ts`, `player-creation.ts`, catalogs, and relevant tests;
- character schema/migration code;
- `docs/rules-foundations.md` identity contract.

### Procedure

1. Confirm whether the behavior is narrative, tactical character progression,
   or shared identity. Do not borrow rules across modes by analogy.
2. Use canonical stable IDs internally and in persistence; labels are display
   data.
3. Express validation centrally in rules code, not separately in forms.
4. Preserve migration compatibility for released schema values.
5. Unknown legacy values must fail/decline migration rather than be guessed.
6. If changing level/AP/talent/mastery/relic limits, test boundary levels and
   cross-chapter constraints.
7. If changing narrative dice, test zero-rating, boon/curse cap/cancellation,
   critical behavior, and affected resource rules as applicable.
8. UI validation should consume engine validation/projections rather than clone
   it.

### Required tests

- valid case;
- invalid boundary;
- persisted-ID round trip;
- migration fixture if schema changes;
- UI projection test if player-facing selections change.

Use full rules verification when game semantics change; use SK-08/09 checks for
cross-layer changes.

---

## SK-06 — Foe Systems and Structural Tactical Subsystems

**Lead:** S3 Content Automation or S4 Encounter Runtime, depending on scope

**Use when:** implementing foe classes/roles, Mobs, Elites, Legends, phases,
Round Actions, faction traits, summons/entities, or other foe-specific state
models.

### Read first

- Book of Foes global rules plus the exact faction/profile text;
- `src/rules/foes.ts`;
- `src/rules/automation/content/foes/`;
- shared role/entity/lifecycle/scheduler kernels;
- `docs/generic-underlays.md` Part C structural subsystems;
- current roadmap/deliverables.

### Procedure

1. Separate global foe-role semantics from individual profile content.
2. Put reusable role/state-machine behavior in shared runtime/substrate, not in
   individual foe recipes.
3. Preserve special large-foe, open-information, phase, turn-entitlement, and
   defeat semantics where relevant.
4. Model structural state explicitly when the source genuinely requires it
   (e.g. aggregate/mob membership or phase state), rather than simulating it
   with unrelated statuses.
5. Individual foe abilities then compose shared behavior through content rows.
6. Test scheduler entitlements and lifecycle transitions separately from one
   named foe's content.
7. Add exact source-backed tests for promoted profiles/abilities.

### Stop conditions

Do not fake a missing structural subsystem with per-foe conditionals.

---

## SK-07 — PDF Extraction and Generated Catalogs

**Lead:** S6 Extraction & Catalogs

**Use when:** changing PDF parsing, source manifests, generated compendium,
mechanics/foe/reward extraction, source IDs, or source-artifact evidence.

### Read first

- `README.md` source-extraction section;
- extraction scripts in `scripts/`;
- source artifact verification code;
- pinned source identity/digests;
- exact PDF pages affected.

### Procedure

1. Verify the local PDF is the intended pinned source before regeneration.
2. Distinguish parser changes from semantic implementation changes.
3. Keep source identity/stable IDs deterministic.
4. Regenerate into the normal generated artifacts only after reviewing the
   parser/source change.
5. Compare generated outputs deliberately; do not accept broad churn without
   explaining it.
6. Update pinned artifact evidence only for intentional reviewed changes.
7. Never turn parser recognition into an executable-coverage claim.
8. If a released persisted source ID would change, hand off to SK-05 for an
   explicit compatibility migration.

### Required verification

```sh
npm run verify:source-artifacts
npm run verify:extraction
npm run extract:rules   # only when intentional regeneration is required
npm test
npm run audit:automation
npm run audit:source-fidelity -- --strict
git diff --check
```

`verify:extraction` requires the supplied source PDF locally.

---

## SK-08 — Source-Fidelity Evidence and Coverage Audits

**Lead:** S1 Source & Fidelity or S9 Verification & Documentation

**Use when:** adding obligations, dispositions, consumers, semantic contracts,
proof records, adjudications, audit rules, or changing strong coverage claims.

### Read first

- `src/rules/fidelity/`;
- `docs/source-fidelity.md` generation path;
- `docs/rules-foundations.md` fidelity section;
- exact source passage and implementation consumer;
- audit tests, including mutation-resistance fixtures.

### Procedure

1. Decompose the exact source obligation at the correct semantic grain.
2. Give it stable identity and passage provenance/fingerprint.
3. Classify disposition explicitly. `unclassified` is not support.
4. Register the real execution consumer.
5. Write an independent semantic contract; do not restate implementation code
   as the contract.
6. Record proof kinds actually demonstrated by tests.
7. For conflicts, require an adopted adjudication before executable use.
8. Run strict audit and regenerate generated fidelity docs with the owning
   command.
9. Do not hand-raise status labels.

### Required verification

```sh
npm run audit:source-fidelity -- --strict
npm run audit:source-fidelity -- --write
npm run audit:source-fidelity -- --strict
npm test
git diff --check
```

If executable automation changed, also run architecture/automation/census as
applicable.

---

## SK-09 — Multiplayer Protocol, Authority, and Checkpoints

**Lead:** S7 Multiplayer & Persistence

**Secondary:** S4 Encounter Runtime & Replay for encounter semantics

**Use when:** changing websocket commands, protocol schemas, authentication,
room roles/ownership, optimistic revision handling, redaction, save
acknowledgements, checkpoint serialization/recovery, or realtime service
behavior.

### Read first

- `src/rules/protocol.ts`;
- `server/rooms.ts`, `server/checkpoints.ts`, server tests;
- `src/vtt/session.ts` / persistence adapter;
- Supabase migrations if durable shape changes;
- README deployment/authority model.

### Procedure

1. Identify the authority boundary: client request, server validation, rules
   command, resulting authoritative state/events, checkpoint projection.
2. Keep rules execution shared with the engine; the server validates authority
   and transports commands, not a second combat implementation.
3. Validate actor ownership/role/chooser semantics server-side.
4. Preserve optimistic revision checks and fail stale writes safely.
5. Redact only at presentation/transport projection; never mutate authoritative
   room state to hide information.
6. Checkpoint only the approved current-state projection. Do not persist a
   duplicate encounter replay log in checkpoint payloads.
7. Recovery from corrupt/stale checkpoints must preserve monotonic authority.
8. Protocol additions require schema tests and client/server parity.
9. Secrets remain server-side.

### Required verification

```sh
npm run typecheck
npm test
npm run test:e2e:transport
npm run build
git diff --check
```

If the client protocol/UI changes too, run `npm run test:e2e:browser` or full
`npm run test:e2e`.

---

## SK-10 — Database or Persisted Schema Migration

**Lead:** S7 Multiplayer & Persistence

**Secondary:** S5 for character schema; S4 for VTT state shape

**Use when:** changing Supabase schema, character JSON schema, room checkpoint
shape, or other durable versioned data.

### Procedure

1. Identify the compatibility contract and all readers/writers.
2. Prefer additive migration; never reinterpret existing stable IDs silently.
3. Write explicit migration code/SQL with a defined old → new mapping.
4. Unknown/ambiguous legacy data must fail safely rather than be guessed.
5. Preserve RLS/authority boundaries for Supabase changes.
6. For checkpoint changes, update projection/version validation and recovery
   tests together.
7. Add round-trip tests for old and new representations.
8. Document operational migration steps if deployment order matters.

### Required verification

Use SK-05 or SK-09 verification depending on the persisted domain, plus full
build and `git diff --check`.

---

## SK-11 — Frontend or VTT Interaction Change

**Lead:** S8 Frontend & VTT UX

**Use when:** changing React pages/components, tactical viewport interaction,
forms, presentation, lab UX, compendium UI, or read-model projection without
changing game semantics.

### Read first

- the engine API/projection being consumed;
- existing page/component and VTT tests;
- relevant phase gate (`#/lab` vs shared `#/vtt/:encounterId`).

### Procedure

1. State explicitly whether the change is presentation-only.
2. Consume rules-owned legality/derived values rather than duplicating them in
   React or VTT geometry helpers.
3. Keep `#/lab` phase-exempt behavior separate from authoritative shared-room
   behavior.
4. Do not bypass production VTT gates for convenience.
5. Preserve accessibility and clear invalid-state feedback.
6. If UI discovers missing semantic information, add a rules/read-model
   projection under the owning specialization instead of calculating it in the
   component.

### Required verification

```sh
npm run typecheck
npm test
npm run build
git diff --check
```

Run browser E2E when route, interaction, auth, room, or authoritative VTT flows
change.

---

## SK-12 — Documentation-Only Change

**Lead:** S9 Verification & Documentation

**Use when:** updating explanatory/current-state docs without changing
execution.

### Procedure

1. Determine whether the target file is generated.
2. If generated, change its generator/evidence source and regenerate; never
   hand-edit the output.
3. Verify every strong status/count against current audits, not memory or old
   prose.
4. Prefer replacing stale current-state claims to appending an implementation
   diary.
5. Keep volatile blocker/task state in TODO/roadmap/foundation docs, not
   `AGENTS.md`.
6. Do not modify code merely to make prose easier to state.

### Verification

At minimum:

```sh
git diff --check
```

Run the owning audit/generator for any status, coverage, census, or fidelity
claim you touched.

---

## SK-13 — Blocker Census / Next-Capability Planning

**Lead:** S9 Verification & Documentation

**Secondary:** S2 Rules Substrate

**Use when:** choosing the next reusable mechanic, analyzing marginal unlocks,
or updating Class/Job blocker state.

### Procedure

1. Regenerate the canonical census from current HEAD.
2. Treat each unresolved unit's blockers as a conjunctive minimal set.
3. Verify blocker labels correspond to genuinely missing reusable capability,
   not merely words in the source text.
4. Recompute marginal unlocks/greedy ordering from the regenerated graph.
5. Apply `generic-underlays.md` design test to the apparent next family.
6. Prefer a capability that collapses duplicate semantic authority, not a
   bespoke family with attractive count.
7. Never use a stale greedy list after implementation changes.

### Verification

```sh
npm run audit:class-job-census
npm run audit:architecture
npm run audit:automation
git diff --check
```

---

## SK-14 — Refactor a Rules Hotspot

**Lead:** S2 Rules Substrate or S4 Encounter Runtime

**Use when:** extracting code from `encounter.ts`, `encounter-adapter.ts`, or
another large rules hotspot without intentionally changing semantics.

### Procedure

1. Name the semantic seam being extracted. "File is large" is not a seam.
2. Capture current behavior with focused tests before moving code.
3. Decide the single future authority and its correct architecture layer.
4. Move one coherent responsibility at a time.
5. Keep compatibility barrels/adapters as needed; avoid flag-day migrations.
6. Delete the old duplicate authority once callers migrate.
7. Require zero intentional coverage/census delta unless the task explicitly
   includes semantic work.
8. Review the diff for accidental ordering, error-precedence, or replay changes.

### Required verification

Full rules verification, plus targeted before/after tests for the extracted
seam.

---

## SK-15 — Semantic Bug Fix

**Lead:** whichever specialization owns the broken authority

**Use when:** fixing incorrect behavior rather than adding a planned feature.

### Procedure

1. Reproduce the bug in a minimal test before changing implementation.
2. Use SK-01 if source correctness is relevant.
3. Identify the **first owning authority** where behavior becomes wrong; do not
   patch a downstream symptom.
4. Check whether the bug reveals duplicate authority. If yes, route through
   SK-02/SK-14 instead of adding another conditional.
5. Fix the smallest owning layer.
6. Add a regression test that would fail on the old behavior for the actual
   semantic reason.
7. Search for sibling callers that share the same authority and may have the
   same bug.
8. Reconcile any audit/fidelity/census status affected by the correction.

### Verification

Run the relevant task skill plus the full suite for rules-semantic bugs.

---

## SK-16 — Phase Gate or Release Readiness

**Lead:** S9 Verification & Documentation

**Use when:** changing a phase gate, declaring a deliverable closed, or
preparing production authoritative VTT behavior.

### Procedure

1. Read the exact gate definition in `docs/roadmap.md` / deliverables.
2. Resolve every gate criterion to implementation plus computed audit evidence.
3. Do not equate UI availability with rules closure.
4. Confirm unresolved content is still correctly gated/table-facing.
5. Run the complete verification suite, including E2E where the authoritative
   VTT/server is involved.
6. Only then update the gate/status documentation.
7. Never weaken the gate because a test surface is needed; `#/lab` exists for
   phase-exempt testing.

### Required verification

```sh
npm run audit:architecture
npm run audit:automation
npm run audit:class-job-census
npm run audit:source-fidelity -- --strict
npm run typecheck
npm test
npm run test:e2e
npm run build
git diff --check
```

---

# Completion Report Template

For non-trivial tasks, finish with a compact report containing:

- **Lead specialization / skills used**
- **Semantic claim** — what is now true
- **Source basis** — exact source unit/passages when applicable
- **Architecture** — which authority owns the behavior
- **Coverage/fidelity delta** — exact units/status changes, or "none"
- **Known unresolved boundary** — if any
- **Verification run** — commands and result
- **Proposed commit message**

Never describe an unresolved boundary as complete merely because the requested
local code change succeeded.
