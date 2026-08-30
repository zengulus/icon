# Underlay Completion Plan (U1–U17)

Authoritative ontology: [`generic-underlays.md`](generic-underlays.md). This
document turns Part A of that ontology into an executable engineering plan.
It does **not** invent a competing abstraction hierarchy: the underlay
definitions, the design test, the domain-authority table (Part B), and the
structural-subsystem list (Part C) of `generic-underlays.md` are the
contracts this plan operationalizes.

Authority hierarchy (unchanged):

- ICON 1.5.pdf — semantic authority.
- Implementation — execution authority.
- Generated audits (`audit:automation`, `audit:class-job-census`,
  `audit:source-fidelity`) — coverage authority.
- This document and `generic-underlays.md` — planning authority only. Never
  change implementation merely to make a planning document correct.

Phase mandate for the entire plan:

- **No source-unit wiring.** No currently unresolved talent, mastery,
  ability, foe ability, relic, class trait, or job trait becomes executable
  during this phase. Promotion is a post-gate activity (§Gate).
- **No source-ID branches** in kernels or primitives. Source IDs ride
  content rows and opaque provenance only.
- **No bespoke mechanics** created because one source rule needs them. When a
  rule needs a capability the substrate does not express, the capability is
  decomposed onto an underlay + domain authority, or the rule stays
  unresolved (§20 of AGENTS.md).
- **No approximation** to improve census counts.
- The "next greedy family" sequencing in TODO.md/roadmap.md is **superseded**
  for this phase. The order below is dependency-driven; blocker-family notes
  per underlay are information only, never ordering input.
- Existing source-specific wiring must continue to work. New work is generic
  substrate and **behavior-preserving migration** only.
- Preserve `content → kernels → primitives`.
- Preserve command/event purity and deterministic replay: randomness and
  decisions happen once at the command/window boundary and ride recorded
  events; `applyEvents` never re-decides.
- `primitives/types.ts` and `kernels/runtime.ts` remain compatibility
  barrels during incremental extraction. No flag-day file-layout refactor
  (the split plan in `generic-underlays.md` §"Incremental file split plan" is
  executed only as a tranche needs it, and always via `export *` barrels).
- A new top-level underlay beyond U17 (including U18/U19) requires passing
  the design test in `generic-underlays.md`; U18/U19 are evaluated in
  §Candidates, not assumed.

---

## 0. Audit correction: landed slice vs complete contract

The audit in this document is **code-based**. Do not infer an underlay's
state from the tranche documents (`tranche-1-choice.md`,
`tranche-2-query.md`) or from prose in TODO.md. Every U-number below states
its own `Current state` from the code at HEAD.

## 0. Audit correction: landed slice vs complete contract

The audit in this document is **code-based**. Do not infer an underlay's
state from the tranche documents (`tranche-1-choice.md`,
`tranche-2-query.md`) or from prose in TODO.md. Every U-number below states
its own `Current state` from the code at HEAD. This section separates the
HISTORICAL audit finding from the CURRENT implementation — earlier versions
of this document mixed both under "current HEAD", which this revision fixes.

### Historical audit finding (at the earlier HEAD, commit 7a000d…)

`docs/tranche-2-query.md` claimed U3 landed, but the code at that HEAD did
not support the claim:

- `kernels/candidate.ts` implemented an **actor-only** slice
  (`evaluateActorCandidates` / `validateActorCandidate`). There was no
  `Query<T>` over positions, terrain cells, entities, areas, persistent
  instances, marks/stances, or rule sources.
- `ActorCandidateQuery.rangeOrigin` was declared but **never resolved from
  its selector** — it always fell back to `context.actorId`; the selector
  argument was dead weight (the U7 ANCHOR seam, left inert).
- `kernels/runtime.ts::selectActors` **independently implemented
  automatic-target eligibility** for every selector branch via
  `primitives/targeting.ts` `eligibleTargets` plus inline range checks with
  its own `distance` helper — a second eligibility authority.
- `primitives/targeting.ts::queryDirectTarget` was a third, parallel
  direct-target authority (relation/range/Blind/Stealth/LoS), and
  `computeSpatialArea`'s `includedActorIds` a fourth area-inclusion
  authority.

### Current implementation at HEAD (corrective pass 2026-08-30)

All four historical findings are routed through the one authority:

- `primitives/anchor.ts` (U7 vocabulary) + real `rangeOrigin` resolution in
  `kernels/candidate.ts::resolveSpatialAnchor` (fail-closed on malformed
  anchors; relation stays with the acting actor, range moves to the anchor).
- `selectActors` is a thin adapter over `kernels/evaluate-query.ts`
  `evaluateActorQuery` — including the `input` selector's range legality,
  which now routes through the same U3 candidate authority (the legacy
  `choice.actor-range` enforce-throw contract is preserved verbatim; no
  second p.92 range algorithm remains in the adapter).
- The direct-target gate's base eligibility routes through
  `validateActorCandidate`; the direct-target specialist reads (Blind,
  Stealth, True Strike, LoS) stay at the gate.
- Area actor-inclusion reads through the `insideArea` query operator; the
  spatial gateway keeps the cell geometry.
- Resolver sugar (free-cell scans, teleport destinations, nearest reads)
  routes through the position-domain operators
  (`evaluatePositions` with explicit space/ordering policies,
  `validatePositionLegality`, `nearestCandidates`).

**Corrective-pass corrections (2026-08-30) beyond the historical list:**

- **Nearest semantics.** `nearestCandidates` returns the COMPLETE
  minimum-distance set with NO invented tie-break (the old
  `nearestCandidate` sorted ties by actor id — not a valid ICON rule; e.g.
  ICON p.143 Dark Knight grants the player the choice among equidistant
  foes). `rushTowardFoes` answers through the same min-distance selection
  and fails closed on equidistant ties. Two abilities were RETRACTED from
  executable because their nearest reads resolved a player choice
  deterministically: `knave:dark-knight` (p.143 "If multiple foes are
  equidistant, you may choose") and `stormbender:eye-of-the-storm` (p.236
  "If an ally is in the center space, they may fly 4" — a free
  player-chosen flight; the old "away from the nearest foe" direction was
  invented). Their resolvers now fail closed on the unrepresentable clause;
  the eye-of-the-storm talent 2 (whose only execution path was the
  retracted resolver) is retracted with them. The `includeDefeated: true`
  flags those two call sites carried were unjustified ("closest foe to you"
  cannot include defeated characters) and were dropped.
- **Position domain honesty.** The position slice is a FREE/UNOCCUPIED
  specialist, not the complete U3 position domain: `evaluatePositions`
  takes an explicit SPACE policy (`any` — every in-grid space, per p.92
  "Space: Any space in range, and any characters or objects occupying it` —
  or `unoccupied`) and an explicit ORDERING policy (default `none`).
  Occupancy is a query policy, never built into the definition of a
  position candidate; teleport/placement legality remains a specialist
  (`validatePositionLegality`).
- **Occupancy audit.** `primitives/job-kit.ts::occupied` is an OBSTRUCTION
  test: characters + OBJECT entities block (p.95 "Objects … provide
  obstruction"), intangible summons do NOT (p.95 summons "don't cause
  obstruction or engagement"). The old predicate treated every entity as a
  blocker. Distinct concepts — a space containing something; unavailable
  for a particular placement; an obstruction; teleport unoccupied;
  object/summon placement rules — are NOT collapsed into one boolean
  (bomb-can't-share-with-bombs is a specialist constraint in the bomb
  placement resolver).

### T1 landed (2026-08-30): U1/U2/U8 vocabulary foundation

Phase T1 delivered the typed vocabulary for U1 REFERENCE, U2 ROLE, and U8
SCOPE/CLOCK (`primitives/reference.ts` / `roles.ts` / `scope.ts`, all
re-exported through the `primitives/types.ts` barrel), behavior-preserving:
zero existing test deltas, no consumer migration, no source-unit wiring,
census unchanged at 427. The pre-flight audit also corrected the U3
residual classification (see the next section): the ACTOR domain itself
still lacks contract operators (LoS/LoE composition, occupying-position,
terrain predicate, owned/controlled, union/intersection/difference, count,
distinct-by-identity), and the p.108 line-of-sight predicate is missing
from teleport/placement legality (classified as a deliberate T2 boundary,
not silently enforced). U1/U2 moved ABSENT → PARTIAL; U8 stays PARTIAL
(vocabulary + boundary-read surface landed; the RuleDuration/use-ledger/
lifecycle reader migration is the remaining completion work).

Pre-flight audit (2026-08-30, T1 pass): the docs at HEAD already claimed
U3 PARTIAL with a residual list — that claim is TRUE, but the residual
list understated two boundaries, now classified explicitly:

- **The ACTOR domain itself lacks contract operators.** The U3 contract's
  composable-operator list (LoS, LoE, occupying-position, terrain
  predicate, flying/intangible, owned/controlled-by,
  union/intersection/difference, exclude-prior-recipients, count,
  distinct-by-identity) is only partly implemented in `evaluateActorQuery`
  (relation/range/adjacency/within-origin/condition/mark/summon/
  insideArea). LoS is still a specialist read at the direct-target gate
  and the burst-center filter (`line-of-sight.ts`); it is NOT a query
  operator. LoE defaults to true and is not query-composed at all. The
  residual is therefore not merely "other domains" — the actor domain
  itself remains partial.
- **Teleport/placement legality omits the p.108 LoS predicate.** ICON
  p.108: "For a space to be valid for summoning, teleporting, or creating
  objects, unless specified it must be free and unobstructed, and you also
  need line of sight." At the T1 pass `validatePositionLegality` expressed
  only in-grid → range → occupied, and neither the teleport-choice kernel
  nor the spatial gateway added LoS for teleport destinations
  (entity-creation checked creator LoS; the teleport path did not). This
  was CLASSIFIED as a deliberate T2 boundary, not silently changed in that
  pass. **T2 (2026-08-30) RESOLVED the boundary through the generic
  authority:** `PositionLegalityQuery`/`PositionQuery` gained the
  `lineOfSightFrom` policy, `validatePositionLegality` reports a
  `line-of-sight` problem after occupancy, and the teleport kernel's
  player-chosen destinations now route through it (`move.line-of-sight`,
  with a behind-the-wall rejection fixture + a clear-line control fixture
  in `spellblade.test.ts`). Entity/object creation already checked creator
  LoS through the shared kernel. The reducer movement gateway remains the
  movement authority (documented boundary): forced/derived teleports
  (save-driven or swap legs) have no source-defined LoS origin.

Other residual U3 work:

- Query domains beyond actors/positions: terrain cells, entities, areas,
  persistent instances, marks/stances, rule sources.
- Ordering policies beyond the min-distance set (`nearestCandidates`) —
  first/last/nth only where the SOURCE defines them.
- The position slice covers the in-grid space + unoccupied/any policies;
  the movement/placement LEGALITY gateway (spatial gateway) stays the
  movement authority; `rushTowardFoes`' direction fallback (a player
  choice) remains an approximation flagged in the U3 row.

### Landed-slice ≠ complete-underlay

The same **landed-slice ≠ complete-underlay** distinction is applied to every
U-number: e.g. `kernels/trigger-window.ts` + `save-window.ts` +
`gamble-window.ts` + `pendingInterrupts` each handle wired cases, but U13
WINDOW as a single generic decision-window record does **not** exist yet.

State vocabulary used below:

- `ABSENT` — no dedicated vocabulary/authority; semantics are implicit,
  scattered, or represented ad hoc per consumer.
- `SKELETON` — one or more partial implementations exist for specific wired
  cases, but no generic underlay contract, no typed vocabulary of its own,
  and/or no single owning authority.
- `PARTIAL` — a typed vocabulary and/or a single authority exists for a
  subset of the contract; the full contract (all domains, all required
  semantics) is missing and duplicate authorities remain.
- `AUTHORITATIVE` — one typed vocabulary + one owning authority + required
  tests for the complete contract; no known duplicate competing authority
  within its declared scope.

---

## 1. Per-underlay contracts

For each of U1–U17: semantic responsibility + non-responsibilities; source
evidence; current state; locations that partially own/duplicate the
authority; intended single authority + dependencies; typed vocabulary;
replay semantics; acceptance tests; consumers to migrate; blocker families
enabled (information only).

Page references follow the canonical extracted manifest
(`scripts/extract-icon.ts`) and the verified citations already present in
`generic-underlays.md` and code comments. **Before a tranche that consumes a
passage lands, re-verify the exact page and reading against ICON 1.5.pdf** —
the PDF is semantic authority, this document is not.

---

### U1 Reference / Binding

**Semantic responsibility.** The one typed way to name a thing/value a later
rule clause refers to: actor, entity/object/summon, battlefield position,
area, terrain effect, persistent effect, mark/stance, resource pool,
rule/action/source, roll/result, number/value, and collections of
references. Includes **binding** names from earlier operations
(`CHOOSE a position AS landing`, `QUERY adjacent foes AS nearby`,
`BIND slain actors AS slain`). Explicitly distinguishes:

- **LIVE reference** — resolve against current state at use time
  ("at the start of its next turn, damage adjacent characters": retain the
  actor ref; query its then-current position).
- **CAPTURED value/reference** — preserve the source-required value/state
  from the earlier point ("at end of turn, explode at the chosen space":
  capture the position; "return relative to your original location": capture
  the position).

**Non-responsibilities.** Not a query language (U3 owns eligibility); not
role semantics (U2 owns "relative to whom"); not spatial measurement (U7
owns anchors); not the serialized context bag (`context.actorId`,
`attackTargetId`, `triggerSourceId`, `damageRecipientId` are legacy
implicit refs to be replaced, not extended).

**Source evidence.** The distinction is pervasive: "Teleport X: move
instantly to an unoccupied space within range X" (p.88) consumes a
player-chosen position (a captured ref); "at the start of its next turn"
effects (p.94 statuses/durations, p.105 triggers) re-resolve the actor's
then-current state (live refs); listed-order resolution (p.85, p.107 §4)
means later clauses refer to earlier operations' outputs; "return relative
to your original location" (p.122 Heroic Intervention return; p.163 Shadow
Play; p.300 Redondo) captures a position; marks/stances/terrain effects
(p.94, p.95, p.104) are referenced by later rules (mark detonations,
terrain entry effects p.151/p.353). The proliferation of bespoke context
fields is the warning this underlay removes.

**Current state.** `PARTIAL` (T1 landed 2026-08-30; corrected 2026-08-30):
`primitives/reference.ts` defines the typed `Reference<D>` vocabulary —
LIVE refs named by legacy slot / direct id / bound name; CAPTURED refs are
SELF-DESCRIBING discriminated kinds (`captured-actor` carries only an
actorId, `captured-position` only a Position, etc.) narrowed by the
generic D, so a captured actor structurally cannot hold a position literal
and a captured position cannot hold an actor id; `collection` refs preserve
their element domain (`Reference<D>[]`); the plural `trigger-targets` slot
(`liveTriggerTargets`) resolves to an ORDERED COLLECTION of every recorded
target (never one member; an absent slot is a legitimate empty collection,
distinct from a missing singular slot). `Binder`/`bind`/
`lookupBound`/`EMPTY_BINDER`, the deterministic `resolveReference` surface
(captured literals never re-read later state; bound names resolve the
bound reference but are DOMAIN-CHECKED via `domainOf` — a bound actor ref
resolving to a bound position is `domain-mismatch`, reject; missing actor/
entity/slot/position reject fail-closed), plus `domainOf`/`referenceKey`.
`RuleExecutionContext.boundNames` carries the Binder
(optional, behavior-neutral). Tests: `reference.test.ts` (positive
captured-exactness + live re-resolution + binder/collection + ordered
plural targets, negative unbound/missing-slot/domain-mismatch, boundary
empty-collection + defeated-actor-captured, replay identical-literal +
Binder purity). The legacy slots (`context.actorId`/`attackTargetId`/
`triggerSourceId`/`triggerTargetIds`/`damageRecipientId`) remain the
LIVE refs' resolution sources — migrating consumers onto typed refs is the
T2+ de-dup work. `RuleContinuationState` still carries no refs across
continuations (U12).

**Locations partially owning/duplicating.** `context.actorId`,
`context.attackTargetId`, `context.triggerSourceId`, `context.triggerTargetIds`,
`context.damageRecipientId`, `RuleExecutionInput` buckets
(`primitives/types.ts`); `RuleSelector` kinds (`primitives/types.ts`);
`resolutionFacts` (`primitives/types.ts`); `RuleContinuationState`
(`primitives/types.ts`, `src/rules/encounter.ts:1106-1154`);
`RuleRuntimeState` keys; mark/terrain/entity ids referenced ad hoc in
resolvers and kernels.

**Intended authority.** `primitives/reference.ts` (barrel re-exported from
`primitives/types.ts`): `Reference<T>` with `{ kind, live | captured }`,
`Bind`/`Binder` maps, and `resolveReference(ref, context)`. Dependencies:
none (foundation). Consumed by U3 (query targets), U5 (value operands), U6
(predicate operands), U7 (anchors are refs), U9 (provenance refs), U10
(fact refs), U12 (continuation refs), U14 (owner/reference on the recipe).

**Typed vocabulary.** `Reference` union over the domain kinds above; explicit
`live` vs `captured` discriminator; `BoundName` map carried on the execution
context and, later, on continuation records; collection refs (`refs[]`).
References are structural (typed), never stringly property paths.

**Replay semantics.** A captured value is a durable literal once captured;
a live ref re-resolves against replay state. Replay must never re-derive a
captured value from later state. No hidden resolution paths.

**Acceptance tests.**

- Positive: bind a chosen position; a later effect resolves the captured
  position exactly (including after the actor moved); a live actor ref
  resolves its new position on a later turn.
- Negative: reference to a non-existent bound name rejects; a captured ref
  cannot be re-resolved as live.
- Boundary: empty collection ref; ref to an off-battlefield/defeated actor
  stays resolvable where the source allows (defeated actor ref for
  "when the target is defeated" clauses) and rejects where not.
- Replay: an ability that captures a position, then the actor moves, then a
  continuation explodes at the captured cell — replay produces the identical
  mutation sequence.

**Consumers to migrate (de-dup, not wiring).** Replace ad hoc reads of
`attackTargetId`/`triggerSourceId`/`triggerTargetIds`/`damageRecipientId` in
`kernels/runtime.ts`, `kernels/bonus-damage.ts`, `kernels/choice.ts` and
resolvers with typed refs once the vocabulary lands; `RuleContinuationState`
gains a typed refs map.

**Blocker families enabled (information only).** mark-gated-modifier,
mark-transfer, mark-stacking, mark-detonation-window, mark-activation-gate,
rebound, delayed effects, return-from-removed-state, persistent-effect
referencing, spatial-state (original-location capture), active-effect
range modifiers.

---

### U2 Role / Perspective

**Semantic responsibility.** The typed distinction of *relative to whom a
clause is interpreted*: source/ability user, owner of an effect, controller,
chooser/decision-maker, payer, target, recipient, carrier, creator/summoner,
trigger source, trigger recipient, attacker, defender, original user,
current origin. The engine must **derive** which connected player is
entitled to answer a `ChoiceSpec` from semantic controller/chooser roles
(multiplayer/VTT authority).

**Non-responsibilities.** Not identity (U1 owns refs); not spatial origin
(U7 owns anchors: ROLE ≠ ANCHOR — "effects on the original user still apply
to the original user" even when the rebound character's space is the spatial
origin); not relation filtering alone (U3 composes relation over roles, but
role is the vocabulary relation reads).

**Source evidence.** "Ally" is defined relative to the source ("another
living ally", p.92); marks are owned by a marker and carried by a target
(p.94); Sacrifice is paid by the user (p.102/103); Blessing tokens are
owned by the character being saved (p.102/p.172); the durable save-reroll
window decides who owns the reroll (Sucker Punch, p.143); when-damaged /
defeated / uses-ability / area-inclusion / targeted windows decide who
answers and against whom (p.105, p.107); interrupt legality is judged from
the source/controller's position (Masquerade, p.151); the aura kernel's
bearer-vs-member boundary (`kernels/aura.ts`) is a role the engine must
derive, never string-match.

**Current state.** `PARTIAL` (T1 landed 2026-08-30; corrected 2026-08-30):
`primitives/roles.ts` defines the `Role` union (source/owner/controller/
chooser/payer/target/recipient/carrier/creator/trigger-source/
trigger-recipient/attacker/defender/original-user/current-origin),
`RoleFrame` + deterministic `deriveRoles` producing a SUBJECT-RELATIVE
`RoleMap` (`{ roles, controllers }`), typed `RoleSelector`
(`role` | `controller-of`) + `resolveRoleSelector`, and the
`roleFrameFromContext` seam over the legacy slots.
`RoleFrame.controllers` records who controls each subject ROLE (recorded
durable state, never ambient session ownership); `controller-of(source)` and
`controller-of(target)` resolve to DIFFERENT players in the same resolution
when the source and target are controlled by different connected players;
a missing recorded controller for an otherwise valid subject returns null
(never silently falls back to the source); the command boundary rejects
rather than guessing. `RuleChoice` gains typed optional `chooser`/
`controller` role carriage (behavior-neutral until U4 consumes it);
`RuleExecutionContext` role reads stay on the legacy slots pending
consumer migration. Tests: `roles.test.ts` (positive owner≠carrier,
TARGET_CONTROLLER, source−target and owner−carrier differing controllers;
negative underivable-chooser/unknown-role, missing-controller-for-valid-
subject, missing-subject; boundary self-collapse + ROLE≠ANCHOR rebound;
replay same-frame-same-map). The aura kernel's bearer-vs-member
and `targeting.ts`'s hard-coded relation reads still derive roles
locally — the de-dup migration is T2+.

**Locations partially owning/duplicating.** `kernels/aura.ts`
(bearer/member/origin derivation); `primitives/targeting.ts`
(`matchesTargetRelation` hard-codes self/ally/foe relative to a passed
source); `RuleExecutionContext.actorId` abuse across `kernels/runtime.ts`;
`ownerId` fields on mark/stance/entity/persistent mutations
(`primitives/types.ts`); `abilityUseChoices`/`talentChoices` opaque folds;
`save-window.ts` actor-is-saved policy reads.

**Intended authority.** `primitives/roles.ts` (barrel re-exported):
`Role` vocabulary + `deriveRoles(context)` producing the semantic role map
for a resolution; `chooserRole`/`controllerRole` on `RuleChoice`; role-aware
relation reads. Dependencies: none (foundation); consumed by U3, U4, U7, U9,
U13, U14, U16.

**Typed vocabulary.** Discriminated `Role` union; per-resolution role map
keyed by reference; `RuleChoice.chooser` (who decides) and
`controller` (who answers at the network boundary) as typed roles; role on
provenance facts (U9).

**Replay semantics.** Roles are derived deterministically from recorded
state + the durable choice rows; the entitled player is a pure function of
the record, never of ambient connection state. No second decision path.

**Acceptance tests.**

- Positive: "choice made by TARGET_CONTROLLER" resolves to the target's
  controller for a `RuleChoice`; mark owner ≠ mark carrier roles resolve
  distinctly.
- Negative: a choice row whose chooser role cannot be derived rejects at the
  command boundary rather than guessing.
- Boundary: source == target == controller (self-targeted) collapses to one
  role without breaking multiplayer derivation; role ≠ anchor (rebound case)
  asserted in a fixture.
- Replay: a window whose entitled responder is derived from the recorded
  choice row replays to the same responder.

**Consumers to migrate.** `kernels/choice.ts` (add role carriage),
`kernels/aura.ts` (derive bearer/member through roles), `targeting.ts`
(relation reads over roles), command layer choice routing, `save-window.ts`
owner derivation.

**Blocker families enabled (information only).** player-choice (authority
half), aura-user-gate, aura-trigger-grant, stance-gate, mark transfer
(owner half), rebound (role half), interrupt-rider/grant windows (who
answers), enemy-ability-trigger.

---

### U3 Query / Candidate

**Semantic responsibility.** The one deterministic eligibility authority
underneath both automatic targeting and player choices:
`Query<T> -> CandidateSet<T>` over actors/characters, summons,
objects/entities, positions, terrain effects/cells, areas, persistent
instances, marks/stances, rule sources/actions, and rolls/results where
relevant. Composable operators: all; relation to role/reference; range;
adjacency; LoS; LoE; inside/outside area; occupying position; free/occupied
space; terrain predicate; condition/status/mark/stance predicate;
alive/defeated/incapacitated; flying/intangible; owned/controlled by;
nearest/farthest; nth/first/last (only where the SOURCE defines a
deterministic ordering); union/intersection/difference; exclude prior
recipients; count; distinct-by-identity.

**Non-responsibilities.** Not choice semantics (U4 validates membership and
cardinality; it must NOT re-implement legality); not domain spatial models
(area geometry stays with the spatial gateway; LoS stays with
`line-of-sight.ts`); not movement-destination legality (spatial gateway);
not source-ID switches.

**Source evidence.** The PDF's targeting categories (Self, Ally, Foe,
Summon, Characters, Others, Space, Object — p.92) are ONE target vocabulary,
not separate selector engines; "Choose one foe in range 3" and "All foes in
range 3" share the same legality machinery; range is the p.92 footprint
metric measured from the edge of the origin space; defeated/off-battlefield
eligibility (p.94, p.107); burst areas include only spaces with LoS from
the burst center (p.95); large foes count as inside an area when any
footprint space is hit (p.290).

**Current state.** `PARTIAL` — the actor-domain query landed (2026-08-30,
see §0): base CandidateSet (`kernels/candidate.ts`) + extended
`evaluateActorQuery` (`kernels/evaluate-query.ts`) with real U7
`rangeOrigin` anchor resolution; `selectActors` migrated onto it as a thin
adapter (the `input` selector's range legality routes through the same U3
candidate authority — no second p.92 range algorithm); the direct-target
gate's base eligibility routed through `validateActorCandidate`; area
actor-inclusion reads through the `insideArea` query operator (the spatial
gateway keeps the cells); and a POSITION-DOMAIN SLICE
(`evaluatePositions` with explicit space/ordering policies,
`validatePositionLegality`, `nearestCandidates`) carrying the free-cell
scans, teleport-destination legality, and the min-distance nearest set
that the `freeCellsInRange`/`nearestFoe` resolver sugar used to own.
`nearestCandidates` returns the COMPLETE minimum-distance set with NO
invented tie-break; `rushTowardFoes` (moved into this kernel) answers
through the same selection and fails closed on equidistant ties. The
position slice is a FREE/UNOCCUPIED specialist, NOT the complete U3
position domain: occupancy is an explicit query policy (`any` vs
`unoccupied`), ordering is opt-in, and movement/placement legality stays
with the spatial gateway.

**T2 extensions landed (2026-08-30)** — the query TYPES moved to their
split-plan home `primitives/query.ts` (barrel re-exported; kernel
`evaluate-query.ts` owns the evaluation), and the missing actor-domain
operators + domains landed: line of sight / line of effect composition
from the query's anchor (`lineOfSight`/`lineOfEffect`, sharing the one
line-of-sight kernel), occupying-position (`occupying`), the terrain
predicate (`onTerrain`), owned-by (the `summon.owner` filter now accepts an
explicit owning actor id), and set composition
(`composeActorQueries` union/intersection/difference, distinct-by-
identity, no invented ordering). New domains: ENTITY
(`evaluateEntityQuery` — owner/type/range-from-anchor/at-position over
`state.entities`) and TERRAIN (`evaluateTerrainCells` — the
terrain-predicate cell read). The position slice gained the p.108
`lineOfSightFrom` policy (generic query + legality specialist) and
`originSize` (the legality specialist measures the p.92 footprint of a
Size>1 origin; size-1 collapses to the historical point metric). The U5
`count-query` value and the U6 predicates consume these domains through
`evaluateValueQuery`.

Residual (honest): query domains for AREAS, PERSISTENT INSTANCES, and
RULE SOURCES are not part of the T2 contract (persistent-instance reads
are U10/U12-scoped; rule-source reads belong with the U16/U17 consumers),
and ordering policies remain the min-distance set + the opt-in
`distance-from-origin` cell order (first/last/nth land only where a
SOURCE defines them). `rushTowardFoes`' direction fallback remains the
flagged player-choice approximation named in §0.

**Locations partially owning/duplicating.** Migrated (2026-08-30):
`kernels/runtime.ts::selectActors` is a thin adapter over
`evaluateActorQuery`; `kernels/choice.ts::resolveActors` delegates (good);
`encounter.ts::assertDirectTarget` routes base eligibility through
`validateActorCandidate` (the direct-target specialist reads stay at the
gate); `foe-recipes.ts` blast + the dash-on-the-rocks trait reaction read
area actor inclusion through the `insideArea` operator; every
`freeCellsInRange`/`nearestFoe` resolver call site routes through
`evaluatePositions` (explicit unoccupied + distance-from-origin
policies)/`nearestCandidates` (job-kit sugar removed), and
`teleport-choice` position legality routes through
`validatePositionLegality`. `primitives/targeting.ts::queryDirectTarget`
now pins the direct-target problem vocabulary for fixtures, and
`computeSpatialArea`'s `includedActorIds` remains a convenience
projection (not the live routing). Corrective pass (2026-08-30):
`primitives/job-kit.ts::occupied` is now an OBSTRUCTION test (characters +
objects; intangible summons do not obstruct, p.95); the Dark Knight /
Eye of the Storm nearest reads were RETRACTED (player-choice clauses, see
§0) and `rushTowardFoes` moved into this kernel. Remaining within scope:
`rushTowardFoes`' direction fallback is a player-choice approximation
(flagged in §0) and `kernels/lifecycle.ts::freeCellNear` remains a
lifecycle summon-placement specialist with its own conservative occupancy
read (documented in that file).

**Intended authority.** `kernels/evaluate-query.ts` (extracted from
`runtime.ts`, re-exported by the barrel): `evaluateQuery(query, context)`
over all domains, composed from `primitives/query.ts` operators; the
specialists keep their spatial models but answer through the Query
contract. `rangeOrigin` resolves through U7 `SpatialAnchor`.
`selectActors` becomes a thin adapter over `evaluateQuery`.
Dependencies: U1 (refs), U2 (roles/relation), U5 (dynamic range values),
U7 (anchors). Consumed by U4 (candidate legality), U6 (predicates),
U13 (eligible responders), all targeting domain authority.

**Typed vocabulary.** `Query<T>` with domain-typed target kinds and the
operator list above; `CandidateSet<T>` (deterministic, de-duplicated by
identity); deterministic ordering spec only where source-defined; typed
`rangeOrigin: SpatialAnchor`.

**Replay semantics.** Candidate evaluation reads only current state and
declared query; never RNG, never ambient order. Source-defined
first/last/nth ordering must be explicit in the query, never array
iteration order.

**Acceptance tests.**

- Positive: "all foes in range 3" == the union of one-foe-per-candidate
  choices; entity/position/terrain candidates resolve; `selectActors`
  output for each selector kind equals `evaluateQuery` output (parity
  suite over existing fixtures).
- Negative: defeated excluded by default; off-battlefield excluded;
  out-of-range excluded; relation violation.
- Boundary: at-range passes, one-past fails (footprint metric); empty
  CandidateSet for a required choice rejects at U4; large-foe area inclusion
  (any footprint cell).
- Replay: `selectActors` migration is behavior-preserving — the existing
  fixture suite replays byte-identical; `rangeOrigin` as a non-self anchor
  resolves identically on replay.

**Consumers to migrate.** DONE (2026-08-30): `selectActors` branches
(`runtime.ts`) route through `evaluateActorQuery` (including the `input`
selector's range legality — one p.92 range authority); the direct-target
gate (`encounter.ts::assertDirectTarget`) routes base eligibility through
`validateActorCandidate`; the blast/area-inclusion consumers read actor
inclusion through the `insideArea` operator; every `freeCellsInRange` /
`nearestFoe` resolver call site routes through the position-domain
operators (`evaluatePositions` with explicit unoccupied +
distance-from-origin policies) / `nearestCandidates` (job-kit sugar
removed), and `teleport-choice` maps `validatePositionLegality` onto its
violation codes (Rampart stays the spatial gateway's application-time
check). Corrective pass (2026-08-30): the Dark Knight and Eye of the
Storm nearest reads were retracted (player-choice clauses, §0), the
`includeDefeated` flags they carried dropped, `rushTowardFoes` moved into
this kernel, and `occupied` was corrected to an obstruction test.
T2 (2026-08-30): the actor-domain operators and the entity + terrain
domains landed (see the Current state row), the p.108 placement-LoS
boundary is resolved through the shared legality operator + position
query policy (spellblade behind-the-wall + control fixtures), and the
query types moved to `primitives/query.ts`. Remaining after T2 (honestly
NOT "nothing"): the AREA/PERSISTENT-INSTANCE/RULE-SOURCE domains
(persistent-instance reads are U10/U12-scoped; not part of the T2
contract), ordering policies beyond the min-distance set + the opt-in
cell order, and `rushTowardFoes`' direction fallback remains a flagged
player-choice approximation (a movement-direction read, not an
eligibility query).

**Blocker families enabled (information only).** choice-input,
entity-distance-selection, object-distance, lifecycle-target-selection,
target-selector-variant, summon-recipient-targeting, direction-override,
selectable-terrain-placement (choice face), member-count-scaling (query
face), flying-targeting.

---

### U4 Choice / Decision

**Semantic responsibility.** One semantic CHOOSE validator: validates that
the supplied selection is a member of the CandidateSet and satisfies
cardinality; it does **not** own candidate legality beyond that. Core
dimensions: chooser role/controller (U2); candidate domain (U3);
cardinality; required vs optional; distinct/repetition policy; ordering if
meaningful; closed options; bounded number; direction; yes/no. Optionality
MUST correspond to source language ("may"/"can") — never inferred because
declining would be convenient. Missing required choice ⇒ reject before any
cost/RNG/mutation; optional missing ⇒ decline (`null`), never a default.
One semantic `ChoiceSpec` across all timings (command-time, post-roll,
after-damage, interrupt window, delayed continuation, simultaneous-order).

**Non-responsibilities.** Not candidate legality (U3); not window mechanics
(U13 opens the decision point; CHOICE is the decision inside it); not
teleport/domain constraints (spatial specialists stay).

**Source evidence.** "Choose one foe in range 3" / "choose a space"
(p.88 Teleport X destination; p.92; p.95); optionality only from "may"
language; post-result decisions (p.143 reroll window, p.105 Vigilance
choice) are the same decision semantics at a different time; the 8
`{choice-input}` singletons re-read in `docs/tranche-2-query.md` all need a
durable choice window (U12/U13), not legality — the evidence the ontology's
"post-result decision is not a second choice system" point rests on.

**Current state.** `PARTIAL`. `kernels/choice.ts` is authoritative for the
six bucket kinds (23 tests, tranche 1): required/optional/cardinality/
distinctness/option membership/bounds; actor legality delegates to U3.
T2 (2026-08-30): position choices now route their in-grid + p.92
footprint-range reads through the SHARED position predicates
(`withinGrid` + footprintDistance from a resolved U7 anchor — the range
frame is `RuleChoice.rangeOrigin`, a `SpatialAnchor` defaulting to the
acting actor; a malformed anchor FAILS CLOSED instead of silently
skipping the range check, `t2-choice-roles.test.ts`); and the U2
chooser/controller substrate is consumable:
`choiceEntitledPlayer(choice, RoleFrame)` / `choiceEntitledPlayerFromContext`
derive the entitled chooser from the durable role frame (declared
`chooser`, else `controller`, else the source) — a DECLARED role that
cannot be derived returns null (the command/network boundary rejects
rather than guesses), no content row sets the roles yet (the U13 window
layer consumes the seam). Missing after T2: candidate legality for
DIRECTIONS through a U3 domain (directions are axis-unit vectors, not a
candidate domain); the opaque `abilityUseChoices`/`talentChoices` folds
not yet folded onto the same spec; window-carried choices (U12/U13)
constructing the same `ChoiceSpec`.

**Locations partially owning/duplicating.** `kernels/choice.ts` (the
validator); `RuleExecutionInput` buckets (`primitives/types.ts`);
`RuleExecutionInput.abilityUseChoices` / `talentChoices` (opaque fold
payloads); `kernels/teleport-choice.ts` (position-domain choice, same
violation codes); `selectActors`' `input` branch (still independently
eligible); `primitives/ability-use-choices.ts`.

**Intended authority.** `kernels/choice.ts` extended: `RuleChoice` gains
`chooser`/`controller` roles; all domains validate through U3
`evaluateQuery`; `resolveChoices` stays the single entry; window-carried
choices (U12/U13) construct the same `ChoiceSpec`. Dependencies: U3, U2.
Consumed by U11 (choose flow op), U13 (window decisions), domain
authorities (targeting/placement/teleport).

**Typed vocabulary.** Extended `RuleChoice` (roles, domain-kind, per-domain
constraints); `ChosenValue` stays; `ChoiceSpec` shared record for
command-time and window-carried decisions.

**Replay semantics.** Choices ride the initiating command (pre choices) or
the window's durable record (post choices); replay never re-asks. The
supplied values are what execute — legality only.

**Acceptance tests.** Existing 23 cases stay; add: chooser-role derivation;
position choice legality through U3 (parity with `teleport-choice` where
expressible); `abilityUseChoices`/`talentChoices` fold-through cases;
window-carried `ChoiceSpec` resolution; optional-decline never defaults
(already covered, extended to window timing).

**Consumers to migrate.** `teleport-choice.ts` (consume U3 position
candidates where generic; keep in-grid/unoccupied/Rampart) — DONE
(2026-08-30, the teleport legality already routed through
`validatePositionLegality`, now with the p.108 LoS leg); selectActors'
`input` branch, `ability-use-choices.ts` opaque fold, `talentChoices`
allowlist (unify behind U4 optional-decline) — REMAIN after T2.

**Blocker families enabled (information only).** choice-input,
player-choice, post-roll-reactive-choice, gamble-result-selection,
selectable-terrain-placement (choice face), direction-override, card-deck
(choose item), ability-use choices.

---

### U5 Value / Expression

**Semantic responsibility.** Typed scalar/value expressions evaluated
against current state: constant, stat, resource, count(query), distance,
round, turn index, usage count, status count, entity/member count, damage
result, roll result, elevation, area size, movement traversed, percent of
BASE max HP, arithmetic, min/max/clamp, conditional. Non-numeric values
(positions, refs, colors, IMMUNITY kinds) stay typed — never collapsed
through number/string. Percent-health uses maximum BASE HP, not
wounds-adjusted max HP.

**Non-responsibilities.** Not predicates (U6 composes VALUE + QUERY +
REFERENCE into booleans); not roll authority (ROLL domain authority owns
dice); not bespoke per-mechanic kernels (`statusCountDamageKernel` etc. are
forbidden — express them).

**Source evidence.** Bloodied/quarter thresholds are HP-percent reads
(p.94, p.104); distance predicates need distance-between-arbitrary-refs
(p.92); effect-count scaling ("for each foe in the area", p.105-style
trigger clauses) needs count(query); percent-of-BASE-max ("Sacrifice X
percent of your maximum HP", p.103; p.219 Terraforming) needs BASE HP
semantics; traversed-distance ("for every space you moved", rush/fly
abilities) needs movement-traveled reads.

**Current state.** `PARTIAL`. T2 (2026-08-30) extracted the VALUE algebra
from the runtime barrel to its semantic home `kernels/evaluate-value.ts`
(`evaluateNumber` + `integer`, plus the selector read surface
`selectActors` it resolves intrinsically; `kernels/runtime.ts` remains
the compatibility barrel and re-exports it) and EXTENDED the operator
list: `count-query` over the general U3 domains (actors/entities/
positions/terrain cells via `evaluateValueQuery`),
`distance` between arbitrary ENDPOINTS (RuleSelector | U1 reference |
U7 anchor — always the canonical p.92 footprint metric, an unresolvable
ref FAILS CLOSED), and `percent-base-max` (ICON p.107 "% HEALTH":
percentage costs/damage use the BASE maximum, never the wounds-adjusted
bar; the durable base max is now projected onto `RuleActorView`
`baseMaxHp` by the encounter adapter, and a view without it fails
closed). The existing core (constant/stat/resource/round/input/count
(selector)/distance(actor-to-actor)/die/damage-die/damage-roll/if/
percent/add/multiply/minimum/maximum/clamp) is unchanged. Missing after
T2: usage reads (U16, T3), status/member counts (domain reads the
`count-query` value now expresses), traversed-distance, elevation,
area-size, and typed non-numeric values (positions/refs/colors stay
typed in the surrounding vocabulary — no number collapse).

**Locations partially owning/duplicating.** `evaluateNumber`
(`kernels/runtime.ts`) — MOVED to `kernels/evaluate-value.ts` (2026-08-30),
runtime re-exports; `hp-threshold.ts` (bloodied/quarter state-threshold
reads — the p.94/p.104 wounds-adjusted bar, distinct from the p.107 BASE
max the `percent-base-max` value reads); `kernels/bonus-damage.ts`
(roll/recipient reads stay at the ROLL query point but through the value
vocabulary); inline per-resolver arithmetic (e.g. `integer()` callers,
gamble sums in `content/jobs/programs/*`); `RuleNumber` type
(`primitives/types.ts`).

**Intended authority.** `kernels/evaluate-value.ts` (extracted from
`runtime.ts`, barrel re-exported): `evaluateValue(expr, context)` over the
full expression algebra. Dependencies: U1 (refs), U3 (count(query)),
U7 (distance anchors), U8 (round/turn), U16 (usage reads). Consumed by U6,
U14 (value on the recipe), domain authorities (damage, cost, movement).

**Typed vocabulary.** Extended `RuleNumber`: `count(query)`,
`distance(ref, ref)`, `percent-base-max`, `usage(key, scope)`,
`status-count`/`member-count`, `traversed`, `elevation`, `area-size`,
`value` for typed non-numeric reads. Percent always names its base
explicitly (BASE max vs wounds-adjusted).

**Replay semantics.** Expression evaluation is a pure function of state +
recorded input + recorded dice results; no second RNG path; percent-base
reads the durable base.

**Acceptance tests.** Positive: count(query), distance-between-refs,
percent-of-BASE-max (differs from wounds-adjusted when wounds are present),
usage reads. Negative: divide-by-zero/NaN guards; unknown stat/usage key
rejects. Boundary: quarter mark exactly; 0-count; traversal of 0.
Replay: a damage-roll expression with recipient-scoped bonus dice replays
byte-identical (existing Finesse fixture extended).

**Consumers to migrate.** Resolver inline arithmetic → typed expressions
(REMAINS); `hp-threshold.ts` state-threshold reads stay the threshold
authority (the `stat max-hp` read is the wounds-adjusted bar the
bloodied/quarter predicates already fold; `percent-base-max` is the
BASE-max % cost/damage read — the p.107 vs p.94 distinction is now
TESTED in `t2-expression-algebra.test.ts`); bonus-damage recipient reads
stay at the ROLL query point but through the value vocabulary.

**Blocker families enabled (information only).** effect-count,
status-count-scaling, member-count-scaling, damage-count-scaling,
traversal-count, elevation-scaling, aura-count-condition,
distance-predicate, conditional-distance-stun, path-count-predicate,
sacrifice-percent, variable-cost.

---

### U6 Predicate / Condition

**Semantic responsibility.** "Is this rule clause applicable now?" — boolean
expressions composed from QUERY + VALUE + REFERENCE:
`bloodied(source)`, `count(foesInArea) == 1`,
`distance(source,target) >= 3`, `hasStatus(target, weakened)`,
`markExists(owner,target)`, `isSlowTurn(source)`, `round >= 4`,
`usageCount(source,key,round) == 0`, `terrainAt(target) contains pit`,
`original entity still exists`, `target has not acted this round`.

**Non-responsibilities.** Not bespoke gate kernels (forbidden when the
expression algebra suffices); not trigger/fact evaluation (U10 owns
historical outcomes — predicates evaluate CURRENT state); not lifecycle
hooks.

**Source evidence.** Bloodied/quarter gates (p.94, p.104); distance gates
(Trigrammaton "at exactly range 3", p.225-style exact-range clauses);
condition/status gates (p.94); round gates ("at round 4 or later");
usage gates ("once per round", p.99/p.105); terrain-at gates (p.104
Rampart-adjacent clauses, p.129 movement gates); "has not acted this round"
(p.129 Special).

**Current state.** `PARTIAL`. T2 (2026-08-30) extracted the PREDICATE
algebra from the runtime barrel to its semantic home
`kernels/evaluate-predicate.ts` (runtime re-exports it) and EXTENDED the
CORE contract using only U1/U3/U5/U8: `mark-exists` (default mark key =
source id, mirroring the `marked` query filter), `in-stance`,
`inside-aura` (membership derived through the shared aura kernel's
`isInAura` over the runtime view — never a parallel geometry read; an
unregistered provenance FAILS CLOSED), and `acted-this-round` (the VM
view's durable attack-made-this-turn read, p.129 Special). Compound gates
compose through the existing `compare` operator over the new
`count-query`/`distance` values (tests prove `count(foes) == 4` and
`distance(source,target) >= 3`). The core (always/not/all/any/compare/
has-condition/bloodied/quarter/defeated/in-terrain/trigger/state/
target-state) is unchanged. T3 (2026-08-30) added `used-scope` against the landed U16 CORE ledger: the
predicate reads the target's durable `ledger:<scope>:<sourceId>` key via
`primitives/usage.ts` (`usageKey`/`usageCount`), so once-per-turn/round/
combat gates and N-per-scope counts are the same authority the command
boundary consumes and the lifecycle recipes reset. T4 (2026-08-30)
completed U6 with `effect-still-exists`, reading through the U10
fact/instance seam (`effectExistsLive` over `primitives/facts.ts`) against
the target's LIVE effect surfaces (conditions/statuses/stance/marks/
active-effects) — the general active-effect state authority stays in its
domain; U6 only reads through the generic reference/fact seam, and an
instance identity the projected view cannot represent (a specific coexisting
mark/persistent instance without `anyInstance`) FAILS CLOSED via
`RuleProgramViolation` rather than guessing.

**Staged completion (DAG-consistent).** U6's core predicate algebra depends
on U1/U3/U5/U8 only and lands in T2 (LANDED 2026-08-30); the
`effect-still-exists` predicate reads U10 facts/instances and LANDED in T4
(2026-08-30). U6's declared dependencies (U10 for effect-still-exists) are
now satisfied; the remaining predicate vocabulary enumerated in the
vocabulary below is landed, with no documented U6 dependency left.

**Locations partially owning/duplicating.** `evaluatePredicate`
(`kernels/runtime.ts`) — MOVED to `kernels/evaluate-predicate.ts`
(2026-08-30), runtime re-exports; `kernels/hp-threshold.ts` (bloodied/
quarter state reads); inline predicate logic in resolvers
(`content/jobs/programs/*` condition checks); `kernels/range.ts` gates
(stealth/comeback/mastery/choice — these are U6-predicate-shaped but
live in the range fold); `kernels/area.ts` gates (same). The range/area
gate folding is a behavior-preserving consumer migration that remains
post-T2 (no source semantics change is implied by the plan).

**Intended authority.** `kernels/evaluate-predicate.ts` (extracted from
`runtime.ts`, barrel re-exported). Dependencies: U1, U3, U5, U8, U10
(effect-still-exists reads U10 facts/instances). Consumed by U11 (if/while),
U13 (window eligibility gates), U14 (recipe predicates), U17 (ordering
policies with predicates).

**Typed vocabulary.** Extended `RulePredicate`: `count-query`, `distance`,
`mark-exists`, `in-stance`, `inside-aura`, `used-scope`,
`effect-still-exists` (T4), `acted-this-round`, `terrain-at` (exists),
compound `all/any/not`.

**Replay semantics.** Predicates evaluate replay state deterministically;
the used-this-scope read consumes the durable U16 ledger + U10 facts,
never ambient flags.

**Acceptance tests.** Positive: each new predicate kind; negative: false
branches; boundary: exact-threshold comparisons (`<=` vs `<`), 0-count;
replay: a trigger step gated by a predicate that consumes a ledger entry
replays identically.

**Consumers to migrate.** Range/area gate logic folds onto the predicate
algebra (gates stay registered per recipe, but the gate bodies become
predicates) — REMAINS post-T2; resolver inline condition checks —
REMAINS; `hp-threshold` predicate reads — the bloodied/quarter predicates
already evaluate through the shared `stat max-hp` read (the wounds-
adjusted bar), kept as the threshold authority.

**Blocker families enabled (information only).** distance-predicate,
conditional-distance-stun, path-count-predicate, aura-count-condition,
mark-activation-gate, stance-gate, first-use-gate, entry-save-gate.

---

### U7 Anchor / Spatial Frame

**Semantic responsibility.** Name every spatial relationship's frame
explicitly: `range from <anchor>`, `LoS from <anchor>`, `area centered on
<anchor>`, `aura follows <anchor>`, `return relative to <captured-anchor>`,
`move away from <anchor>`, `shove away from <anchor>`, `nearest to
<anchor>`. Anchor can refer to actor footprint, entity/object, chosen
position, bound position, target, area center, source, mark carrier,
persistent carrier, captured/snapshot position, current/live position.
ROLE (U2) ≠ ANCHOR (U7).

**Non-responsibilities.** Not distance metric (p.92 footprint distance is a
shared primitive, consumed by anchors); not movement legality (spatial
gateway); not LoS computation.

**Source evidence.** "Range is measured from the edge of the origin space
(or character)" (p.92); burst centers on a character or chosen space
(p.95); auras are anchored to a bearer and re-derived as it moves
(`kernels/aura.ts` origins); teleport is measured from the teleporter's
current position (p.88, and the planned-path simulation in
`teleport-choice.ts` proves sequential anchors matter); entity creation
separates placement REGION from CREATOR LoS/range ORIGIN (p.95/p.107/p.108,
`creationSpatial` contract); Rebound: the rebound character's space becomes
the ORIGIN for cover/LoS while effects on the original user still apply to
the original user.

**Current state.** `PARTIAL`. The unified anchor VOCABULARY landed
(2026-08-30): `primitives/anchor.ts` (`SpatialAnchor` — LIVE actor selector
| CAPTURED position — + `SpatialOrigin`) with kernel-side resolution
(`kernels/candidate.ts` `resolveSpatialAnchor`, consumed by U3
`rangeOrigin`; fail-closed on query-shaped selectors / zero-multi actors /
position-less anchors; relation stays with the acting actor while range
moves to the anchor). T2 (2026-08-30) added the LIVE ENTITY footprint
anchor (`{ kind: 'entity'; entityId }`, resolved to the entity's size-1
cell; fail-closed `selector.entity-missing` / position-less) — consumed by
the U3 entity-domain range origin and the U5 `distance` anchor endpoints.
Specialist anchor ideas still exist and are NOT yet unified onto
`SpatialAnchor`, each with a written boundary: `RuleArea.origin`
(`self|target|position|entity`, `primitives/types.ts`) is DECLARATIVE
ONLY — no runtime consumer exists yet (areas compute through
`computeSpatialArea` intents), so typing it as an anchor is churn without
a semantic seam; entity `creationSpatial` (origin selector + size +
maxRange, `primitives/types.ts`, `kernels/entity-creation.ts`) is a
RESOLVED-position contract evaluated at command time and carried on the
mutation for replay — it names the same frame but travels with the
creation record (documented retained specialist); `teleport-choice` origin
positions are resolved positions consumed by the shared
`validatePositionLegality` (a captured-position anchor in effect);
`SpatialIntent.from` and aura origins (`kernels/aura.ts`) stay with the
movement gateway / aura kernel (U2 migration is T3+); rebound origin
absent (U12 continuation records).

**PARTIAL / scaffolding (corrective pass 2026-08-30).** U7 remains
PARTIAL and must not be extended as if it were U1 REFERENCE: the LIVE
actor anchor currently identifies its actor via a reference-style
`RuleSelector` — this is COMPATIBILITY SCAFFOLDING, not the anchor
vocabulary's final identity model. Once U1 exists, live anchor identity
should use the typed `Reference<T>` vocabulary; this pass does NOT
pre-design that seam. U2 ROLE / PERSPECTIVE remains responsible for
"relative to whom" entirely independently of U7 — relation stays with the
acting actor while the anchor carries only the spatial frame.

**Locations partially owning/duplicating.** `primitives/spatial-intent.ts`
(footprint/anchor primitives + area gateway); `RuleArea.origin`;
`RuleEffect` entity `spatial` contract; `kernels/teleport-choice.ts` origin
handling; `kernels/aura.ts` `auraOriginRefs`; `kernels/encounter-adapter.ts`
movement origins; `context.actorId` as de-facto anchor in
`kernels/runtime.ts`. (`kernels/candidate.ts::rangeOrigin` migrated onto
the anchor vocabulary, 2026-08-30.)

**Intended authority.** `primitives/anchor.ts` (barrel re-exported):
`SpatialAnchor` union (actor footprint, chosen position, bound ref (U1),
area center, source, carrier, captured/snapshot, live) with explicit
LIVE/CAPTURED; kernel-side `resolveSpatialAnchor(anchor, context)`
(landed for the LIVE actor selector | CAPTURED position kinds); consumers
read anchors via the shared footprint-distance primitive. Dependencies: U1
(refs), U2 (role ≠ anchor). Consumed by U3 (`rangeOrigin` — landed), U5
(`distance(ref,ref)`), domain authorities (targeting, area, movement, aura,
entity creation, rebound).

**Typed vocabulary.** `SpatialAnchor`; `RuleArea.origin` typed as an anchor;
entity `creationSpatial.origin` typed as an anchor; `rangeOrigin` typed as
an anchor; captured-anchor records ride U12 continuation state.

**Replay semantics.** Anchors resolve from durable state (live) or from
captured records (captured); never from serialized convenience fields that
lose the frame. Rebound fixtures prove ROLE ≠ ANCHOR on replay.

**Acceptance tests.** Positive: non-self `rangeOrigin` actually resolves
through the anchor (fix the inert seam with a fixture: a query measured from
an ally's position); area centered on a captured position after the actor
moved; creation origin from an entity. Negative: anchor with no resolvable
referent rejects. Boundary: anchor to a defeated actor (source permits) vs
off-board actor (rejects); size>1 footprint anchor edges (p.92). Replay:
teleport planned-path + rebound-origin fixture replays byte-identical.

**Consumers to migrate.** `candidate.ts` (resolve `rangeOrigin`) — DONE;
`teleport-choice` origin reads — the positions are already consumed
through the shared `validatePositionLegality` (a captured-position
anchor in effect); `RuleArea.origin` consumers — none exist (declarative
shape only, documented retained specialist); aura origin derivation —
U2/T3+; `runtime.ts` `context.actorId`-as-anchor reads — T2+ de-dup
work.

**Blocker families enabled (information only).** rebound, entity-distance-
selection, object-distance, range-gated-teleport, multi-actor-teleport,
moving-area-terrain, zone-regeneration, under-character-terrain,
area-define, aura-range-override, spatial-state (captured anchor).

---

### U8 Scope / Clock

**Semantic responsibility.** ONE shared vocabulary for temporal/usage
boundaries: action, ability resolution, turn, between-own-turns, slow turn,
round, combat, expedition, camp, interlude, permanent, N occurrences of a
boundary, next matching boundary, source-defined lifecycle event. Reused by
durations, usage counters, refreshes, once-per-X, costs, interrupts, trigger
de-duplication, delayed effects, resources, persistent instances. An
explicit shared **Clock** concept every reader consults — never a separate
"round" per subsystem.

**Non-responsibilities.** Not the scheduler's turn-order authority (that is
the turn scheduler + U17 ordering); not the RNG; not fact recording (U10).

**Source evidence.** Durations ride turns/rounds/combat (p.94 statuses,
p.95 terrain/entity effects, p.107 end-of-combat cleanup); once-per-round /
once-per-turn / once-per-combat gates (p.99, p.105 Vigilance, p.129
Special); Delay resolves at the start of the slow turn before ordinary
activity (p.87 slow rounds; scheduler `delayed` phase); "at the end of your
next turn" N-boundary forms; camp/expedition reset boundaries (p.56, p.113).

**Current state.** `PARTIAL` (T1 landed 2026-08-30; corrected 2026-08-30):
`primitives/scope.ts` defines the ONE `Clock`/`Scope` vocabulary with FULL
temporal fidelity: `BoundarySpan` + `BoundaryEdge` (`start`/`end` —
turn-start ≠ turn-end, round-/combat-start ≠ end, slow-turn start ≠
ordinary turn start) carrying an optional U1 `Reference` `subject` for
actor-relative boundaries (end-of-YOUR-turn ≠ end-of-TARGET's-turn);
counted (`n-boundary`/`for-n`) and `next`/`until-next` forms RELATIVE to a
recorded epoch (`ClockObservation` + `boundaryKey` occurrence counters —
an effect created on round 5 "for 3 rounds" completes only after three
matching round boundaries from its origin, never because `round >= 3`);
permanent / until-event extents. The boundary-read surface is
`clockForTiming`/`scopeForDuration`/`currentClock`/`boundaryReached`/
`scopeSatisfied`. `clockForTiming` maps step timings ('use', attack-*) to
null and boundary timings to a BoundaryRef carrying its edge;
`currentClock(context)` returns null for non-boundary timings (a `use`
command is never "at the round boundary"); `scopeForDuration` maps the
legacy `RuleDuration` onto Scopes PRESERVING edge + actor subject
(turn-start/end durations keep their Reference; behavior-neutral);
`boundaryReached`/`scopeSatisfied` require an observed boundary record and
FAIL CLOSED (return false) on relative reads with no recorded epoch — they
never invent absolute-round answers. Tests: `scope.test.ts` (17 tests: the
11 required temporal-fidelity cases — turn-start≠end, round-start≠end,
source≠target turn, relative-3-rounds-from-round-5-origin, next-target-not-
on-source-turn, slow≠ordinary, non-boundary-null, permanent-never, named-
event, replay, plus edge/subject preservation in `scopeForDuration`). The
legacy surfaces remain the executing
authority — `RuleDuration`/`RuleTiming`/`use-ledger`/lifecycle readers
still re-key "round" separately; migrating them onto the Clock (the U8
completion work, including the scheduler's turn record for turn-level
`boundaryReached` reads) is a later phase, not T1.

**Locations partially owning/duplicating.** `RuleDuration`
(`primitives/types.ts`); lifecycle phases (`kernels/lifecycle.ts`);
`useLedgerKey` periods (`kernels/use-ledger.ts`); `RuleTiming`
(`primitives/types.ts`); scheduler round/slow logic (`turn-scheduler.ts`);
`RuleContinuationState`-adjacent timing reads.

**Intended authority.** `primitives/scope.ts` (barrel re-exported):
`Scope`/`Clock` types (`action|resolution|turn|between-turns|slow|round|
combat|expedition|camp|interlude|permanent|n-boundary|next-boundary|event`),
`currentClock(context)`, `boundaryReached(clock, state)`.
Dependencies: none (foundation). Consumed by U5 (round/turn reads),
U12 (triggering Clock), U13 (window timing), U14 (duration query point),
U16 (reset Clock), durations/persistent-instance lifecycle.

**Typed vocabulary.** `Clock` union; `RuleDuration` rewritten over
Scopes (+ `n`, `next-match`, named-event); use-ledger periods typed as
Scopes; `RuleTiming` kept for step timing but its boundary semantics read
the Clock.

**Replay semantics.** The Clock is derived from durable state
(round/turn/boundary counters + recorded events); boundary advancement is a
recorded transition (existing turn-intent machinery is prior art); replay
never re-decides whether a boundary was crossed.

**Acceptance tests.** Positive: same "round" read by a duration, a usage
gate, and a lifecycle recipe agrees; N-boundary duration; next-matching-
boundary. Negative: out-of-scope read rejects. Boundary: slow-turn vs
ordinary-turn boundary; combat-end cleanup expiry. Replay: a turn-boundary
intent with a round-gated recipe replays identically (existing
`turn-transition.test.ts` pattern extended to the Clock API).

**Consumers to migrate.** `RuleDuration` consumers, `use-ledger` periods,
lifecycle phase reads, `RuleTiming` boundary interpretation, scheduler
round counters (read the Clock, keep the scheduler).

**Blocker families enabled (information only).** duration-modifier,
duration-fly-state, once-per-round-fly-grant, use-count-override (scope
half), first-use-gate, auto-refresh, shared-turn-ledger, passive,
infuse-permanence, delay-* (timing half).

---

### U9 Provenance / Cause

**Semantic responsibility.** "What caused this outcome?" — richer than
`sourceId`. Dimensions: source rule/action/effect; source actor; owner;
controller; attack/effect/terrain/save; movement mode;
voluntary/forced/granted; original action; parent event/effect; trigger
chain; recipient; damage delivery; attack-target vs collateral recipient;
rebounded/redirected; teleport/place/rush/fly/shove; terrain/entity
source-created; current ability-resolution identity. Events/mutations must
carry enough provenance to answer source questions.

**Non-responsibilities.** Not the historical record itself (U10 owns facts);
not role semantics wholesale (U2 owns role derivation; U9 records role-
shaped cause on events); not source-ID interpretation (kernels never branch
on it).

**Source evidence.** ICON semantics are causal: Pacified breaks on damage
from a FOE'S ability/action (not self/terrain, p.94); Slay means THIS
ability reduced a character to 0 (p.103 glossary); Collide means shoved INTO
an obstruction AS PART OF THIS ability (p.102/103, p.128/p.138 recipes);
dangerous terrain has its own delivery (p.95/p.108); triggered effects fire
once per ability (p.105); unerring/cover/dodge provenance on attacks
(p.104/p.105); delivery modes distinguish hit/miss/area/effect/save-success/
terrain damage.

**Current state.** `LANDED (T4, 2026-08-30)`. `primitives/provenance.ts`
(barrel re-exported) owns the typed PROVENANCE vocabulary:
`DeliverySourceKind` ('actor' | 'terrain' | 'entity' | 'environment'),
`RuleDelivery` (incl. reflected/triggered), `RuleMovementMode`, and the
`Provenance` dimension record (sourceId / ownerId / sourceActorId /
actionId / delivery / deliverySource / movementMode / volition / role /
recipientId / rebound / redirect / derivedFromFact / parent) — SOURCE
identity is kept distinct from DELIVERY kind, and `sameCausalOrigin`
preserves the TRUE initiating actor through reflected/secondary delivery
(so a reflection can never white-out the original owner/source).
`provenanceOfMutation` derives a provenance at each resolve point from the
mutation's own fields, ALWAYS preserving the causal `sourceActorId` (even
when it equals the owner). Existing domain-specific provenance stays where
it is (the VM's `attackDamageProvenance`, `delivery` on damage mutations,
`cause: TurnEndCause`, the movement-entry `voluntary` flag) — documented
retained specialists; U9 provides the shared generic vocabulary facts and
de-dup read through.

**Locations partially owning/duplicating.** `primitives/attack-resolution.ts`
(provenance); `kernels/runtime.ts` (delivery threading); `kernels/damage-ledger.ts`
+ `encounter-adapter.ts` (damage/held provenance); `resolution-triggers.ts`
(derived facts); `kernels/movement-triggers.ts` (voluntary flag);
`RuleResolutionFacts` (`primitives/types.ts`); `TurnTransitionIntent.cause`.

**Intended authority.** `primitives/provenance.ts` (barrel re-exported):
`Provenance` record shape with the dimension list; every mutation/event
carries the applicable dimensions; `deriveProvenance` at each authority's
resolve point. Dependencies: U1 (refs), U2 (roles). Consumed by U10 (facts
record provenance), U13 (triggering fact with cause), U16 (de-dup keyed on
cause + usage identity), damage/attack/save domain authorities.

**Typed vocabulary.** `Provenance` (source refs, roles, delivery, movement
mode, voluntary/forced/granted, parent chain, attack-vs-collateral,
rebound/redirect flags); `DeliverySourceKind` (actor/terrain/entity/
environment) as the ontology's missing piece; cause rides facts and
ledgers.

**Replay semantics.** Provenance is recorded at the command/window
boundary and replays verbatim; never reconstructed from current state or
source names.

**Acceptance tests.** Positive: Slay provenance restricted to THIS ability's
damage; Collide provenance includes the shove's ability id; Pacified-break
provenance distinguishes foe-ability damage from terrain damage. Negative:
non-actor delivery never opens an interrupt window (existing
`decideDamageWindow` gate). Boundary: multi-target ability — attack-target
vs collateral recipient provenance differs per damage instance. Replay:
provenance fields byte-identical across a replayed split event
(`openDamageWindowFromLedger` path).

**Consumers to migrate.** `resolution-triggers.ts` (read provenance instead
of re-deriving), `damage-ledger` entry construction, movement-entry folds
(forced-entry flag), reroll-save regeneration.

**Blocker families enabled (information only).** slay/collide/damage-dealt/
defeat/attack-miss/attack-exceed/enemy-ability triggers (cause half),
movement-trigger (forced entry), delivery-immunity, rebound (provenance
half), effect-redirect.

---

### U10 Fact / Outcome

**Semantic responsibility.** "What authoritative thing has already
happened?" — historical facts recorded by this resolution, distinct from
predicates (current state). Examples: attack hit/missed/critical/exceeded;
damage determined/applied; actor damaged/defeated; source slew targets;
collide occurred; movement entered/exited/passed-through cells; actual
distance moved; moved closer/farther; status applied/removed; save
rolled/succeeded/failed; entity/terrain created/removed; effect expired;
ability resolved. Triggered-effect de-duplication ("a given triggered
effect only triggers once per ability") belongs here WITH U16. Never
rediscover a historical outcome from current state.

**Non-responsibilities.** Not predicates (U6); not the RNG; not provenance
itself (U9 shapes the cause recorded on a fact); not the usage ledger's
counting (U16 counts; U10 records what happened).

**Source evidence.** Reactive triggers (Collide, Slay) are only knowable
after mutations resolve — the two-pass fold (`executeRuleProgramWithReactiveTriggers`,
`src/rules/encounter.ts`) is the current fact-derivation machinery (p.85
order, p.102/103 glossary, p.105 once-per-ability); damage windows open from
a determined-but-not-applied fact (p.107, p.128, p.138); movement-entry
triggers read entered cells (p.151, p.178, p.353); "once per ability even
when multiple routes would trigger it" (p.105).

**Current state.** `LANDED (T4, 2026-08-30)`. `primitives/facts.ts` (barrel
re-exported) owns the CLOSED DISCRIMINATED `Fact` union (ability-used /
attack-resolved / damage-applied / actor-defeated / collide / movement /
effect / entity / terrain / save-resolved / trigger-resolved) with the
smallest common envelope (deterministic `instanceId`, `sourceId`, `ownerId`,
U9 provenance). `recordFacts` derives the fact history at the authoritative
resolve point from already-resolved mutations (a pure function — the same
event sequence yields the same fact sequence). `kernels/resolution-triggers.ts`
now RECORDS facts via `recordFacts`, merges the domain collide/slay facts
(spatial + defeat authority), and PROJECTS the byte-compatible
`ResolutionTriggerFacts` surface encounter.ts consumes from the typed facts
— behavior-preserving migration (all existing ability fixtures pass
unchanged). A `trigger-resolved` fact records the U16 event-de-dup marker.
Damage/held/window ledgers (`damage-ledger.ts`, `encounter-adapter.ts`) and
save records remain the domain-specific ledger authorities (documented
retained specialists) whose fact composition is a future U12 concern; the
shared de-dup identity with U16 is now fact-backed (see U16 row).

**Locations partially owning/duplicating.** `RuleResolutionFacts`
(`primitives/types.ts`); `kernels/resolution-triggers.ts`;
`kernels/encounter-adapter.ts` (damage/held/window ledger, slay/collide
projections); `kernels/damage-ledger.ts`; `kernels/trait-reactions.ts`
(ledger keys); `src/rules/encounter.ts:1106-1154` (continuation ledger);
`kernels/movement-triggers.ts` (entered/exited cells, consumed — not yet a
durable fact).

**Intended authority.** `primitives/facts.ts` (barrel re-exported): `Fact`
union with the vocabulary above; `recordFact` at each authority's resolve
point; the duplication gate reads a U16 usage identity + a U10 fact, never
re-derives from current state. Dependencies: U1 (refs), U9 (provenance).
Consumed by U6 (effect-still-exists), U12 (triggering Fact), U13 (window
opens on a Fact), U16 (de-dup identity), lifecycle/movement authorities.

**Typed vocabulary.** `Fact` union (attack/save/damage/movement/status/
entity/terrain/expiry/resolution kinds), each with provenance (U9) + refs
(U1) + durable ids.

**Replay semantics.** Facts are recorded once and consumed; replay must
consume, never rediscover. The two-pass trigger fold and the damage-window
ledger are the existing correctness bar; the fact vocabulary makes it
explicit and shared.

**Acceptance tests.** Positive: each new fact kind records at the right
resolve point; movement facts (entered/exited/actual distance) feed entry
triggers and distance-change predicates. Negative: a fact is never
re-derived from state (assert the ledger is the source on replay). Boundary:
overlapping trigger routes fire once (de-dup identity). Replay: split-event
damage window + reactive-trigger fold replay byte-identical (existing
fixtures extended to the new vocabulary).

**Consumers to migrate.** `resolution-triggers.ts` → fact records;
`trait-reactions.ts` de-dup keys → U16 identity + U10 fact;
`executedStepIds`/`derivedTriggers` → typed continuation facts (U12);
movement-entry folds consume recorded movement facts.

**Blocker families enabled (information only).** *-trigger families
(attack/damage/defeat/movement/area-exit/distance-change/effect-expiry),
triggered-terrain-creation, cure-on-trigger, mark-defeat-trigger,
enemy-ability-trigger, damage-dealt-trigger, attack-miss/exceed-trigger.

---

### U11 Flow / Sequence

**Semantic responsibility.** The core little language: sequence; let/bind
(U1); choose (U4); if (U6); apply effect; repeat/for-each; invoke;
emit fact (U10); open decision window (U13); suspend/continue later (U12).
CRITICAL: every operation in a normal ordered ability sequence sees the
ACTUAL INTERMEDIATE STATE produced by preceding operations ("rush, then
damage adjacent foe"; "remove object, then place user in its space";
"teleport, then test adjacency"; "shove, then collide"; "rush 1, then rush
1, each time optionally damage"; "remove two actors, then place them
adjacent in free spaces" — p.85, p.107 §4 listed order).

**Non-responsibilities.** Not repeat/invoke/retarget as top-level underlays
(they are FLOW OPERATIONS — retire them as peers); not a universal
game-engine DSL; not the command/event transport.

**Source evidence.** p.85 "Effects resolve in the order they are listed" and
p.107 §4; ordered-intermediate-state examples throughout ability text
(rush-then-damage, remove-then-place, teleport-then-adjacency,
shove-then-collide); repeat clauses ("rush 1, then rush 1, each time
optionally damage"); the two-pass reactive fold exists because Collide/Slay
are only knowable after resolution.

**Current state.** `PARTIAL`. `RuleProgram/RuleStep/RuleEffect`,
`executeRuleProgram`, `effectsToMutations`, `orderedSelectedSteps`,
`resolution-targets`, `if`, `repeat` (all in `kernels/runtime.ts` +
`src/rules/encounter.ts`). Flow effects execute out-of-order (mutations
are collected, not simulated); a later `repeat` iteration CANNOT observe a
prior `move`'s result; `spatialBatchId` swap legs and `resolution-targets`
are prior art for observation+grouping.

**Locations partially owning/duplicating.** `kernels/runtime.ts`
(`effectsToMutations`, `executeRuleProgram`); `src/rules/encounter.ts`
(two-pass reactive fold, continuation); `primitives/spatial-intent.ts`
(spatial batch prior art); per-resolver ordered sequencing
(`content/jobs/programs/*` hand-sequenced resolvers).

**Intended authority.** `kernels/execute-flow.ts` (extracted from
`runtime.ts`, barrel re-exported): `executeFlow(nodes, context)` with a
SIMULATED intermediate state during command planning (pure), preserving the
pure command/event architecture; `effectsToMutations` becomes the reducer-
facing projection of the same plan. Dependencies: U1 (bind), U4 (choose),
U6 (if), U10 (emit fact), U12 (suspend/continue), U15 (atomic groups),
U17 (ordering). Consumed by every domain authority that sequences effects.

**Typed vocabulary.** Flow nodes (`sequence|bind|choose|if|apply|repeat|
for-each|invoke|emit-fact|open-window|suspend`); an intermediate-state
simulation view (clone-based, pure); `RuleEffect` union extended only as the
next semantics need it (split last, per the file-split plan).

**Replay semantics.** The command plans against a simulated intermediate
state; the emitted mutation sequence is what replays — replay never
re-simulates decision logic. Repeat counts, choices, and dice are recorded
at the command boundary.

**Acceptance tests.** Positive: rush-then-damage observes the moved
position; remove-then-place observes the vacated space; teleport-then-
adjacency; repeat with observable state between iterations; for-each over a
CandidateSet. Negative: an invalid intermediate leg rejects before commit.
Boundary: zero-length repeat; empty for-each; swap group partial legality.
Replay: an ordered multi-step ability (with a prior-art `spatialBatchId`
case) replays byte-identical.

**Consumers to migrate.** Hand-sequenced resolvers → flow nodes where the
sequence is generic (repeat/intermediate state); `executeRuleProgram`'s
mutation collection → the flow plan; the two-pass fold consumes recorded
facts (U10) rather than re-deriving (stays in `encounter.ts`, reads the
shared machinery).

**Blocker families enabled (information only).** repeat-mechanic,
conditional-fly-repeat, fly-or-teleport-repeat, rebound (flow face),
effect-redirect, recipient-expansion, cross-ability-invoke,
pre-ability-movement, pre-ability-action, save-or-stun,
ordered-intermediate-state, effect-count (magnitude face).

---

### U12 Continuation / Suspension

**Semantic responsibility.** The durable armed-continuation record: source
program/action; continuation point/step; owner/controller (U2); triggering
Clock/Fact spec (U8/U10); references (U1, LIVE/CAPTURED); explicitly
captured values; source-required state; expiry/cancellation; ordering
identity (U17). Distinguishes **DEFERRED RULE** (resolve later against
THEN-CURRENT state) from **HELD RESULT** (an already-determined result waits
for a window to close — never replace A with B).

**Non-responsibilities.** Not the decision window itself (U13 opens/closes
the decision point; U12 carries what resumes); not the scheduler; not the
RNG.

**Source evidence.** ICON Delay resolves at the start of the slow turn
before ordinary activity (p.87, scheduler `delayed` phase — represent via
Clock + Ordering, not bespoke Delay code); delayed terrain/explosions
(Polaris meteor p.201-style end-of-turn effects; Carnevale p.150); "at the
start of your next turn" clauses (p.94, p.105); future summons; mark
detonations; return-from-removed-state (p.122); "at end of turn, explode at
the chosen space" (captured position); Sucker Punch holds a determined save
for the reroll window (p.143 — HELD RESULT prior art in
`rerollSaveMutations`).

**Current state.** `SKELETON`. `RuleContinuationState` (executedStepIds/
derivedTriggers) covers monotonic same-ability reactive continuation only;
lifecycle `delayed` phase handles a few delayed effects; save records carry
a continuation branch AST; trigger-window holds damage. No generic
armed-continuation record; no LIVE/CAPTURED refs; no expiry/cancellation;
no deferred-rule-vs-held-result distinction (the terrain retraction
incident `554d8ca` is the recorded lesson).

**Locations partially owning/duplicating.** `RuleContinuationState`
(`primitives/types.ts`, `src/rules/encounter.ts:1106-1154`); lifecycle
`delayed` phase (`kernels/lifecycle.ts`, `content/jobs/lifecycle-recipes.ts`);
save branch (`primitives/save-window.ts`); held damage (`encounter-adapter.ts`);
per-source delayed logic in resolvers (Polaris meteor, Carnevale,
end-of-turn effects).

**Intended authority.** `primitives/continuation.ts` (barrel re-exported):
`ArmedContinuation` record (program/action/step refs, roles, trigger
Clock/Fact spec, refs with LIVE/CAPTURED, captured values, expiry/
cancellation, ordering identity); `armContinuation` / `resumeContinuation`
(replay-exact). Dependencies: U1, U2, U8, U10, U17. Consumed by U11
(suspend/continue), U13 (windows hold/resume continuations), delayed/
terrain/entity lifecycle.

**Typed vocabulary.** `ArmedContinuation`; deferred-rule vs held-result
discriminant; captured-value map; expiry/cancellation spec; LIVE/CAPTURED
refs (U1) inside the record; continuation storage on encounter state
(currently `RuleContinuationState` on events — grows into the durable
record).

**Replay semantics.** Replay resumes the record exactly; captured values
are literals; live refs re-resolve against then-current state; never
re-place A with B (held-result fixture from the terrain retraction lesson).

**Acceptance tests.** Positive: deferred rule (delay resolves at slow-turn
start, then-current state); held result (determined save held through the
reroll window, same result if the window closes without action); captured
position explodes at the original cell after movement. Negative: expired/
cancelled continuation never resumes. Boundary: nested continuations;
continuation whose trigger fact never arrives (drains). Replay: a delayed
terrain + end-of-turn explosion + Sucker Punch reroll replay byte-identical.

**Consumers to migrate.** Lifecycle `delayed` recipes → armed
continuations; save-window branch AST → continuation records; held damage →
held-result continuations; resolver end-of-turn effects (Polaris/Carnevale)
→ armed continuations with Clock triggers.

**Blocker families enabled (information only).** delay-*, delayed-terrain,
triggered-terrain-creation, zone-regeneration, terrain-move-lifecycle,
duration-fly-state, mark-detonation-window, pre-ability-* (continuation
half), turn-start/turn-end-summon, effect-expiry-trigger.

---

### U13 Window / Decision Point

**Semantic responsibility.** ONE generic decision/reaction window
vocabulary, specialized by typed window kind: triggering Fact (U10);
eligible responders/query (U3); decision maker (U2); eligible registered
source rules; held payload (U12 held result / deferred continuation);
ordering policy (U17); action/choice (U4); close/resume. Used for:
interrupts; post-roll rerolls; post-damage-determination decisions;
Vigilance; simultaneous-owner ordering when mechanically interactive;
future post-result choices. Automatic triggered effects are NOT windows.

**Non-responsibilities.** Not automatic triggered effects (lifecycle
recipes, movement-entry triggers, reactive trigger folds are fact-driven
execution, not decisions); not the choice validator itself (U4); not the
continuation storage (U12).

**Source evidence.** Interrupt windows on when-damaged/defeated
(p.105/p.107; the two `TRIGGER_WINDOW_RECIPES` rows cite p.107/p.128
Righteous Disdain and p.107/p.138 Boiling Blood); save-reroll window
(Sucker Punch, p.143 — same-window reroll); Vigilance trigger windows
(p.105); interrupt priority/nesting and turn-order rules (p.107);
Masquerade interrupt legality (p.151); gamble windows (p.150/p.179).

**Current state.** `SKELETON`. `kernels/trigger-window.ts`
(`TRIGGER_WINDOW_RECIPES`, `decideDamageWindow`, `openDamageWindow`,
`openDamageWindowFromLedger`); `primitives/save-window.ts` (`SaveWindowSpec`,
`ResolvedSaveWindow`, window kinds); `primitives/gamble-window.ts`
(`resolveGamble`); `pendingInterrupts` + held damage in encounter state;
`rerollSaveMutations` (`kernels/runtime.ts`). Each is its own record shape;
there is NO single decision-window record covering them; window-carried
choices (U4) are not expressible; the once-per-trigger ledger (U16) is
separate.

**Locations partially owning/duplicating.** `kernels/trigger-window.ts`;
`primitives/save-window.ts`; `primitives/gamble-window.ts`;
`kernels/encounter-adapter.ts` (held damage, pending interrupts);
`kernels/runtime.ts::rerollSaveMutations`; `kernels/damage-ledger.ts`
(WindowLedger); `ability-use-choices.ts` (opaque window-ish fold).

**Intended authority.** `kernels/decision-window.ts` (new; the U13 home):
`DecisionWindowSpec`/`DecisionWindowRecord` (windowKind, triggering Fact,
responder query + decision maker, eligible registered sources, held payload,
ordering policy, choice spec, close/resume); the existing window kernels
become typed instantiations. Dependencies: U2, U3, U4, U8, U10, U12, U16,
U17. Consumed by interrupt/save/gamble domain authorities and, later, all
post-result decision content.

**Typed vocabulary.** `WindowKind` (interrupt-when-damaged, interrupt-
defeated, save-reroll, post-damage-choice, vigilance, gamble, future-choice);
one record shape; held payload union (held damage / held save / held
result / armed continuation); responder query + decision maker; ordering
policy; once-per-trigger U16 identity on the record.

**Replay semantics.** The window opens from a recorded Fact + ledger entry
(the `openDamageWindowFromLedger` bar); the decision is recorded once at
the window boundary; replay closes/resumes exactly the recorded record;
never re-evaluate mutable availability at replay.

**Acceptance tests.** Positive: each typed window kind opens/resolves;
window-carried choice (U4) resolves through the spec; Vigilance window opens
from a real damage trigger. Negative: automatic triggered effects never
open a window; unavailable responder closes with the recorded fallback.
Boundary: nested interrupts (LIFO, p.107); same-trigger turn-order; window
drained by boundary. Replay: split-event damage window + Sucker Punch reroll
+ gamble replay byte-identical (extend existing fixtures to the unified
record).

**Consumers to migrate.** `trigger-window.ts`/`save-window.ts`/
`gamble-window.ts`/`pendingInterrupts` → instantiations of the record;
`rerollSaveMutations` → resume path; `ability-use-choices` → window where
the decision is meaningful.

**Blocker families enabled (information only).** interrupt-rider/grant/
timing/rank, post-roll-reactive-choice, gamble-result-selection, damage-
preview, damage-maximize, entry-save-gate, player-choice (window half),
Vigilance (B4), mark-detonation-window, aura-trigger-grant,
foe-trigger-expansion, save-or-stun (window half).

---

### U14 Modifier / Policy

**Semantic responsibility.** How an attached rule alters a typed query
point: `ModifierRule { source, owner/reference, queryPoint, scope,
operation, value, predicate, priority/ordering if required }`. Query points
stay TYPED: listed range; internal range; area size; movement distance;
target count; action cost/type; damage dealt; damage taken; damage die;
attack boon/curse; attack threshold; save boon/curse; save threshold; use
cap; interrupt rank; duration; resource cap; permission; immunity; cover;
LoS/LoE permission; trigger permission. PERMISSION/IMMUNITY is a typed
policy/modifier query, NOT a separate underlay — but can/cannot/ignore/
immune stay DISTINCT typed query points, never one collapsed boolean.
Deterministic fold order; ownership gate (U2); closed negatives (never
alias every bypass to Divine).

**Non-responsibilities.** Not the domain authorities that consume modifiers
(range/area/damage/attack/save kernels keep their folds but read the shared
recipe); not U18 Attachment (the attachment registry/equipment predicate is
a candidate, not this underlay — though U14 is its core contribution kind);
not bespoke per-source resolver modifiers.

**Source evidence.** Listed-range changes (Dark Sliver t2 "Sacrifice 2:
Ability gains range 6", p.187); area shape/size overrides (line→arc,
line 3→6); movement-distance modifiers (fly/dash/rush families); attack
boons/curses, save boons/curses (p.102, p.105); unerring/cover/dodge
permissions (p.104/p.105); immunity/resist/deny on damage (p.102 glossary);
use caps ("use count override"); interrupt rank; duration modifiers;
"cannot/ignore/immune" distinct (p.102, p.104).

**Current state.** `LANDED (T3, 2026-08-30)` — the ONE recipe shape exists
and the value/override fold registries fold through it.
`primitives/modifiers.ts` (barrel re-exported) owns: `ModifierRule`
`{ sourceId, ownerId, queryPoint, scope, operation, value, gates, talent,
actionId, from, ordering }`; `registerModifierRule` (unknown query points
reject at registration); `applicableModifierRules` / `foldNumberModifiers` /
`foldEnumeratedModifiers` (registration order, `add` accumulates, last
`set`/`override` wins, `from`-guarded chained conversions); ONE shared gate
evaluator (`modifierGateHolds` over the shared `ModifierGate` union:
always/stealth/comeback/round-at-least/mastery/choice/self-bloodied/
target-bloodied/target-has-condition); and the typed `PermissionQueryPoint`
kinds (`cannot`/`ignore`/`immune`) with the CLOSED negative registry
`PERMISSION_NEGATIVES` — a (queryPoint, kind) pair outside it rejects at
registration, so a wildcard bypass is unrepresentable. The range
(`listed-range`, per declared scope), area (`area-size` + `area-shape`),
mastery (`interrupt-rank`/`damage-type` + the `range-bound` permission,
with the equipped+mastered requirement baked into every row), and
bonus-damage (`bonus-damage-dice`) registries convert their content rows to
shared rows at registration and fold through the shared discipline; the
kernels keep their public surfaces (`effectiveScopedRange`,
`effectiveAreaFor`, `effectiveInterruptRank`, `convertedDamageType`,
`hasUnlimitedRange`, `bonusDamageDiceForUse`) as thin adapters. Numeric
modifier VALUES are U5 `RuleNumber` expressions (`ModifierValue =
{ kind: 'number', value: RuleNumber } | { kind: 'enumerated', value: string }`)
— corrected contract: the primitive owns NO special dynamic literals (the
old `'round'` special case is the U5 `{ kind: 'round' }` expression, and the
range adapter's `'round'` shorthand translates to it at the kernel
boundary). Resolution is INJECTED: the primitive folds take a
`ModifierNumberResolver`, and `kernels/evaluate-modifiers.ts`
(`resolveModifierNumber`) is the thin kernel-layer evaluator projecting the
fold view onto the representable U5 subset (constant, round, pure scalar
compositions: add/multiply/minimum/maximum/clamp/percent) — any
context-dependent expression (stat/resource/input/distance/die) FAILS
CLOSED at resolution, never a guessed value. Enumerated replacements (area
shape, damage type) stay typed separately and are never folded
arithmetically. Retained
specialists with written boundaries: `CostModifierRule` (function-shaped
cost-list rewriting — a list transformation, not a value fold; the
`action-cost`/`action-cost-type` query points are where numeric folds
apply), the attack-modifiers armed one-shot fold (`armedKey`/`attachmentKey`/
`exactRange` consumption — armed state is not a value fold), the
scaled/recipient bonus-damage function rows, aura boon/curses and
save-window boon/curse (domain-authority consumption sites), and the
damage-exception mutation fields (`bypassVigor`/`ignoreArmor`/
`ignoreDefiance`/`ignoreAetherwall`/`ignoreCover`/`ignoreDodge` stay
distinct program-emitted delivery fields; the permission registry exists
for content-registered permission rows and the unerring → cover-ignore +
aetherwall-ignore mapping stays explicit — never one aliased Divine
bypass).

**Locations partially owning/duplicating.** The six registries listed
above + `primitives/types.ts::RuleModifier` (a stat/op/value bag without a
typed query point) + `kernels/hp-threshold.ts` + `passive-projection.ts`
(projected modifiers).

**Intended authority.** `primitives/modifiers.ts` (barrel re-exported):
`ModifierRule` one recipe shape `{source, owner, queryPoint, scope, op,
value, predicate, priority}`; `foldModifiers(queryPoint, scope, context)`
per query point; typed `PermissionQueryPoint` kinds
(`can/cannot/ignore/immune` distinct, closed negative sets per query
point); ownership gate. Dependencies: U1 (owner/ref), U2 (ownership gate),
U5 (value), U6 (predicate gate), U8 (scope). Consumed by range/area/
attack/damage/save/cost/usage domain kernels (they keep folds, read the
shape).

**Typed vocabulary.** `QueryPoint` union (the list above); `ModifierRule`;
permission kinds; fold order contract (registration order, `add` accumulates,
last `override` wins — matching today's range kernel discipline); closed
negative registries per query point (no wildcard bypass).

**Replay semantics.** Fold order is deterministic (registration order);
the fold reads durable state (equip/mastery/talent/choice) at the query
point; replay folds identically; the ownership gate is a pure function of
the record.

**Acceptance tests.** Positive: one recipe shape drives range, area, cost,
attack, damage, save folds (parity fixtures); typed permission distinctness
(cannot ≠ ignore ≠ immune). Negative: unowned modifier never folds; unknown
query point rejects; wildcard bypass impossible (closed negative). Boundary:
conflicting rules at the same query point (deterministic winner); scope
filtering; predicate-gated rules flipping on/off with state. Replay:
fold-dependent attack/damage fixtures replay byte-identical.

**Consumers to migrate.** `RangeModifierRule`/`AreaModifierRule`/
`CostModifierRule` rows → `ModifierRule` rows (content registration
rewrites, behavior-preserving); `RuleModifier` (stat bag) → typed query
points; `attack-modifiers.ts`/`mastery-fold.ts`/`bonus-damage.ts`/aura/
save-window folds read the shared shape; `ignoreAetherwall`/`ignoreCover`/
`ignoreDodge`/`bypassVigor`/`ignoreArmor`/`ignoreDefiance` → distinct
permission query points (no aliasing).

**Blocker families enabled (information only).** range-modifier,
unlimited-range, active-effect-range-modifier, aura-range-override,
*fly/dash/rush/teleport/movement-distance-modifier, attack-modifier,
ability-attack-modifier, attack-result-modifier, damage-modifier,
damage-taken-modifier, save-modifier, save-result-modifier,
dice-result-modifier, threshold-modifier, trigger-threshold-override,
target-count-override, use-count-override, resource-cap-override,
delivery-immunity, defense-bypass, pierce, condition-* suppression,
end-turn-suppress, turn-end-no-attack, fly-benefit-rider.

---

### U15 Transaction / Atomic Commit

**Semantic responsibility.** ATOMIC GROUPING + COMMIT SEMANTICS: propose
intents → validate against ONE authoritative/intermediate snapshot → if all
required legs legal, emit mutations; else reject / source-defined fallback.
Shared by: costs; resource spends; sacrifice; resolve split across
party/personal pools; atomic swaps; exact-count creation; multi-leg required
movement; grouped choices/effects where the source says all-or-nothing.

**Non-responsibilities.** NOT one merged validation algorithm (spatial stays
spatial; payment stays economy; creation stays creation) — the underlay is
the grouping + commit, not the per-domain legality.

**Source evidence.** Masquerade: "If you or your ally can't make a valid
teleport, this interrupt can't be made" (p.151 — `requiresLegalSpatialBatch`
prior art); swap groups every-leg-or-none (p.151, p.163, p.300); exact-count
entity creation (p.95/p.107/p.108 — `countMode: 'exact'`); costs validated
before any effect or RNG (p.99, p.102/103 — `assertRuleCostsPayable`);
resolve split across party pool + personal resolve (p.99).

**Current state.** `LANDED (T3, 2026-08-30)` — the generic atomic-grouping
underlay exists and the source-declared spatial batch routes through it.
`primitives/transaction.ts` (barrel re-exported) owns `TransactionLeg`
(intent + per-leg validate), `TransactionSpec` (legs + declared
validation mode + deterministic provisional-state projection),
`validateTransaction` (all-or-nothing verdict naming the first failing
leg), `proposeAtomicGroup` (intents-for-commit on `ok`), and
`legWithCheck`. Corrected contract — COLLECTIVE DEPENDENCE: a transaction
is not only a bag of independent validators over one snapshot. Two
families are BOTH representable via the declared `mode`: `simultaneous`
(default) validates every leg against the ORIGINAL common pre-state
(source-defined swaps: each swap leg judged pre-swap, never against the
other legs' projected effects — the Masquerade gate composes this mode),
and `sequential` validates leg i against the state projected by the
EARLIER proposed legs (`project(snapshot, applied)`), the cumulative
family: multiple spends against one pool, split pools, creation
conflicts, sacrifice + payoff. The projection is the CALLER's domain
projection (payment stays economy, creation stays creation) — the generic
authority never guesses how an intent changes state, and a `sequential`
transaction WITHOUT a `project` fails (a programming error, never a
silent fallback to simultaneous semantics).
The command boundary's `assertLegalSpatialBatch` (ICON p.151 Masquerade)
now composes the source-declared atomic spatial group through
`validateTransaction`: every move leg is validated against the SAME
pre-swap snapshot via the spatial gateway
(`encounter-adapter.ts::deniedAtomicSpatialLegIndices` — U15 owns the
grouping, never the geometry) and a single denied leg rejects the whole
action before any event is emitted. The cost-payment
validate-then-commit, the swap `spatialBatchId` groups, and entity
creation `countMode: 'exact'` remain the per-domain legality authorities
(their all-or-nothing contracts are the same shape and are documented as
U15 instantiations); the seam exists for future grouped flow steps and
multi-leg costs/spends.

**Locations partially owning/duplicating.** `kernels/cost-payment.ts`;
`primitives/spatial-intent.ts` + `encounter-adapter.ts` (spatial batch);
`kernels/entity-creation.ts` (exact count); `RuleAction.requiresLegalSpatialBatch`
(`primitives/types.ts`); `swapMutations` (`primitives/job-kit.ts`).

**Intended authority.** `primitives/transaction.ts` (barrel re-exported):
`TransactionGroup` (intents, validation against one snapshot, commit /
reject / source-defined fallback); `proposeTransaction` /
`commitTransaction`. Dependencies: U1 (refs), U6 (conditional legs),
U8 (scope). Consumed by U11 (flow steps that group), resource/economy,
spatial/movement, placement/entity domain authorities.

**Typed vocabulary.** `TransactionGroup`; intent shapes (typed per domain,
validated by the domain's authority); commit/reject/fallback results;
snapshot semantics (clone-based pure prevalidation — the swap-group
pattern generalized).

**Replay semantics.** The prevalidation happens once at the command
boundary against the authoritative snapshot; the emitted mutations (all-or-
none) replay verbatim; replay never revalidates.

**Acceptance tests.** Positive: cost+swap+creation grouped commit; partial
legality rejects the whole group (Masquerade fixture); exact-count creation
fails closed. Negative: never partial-apply a denied group; no
cross-batch co-movement (existing group-scoped occupancy tests extend).
Boundary: empty group; cap-reduced success (legitimate partial per source
cap); source-defined fallback path. Replay: swap + exact-creation fixtures
replay byte-identical.

**Consumers to migrate.** `cost-payment.ts` commit path → transaction
machinery; `spatialBatchId` groups → `TransactionGroup`; `countMode: 'exact'`
→ transaction commit semantics; `requiresLegalSpatialBatch` gate → group
prevalidation.

**Blocker families enabled (information only).** resource-management,
heroics-economy, vigor-grant, variable-cost, sacrifice-percent, wound-cost,
charge-combo-activation, combo token folds, movement-entry-cost,
multi-actor-teleport (group half), forced-placement (atomic half).

---

### U16 Usage / Entitlement Ledger

**Semantic responsibility.** "How many times has/may this rule be used/
triggered within Scope X?" — distinct from spendable RESOURCE. Represent:
key/source; owner/reference; optional target/reference; scope (U8); count;
cap; reset Clock; increment/consume; refresh; de-duplication identity.

**Non-responsibilities.** Not resource spend (economy domain); not the fact
record itself (U10 records outcomes; U16 counts entitlements — the de-dup
identity reads both).

**Source evidence.** once-per-turn / once-per-round / N-per-round /
N-per-combat / first-use (p.99, p.105); "once per ability even when
multiple routes would trigger it" (p.105); once-per-target; dangerous-terrain
once per turn; slashed once per turn; one attack-tag ability per turn
(p.129 Special); no-repeat ability rule; limit break once/combat; Vigilance
once per trigger (p.105); interrupt refresh; per-use magnitude ("2nd/3rd use
dashes 3/2/1").

**Current state.** `CORE LANDED (T3, 2026-08-30); full completion staged to
T4`. `primitives/usage.ts` (barrel re-exported) owns the core ledger:
`UsageKeySpec`/`usageKey` (byte-identical `ledger:<scope>:<sourceId>`
format, extended per-target — the STORAGE key, actor-local by design), and
`usageIdentity`/`usageIdentityKey`/`usageIdentitiesEqual` (the typed
DE-DUP IDENTITY, corrected contract: DISTINCT from the storage key and
ALWAYS carrying the owner — two different owners of the same
source/scope/target have different identities, proven by negative test,
so T4's U10 fact-backed de-duplication cannot inherit the storage key's
owner collision; the U10 fact read completes the full trigger-family
identity in T4), `usageCount`, `ledgerAvailable`,
`consumeUsageMutation` (one-shot boolean mark or N-per-scope count
increment), `refreshUsageMutation`, `usageRead` (per-use magnitude
ordinal), `holdsUsageKey`, `resetBoundaryFor` (turn/round/combat onto U8
boundaries), and `usageCap` (folds the U14 `use-cap` query point for
count-override caps). `kernels/use-ledger.ts` is now a thin adapter
preserving the byte-identical keys/marks (the F9 `roundLedgerKey`
contract still holds), and the U6 `used-scope` predicate evaluates against
the durable ledger. **T4 (2026-08-30) completed U16's U10-backed
de-duplication** (`primitives/facts.ts`): the full resolve identity is the
U16 usage identity (source + owner + scope + optional target, the corrected
owner-carrying `usageIdentity`) PLUS the logical `trigger` PLUS the U10
FACT dimension (`resolveIdentityKey` — collision-safe JSON-tuple
serialization). `triggerResolvedFact` records the marker; `hasResolvedAsFact`
answers "has this exact logical use resolved for this underlying fact/event?"
over the recorded fact history — never current state, never a broad
once-per-scope ledger mark. Ordinary entitlement COUNTS stay in the ledger
(`used-scope`); event de-duplication is the fact read — semantically
distinct. Remaining (honest, staged): the `interrupt-uses` counter and the
`attacked-this-turn`/`end-turn` ruleState flags remain durable
encounter-authority fields whose typed-ledger migration is the T6
consolidation item.

**Locations partially owning/duplicating.** `kernels/use-ledger.ts`;
`kernels/trait-reactions.ts` (`roundLedgerKey`, de-dup ledger);
`RuleContinuationState.executedStepIds` + `derivedTriggers`
(`src/rules/encounter.ts`); F9 once-per-ability registries; `ruleState`
`attacked-this-turn`/`end-turn` flags; `interrupt-uses` counter;
`content/jobs/*` gated rows.

**Intended authority.** `primitives/usage.ts` (barrel re-exported):
`UsageLedger` record (key/source/owner/target ref/scope/count/cap/reset
Clock/refresh hook); `ledgerAvailable` / `consumeUsage` / `refreshUsage`;
one de-dup identity (`usageKey(source, owner, target, scope, fact)`).
Dependencies: U1 (refs), U8 (scope/Clock), U10 (de-dup fact identity).
Consumed by U5 (usage reads), U6 (usage predicates), U13 (once-per-trigger
windows), U17 (ordering of simultaneous uses), lifecycle/movement/terrain
authorities.

**Typed vocabulary.** `UsageLedger`; `UsageScope` over the U8 Clock;
per-use magnitude (`usageRead(key, ordinal)`); refresh hooks; de-dup
identity type shared with U10 facts.

**Replay semantics.** The ledger decision is made once at the command
boundary and recorded as a durable state mutation (today's bar); replay
consumes the recorded marks; the de-dup identity is derived from durable
facts + keys, never re-derived from current state.

**Acceptance tests.** Positive: N-per-round cap; per-use magnitude
(2nd use = 3, 3rd use = 2, 1st = 1); refresh at boundary; once-per-trigger
across multiple routes fires once. Negative: capped use rejected;
unequipped source never consumes. Boundary: cap reduced by an override;
refresh-vs-combat boundary; shared-turn-ledger across two actors. Replay:
reactive-trigger de-dup + interrupt-use fixtures replay byte-identical.

**Consumers to migrate.** `trait-reactions.ts` de-dup → shared identity;
`executedStepIds`/`derivedTriggers` de-dup → U16 identity + U10 facts;
`attacked-this-turn`/`end-turn` flags → typed ledger entries;
`interrupt-uses` → ledger; movement/terrain once-per-turn gates → ledger.

**Blocker families enabled (information only).** use-count-override,
interrupt-use-scaling, first-use-gate, auto-refresh, shared-turn-ledger,
turn-end-no-attack, mark-activation-gate, once-per-round-fly-grant (usage
face), movement-trigger (dedup face), dangerous-terrain once-per-turn,
limit-break once/combat, no-repeat ability rule.

---

### U17 Ordering / Arbitration

**Semantic responsibility.** Typed policies for "when multiple operations
are simultaneously eligible, what determines their order" — NOT one
`priority: number`: source-order; stack/LIFO; turn-order;
hostile-before-beneficial; non-active-owner-before-active-owner;
controller-choice; explicit ordered list. A policy may YIELD A CHOICE (U4)
when the source gives someone authority to order.

**Non-responsibilities.** Not the scheduler's turn election (scheduler
stays); not array-iteration as an implicit rule; not the decision window
itself (U13 consumes ordering policies).

**Source evidence.** Listed effect order (p.85, p.107 §4 — `orderedSelectedSteps`);
explicitly overridden effect order; interrupt nesting (most-recent trigger
first) and same-trigger turn-order rules (p.107); turn-boundary ordering
(non-turn-character effects first, hostile before beneficial, same-owner
player determines order — p.107); Delay ordering at slow-turn start (p.87);
turn alternation; player ordering choices (p.107).

**Current state.** `LANDED (T3, 2026-08-30)` — typed policies + the
policy→CHOICE seam exist and the engine's recorded orders route through
them. `primitives/ordering.ts` (barrel re-exported) owns `OrderingPolicy`
(source-order | stack | turn-order | hostile-before-beneficial |
non-active-owner-first | controller-choice | explicit-list),
`applyOrdering(policy, candidates, context)` (pure — a function of the
recorded policy + durable context, returning `OrderingResult`),
`policyYieldsChoice` (controller-choice yields a typed U4 choice spec;
the engine never invents an order), `orderingKey` (durable identity),
and the side/owner policy reads. Corrected contract — FAIL CLOSED:
`applyOrdering` returns `{ ok: true, ordered }` or `{ ok: false, problem }
` with typed problems (`missing-source-order`, `missing-turn-order`,
`missing-perspective`, `missing-active-owner`, `yields-choice`,
`unknown-candidate`); a policy whose required context is absent, or whose
candidates are not fully covered by its declared authority
(source-order/turn-order/explicit-list audit candidate ids against the
declared list), is UNRESOLVED and the command/window boundary REJECTS —
"fail closed" means reject, never "use whatever order the caller
supplied". `controller-choice` is never resolved by `applyOrdering`: it
returns `yields-choice` carrying the typed choice and the caller routes
it through U4.
`orderedSelectedSteps` (the engine's ability-step order, p.85/p.107 §4)
now applies the `source-order` policy against the ability's step listing;
`decideDamageWindow` applies the `source-order` policy against
`TRIGGER_WINDOW_RECIPES`; the pending-interrupt LIFO pop (p.107 most-
recent-trigger-first) applies the `stack` policy. The lifecycle registry
order stays the recorded boundary contract (`LIFECYCLE_RECIPES`
registration order IS the explicit recorded policy) and the scheduler's
turn election remains the scheduler authority — both documented as U17
consumers; hostile-before-beneficial / non-active-owner-first /
controller-choice land their turn-boundary consumers with the U13 window
work in T5.

**Locations partially owning/duplicating.** `kernels/runtime.ts`
(`orderedSelectedSteps`); `kernels/lifecycle.ts` (registry order);
`kernels/trigger-window.ts` (recipe order); `encounter-adapter.ts`
(pending-interrupt order); `turn-scheduler.ts` (turn order — scheduler
authority, reads policies where needed).

**Intended authority.** `primitives/ordering.ts` (barrel re-exported):
`OrderingPolicy` union (source-order | stack | turn-order |
hostile-before-beneficial | non-active-owner-first | controller-choice |
explicit-list); `applyOrdering(policy, candidates, context)`;
`policyYieldsChoice` → U4 `ChoiceSpec`. Dependencies: U2 (role-based
policies), U4 (policy→CHOICE seam). Consumed by U11 (flow order), U12
(ordering identity on continuations), U13 (window ordering), lifecycle,
interrupt engine.

**Typed vocabulary.** `OrderingPolicy` union; per-policy arguments (explicit
lists, choice specs); `orderingKey` for durable identity.

**Replay semantics.** Ordering is a pure function of the recorded policy +
durable state; replay never depends on array construction order;
controller-choice ordering records the player's ordering decision.

**Acceptance tests.** Positive: hostile-before-beneficial at a turn
boundary; LIFO interrupt nesting; controller-choice ordering yields a
recorded decision; explicit-list policy. Negative: undefined policy rejects;
unorderable candidates (no policy) reject rather than iterating silently.
Boundary: same-owner simultaneous effects; empty candidate list. Replay:
turn-boundary + interrupt-nesting fixtures replay with identical ordering.

**Consumers to migrate.** `orderedSelectedSteps` → source-order policy
adapter; lifecycle registry order → explicit recorded policy;
`TRIGGER_WINDOW_RECIPES` order → policy; `pendingInterrupts` order → stack/
turn-order policy; scheduler reads policies where mechanically interactive.

**Blocker families enabled (information only).** interrupt-timing/rank
(ordering half), Delay ordering, turn-boundary effect ordering,
simultaneous-owner ordering, player ordering choices, foe phase transition
order (Part C).

---

## 2. Candidates: U18 Attachment and U19 Intent (evaluate, do not assume)

Both stay candidates until the design test is passed with code evidence.
This plan's phases generate that evidence; the decision point is in Phase T6.

### U18 Attachment / Contribution — CANDIDATE, do not promote yet

**What it would be.** A generic recipe: `source attachment` + `ownership/
equipment predicate` + `attachesTo query` + `contributions: modifiers |
extra flow steps | triggers/windows | action grants | policy grants |
choices`, eliminating independent fold architectures (`mastery-fold.ts` +
trait fold + talent fold + fortune).

**Design-test walk-through (generic-underlays.md §Design test).**

1. New REFERENCE kind? → No, refs are U1.
2. ROLE distinction? → The ownership/equipment predicate is U2-shaped
   (owner/controller) + U1 refs, not a new algebra.
3. QUERY? → `attachesTo` is a U3 query.
4. CHOICE? → contribution choices are U4.
5–10. VALUE/PREDICATE/ANCHOR/SCOPE/PROVENANCE/FACT? → No.
11. FLOW operation? → "extra flow steps" and "action grants" are U11
   contributions.
12. CONTINUATION? → "triggers/windows" are U12/U13 contributions.
13. WINDOW? → Same as 12.
14. MODIFIER/POLICY query point? → "modifiers" and "policy grants" are
   exactly U14 contributions.
15–17. TRANSACTION/USAGE/ORDERING? → No.
18. Operation of an existing DOMAIN AUTHORITY? → Partially: the folds live
   at attack/damage/range/area query points (Part B authorities).
19. Genuinely new STRUCTURAL STATE MODEL? → No.

**Assessment.** Every contribution KIND maps onto an existing underlay
(U14/U11/U13/U12/U4/U3). What is genuinely new is the **attachment
registry + equipment predicate** — but that is content registration glue
plus U2-role/U1-ref reads, not new algebra. U18 should be promoted only if,
during the U14 consolidation (Phase T3) and U11/U13 work (Phase T5), a
single shared attachment record actually eliminates duplicated fold
authority that the one-recipe-shape ModifierRule cannot.**Decision rule:** promote U18 iff, after T3/T5, `mastery-fold.ts` + `attack-modifiers.ts` trait fold + talent folds + fortune still require a common record that is not just U14 ModifierRule + U11 flow steps + U13 windows registered from content. Otherwise fold consolidation is a U14/U11/U13 migration and U18 stays a content-registration pattern.

**T3 evaluation (2026-08-30):** the U14 consolidation did NOT produce a
need for a new attachment record. `mastery-fold.ts` now reads the shared
`ModifierRule` registry (`interrupt-rank`/`damage-type` rows + the
`range-bound` permission), and range/area/bonus-damage fold through the
same one-shape rows; the attack-modifiers armed one-shot fold, the
cost function rows, and the fortune/aura/save-window folds remain
documented retained specialists with written boundaries (their remaining
duplication is the armed-state consumption seam and the U11/U13 consumer
migrations, not a missing record kind). **Verdict: U18 stays a candidate;
no promotion.** The decision point re-opens at T6 after the U11/U13 work,
per this rule.

### U19 Intent — CANDIDATE, do not promote yet

**What it would be.** A typed layer between FLOW and mutations:
`source rule → Flow ops → typed mechanical Intent → domain authority
validates/resolves → durable Mutation/Event`. Partial evidence exists
(entity `creation-spatial` intent, `SpatialIntent`, `resolveSaveWindow`
spec).

**Design-test walk-through.** Q11 (FLOW operation?): intents are emitted by
flow ops and consumed by domain authorities — they are the flow/domain
boundary, i.e. a convention INSIDE the existing layers. Q18 (operation of an
existing DOMAIN AUTHORITY?): validation/resolution already lives in the
domain authorities (entity-creation, spatial gateway, save window). Q15
(TRANSACTION?): U15's propose→validate→commit is intent-shaped.

**Assessment.** The existing intent evidence is domain-authority validation
discipline (paired `creationSpatial`, `SpatialIntent`, `SaveWindowSpec`),
not a missing algebra. U19 should be promoted only if Phase T5 (U11/U12/U13)
+ U15 reveal duplicated validation authority that a typed intent layer
removes (e.g. the same legality re-checked at command time AND reducer time
for the same intent). **Decision rule:** promote U19 iff after T3/T5 the
command-boundary validation and the reducer validation of the same typed
intent still drift; otherwise keep intents as the domain authorities'
validation contracts and do not add a wrapper layer.

Neither U18 nor U19 is on the critical path to the UNDERLAY PHASE COMPLETE
gate. The gate (§4) can close with both still candidates.

---

## 3. Dependency DAG and implementation order

### 3.1 Edges (A → B: A requires B before A's contract can complete)

| Underlay | Depends on |
| --- | --- |
| U1 Reference | — |
| U2 Role | — |
| U8 Scope/Clock | — |
| U3 Query | U1, U2, U5 (core), U7 |
| U4 Choice | U3, U2 |
| U5 Value | U1, U3 (only the `count(query)` extension; the core scalar algebra precedes U3) |
| U6 Predicate | U1, U3, U5, U8, U10 (effect-still-exists) |
| U7 Anchor | U1, U2 |
| U9 Provenance | U1, U2 |
| U10 Fact | U1, U9 |
| U11 Flow | U1, U4, U6, U10, U12, U15, U17 |
| U12 Continuation | U1, U2, U8, U10, U17 |
| U13 Window | U2, U3, U4, U8, U10, U12, U16, U17 |
| U14 Modifier | U1, U2, U5, U6, U8 |
| U15 Transaction | U1, U6, U8 |
| U16 Usage | U1, U8, U10 (de-dup identity) |
| U17 Ordering | U2, U4 |

Notes.

- **U5↔U3 is the one co-evolution seam.** U3's dynamic range evaluation
  consumes `evaluateNumber` (U5 core); U5's `count(query)` consumes U3.
  Resolve by sequencing U5 core → U3 → U5 extensions; the graph stays
  acyclic at the implementation level.
- **U12→U11 is not an edge.** Flow can suspend into a continuation, so
  U11's `suspend/continue` node requires U12; U13's held payload is a U12
  continuation, so U13 requires U12 (and U11's `open-window` node requires
  U13). Order: U12 → U13 → U11's window/suspend ops. The core U11 (sequence/
  if/repeat with intermediate state) can land before U12/U13.
- **U16's de-dup identity requires U10**; the core usage ledger
  (gates/caps/reset) requires only U1+U8 and can land earlier.

### 3.2 Implementation order (objective: all underlays complete)

The generic-underlays.md tranche list is a suggested sequence; this order
replaces it with a dependency-respecting phase plan. After EACH phase:
re-run the full verification suite (§5); update this document's per-underlay
state rows and any affected generated docs; do NOT regenerate or promote
from the blocker census (census work is post-gate). Existing wiring must
pass unchanged at every phase boundary.

**Phase T1 — Vocabulary foundation: U1, U2, U8.** — **LANDED (2026-08-30).**
New typed modules (`primitives/reference.ts`, `primitives/roles.ts`,
`primitives/scope.ts`) re-exported from the `primitives/types.ts` barrel;
`RuleDuration`/`RuleTiming` boundary reads gain the Clock surface
(`clockForTiming`/`scopeForDuration`/`currentClock`/`boundaryReached`);
`RuleChoice` gains chooser/controller role fields (typed, optional —
behavior-neutral until U4 consumes them); `RuleExecutionContext.boundNames`
carries the U1 Binder (optional, behavior-neutral). No behavior change,
zero existing test deltas (1318 tests green, +31 new vocabulary tests:
`reference.test.ts`/`roles.test.ts`/`scope.test.ts`), U3 residual
classification corrected by the pre-flight audit (actor-domain operator
gaps + the p.108 teleport-LoS boundary, see §0). U1/U2 moved ABSENT →
PARTIAL; U8 stays PARTIAL (vocabulary + boundary-read surface landed;
consumer migration remains). Exit met: vocabulary types + unit tests;
zero existing test deltas.

**Phase T2 — Query & expression algebra: U7, U3, U5, U6 (core), U4.** —
**LANDED (2026-08-30).** `primitives/anchor.ts` (SpatialAnchor,
LIVE/CAPTURED) landed earlier; T2 added the LIVE ENTITY anchor.
`kernels/evaluate-query.ts` (extracted from `selectActors` with real
`rangeOrigin` resolution) owns the actor/position/entity/terrain domain
operators — the query TYPES now live in `primitives/query.ts` (split-plan
home); `selectActors` migrated, the direct-target gate's base eligibility
routed through the candidate authority, and area actor-inclusion routed
through the `insideArea` operator (all landed earlier, behavior-
preserving). T2 completed the actor-domain operator list (LoS/LoE from
the anchor, occupying, terrain predicate, owned-by, set composition with
distinct-by-identity), added the entity + terrain domains, and resolved
the p.108 placement-LoS boundary through the shared legality operator +
position query policy (`move.line-of-sight`; behind-the-wall + control
fixtures). `kernels/evaluate-value.ts` + `kernels/evaluate-predicate.ts`
extracted from the runtime barrel (which re-exports them) and extended
(`count-query` over all domains, distance between refs/anchors,
percent-base-max; mark-exists / in-stance / inside-aura /
acted-this-round predicates); `choice.ts` completes the U2
chooser/controller seam and routes position legality through a U7
`rangeOrigin` anchor. **U6 lands in CORE form here** — the predicate
algebra without the `effect-still-exists` read, which consumes U10 facts
(see the U6 row); U6's U10-backed completion lands in T4. Exit met for
the T2 scope: one eligibility authority; `rangeOrigin` resolved (actor /
entity / captured-position); expression/predicate core covers the §1
lists for the T2 contract; choice position legality routes through the
shared predicates + anchor. Honest residuals: area/persistent-instance/
rule-source query domains (U10/U12-scoped), ordering beyond the
min-distance set + opt-in cell order, direction-choice candidate domain,
the opaque ability/talent choice folds, used-scope (U16) and
effect-still-exists (U10) predicates, and the range/area gate body
folding.

**Phase T3 — Policy, state, ledger: U14, U16 (core), U15, U17 — LANDED
(2026-08-30).** `primitives/modifiers.ts` landed (one recipe shape, typed
permission query points, closed negatives, shared gate evaluator); the
range/area/mastery/bonus-damage fold registries convert onto it
(behavior-preserving; cost + attack-modifiers retained as documented
specialists); `primitives/usage.ts` landed as the CORE ledger (keys,
caps incl. the `use-cap` fold, counts, consume/refresh, per-use
magnitude, de-dup identity CORE without the U10 fact read) with the
use-ledger kernel as an adapter and the U6 `used-scope` predicate
consuming it; `primitives/transaction.ts` landed (all-or-nothing verdict,
wired into the Masquerade spatial-batch gate); `primitives/ordering.ts`
landed (all seven policies + the policy→CHOICE seam, wired into
`orderedSelectedSteps`, `decideDamageWindow`, and the pending-interrupt
stack pop). **U16 landed in CORE-ledger form here** (gates/caps/reset need
only U1+U8, per the DAG note); U16's U10-backed de-dup identity completes
in T4. U18 evaluated under the §2 decision rule: NOT promoted (see the
U18 row). Exit met: one ModifierRule shape folded everywhere; one usage
ledger vocabulary; one commit seam; typed ordering policies.

**Phase T4 — Time and outcome: U9, U10 (completes U6 and U16) — LANDED
(2026-08-30).** `primitives/provenance.ts` (dimension vocabulary,
`DeliverySourceKind`, `sameCausalOrigin`, `provenanceOfMutation`) and
`primitives/facts.ts` (the closed `Fact` union, `recordFacts`, the LIVE
`effectExistsLive` instance read, and the `trigger-resolved` de-dup marker +
`hasResolvedAsFact` read) LANDED and are barrel re-exported. U6 was
COMPLETED with `effect-still-exists` reading U10 instances via the
fact/instance seam (fail-closed on unrepresentable instance identity). U16
was COMPLETED with the U10-backed de-dup identity (`resolveIdentityKey` =
usage identity + trigger + fact dimension; `hasResolvedAsFact` over the
recorded fact history — event de-dup, semantically distinct from the
`used-scope` entitlement counts). `kernels/resolution-triggers.ts` migrated
onto U9/U10: it records facts via `recordFacts`, merges the domain
collide/slay facts, and projects the byte-compatible `ResolutionTriggerFacts`
surface encounter.ts consumes (behavior-preserving — all existing ability
fixtures pass unchanged, 1632 tests green; no census change;
`sourceActivations` count unchanged). The damage/held/window + save records
ledgers remain domain-specific authorities (documented retained
specialists) whose fuller fact composition is U12-scoped. Exit met for the
T4 scope: facts are the resolved-history authority; mutations/events carry
the applicable provenance dimensions; U6 and U16 are complete WITH their
declared U10 dependencies.

**Phase T5 — Execution: U11, U12, U13.**
`kernels/execute-flow.ts` (simulated intermediate state, bind/for-each/
invoke/emit-fact); `primitives/continuation.ts` (armed records, LIVE/
CAPTURED, deferred-rule vs held-result, expiry); `kernels/decision-window.ts`
(one record; trigger-window/save-window/gamble-window/pending-interrupts
become instantiations); `rerollSaveMutations` → resume path. Exit:
suspend/resume replay-exact; windows are one record shape; the terrain
retraction lesson (`554d8ca`) is covered by fixtures.

**Phase T6 — Consolidation and gate: U18/U19 decision, migration
completion, gate.**
Apply the §2 decision rules (promote U18/U19 only with code evidence);
complete every listed consumer migration that still has duplicate
authority; regenerate generated docs affected by behavior-preserving
changes; run the complete suite; assert the §4 gate. No source-unit
promotion here.

Rationale (dependency-driven, not census-driven): vocabulary first because
every other underlay reads refs/roles/clocks; query/expression second
because targeting/choices/predicates/modifiers all consume them; policy/
state third because modifiers/usage/transactions/ordering are the
deterministic folds the execution layer needs; time/outcome fourth because
continuations/windows trigger on facts with provenance; execution last
because U11/U12/U13 compose everything above. Blocker-family frequency was
NOT an input (information-only per §1).

---

## 4. Phase gate

### UNDERLAY PHASE COMPLETE

The underlay phase is complete **only when all of the following hold**:

1. **U1–U17 have source-backed contracts.** Each underlay's §1 row
   (responsibility, source evidence with verified page references, typed
   vocabulary, replay semantics, acceptance tests) is current and true of
   the code at HEAD — not of a tranche document.
2. **One clearly owned semantic authority each.** For every U1–U17 there is
   exactly one owning module/API listed as its authority, and every location
   named under "Locations partially owning/duplicating" has either migrated
   onto it or been explicitly documented as a retained specialist with a
   written boundary.
3. **Required tests.** The acceptance tests named in each §1 row exist and
   pass: positive, negative, boundary, and replay where the underlay is
   stateful/random/timing-dependent.
4. **No known duplicate competing authority within declared scope.** The
   §1 migration lists are empty of unresolved duplicates: no second
   eligibility authority beside U3, no second choice validator beside U4,
   no second usage ledger beside U16, no second decision-window record
   beside U13, no second ordering source beside U17, one ModifierRule
   shape, one transaction seam, one fact ledger.
5. **The full suite is green:**
   - `npm run audit:architecture`
   - `npm run audit:automation`
   - `npm run audit:source-fidelity -- --strict`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `git diff --check`
   - `npm run audit:class-job-census` (census must regenerate byte-stable)

   with no relevant introduced failures.
6. **Candidates decided.** U18/U19 are either promoted through the §2
   decision rules (with their own contracts appended to this document) or
   explicitly retained as candidates/patterns with the evidence recorded.
7. **Generated docs regenerated.** `docs/blocker-census.md/json`,
   `docs/source-fidelity.md` reflect the post-gate repository state.

**Only after this gate** do we regenerate the blocker census as the
wiring-order input and begin source-content wiring (exact source units,
source fixtures, positive/negative/replay tests, per §9/§11 of AGENTS.md).
Until the gate closes, the census is not regenerated for promotion purposes
and the greedy family sequence in TODO/roadmap remains superseded.

---

## 5. Verification discipline during the phase

- After every tranche (T1–T6), run the §4.5 suite. Do not report success
  while relevant introduced failures remain.
- Regenerate byte-stable artifacts the generators own
  (`audit:class-job-census`, `audit:source-fidelity -- --write`) when the
  change affects them; never hand-edit generated docs.
- Behavior-preserving migrations: existing fixtures are the oracle. A
  migration that changes a fixture's meaning is a semantic change — stop and
  classify it, do not paper over it.
- Update `docs/rules-foundations.md` maturity rows and this document's
  state rows as tranches land; delete stale claims rather than layering
  contradictory prose (AGENTS §15).
- `primitives/types.ts` and `kernels/runtime.ts` stay compatibility barrels
  (`export *`) for the duration; extraction goes to semantic modules the
  barrels re-export. No flag-day file-layout refactor.

---

## 6. Do-not list (phase-specific restatement)

- Do not wire, promote, or make executable any unresolved source unit.
- Do not add source-ID branches to kernels/primitives.
- Do not create bespoke mechanics for a rule the substrate cannot express;
  decompose or leave unresolved.
- Do not approximate rules to move census numbers.
- Do not follow the TODO/roadmap greedy family sequence; the order in §3.2
  supersedes it for this phase.
- Do not invent underlays past U17 without the design test; U18/U19 follow
  §2 decision rules.
- Do not refactor `src/rules/encounter.ts` wholesale; extract only along
  real reusable mechanic seams (AGENTS §7).
- Do not treat a tranche document as evidence of a landed underlay; the
  code + tests at HEAD are the evidence.
