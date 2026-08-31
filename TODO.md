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
>
> **T8 — Underlay Authority Repair re-audit (2026-08-31).** Re-audited every
> underlay under the strict AUTHORITATIVE invariant and corrected the audit
> and architecture guards so AUTHORITATIVE cannot coexist with a competing
> executing authority. Concrete outcome: U16 was found to be a false closure
> (the F9 `trait-reactions.ts` independently reconstructed the `ledger:round:*`
> key / availability / consume) — migrated onto the U16 core
> (`usageKey`/`ledgerAvailable`/`consumeUsageMutation`) with no behavioral
> change, new adversarial two-owner + key-identity tests, and the
> `u16-usage-ledger-routing` architecture guard. U16, U10, and U15 are
> conservatively PARTIAL (see `docs/t8-underlay-repair-report.md`); U2/U13/U17
> remain AUTHORITATIVE. Zero source units promoted; census byte-stable at 427.
> Phase gate remains OPEN.
>
> **T8b — Audit-Integrity Correction (2026-08-31).** Fresh-audited HEAD
> (not inferred from T8) and found T8's U2 AUTHORITATIVE claim hid a false
> closure: `kernels/aura.ts` locally derived `perspectiveActorId` from the
> spatial-origin case (actor→actor.id, entity→entity.ownerId). Moved the
> semantic rule (actor aura → bearer; entity aura → creator/owner; ownerless
> → no ally/foe) behind the U2 authority `auraRelationPerspectiveId` in
> `primitives/roles.ts`; aura + the Chanter Gentleness seam now CALL it.
> Repaired T8's fabricated U16 typed-owner call (`ownerId: ''` → the real
> owning actor; storage bytes unchanged). Upgraded the U2/U16 guards to
> call-form routing so symbol-presence bypasses are CAUGHT; adversarial
> mutation fixtures M1–M7 all CAUGHT. U2 re-certified AUTHORITATIVE by
> concrete call path; U13/U17 re-attested; U16/U10/U15 stay PARTIAL. Census
> byte-stable at 427; zero source units promoted; phase gate OPEN. See
> `docs/t8b-audit-integrity-report.md`.
>
> **T9g — U16/F9 operation-boundary repair (2026-08-31).** The F9
> once-per-round reactive entitlement is now ONE U16 COMMIT operation
> (`applyOncePerRoundUsage`) instead of a forgeable branded result object;
> U16 remains the single executing usage authority.
>
> **U16 residual-mark census & migration (2026-08-31).** Landed. Migrated the
> last actor-local once-per-scope marks onto typed U16 ledger keys
> (`chainReactionOncePerRoundKey`, `incubusOncePerRoundKey`,
> `stampedeOncePerRoundKey`, `vigilanceRushOncePerTurnKey`,
> `midasOncePerCombatKey`, `bullStrengthOncePerTurnKey`); `damage-immune` and
> armed/charged/pending flags proven content MODE or recorded fact, never a
> usage gate. A fresh semantic census finds no remaining ruleState
> boolean/counter answering "may/how many times within scope X?" outside the
> typed ledger — U16 re-certified **AUTHORITATIVE**. Census byte-stable at
> 427; zero source promotion; the phase gate stays OPEN on U8/U14/U9/U6/U12/
> U4/U5/U7.

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

- **Corrective underlay pass (2026-08-30) — LANDED.** Repairs introduced
  or exposed by the first U3/U7 work; no new underlay tranche, no
  promotion. Full suite green (1287 tests), census regenerated
  byte-stable at 427 unresolved (was 426 — the count grew honestly), all
  audits green:
  1. **No invented id tie-breaks.** `nearestCandidate` (ties by actor id)
     replaced by `nearestCandidates` — the full minimum-distance set,
     no ordering invented. `rushTowardFoes` answers through the same
     selection and fails closed on equidistant ties. The inline id
     tie-breaks in the Dark Knight turn-start lifecycle recipe (removed)
     and the Symphony fly read (routed through `nearestCandidates`, skips
     on ties — declining is source-valid for "may fly 1") are gone.
  2. **Retractions.** `knave:dark-knight` (p.143 "If multiple foes are
     equidistant, you may choose" — a player choice with no seam at that
     timing) and `stormbender:eye-of-the-storm` (p.236 "they may fly 4" —
     a free player-chosen flight; the old "away from the nearest foe"
     direction was invented) moved to `DOCUMENTED_NON_EXECUTABLE`;
     their resolvers fail closed on those clauses; the eye-of-the-storm
     talent 2 (only ran inside the retracted resolver) is retracted with
     them (audited census blocker `choice-input`); the
     `includeDefeated: true` flags those call sites carried were dropped
     (a "closest foe" cannot include defeated characters). The Dark
     Knight mastery (Infectious Hatred aura + turn-end save) stays
     executable — its mechanics are exact and independent of the
     closest-foe clause (tests enter the stance directly).
  3. **Position domain honesty.** The position slice is a
     FREE/UNOCCUPIED specialist, not the full U3 position domain:
     `evaluatePositions` takes an explicit SPACE policy (`any` per p.92
     "Space: Any space in range, and any characters or objects occupying
     it" vs `unoccupied`) and an explicit ORDERING policy (default
     `none`); teleport legality stays a specialist
     (`validatePositionLegality`); movement/placement legality stays with
     the spatial gateway.
  4. **Occupancy audit.** `occupied` is an OBSTRUCTION test: characters
     + OBJECT entities block (p.95 objects "provide obstruction"),
     intangible SUMMONS do not (p.95 summons "don't cause obstruction or
     engagement"); bomb-can't-share-with-bombs is a specialist
     constraint in the bomb placement resolver; `walk` passes through
     summons. Distinct concepts (presence vs obstruction vs placement
     unavailability vs teleport unoccupied) are not collapsed into one
     boolean.
  5. **`selectActors` range de-duplication.** The `input` selector's
     range legality now routes through the SAME U3 candidate authority
     automatic targeting uses (the `choice.actor-range` enforce-throw
     contract preserved); parity tests cover exact-range passes,
     one-past fails, and a Size>1 mover's footprint distance through both
     paths.
  6. **Plan doc reconciliation.** `underlay-completion-plan.md` §0
     separates the historical audit finding (7a000d…) from the current
     implementation and the remaining contract (no contradictory
     "current HEAD" claims); U6 and U16 are staged (core in T2/T3,
     U10-backed completion in T4) so no underlay is described as done
     before its declared dependencies; U3 and U7 remain honestly PARTIAL
     (U7's actor-selector anchors are documented compatibility
     scaffolding for the future U1 Reference vocabulary).

- **Phase T1 — U1/U2/U8 vocabulary foundation (2026-08-30) — LANDED.**
  The dependency plan's first tranche: typed vocabulary only, no
  behavior change, no consumer migration, no source-unit wiring. Full
  suite green (1318 tests, +31 new), census unchanged and byte-stable
  at 427, all audits green:
  1. **U1 REFERENCE (`primitives/reference.ts`)** — typed `Reference`
     union (LIVE refs by legacy slot / direct id / bound name; CAPTURED
     actor/entity/position/value literals; `collection` refs),
     `Binder`/`bind`/`lookupBound`/`EMPTY_BINDER`, deterministic
     `resolveReference` (captured literals never re-read later state;
     bound names resolve the bound reference; missing actor/entity/slot/
     position reject fail-closed); `RuleExecutionContext.boundNames`
     carries the Binder (optional, behavior-neutral). Tests:
     `reference.test.ts` (captured-exactness-after-move, live
     re-resolution, unbound/missing rejects, empty collection, captured
     defeated-actor stays resolvable, replay identical-literal).
  2. **U2 ROLE (`primitives/roles.ts`)** — `Role` union (source/owner/
     controller/chooser/payer/target/recipient/carrier/creator/
     trigger-source/trigger-recipient/attacker/defender/original-user/
     current-origin), `RoleFrame` + deterministic `deriveRoles`, typed
     `RoleSelector` (`role` | `controller-of`) + `resolveRoleSelector`
     (null when underivable — reject, never guess), and the
     `roleFrameFromContext` seam; `RuleChoice` gains typed optional
     `chooser`/`controller` role carriage (behavior-neutral until U4).
     ROLE ≠ REFERENCE ≠ ANCHOR asserted (rebound fixture). Tests:
     `roles.test.ts` (owner≠carrier, TARGET_CONTROLLER, underivable
     chooser rejects, self-collapse, role≠anchor, replay).
  3. **U8 SCOPE/CLOCK (`primitives/scope.ts`)** — ONE `Clock` union
     (boundary / n-boundary / next-match / event), `RecurringBoundary`
     (turn/round/combat/expedition/camp/interlude), `Scope` (until /
     for-n / until-next / permanent / until-event), and the boundary-
     read surface `clockForTiming`/`scopeForDuration`/`currentClock`/
     `boundaryReached` (step timings → null; legacy `RuleDuration` →
     Scope, behavior-neutral). Tests: `scope.test.ts` (one-round-read-
     across duration/timing/clock, counted/next-match/event forms,
     step-timing-null, out-of-scope reject, slow-vs-ordinary kinds,
     replay).
  4. **U3 pre-flight audit correction.** The docs at HEAD honestly
     claimed U3 PARTIAL; the audit sharpened the residual: the ACTOR
     domain itself lacks contract operators (LoS/LoE composition,
     occupying-position, terrain predicate, owned/controlled,
     union/intersection/difference, count, distinct-by-identity), and
     the p.108 line-of-sight predicate is missing from
     teleport/placement legality (`validatePositionLegality` is in-grid →
     range → occupied only; entity-creation checks creator LoS, the
     teleport path does not) — classified as a deliberate T2 boundary,
     NOT silently enforced (it would change existing teleport behavior).
     U1/U2 ABSENT → PARTIAL; U8 stays PARTIAL.
  T1 exit criteria met (vocabulary types + unit tests; zero existing
  test deltas). Next tranche: **T2** (U7/U3/U5/U6-core/U4) per
  `docs/underlay-completion-plan.md` §3.2 — do NOT start T2 without the
  reviewer's go.

- **T1 corrective pass — U1/U2/U8 vocabulary repair (2026-08-30) —
  LANDED.** Three defects in the newly-landed T1 vocabulary repaired
  BEFORE any later underlay depends on them. Full suite green (1340
  tests, +22 over the T1 baseline), census unchanged and byte-stable at
  427, all audits green.
  No source wiring, no census sequencing change, no consumer migration;
  the fixes are vocabulary-only so later consumers migrate without
  semantic loss._
  1. **U2 controller-of is SUBJECT-RELATIVE.** Previously
     `resolveRoleSelector` returned ONE global `roles.controller` (with
     a `roles.source` fallback) for every `controller-of` subject, so
     `controller-of(source)` and `controller-of(target)` could not
     differ — defeating U2's multiplayer authority model — and an
     absent controller fell back to the source (contradicting the
     underlay's fail-safe rule). Now `RoleFrame.controllers` records a
     per-SUBJECT-
     ROLE controller map and `RoleMap` is `{ roles, controllers }`;
     `resolveRoleSelector({ controller-of, subject })` returns the
     recorded controller OF THAT subject only, null when the subject is
     missing OR has no recorded controller (never silently guessing
     source); recorded durable state only, never ambient session
     ownership. Tests: source−target different controllers, mark
     owner−carrier different controllers, missing-controller-for-valid-
     subject → null, missing subject → null, self-collapse, replay.
  2. **U8 CLOCK/SCOPE keeps temporal semantics.** Previously
     `clockForTiming` collapsed turn-start+turn-end→turn and round-
     /combat-start+end→round/combat; `scopeForDuration` dropped the
     turn-start/end actor; counted `n-boundary round n` was an ABSOLUTE
     round counter (`state.round >= n`) so a round-5-created 3-round
     effect looked pre-expired; `next-match` fired on broad kinds
     without a recorded transition; `currentClock` reported a round
     boundary for `use`. Now boundaries carry an EDGE (`start`/`end`,
     never collapsed) plus an optional U1 `subject` (source's turn ≠
     target's turn; `slow-turn` start ≠ ordinary turn start); COUNTED /
     next forms are RELATIVE to a recorded epoch (an effect created on
     round 5 for 3 rounds completes only after three matching round
     boundaries from its origin); `boundaryReached`/`scopeSatisfied`
     take an observed `ClockObservation` (+ optional epoch) and
     reject relative reads with no recorded epoch (no invented
     answers); `permanent` never satisfies; `currentClock`/
     `clockForTiming` return null for non-boundary step timings. The scheduler/lifecycle/usage/duration
     readers are NOT yet migrated (U8 stays PARTIAL). Tests: the 11
     required temporal-fidelity cases plus edge/subject preservation in
     `scopeForDuration`.
  3. **U1 REFERENCE domain + collection type safety.** Previously
     plural `trigger-targets` collapsed to the FIRST target
     (`context.triggerTargetIds?.[0]`); a live bound actor ref could
     silently resolve a bound position (`domain` was decoration); the
     captured representation allowed domain/value pairs that disagree.
     Now captured references are SELF-DESCRIBING discriminated kinds
     (`captured-actor` carries only an actorId; `captured-position`
     only a Position) so a captured actor structurally cannot hold a
     position and vice versa; `Reference<D>` is a generic discriminated
     union whose CAPTURED member narrows to `D`; `collection` preserves
     its element domain (`Reference<D>[]`); `liveTriggerTargets()`
     resolves an upheld ordered collection of EVERY target (empty slot
     = legitimate empty collection, distinct from a missing singular
     slot); bound-name resolution verifies `domainOf(boundRef) ===
     declared domain` (bound actor → bound position is
     `domain-mismatch`, reject). The Binder stays pure/immutable and
     replay-deterministic. U1 stays PARTIAL (consumers not migrated).
  U1/U2/U8 remain PARTIAL — vocabulary-only, consumers/migrations still
  outstanding; no source unit became executable.

- **Phase T2 — Query & expression algebra (U7/U3/U5/U6-core/U4) — LANDED
  (2026-08-30).** Full suite green (1544 tests, +54 over the T2 entry
  baseline), census regenerated byte-stable at 427, all audits green, no
  source-unit promotion. Deliverables:
  1. **U7 — LIVE ENTITY anchor + retained-specialist boundaries.**
     `SpatialAnchor` gains `{ kind: 'entity'; entityId }` (resolved to the
     entity's size-1 cell; missing/position-less entities reject
     `selector.entity-missing` / `selector.origin-invalid`) — consumed by the U3 entity-domain range origin and
     the U5 distance anchor endpoints. `RuleArea.origin` (declarative
     only, no runtime consumer), entity `creationSpatial` (resolved-
     position contract carried on the mutation), `teleport-choice`
     origins (consumed through the shared legality operator),
     `SpatialIntent.from`, and aura origins are documented retained
     specialists with written boundaries.
  2. **U3 — actor-domain operators completed + entity/terrain domains.**
     Query TYPES moved to their split-plan home `primitives/query.ts`
     (kernel `evaluate-query.ts` owns evaluation, both barrel
     re-exported). `evaluateActorQuery` gains line of sight / line of
     effect from the query's U7 anchor (shared LoS kernel), occupying-
     position, the terrain predicate `onTerrain`, owned-by (explicit
     `summon.owner` actor id), and `composeActorQueries`
     union/intersection/difference with distinct-by-identity and no
     invented ordering. New domains: `evaluateEntityQuery`
     (owner/type/range-from-anchor/at-position) and
     `evaluateTerrainCells` (terrain-predicate cells); `evaluateValueQuery`
     dispatches the U5 `count-query` spec.
  3. **p.108 placement-LoS boundary RESOLVED through the generic
     authority.** `PositionLegalityQuery`/`PositionQuery` gained
     `lineOfSightFrom`; `validatePositionLegality` reports a
     `line-of-sight` problem after occupancy; the teleport kernel's
     player-chosen destinations enforce it (`move.line-of-sight`;
     behind-the-wall rejection + clear-line control fixtures in
     `spellblade.test.ts`). `originSize` makes the legality specialist
     measure the p.92 footprint of a Size>1 origin (size-1 collapses to
     the historical point metric). Entity/object creation already
     checked creator LoS; the reducer movement gateway remains the
     movement authority (forced/derived teleports have no source-defined
     LoS origin — documented boundary).
  4. **U5 — `kernels/evaluate-value.ts` extracted + extended.**
     `evaluateNumber`/`integer` (+ the selector read surface
     `selectActors` it resolves) moved out of the runtime barrel, which
     re-exports them. New operators: `count-query` over the general
     domains, `distance` between arbitrary endpoints (selector | U1 ref
     | U7 anchor; unresolvable refs reject), `percent-base-max`
     (p.107 "% HEALTH": the BASE maximum, distinct from the
     wounds-adjusted bar; `baseMaxHp` projected by the encounter
     adapter, absent → `value.base-max-missing`).
  5. **U6 CORE — `kernels/evaluate-predicate.ts` extracted + extended.**
     `evaluatePredicate` moved out of the runtime barrel (re-exported).
     New core predicates (U1/U3/U5/U8 only): `mark-exists`, `in-stance`,
     `inside-aura` (through the shared aura kernel; unregistered
     provenance rejects), `acted-this-round` (p.129 Special).
     `effect-still-exists` (U10 facts) and `used-scope` (U16 ledger) are
     deliberately NOT in T2 — they land with their declared dependencies
     (T4/T3); U6 is not described as finished.
  6. **U4 — rangeOrigin + chooser/controller seam.** Position choices
     route in-grid + footprint-range through the shared U3 predicates
     with a U7 `RuleChoice.rangeOrigin` anchor (default the acting
     actor; malformed anchor rejects). `choiceEntitledPlayer` /
     `choiceEntitledPlayerFromContext` derive the entitled chooser from
     the durable U2 role frame (declared chooser, else controller, else
     source); an underivable declared role returns null — the
     command/network boundary rejects rather than guesses. No content
     row sets the roles yet (U13 window layer consumes the seam).
  Residuals (honest, NOT claimed): area/persistent-instance/rule-source
  query domains (U10/U12-scoped), ordering beyond the min-distance set +
  opt-in cell order, direction-choice candidate domain, the opaque
  ability/talent choice folds, `used-scope` (U16/T3) and
  `effect-still-exists` (U10/T4) predicates, the range/area gate body
  folding, `rushTowardFoes`' flagged direction fallback. No source-unit
  wiring; census unchanged (427).

- **Phase T3 — Policy, state, ledger: U14, U16 (core), U15, U17 — LANDED
  (2026-08-30).** Full suite green (1586 tests, +42 over the T3 entry
  baseline), census regenerated byte-stable at 427, all audits green, no
  source-unit promotion. Deliverables:
  1. **U14 — ONE ModifierRule shape + typed permissions
     (`primitives/modifiers.ts`).** `ModifierRule`
     `{ sourceId, ownerId, queryPoint, scope, operation, value, gates,
     talent, actionId, from, ordering }`; unknown query points reject at
     registration; `foldNumberModifiers`/`foldEnumeratedModifiers`
     (add accumulates, last set/override wins, `from`-guarded chains);
     ONE shared gate evaluator (`modifierGateHolds` over the shared
     `ModifierGate` union); typed `PermissionQueryPoint` kinds
     (`cannot`/`ignore`/`immune`) with the enumerated negative registry
     `PERMISSION_NEGATIVES` (unlisted pairs reject — wildcard bypass
     unrepresentable). The range (`listed-range` per scope), area
     (`area-size`/`area-shape`), mastery (`interrupt-rank`/`damage-type`
     + `range-bound` permission, equipped+mastered baked into every
     row), and bonus-damage (`bonus-damage-dice`) registries convert
     their content rows to shared rows and fold through the shared
     discipline; kernels keep their public surfaces as thin adapters.
     Retained specialists (written boundaries): cost-modifier function
     rows, the attack-modifiers armed one-shot fold, scaled/recipient
     bonus-damage function rows, aura/save-window boon-curse
     consumption, and the damage-exception mutation fields (distinct
     program-emitted delivery fields; the permission registry is where
     content-registered permission rows fold).
  2. **U16 CORE — `primitives/usage.ts`.** Byte-identical
     `ledger:<scope>:<sourceId>` keys (F9 `roundLedgerKey` contract
     preserved), `usageIdentity` (the CORE de-dup key), counts, caps
     (incl. the U14 `use-cap` fold), one-shot/N-per-scope consume,
     refresh, per-use magnitude (`usageRead` ordinal),
     `resetBoundaryFor` (turn/round/combat onto U8), `holdsUsageKey`;
     `kernels/use-ledger.ts` is a thin adapter; the U6 `used-scope`
     predicate consumes the ledger. Staged: the U10-backed de-dup
     identity completes U16 in T4; the interrupt-uses counter and
     attacked-this-turn/end-turn flags stay durable actor fields (T6
     typed-ledger migration).
  3. **U15 — `primitives/transaction.ts`.** `TransactionLeg` +
     `validateTransaction` (all-or-nothing verdict naming the first
     failing leg) + `proposeAtomicGroup`; the Masquerade spatial-batch
     gate (`assertLegalSpatialBatch`) composes the source-declared
     atomic spatial group through the seam (per-leg legality stays in
     the spatial gateway; one denied leg rejects before any event).
  4. **U17 — `primitives/ordering.ts`.** `OrderingPolicy` (source-order
     | stack | turn-order | hostile-before-beneficial |
     non-active-owner-first | controller-choice | explicit-list),
     `applyOrdering` (pure), `policyYieldsChoice` (controller-choice
     yields a typed U4 choice spec; the engine never invents an order),
     `orderingKey`. Wired: `orderedSelectedSteps` (source-order),
     `decideDamageWindow` (source-order over `TRIGGER_WINDOW_RECIPES`),
     the pending-interrupt LIFO pop (stack). The lifecycle registry
     order stays the recorded boundary contract and the scheduler turn
     election stays the scheduler authority (documented U17 consumers);
     the turn-boundary policy consumers land with U13 in T5.
  5. **U18 evaluation (plan §2 decision rule).** The U14 consolidation
     produced no need for a new attachment record — mastery/range/area/
     bonus-damage fold through the shared ModifierRule rows; the
     attack-modifiers armed fold and the cost function rows are
     documented retained specialists. **U18 NOT promoted**; the decision
     point re-opens at T6 after the U11/U13 work.
  Residuals (honest, NOT claimed): U16's U10-backed de-dup identity +
  `effect-still-exists` (U10/T4); the interrupt-uses counter and
  turn-attack/end-turn flags typed-ledger migration (T6); the
  attack-modifiers armed-state fold + cost function rows + aura/save
  boon-curse + damage-exception fields remain documented retained
  specialists (their full shared-shape migration is T6 consolidation);
  the turn-boundary ordering consumers (hostile-before-beneficial /
  non-active-owner-first / controller-choice) land with U13 in T5. No
  source-unit wiring; census unchanged (427).
- **T3 corrective pass (2026-08-30) — four contract corrections, no new
  underlays, no source-unit changes.** Full suite green (1604 tests),
  census byte-stable, all audits green. Corrections:
  1. **U16 identity carries the owner.** `usageKey` remains the
     actor-local STORAGE key (byte-identical `ledger:<scope>:<sourceId>`
     format); `usageIdentity`/`usageIdentityKey`/`usageIdentitiesEqual`
     are the typed DE-DUP IDENTITY, DISTINCT from the storage key and
     always carrying owner/scope/target — negative test proves two
     owners of the same source/scope/target differ, so T4's U10
     fact-backed de-dup cannot inherit the storage key's owner
     collision.
  2. **U17 rejects unresolved orderings.** `applyOrdering` returns
     `OrderingResult`;
     missing context (`missing-source-order`/`missing-turn-order`/
     `missing-perspective`/`missing-active-owner`) and candidates absent
     from the declared authority (`unknown-candidate`) are UNRESOLVED
     rejections at the command/window boundary — never the caller's
     incoming array order. `controller-choice` is never resolved by
     `applyOrdering` (returns `yields-choice` carrying the typed U4
     choice). Wired consumers (`orderedSelectedSteps`,
     `decideDamageWindow`, pending-interrupt LIFO pop) reject on
     non-ok results; negative missing-context/unknown-candidate tests
     added.
  3. **U15 collective dependence.** `TransactionSpec` gains a declared
     `mode`: `simultaneous` (every leg against the ORIGINAL common
     pre-state — the swap family; the Masquerade gate composes this) or
     `sequential` (leg i against `project(snapshot, applied)` — the
     cumulative family: multiple spends, split pools, creation
     conflicts, sacrifice + payoff). A sequential transaction without a
     `project` fails. Tests: wallet 5 spends 3+4 rejects WITHOUT manual
     subtraction (each leg individually legal), mutually incompatible
     legs, simultaneous swap stays legal against the common pre-state
     (and a sequential projection would wrongly reject it), no intents
     on failure, deterministic replay.
  4. **U14 values are U5 RuleNumbers.** `ModifierValue = { kind:
     'number', value: RuleNumber } | { kind: 'enumerated', value: string
     }` — the primitive owns no special dynamic literals (the old
     `'round'` special case is the U5 `{ kind: 'round' }` expression;
     the range adapter's `'round'` shorthand translates at the kernel
     boundary). Numeric folds take an injected `ModifierNumberResolver`;
     `kernels/evaluate-modifiers.ts` (`resolveModifierNumber`) is the
     thin kernel-layer evaluator projecting the fold view onto the
     representable U5 subset (constant, round, pure scalar
     compositions); context-dependent expressions reject rather than
     guess. Tests: `{ kind: 'round' }` parity + a composed U5 expression
     fixture + an unrepresentable-expression rejection.
- **T4 corrective pass (2026-08-30) — durable/resolution-scoped facts, no
  new underlays, no source-unit changes.** Full suite green (1645 tests,
  +11 over T4; existing fixtures pass unchanged), census byte-stable at
  427, all audits green. Corrections (per the four reported gaps):
  1. **U10 facts are durable + replay-stable.** Every resolution
     owns a deterministic, replay-stable `resolutionId` (command/event
     boundary); every fact `instanceId` is scoped under it (two uses of one
     ability differ; replay reproduces the identical history), and the
     typed `facts` + `resolutionId` now RIDE the durable
     RULE_MUTATIONS_APPLIED event. Historical events without a recoverable
     identity refuse fabricating (no invented de-dup identity).
  2. **Facts record RESOLVED outcomes.** `damage-applied` records the
     DETERMINED (post-mitigation) amount from the shared damage authority
     at the recording boundary — never the raw proposed amount — and
     fully-prevented damage emits NO false fact. `ability-used` is emitted
     at the ability boundary under the resolution identity.
  3. **U16 de-dup wired into real execution, once-per-ability.** The
     resolve identity is RESOLUTION-scoped
     (`{ sourceId, ownerId, scope, resolutionId, trigger }`), NOT per-fact:
     multiple routing facts (three Collides) open ONE triggered step; a
     second ability use (different resolutionId) may trigger again;
     per-target only where a source declares it. `hasResolvedAsFact` is
     consulted in `executeRuleProgramWithReactiveTriggers` (recorded
     markers eliminate re-offers). `executedStepIds` remains FLOW
     bookkeeping; U16 is the semantic authority.
  4. **Durable instance identity through the projection.**
     `RuleActorView` active-effects/marks/stance now carry the
     durable instance id + ownership, so `effectExistsLive` answers
     EXACT specific-instance reads (owner-A's mark never satisfies owner
     B's identical markId), and effect lifecycle facts (apply/refresh/
     remove/enter/exit) reference the ORIGINAL instance.
- **T4 final contract fix (2026-08-30) — the four contracts made TRUE in
  the implementation (not only in comments/tests).** Full suite green
  (1660 tests; existing fixtures pass unchanged), census byte-stable at
  427, all audits green, no source-unit promotion, no T5/U11–U13 work.
  1. **Monotonic durable resolution identity.** `nextResolutionId` now
     derives from a durable UNBOUNDED `resolutionSerial` on
     `EncounterState` — advanced by applyEvents per recorded
     RULE_MUTATIONS_APPLIED event, NEVER the bounded eventLog's array
     length (the old derivation repeated ids after 500-event truncation),
     migrated deterministically for legacy checkpoints — so resolution ids
     stay unique for the lifetime of an encounter, survive save/load, and
     replay reproduces them.
  2. **Single determined-damage handoff.** `resolveMutationOutcomes`
     (command/window boundary) determines every damage instance ONCE via a
     reducer-faithful sequential dry run over the event's mutation list
     and stamps the recorded post-mitigation amount on the mutation
     (`determined.amount`); the reducer consumes the stamp instead of
     calling the damage authority again, U10 `damage-applied` facts record
     the SAME amount, a mutation that no-ops (target defeated/immunized by
     an earlier mutation) records no false fact, and replay applies the
     recorded result without re-calculating armor/resistance/dodge.
  3. **Durable U16 markers.** `trigger-resolved` facts (one per resolution
     + triggered step, keyed by the canonical resolve identity) ride the
     event's U10 fact list — byte-identical across replay — so U16's
     recorded decision is consumed, not re-inferred; `continuation`
     remains FLOW bookkeeping only.
  4. **Canonical effect-instance identity.** U10 effect facts carry the
     exact LIVE instance id the reducer creates/removes
     (`effectInstanceId`, decided once at the command/event boundary and
     consumed by the reducer); removals address the specific instance
     (removing A leaves coexisting B alive; owner-A mark removal leaves
     owner-B's same-named mark intact), and the U6
     `effect-still-exists` chain (application fact → live exact instance →
     true → removal of that instance → false) is end-to-end exact with no
     manually synchronized fake ids.
- **Phase T4 — Time and outcome: U9, U10 (completes U6 and U16) — LANDED
  (2026-08-30).** Full suite green (1645 tests after the corrective pass),
  census byte-stable at 427, all audits green, no source-unit promotion.
  Deliverables:
  1. **U9 — `primitives/provenance.ts`** (barrel re-exported): the typed
     provenance/delivery-dimension vocabulary — `DeliverySourceKind`
     (`actor`/`terrain`/`entity`/`environment`), `RuleDelivery` (incl.
     `reflected`/`triggered`), `RuleMovementMode`, and `Provenance`
     (source identity DISTINCT from delivery kind); `sameCausalOrigin`
     preserves the true initiating actor through reflected/secondary
     delivery (never white-outs the original owner/source);
     `provenanceOfMutation` derives a provenance at each resolve point.
     Domain-specific provenance (`attackDamageProvenance`, `delivery` on
     damage mutations, `cause: TurnEndCause`, movement-entry `voluntary`)
     stay as documented retained specialists.
  2. **U10 — `primitives/facts.ts`** (barrel re-exported): the
     exactly-typed discriminated `Fact` union (ability-used / attack-resolved /
     damage-applied / actor-defeated / collide / movement / effect /
     entity / terrain / save-resolved / trigger-resolved) with the
     smallest common envelope (deterministic `instanceId`, sourceId,
     ownerId, U9 provenance); `recordFacts` records at each resolve
     point (pure — same event sequence yields the same fact
     sequence, never re-derived from mutable state); LIVE `effectExistsLive`
     (rejects on an unrepresentable specific instance identity); the
     `trigger-resolved` de-dup marker + `hasResolvedAsFact` read.
  3. **Consumer migration — `kernels/resolution-triggers.ts`** now records
     facts via `recordFacts`, merges the domain collide/slay facts
     (spatial + defeat authority), and projects the byte-compatible
     `ResolutionTriggerFacts` surface encounter.ts consumes
     (behavior-preserving; the `slay` trigger resolves only on a true Slay,
     p.95 — `viaSlay` — never an explicit instant-defeat mutation). The
     damage/held/save ledgers remain domain-specific specialists whose
     fuller fact composition is U12-scoped.
  4. **U6 COMPLETED** with `effect-still-exists` (T4): reads U10
     instances via `effectExistsLive` against the target's LIVE effect
     surfaces — the general active-effect state authority stays in its
     domain; U6 only reads through the generic reference/fact seam.
  5. **U16 COMPLETED** (U10-backed de-dup): the full resolve identity
     (`resolveIdentityKey`) = the corrected usage identity (source + owner
     + scope) + RESOLUTION id + logical trigger — RESOLUTION-scoped
     once-per-ability semantics (a second use of the ability may trigger
     again; three Collide facts open ONE step). `hasResolvedAsFact`
     answers "has this logical trigger step already resolved within this
     resolution?" over the recorded history and is WIRED into the real
     reactive continuation. EVENT de-dup is semantically distinct from the
     `used-scope` entitlement COUNTS.
  Residuals (honest, staged): the interrupt-uses counter and
  attacked-this-turn/end-turn flags typed-ledger migration (T6); the
  damage/held/window + save ledgers' fuller fact composition (U12); the
  AREA/PERSISTENT-INSTANCE/RULE-SOURCE query domains (U10/U12-scoped);
  U11/U12/U13 execution land in T5. No source-unit wiring; census unchanged
  (427).

- **Phase T5 — Execution: U11 FLOW, U12 CONTINUATION, U13 WINDOW —
  LANDED (2026-08-30).** Three sub-tranches, full suite green at each step
  (1683 → 1693 → 1519 rule tests), census byte-stable at 427 throughout,
  all audits green, no source-unit promotion, no unresolved-unit wiring.
  1. **T5a — U11 core FLOW/SEQUENCE** (`kernels/execute-flow.ts`):
     `executeRuleProgram` plans every action against a PURE SIMULATED
     intermediate encounter state (the reducer's own sequential
     projection, U15 atomic groups included) so later effects observe
     earlier effects' results; the durable ordered mutation list stays
     the replay payload. `U1` bind/bound-selector propagation and `U10`
     emit-fact ride the flow. A corrective made the bastion
     Collide-or-Heroic trigger steps select their command-supplied
     referent (p.122/p.123) instead of a stale pre-shove range re-check.
  2. **T5b — U12 CONTINUATION/SUSPENSION core**
     (`primitives/continuation.ts` + `kernels/continuation-runtime.ts`):
     the typed `ArmedContinuation` with the explicit DEFERRED-RULE vs
     HELD-RESULT payload discriminant, LIVE/CAPTURED refs, captured
     values, Clock/Fact triggers, expiry, U17 ordering identity; pure
     `armContinuation`/`resumeContinuation` (zero fresh decisions/RNG).
     `EncounterState.continuations` (schema 8) with the reducer as the
     single arming point. Great Giorgios moved off the `delayed`
     lifecycle recipe onto an armed continuation; the Sucker Punch held
     save rides a held-result continuation.
  3. **T5c — U13 WINDOW/DECISION POINT — landed**
     (`kernels/decision-window.ts`): ONE `DecisionWindowRecord` replaces
     `trigger-window.ts` (deleted), the `EncounterPendingInterrupt`
     schema (deleted; compat alias), per-window heldDamage/heldSave/
     heldResult fields (gone — every window carries a U12 held
     `heldPayload`), and `pendingInterrupts` (→ `decisionWindows`,
     schema 9). `choice` windows answer through the recorded
     `ANSWER_DECISION_WINDOW` command; U17 ordering is the one ordering
     authority (LIFO stack, p.107 turn-order, owner-order yields a U4
     choice); `DAMAGE_WINDOW_RECIPES` is the when-damaged/defeated
     eligibility registry (p.107/p.128/p.138). The Great
     Giorgios "may rush" is now a recorded decision (the T5b-era
     automatic rush was a documented approximation, repaired — decline
     legal, accept reads THEN-CURRENT positions, Dragonslayer distinct).
     U11 `open-window`/`suspend` wired through U13 (flow resume seam);
     Vigilance stays a triggered EFFECT (not a window); `resolveGamble`
     stays the deterministic dice operation (only genuine decisions
     become windows); the U12 fact-trigger correlation seam records the
     specific `instanceId`. Acceptance: `t5a-u11-flow.test.ts` (12),
     `t5b-u12-continuation.test.ts` (10), `t5c-u13-decision-window.test.ts`
     (17) — all adversarial.
  Remaining before T6: the separate T6 gate is NOT satisfied — the
  interrupt-uses/turn-attack/end-turn typed-ledger migration, the
  AREA/PERSISTENT-INSTANCE/RULE-SOURCE query domains, the opaque
  ability-use-choices fold, the U4 `choose` flow node, and the remaining
  delayed-lifecycle consumers (Polaris/Carnevale) are still staged.

- **T6.2 — U17 recorded same-owner ordering — LANDED (2026-08-31).**
  Closed the U17 gap where multiple effects owned by the same character
  resolve at the same time and ICON grants that character the right to
  choose their order: the engine now routes that ordering through the
  existing U4 Choice + U13 Decision Window machinery and records the
  selected order durably, instead of failing closed or inventing a
  deterministic order. Full suite green (1771 tests), census
  byte-stable at 427 (no source-unit promotion), all audits green.
  1. **U17 (`primitives/ordering.ts`) stays the ONE ordering
     authority.** New `orderingIdentity` (canonical per-candidate key:
     effect instance id, else source id + owner id), `sameOwnerOrderingDecision`
     (     the minimal pending-candidate set whose ordering is a same-owner
     controller decision; `ownerId` derived from the U2 role frame —
     never ad-hoc actor-id assumptions) and the problems it reports
     (`not-a-tie`, `missing-candidate-owner`, `cross-owner` — unknown
     ownership never silently means same-owner);
     the raw ordering policy vocabulary (`OrderingPolicy`/`applyOrdering`/
     `policyYieldsChoice`) is untouched, and every existing source-defined
     policy (source-order, stack, turn-order, hostile-before-beneficial,
     non-active-owner-first) still resolves automatically without opening
     a choice window.
  2. **U4 (`kernels/choice.ts` + `primitives/types.ts`) owns decision
     legality.** `RuleChoice` gains the typed `ordering` kind with
     `candidates`/`ownerId`; `resolveChoice` validates it as a strict
     permutation of the exact pending candidate set — missing, duplicate,
     unknown, extra, or non-permutation answers reject with typed codes
     (`choice.ordering.required` / `.duplicate` / `.unknown` /
     `.incomplete` / `.extra`); the responder is authorized through the
     existing `choiceEntitledPlayer` U2 role machinery (declared chooser,
     else controller, else source).
  3. **U13 (`kernels/decision-window.ts`) owns the window.** One generic
     `resolvedOrder` field on `DecisionWindowRecord` (no quasi-window
     `pendingOrdering` record); `openOrderingDecisionWindow`
     (`openedBy`/`triggeredAt` stamped like every other window),
     `recordOrderingDecision` (validates via `resolveChoice`, stamps the
     window, and drains it — the answer is consumed exactly once, then
     the window closes), `pendingSameOwnerOrdering` (the live seam the
     reducer consults), and `consumeOrderingDecision` (turns the
     recorded order into a concrete total order of the pending set with
     NO re-derivation); ordering windows ride the existing LIFO
     stack/turn-order discipline (a same-owner decision never bypasses
     an earlier pending interrupt window).
  4. **`encounter.ts` wires the seam.** The reactive-trigger fold
     detects the same-owner simultaneous set (all pending effects of
     one owner, no unique source-defined order), opens the ordering
     window instead of failing closed, and the `ANSWER_DECISION_WINDOW`
     boundary stamps `resolvedOrder` durably (schema 10). While the
     window is pending, dependent resolution suspends at the decision
     point (nothing partially executes); after answering, each pending
     effect resolves exactly once; re-answering a closed window rejects;
     replay consumes the recorded order with zero fresh choice and zero
     dependence on array/registration order.
  5. **Room boundary (`src/rules/vtt-room.ts` + `server/rooms.ts`).**
     The `DECISION_ANSWERED` event joined the room validator's
     `eventTypes` (a genuine pre-existing gap: T5c choice answers emit
     it durably but no room-level test exercised that path, so such
     checkpoints were invalid); `resolvedOrder` rides the canonical
     window projection; the server answers authorize the responder
     through the same U2 chooser derivation (wrong player rejects).
  Acceptance: `t6-2-u17-recorded-ordering.test.ts` (30 cases: positive
  A→B/B→A distinct outcomes, choice validation incl. responder + partial /
  duplicate / unknown / extra permutation rejects, boundaries 12–15 incl.
  3+ candidate full-permutation, suspension 16–19, replay 20–22 with
  permuted-input invariance) + a room-level responder-authorization test.
  Residual (honest, staged — NOT claimed by T6.2): turn-boundary ordering
  consumers (hostile-before-beneficial / non-active-owner-first) still
  route through the scheduler/lifecycle authority rather than the recorded
  U13 seam; U17 remains PARTIAL with exactly that residual — closed by
  T6.3 below (2026-08-31).

- **T6.3 — U17 turn-boundary ordering consumers — LANDED (2026-08-31),
  U17 now COMPLETE/AUTHORITATIVE.** Finished the remaining U17
  turn-boundary consumers so ICON's p.108 explicit turn-boundary ordering
  rules are enforced by the generic ordering authority rather than by the
  lifecycle recipe registration order.
  1. **Durable turn-boundary candidate representation.** `lifecycle.ts`
     now plans a per-phase candidate record per pending lifecycle effect
     at the command boundary (source id + mechanical owner + owner side) —
     a `TurnBoundaryCandidatePlan` recorded in the F3 intent's `phases`
     field; source/owner/carrier/active/chooser are never conflated, and
     the generic representation never assumes a source id alone is
     sufficient. Recipes declare their mechanical owner via `ownerOf`
     (defaulting to the boundary actor; a recipe with no mechanically
     relevant effect returns null and is excluded from arbitration).
  2. **U17 owns turn-boundary ordering.** `primitives/ordering.ts` gains
     `turnBoundaryOrdering`, a pure composition of the p.108 rules:
     non-active-owner-first → hostile-before-beneficial (WITHIN each
     ownership group; bullet 1 is the stronger rule and is never
     reversed) → the first same-owner tie yields the recorded U4 ordering
     decision (T6.2 seam) → a remaining cross-owner/missing-owner tie
     FAILS CLOSED. Never one numeric priority; never array/registration
     order as a game rule.
  3. **U13 + reducer resolve the deferred tie.** `runLifecyclePhase` /
     `runLifecyclePhaseForAll` route the recorded plan through
     `turnBoundaryOrdering`, deferring exactly a same-owner tie onto ONE
     U13 ordering window (a `heldBoundary` field on the window record
     carrying the tied effects + the recorded dice windows). The
     `DECISION_ANSWERED` reducer validates the recorded order as a full
     permutation and resolves the deferred effects in exactly that order —
     each pending effect resolves exactly once, never re-derived, never
     registry-ordered, with no partial execution past the decision point
     while pending.
  4. **Expiry boundaries route through U17.** `expireBoundaryEffects` and
     `orderCrossCharacterEffects` delegate to `turnBoundaryOrdering`; the
     previous expiry listing-order tie-break is REMOVED (the Dervish aura
     expiry that pinned it is now a same-owner recorded decision).
  5. **Registration order demoted, phases preserved.** The lifecycle
     registry insertion order is now discovery/enumeration + the legacy
     pre-T6.3 replay fallback only — never a mechanical ordering
     authority. Lifecycle phases (turn-start / turn-end / delayed /
     round-start / round-end) keep their source-defined sequencing and
     interrupt windows keep their separate priority/stack mechanics.
  Acceptance: `t6-3-turn-boundary-ordering.test.ts` (27 cases: deterministic
  bullet-1/2 ordering + registration-order permutation invariance,
  same-owner A→B/B→A recorded choice, 3+-candidate full permutation, wrong
  responder, permutation validation, fail-closed cross-owner +
  missing-owner, suspension/exact-once, replay with permuted input,
  interrupt/phase boundaries) + pinned `aura`/`turn-transition`/`conditions`
  F3-plan cases + `rooms.test.ts` heldBoundary window seed. Full suite green
  (1798 tests), census byte-stable at 427 (no source promotion). A fresh
  audit confirmed no other genuine U17 consumer remains — U17 is COMPLETE.

- **T6.4 — U16 raw usage-field consolidation onto the typed ledger.**
  `DONE`. Classified and migrated `interruptUses`, `interruptUsedThisTurn`,
  `slashedTriggeredThisTurn`, `dangerousTerrainTriggeredThisTurn` onto typed
  `ledger:*` entries and REMOVED them from the `EncounterActor` type + VTT
  checkpoint schema (bumped `ENCOUNTER_SCHEMA_VERSION` to 11; the migration
  folds legacy values 1:1 and drops the raw fields deterministically). Added
  the `any-turn` per-actor period for the ACTOR-LOCAL one-interrupt-during-
  any-turn window (p.91), Slashed once-per-turn (p.116) and dangerous-terrain
  once-per-turn (p.89). Split the one-attack gate
  (`ledger:turn:core:attack-this-turn`) from the `attackedThisTurn` U10
  resolution fact (the fact stays as a documented specialist). Routed
  use-ledger reset recipes through ownerless maintenance noops so the reset
  never fabricates a U17 same-owner tie. Verification: `t6-4-usage-global-
  ledger.test.ts` (9 adversarial cases), full suite green (1808 tests),
  architecture audit guard (`bespoke-u16-entitlement-field`) + test added,
  census byte-stable at 427 (no source promotion). Next smallest-first
  blocker: U2 role-consumer routing.

- **T6.4a — U16 corrective closure (this tranche).** `DONE`. Corrected the
  T6.4 one-interrupt-per-turn window from battlefield-GLOBAL to ACTOR-LOCAL
  (the p.91 passage's subject is the character; removed the
  `interruptWindowUsedBy` battlefield scan so one actor's use never closes
  another's window; Black Rock Vanguard is an actor-scoped cap). Re-audited
  and MIGRATED `usedAbilityIds` (No Repeats — per-source any-turn marks) and
  `standardMoveUsed` (owner-relative `turn` gate distinct from Dash) to
  typed `ledger:*` keys and REMOVED them from the `EncounterActor` type +
  checkpoint schema (schema 12; fold-then-drop). Recorded the dangerous-terrain
  damage-cadence contradiction (p.89 once-per-turn vs the p.183 Harvester
  reprint once-per-round) as adopted adjudication
  `icon-1.5:dangerous-terrain:damage-cadence` (once per turn). Architecture
  guard now forbids restoring `usedAbilityIds`/`standardMoveUsed` as
  bespoke U16 fields. Verification: `t6-4-usage-global-ledger.test.ts`
  (17 adversarial cases), `source-adjudications.test.ts` pin, full suite
  green (1818 tests), admission tests green, census byte-stable at 427 (no
  source promotion). The six §8 U16 closure gates are now all met
  (actor-local interrupts; `usedAbilityIds`/`standardMoveUsed` migrated; the
  dangerous-terrain adjudication recorded; no competing authority; the named
  acceptance suite green) — the gate report registers the resulting status
  rather than treating the raw-field removal as proof. Next smallest-first
  blocker: U2 role-consumer routing.

- **T6.4b — U16 corrective closure (this tranche).** `DONE`. Audited every
  remaining U16 command/window surface and resolved the live semantic holes a
  T6.4a review found: generic `EXECUTE_RULE` interrupts now authorize through
  the SAME `interruptLegality` U16 gate as `USE_ABILITY` (actor-local
  one-per-turn window, named interrupt's between-turn pool, No Repeats),
  rejected BEFORE any resolver effect or RNG; p.290 Repeatable is an
  ACTION-TAG decision (`noRepeatsApplies`) shared by command and reducer
  (foe Bull Rush/Bash/Hurl and a new generic `repeatable` mastery-modifier
  family that makes mastered Phantom Bolts' same-turn retrigger legal while
  the reducer records NO fabricated usage mark); reactive window discovery
  keys No Repeats by the interrupt's own sub-action id (a used Endless
  Battlement stance never blocks its distinct Heroic Intervention); Black
  Rock Vanguard provably lifts ONLY the actor-local per-turn cap — No Repeats
  and each interrupt's pool remain independent. `used-scope` vocabulary
  reuses the canonical `UsagePeriod`. No durable shape changed => schema
  stays 12. Verification: `t6-4-usage-global-ledger.test.ts` (+6 T6.4b
  adversarial: Repeatable-restricted-to-No-Repeats, action-cost still
  applies, cross-actor non-alias, non-Repeatable second-use rejection,
  EXECUTE_RULE interrupt zero-RNG reject, BRV×No-Repeats×pool), full suite
  green (1824 tests), strict fidelity clean, census byte-stable at 427 (no
  source promotion). U16 remains the single executing usage/entitlement
  authority. Next smallest-first blocker: U2 role-consumer routing.

- **U16 residual-usage-state census (this tranche).** `DONE`. Per the
  exhaustive-census mandate, audited current HEAD for every live
  state/read/write/reset that could answer a usage/entitlement question.
  Genuine once-per-scope marks migrated onto typed U16 ledger keys:
  `chain-reaction-used` → `chainReactionOncePerRoundKey` (round, actor-local),
  `incubus:triggered` → `incubusOncePerRoundKey` (round, mark owner),
  `stampede:triggered` → `stampedeOncePerRoundKey` (round, mark owner),
  `gates-of-hell:vigilance-rushed` → `vigilanceRushOncePerTurnKey` (any-turn),
  `midas:used` → `midasOncePerCombatKey` (combat, cap 2), and
  `bull-s-strength:collided` → `bullStrengthOncePerTurnKey` (owner-relative
  turn; the bespoke turn-end clear removed in favor of the shared
  core:turn-ledger-reset). RETAINED with disjointness proof: `damage-immune`
  (MODE state — negative-substitute + boundary adversarial tests), recorded
  facts with no gate reader (`sucker-punch:used`), and armed/charged mode
  (`wicked-sheath:charged`, `riposte:armed`, `revenge:active`, `hissatsu:armed`,
  `ace:armed`, `trick-shot:armed`, `carnevale:armed`) + `monogatari:granted`
  (once-per-song content boundary, not a U16 UsagePeriod). Governance:
  architecture-audit test pins the six migrated keys + a ban on the raw
  fields, and the kernel source-id exemption allowlist includes the new gate
  provenance. Verification: `u16-residual-census.test.ts` (+1, 6 cases),
  `attack-modifiers.test.ts` updated to the typed key, architecture-audit +
  strict fidelity clean, census byte-stable at 427 (no source promotion), full
  suite green. The smallest next underlay tranche from the post-migration
  fresh audit is **U8 duration/timing/scheduler surfaces** (`RuleDuration` /
  `RuleTiming` / lifecycle / scheduler), which remains PARTIAL beside
  U14/U9/U6/U12/U4/U5/U7.

- **T7 — U2 role-consumer consolidation (this tranche).** `DONE`. Made
  `primitives/roles.ts` the single semantic authority for "relative to whom is
  this clause interpreted?" by migrating the remaining executing duplicate
  authorities instead of inventing a new abstraction. Classification:
  migrated — `kernels/candidate.ts` (relation perspective via
  `relationPerspectiveIdFromContext`, rejects on underivable),
  `kernels/aura.ts` (separated SEMANTIC `perspectiveActorId` (U2) from the
  SPATIAL anchor `actorId`/`entityId` (U7); an ownerless/neutral entity-origin
  aura has NO derivable ally/foe — only `characters` relations apply),
  content `chanter-programs.ts` stance-aura seam; retained specialists with
  disjoint responsibility — `targeting.ts` `matchesTargetRelation` is
  parameterized U3 eligibility (the caller supplies the U2-derived
  perspective), decision-window/choice responders already routed through
  `resolveRoleSelector`/`choiceEntitledPlayer` subject-relative and reject,
  the save-rolled window responder is the U16 interrupt entitlement. `roles.ts`
  gains `relationPerspectiveId`/`windowResponderId` (the latter a thin facade
  over `resolveRoleSelector`, pinned by tests). Architecture guard added:
  `u2-perspective-authority` detects a migrated consumer dropping its U2
  symbol or aura.ts re-deriving ally/foe from the anchor/owner side (`origin.side`,
  `.side ?? null`) — deliberately NOT a global ban on `.side`/`ownerId`/`actorId`.
  No durable shape changed; census stays 427; address the UNDERLAY PHASE gate
  verdict (still OPEN on U8/U14/U9/U6/U12/U4/U5/U7). Tests:
  `t7-u2-role-consumers.test.ts` (12 adversarial) + architecture-audit U2
  guard cases; full suite green.

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

- Character schema v5, import/export, migration v1→v5 (narrative selections
  persist permanent canonical IDs; display names never persisted): `DONE`.
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
