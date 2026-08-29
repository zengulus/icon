# Delivery roadmap

Derived from the full-repository audit of 2026-08-25. The previous
Phase 1/2/3 definitions were historical hypotheses; the phases below are
redefined from what the implementation actually is. Phase names are kept
where they still fit.

Phase gates are acceptance criteria, not feature lists. A phase is complete
only when every exit criterion is observably true.

---

# Product goal

A rules-first ICON 1.5 implementation in which:

1. the **rules engine** (`src/rules/`) is the sole mechanical authority,
   source-traceable, deterministic, and replay-safe;
2. the **character manager** persists versioned player characters through an
   expedition (creation → combats → attrition → camp);
3. the **tactical VTT** (local Lab first, shared realtime room second) is a
   consumer/test harness of that same engine;
4. **narrative/expedition support** automates only what ICON defines
   deterministically and leaves table judgment to humans.

The engine never automates table judgment without source justification.

# Current baseline (verified 2026-08-25)

- Source pipeline: all 501 pages extracted, digested, credited; byte-for-byte
  regeneration evidence via `npm run verify:extraction`.
- Character engine: creation, advancement, validation, import/export,
  schema v3 migration — complete.
- Encounter engine: command/event purity enforced; movement, terrain,
  attacks, damage pipeline (armor/resistance/defiance/vigor/held damage),
  saves, statuses, conditions, marks, stances, resources, interrupt windows,
  turn scheduler (explicit actor selection, Slow rounds, pending Delay) —
  authoritative with replay fixtures.
- Content: all 144 Job abilities executable with replay fixtures; Mendicant
  class traits; 56 talents; 27 Job traits; 22 foe ability recipes; 115 foe
  trait keyword rows; foe role baselines; resource registry. The current
  Step-6 mastery/talent tranche includes F1 teleport consumers, F5 mark rows,
  F6a bonus-damage rows, and the K-P5 mastery fold; the remaining Class/Job
  blocker set is regenerated in `docs/blocker-census.md`.
- Verification: unit 993 tests green; e2e green; architecture +
  automation audits green; automation audit reports 3,103 explicitly
  unsupported clauses across 16 content kinds (the honest gap).
- Settlement: `ENCOUNTER_ENDED` grants each PC +1 personal resolve; the
  `characterFromActor` projection carries HP attrition, wounds, and personal
  resolve back onto the persistent sheet (schema v4); camp/interlude sheet
  transitions exist — implemented 2026-08-25 (P1).
- Foe role entitlements: Elite two-turn and Legend per-player-character turn
  rows registered as production content (`role:elite-template`,
  `role:legend-turns`), replay-tested through the existing scheduler path —
  implemented 2026-08-26 (P2).
- NOT built: playable camp/interlude scene flow; Mob model; foe phase engine;
  Relic runtime; broad mastery/talent folds; Limit Break effects. The mastery
  surface and four mastery rows are executable; the remaining rows stay
  conservative and source-visible.

---

# Priority sequence

Each priority is executable by one coding-agent pass unless marked otherwise.
Categories: REPAIR · FOUNDATION · VERTICAL SLICE · CONTENT EXPANSION ·
INTEGRATION · POLISH.

The current step-by-step execution order across these priorities is tracked
in [`TODO.md`](../TODO.md) §Current execution plan; this document owns phase
definitions and gates, TODO.md owns live sequencing. On conflict, update both
together — never let them assert different orders.

## P1 — Combat settlement and cross-combat character continuity (REPAIR) — **DONE 2026-08-25**

**Goal.** End an encounter into a durable post-combat state that can start the
next encounter.

**Why now.** Every gameplay loop longer than one fight is impossible without
it; it is the largest correctness hole per line of code needed. Nothing else
in Phases 2–4 can be acceptance-tested without it.

**Depends on.** Nothing; existing event/reducer machinery suffices.

**Deliverables.** `ENCOUNTER_ENDED` settlement: personal Resolve +1 for each
surviving PC (p.99); durable actor→character projection (HP, wounds, spent
personal Resolve, level/chapter state); explicit statement that vigor,
statuses, marks, stances, and per-encounter resources end with combat (already
true). Camp/interlude reset functions on the character sheet as pure
validated transitions.

**Source rules.** p.99 Resolve/personal resolve; p.94 wounds & defeat; p.113
Refocus; p.56 Effort/Strain; p.107 end-of-combat cleanup.

**Acceptance tests.** Round-trip regression: create character → combat 1 (take
damage, gain wound, spend personal Resolve) → END_ENCOUNTER → project →
combat 2 starts from projected sheet; personal Resolve granted exactly once;
replay reproduces settlement exactly; purity assertions on every new path.

**Explicitly excluded.** Camp scene UX; trophies/rewards; narrative clocks.

**Agent-pass size.** MEDIUM.

## P2 — Foe role entitlements and the first closed foe-complexity slice (REPAIR + VERTICAL SLICE) — **DONE 2026-08-26** (entitlements; Slice C itself stays blocked on phases/traits)

**Goal.** Elites act twice per round; Legends act once per PC per round; one
Elite/Legend encounter executes source-correctly end to end.

**Why now.** The scheduler already supports entitlements; this is small work
unblocking all high-tier foes, and it completes Slice C except phases.

**Depends on.** Nothing (scheduler done in the stabilization pass).

**Deliverables.** Content-owned entitlement rows (elite = +1 extra turn;
legend = turns equal to live hero count, with defeated PCs counted per
p.298); census regeneration; Elite and Legend encounter fixtures.

**Source rules.** p.298 foe glossary (roles, Elite double HP/two turns,
Legend HP scaling/turns/Juggernaut).

**Acceptance tests.** Entitlement matrix through round boundaries (entitlements
refresh each round); Legend turn count tracks party size including defeated
PCs (pin the source reading or adjudicate); multi-turn scheduler tests stay
green; replay fixtures.

**Excluded.** Mob members; foe phases; new foe ability recipes beyond the
slice's needs.

**Agent-pass size.** SMALL–MEDIUM.

## P3 — Mastery fold + talent subfamilies (FOUNDATION + CONTENT EXPANSION)

**Goal.** An equipped mastery can alter its parent ability's execution; the
highest-frequency talent subfamilies promote in exact-ID slices.

**Why now.** 136 masteries + 235 talents are the two largest unresolved
player-content families; both funnel through one execution-time fold (the
bonus-damage grant family landed 2026-08-27 as F6a; the remaining talent
subfamilies follow the regenerated census).

**Depends on.** Existing talent fold (F7) and projected `talents`/
`masteredAbilityIds` surfaces (both durable).

**Deliverables.** A mastery kernel keyed off the parent program's execution
(modifier families first: range, area, damage, repeat, duration), then
exact-ID promotion waves ordered by `docs/blocker-census.json`
`blockerFrequencies`.

**Source rules.** Per-ability mastery text pp.122–236.

**Acceptance tests.** Each promoted row: source fixture + positive/negative +
replay; closed negative for unequipped mastery.

**Excluded.** Table-facing mastery choices remain documented rows.

**Agent-pass size.** MULTI-PASS (one wave per pass).

## P4 — Forced-movement & entity primitives (FOUNDATION)

**Goal.** Teleport/Place/Remove/Swap/Fly-grant as shared primitives so the
census's top blockers stop forcing per-ability resolver code.The Teleport/Place/Remove/Swap half (F1) is DONE (2026-08-27) — shared gateway,
source-declared atomic swap groups, group-scoped occupancy, and the
`{teleport}` census family cleared — leaving Fly-grant, entity-create and
terrain-create as the remaining high-fan-out blockers. The F3 audit
(2026-08-29) found the entity-creation AUTHORITY already exists
(`kernels/entity-creation.ts` `validateEntityCreation`: bounds, footprint
occupancy, impassable, LoS, footprint-distance range, summon caps) plus the
`entityMutation` builder and the `freeCellsInRange` placement helper, so
`entity-create` was NOT a missing primitive — the 16 `{entity-create}`
singletons were coarse keyword residues and were reclassified to their real
residual blockers, and a shared `summonEntity` seam was added. A corrective
pass (2026-08-29) rebuilt the seam to declare INTENT (single mutation with an
ordered candidate list + count + paired `creationSpatial`) so
`validateEntityCreation` remains the single selection authority, and fixed the
reducer so a `count>1` creation emits distinct per-cell entity ids. The
regenerated census now reports `{entity-create}` 0 immediate occurrences (the
label is fully retired — it no longer appears in any unresolved blocker set or
in the greedy simulation; compound records that carried it were re-audited and
reclassified to their precise residual semantics). A further corrective pass
(2026-08-29) rebuilt the foundation under the source's Summons/Objects/Line
rules (pp.95–108): an entity-kind registry (`summon` | `object`, never
string-name heuristics) drives summons-removed-on-owner-defeat vs
objects-survive lifecycle and object stacking under the ≤3 height ceiling
during creation validation; the seam splits placement REGION from the creator's
LoS/range authority; candidate generation is fully subordinate to
`validateEntityCreation` (no pre-filtering, no anchor-distance legality), and
the `countMode` contract ('exact' | 'up-to', cap-bounded) is explicit. All
ordinary summons now route through this seam — the warden beasts (incl. the
Apex Finishing-Blow/Charge extra beast, no more `freeCellsInRange[index]`
bypass), seer wild-cards, geomancer boulder, enochian aethershard, sealer
shrine, shade shadows, stormbender salt-sprites, and harvester thralls — while
cell-dependent exceptions (Seer Astra meteor adjacency damage, Warden Underway
portal, Fool bombs, Harvester dark-sliver, Stormbender geyser/waterspout
fallback placement) stay explicit and documented.

The F4 audit (2026-08-29) then DECOMPOSED the crowd-sourced `{fly-grant}`
label: the one-shot Fly move already exists (`flyMutation` + `plannedFly`), so
the keyword family was re-audited unit-by-unit. All 30 records (17 singletons +
13 compounds) were reclassified to precise missing-mechanics families
(`duration-fly-state`, `fly-move-timing`, `fly-move-substitution`,
`fly-multirecipient`, `fly-distance-modifier`, `fly-benefit-rider`,
`fly-or-teleport-repeat`, `once-per-round-fly-grant`, `flying-targeting`), and`stormbender:tsunami:mastery` was removed from the family entirely (it is a
non-fly action-cost + movement-distance + flying-foe-targeting mastery). The
`{fly-grant}` label is retired (0 occurrences). The genuinely-homogeneous
`fly-distance-modifier` subfamily was implemented at the existing fly authority
and `colossus:raging-wolf:talent:2` promoted (416→415). The next high-fan-out
singleton family (regenerated 2026-08-29) is now `{terrain-create}` 16
immediate (total 54).

**Why now.** Highest fan-out after P3; converts hand-rolled resolvers into
data rows.

**Depends on.** Spatial-intent gateway (exists); entity/terrain mutations
(exist per-program).

**Deliverables.** Primitive APIs + migration of existing job resolvers onto
them (behavior-preserving, proven by unchanged replay fixtures).

**Source rules.** p.104–105 movement vocabulary; per-ability clauses.

**Acceptance tests.** Behavior-preserving refactor: existing golden fixtures
unchanged; new primitive unit tests incl. Sturdy/Rampart interactions.

**Excluded.** New content promotion beyond de-duplication.

**Agent-pass size.** LARGE.

## P5 — Relic runtime (CONTENT EXPANSION)

**Goal.** Relic invokes and persistent rank effects execute authoritatively.

**Why now.** After player-content folds; relics are self-contained and
high-value for Slice B.

**Depends on.** P4 primitives for effect bodies; settlement (P1) for dust /
expedition persistence boundaries.

**Deliverables.** Typed relic-effect recipes mirroring the foe-recipe model
(data-first), starting with chapter-1 relics.

**Source rules.** pp.242–260 (relics, ranks, aspects).

**Acceptance tests.** One source-exact invoke + one persistent effect per
promoted relic, replay-verified; aspect transition tests extend the existing
character-engine coverage.

**Agent-pass size.** MULTI-PASS.

## P6 — Foe breadth via recipes; Vigilance windows; Mob model (FOUNDATION + CONTENT EXPANSION)

**Goal.** Grow executable foe abilities along the recipe factory set; make
Vigilance trigger-driven; design the member-based Mob representation.

**Why now.** Turns 1,247 unsupported foe-ability units into a data-authoring
pipeline; closes B4/B3.

**Depends on.** P4 primitives; window protocol (exists).

**Deliverables.** New recipe kinds (save riders, area riders, summons);
Vigilance guard/punish windows from real triggers; Mob member model + one Mob
encounter.

**Source rules.** pp.298–310+; p.105 Vigilance; p.298 Mob.

**Agent-pass size.** MULTI-PASS.

## P7 — Shared realtime VTT release (INTEGRATION)

**Goal.** `#/vtt/:encounterId` leaves the gate for real tables.

**Why now.** Only after the engine above it is trustworthy and settled
(P1–P2) does multiplayer have something authoritative to share.

**Depends on.** PHASE_TWO criteria below.

**Deliverables.** GM tooling parity with Lab; reconnect/session UX;
campaign invitation flow; deployment smoke tests.

**Agent-pass size.** LARGE.

## P8 — Expedition & narrative integration (INTEGRATION)

**Goal.** Camp, interlude, trophies, rewards, clocks/burdens/ambitions as
deterministic-where-source-is-deterministic flows around the tactical core.

**Depends on.** P1 settlement; P7 rooms.

**Agent-pass size.** MULTI-PASS.

---

# Phase gates

## PHASE_TWO_READY — "Rules-authoritative tactical core"

Machine/test-observable criteria (all must hold):

1. No known P0/P1 correctness defects open in `TODO.md`.
2. Command purity + exact-replay suite green (existing suites).
3. Combat settlement implemented (P1 acceptance tests).
4. Encounter closure Slices A and D pass end to end (see
   [`deliverables.md`](deliverables.md)).
5. Automation/architecture audits green; no regression in the conservative
   audit counts.
6. Full CI green.

Current state: criterion 3 now passes (settlement landed); criteria 4's Slice D
is close (Slice A closed) but Slice B/C closure and full CI re-verification of
the remaining criteria have not been earned; gate stays `false`. P2's
entitlement deliverables landed 2026-08-26 (Elite/Legend turn rows + fixtures),
removing Slice C's entitlement dependency while phases/chapter rules (B3) and
foe traits beyond keywords keep the slice itself blocked.

## PHASE_THREE_READY — "Closed local gameplay, shared authority released"

Criteria:

1. PHASE_TWO_READY true.
2. Encounter Slices B and C close end to end.
3. Local VTT covers setup, selection, Slow, targeting, movement, abilities,
   interrupts, reload/replay without UI-local mechanics decisions.
4. Multiplayer transport + browser acceptance suites green against a
   configured deployment; reconnect recovery tested.
5. No hidden-state oracle leaks in the server projection test suite.

Current state: **false** (inherits everything above plus foe/player
complexity gaps).

Gate constants have ONE machine-readable source of truth:
`src/rules/phase-gates.ts` defines each gate's requirements once, encoding
THIS document's acceptance criteria directly (machine-backed rows where a
faithful proxy exists; explicit acceptance-criterion rows — unmet by
construction — where it does not).
`src/rules/catalog.ts` derives the coverage-only telemetry constants
`PHASE_TWO_COVERAGE_READY` / `PHASE_THREE_COVERAGE_READY` from the shared
`COVERAGE_ITEM_IDS` ladder plus `RULES_COVERAGE`; that ladder is deliberately
NOT part of any gate's requirements. Anything named `PHASE_*_READY`
unqualified means the FULL gate, evaluated only by the source-fidelity claims
audit (`claim:phase-two-ready` / `claim:phase-three-ready`) binding the same
registry to recorded audit results — so no consumer can drift or be flipped by
hand while its criteria fail, and coverage readiness never admits production
multiplayer (the realtime server default-denies until the full gate's
evidence is bound to deployment configuration). CI exercises that aggregate
authority path.

`PHASE_THREE_READY` is a strict superset of `PHASE_TWO_READY`: criteria 2–5
above are registry rows in their own right. Criteria without a faithful
machine-auditable proxy yet are carried as acceptance-criterion rows, which
stay unmet by construction until upgraded to a machine-backed requirement
(a generated audit or fidelity scope); the gate cannot pass while any row is
unmet, and a passing Phase Two never implies a passing Phase Three.

---

# Encounter-closure slices

Canonical definitions live in [`deliverables.md`](deliverables.md)
§Encounter closure. They are the primary completeness metric: raw source-unit
counts never substitute for a slice closing.

# What is deliberately NOT in any phase

- Automating table judgment (optional ally dashes' consent, either/or GM
  choices) — documented table-facing instead.
- Horizontal scaling of the realtime service (single-instance by design).
- Mobile/native clients, accounts beyond Supabase auth, asset marketplace.
- Animated 3D dice presentation — later presentation/polish work with a strict
  presentation-only authority boundary ([`dice-presentation.md`](dice-presentation.md));
  deliberately not in any phase gate.
