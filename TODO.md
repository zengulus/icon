# ICON Remaining Work

This is the **current actionable backlog**, rebuilt from the full-repository
audit of 2026-08-25 (commit `55c7b6f` and later). It contains no completed
work except where a dependency must be explained.

Canonical document ownership:

| Question | Document |
| --- | --- |
| What is this project? What works today? | [`README.md`](README.md) |
| In what order do we build it? Phase gates? | [`docs/roadmap.md`](docs/roadmap.md) |
| What are the concrete artifacts and their completion criteria? | [`docs/deliverables.md`](docs/deliverables.md) |
| Which mechanic foundations exist and how mature are they? | [`docs/rules-foundations.md`](docs/rules-foundations.md) |
| What content can execute, at what level? | [`docs/rules-coverage.md`](docs/rules-coverage.md) |
| Machine-generated Class/Job unit dependency graph | [`docs/blocker-census.md`](docs/blocker-census.md) (**generated** — `npm run audit:class-job-census`; never hand-edit) |
| Genuine source-text contradictions only | [`docs/source-adjudications.md`](docs/source-adjudications.md) |

Status vocabulary used below: `BLOCKED` · `READY` · `PARTIAL` ·
`SOURCE/ADJUDICATION NEEDED` · `TABLE-FACING` · `DONE`.

---

## Current execution plan (ordered)

This is the canonical step-by-step execution order. It sequences the
backlog sections and roadmap priorities below; it does not replace them —
each step links to the section that owns its detail. Work proceeds one step
at a time; each step ends with a semantic audit against the step's meaning
(not merely green tests), regeneration of every generated artifact its
generator says is affected, and updated documentation recording the actual
resulting state. If evidence discovered during a step contradicts an order
assumption here, document the evidence and update this list before proceeding.

> **Active phase — UNDERLAY COMPLETION (2026-08-30).** Per the user phase
> directive and [`docs/underlay-completion-plan.md`](docs/underlay-completion-plan.md),
> the greedy blocker-census sequencing below is **superseded** for this
> phase: finish the U1–U17 generic substrate (dependency order T1–T6 in
> that document) before wiring or promoting any further ICON source units.
> New work is generic substrate and behavior-preserving migration only.
> Steps 1–6 below are the historical record of landed work; steps 7–11
> resume only after the UNDERLAY PHASE COMPLETE gate
> (`docs/underlay-completion-plan.md` §4). Per-task tracking lives in the
> ledger below; the plan document owns contracts, DAG, and gates.

**Underlay-phase task ledger** (tranche-owned; contracts/DAG/gates in
[`docs/underlay-completion-plan.md`](docs/underlay-completion-plan.md)):

- **U3 audit correction — QUERY is PARTIAL, not landed (Phase T2 entry) —
  LANDED for the actor domain (2026-08-30).**
  [`docs/tranche-2-query.md`](docs/tranche-2-query.md) claimed U3 landed;
  at HEAD only the actor slice existed (`kernels/candidate.ts`),
  `rangeOrigin` was inert, and `selectActors` owned independent
  eligibility (`docs/underlay-completion-plan.md` §0). Landed deliverables:
  1. **`rangeOrigin` through a `SpatialAnchor` (U7 seam) — DONE.**
     `primitives/anchor.ts` owns the anchor vocabulary (LIVE actor
     selector | CAPTURED position + `SpatialOrigin`); `kernels/candidate.ts`
     `resolveSpatialAnchor` resolves it, rejecting malformed anchors
     (`selector.origin-invalid` for query-shaped selectors, zero/multi
     actors, position-less anchors); relation stays relative to the acting
     actor while the range moves to the anchor. Fixtures in
     `candidate.test.ts` (9 new cases: captured-position, attack-target,
     input, invalid-anchor rejects, default-origin preserved).
  2. **`selectActors` onto `evaluateQuery` (U3 authority) — DONE (actor
     domain).** `kernels/evaluate-query.ts` `evaluateActorQuery` owns every
     selector filter (relation/defeated/off-board/range/adjacency/within/
     condition/mark/summon); `selectActors` is a thin adapter; the legacy
     `input` count/range enforcement throws are preserved verbatim.
     Enabling moves: `RuleProgramViolation` moved to
     `kernels/violations.ts` (runtime re-exports — breaks the kernel↔kernel
     cycle); `range` became a resolved scalar evaluated through U5
     `evaluateNumber` at the query point. Parity: `evaluate-query.test.ts`
     (13 cases); full suite green (1278 tests), zero fixture deltas,
     census byte-stable.
  Residual (stays Phase T2 — NOT claimed): non-actor query domains
  (positions/terrain/entities/areas/instances) and deterministic ordering
  operators. No source-unit promotion; blocker census untouched (426).

- **U3 eligibility de-duplication — `queryDirectTarget` + area-inclusion
  routing (Phase T2) — LANDED (2026-08-30).** The remaining U3 eligibility
  duplicates now route through the one authority:
  1. **Direct-target gate routes through the candidate authority.** The
     live command gate (`encounter.ts::assertDirectTarget`, the only
     `queryDirectTarget` caller) resolves base eligibility — relation,
     defeated/off-battlefield, p.92 footprint range — via
     `kernels/candidate.ts::validateActorCandidate` on the shared VM view
     (`encounter-adapter.ts::encounterQueryContext`); the direct-target
     specialist reads (Blind's range cap, Stealth's adjacency clause, True
     Strike, LoS) stay at the gate with unchanged problem precedence and
     violation codes. `queryDirectTarget` remains the reducer-facing spec
     fixture pinning the direct-target problem vocabulary.
  2. **Area inclusion routes through the query.** New `insideArea`
     operator on `evaluateActorQuery` (p.290 footprint inclusion over the
     gateway's cells); the foe-recipe blast resolver and the
     dash-on-the-rocks trait reaction read WHO is inside through the query
     authority while the spatial gateway keeps the CELL geometry.
  Parity: `evaluate-query.test.ts` +5 area cases (positive, defeated /
  off-board exclusion, large-foe footprint, one-past boundary,
  gateway-parity); full suite green (1283 tests), zero fixture deltas,
  census byte-stable. Residual (stays Phase T2): non-actor query domains
  and deterministic ordering operators. No source-unit promotion.

- **U3 eligibility de-duplication — resolver sugar + position legality
  (Phase T2) — LANDED (2026-08-30).** The last U3 duplicates route through
  the one authority:
  1. **Position-domain operators.** `kernels/evaluate-query.ts` gains the
     position slice: `evaluatePositionCandidates` (in-grid, unoccupied
     cells within radius, deterministic distance/x/y order — the
     historical `freeCellsInRange` semantics), `validatePositionLegality`
     (in-grid → range → occupied, structured), and `nearestCandidate`
     (source-defined nearest ordering over an evaluated CandidateSet,
     ties by id). Composed from the shared `primitives/job-kit.ts`
     predicates (`withinGrid`/`occupied`/point distance).
  2. **Migrated call sites.** `freeCellsInRange`/`nearestFoe` removed
     from job-kit; every resolver call site (foe-recipes terrain, fool,
     warden, knave, harvester, seer, chanter, enochian, stormbender)
     routes through the query operators; the knave/stormbender
     nearest-foe reads declare `includeDefeated: true` to preserve the
     historical candidate set; `teleport-choice` maps
     `validatePositionLegality` onto its existing violation codes
     (`move.out-of-bounds` / `move.range` /
     `choice.position-unavailable`); dead imports pruned (shade, sealer,
     geomancer, seer, enochian, spellblade).
  Parity: `evaluate-query.test.ts` +5 position/nearest cases (the
  job-kit nearest/free-cell tests moved to the authority's home); full
  suite green (1286 tests), zero fixture deltas, census byte-stable.
  Residual (stays Phase T2): query domains beyond actors/positions
  (terrain/entities/areas/instances) and ordering operators beyond
  nearest. No source-unit promotion.

1. **Verify canonical census + full verification baseline.** — `DONE`
   (2026-08-26). Census regenerates byte-stable under strict mode; full
   baseline green.
2. **Remove temporary/debug artifacts; reconcile docs with `main`.** —
   `DONE` (2026-08-26). Deleted committed throwaway
   `scripts/page-dump.tmp.ts`; reconciled rules-foundations (K-P5 landed
   state), rules-coverage (mastery/census figures), deliverables (Slice B
   blocking statement) with the landed mastery-fold work.
3. **Decompose all remaining `{irreducible}` census entries** (78 units)
   into concrete implementable blocker families or explicitly
   non-automatable/table-facing classifications; regenerate the census
   afterward. — `DONE` (2026-08-26). All 78 audited against full source text
   in the census tool's reclassification registry: every unit now carries a
   concrete implementable blocker set (existing families reused where the
   semantics match, e.g. shove-modifier/effect-count/fly-grant; ~30 new
   named reusable families for genuinely distinct mechanics such as
   area-effect-rider, use-count-override, card-deck-system,
   enemy-ability-trigger). NONE qualified as non-automatable/table-facing.
   Census regenerated: residual 0; no non-implementable class remains.
4. **Shared spatial primitives: Teleport, Place, Remove, Swap** — `DONE`
   (2026-08-27). The spatial gateway (`primitives/spatial-intent.ts`) and the
   mutation builders (`removeMutation`/`placeMutation`/`teleportMutation`)
   were already shared; the tranche landed the Swap primitive
   (`swapMutations`, `primitives/job-kit.ts`) with an explicit source-defined
   movement mode: teleporting swap (Masquerade p.151 "teleporting both" — legs
   are `movement: 'teleport'`, Rampart p.104-checked) vs remove/place swap
   (Shadow Play p.163, Redondo p.300, Chanter Purgatorio rotation — legs are
   `movement: 'place'`, never teleports). All four swap emitters migrated off
   hand-rolled place pairs; fixtures distinguish the flavors (Masquerade legs
   assert `teleport` and are Rampart-denied; Shadow Play legs assert `place`
   and cross the same boundary freely); forced moves keep voluntary-only
   movement-entry triggers and untouched turn entitlement. Atomicity is
   SOURCE-DECLARED, never inferred from mutation shape: `swapMutations` tags
   every leg with a `spatialBatchId`, and the reducer prevalidates only
   declared groups — the full destination permutation against the same
   pre-swap state (simulated on a clone, injective destinations), applied
   every-leg-or-none. **Occupancy exemption is group-scoped (2026-08-27):**
   a leg may ignore the footprints of actors in its OWN declared spatial
   group only — ungrouped movement resolves independently against current
   occupancy (a global event-wide co-moved set could let a mover into a cell
   whose occupant's own leg then failed, stacking two actors on one space),
   and actors in a different batch are never co-moved with a group; the live
   fold, the group prevalidation (a denial fixpoint over declared groups),
   and every dry run (`collidingShoveTargets`/`reactiveSlayTargets`) share
   one helper (`coMovedActorIdsForMove`). Masquerade obeys p.151's interrupt-legality
   rule: when a teleport leg is invalid the command is rejected (nothing
   consumed or redirected; the held ability is untouched). Terrain-create /
   entity-create and fly/movement-grant primitives are later foundations
   (F3/F4), not part of F1.
5. **Promote-after-landing discipline.** — `DONE` for F1 (2026-08-27).
   Immediately after each primitive/foundation lands, promote every source
   unit whose blocker set becomes empty, with source-exact fixtures and
   replay coverage, then regenerate the census (this is §9 of AGENTS.md
   applied per-step rather than per-batch). The F1 tranche promoted
   `knave:strongarm:talent:1` (program-level remove/place-into-adjacency +
   range-kernel comeback range) and `spellblade:nothung:talent:2`
   (program-level comeback teleport width); the 13 remaining former
   `{teleport}` singletons were re-read and reclassified to their true
   residual blocker sets (choice-input, object-distance, entity-create,
   pre-ability-movement, triggers, etc.) — none were bulk-enabled by
   family. Census regenerated: `{teleport}` blocker family gone (15 → 0).
6. **Expand mastery/talent folds by regenerated census frequency**
   (roadmap P3; F2/F5–F8): reusable high-fan-out modifier families first;
   each modifier's mechanical authority lives at the existing mechanic's own
   query point (e.g. the interrupt allowance reader, the damage pipeline),
   never in a parallel mastery-specific subsystem. F6a landed (2026-08-27):
   the bonus-damage grant kernel (`kernels/bonus-damage.ts` + content rows)
   folds source-gated bonus dice at the USE_ABILITY boundary; 6 units
   promoted (Low Blow t1, Nothung t1, Incubus t2, Dark Sliver t1, Demon Claw
   mastery, Vagabond Finesse) and the coarse `{damage-modifier}` census
   family was reclassified into precise subfamilies. F5 is **PARTIAL**
   (2026-08-27): the landed mark-modifier fold — carrier-aware
   mark-condition projections with grant potency (`passive-projection.ts`),
   the mark-keyed status-save policy seam, and turn-boundary mark triggers
   (lifecycle recipes), with content rows in
   `content/jobs/mark-modifier-recipes.ts` +
   `lifecycle-recipes.ts` — promoted 3 units (Grand Seal t1 save curse,
   Grand Seal t2 pacified+, Rot t2 turn-start adjacency damage). The coarse
   `{mark-modifier}` label is RETIRED: every one of the 22 census records
   that carried it was re-read against its full source passage and
   reclassified to the precise missing mark family (`mark-gated-modifier` 11,
   `mark-transfer` 4, `mark-defeat-trigger` 5, `mark-stacking` 3,
   `mark-detonation-window` 2, `mark-activation-gate` 2), while the rows
   whose mark portion the landed fold already supplies (growing-season
   mastery's pacified+ projection, Rot t1's turn-start trigger) dropped the
   label entirely — **zero unresolved blocker sets carry `mark-modifier`**
   (census regenerated, byte-stable). Per the regenerated census the next
   in-scope Step-6 family is the highest-immediate fold-shaped family — the
   highest-immediate families are entity-create (16), terrain-create (14),
   then fly-grant (14).
   action-type-change (10) decomposed: 3 pure action-cost overrides
   promoted, 5 compound masteries reclassified, 3 granted free actions
   remain.
   shove-modifier (10) decomposed: direction-override (1), conditional-
   distance-stun (1), new-shove-effect (7), foe-trigger-expansion (1);
   no fold consumer — all resolver-level. Kernel removed. The remaining
   compound shove-modifier entry (heave-ho:mastery) reclassified to
   variable-cost only — the 'shove X' keyword was a classifier artefact.
   charge-state classifier fixed: 6 delay-mechanic units reclassified out
   of charge-state (great-giorgios:mastery, terraforming:mastery,
   gigaton-whip:mastery, spinning-top:t2, chaos-tarot:t2, dervish:mastery).
   3 charge-state singletons reclassified with precise blockers (fly-grant,
   area-modifier, fly-grant+new-shove-effect). Only terraforming:t1 retains
   charge-state as a live blocker (Charge variant genuinely unimplemented).
   charge-state label retired from singleton census entries.

   **Underlay tranche 2 — U3 QUERY/CANDIDATE (2026-08-29):** landed the one
   candidate-legality authority beneath both automatic targeting and the
   U4 CHOOSE kernel (`kernels/candidate.ts`,
   `evaluateActorCandidates`/`validateActorCandidate`; relation + defeated/
   on-board + p.92 footprint range, composed from the existing
   `primitives/targeting.ts` + `spatial-intent.ts` authorities).
   `kernels/choice.ts` actor validation now consumes the shared CandidateSet
   (the second copy of eligibility is gone); CHOOSE semantics unchanged and
   re-proven by the unmodified 23-case `choice.test.ts`. All 8
   `{choice-input}` singletons re-read against their passages: **0 promoted**
   (honest) — each needs a durable per-ability choice WINDOW/CARRIAGE (U12
   CONTINUATION / U13 WINDOW: post-swap teleport, swap-ally selection,
   Slay-triggered gain-or-lose, aura-teleport window, post-explosion
   re-damage, post-ability sacrifice), not candidate legality. Census
   regenerated twice byte-stable at 426. Next tranche: U12/U13, then
   re-derive the greedy order from the regenerated census. Details:
   [`docs/tranche-2-query.md`](docs/tranche-2-query.md).

   **Underlay tranche 2 — U3 QUERY/CANDIDATE (2026-08-29):** landed the one
   candidate-legality authority beneath both automatic targeting and the
   U4 CHOOSE kernel (`kernels/candidate.ts`,
   `evaluateActorCandidates`/`validateActorCandidate`; relation + defeated/
   on-board + p.92 footprint range, composed from the existing
   `primitives/targeting.ts` + `spatial-intent.ts` authorities).
   `kernels/choice.ts` actor validation now consumes the shared CandidateSet
   (the second copy of eligibility is gone); CHOOSE semantics unchanged and
   re-proven by the unmodified 23-case `choice.test.ts`. All 8
   `{choice-input}` singletons re-read against their passages: **0 promoted**
   (honest) — each needs a durable per-ability choice WINDOW/CARRIAGE (U12
   CONTINUATION / U13 WINDOW: post-swap teleport, swap-ally selection,
   Slay-triggered gain-or-lose, aura-teleport window, post-explosion
   re-damage, post-ability sacrifice), not candidate legality. Census
   regenerated twice byte-stable at 426. Next tranche: U12/U13, then
   re-derive the greedy order from the regenerated census. Details:
   [`docs/tranche-2-query.md`](docs/tranche-2-query.md).

   **Source-fidelity repair pass (2026-08-27):** Repaired three incorrect
   mastery-attack attachments: removed the invented Apex mastery Unerring
   (mastery LOADED QUIVER is about extra beasts + per-beast damage, NOT
   unerring; the unerring grant belongs to Talent II at exactly range 3);
   fixed Death Blossom to always be unerring per its base ability header
   (removed wrong cross-ability Umbra-mastery gate); wired Umbra mastery
   DEVIL FROG TECHNIQUE unerring derivation into the resolver. Created
   `rollAbilityDamage` in `kernels/bonus-damage.ts` — the single generic
   named-resolver damage-roll authority that folds use-level and
   recipient-scoped (Finesse/Gambit) bonus dice; migrated warden, shade,
   spellblade, and harvester resolvers. Fixed entity-creation occupancy:
   removed the owner exemption (summoner occupies space like any character
   per the general creation rule). Fixed Rampant Nail (p.227) to use a
   player-chosen space in range 3 instead of the target actor's position.
   `entity-create` blocker remains uncleared (task §7). Full test suite
   green (1104 tests), architecture + source-fidelity audits green.

   **Entity-creation LoS/range centralization (2026-08-27):** Added
   `creationOrigin` and `creationMaxRange` to `RuleMutation` entity kind and
   `origin`/`maxRange` to the VM `RuleEffect` entity type. The reducer now
   threads these through to `validateEntityCreation`, enforcing LoS (via the
   shared primitives kernel), impassable terrain, and range at the reducer
   authority. The origin is source-declared (not hardcoded to the summoner);
   absent origin skips LoS/range checks for backward compatibility.
   Lifecycle companion summons also thread origin/maxRange. 6 entity-creation
   LoS/range regression tests added.

   **Range-modifier tranche (2026-08-27):** Audited all 11 former singleton
   `range-modifier` units against full source text. Only Dark Sliver t2
   ("Sacrifice 2: Ability gains range 6") is a genuine listed-range change;
   implemented via the range kernel with a new `choice` gate type (player-
   declared talent-use opt-in at command time, replay-safe). The other 10
   units were reclassified to their true missing families:
   - entity-distance-selection (5): Meld, Umbra t2, Harrow t1, DB t2, Open
     Gates t1 — entity/spatial distance predicates from arbitrary origins
   - active-effect-range-modifier (1): Gates of Hell t2 — cross-ability
     range modifier gated on a persistent effect
   - spatial-state (1): Colossus limit break — original-location capture
   - range-gated-teleport (1): Sealer limit break — pre-attack teleport gate
   - multi-actor-teleport (1): Nocturne mastery — multi-char teleport
   - resource-management (1): Conqueror's Edge — Infuse cost reduction
   The `range-modifier` singleton family is gone (11 → 0 immediate).
   Regenerated census: 423 unresolved, 0 residual.
   Highest-immediate fold-shaped families from the regenerated census:
   `action-type-change` (10), `shove-modifier` (10), `charge-state` (8),
   `effect-count` (8), `choice-input` (8), `resource-management` (7),
   `entity-distance-selection` (5). The next Step-6 family should be
   selected by the canonical highest-immediate rule; the prior claim that
   `entity-distance-selection` was highest was incorrect.
   Full test suite green (1110 tests), all audits green.

   **Entity-creation source-fidelity repair (2026-08-27):** Range validation
   now uses the canonical p.92 footprint distance (L\u221e between occupied
   footprints) instead of raw anchor-cell Chebyshev. Origin geometry
   (including the origin actor's Size) threads through RuleEffect \u2192
   RuleMutation \u2192 reducer \u2192 kernel. The VM origin selector rejects
   zero-actor origins before cost consumption. End-to-end entity-creation
   regression tests added (RuleEffect \u2192 RuleMutation \u2192 reducer path
   with origin metadata and replay). 10 new tests added (summons +
   harvester), 1120 total. (2026-08-27 corrective pass: origin/range are now
   a single PAIRED creation-spatial contract — see the corrective-repair
   entry below.)

   **Dark Sliver Talent II sacrifice cost (2026-08-27):** Added the
   `sacrifice-cost` talent registry (`kernels/talent-recipes.ts`) for
   pre-resolution sacrifice HP costs. Dark Sliver t2 now pays Sacrifice 2
   through the cost-payment authority when the talent choice is declared,
   validated before any effect or RNG. Sacrifice fires at USE_ABILITY time
   (before program resolution), recorded on the event for replay. 4 new
   tests: sacrifice paid at start, no-choice produces no cost, insufficient
   HP floors at 1, unequipped talent rejected.

   **Corrective repair — pre-use talent augmentation + entity spatial
   contract (2026-08-27):** Replaced the global "string → sacrifice amount"
   seam with a generic pre-use talent augmentation authority
   (`kernels/talent-recipes.ts` `resolvePreUseTalentAugmentations`): one row
   binds the talent source ID, parent ability, required equipped rank,
   declared-choice opt-in, and pre-resolution costs. BOTH command gates
   (USE_ABILITY and EXECUTE_RULE) consume the same validated result before
   target validation/effects/RNG, feeding the range kernel's `choice` gate
   and the cost gate — so Range 6 and Sacrifice 2 always travel together.
   A declared choice that is unrelated to the ability being used, not
   equipped at the required rank, duplicated, or unknown is IGNORED (no
   mechanical state change). Entity-creation origin/range became a PAIRED
   creation-spatial contract (`RuleEffect.spatial` /
   `RuleMutation.creationSpatial`), fail-closed at the runtime (zero/multi/
   off-board origin actors and range-without-origin rejected) and the
   reducer (out-of-grid or maxRange-only carried origin rejected). Size>1
   LoS is documented as a remaining source-fidelity limitation (p.92 LoS
   from "any edge of your space" needs a footprint-aware query through the
   shared LoS authority; only the range half is footprint-correct today).
   Sacrifice glossary citations corrected from the wrong "p.190" to the
   canonical Combat Glossary p.102; Enochian/Sealer ability references
   corrected to their extracted pages (p.208/p.210/p.191/p.184). 11 new
   tests (harvester + summons production-path), 1131 total.

   **Corrective repair — scoped ranges, compound-talent completeness, and
   replay compatibility (2026-08-28):** Dark Sliver talent 1's Comeback
   "increase all ranges by +1" (p.185) now widens the attack range AND the
   source-declared INTERNAL ranges (terrain-effect soul-space and Slay plant
   placement, 3 → 4) through one scoped range rule
   (`kernels/range.ts` `effectiveScopedRange`: named scope keys with the
   default `attack` scope; the resolver queries the authority, never
   duplicating the Comeback gate). Compound talents now register an explicit
   completeness manifest (`kernels/talent-recipes.ts`
   `registerCompoundTalentCompleteness`) naming EVERY required semantic
   component — Dark Sliver t1 (range rule covering all three scopes + bonus
   damage) and t2 (Range 6 + pre-use Sacrifice augmentation); the compiler
   audits such a unit complete only when every component is genuinely wired,
   so removing one component fails the audit (the old range-registry
   membership false-positive is structurally impossible). Legacy
   entity-mutation spatial fields (`creationOrigin`/`creationOriginSize`/
   `creationMaxRange`) are rewritten to `creationSpatial` at the
   `migrateEncounter` boundary (event history + held interrupt windows), and
   the reducer fail-closed declines an un-migrated legacy-shaped mutation —
   an old event can never replay as unrestricted creation; schema version
   stays 7 (durable current-state shape unchanged). Combat-start companion
   placement is now single-authority: lifecycle enumerates the ordered
   candidate cells and `validateEntityCreation` picks the first legal cell
   (full-footprint occupancy, LoS, terrain, range), so a Size>1 actor
   cannot hide behind a non-anchor footprint cell and a LoS-blocked first
   candidate falls through to the next legal cell. Sacrifice glossary
   citations corrected from the Combat Glossary section start p.102 to the
   actual Sacrifice X entry on p.103 (Dark Sliver t2 stays p.187); repaired
   the merged-comment artifacts in types.ts. 22 new tests (harvester,
   talents, summons), 1153 total; census regenerated twice byte-identical
   at 423 unresolved.

7. **Close one deliberately complex player-content vertical slice end to
   end:** persistent character → encounter → talents/masteries/interrupts/
   movement/status interactions → deterministic replay → settlement →
   projected character → subsequent encounter (Slice B closure path;
   [`deliverables.md`](docs/deliverables.md)).
8. **Relic invoke/persistent-effect runtime** as typed source-traceable
   recipes (roadmap P5; F9), closing the corresponding player-complexity
   requirements.
9. **Trigger-driven Vigilance** from real damage/movement trigger records
   through the existing window protocol (B4).
10. **Foe phase transitions + chapter-rule execution**, incl. one
    source-exact phased Legend end to end (B3).
11. **Mob member-state model**: member count, hit accounting, removal,
    slay suppression, replay, and a full Mob encounter fixture (B2).

---

## Immediate correctness blockers

These precede breadth work. Each has a concrete acceptance condition.

### B1. Elite and Legend multi-turn entitlements — `DONE` (2026-08-26)

Production entitlement rows live in
`src/rules/automation/content/foes/turn-entitlement-recipes.ts`: an Elite
(`foeKind === 'elite'`, projected durably onto the actor like `roleId`) owes 2
turns per round (p.299); a Legend (`roleId === 'legend'`) owes one turn per
player character read from live encounter state each round (p.298).
The count includes DEFEATED PCs — a pinned reading of source silence, not an
adjudication (no second passage contradicts it). Acceptance matrix incl.
round-boundary refresh, Slow/Delay interaction, replay, and source-exact
Elite/Legend fixtures: `src/rules/__tests__/foe-turn-entitlements.test.ts`.
The scheduler's Slow-phase transition was repaired so a multi-turn actor whose
forced Delay turn consumed its pending flag continues the SAME round with its
leftover normal entitlement instead of ending the round early.

### B2. Mob foes cannot exist at all — `BLOCKED` on a member model

**Problem.** `createFoeFromProfile` throws `foe.mob-unsupported` for the mob
role. Mobs need member-level state (two members per player, removed after two
hits, no slay triggering) that the single-body `EncounterActor` cannot
represent.

**Acceptance condition.** A designed member representation (entity pool or
actor-with-members) with hits accounting, removal, and slay-suppression, plus
one full Mob encounter test.

### B3. Foe phases and chapter rules are inert data — `PARTIAL`

**Problem.** Profiles carry parsed `phases` and `chapterRules`
(`content/generated/foes-1.5.json`, projected in `src/rules/foes.ts`), and
`createFoeFromProfile` seeds `ruleState.phaseId` with the first phase — but
no engine reads either. Phase transitions and chapter-scaling rules never
execute.

**Acceptance condition.** A phase-transition kernel (trigger → transition,
recorded durably for replay) and chapter-rule rows wired like trait recipes;
one source-exact phased legend as the first consumer.

### B4. Vigilance is command-driven, not trigger-driven — `PARTIAL`

**Problem.** Vigilance spends run through the dedicated `SPEND_VIGILANCE`
command with declared results (fixture-grade). The p.105 triggers (ally
within range 2 takes damage / foe enters adjacency) never open a window, and
range-2 eligibility is not enforced from a trigger record.

**Acceptance condition.** Guard/punish windows open from real damage/movement
triggers through the existing window protocol (`decideDamageWindow` family),
with once-per-trigger ledger and replay fixtures.

---

## Foundational mechanics (high fan-out)

Ordered roughly by how many otherwise-valid source units they unblock (see
also `docs/blocker-census.json` `blockerFrequencies`):

| # | Foundation | Status | Unblocks (approx.) | Notes |
| --- | --- | --- | --- | --- |
| F1 | Teleport / Place / Remove / Swap as shared forced-movement primitives | DONE (2026-08-27): shared gateway + builders + Swap primitive + source-declared atomic groups + group-scoped occupancy; 2 census units promoted (Strongarm t1, Nothung t2), 13 reclassified; `{teleport}` family cleared | 2 promoted (15 originally listed) | Census `{teleport}` blocker cleared |
| F2 | Interrupt-modifier family (rank change, extra uses, timing override) | PARTIAL | 13+ talents | Census `{interrupt-modifier}` |
| F3 | Terrain-create / entity-create recipe primitives | **entity-create reconciled (2026-08-29, F3 + corrective pass)**: the authority exists (`kernels/entity-creation.ts` `validateEntityCreation`), the 16 `{entity-create}` singletons were coarse keyword residues reclassified to precise residual blockers, and the seam is an ordinary-creator foundation under the source's Summons/Objects/Line rules (pp.95–108). `summonEntity` declares INTENT (ordered candidate list + `count` + paired `creationSpatial`); `validateEntityCreation` is the single legality/selection authority (per-cell ids for `count>1`). This pass added an entity-kind registry (`summon` | `object`, no string-name heuristics) driving lifecycles (summons removed on owner defeat; objects survive; companions persistent) and object stacking under the ≤3 height ceiling, split the creation intent into a placement REGION vs the creator LoS/range authority (`countMode`: exact/up-to, cap-bounded), and migrated ordinary summons to the seam (warden beasts incl. Apex extra beast — no `freeCellsInRange[index]` bypass — seer wild-cards, geomancer boulder, enochian aethershard, sealer shrine, shade shadows, stormbender salt-sprites, harvester thralls); cell-dependent exceptions stay explicit and documented. `entity-create` is retired as a blocker label — **0 unresolved occurrences, absent from the greedy simulation**. 0 promoted (honest). Terraforming (p.219) is now fully source-exact (5 bullets, canonical Line 3, character-occupied creation rejected, destroy-any-user-object, raise-to-ceiling-3, TII selectable dangerous). **F5 (2026-08-29) also decomposed the `{terrain-create}` label** (56 records) into precise `terrain-*` families + an exhaustive terrain audit invariant; the regenerated next census-selected family is `{choice-input}` (8 immediate) | 16 reclassified (entity) + 56 reclassified (terrain-create); 0 promoted | Census `{entity-create}` cleared; `{terrain-create}` retired; next = `{choice-input}` |
| F4 | Fly-grant / movement-modifier primitives | **`{fly-grant}` DECOMPOSED (2026-08-29, F4 audit) — NOT implemented as one kernel**: the engine already has the one-shot Fly movement mode (`movement: 'fly'` + `flyMutation`, plus the canonical `plannedFly` placement helper), so `{fly-grant}` was a coarse keyword artifact covering six genuinely-distinct missing mechanics. All 30 records that carried it (17 singletons + 13 compounds) were re-read against their full source passages and reclassified to precise families: `duration-fly-state`, `fly-move-timing`, `fly-move-substitution`, `fly-multirecipient`, `fly-distance-modifier`, `fly-benefit-rider`, `fly-or-teleport-repeat`, `once-per-round-fly-grant`, `flying-targeting` (stormbender:tsunami:mastery is NOT fly — it is an action-cost + movement-distance modifier + flying-foe targeting). Retired the `fly-grant` auto-push; the label now has **0 unresolved occurrences**. The genuinely-homogeneous `fly-distance-modifier` subfamily was **NOT landed**: the initial **`colossus:raging-wolf:talent:2`** promotion was retracted by Ultra Part 1 because Raging Wolf's full semantics (Heroic immunity while using; defeated-turns-next-use-free) cannot be represented — the base ability stays deliberately non-executable and the talent remains unresolved on `choice-input` + `ordered-intermediate-state` + `fly-distance-modifier`. | 0 promoted (raging-wolf:t2 retracted); 30 reclassified | Census `{fly-grant}` retired; next = `{choice-input}` (8 immediate) |
| F5 | Mark-modifier family | **PARTIAL** (2026-08-27): landed subset = carrier-aware mark-condition projections with potency, the mark-keyed status-save policy seam, turn-boundary mark triggers; 3 promoted (Grand Seal t1/t2, Rot t2). The coarse `{mark-modifier}` label is RETIRED — all 22 compound records reclassified to precise families (mark-gated-modifier 11, mark-transfer 4, mark-defeat-trigger 5, mark-stacking 3, mark-detonation-window 2, mark-activation-gate 2; growing-season mastery + Rot t1 dropped it as supplied); **zero blocker sets carry `mark-modifier`** | 3 promoted (12 originally listed) | Census `{mark-modifier}` label cleared; F5 remainder = the not-yet-landed mark families (mark-gated-modifier: 0 immediate / 11 compound) |
| F6 | Damage-modifier family | PARTIAL — bonus-damage dice grants landed (2026-08-27, F6a): `kernels/bonus-damage.ts` + 4 talent rows + Finesse; remaining subfamilies (round-gated dice, exceed auto-grant, suppression, damage-maximize, flat self-ratio) reclassified in the census | 6 promoted (13 originally listed) | Census `{damage-modifier}` cleared |
| F7 | Mastery fold (equipped mastery alters parent ability) | PARTIAL (modifier kernel K-P5 live; 4 wired — + Demon Claw RAGING DEMON 2026-08-27 — 129 unresolved) | 129 masteries | Biggest single content family |
| F8 | Talent subfamilies: resource-management, action-cost-override, charge-state, shove-modifier | PARTIAL — **action-cost-override fold landed (2026-08-28, F8a)**: 3 pure mastery overrides promoted (Valiant, Shadow Play, Polaris), 5 compound masteries reclassified with multi-component blockers, 3 granted free actions remain with `action-type-change` label. **Shove-modifier decomposed (F8b)**: 10 pure singletons reclassified with precise blockers (direction-override, conditional-distance-stun, new-shove-effect, foe-trigger-expansion, etc.); all resolver-level — no fold consumer. Kernel removed. **charge-state reclassified (2026-08-28; reviewed 2026-08-29)**: 6 delay-mechanic units removed. A review flagged that resolver-implemented charge talents were wired from the raw `context.triggers?.has('charge')` trigger WITHOUT proving the talent equipped (Spinning Top t2 flew on any slow turn; Chaos Tarot area-moved / Terraforming adjacency without rank). Repaired: every talent-specific branch now gates on `source.talents[abilityId]`; Spinning Top t2, Chaos Tarot t2, Terraforming t1 promoted to executable program-level (Terraforming's base "Charge: Choose four effects" stays talent-independent). Gigaton Whip t2 stays compound (`new-shove-effect`; fly wired, charge shove-3 unwired) and Wicked Sheath t1 stays compound (`collide-rider`). Census 426 (Ultra Part 1 reverted 416; the Phase-1 terrain talent retractions then added +7). Remaining: resource-management | ~180 talents | See census frequencies |
| F9 | Relic invoke/persistent-effect runtime | NOT STARTED | 120 relic-ranks + 40 aspects | Structured catalog exists |
| F10 | Expedition scene flow (camp/interlude as playable steps around the sheet transitions) | PARTIAL (sheet transitions DONE) | cross-combat play UX | |

---

## Encounter-closure blockers

The canonical slices live in [`docs/deliverables.md`](docs/deliverables.md)
§Encounter closure. Current first unsupported dependency per slice:

- **Slice A (baseline)**: CLOSED — setup through combat exit incl. settlement.
- **Slice B (player complexity)**: blocked on mastery/talent folds (F7/F8),
  Relic runtime (F9), Vigilance windows (B4).
- **Slice C (foe complexity)**: Elite/Legend entitlements done (B1,
  2026-08-26); remaining blockers are foe traits beyond keywords (590 rows)
  and phases/chapter rules (B3).
- **Slice D (attrition chain)**: settlement + projection DONE; remaining
  blocker is camp/interlude *scene flow* around the (already implemented)
  sheet transitions.

## Player content

- **Class traits** — `PARTIAL`: Mendicant slice (Diaga/Bless/Succor) done;
  **7 unresolved** (audit `class-trait`). Classify each: passive projection /
  command-time / table-facing.
- **Job traits** — `PARTIAL`: 27/65 wired across the five wiring homes;
  **38 documented** rows remain, each carrying its kernel need. Work the
  highest-frequency kernel first (see F1–F6), then harvest rows.
- **Talents** — `PARTIAL`: 57/288 executable (fold, program-level
  incl. F1 Strongarm t1 / Nothung t2, aura projection, range/area
  modifiers, the F6a bonus-damage rows: Low Blow t1, Nothung t1,
  Incubus t2, Dark Sliver t1, the F5 mark-modifier rows: Grand Seal
  t1, Grand Seal t2, Rot t2, and the pre-use augmentation row: Dark
  Sliver t2). **231 unresolved**. Do not bulk-enable;
  promote exact-ID slices per subfamily with replay fixtures. The U3
  candidate authority (tranche 2) provides shared choice-candidate
  legality but did not by itself promote any of the 8 `{choice-input}`
  singletons — each needs the U12/U13 choice window/carriage.
- **Masteries** — `PARTIAL`: equipped-mastery surface is validated and
  durable; the mastery-modifier fold (K-P5: interrupt-rank, damage-type
  conversion, unlimited range) promotes 3 rows, plus the program-level
  Demon Claw mastery RAGING DEMON (2026-08-27); **132 unresolved**. Broader
  promotion needs more modifier families added to the fold.
- **Limit Breaks** — `SOURCE/ADJUDICATION NEEDED` + `PARTIAL`: costs parse and
  pay through the resolve pool; the 16 limit-break effect bodies are
  unresolved. Unlock level is adjudicated at level 1
  (`docs/source-adjudications.md`). Availability gating does not exist yet.
- **Relics** — structured only (ranks, aspects, quests validate in the
  character engine; Refocus/infusion transitions are DONE). Invoke and
  persistent-effect automation is F9, not started.

## Foe content

- **Regular foes** — `PARTIAL`: standard profile construction + basic attacks
  work; **22 abilities** across 7 faction profiles execute as declarative
  recipes. Extend the recipe factory set before adding profiles (data-only +
  one fixture each).
- **Templates/factions** — remaining faction profiles need the recipe kinds
  above; prose traits stay table-facing.
- **Mob** — B2.
- **Elite** — double HP DONE; two turns per round DONE (2026-08-26, B1).
- **Legend** — HP scaling DONE; per-player turns DONE (2026-08-26, B1;
  defeated PCs counted — pinned reading of source silence); Juggernaut
  round-start clear DONE; component ability inheritance DONE.
- **Traits** — 79 keyword rows fully executable, 36 partial projections;
  **590 traceable foe-trait units** unresolved overall. Prose traits are
  table-facing by design.
- **Phases / chapter rules** — B3.

## Persistent / expedition lifecycle

- Character schema v4, import/export, migration v1→v4: `DONE`.
- Settlement & attrition handoff (`ENCOUNTER_ENDED` personal Resolve +1,
  `characterFromActor` projection of HP attrition/wounds/resolve): `DONE`
  (2026-08-25, roadmap P1).
- Camp/interlude sheet transitions (`campCharacter`, `beginInterlude`):
  `DONE`; playable camp/interlude scene flow around them: `NOT STARTED`.
- Trophies (68), camp fixtures (16), features (85), reward rules (9):
  structured/table-facing; deterministic subset needs classification before
  any automation.

## Narrative deterministic mechanics

- Zero-rating rolls, boons/curses, criticals: `DONE`.
- Effort/Strain spending and Second Wind recovery: registry + validation
  `DONE`; bond-power execution effects are `TABLE-FACING`.
- Clocks/burdens/ambitions progress trackers: `NOT STARTED`.
- Expedition structure itself: `NOT STARTED` (roadmap Phase 4).

## VTT / realtime

- Lab (`#/lab`): explicit actor selection, movement, attacks, ability use,
  persistence/reload/replay — `DONE` as a human-testing harness.
- Shared VTT route + Render authority: engineering preview, gated behind
  `PHASE_THREE_READY`; transport acceptance passes. Missing: GM tooling parity
  with Lab, reconnect UX under load, campaign invitation/session flow.
- Single-instance room manager: intentional; do not scale horizontally.

## Later polish

- Compendium search UX, token art pipeline, map asset management, mobile
  layout, sound/log filtering. Nothing here blocks rules authority.
- Animated 3D dice presentation — strictly presentation-layer staged
  roll-result choreography; requirements and the authority boundary are
  recorded in [`docs/dice-presentation.md`](docs/dice-presentation.md). Not a
  phase gate; nothing here blocks rules authority.

---

## Verification baseline (unchanged)

```sh
npm test
npm run typecheck
npm run audit:automation
npm run test:e2e
npm run build
git diff --check
# generated-content changes only:
npm run verify:extraction   # requires the supplied PDF locally
```

Observed at the B1 commit: unit 78 files / 1053 tests green; realtime
transport acceptance green (one stale phase-gate message assertion repaired —
commit `451205b` renamed the server gate message without updating the e2e
regex); browser acceptance requires Playwright's Chromium system libraries on
the host (`npx playwright install chromium`, plus e.g. libnspr4/libnss3);
architecture audit green (84 files); automation audit green with 3,103
explicitly unsupported clauses (expected while incomplete); strict
source-fidelity audit green with incompleteness reported as lowered status.
`verify:source-artifacts -- --expect-source-pdf=absent` fails only on
machines where the untracked PDF exists (it is a hosted-CI check; the default
invocation passes locally).
