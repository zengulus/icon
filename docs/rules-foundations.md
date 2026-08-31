# Rules foundations — maturity map

Authoritative map of the engine's reusable mechanical foundations: what each
is for, where it lives, how mature it actually is (verified against
implementation and tests, not aspiration), and what content it unlocks. This
file also owns the **missing kernel/primitive ledger** (it absorbed the former
`kernels-needed.md` / `primitives-needed.md`) and the **architecture-debt
ledger**.

Related documents: [`deliverables.md`](deliverables.md) (artifact status),
[`rules-coverage.md`](rules-coverage.md) (content-family coverage),
[`blocker-census.md`](blocker-census.md) (**generated** Class/Job unit graph),
[`source-fidelity.md`](source-fidelity.md) (**generated** strict
source-fidelity status), [`glossary-executable-inventory.md`](glossary-executable-inventory.md)
(per-term combat-glossary detail), [`../TODO.md`](../TODO.md) (actionable
backlog).

## Source-fidelity auditing (strict)

The engine's capability/closure claims are COMPUTED, not asserted. The strict
audit (`npm run audit:source-fidelity -- --strict`) derives every strong
status from the evidence graph in `src/rules/fidelity/`:

    immutable source (SHA-pinned PDF → byte-verified extraction catalogs)
        ↓  collectRuleSourceUnits() + curated decomposition
    atomic source obligations (stable semantic IDs + passage fingerprints)
        ↓
    explicit disposition (deterministic / player-choice / gm-facing /
    descriptive / table-facing / deferred / conflicted / unclassified)
        ↓
    typed consumer registration + independent semantic contract
        ↓
    proof registry (positive/boundary/negative/exhaustive/replay/integration,
    statically verified against actual test files; line coverage is not proof)
        ↓
    computed obligation status + scope ladder
    (blocked < partial < executable < source-tested < replay-tested < closed)

Key semantics:

- `unclassified` never counts as supported; it blocks closure of its scope.
  Every catalogued source unit is seeded as an unclassified unit-grain
  obligation until deliberately decomposed into curated obligations — that is
  the documented migration state for legacy coverage.
- Source conflicts are executable only via an ADOPTED record in
  `src/rules/source-adjudications.ts`, linked from the obligation.
- The audit distinguishes legitimate incompleteness (lowers status) from
  inconsistent claims of completeness (fails strict mode): dangling
  references, executable claims without consumers/contracts/proofs,
  unadjudicated conflicts used in executable paths, documentation claiming a
  stronger status than computed, generated-doc drift, or a semantic mutation
  accepted by the mutation-resistance oracle.
- The audit framework itself is tested against synthetic fixtures covering
  failure classes A–I (`src/rules/__tests__/fidelity-audit.test.ts`),
  including mutants that pass naive positive-only test suites but violate an
  exhaustive semantic contract.

## Persisted player-selection identity contract

Persisted player character records (schema v5) store only permanent canonical
IDs for every player-selectable narrative value — `kinId`, `cultureId`,
`bondId`, `bondActionId`, `bondPowerIds`, plus the `ActionId`-keyed `actions`
— never display labels. The canonical registries (Kin, Culture, Bond, Bond
power, Action; plus Job and Ability for the wider character surface) live in
`src/rules/` and are frozen by the ID-immutability guard
(`src/rules/__tests__/catalog-identity.test.ts`) against the committed snapshot
`src/rules/__tests__/__snapshots__/catalog-identity.json`.

> **Persisted source-selection IDs are permanent compatibility contracts.**
> Display names are not identities. Renaming/removing/reusing a released ID
> requires an explicit character-schema migration
> (`migrateCharacter`); a display-name edit never changes an ID.

`migrateCharacter` converts pre-v5 display-name records into IDs via an
explicit value map, declining any value it cannot resolve instead of
guessing. The player-facing creation projection
(`src/rules/player-creation.ts`) carries only identity + display data and
structurally cannot expose an engine implementation-status field
(`automation`/`executable`/`structured`/`implemented`/`unresolved`) — a
character selection means "the player chose source content ID X", nothing
more. Selecting content never implies that its rule is executable.

## Maturity states

| State | Meaning |
| --- | --- |
| ABSENT | No implementation |
| SKELETON | Typed seam/data exist; no execution authority |
| PARTIAL | Executes for real consumers; known semantic holes listed |
| AUTHORITATIVE | Execution matches source semantics for its scope |
| + SOURCE-TESTED | Has independent source-page regression fixtures |
| + REPLAY-TESTED | Additionally proven durable under `applyEvents` replay |

## Foundation families

### Player choice (CHOOSE underlay) — AUTHORITATIVE + SOURCE-TESTED (2026-08-29)

One semantic choice authority over the typed command input buckets:
`kernels/choice.ts` (`resolveChoice`/`resolveChoices`). Every player decision
is a `RuleChoice` row (actors/positions/direction/option/number/boolean) on
the source's `RuleAction`; the command carries narrow values in the
`RuleExecutionInput` buckets. The kernel rejects a required missing choice
before any cost/RNG (`choice.<kind>-required`), treats an optional missing
choice as "decline" (never a default), and validates supplied values against
the row's declared constraints (cardinality min/max/distinct, relation,
p.92 footprint range, option membership, numeric bounds, direction non-zero,
position in-grid). Actor-candidate legality is delegated to the shared U3
authority (`kernels/candidate.ts`, see below) — the kernel keeps only
required/optional, cardinality, and distinctness. T2 (2026-08-30): position
choices route their in-grid + footprint-range reads through the shared U3
position predicates and the range frame is a U7 `RuleChoice.rangeOrigin`
anchor (default the acting actor; a malformed anchor rejects the choice
instead of silently skipping the range check), and
the U2 chooser/controller substrate is consumable
(`choiceEntitledPlayer(choice, RoleFrame)` — declared chooser, else
controller, else the source; an underivable declared role returns null,
never a fallback). Domain refinements stay
with their specialists (`kernels/teleport-choice.ts` owns unoccupied +
Rampart + the p.108 line-of-sight leg). Network parity:
`StatusSaveCommandInput` + the `USE_ABILITY` websocket schema carry all six
buckets (non-ability commands carry only the Blessing surface). Pre/post
boundary: a choice whose candidate set depends on a roll/movement/future
state is NOT representable here — it belongs to the future
WINDOW/CONTINUATION underlays; never supply it speculatively. Tests:
`choice.test.ts` (23 semantic cases) + protocol fixtures. Sequencing owner:
[`generic-underlays.md`](generic-underlays.md).

### Candidate sets (QUERY underlay) — PARTIAL: actor/position/entity/terrain query with the eligibility duplicates routed (T2, 2026-08-30)

One deterministic ACTOR-domain eligibility authority beneath both automatic
targeting and player choices. `kernels/candidate.ts`
(`evaluateActorCandidates`/`validateActorCandidate`) owns the base
CandidateSet (relation p.92, defeated/on-battlefield filters, range from a
U7 `SpatialAnchor`); `kernels/evaluate-query.ts` (`evaluateActorQuery`)
adds the selector domain operators (adjacency, within-origin, condition,
mark, summon) and is the engine behind `selectActors` (`kernels/runtime.ts`),
now a thin adapter — one eligibility machinery, no second copy. Range
values are resolved scalars evaluated through U5 `evaluateNumber` at the
query point. The U7 anchor vocabulary lives in `primitives/anchor.ts`
(LIVE actor selector | CAPTURED position) and rejects malformed anchors
(`selector.origin-invalid` for query-shaped selectors, zero/multi actors,
position-less anchors); relation stays relative to the acting actor while
range moves to the anchor. Violations reuse the legacy codes
(`choice.actor-missing/-defeated/-relation/-range`); no source IDs. Tests:
`candidate.test.ts` (27 cases incl. QUERY⇄CHOOSE parity + anchor fixtures),
`evaluate-query.test.ts` (18 cases: 13 selector-migration + 5
area-inclusion); the legacy `input` selector's count/range enforcement
throws preserved verbatim.

The direct-target and area-inclusion routing landed 2026-08-30:
`assertDirectTarget` (`encounter.ts`) routes base eligibility through
`validateActorCandidate` (Blind/Stealth/True Strike/LoS stay specialist at
the gate, unchanged problem precedence), and area actor-inclusion reads
route through the `insideArea` query operator over the spatial gateway's
cells (the gateway keeps the geometry).

The position slice landed with the eligibility-duplicate routing
(2026-08-30) and was corrected by the corrective pass (same day):
`kernels/evaluate-query.ts` owns `evaluatePositions` (generic in-grid
query with an EXPLICIT space policy — `any` per p.92 "Space: Any space in
range, and any characters or objects occupying it", or `unoccupied` — and
an opt-in `distance-from-origin` ordering policy),
`validatePositionLegality` (teleport specialist: in-grid/range/unoccupied
— consumed by the teleport kernel's violation mapping), and
`nearestCandidates` (the full minimum-distance set over an evaluated
CandidateSet — NO invented tie-break; ordering/tie resolution happens only
where the source defines it). `primitives/job-kit.ts` dropped the
`freeCellsInRange`/`nearestFoe` sugar; every resolver call site routes
through the query operators; `rushTowardFoes` moved into
`evaluate-query.ts` and fails closed on equidistant ties.

Corrective underlay pass (2026-08-30): the nearest reads are retracted
where they resolved a player choice deterministically — `knave:dark-knight`
(p.143 "If multiple foes are equidistant, you may choose") and
`stormbender:eye-of-the-storm` (p.236 "they may fly 4" — a free
player-chosen flight; the old "away from the nearest foe" direction was
invented) are documented non-executable, their resolvers fail closed on
those clauses, and the `includeDefeated: true` flags those call sites
carried were dropped ("closest foe" cannot include defeated characters).
`primitives/job-kit.ts::occupied` is now an OBSTRUCTION test (characters +
OBJECT entities block, p.95; intangible summons do NOT obstruct — a bomb's
cannot-share-with-bombs rule is a specialist constraint in the bomb
placement resolver, never this predicate).

T2 (2026-08-30) completed the T2 U3 contract on top of the landed actor/
position slices: the query TYPES moved to `primitives/query.ts` (split-
plan home, barrel re-exported); the actor-domain operator list now
covers the full T2 contract (line of sight / line of effect composed
from the query's U7
anchor through the one LoS kernel, occupying-position, terrain predicate
`onTerrain`, owned-by via the `summon.owner` explicit-id filter, and set
composition `composeActorQueries` union/intersection/difference with
distinct-by-identity — no invented ordering); the ENTITY domain
(`evaluateEntityQuery`: owner/type/range-from-anchor/at-position) and
TERRAIN domain (`evaluateTerrainCells`) landed; and the p.108
placement-LoS boundary is resolved through the generic authority —
`validatePositionLegality`/`evaluatePositions` gained the `lineOfSightFrom`
policy and the teleport kernel's player-chosen destinations now enforce
it (`move.line-of-sight`, spellblade behind-the-wall + control
fixtures). The U5 `count-query` value and U6 predicates consume the new
domains through `evaluateValueQuery`.

NOT yet the full U3 QUERY underlay (see `docs/underlay-completion-plan.md`
§1 U3): the AREA, PERSISTENT-INSTANCE, and RULE-SOURCE query domains are
U10/U12-scoped (not part of the T2 contract); ordering policies remain
the min-distance set + the opt-in distance-from-origin cell order
(first/last/nth land only where a SOURCE defines them); and the
`rushTowardFoes` direction fallback remains a flagged player-choice
approximation (a movement-direction read, not an eligibility query). U3
and U7 remain honestly PARTIAL. The tracked completion task is TODO.md
§"Underlay-phase task ledger" (U3 audit correction + T2 expression
algebra). Sequencing owner:
[`generic-underlays.md`](generic-underlays.md).

### Reference / Binding (U1 underlay) — PARTIAL: typed vocabulary landed (T1, 2026-08-30)

`primitives/reference.ts` owns the typed `Reference<D>` vocabulary —
corrected (2026-08-30) for domain + collection type safety: LIVE refs
(named by legacy context slot, direct id, or bound name) re-resolve against
current state at use time; CAPTURED refs are SELF-DESCRIBING discriminated
kinds (`captured-actor` carries only an actorId; `captured-position` only
a Position), durable once captured and never re-read later state — so a
captured actor structurally cannot hold a position literal and vice versa;
`collection` refs preserve their element domain (`Reference<D>[]`). The
plural `trigger-targets` slot resolves as an ORDERED COLLECTION of every
recorded target (never the first element; an absent slot is a legitimate
empty collection, distinct from a missing singular slot). `Binder`
(`bind`/`lookupBound`/`EMPTY_BINDER`) maps earlier-operation names to
references (`CHOOSE a position AS landing`, `BIND slain actors AS slain`),
carried on `RuleExecutionContext.boundNames` (optional, behavior-neutral).
`resolveReference(ref, context)` is the deterministic resolution surface:
bound names resolve the bound reference but are DOMAIN-CHECKED
(`domainOf(boundRef) === declared domain` — a bound actor ref resolving to
a bound position is `domain-mismatch`, reject); missing actor/entity/
slot/position REJECT rather than defaulting; a captured defeated-actor
ref stays resolvable (identity captured). The legacy context slots (`actorId`,
`attackTargetId`, `triggerSourceId`, `triggerTargetIds`,
`damageRecipientId`) remain the LIVE refs' resolution sources — migrating
consumers onto typed refs is the T2+ de-dup work; the U12
`ArmedContinuation` carries its refs with explicit LIVE/CAPTURED semantics
(T5b) and the U13 windows carry the continuation as their held payload
(T5c). Tests:
`reference.test.ts` (positive captured-exactness + live re-resolution +
binder/collection + ordered plural targets, negative unbound/missing +
domain-mismatch, boundary empty-collection + defeated-actor-captured,
replay identical-literal + Binder purity).

### Role / Perspective (U2 underlay) — AUTHORITATIVE (T1 + T2 + T7; T8b repair+re-cert, 2026-08-31; T8c branded-seam + owner-contract re-cert, 2026-08-31)

> **T8b corrective note:** the prior T8 AUTHORITATIVE claim initially hid a
> false closure — `kernels/aura.ts` produced `perspectiveActorId` by locally
> mapping the spatial-origin case (actor→actor.id, entity→entity.ownerId).
> Repaired: `auraOriginRefs` now CALLS the U2 `auraRelationPerspectiveId(origin)`
> authority with the origin FACTS, and the same content seam
> (`chanter-programs.ts` Gentleness) routes through it; the `u2-perspective-
> authority` guard is upgraded to call-form routing so a symbol-presence bypass
> is CAUGHT. See `docs/t8b-audit-integrity-report.md`.
>
> **T8c re-cert (2026-08-31):** T8b's call-form proof was still insufficient on
> its own — *"called" is not *"result used"*. A contributor could keep the U2
> call alive and read the relation/member perspective from an incidental id
> (or an alias of one). This tranche lands a BRANDED typed seam
> (`RelationPerspective`, a `unique symbol` brand): `relationPerspectiveId` /
> `relationPerspectiveIdFromContext` / `auraRelationPerspectiveId` return the
> brand, and `AuraOriginRef.perspectiveActorId` is typed with it, so
> `perspectiveActorId: actor.id` (or any local alias) is a COMPILE ERROR, not
> merely a regex catch. The architecture audit's `u2-perspective-authority`
> guard is upgraded to alias-tolerant SEMANTIC OWNERSHIP (every producer of
> `perspectiveActorId`'s value must be the U2 call), a POSITIVE membership-
> consumption requirement (`state.actors[origin.perspectiveActorId]`), and a
> candidate result-consumption ban on reading the perspective from
> `context.actorId`. The entity creator/owner contract is stated truthfully:
> current engine scope has ONE canonical identity per entity (`ownerId`) and
> does NOT claim creator ≠ owner is representable (see the report). All eight
> adversarial mutations (U2-M1..M4, U16-M1..M4) are CAUGHT.

`primitives/roles.ts` owns the `Role` vocabulary: source/owner/controller/
chooser/payer/target/recipient/carrier/creator/trigger-source/
trigger-recipient/attacker/defender/original-user/current-origin.
`deriveRoles(frame)` produces a SUBJECT-RELATIVE `RoleMap`
(`{ roles, controllers }`) from a durable `RoleFrame` (deterministic,
replay-safe); `RoleSelector` (`role` | `controller-of`) +
`resolveRoleSelector` resolve who decides a choice, with `controller-of`
resolving the recorded controller OF THE SUBJECT role only —
`controller-of(source)` and `controller-of(target)` can differ in the same
resolution (corrected 2026-08-30); a missing controller for an otherwise
valid subject returns null (never falls back to the source); (null when
underivable — reject, never guess); `roleFrameFromContext` is the migration
seam over the legacy context slots (records no controllers, so
controller-of rejects there). `RuleChoice` gains typed optional
`chooser`/`controller` role carriage (behavior-neutral until U4 consumes
it). ROLE ≠ REFERENCE (U1 names things) ≠ ANCHOR (U7 measures spaces): the
original-user role survives a rebound where the spatial origin moved. The
DOWNSTREAM CONSUMERS route their perspective through this authority (T2 +
T7, 2026-08-31), so no independent role-derivation path remains:
`candidate.ts` derives the RELATION PERSPECTIVE through
`relationPerspectiveIdFromContext` (U2) and only then feeds U3
`matchesTargetRelation`, which stays a parameterized eligibility specialist.
The aura kernel separates the SEMANTIC perspective (`perspectiveActorId`,
U2) from the SPATIAL anchor (`actorId`/`entityId`, U7); an ownerless/neutral
origin has no derivable ally/foe — only `characters` relations apply. Choice
and decision-window responders resolve through `resolveRoleSelector` /
`choiceEntitledPlayer` over the durable frame (subject-relative, reject on
underivable); the save-rolled window responder is the U16 interrupt
entitlement (retained specialist, disjoint from U2).
`windowResponderId(selector, frame)` is the U2 responder projection (thin
facade over `resolveRoleSelector`).
Tests: `roles.test.ts` + `t7-u2-role-consumers.test.ts` (relation
perspective, aura entity-origin owner≠origin, ownerless-neutral reject,
ROLE≠ANCHOR geometry, source≠target controller, underivable responder
rejects, replay determinism).

### Scope / Clock (U8 underlay) — PARTIAL: vocabulary + boundary-read surface landed (T1, 2026-08-30)

`primitives/scope.ts` defines the ONE `Clock`/`Scope` vocabulary with FULL
temporal fidelity (corrected 2026-08-30): `BoundaryRef` carries an EDGE
(`start`/`end` — turn-start ≠ turn-end, round-/combat-start ≠ end, never
collapsed) and an optional U1 `subject` for actor-relative boundaries
(end-of-YOUR-turn ≠ end-of-TARGET's-turn; `slow-turn` start ≠ ordinary
turn start); counted (`n-boundary`/`for-n`) and `next`/`until-next` forms
are RELATIVE to a recorded epoch (`ClockObservation` + `boundaryKey`
occurrence counters) — an effect created on round 5 "for 3 rounds"
completes only after three matching round boundaries from its origin, never
because `round >= 3`; `boundaryReached`/`scopeSatisfied` require the
observed boundary record and REJECT relative reads with no recorded epoch
(never an invented absolute answer); `permanent` never satisfies (a scope
with no expiration, not an event that fired). The boundary-read surface is
`clockForTiming`/`scopeForDuration`/`currentClock`/`boundaryReached`/
`scopeSatisfied`. `clockForTiming` maps step timings ('use', attack-*) to
null (they name a moment inside a resolution, not a boundary);
`currentClock(context)` returns null for non-boundary timings (a command at
`use` is never "at the round boundary"); `scopeForDuration` maps the legacy
`RuleDuration` onto Scopes, preserving EDGE + ACTOR SUBJECT for turn-start/
end durations (behavior-neutral). The legacy surfaces remain the executing
authority — `RuleDuration`/`RuleTiming`/`use-ledger`/lifecycle readers
still re-key "round" separately; migrating them onto the Clock (the U8
completion, including the scheduler's turn record for turn-level
`boundaryReached`) is a later phase. Tests: `scope.test.ts` (the 11
required temporal-fidelity cases: turn-start≠end, round-start≠end,
source-turn≠target-turn, relative-3-rounds-from-round-5-origin, next-target-
turn not on source turn, slow-turn≠ordinary-turn, non-boundary-null,
permanent-never, named-event, replay; plus edge/subject preservation in
`scopeForDuration`) — 17 tests.

### Provenance / Delivery Dimensions (U9 underlay) — LANDED (T4, 2026-08-30)

`primitives/provenance.ts` owns the typed provenance vocabulary:
`DeliverySourceKind` (`actor`/`terrain`/`entity`/`environment`),
`RuleDelivery` (incl. `reflected`/`triggered`), `RuleMovementMode`, and
`Provenance` (sourceId / ownerId / sourceActorId / actionId / delivery /
deliverySource / movementMode / volition / role / recipientId / rebound /
redirect / derivedFromFact / parent). SOURCE identity is kept distinct from
DELIVERY kind; `sameCausalOrigin` preserves the TRUE initiating actor
through reflected/secondary delivery (a reflection can never white-out the
original owner/source — p.94 Pacified-break, p.103 Slay, p.151 Masquerade
all read the causal origin). `provenanceOfMutation` derives a provenance at
a resolve point from the mutation's own fields, always preserving the
causal `sourceActorId`. Domain-specific provenance (`attackDamageProvenance`,
`delivery` on damage mutations, `cause: TurnEndCause`, the movement-entry
`voluntary` flag) stays as documented retained specialists; U9 is the
shared vocabulary facts and U16 reads consume. Tests: `t4-facts-provenance.test.ts`.

### Fact / Outcome Record (U10 underlay) — PARTIAL (T4 LANDED; repair re-audit 2026-08-31 conservatively demoted: movement/shove-rush-fly vs remove/place and save outcome distinctions must be shown representable in the recorded Fact vocabulary before AUTHORITATIVE)

`primitives/facts.ts` owns the exactly-typed DISCRIMINATED `Fact` union
(ability-used / attack-resolved / damage-applied / actor-defeated /
collide / movement / effect / entity / terrain / save-resolved /
trigger-resolved) with the smallest common envelope (deterministic
`instanceId` scoped under a durable RESOLUTION identity, `sourceId`,
`ownerId`, U9 `provenance`). Facts are GENUINELY durable and
replay-stable: every ability/action resolution owns a deterministic,
replay-stable `resolutionId` (command/event boundary). The id serial comes
from a DURABLE UNBOUNDED `resolutionSerial` on `EncounterState` — advanced
by applyEvents per recorded RULE_MUTATIONS_APPLIED event, never the bounded
eventLog's array length, so ids stay unique past 500-event log truncation
and survive save/load (legacy checkpoints derive it deterministically from
their recorded history). Fact ids are scoped under the resolution id (two
uses of one ability differ; replay reproduces them), and the typed facts +
`resolutionId` RIDE the `RULE_MUTATIONS_APPLIED` event — replay consumes
the recorded outcomes, never re-derives them. Historical events without a
recoverable identity refuse fabricating (no invented de-dup identity).
`damage-applied` facts record the DETERMINED (post-mitigation) amount from
the shared damage authority, never a raw proposal; fully-prevented damage
emits no false fact, and a mutation that no-ops because an earlier mutation
defeated/immunized its target emits no false fact either (the boundary
runs a reducer-faithful sequential dry run and stamps the recorded amount
on the mutation; the reducer consumes the stamp instead of re-deciding).
The U16 `trigger-resolved` markers (one per resolution + triggered step)
ride the same durable fact list. Effect facts carry the canonical LIVE
instance id the reducer creates/removes (`effectInstanceId`, stamped once
at the command/event boundary and consumed by the reducer — never invented
after the fact), so a later remove/refresh references the ORIGINAL
instance and removing instance A leaves coexisting instance B intact.
`kernels/resolution-triggers.ts` records facts via `recordFacts`, merges
the domain collide/slay facts, and projects the byte-compatible
`ResolutionTriggerFacts` encounter.ts consumes (behavior-preserving
migration; the `slay` trigger resolves only on a true Slay, p.95 glossary —
`viaSlay` — never an explicit instant-defeat mutation). The LIVE
`effectExistsLive` read answers EXACT specific-instance reads by the
durable id carried on the live `RuleActorView` (marks/stance/active-effects
now project their durable instance id + ownership); a genuinely ambiguous
coexisting read without an exact id refuses to guess. The damage/held/window +
save ledgers remain domain-specific authorities whose fuller fact
composition is U12-scoped. Tests: `t4-facts-provenance.test.ts` +
`t4-effect-exists.test.ts` + `t4-dedup.test.ts` + `t4-corrective.test.ts`.

### Modifier / Policy (U14 underlay) — LANDED (T3, 2026-08-30)

One recipe shape for "how an attached rule alters a typed query point":
`primitives/modifiers.ts` (barrel re-exported) owns `ModifierRule`
(`{ sourceId, ownerId, queryPoint, scope, operation, value, gates,
talent, actionId, from, ordering }`), `registerModifierRule` (unknown
query points reject at registration), `applicableModifierRules` /
`foldNumberModifiers` / `foldEnumeratedModifiers` (registration order,
`add` accumulates, last `set`/`override` wins, `from`-guarded chained
conversions), ONE shared gate evaluator (`modifierGateHolds` over the
shared `ModifierGate` union: always/stealth/comeback/round-at-least/
mastery/choice/self-bloodied/target-bloodied/target-has-condition), and
typed `PermissionQueryPoint` kinds (`cannot`/`ignore`/`immune`) with the
enumerated negative registry `PERMISSION_NEGATIVES` (an unlisted pair
rejects at registration — a wildcard bypass is unrepresentable). The range
(`listed-range` per declared scope), area (`area-size` + `area-shape`),
mastery (`interrupt-rank`/`damage-type` + the `range-bound` permission,
with equipped+mastered baked into every row), and bonus-damage
(`bonus-damage-dice`) fold registries convert their content rows to shared
rows and fold through the shared discipline; the kernels keep their public
surfaces as thin adapters. Numeric modifier VALUES are U5 `RuleNumber`
expressions (`ModifierValue = { kind: 'number', value: RuleNumber } |
{ kind: 'enumerated', value: string }`) — the primitive owns NO special
dynamic literals (the old `'round'` special case is the U5 `{ kind: 'round'
}` expression; the range adapter's `'round'` shorthand translates to it at
the kernel boundary). Resolution is injected: the primitive folds take a
`ModifierNumberResolver`, and `kernels/evaluate-modifiers.ts`
(`resolveModifierNumber`) is the thin kernel-layer evaluator projecting the
fold view onto the representable U5 subset (constant, round, pure scalar
compositions) — a context-dependent expression REJECTS at resolution
(unrepresentable, never a guessed value); enumerated replacements stay
typed separately.
Retained specialists with written boundaries:
cost-modifier function rows (cost-list rewriting), the attack-modifiers
armed one-shot fold, scaled/recipient bonus-damage function rows, aura /
save-window boon-curse consumption sites, and the damage-exception
mutation fields (`bypassVigor`/`ignoreArmor`/`ignoreDefiance`/
`ignoreAetherwall`/`ignoreCover`/`ignoreDodge` stay distinct
program-emitted fields; the permission registry is where content-registered
permission rows fold). Tests: `t3-modifiers.test.ts`. Sequencing owner:
[`generic-underlays.md`](generic-underlays.md).

### Transaction / Atomic Commit (U15 underlay) — PARTIAL (T3 landed `transaction.ts`; repair re-audit 2026-08-31 conservatively demoted: every flow deciding "which proposed state changes validate together before commit" — cost/payment, spatial batches/swaps, exact-count creation, grouped movement/flow — must be proven to route through the single grouping/snapshot/atomicity authority before AUTHORITATIVE)

One atomic-grouping authority: `primitives/transaction.ts` owns
`TransactionLeg` (intent + per-leg validate), `TransactionSpec` (legs +
declared validation mode + deterministic provisional-state projection),
`validateTransaction` (all-or-nothing verdict naming the first failing
leg), `proposeAtomicGroup`, and `legWithCheck`. COLLECTIVE DEPENDENCE
(corrected contract): `mode: 'simultaneous'` (default) validates every leg
against the ORIGINAL common pre-state — the source-defined swap family;
`mode: 'sequential'` validates leg i against the state projected by the
EARLIER proposed legs (`project(snapshot, applied)`), the cumulative
family (multiple spends, split pools, creation conflicts, sacrifice +
payoff). The projection is the caller's domain projection; a sequential
transaction WITHOUT a projection fails (never a silent fallback to
simultaneous semantics). The command boundary's Masquerade gate
(`assertLegalSpatialBatch`, ICON p.151) composes the source-declared
atomic spatial group through `validateTransaction` in simultaneous mode —
every move leg validated against the same pre-swap snapshot via the
spatial gateway, a single denied leg rejects the whole action before any
event is emitted. U15 owns the grouping; per-domain legality stays in the
domain authorities (spatial, payment, creation). Tests:
`t3-transaction.test.ts`.

### Usage / Entitlement Ledger (U16 underlay, CORE) — PARTIAL (T3 core + T4 de-dup + T6.4 raw-field consolidation + T6.4a + T6.4b closure, 2026-08-31; T-turn corrective repair re-audited to PARTIAL)

"How many times has/may this rule be used within scope X?" — distinct from
spendable resources. `primitives/usage.ts` owns the core ledger:
`usageKey` (byte-identical `ledger:<scope>:<sourceId>` format, shared with
the F9 reactive fold — the STORAGE key, actor-local by design), and
`usageIdentity`/`usageIdentityKey`/`usageIdentitiesEqual` (the typed
DE-DUP IDENTITY, corrected contract: DISTINCT from the storage key and
ALWAYS carrying the owner — two different owners of the same
source/scope/target have different identities, proven by negative test, so
the T4 U10 fact-backed de-duplication cannot inherit the storage key's
owner collision; the U10 fact read completes the full trigger-family
identity in T4), `usageCount`/`ledgerAvailable`,
`consumeUsageMutation` (one-shot boolean mark or N-per-scope count
increment — decided once at the command boundary, riding the recorded
event), `refreshUsageMutation`, `usageRead` (per-use magnitude ordinal),
`holdsUsageKey`, `resetBoundaryFor` (turn/round/combat onto U8
boundaries), and `usageCap` (folds the U14 `use-cap` query point for
count-override caps). `kernels/use-ledger.ts` is a thin adapter; the U6
`used-scope` predicate reads the durable ledger (entitlement COUNTS). U16
was COMPLETED in T4 with the U10 fact-backed DE-DUP identity
(`primitives/facts.ts`), then corrected to RESOLUTION-SCOPED
once-per-ability semantics (p.107): the resolve identity (`resolveIdentityKey`)
is `{ sourceId, ownerId, scope, resolutionId, trigger }` — NOT per-fact — so
one ability's multiple routing facts open ONE triggered step while a second
ability use (different `resolutionId`) may trigger again. Per-target is
keyed only where a source declares once-per-target. `triggerResolvedFact`
records the marker and `hasResolvedAsFact` answers "has this logical trigger
step already resolved within this resolution?" over the recorded fact
history — never current state, never a broad once-per-scope mark — and is
WIRED into the real reactive continuation
(`executeRuleProgramWithReactiveTriggers`). Event de-duplicationis semantically DISTINCT from the `used-scope` entitlement counts. **T6.4
(2026-08-31) completed the raw-field consolidation**: the interrupt-use counter,
interrupt-uses-per-turn, slashed/dangerous-terrain once-per-turn flags, and
the one-attack-per-turn gate live ONLY on typed `ledger:*` entries (`turn`
owner-relative pools + the per-actor `any-turn` period for the ACTOR-LOCAL
one-interrupt-during-any-turn window, No Repeats, Slashed, and dangerous
terrain — storage is actor-local, never a battlefield scan), and the raw
`EncounterActor` fields were REMOVED (schema 11 folds the four T6.4
fields; schema 12 folds the No Repeats `usedAbilityIds` array onto
per-source any-turn marks and the `standardMoveUsed` boolean onto an
owner-relative `turn` gate, then drops them). The one-interrupt-per-turn
entitlement is ACTOR-LOCAL by design (p.91 subject is the character; Black
Rock Vanguard is an actor-scoped override; Alice and Carol each interrupt
during Bob's turn independently). The `attackedThisTurn` resolution FACT is
a documented retained U10 specialist (read by Soul Blade / Carnevale /
Hissatsu / Monogatari / VM); the `end-turn`/scheduler flags stay scheduler
state. The dangerous-terrain damage-cadence contradiction (p.89 once-per-turn
vs the p.183 Harvester reprint once-per-round) is recorded as adopted
adjudication `icon-1.5:dangerous-terrain:damage-cadence`. Lifecycle reset
recipes are ownerless maintenance noops so they never fabricate a U17
same-owner tie. **T6.4b** resolved the remaining command/window-authority
seams: generic `EXECUTE_RULE` interrupts authorize through the ONE
`interruptLegality` gate (window + pool + No Repeats) BEFORE effects/RNG;
p.290 Repeatable is an ACTION-TAG decision (`noRepeatsApplies` — foe
Bull Rush/Bash/Hurl plus a new generic `repeatable` mastery-modifier
family, so mastered Phantom Bolts' same-turn retrigger is legal and the
reducer records no fabricated usage mark); reactive window discovery keys
No Repeats by the interrupt's own sub-action id (a used stance never
blocks its distinct interrupt); Black Rock Vanguard provably lifts only
its actor's per-turn cap. No durable shape changed (schema stays 12).
Tests: `t3-usage.test.ts` + `t4-dedup.test.ts` +
`t4-corrective.test.ts` + `use-ledger.test.ts` +
`t6-4-usage-global-ledger.test.ts`.

**Corrective re-audit (this tranche, 2026-08-31) — U16 demoted from
AUTHORITATIVE to PARTIAL, then the concrete duplicate repaired.** The
underlay-repair audit found a REAL executing duplicate that the prior
T6.4a/b "zero competing authority" claim over-looked: `kernels/trait-reactions.ts`
(the F9 once-per-round reactive job-trait fold) independently implemented
its own round ledger — it reconstructed the canonical `ledger:round:<id>`
key, read availability straight off `ruleState`, and wrote its own one-shot
`set true` mark (its own key/availability/consume), instead of routing the
"has this reaction already fired this round?" entitlement through the U16
core. That violates the authoritative invariant (a competing executing
implementation, even with identical results). The fold now derives its key
from U16 `usageKey` (round), reads availability through U16
`ledgerAvailable`, and persists its mark through U16 `consumeUsageMutation`
(byte-identical durable output; behavior-preserving — 8 trait-reaction
tests incl. once-per-round exact-once, round-boundary reset, replay, and a
new two-owner isolation adversarial case stay green). The
`u16-usage-ledger-routing` architecture guard now flags any non-U16
primitives/kernels file that reconstructs a `ledger:<scope>:…` key, and
pins the F9 fold to the U16 core symbols. **T8b corrected the fabricated
typed-owner seam**: `roundLedgerKey` originated with `ownerId: ''` in the
typed U16 call; it now passes the REAL owning actor (`actor.id`) while
`usageKey` keeps the actor-local storage format byte-identical
(`ledger:round:<sourceId>`). The typed semantic identity carries the owner;
the storage address omits it by design — the two are never conflated. See
`docs/t8b-audit-integrity-report.md`. U16 is therefore PARTIAL: the
generic canonical-ledger authority is single again, but a census of the
remaining actor-level once-per-round/turn trigger marks
(`chain-reaction-used`, `incubus:triggered`, `stampede:triggered`,
`gates-of-hell:vigilance-rushed`, `damage-immune`, and per-source `:used`
flags) must prove each is a U10/mark de-dup or content-owned state rather
than a second usage ledger before AUTHORITATIVE can be re-certified. See
`docs/t6-gate-report.md` and the tranche report.

### Ordering / Arbitration (U17 underlay) — LANDED/COMPLETE (T3 + T6.2 + T6.3, 2026-08-31)

Typed ordering policies, NOT one numeric priority: `primitives/ordering.ts`
owns `OrderingPolicy` (source-order | stack | turn-order |
hostile-before-beneficial | non-active-owner-first | controller-choice |
explicit-list), `applyOrdering` (pure — a function of the recorded policy
+ durable context, returning `OrderingResult`), `policyYieldsChoice`
(controller-choice yields a typed U4 choice spec; the engine never
invents an order), and `orderingKey` (durable identity).
Unresolved-rejection contract (corrected): `applyOrdering` returns
`{ ok: true, ordered }` or `{ ok: false, problem }` with typed problems
(`missing-source-order`, `missing-turn-order`, `missing-perspective`,
`missing-active-owner`, `yields-choice`, `unknown-candidate`) — a policy
whose required context is absent, or whose candidates are not fully
covered by its declared authority, is UNRESOLVED and the command/window
boundary rejects; an unresolved ordering is a rejection, never the
caller's supplied array order.
`controller-choice` is never resolved by `applyOrdering` (it returns
`yields-choice` carrying the typed choice for U4 routing). **T6.2 (2026-08-31)
landed the recorded same-owner ordering decision** (p.107 "If a character
owns multiple effects, and there's ambiguity in the order in which they
trigger, they can determine the order"): `sameOwnerOrderingDecision`
classifies a same-instant tie and builds the typed U4 `ordering` choice
over the EXACT candidate set; `resolveChoice` validates the answer as a
full permutation; U13 opens the ONE ordering decision window
(`openOrderingDecisionWindow` — chooser derived through U2, underivable
choosers fail closed, cross-owner groups never open a same-owner window);
the recorded order rides the `DECISION_ANSWERED` event, stamps durable
`resolvedOrder` ranks, and the LIFO pop / boundary projection consume
exactly that order on replay — never an invented tie-break and never the
incidental registration `order`. Wired consumers: `orderedSelectedSteps` (the engine's
ability-step order, p.85/p.107 §4) applies the `source-order` policy;
`decideDamageWindow` applies it to `DAMAGE_WINDOW_RECIPES`
(`kernels/decision-window.ts`, U13); the decision-window LIFO pop
(`popDecisionWindowStack`) applies the `stack` policy (p.107 most-recent-
trigger-first) and `orderDecisionWindows` applies the same-trigger
turn-order rule. **T6.3 (2026-08-31) landed the remaining turn-boundary
consumers**: `turnBoundaryOrdering` composes the p.108 rules
(non-active-owner-first → hostile-before-beneficial within each ownership
group → the first same-owner tie becomes a recorded U4/U13 ordering
decision → a remaining cross-owner/missing-owner tie fails closed). The
lifecycle phases and boundary expiries route a durable per-phase candidate
plan (source id + mechanical owner + owner side) through it; `runLifecyclePhase`
defers a same-owner tie onto ONE U13 ordering window (`heldBoundary`) and
the DECISION_ANSWERED reducer resolves the deferred effects in the recorded
order (each exactly once, never registry-ordered). The lifecycle registry
insertion order is demoted to discovery/enumeration + the legacy pre-T6.3
replay fallback — the registration-order-as-boundary-order authority and
the expiry listing-order tie-break are REMOVED. The scheduler's turn
election stays the scheduler authority (documented U17 consumer); no other
genuine U17 consumer remains. U17 is COMPLETE. The blocking families it
enables (simultaneous-owner ordering, turn-boundary effect ordering,
player ordering choices, interrupt-timing ordering) are now unblocked. Tests:
`t3-ordering.test.ts`, `t5c-u13-decision-window.test.ts`,
`t6-2-u17-recorded-ordering.test.ts` (30), `t6-3-turn-boundary-ordering.test.ts`
(27), `rooms.test.ts` (responder authorization + heldBoundary seed), plus
pinned `aura`/`turn-transition`/`conditions` cases.

### Command/event purity — AUTHORITATIVE + REPLAY-TESTED

`executeCommand(input, command, dice)` never mutates input; it plans ordered
durable events from the pre-command snapshot; `applyEvents(input, events)`
reproduces `result.state` exactly. Enforced per-command by
`expectCommandPurity` / `expectRejectedCommandPurity`
(`__tests__/fixtures.ts`, used broadly incl. `command-purity.test.ts`).
Multi-stage commands (forced turn ends, stunned actors, end-turn requests)
plan against an intermediate applied state and append follow-up events — all
durable. Randomness is injected (`DiceSource`); gamble results are rolled once
at the command boundary and ride their events.

Known holes: none open. This contract is the project's strongest asset;
every new mechanic must preserve it (see AGENTS §6).

### Dice & randomness — AUTHORITATIVE + REPLAY-TESTED

Injected deterministic dice; scripted fixtures; boon/curse rolls; bonus-damage
"roll extra keep highest" in attack modifiers; Carnevale/Monogatari gambles
pre-recorded on events.

### Damage — AUTHORITATIVE + REPLAY-TESTED

Determine→apply split (`determineEncounterDamage` /
`applyDeterminedEncounterDamage` in `automation/kernels/encounter-adapter.ts`
+ `damage-resolution.ts` + `damage-ledger.ts`). Order per p.107
(attacker → defender flat reduction → defender multiplication). Armor
(highest wins), resistance (halve round up), weakened/vulnerable per
instance, pierce (`ignoreArmor`), divine (`ignoreDefiance` + `bypassVigor`),
vigor sinks, Defiance floor-once + turn damage-immunity (consumed durably,
p.104), Defy Death via Boiling Blood's armed effect, wounds on PC defeat,
bonus-damage instances, dangerous terrain delivery, damage provenance ledgers.
Held damage rides interrupt windows and re-applies through the same pipeline.
Fixtures: `damage-resolution.test.ts`, `conditions.test.ts`,
`hp-threshold.test.ts`, `interrupts.test.ts`.

Holes: none known at scope; new exceptions must be distinct typed flags
(never overload `divine`).

### Attacks — AUTHORITATIVE + REPLAY-TESTED

Roll + boons/curses, defense comparison, critical ≥20 (+[D], still a hit),
Exceed ≥15 triggers, auto-hit, True Strike (ignores dodge/blind/evasion/
stealth), Unerring (ignores cover/aetherwall), Evasion pre-roll d6, Dodge
delivery filtering, cover & elevation modifiers, Blind/Dazed restrictions,
shared attack-modifier kernel (talent/trait/power-die rows plug in here).
Consumed by basic attacks, VM attacks, and direct resolvers.

### Saves — PARTIAL

Normal saves with modifiers; status-save ledger recorded as mutations on
TURN_ENDED (replay needs no fresh dice); Cure paths; save-reroll windows
(`save-rolled`: Sucker Punch re-roll regenerates branch effects from AST with
the second result). Holes: save-denial breadth, save-trigger riders beyond the
wired set; DAWN-style "+1 boon on saves" remains documented.

### Targeting & target sets — AUTHORITATIVE + SOURCE-TESTED

Self/ally/foe/character/space/entity selectors; Stealth adjacency gate;
summon/object entities as targets; area targeting through shared geometry.
Tests: `targeting.test.ts`.

### Spatial geometry — AUTHORITATIVE (core)

Footprints (size-1), range bands, adjacency, LoS/LoE, burst/blast/line/cone
areas (`area.ts`, `range.ts`, shared `area-geometry.ts`). Hole: p.92 Size
footprints >1 space pending (trait rows project the stat, not the footprint).

**Scoped range authority (2026-08-28):** `kernels/range.ts` is the single
reusable listed-range authority, queryable by NAMED SCOPE — the default
`attack` scope (the ability's top-level target range, read by both command
gates through `effectiveAbilityRange`) plus source-declared INTERNAL range
scopes (placement selectors such as Dark Sliver's terrain-effect soul-space
and Slay plant placement). A reviewed rule may declare `scopes` so a
modifier like Dark Sliver talent 1's Comeback "increase all ranges by +1"
(p.185) widens the attack AND every internal placement range from one row;
the resolver queries `effectiveScopedRange` by scope key instead of
re-implementing the gate. `rangeModifierRuleScopes(sourceId)` exposes the
covered scope set for the compound-talent completeness manifest.

**Compound-talent completeness manifest (2026-08-28):** a range recipe may
mark a source unit complete by itself ONLY when the unit's complete
semantics are exclusively that range change. Compound talents (Dark Sliver
talent 1's "bonus damage + all ranges", talent 2's "Sacrifice 2 + range 6")
register an explicit composite manifest (`registerCompoundTalentCompleteness`,
`kernels/talent-recipes.ts`) naming EVERY required semantic component — the
range rule (with each required scope), the bonus-damage rule, the pre-use
augmentation — checked against the real registries. The compiler audits such
a unit complete only when every component is wired; removing any one
component (or dropping a declared range scope) fails the audit, so a loose
range-registry membership check can never overclaim a compound talent.

### Movement — PARTIAL

Standard move/dash planner with difficult/dangerous/impassable/pit/slope
terrain, elevation, engagement; Flying/Phasing/Skirmisher/Intangible/Rampart
through the folded condition set; Rush; Shove with collide detection; Slashed
once-per-turn after ability moves. Holes: Teleport/Place/Swap/Remove exist
only inside individual job resolvers (see missing primitives F-P1);
movement-entry triggers fire on voluntary MOVE/DASH entry only — source text
with unqualified "enters" (Party Favor p.151, Symphony p.178) awaits the
generic forced-movement fold (AGENTS §8 boundary; do not describe as
source-complete).

### Statuses / conditions / marks / stances / auras — PARTIAL

Condition-set fold (`encounterConditionSet`) merges durable conditions with
passive projections so every kernel sees one set. Wired statuses: dazed,
stunned (stun forces turn end), weakened, vulnerable, slashed, hatred-of-X,
stealth, counter (non-recursive retaliation), defiance, dodge, sturdy,
unstoppable, slip, rampart, regeneration, bloodied derivation, sealed,
pacified, aetherwall, evasion, immobilized. Marks are durable with owners;
stances carry power dice via the power-die kernel. Auras exist for wired rows
(Rook/Dervish/Gentleness/Battlement/Shieldmaster). Holes: aura membership is
row-wired, not a general query API; several delivery matrices remain row-local.

### Resources — COMPLETE

Typed registry (`core.ts` RESOURCE_RULES / SHARED_RESOURCE_RULES): resolve,
personal-resolve, blessing, combo (cap 1), vigilance, aether, bonus-damage,
effort, strain — each with source page, cap, reset scope; reducer-enforced
clamping and encounter resets; spend validation. Tests:
`resources.test.ts`.

### Lifecycle (turn/round boundaries) — AUTHORITATIVE + REPLAY-TESTED

F3 planned-participant lifecycle: turn-start, turn-end, round-start, round-end
phases run exactly the recorded participants (no live re-inference);
boundary-duration expiry; cross-character ordering (non-turn-character first,
hostile before beneficial); party Resolve +1 exactly once per round boundary;
legend Juggernaut clear; per-round flag resets. Voluntary Slow clears at the
round reset; pending Delay survives until consumed (see scheduler below).

### Interrupt / window engine — AUTHORITATIVE for wired triggers (U13)

ONE typed window record (`DecisionWindowRecord`, `kernels/decision-window.ts`,
U13, T5c 2026-08-30; the deliverables claim registers the authority status)
for all windows: when-damaged, defeated,
uses-ability, area-inclusion, targeted-by-ability, save-rolled, and `choice`
(player/GM decision answered through the recorded `ANSWER_DECISION_WINDOW`
command — the engine never invents a default). Every interrupt window
carries its already-determined outcome as a U12 held-result `heldPayload`
(determined damage / held save — never recomputed); the
`DAMAGE_WINDOW_RECIPES` registry decides when-damaged/defeated eligibility
from durable provenance (p.107/p.128 Righteous Disdain, p.138 Boiling
Blood). LIFO pop (most recent first, p.107), stable total order for
simultaneous (turn-order alternation), retargeting (Masquerade), held
effects cloned + checkpoint-validated + redacted, drain-at-boundary
(choice windows persist until answered or a later boundary drain closes
them as the recorded decline). The Great Giorgios "may rush" (p.124) is a
recorded decision through a `choice` window (decline legal; accept resolves
against THEN-CURRENT positions). Deferral priority mirrors the damage
pipeline (mitigated blows don't open phantom windows). Tests:
`interrupts.test.ts`, `bastion.test.ts`, `colossus.test.ts`, `fool.test.ts`,
`knave.test.ts`, `t5c-u13-decision-window.test.ts`. Hole: Vigilance
guard/punish are commands/triggered effects, not windows (B4) — and they
must stay that way (p.104-105).

### Turn scheduler — AUTHORITATIVE + REPLAY-TESTED

(`turn-scheduler.ts`; stabilized 2026-08.) Pure side/phase decisions recorded
on events; controllers choose actors via TAKE_TURN/GO_SLOW; combat start is
PC-only; alternation with exhausted-side concession; Slow election belongs to
the current round (cleared at reset) while pending Delay (`mustNextTurnBeSlow`)
persists across the boundary and converts to the Charge-visible flag at the
forced turn's start; multi-turn entitlements via registered sources; next-round
planning reads next-round semantics only. Charge recognizes actual Slow turns.
Slow turns have normal action economy.

Production entitlement rows are registered by content
(`automation/content/foes/turn-entitlement-recipes.ts`): an Elite
(`foeKind === 'elite'`, projected durably at construction like `roleId`) owes
2 turns per round (p.299); a Legend (`roleId === 'legend'`) owes one turn per
player character re-read from live encounter state each round
(p.298) re-read from live encounter state each round, defeated PCs included —
a pinned reading of source silence (no
second passage contradicts it), deliberately not a source-adjudication
record. The Slow-phase transition continues the SAME round when the actor
whose forced Delay turn was just consumed still owes leftover normal
entitlement (multi-turn elites/legends); single-entitlement schedules never
reach that branch, so recorded legacy transitions are unaffected.

### Passive projection — AUTHORITATIVE + SOURCE-TESTED

Closed source-ID manifests, never runtime prose parsing: foe-trait keyword
rows (115 reviewed; 79 fully executable, 36 partial), foe role baselines
(Skirmisher/Artillery/Heavy + Guard armor + Legend Juggernaut), mark
projection (Rot → Regeneration / defiance suppression). Closed-negative tests
pin that unregistered rows stay inert (`foe-traits.test.ts`,
`role-baseline.test.ts`, `harvester.test.ts`, `passive-projection.test.ts`).
F5 (2026-08-27): mark-condition projections are now carrier-aware — `matches`
receives the mark's carrier and the encounter state, so a row reads live
carrier state (bloodied, defeated) and the owner's durable record (e.g. the
equipped talent choice), and status grants carry a declared potency
(`grantPotencies`, e.g. Grand Seal t2's pacified+), folded into the projected
status surface.

### Summons / entities / terrain objects — PARTIAL

Entity store with owner caps (six per type), companion exemption from owner
cleanup, bomb/beast/shadow/underway/portal/mist consumers, thrown weapons.
**Entity-creation authority** (`kernels/entity-creation.ts`): the generic
`validateEntityCreation` enforces bounds, size-aware occupancy (no owner
exemption — summoner occupies space like any character per the p.92 general
rule), impassable terrain, and optionally line-of-sight and range from a
declared origin (shared primitives LoS kernel). Origin and range are a
SOURCE-DECLARED PAIRED creation-spatial contract — one optional
`spatial: { origin, originSize, maxRange }` object on the VM `RuleEffect`
entity type and the replay-safe `creationSpatial` on the `RuleMutation`
entity kind — so "range without origin" is unrepresentable by construction.
Fail-closed at both layers regardless of typing: the runtime rejects an
origin selector that resolves to zero actors, more than one actor, or an
actor without a valid on-board position, and rejects a range-without-origin
contract; the reducer (and the kernel) reject a carried origin outside the
battlefield grid or a malformed maxRange-only contract — a malformed input
can never become unlimited creation. Range validation uses the canonical
p.92 footprint distance (L\u221e between occupied footprints), not raw
anchor-cell Chebyshev, and carries the origin actor's Size through the
contract. Mandatory vs optional creation remains a content-layer concern.

**Remaining source-fidelity limitation (Size>1 LoS):** creation LoS is
evaluated through the shared primitives LoS kernel (`line-of-sight.ts`),
which samples a straight segment from a single source space center. ICON
p.92 defines LoS from "any edge of your character's space", so a Size>1
origin's full footprint is not yet represented in LoS sampling; a generic
footprint-aware LoS query through the shared authority is future work.
Entity creation is therefore NOT described as fully Size>1 LoS-correct —
only the range half is footprint-correct today.

**Companion placement is single-authority (2026-08-28):** combat-start
companion summons (`applyCombatStartTraitEffects`, `kernels/lifecycle.ts`)
no longer pick a cell with their own legality checks (`freeCellNear`). The
lifecycle layer deterministically enumerates the ordered candidate cells
within the summon range and carries the FULL candidate list on the entity
mutation (`count: 1`); `validateEntityCreation` picks the first legal
candidate through the central bounds/footprint-occupancy/terrain/LoS/range
authority — so a Size>1 actor can never hide behind a non-anchor footprint
cell, and a LoS-blocked first candidate falls through to the next legal
cell instead of rejecting the whole summon.

**Legacy entity-event compatibility (schema 7, 2026-08-28):** the durable
entity RuleMutation previously carried `creationOrigin` /
`creationOriginSize` / `creationMaxRange`; aa736a6 collapsed them into the
paired `creationSpatial`. `migrateEncounter` is the normalization boundary:
it rewrites legacy spatial fields on entity mutations inside the migrated
event history and held interrupt windows to `creationSpatial`, so an old
event with spatial restrictions can never replay as unrestricted creation
because the reducer reads only the new shape. New command construction never
emits the legacy fields (the type has no such members), and the reducer
fail-closed: an un-migrated legacy-shaped mutation is declined, not
silently executed. The schema version stays 7 — the durable current-state
shape is unchanged; only the audit/display event history is upgraded at the
migration boundary.
Holes: entity actions (a summon taking its own turn) are not modeled; Mob
members absent.

### Mob model — ABSENT
`createFoeFromProfile` rejects mob role. Requires member-level representation.

### Foe phase engine — SKELETON
Profiles parse phases/chapter rules; `ruleState.phaseId` seeds phase 0; no
transition logic executes.

### Combat settlement — AUTHORITATIVE + REPLAY-TESTED
`ENCOUNTER_ENDED` clears per-encounter state (vigor, statuses, marks, stances,
shared resources; objects persist) and grants every player-character actor
exactly +1 personal resolve (p.99, defeated included — the source names no
exception). The durable handoff is `characterFromActor`
(`src/rules/encounter.ts`): projects HP attrition (`hpLost`, measured against
the wounds-adjusted maximum after the projected wound), wounds, and personal
resolve back onto the persistent sheet; `actorFromCharacter` re-enters combat
from that record. Camp/interlude sheet transitions: `campCharacter` heals all
strain, unticks all effort (Bond maximum), heals all HP, and resets personal
resolve (p.253/p.99; wounds persist) / `beginInterlude` additionally restores
wounds (p.56). Tests: `settlement.test.ts` (round-trip combat 1 → settlement →
combat 2, purity, replay, character migration v1→v5).

### Cost/payment — AUTHORITATIVE + SOURCE-TESTED
Action costs, resource spends, resolve pools (party + personal), sacrifice,
expenditure validation (`cost-payment.ts`). Limit Break payment works; effect
bodies do not exist.

---

## Missing kernels & primitives (consolidated ledger)

Ordered by fan-out (see `blocker-census.json` `blockerFrequencies`). Each item
states responsibility, layer, likely consumers, and acceptance bar. **No
per-content resolvers**: if a content slice needs bespoke code, the missing
item is here, not in content.

| ID | Kernel/primitive | Responsibility | Layer | Consumers / examples | Acceptance |
| --- | --- | --- | --- | --- | --- |
| K-P1 | Forced-movement primitives (teleport, place, remove, swap). **DONE (2026-08-27).** Shared spatial gateway `primitives/spatial-intent.ts` (`validateSpatialIntent`/`applySpatialIntent`: bounds, size-aware occupancy, impassable terrain, Rampart p.104 with slip/unstoppable bypass) plus mutation builders `removeMutation`/`placeMutation`/`teleportMutation` and the Swap primitive `swapMutations` in `primitives/job-kit.ts`, whose explicit `SwapMovement` mode carries the source-defined distinction: a **teleporting swap** (Masquerade p.151 "teleporting both" — legs are `movement: 'teleport'`, Rampart-checked) vs a **remove/place swap** (Shadow Play p.163, Redondo p.300, Purgatorio rotation — legs are `movement: 'place'`, not teleports). All four emitters migrated; forced moves never fire movement-entry triggers and never touch turn entitlement. **Swap atomicity is SOURCE-DECLARED** — `swapMutations` tags every leg with a `spatialBatchId`, and the reducer (`kernels/encounter-adapter.ts` `deniedAtomicSpatialLegIndices`) prevalidates only declared groups: the full destination permutation against the same pre-swap state (simulated on a clone so interleaved damage/condition mutations shape the decision), applied every-leg-or-none; the permutation must be injective (no two legs on overlapping footprints). **Occupancy exemption is group-scoped (2026-08-27):** a leg may ignore the footprints of actors in its OWN declared spatial group only — ungrouped legs resolve independently against current occupancy and actors in a different batch are never co-moved with a group, in the live fold, the group prevalidation (a denial fixpoint over declared groups), and every dry run (`collidingShoveTargets`/`reactiveSlayTargets`). Masquerade's action declares `requiresLegalSpatialBatch`, so p.151's "If you or your ally can't make a valid teleport, this interrupt can't be made" rejects the command when any leg is invalid — nothing consumed, redirected, or half-applied | primitives + spatial-intent | Shade Umbra/Penumbra, Fool Masquerade, Redondo, and the promoted census rows: knave Strongarm t1 (program-level remove/place-into-adjacency + range-kernel comeback range), spellblade Nothung t2 (program-level comeback teleport width) | Landed tranche covered by fool/shade/foe suites (rampart-denied teleporting swap vs rampart-crossing remove/place swap), the spatial gateway's all-or-nothing swap matrix (out-of-bounds/occupied/duplicate-destination/rampart denials, three-party rotation, replay), and the occupancy regressions (ungrouped A-into-B's-cell while B's leg fails: denied with no overlap and replay equality; separate `spatialBatchId` groups do not exempt one another; ungrouped pairs no longer swap without a declared batch). Census: the `{teleport}` blocker family is gone — 2 units promoted, 13 reclassified to their true residual blocker sets (the teleport capability itself no longer blocks anything) |
| K-P2 | Interrupt-modifier family | Change rank/add uses/retime an interrupt from content rows | modifier kernel | census `{interrupt-modifier}`×13 | One promoted trait/talent per modifier kind with source fixture |
| K-P3 | Terrain-create / entity-create recipe primitives | **entity-create reconciled (2026-08-29, F3 + corrective pass):** the entity-creation authority exists (`kernels/entity-creation.ts` `validateEntityCreation`), the 16 `{entity-create}` singletons were coarse keyword residues reclassified to precise residual blockers, and the seam is now an ordinary-creator foundation. `summonEntity` (primitives/job-kit.ts) declares INTENT as one mutation (ordered candidate list + `count` + paired `creationSpatial {origin, originSize, maxRange}`) and `validateEntityCreation` is the single legality/selection authority (bounds/occupied/impassable/LoS/footprint-range/cap; per-cell ids for `count>1`). An entity-kind registry (`entityKind`: `summon` | `object`, live in primitives/entity-kind.ts) drives lifecycle (summons removed on owner defeat; objects survive; companions persistent) and object stacking under the ≤3 height ceiling, and the intent SEPARATES placement region (`region`+`radius`, target/area-centered) from the creator LoS/range authority (`losOrigin`, canonical footprint distance) with `countMode` ('exact'|'up-to', cap-bounded). Ordinary summons all route through the seam: warden beasts (incl. Apex extra beast — no `freeCellsInRange[index]` bypass), seer wild-cards, geomancer boulder, enochian aethershard, sealer shrine, shade shadows, stormbender salt-sprites, harvester thralls. Cell-dependent exceptions stay explicit and documented (Seer Astra meteor adjacency damage, Warden Underway portal, Fool bombs, Harvester dark-sliver, Stormbender geyser/waterspout fallback). The `entity-create` blocker label is fully retired — **0 unresolved occurrences**, absent from the greedy simulation. 0 census promotions. **F5 (2026-08-29) also decomposed `{terrain-create}`**: that label was another keyword artifact spanning transform/delayed/triggered/selectable/under-character/moving/conditional/object-substitution semantics; all 56 records carrying it were re-read and reclassified to precise `terrain-*` families, the auto-push removed, and an exhaustive audit invariant (retired pattern + reviewed-rows) added so terrain-creation language cannot silently vanish. **Phase-1 terrain re-audit (2026-08-29) then RETRACTED seven source-inexact terrain talent folds** — Morrigan t2 (terrain only at its delayed resolve), The Tower t2 (debris when the end-of-foe-turn meteor lands), Blitz t1 (bloodied gate + free-space Chebyshev), Eye of the Storm t1 (center-occupancy predicate), Tsunami t1 (true center after movement), Heave-Ho t1 (only-one-foe-in-blast), Waterspout t2 (predicate + depends on the unimplemented movement window). Each is reclassified to a precise `terrain-*` family; the honest unresolved total rose 419→426 (talent 237). Regenered next family below | single authority: `entity-creation.ts` + entity-kind registry + `summonEntity` | `{entity-create}` cleared (0); `{terrain-create}` retired; next (F5, regenerated) = `{choice-input}` (8) | Intent + reducer candidate-fall-through tests (LoS/impassable/occupied/footprint-origin/cap/insufficient-cells/replay) + summon/object lifecycle/stacking + dynamic-terrain-obstruction + Terraforming Line/occupancy/ceiling/choice fixtures |
| K-P4 | Fly-grant / movement-modifier family | **`{fly-grant}` decomposed (2026-08-29, F4 audit); `fly-distance-modifier` NOT landed.** The one-shot Fly move already exists (`flyMutation` + the `plannedFly` placement helper), so `{fly-grant}` was a coarse keyword blast covering six distinct missing mechanics. All 30 records (17 singletons + 13 compounds) were re-audited and reclassified to precise families — `duration-fly-state`, `fly-move-timing`, `fly-move-substitution`, `fly-multirecipient`, `fly-distance-modifier`, `fly-benefit-rider`, `fly-or-teleport-repeat`, `once-per-round-fly-grant`, `flying-targeting` (stormbender:tsunami:mastery became action-cost + movement-distance-modifier + flying-foe-targeting — it never granted flight). The `fly-grant` label is retired (**0 occurrences**) and its auto-push removed. **The initial `colossus:raging-wolf:talent:2` promotion was retracted (Ultra Part 1):** the ability's full semantics (Heroic immunity while using, defeated-turns-next-use-free) cannot be represented, so the base ability stays deliberately non-executable and `colossus:raging-wolf:talent:2` remains unresolved on `choice-input` + `ordered-intermediate-state` + `fly-distance-modifier`. Census total 426 (after the Phase-1 terrain talent retractions); regenerated next family = `{choice-input}` (8) | existing fly authority (`movement:'fly'` + `plannedFly`) + rank-gated resolver wiring | 0 promoted (raging-wolf:t2 retracted); 30 reclassified; `{fly-grant}` retired | Fly families split into precise subfamilies; the one homogeneous bootstrapped `fly-distance-modifier` was halted until Raging Wolf's top-level semantics resolve (positive/negative/replay intended) |
| K-P5 | Mastery fold | Equipped mastery alters parent program execution. **Landed (2026-08-26):** modifier kernel `kernels/mastery-fold.ts` with `interrupt-rank`, `damage-type` conversion, and `unlimited-range` families; content rows in `content/jobs/mastery-modifier-recipes.ts`; consumed at the USE_ABILITY gate, window scans, and damage-emission points. Remaining families (range/area/repeat/duration) extend the same kernel | execution-time fold over `masteredAbilityIds` (`kernels/mastery-fold.ts`) | 3 modifier-fold wired (Catapult MANGONEL, Nothung EXCALIBUR, Endless Battlement PERFECT BATTLEMENT) + 1 program-level (Demon Claw RAGING DEMON, 2026-08-27) + 3 action-cost-override (Valiant, Shadow Play, Polaris, 2026-08-28); 129 remaining | Fold fires only when mastery equipped; closed negative; per-row source fixtures (landed tranche covered by spellblade/bastion/demon-slayer suites) |
| K-P6 | Bonus-damage grant family | **Landed (2026-08-27, F6a):** `kernels/bonus-damage.ts` — source-ID-free registered grant rules (self/target-bloodied, target-status, scaled counts) folded once at the USE_ABILITY boundary into `abilityUseModifiers.bonusDamageDice`; the roll itself stays the shared keep-highest `damage-roll` / `rollDamageDice` authority (ICON p.102). Content rows in `content/jobs/bonus-damage-recipes.ts`. 4 talent rows + the Finesse class trait promoted; the coarse `{damage-modifier}` census label is gone (remaining rows reclassified: bonus-damage-suppression, damage-maximize, save-or-stun, teleport-distance-modifier, exceed-grant) | use-time fold consumed by the damage authorities | 5 executable rows + Finesse; remaining subfamilies: round-gated dice, exceed auto-grant, damage-suppression, damage-maximize, flat self-ratio | Replay: folded dice ride the recorded mutations; negative gates (talent equipped but gate inactive) |
| K-P6b | Mark-modifier fold (F5, TODO step 6). **Landed (2026-08-27):** the reusable mark-modifier capabilities at the engine's existing mark query points — carrier-aware mark-condition projections with declared grant potency (`passive-projection.ts`, folded into `encounterConditionSet` + the projected status surface), the mark-keyed status-save policy seam (`registerStatusSavePolicySource`), and turn-boundary triggers (lifecycle recipes). Content rows in `content/jobs/mark-modifier-recipes.ts` + `lifecycle-recipes.ts`. 3 units promoted (Grand Seal t1 save curse, Grand Seal t2 pacified+, Rot t2 turn-start adjacency damage); the 9 remaining former `{mark-modifier}` singletons reclassified into precise subfamilies (mark-detonation-window, mark-as-entity-follow, mark-activation-gate, mark-stacking, attack-exceed-trigger, effect-count, terrain-create, choice-input, delivery-immunity) | mark query points (condition projection, save policy, lifecycle) | 3 promoted; 22 units still contain `mark-modifier` in compound sets | Carrier-aware projection positive/negative + live-drop boundary; mark-keyed save curse asserted on a recorded save window; turn-start trigger once per boundary + replay; negative gates (wrong talent choice, not bloodied, not adjacent) |
| K-P7 | Talent subfamily folds (remaining) | **Landed (2026-08-28, F8a):** action-cost-override fold via `CostModifierRule` in `kernels/cost-payment.ts` + `content/jobs/action-cost-override-recipes.ts` (3 pure mastery overrides promoted); **shove-modifier decomposed (F8b)**: 10 pure singletons reclassified with precise blockers (direction-override, conditional-distance-stun, new-shove-effect, foe-trigger-expansion); all resolver-level — no fold consumer. Kernel removed. Compound heave-ho:mastery reclassified to variable-cost only. **charge-state reclassified**: 6 delay-mechanic units removed; the resolver-implemented charge talents had been marked wired from the raw `context.triggers?.has('charge')` trigger. A review (2026-08-29) found that caused talent effects to fire from a generic slow turn WITHOUT proving the talent equipped (Spinning Top t2 flew on any charge; Chaos Tarot area-moved / Terraforming adjacency without rank). Repaired: every talent-specific branch is now gated on `source.talents[abilityId]`. Spinning Top t2, Chaos Tarot t2 and Terraforming t1 are promoted to executable program-level (the base "Charge: Choose four effects" stays talent-independent on Terraforming). Gigaton Whip t2 stays compound/unresolved: its collide fly (2 instead, 3 on charge) is gated+ wired, but the charge "Shove 3" remains unwired (`new-shove-effect`). Wicked Sheath t1's per-charge extra shove is wired but it stays compound (`collide-rider`). Census total 426 (the mark-modifier residuals listed `terrain-create` are now the precise `terrain-*` families from F5; the Phase-1 terrain talent retractions added +7). Remaining subfamilies: resource-management | cost-payment fold over mastery-equipped + round-gate | resource-management | Exact-ID slices, each with positive/negative/replay |
| K-P8 | Vigilance trigger windows | Guard/punish open from damage/adjacency triggers with once-per-trigger ledger | window protocol | p.105; Artillery Slip interplay | Trigger-driven spend replaces declared-result command; replay fixtures |
| K-P9 | Relic effect runtime | Invokes + persistent rank effects as data-first recipes | recipe layer mirroring foe recipes | 120 relic-ranks, 40 aspects | One invoke + one persistent effect source-exact before breadth |
| K-P10 | Mob member model | Member pool per actor, two-hits removal, slay suppression | encounter model | p.298 Mob | Full Mob encounter test |
| K-P11 | Foe phase engine | Trigger→phase transitions recorded durably; chapter-rule application | reducer seam + recipes | 19 phases, 116 chapter rules | Phased legend executes a transition under replay |

## Architecture-debt ledger

Debt classes: **A** correctness-threatening · **B** high-cost scaling debt ·
**C** harmless temporary debt.

| Item | Class | Notes |
| --- | --- | --- |
| `src/rules/encounter.ts` ≈2.7k lines (41 command cases + event reducer + dozens of helpers) | B | Known hotspot. Extract only along reusable seams (AGENTS §7); do not refactor for size alone |
| Content imports in orchestration: `tickGallowsHumorDie` (job lifecycle recipe) imported directly by `encounter.ts`; `cheat-time` mark special case inside `EXECUTE_RULE`; Demon Slayer delay key read by the scheduler (`DELAYED_SLOW_KEY`) | C→B | Works today, direction-safe-ish (scheduler reads an opaque ruleState key, not a source-ID switch), but each new special case erodes the content→kernel direction. Prefer registering these through the lifecycle/modifier registries when touched |
| `createFoeFromProfile` parses HP out of `traitsText` via regex | C | Fragile extraction seam; move to generated stats when extraction changes |
| Module-level mutable registries (`registerTurnEntitlementSource`, slow-eligibility, manual allowlist, lifecycle recipes) | C | Deterministic at import; observed test-only hazard: registrations leak across tests within a file (newer tests must use unique names/keys). Consider a reset hook for tests only |
| `vtt-room.ts` mixes table domain, validation, and encounter projection (≈1.2k lines) | C | Split if it grows further |
| Duplicated Lab/Sandbox fixture construction | C | BrowserVtt vs Sandbox both define `createLabFixture`; consolidate opportunistically |

Nothing currently rises to class **A**: no correctness-threatening coupling
was found between universal orchestration and source-specific IDs (the
scheduler and damage kernels stay source-ID-free).

## What NOT to abstract

The following are settled; further abstraction would be churn: the
command/event purity contract; the resource registry; the passive-projection
closed-manifest pattern; the foe declarative recipe factories; the held-window
protocol; the turn-scheduler decision-recording shape.

---

## Appendix A — historical numbering map

Code and test comments across the repository cite this document with the
foundation IDs (F0–F14) and section numbers of the pre-2026-08 rewrite. Those
references remain meaningful through this map:

| Historical ID / section | Current family |
| --- | --- |
| F1 / "Damage and defeat kernel" | Damage |
| F2 / §3 | Saves (SaveWindow) |
| F3 / §4 | Lifecycle (turn/round boundaries) |
| F4 / §5 | Interrupt / window engine (trigger provenance) |
| F5 / §6 | Passive projection (+ role baselines, HP thresholds) |
| F6 / §7 | Job-trait wiring homes, combat-start grants, summons, attack-path modifiers |
| F7 / §8 | Talent fold; gamble seam; ability-use choice seam |
| F8 / §Mastery | Mastery fold (now K-P5 under Missing kernels) |
| F9 | Reactive once-per-round folds; range semantics |
| F10 | Gamble window; ability-use choices |
| F14 / §10 item 1 | Cost/payment |
| Settlement (was TODO B1 / roadmap P1) | Combat settlement family above |
| §Area / §Range / §Aura / §"Power dice & stances" | Spatial geometry · Attacks · Statuses/stances · Power-die kernel |