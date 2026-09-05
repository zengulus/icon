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

# Current baseline (reconciled 2026-09-05)

- Source pipeline: 501 pages in the checked-in compendium; extraction and
  source-artifact verification commands own reproducibility evidence.
- Character engine: schema v5, creation/advancement validation, canonical
  narrative identities, import/export, settlement and attrition projection.
  Camp/interlude sheet transitions exist; a playable scene flow remains open.
- Encounter engine: deterministic command/event execution and replay fixtures
  cover wired movement, attacks, damage, conditions, resources, and lifecycle.
  Generic underlay completion remains the active phase; partial foundations
  and unresolved content are not certified by those fixtures.
- Player content and audit counts: [rules coverage](rules-coverage.md) owns
  the current summary; the generated [census](blocker-census.md) and
  [fidelity report](source-fidelity.md) own their computed evidence.
- Elite and Legend turn entitlements use the shared scheduler. Mobs, foe
  phases, broad player-content coverage, and the authoritative shared-VTT
  release gate remain open. The browser-local `#/lab` remains phase-exempt.

---

# Priority sequence

Priorities describe product outcomes; each may require several verified slices.
Categories: REPAIR · FOUNDATION · VERTICAL SLICE · CONTENT EXPANSION ·
INTEGRATION · POLISH.

The current step-by-step execution order across these priorities is tracked
in [`TODO.md`](../TODO.md) §Current execution plan; this document owns phase
definitions and gates, TODO.md owns live sequencing. On conflict, update both
together — never let them assert different orders.

**Active phase — UNDERLAY COMPLETION.** Per the user phase directive,
[`underlay-completion-plan.md`](underlay-completion-plan.md) owns the
current phase: finish the U1–U17 generic substrate before wiring or
promoting any further source units, with its UNDERLAY PHASE COMPLETE gate
(that document §4) as this phase's gate. The greedy blocker-census
sequencing in this section is **superseded** until that gate closes; the
priorities below resume afterwards.

Current placement work (2026-09-05): [tranche 33](tranche-33-placement.md)
migrates the listed use-time placements to recorded choices. U4 remains
partial; TODO.md now sequences a fresh residual audit of actor/resource,
remaining summon, and continuation decisions. Source promotion and the
shared-VTT release remain gated.

Implementation history is retained in the focused audit reports and Git.
Current underlay maturity lives in [rules foundations](rules-foundations.md),
acceptance obligations in the [underlay plan](underlay-completion-plan.md), and
actionable tasks in [TODO](../TODO.md). Coverage counts belong in
[rules coverage](rules-coverage.md), with generated audits as their authority.

## P1 — Combat settlement and cross-combat character continuity (REPAIR) — **DONE 2026-08-25**

Combat settlement and cross-combat attrition are recorded in the
[deliverables](deliverables.md#encounter-closure-primary-completeness-metric)
for Slices A and D. The remaining scene-flow work is P8.

## P2 — Foe role entitlements and the first closed foe-complexity slice (REPAIR + VERTICAL SLICE) — **DONE 2026-08-26** (entitlements; Slice C itself stays blocked on phases/traits)

Elite/Legend turn entitlement integration is recorded in the
[deliverables](deliverables.md#slice-c--foe-complexity--blocked). Foe phases,
chapter rules, and broader traits remain P6 work.

## P3 — Mastery fold + talent subfamilies (FOUNDATION + CONTENT EXPANSION)

**Goal.** An equipped mastery can alter its parent ability's execution; the
highest-frequency talent subfamilies promote in exact-ID slices.

**Why now.** Masteries and talents account for substantial unresolved player
complexity. Select exact families from the regenerated dependency graph after
the underlay gate; raw frequency alone does not establish readiness.

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

Continue movement, placement, entity, and lifecycle consolidation through
the [underlay plan](underlay-completion-plan.md). Current authority and
retained boundaries live in [rules foundations](rules-foundations.md);
source-unit dependencies live in the generated [census](blocker-census.md).
Select the next exact consumer only after its shared capability and the
underlay gate permit it.

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

**Why now.** Shared recipes make foe breadth tractable; phase and trigger
work addresses B3/B4. Exact unresolved units live in the generated census.

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

Current state: the gate remains false. Settlement and attrition evidence
live in [deliverables](deliverables.md); the unresolved correctness backlog
and acceptance requirements still need closure. A passing local test run
alone does not meet every gate requirement.

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
