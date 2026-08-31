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
  `  characterFromActor` projection carries HP attrition, wounds, and personal
  resolve back onto the persistent sheet (schema v5); camp/interlude sheet
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

**Active phase — UNDERLAY COMPLETION.** Per the user phase directive,
[`underlay-completion-plan.md`](underlay-completion-plan.md) owns the
current phase: finish the U1–U17 generic substrate before wiring or
promoting any further source units, with its UNDERLAY PHASE COMPLETE gate
(that document §4) as this phase's gate. The greedy blocker-census
sequencing in this section is **superseded** until that gate closes; the
priorities below resume afterwards.

A corrective pass (2026-08-30) repaired the first U3/U7 tranche work: the
`nearest` operator no longer invents actor-id tie-breaks (it returns the
full minimum-distance set; per-unit tie policy is a unit decision, not
an engine default), the position query domain separates generic space
queries from explicit occupied/free policies, `selectActors` no longer owns
a private p.92 actor-range algorithm, and the underlay completion plan's
historical-vs-current claims are reconciled.

**T1 landed (2026-08-30):** U1 Reference/Binding (`primitives/reference.ts`),
U2 Role/Perspective (`primitives/roles.ts`), and U8 Scope/Clock
(`primitives/scope.ts`) vocabulary foundation — typed vocabulary + unit
tests only, zero existing test deltas, no consumer migration, no
source-unit wiring (census unchanged at 427). The T1 pre-flight audit
sharpened the U3 residual classification: the ACTOR query domain itself
lacks contract operators (LoS/LoE composition, occupying-position, terrain
predicate, owned/controlled, set ops, count, distinct), and the p.108
line-of-sight predicate is missing from teleport/placement legality
(classified as a deliberate T2 boundary). U1/U2 moved ABSENT → PARTIAL;
U8 stays PARTIAL. The next implementation tranche is **T2 — U7/U3/U5/
U6-core/U4** (plan §3.2), NOT further U3 expansion alone: U3/U7 still
borrow `RuleSelector`/`context.actorId` because U1/U2 consumers are not yet
migrated, and those temporary dependencies must not be deepened.

**T2 landed (2026-08-30):** the query & expression algebra — U7 (entity
anchor + retained-specialist boundaries), U3 (actor-domain operators
completed: LoS/LoE-from-anchor, occupying, terrain predicate, owned-by,
set composition; entity + terrain domains; query types moved to
`primitives/query.ts`), the p.108 placement-LoS boundary resolved through
the generic legality authority (teleport player-chosen destinations now
require line of sight), U5 (`kernels/evaluate-value.ts`: count-query,
distance-between-endpoints, percent-base-max), U6 CORE
(`kernels/evaluate-predicate.ts`: mark-exists / in-stance / inside-aura /
acted-this-round; effect-still-exists stays T4 with U10), and U4
(`RuleChoice.rangeOrigin` anchor + the U2 chooser/controller entitlement
seam). Full suite green (1544 tests), census byte-stable at 427, no
source-unit promotion. **T3 — Policy, state, ledger: U14, U16 (core),
U15, U17 — LANDED (2026-08-30)** (plan §3.2): the one ModifierRule shape
(`primitives/modifiers.ts`, typed permission query points with enumerated
negatives) absorbed the range/area/mastery/bonus-damage fold registries;
the U16 core ledger (`primitives/usage.ts`) landed with byte-identical
keys, caps, per-use magnitude, and the `used-scope` predicate; the U15
transaction seam (`primitives/transaction.ts`) is wired into the
Masquerade spatial-batch gate; the U17 ordering policies
(`primitives/ordering.ts`) drive the ability-step order, the
trigger-window recipe order, and the interrupt LIFO pop. U18 evaluated
under the plan's decision rule: not promoted. Full suite green (1586
tests), census byte-stable at 427, no source-unit promotion. **T3
corrective pass (2026-08-30)** — no new underlays, no source-unit
changes: U16's de-dup identity now carries the owner (typed, distinct
from the actor-local storage key, negative-tested); U17 ordering rejects
unresolved orderings (typed `OrderingResult` problems; never the caller's incoming
array order; `controller-choice` never resolved by `applyOrdering`); U15
`TransactionSpec` declares `simultaneous` vs `sequential` (with a
caller-owned deterministic `project`) so collective/dependent
transactions are expressible without callers manually subtracting earlier
legs; U14 numeric values are U5 `RuleNumber`s resolved through an
injected resolver (`kernels/evaluate-modifiers.ts`), no special dynamic
literals in the primitive. Full suite green (1604 tests), census
byte-stable at 427. **T4 — Time and outcome: U9, U10 (completes U6 and
U16) — LANDED (2026-08-30)** (plan §3.2): `primitives/provenance.ts`
(U9: the typed provenance/delivery-dimension vocabulary incl.
`DeliverySourceKind` and the causal-origin-preserving `sameCausalOrigin`)
and `primitives/facts.ts` (U10: the exactly-typed discriminated `Fact`
union,
`recordFacts` at each resolve point, the LIVE `effectExistsLive` instance
read) landed and are barrel re-exported. U6 was completed with
`effect-still-exists` via the fact/instance seam (rejects on unrepresentable
instance identity); U16 completed with the U10 fact-backed
de-dup identity (`resolveIdentityKey` + `hasResolvedAsFact`, event
de-dup distinct from the `used-scope` counts).
`kernels/resolution-triggers.ts` migrated to record facts and project the
byte-compatible reactive-trigger surface (behavior-preserving). A **T4
corrective pass (2026-08-30)** refined the contracts without new underlays:
facts are now GENUINELY durable (per-resolution `resolutionId` owned by the
command/event boundary; typed facts + id RIDE the RULE_MUTATIONS_APPLIED
event so replay consumes recorded outcomes); `damage-applied` records the
DETERMINED amount and emits no false fact on fully-prevented damage; U16
resolve identity is RESOLUTION-scoped once-per-ability and WIRED into the
genuine reactive continuation (multiple routing facts open ONE triggered
step); and the live RuleActorView carries the durable instance id + ownership
so `effectExistsLive` answers specific-instance reads exactly and effect
lifecycle facts reference the original instance. A **T4 final contract fix
(2026-08-30)** made the four contracts true in the implementation: a
durable monotonic `resolutionSerial` on EncounterState (independent of the
bounded eventLog, migration-safe) guarantees resolution ids never repeat
past truncation; damage is determined ONCE at the command boundary and the
reducer consumes the recorded stamp (U10 amount == applied amount; a
no-op records no false fact; replay never re-decides); U16
`trigger-resolved` markers persist on the event's U10 facts (byte-identical
across replay); and U10 effect facts carry the exact live instance id the
reducer creates/removes, with instance-scoped removals leaving coexisting
instances intact. A **T4 closeout (2026-08-30)** finished the remaining
correctness edges: `resolveMutationOutcomes` is idempotent (an
already-stamped damage instance is treated as final — repeated continuation
passes perform zero new determinations); legacy checkpoint migration
derives a safe lower bound from ALL recoverable durable evidence (retained
RMA count, parseable retained resolution ids, revision floor) so a
saturated pre-fix checkpoint can never reuse a historical serial; and U10
fact `instanceId` is injective within a resolution via a single global
allocation sequence (an explicit defeat fact and a Slay-derived defeat
fact in the same resolution never share an id). Full suite green (1671
tests), census byte-stable at 427, no source-unit promotion. The next
tranche is **T5 — Execution: U11, U12, U13** (plan §3.2).

**T5a landed (2026-08-30): U11 core FLOW / SEQUENCE.**
`kernels/execute-flow.ts` is the single U11 flow authority (barrel
re-exported through the runtime compatibility barrel): the typed `FlowNode`
vacabulary (`sequence|bind|if|apply|repeat|for-each|invoke|emit-fact`),
`executeFlow`, the `FlowPlanner`, and the reducer-facing `effectsToMutations`
projection. `executeRuleProgram` plans the whole action against a PURE
SIMULATED intermediate encounter state — the reducer's own sequential
projection of the emitted-so-far mutation list, recomputed from a pre-flow
snapshot per emit, U15 atomic groups included (a simultaneous swap can never
become a sequential swap in the simulation) — so later effects observe the
ACTUAL intermediate state produced by earlier ones (rush-then-damage,
remove-then-place, teleport-then-adjacency, repeat iterations). Costs and
named-resolver mutations are absorbed first (p.99/p.102 paid-at-start
ordering); `U1` bind/`bound` selector propagation and `U10` emit-fact ride
the flow. Deliberately NOT landed: `choose`, `open-window`, `suspend` (U13/
U12 next), no ad-hoc continuation records. A T5a corrective made the bastion
Battering Ram/Catapult Collide-or-Heroic trigger steps select their
command-supplied referent without a stale pre-shove range re-check (the
reaction names the shoved character, p.122/p.123 — the old engine only
passed the range check because it re-validated against the pre-shove state).
Full suite green (1683 tests), census byte-stable at 427, no source-unit
promotion, no unresolved-unit wiring.

**T5b landed (2026-08-30): U12 CONTINUATION / SUSPENSION core.**
`primitives/continuation.ts` is the single durable authority for
suspended/future execution: the typed `ArmedContinuation` record with the
explicit **deferred-rule vs held-result** payload discriminant, U1
LIVE/CAPTURED refs, captured values, the U2 owner role, the U8 Clock /
U10 Fact trigger spec, expiry/cancellation, and the U17 ordering identity;
`armContinuation`/`resumeContinuation` are pure and replay-exact (zero
fresh decisions/RNG; captured data is literal, LIVE refs re-resolve,
held results resume exactly as recorded). `EncounterState.continuations`
(schema 8, migrated to `[]`) is the durable collection; the reducer is the
single arming point. `kernels/continuation-runtime.ts` owns the
deferred-rule execution seam (content resolver rows keyed by program id,
applied through the shared mutation authority). Wired migrations proving
the abstraction: Great Giorgios (p.124) moved off the `delayed` lifecycle
recipe onto a deferred-rule continuation that resolves the rush/shove/damage
at the marked foe's turn-end against THEN-CURRENT state; the save-rolled
window (Sucker Punch, p.143) carries the held save as a U12 held-result
continuation beside its legacy shape. Deliberately NOT landed: U13 unified
decision windows (trigger-window/save-window/gamble-window/pendingInterrupts
stay separate records; they may temporarily adapt to U12 payloads),
`rerollSaveMutations` → resume path, and U11 `open-window`/`suspend` (the
remaining T5 order is U13, then wiring those nodes through it).
`t5b-u12-continuation.test.ts` (10 adversarial cases: live deferred state,
captured literals, live refs, held-result immutability + Sucker Punch
reroll-as-new-result, held damage representation, cancelled/expired never
resumes, missing trigger fact, U17 ordering identity, byte-identical
replay). Full suite green (1693 tests), census byte-stable at 427, no
source-unit promotion, no unresolved-unit wiring.

**T5c landed (2026-08-30): U13 WINDOW / DECISION POINT.**
`kernels/decision-window.ts` is the ONE typed window authority (the
interrupt/window-engine status is registered in the deliverables claim
registry): the
`DecisionWindowRecord` (durable id, typed `DecisionWindowKind` —
when-damaged/defeated/save-rolled/uses-ability/area-inclusion/
targeted-by-ability/choice — U10 `openedBy` provenance with the U12
`instanceId` correlation seam, U12 held `heldPayload` continuation, held
effects, retarget, U4 choice spec, U17 ordering policy, U11 flow `resume`),
plus `openDecisionWindow`/`closeDecisionWindow`, the U17 LIFO pop
(`popDecisionWindowStack`), the p.107 turn-order total order
(`orderDecisionWindows`), the `DAMAGE_WINDOW_RECIPES` eligibility
registry (Righteous Disdain p.128 / Boiling Blood p.138), and the
`windowHeldDamage`/`windowHeldSave` projections (the payload is the
authority — determined damage/saves are NEVER recomputed). Old authorities
DELETED or thinned: `kernels/trigger-window.ts` deleted (registry moved
in); the `EncounterPendingInterrupt` schema deleted (compat alias only);
`pendingInterrupts` → `decisionWindows` (schema 8→9, migrated); the
per-window `heldDamage`/`heldSave`/`heldResult` fields gone — every window
carries its determined outcome as a U12 held-result payload. The `choice`
kind answers through the new `ANSWER_DECISION_WINDOW` command (recorded
U4 decision; the engine never invents a default). Migrations: damage
interrupt windows (when-damaged/defeated, held damage), the save-rolled
window (Sucker Punch held save), and the deferred-rule decision seam
(Great Giorgios "may rush" is now a genuine recorded choice — the mark is
consumed at window-open either way, decline is legal, accept resolves
against THEN-CURRENT positions; the old automatic rush was a documented
T5b-era approximation, now repaired). U11 `open-window`/`suspend` wired
through U13: a suspended flow carries the remaining nodes + binder on the
window and `ANSWER_DECISION_WINDOW` resumes it via `executeFlowResume`
(no content consumes the nodes yet). Deliberately NOT landed: U4 `choose`
as a flow node, `ability-use-choices.ts` (opaque fold, documented
specialist), Vigilance as a window (it stays a triggered EFFECT —
non-interrupt, per p.104-105), and Gamble-as-window (`resolveGamble`
stays the deterministic recorded dice operation — only genuine decisions
become windows). U12 kept choice-free: the decision lives in U13; the
fact-trigger correlation seam records the specific `instanceId` so an
unrelated same-kind fact never satisfies the wrong window.
`t5c-u13-decision-window.test.ts` (17 adversarial cases: held damage never
recomputed, defeated window only on prospective lethal, Sucker Punch held-
result/reroll/replace/decline/Heroic-curse-on-new-roll, nested LIFO,
same-trigger turn-order, owner-order yields a choice, automatic effects and
Vigilance are not windows, deterministic Gamble vs genuine decision,
Great Giorgios may-rush accept/decline + THEN-CURRENT positions +
Dragonslayer distinct, same-kind windows never answer each other,
byte-identical replay). Full suite green (1519 rule tests), census
byte-stable at 427, no source-unit promotion, no unresolved-unit wiring.

**T5c.1 corrective landed (2026-08-31): adversarial integrated audit of
T5a–c as one composed system.** No source-unit promotion and no new underlay.
`docs/t5c1-audit-report.md` records the finding-by-finding evidence. Fixes:
(1) held results are gated by the exact owning U13 window (`ContinuationTrigger
{ kind: 'window'; windowId }`) instead of a coarse same-kind `fact` trigger —
a held result can never auto-fire at a Clock/Fact boundary, and migrated held
payloads are re-gated onto their owning window id; (2) Righteous Disdain
(p.128) is the OWNER-ALLY trigger — the when-damaged owner is DISTINCT from
the damaged ally in Range 2, `EncounterHeldDamage` carries `targetId`, and
the held blow applies to the ally's already-determined amount (the owner's
armor/vigor/resistance never re-mitigate it; only a real re-dealt blow to the
held target consumes it); (3) `ANSWER_DECISION_WINDOW` validates through the
shared U4 `resolveChoice` kernel — an omitted REQUIRED answer rejects, an
explicit `false` records a legal decline, option/number/actor/position/
direction legality is enforced, and `resolveBoolean` rejects non-boolean
input; (4) ordering rejects rather than inventing tie-breaks — the
lexicographic same-instant kind sort and the registration-`order` fallback
are removed, same-instant same-owner/same-side ambiguities reject until a
recorded ordering decision exists, and `resumeDueContinuations` follows each
continuation's U17 ordering identity (never raw collection order);
(5) window ids are minted from a monotonic per-encounter `windowSerial`
(schema 10, migrated, snapshot-validated) so an id once issued is never
reused by a later window; (6) `FlowPlanner` frames `repeat`/`for-each` bodies so
suspension inside a partially consumed loop resumes every remaining
iteration/item exactly once (composed as existing `sequence`/`bind` nodes).
`t5c1-adversarial-audit.test.ts` proves the 17 demanded regression cases
(as well as the t5c/t5b suites and the RD-model corrections in the job
suites). What remains staged for T6: the typed durable identity/persistence
work, U4 `choose` as a flow node, `ability-use-choices.ts` (opaque specialist),
and the exact owner-ordering decision recording for simultaneous windows.
Full suite green (1731 rule tests), audit:architecture/automation/
source-fidelity strict all pass, census byte-stable (no source promotion).

**T6 landed (2026-08-31): underlay-phase gate audit and hard-gate proof.**
`docs/t6-gate-report.md` records the full U1–U17 matrix, the U18/U19
decisions, the duplicate-authority closure report, and the per-criterion
hard-gate verdict. **The underlay phase-close gate is NOT declared
satisfied — it remains OPEN.** Passed criteria: full suite green (§4.5), U18/U19 decided
(§4.6, both NOT promoted from code evidence), generated census byte-stable
(§4.7). Open criteria: §4.1 contracts current-and-true is PARTIAL, and §4.2/
§4.4 are FAIL for U16 — the raw durable usage-restriction fields
(`interrupt-uses`, `interruptUsedThisTurn`, `attacked-this-turn`, per-turn
reaction flags) sit beside the `primitives/usage.ts` authority, and the
`RuleModifier` → typed-query-point, `ability-use-choices` → U4-validation,
and same-owner simultaneous-ordering seams are documented but not all
parity-proven to the strict retained-specialist bar. Corrective work landed:
U11 doc-drift correction (the `FlowNode` vocabulary parenthetical still
claimed `open-window`/`suspend` were not landed — both are; only `choose`
remains unbuilt, and the U13 route already carries U4 decisions) and the
U18/U19 post-T5c.1 evidence verdicts in `underlay-completion-plan.md` §2.
**T6.1 landed (2026-08-31): U8 Scope/Clock consolidation — use-ledger reset
seam.** `primitives/scope.ts` now owns which usage period a recorded
boundary refreshes (`usagePeriodForResetBoundary`, inverse of
`resetBoundaryFor`), and the lifecycle once-per-turn/once-per-round reset
recipes route through it (`refreshUsageLedgerForBoundary` /
`usageLedgerHoldsForBoundary`) instead of hard-coding `ledger:*` prefix
interpretation. Behavior-preserving (1739 tests green, +8 new
`t6-u8-scope-consolidation` parity/replay cases; census byte-stable; no
source promotion). U8 remains PARTIAL on its `RuleDuration`/`RuleTiming`/
lifecycle/scheduler surfaces. The next corrective tranche — **T6.2, the
recorded same-owner ordering seam (U17)** — is scoped in the gate report;
U16 is not the correct smallest-first blocker because U8 and U17 underlay
it.

**T6.2 landed (2026-08-31): U17 recorded same-owner ordering seam.**
`primitives/ordering.ts` now classifies a simultaneous tie as determined /
unresolved / yields a same-owner chooser decision; U4 validates the answer
as a full permutation of the exact pending set; U13 opens the ONE ordering
decision window (chooser derived through U2, underivable choosers fail
closed); the recorded order stamps durable `resolvedOrder` ranks and the
U17 LIFO pop / boundary projection consume exactly that order on replay —
zero fresh choice, zero inferred tie-break, zero array-order dependence.
U17 remains PARTIAL on its turn-boundary consumers (hostile-before-
beneficial / non-active-owner-first / controller-choice at a real turn-
boundary call site). Next smallest-first blocker: the U17 turn-boundary
consumers, then U16 raw-field classification/migration.

**T6.3 landed (2026-08-31): U17 turn-boundary consumers — U17 now
COMPLETE/AUTHORITATIVE.** `primitives/ordering.ts` gains
`turnBoundaryOrdering`, a pure composition of the p.108 turn-boundary rules:
non-active-owner-first, hostile-before-beneficial within each ownership
group, the first same-owner tie becomes a recorded U4/U13 ordering decision,
and any remaining cross-owner/missing-owner tie fails closed. The command
boundary records a durable per-phase lifecycle candidate plan (source id +
mechanical owner + owner side) in the F3 intent; `runLifecyclePhase` and
`expireBoundaryEffects` route it through the authority, deferring a same-owner
tie onto ONE U13 ordering window (`heldBoundary`), and the DECISION_ANSWERED
reducer resolves the deferred effects in the recorded order (each exactly
once, never registry-ordered). The lifecycle registration order is demoted
to discovery/enumeration + the legacy pre-T6.3 replay fallback — the
registration-order-as-boundary-order authority and the expiry listing-order
tie-break are REMOVED. A fresh audit confirmed no other genuine U17 consumer
remains. Suite: `t6-3-turn-boundary-ordering.test.ts` (27 cases) + pinned
`aura`/`turn-transition`/`conditions`/`rooms` cases. **Next smallest-first
blocker: U2 role-consumer routing (U16 raw-field classification/migration
landed in T6.4).**

**T6.4 landed (2026-08-31): U16 raw usage-field consolidation.** The raw
`EncounterActor` usage/entitlement fields (`interruptUses`,
`interruptUsedThisTurn`, `slashedTriggeredThisTurn`,
`dangerousTerrainTriggeredThisTurn`) were classified and migrated onto the
typed `ledger:*` authority, then REMOVED from the type + VTT checkpoint
schema (schema 11 folds legacy values 1:1 and drops them deterministically).
Added the `any-turn` per-actor period for the ACTOR-LOCAL
one-interrupt-during-any-turn window (p.91), Slashed once-per-turn (p.116)
and dangerous-terrain once-per-turn (p.89); the one-attack-per-turn gate
lives on `ledger:turn:core:attack-this-turn`, split from the
`attackedThisTurn` U10 resolution FACT (retained as a documented specialist).
Lifecycle reset recipes are ownerless maintenance noops so clearing keys
can never fabricate a U17 same-owner tie. Suite:
`t6-4-usage-global-ledger.test.ts` (9 adversarial cases) + updated
`t5c1`/`interrupts`/`bastion`/`knave`/`movement`/`conditions`/
`damage-ledger`/`encounter`/`rooms`/`mastery` assertions reading the typed
ledger; full suite green (1808 tests); census byte-stable at 427 (no source
promotion); architecture guard (`bespoke-u16-entitlement-field`) + detection
test added.

**T6.4a landed (this tranche, 2026-08-31): U16 corrective closure — U16 is
now the single executing usage authority.** Corrected the
one-interrupt-per-turn window from battlefield-GLOBAL to ACTOR-LOCAL (the
p.91 passage's subject is the character; the rejected `interruptWindowUsedBy`
battlefield scan is removed). Re-audited and MIGRATED `usedAbilityIds`
(No Repeats) and `standardMoveUsed` to typed `ledger:*` keys and REMOVED
them from the `EncounterActor` type + checkpoint schema (schema 12).
Recorded the dangerous-terrain damage-cadence contradiction (p.89 once-per-turn
vs the p.183 Harvester reprint once-per-round) as adopted adjudication
`icon-1.5:dangerous-terrain:damage-cadence` (once per turn). Full suite
green (1818 tests); census byte-stable at 427 (no source promotion). The six
§8 U16 closure gates are now all met; the T6.4a gate report registers the
resulting status.

**T6.1–T6.4 scope note (per the T6 §3 split mandate).** U8 (temporal
consolidation), U17 (simultaneous-order arbitration + turn-boundary
consumers) and U16 (raw-field consolidation) were deliberately split: they
are independent seams with no real implementation dependency. T6.1 did U8
only; T6.2 landed the U17 recorded-decision seam; T6.3 landed the U17
turn-boundary consumers; T6.4 landed the U16 raw-field consolidation.

**U16 residual-usage-state census & migration (2026-08-31).** The last
actor-local once-per-scope marks were migrated off raw booleans/counters onto
typed U16 ledger keys: `chain-reaction-used` → `chainReactionOncePerRoundKey`
(round), `incubus:triggered` → `incubusOncePerRoundKey` (round, mark owner),
`stampede:triggered` → `stampedeOncePerRoundKey` (round, mark owner),
`gates-of-hell:vigilance-rushed` → `vigilanceRushOncePerTurnKey` (any-turn),
`midas:used` → `midasOncePerCombatKey` (combat, cap 2), and
`bull-s-strength:collided` → `bullStrengthCollideKey(targetId)` — corrected
from the census's owner-relative `turn` gate to the per-RECIPIENT identity:
"Characters can't take this damage more than once a turn" (p.149) restricts
the character RECEIVING the damage (owner = the Bastion's ledger storage,
target = the U16 key suffix, scope = the battlefield `any-turn` window
reopened at every actor's turn start). `damage-immune` and the
armed/charged/pending flags are proven content MODE or recorded fact, never a
usage gate; `monogatari:granted` is an UNRESOLVED U16 consumer (once-per-song
entitlement) blocked on the U8 source-defined lifecycle scope and is NOT
approximated onto turn/round/combat. A fresh semantic census therefore
corrects the prior re-certification: U16 remains **PARTIAL** (zero promotion;
census byte-stable at 427). The smallest next underlay tranche from the fresh
audit is the **U8 Scope/Clock surface** (`RuleDuration` / `RuleTiming` /
lifecycle / scheduler / source-defined lifecycle boundaries), which remains
PARTIAL beside U14/U9/U6.

**U8 Scope/Clock tranche landed (2026-09-01).** The generic **source-defined
lifecycle identity** resolved the blocking gap that kept U16's
`monogatari:granted` consumer unresolved: `primitives/scope.ts` now owns
`LifecycleIdentity` (U1-composed owner + source references + a durable
`instance` discriminator), the `until-lifecycle-replaced` Scope, the
`lifecycleGroupKey`/`lifecycleIdentityKey`/`sameLifecycleInstance`/
`lifecycleInstanceCurrent`/`lifecycleReplaced`/
`currentLifecycleInstanceId` helpers, and a `lifecycles` observation map on
`ClockObservation` — a generic "until this source is used/replaced/refreshed
again" representation with NO hard-coded period-enum member, no magic-string
identity, and no aliasing between two owners. The reducer's active-effect
expiry (`expireBoundaryEffects` / `expireOneBoundaryRecord`) now routes its
boundary meaning through `clockForTiming`/`boundaryEquals` (durable storage
byte-identical). At this substrate checkpoint, U8 supplied the generic scope
without changing Monogatari content or U16; the later proof-consumer tranche
integrated Monogatari and completed U16. New adversarial tests
(`u8-lifecycle-identity.test.ts`, +8). 1899 tests green, audits/typecheck/
build/extraction/replay clean, census byte-stable at 427, zero source
promotion. The residual status at this checkpoint was PARTIAL pending the
whole-consumer audit below.

**U8 residual closure + U1 dependency-root tranche (2026-09-01).** The
whole-consumer U8 audit classified scheduler cadence and durable duration
counters as retained specialists and found one real competing interpreter:
combat cleanup's local expedition-duration discriminant. Cleanup now calls
`durationSurvivesCombatEnd`; ordinary boundary expiry remains routed through
`clockForTiming`/`boundaryEquals`. Combat-vs-expedition cleanup and replay are
proved at encounter level, and `u8-scope-clock-routing` mutation-tests both
paths. The fresh U1–U17 census records five strict-authority rows and twelve
partial rows, selecting dependency-root U1. Its generic consumers now resolve
reference-shaped selectors, flow outcomes, target positions, core/foe reads,
attack provenance, and damage recipients through `reference.ts`, with a new
architecture guard. U1 remains PARTIAL on named content resolvers; next is a
shared content-authoring adapter and parity migration. No source unit changed;
the canonical census remains 427. Evidence:
`docs/u8-u1-underlay-census.md`.

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
`{teleport}` census family cleared. Fly-grant, entity-create and
terrain-create were later all decomposed as coarse keyword artifacts (F4
fly-grant; F3 entity-create; F5 terrain-create), leaving choice-input as the
regenerated highest-immediate family. The F3 audit
(2026-08-29) found the entity-creation AUTHORITY already exists
(`kernels/entity-creation.ts` `validateEntityCreation`: bounds, footprint
occupancy, impassable, LoS, footprint-distance range, summon caps) plus the
`entityMutation` builder and the shared position-query placement helper
(now `kernels/evaluate-query.ts` `evaluatePositions`/
`validatePositionLegality`; the old `freeCellsInRange` helper is retired), so
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
`{fly-grant}` label is retired (0 occurrences). The `fly-distance-modifier`
subfamily was NOT landed: the initial `colossus:raging-wolf:talent:2`
promotion was retracted (Ultra Part 1) because Raging Wolf's full
semantics (Heroic immunity while using, defeated-turns-next-use-free)
couldn't be represented; `colossus:raging-wolf:talent:2` remains unresolved on
`choice-input` + `ordered-intermediate-state` + `fly-distance-modifier`, and
the base ability is deliberately non-executable. The Phase-1 terrain re-audit (2026-08-29) then retracted seven source-inexact terrain talent folds (Morrigan t2, The Tower t2, Blitz t1, Eye of the Storm t1, Tsunami t1, Heave-Ho t1, Waterspout t2 — each needed delayed/moved-a-foe/occupancy/bloodied/blast-membership semantics the no-input fold can't express); the honest unresolved total rose to 426.

**Underlay tranche 2 — U3 QUERY/CANDIDATE landed (2026-08-29, tranche-2-query):**
one candidate-legality authority beneath both automatic targeting and the U4
CHOOSE kernel (`kernels/candidate.ts`, composed from the existing
`primitives/targeting.ts` + `spatial-intent.ts` authorities).
`kernels/choice.ts` actor validation now consumes the shared CandidateSet (the
second copy of eligibility is gone); CHOOSE semantics unchanged and re-proven
by the unmodified 23-case `choice.test.ts`. All 8 `{choice-input}` singletons
re-read against their passages: **0 promoted** (honest) — each needs a durable
per-ability choice WINDOW/CARRIAGE (U12 CONTINUATION / U13 WINDOW:
post-swap teleport, swap-ally selection, Slay-triggered gain-or-lose,
aura-teleport window, post-explosion re-damage, post-ability sacrifice), not
candidate legality. Census regenerated twice byte-stable at 426. A
corrective pass (2026-08-30) then routed the remaining U3 duplicates
(`nearestFoe`/`freeCellsInRange` resolver sugar, teleport-choice position
legality) through the query authority, and a second corrective pass removed
invented tie-break semantics, separated position-space from occupied/free
policies, and routed `selectActors` range legality through the shared
candidate authority (two retractions: `knave:dark-knight` and
`stormbender:eye-of-the-storm`, whose source grants player choice among
equidistant candidates — see `docs/underlay-completion-plan.md` §0). Next
tranche per plan §3.2: **T1 — U1/U2/U8**, then the rest of T2 (U5/U6-core/U4);
census regeneration resumes only after the UNDERLAY PHASE COMPLETE gate.

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
