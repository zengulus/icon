# T6 — Underlay Phase gate report (corrected audit, 2026-08-31)

Baseline `f5830da` (landed T5c.1). HEAD `6591d5a` was reviewed, and this
pass is the **corrective audit** of that report. **No source unit is
promoted**; the blocker census is untouched and remains byte-stable.

**T6.2 follow-up (this pass):** the recorded same-owner ordering seam
(U17) LANDED. `primitives/ordering.ts` now answers whether a simultaneous
tie is determined, unresolved, or yields a same-owner chooser decision
(`sameOwnerOrderingDecision`); U4 validates a FULL PERMUTATION of the exact
pending candidate set (`resolveChoice` `ordering` kind); U13 opens the ONE
ordering decision window (`openOrderingDecisionWindow`), the recorded
order stamps durable `resolvedOrder` ranks (`recordOrderingDecision`), and
the U17 LIFO pop / boundary projection consume exactly that order on
replay — zero fresh choice, zero inferred tie-break, zero array-order
dependence. The room boundary authorizes the answer by the window
responder's recorded controller. Tests: `t6-2-u17-recorded-ordering.test.ts`
(30 adversarial cases incl. replay), the `rooms.test.ts` responder
authorization case, plus the `t5c1` T6.2-pinned cases. U17 REMAINS PARTIAL
on its turn-boundary consumers (hostile-before-beneficial /
non-active-owner-first / controller-choice at a real turn-boundary call
site) — the §1 contract's recorded-decision seam is now landed, the
migration rows are not.

**T6.3 follow-up (this pass):** the remaining U17 turn-boundary
consumers LANDED. `primitives/ordering.ts` gains `turnBoundaryOrdering`, a
pure composition of the p.108 turn-boundary ordering rules:

  1. non-active-owner-first — effects not owned by the turn character
     resolve first, then the turn character's;
  2. hostile-before-beneficial — applied WITHIN each ownership group
     (bullet 1 is the stronger rule; a later stage never reverses it);
  3. the first remaining SAME-OWNER tie yields the recorded U4 ordering
     decision (the T6.2 seam); a remaining CROSS-OWNER tie (or missing
     owner/side) FAILS CLOSED — never registry/listing/array order, never an
     invented tie-break.

The lifecycle registry's insertion order is demoted to DISCOVERY/enumeration
order (and the legacy-replay fallback for pre-T6.3 event logs). The command
boundary records a durable per-phase lifecycle candidate plan (source id +
mechanical owner + owner side) in the F3 intent; `runLifecyclePhase` routes
that plan through `turnBoundaryOrdering`, defers exactly a same-owner tie
onto the ONE U13 ordering window (`heldBoundary` on the window record), and
the DECISION_ANSWERED reducer resolves the deferred effects in the recorded
order (each exactly once, never re-derived, never registry-ordered).
`expireBoundaryEffects` and `orderCrossCharacterEffects` delegate to the
same authority. **U17 is now COMPLETE/AUTHORITATIVE**: a fresh audit
confirmed no other genuine U17 consumer remains — the interrupt window
ordering, damage-window, and step-ordering paths already consumed U17
policies, and every §1 U17 obligation is now satisfied at a real call site.
The DUPLICATE ordering authority this row previously flagged (the lifecycle
registration-order-as-boundary-order and the expiry listing-order tie-break)
is REMOVED. Tests: `t6-3-turn-boundary-ordering.test.ts` (27 adversarial
cases: deterministic bullet ordering, A→B/B→A recorded choice, 3+ candidate
permutation, wrong responder, permutation validation, fail-closed
cross-owner + missing-owner, suspension/exact-once, replay with permuted
input, interrupt/phase boundaries). U2 role-consumer routing is now the next
smallest blocker (U16's raw-field consolidation closed in T6.4).

This report is a CLAIM TO AUDIT. The authoritative phase gate and the
authoritative per-underlay contracts remain `docs/underlay-completion-plan.md`
§4 and §1 rows. Where the prior `6591d5a` report disagreed with §1 or with
the code, this version is corrected to agree with **code at HEAD first and §1
rows second** — never the reverse.

## 0. Executive correction

`6591d5a` correctly concluded **UNDERLAY PHASE COMPLETE is NOT DECLARED and
the gate remains OPEN**. That conservative result is preserved.

But the `6591d5a` report was internally inconsistent and overstated several
rows. Its own matrix marked **U1, U2, U5, U6, U7, U8, U10, U12, U13, U15 as
TRUE** while the authoritative §1 rows state most of those as **PARTIAL with
non-empty "Consumers to migrate" lists**, and while the §1 **U17 contract
itself lists acceptance obligations the engine does not yet satisfy**.
This corrected report:

- puts every U1–U17 verdict back on the §1 row's own authoritative state,
  re-verified against code at HEAD;
- proves **criterion 3 (acceptance) was not actually established** and
  replaces the "spot, representative" mapping with an exhaustive acceptance
  matrix;
- removes the false "only one §1 row (U16) remains" claim;
- reopens **U17** (same-owner simultaneous ordering decision seam),
  **U8** (legacy temporal surfaces not migrated onto the Clock), and
  **U2** (role consumers not routed through `roles.ts`) as PARTIAL;
- leaves the gate OPEN (§4.2 and §4.4 fail; §4.3 not established).

---

## A. Audit-correction report (deliverable)

### A.1 Criterion-3 representative-vs-exhaustive defect — CONFIRMED

`6591d5a` §D said: "*The named acceptance obligations in each §1 row map to
real tranche suites* (`t5a`, `t5b`, `t5c`, `t5c1`, plus foundation suites) …
**Only one §1 row** (U16 …) names migration obligations whose completion is
still pending."

That is a **representative** mapping, and §4.3 requires the acceptance tests
**named in each §1 row** (positive / negative / boundary / replay where
stateful). A representative mapping cannot establish criterion 3. The
exhaustive acceptance matrix (deliverable C below) shows several §1-named
obligations are **MISSING** or **only indirectly assumed** (notably U17
recorded ordering + replay, U8 Clock migration reads, U2 aura/targeting/
save-window routing). **Criterion 3 was not established and is not PASS.**

### A.2 U17 TRUE contradiction — CONFIRMED, U17 = PARTIAL

The §1 U17 row's own acceptance list requires:

- *controller-choice ordering yields a recorded decision*;
- *Boundary: same-owner simultaneous effects*;
- *Replay: … controller-choice ordering records the player's ordering
  decision.*

Code at HEAD shows the ordering policies and `policyYieldsChoice` exist, but
**no consumer wires a same-owner simultaneous ordering decision through U4 as
a recorded decision and replays it**. `orderDecisionWindows(state, turnActorId,
pending)` **throws** `ordering-unrepresentable` on a same-instant same-side
tie, and `topDecisionWindowStack` **throws** `ambiguous-order` on a
same-instant same-owner tie — it rejects as "unrepresentable until a recorded
ordering decision exists" rather than offering the U4
`controller-choice` record the §1 contract says the owner is entitled to.
`controller-choice` has no end-to-end recorded-decision consumer.

**Verdict: U17 = PARTIAL.** The "Land then hostile-before-beneficial /
non-active-owner-first / controller-choice land turn-boundary consumers in
T5" claim in the §1 row was not actually delivered. The engine correctly
fails closed (never invents an order), but the contract's recorded-decision
seam is unbuilt. This must remain, and is a real hard-gate item.

### A.3 U8 TRUE contradiction — CONFIRMED, U8 = PARTIAL

The §1 U8 row states **PARTIAL** and says, verbatim: "*The legacy surfaces
remain the executing authority — `RuleDuration` / `RuleTiming` / `use-ledger`
/ lifecycle readers still re-key 'round' separately; migrating them onto the
Clock (the U8 completion work …) is a later phase, not T1*", with:
`RuleDuration` consumers, `use-ledger` periods, lifecycle phase reads,
`RuleTiming` boundary interpretation, and scheduler round counters listed as
**Consumers to migrate**.

`6591d5a` marked U8 TRUE and called `RuleDuration` "a serialization surface
projected onto U8". That directly contradicts the authoritative row. Code
confirms `scopeForDuration` / `clockForTiming` / `boundaryReached` /
`currentClock` are consumed only by `continuation.ts` and `scope.test.ts`; the
use-ledger kernel still carries its own `UseLedgerPeriod` string periods
(`turn|round|combat`) writing `ledger:<period>:*` keys independent of the
Clock, and `expireBoundaryEffects` re-keys `duration.turns/rounds` directly.

**Verdict: U8 = PARTIAL (unchanged from §1; corrected from `6591d5a`'s
TRUE).**

**T6.1 follow-up:** this tranche migrated the first U8 consumer — the
**use-ledger reset authority**. `primitives/usage.ts` now owns
`resetBoundaryFor` / `usagePeriodForResetBoundary` (which boundary refreshes
which period), and the lifecycle turn/round reset recipes call
`refreshUsageLedgerForBoundary` / `usageLedgerHoldsForBoundary` instead of
hard-coding `ledger:turn:*` / `ledger:round:*` prefix interpretation (see
§C patch and §D parity/replay tests). U8 stays PARTIAL on the remaining
surfaces cited here — `RuleDuration` consumers, `RuleTiming` boundary reads,
lifecycle phase-duration expiry, scheduler round counters — each still a
real migration item in §D.

### A.4 U2 TRUE contradiction — CONFIRMED, U2 = PARTIAL

The §1 U2 row states **PARTIAL** and lists as **Consumers to migrate**:
aura bearer/member derivation, `targeting.ts` relation reads, command-layer
choice routing, and `save-window.ts` owner derivation. Code at HEAD confirms
`deriveRoles` / `roleFrameFromContext` / `choiceEntitledPlayer` are consumed
**only** by `kernels/choice.ts`; `kernels/aura.ts` derives membership via
side comparisons, `targeting.ts` relation reads are local, and the command
boundary routes `ANSWER_DECISION_WINDOW` by `window.actorId` alone.

**Verdict: U2 = PARTIAL.** "Aura/targeting are specialists" is not a
sufficient argument by itself: ROLE is "relative to whom is this clause
interpreted?", and these modules answer that question with their own side /
relation reads. Under the strict retained-specialist test they do not
currently prove disjointness.

### A.5 The "only one §1 row remains" claim — FALSE

`6591d5a` §D claims only U16 has pending migration obligations. Its own
matrix lists unfinished work in **U3, U4, U6, U9, U11, U14, U16 and U17**,
and §1 states PARTIAL with non-empty **Consumers to migrate** for **U1, U2,
U3, U4, U5, U6, U7, U8, U9, U11, U12, U14** and U16. The claim is false and
is deleted.

### A.6 Other matrix/§1 mismatches discovered and corrected

| Row | `6591d5a` claimed | §1 row states | Corrected |
| --- | --- | --- | --- |
| U1 | TRUE | PARTIAL (legacy context slots remain resolution sources; consumers to migrate) | PARTIAL |
| U5 | TRUE | PARTIAL (inline resolver arithmetic; typed non-numeric values; usage elevations) | PARTIAL |
| U6 | TRUE | PARTIAL (range/area gate-body folding remains post-T2) | PARTIAL |
| U7 | TRUE | PARTIAL (aura/teleport/creation origins + rebound origin not unified) | PARTIAL |
| U9 | PARTIAL | PARTIAL (vocab LANDED; `resolution-triggers`/`damage-ledger`/movement folds still reconstruct) | PARTIAL |
| U10 | TRUE | LANDED (T4-corrected) — fact ledger authoritative | LANDED (TRUE, nearest) |
| U12 | TRUE | PARTIAL (resolver end-of-turn effects, save AST, held-damage consumers REMAIN) | PARTIAL |
| U13 | TRUE | AUTHORITATIVE (T5c.1) | TRUE |
| U15 | TRUE | LANDED (T3) — one transaction seam | TRUE (documented instantiations) |

A module existing is not completion. Per §4, a row with a non-empty,
unresolved **Consumers to migrate** list is PARTIAL for gate purposes unless
every remaining item is a proven retained specialist (§3 test). Apply that
test below.

---

## B. Corrected U1–U17 matrix (authoritative, code-true)

State vocabulary mirrors the plan (§0): `PARTIAL` (vocab/authority exists for
a subset; full contract or a consumer migration missing) vs `LANDED`/
`AUTHORITATIVE` (one authority; complete for its declared scope). `TRUE` in
the gate sense = §4.2/§4.4 satisfied with no unresolved duplicate and all §1
acceptance met.

| U | Declared authority (HEAD) | §1 state | Consumers to migrate (unresolved) | Gate verdict |
| --- | --- | --- | --- | --- |
| U1 Reference | `primitives/reference.ts` | PARTIAL | legacy context slots (`actorId`/`attackTargetId`/`triggerSourceId`/`triggerTargetIds`/`damageRecipientId`) remain resolution sources; continuation refs map | PARTIAL |
| U2 Role | `primitives/roles.ts` | PARTIAL | aura bearer/member, `targeting.ts` relation reads, command-layer choice routing, `save-window.ts` owner | PARTIAL |
| U3 Query | `kernels/evaluate-query.ts` + `primitives/query.ts` | PARTIAL | area / persistent-instance / rule-source query domains; ordering beyond min-distance set | PARTIAL |
| U4 Choice | `kernels/choice.ts` | PARTIAL | `ability-use-choices`/`talentChoices` fold reads; window-carried `ChoiceSpec` | PARTIAL |
| U5 Value | `kernels/evaluate-value.ts` | PARTIAL | inline per-resolver arithmetic; usage reads; traversed/elevation/area-size typed values | PARTIAL |
| U6 Predicate | `kernels/evaluate-predicate.ts` | PARTIAL | range / area gate-body folding (consumer migration) | PARTIAL |
| U7 Anchor | `primitives/anchor.ts` | PARTIAL | aura origins, `runtime.ts` actorId-as-anchor, rebound origin (U12), entity `creationSpatial` | PARTIAL |
| U8 Scope/Clock | `primitives/scope.ts` | PARTIAL | ~~`use-ledger` periods~~ migrated (T6.1); remaining: `RuleDuration` consumers, `RuleTiming` boundary reads, lifecycle phase-duration expiry, scheduler round counters | PARTIAL |
| U9 Provenance | `primitives/provenance.ts` | PARTIAL | `resolution-triggers` read, damage-ledger entry construction, movement-entry folds, reroll-save | PARTIAL |
| U10 Fact | `primitives/facts.ts` | LANDED (T4) | executedStepIds/derivedTriggers → typed facts (flow bookkeeping, documented) | TRUE |
| U11 Flow | `kernels/execute-flow.ts` | PARTIAL | per-resolver hand-sequenced code; no separate `choose` node required (`open-window→U13→U4` is the sole mid-flow decision carriage, corrected) | PARTIAL |
| U12 Continuation | `primitives/continuation.ts` + `continuation-runtime.ts` | PARTIAL | resolver end-of-turn effects (Polaris/Carnevale), save-window AST, held-damage records | PARTIAL |
| U13 Window | `kernels/decision-window.ts` | AUTHORITATIVE (T5c.1) | DONE (window layer) | TRUE |
| U14 Modifier | `primitives/modifiers.ts` | LANDED + `RuleModifier` stat bag unresolved | `RuleModifier` stat bag → typed query points; attack/mastery/bonus-damage/aura reads | PARTIAL |
| U15 Transaction | `primitives/transaction.ts` | LANDED (T3) | cost-payment, `spatialBatchId`, `countMode:exact`, `requiresLegalSpatialBatch` (documented U15 instantiations) | TRUE |
| U16 Usage | `primitives/usage.ts` + `use-ledger.ts` | AUTHORITATIVE (T6.4 + T6.4a corrective) | usage/entitlement is the single executing authority: the six §8 gate conditions are met — (1) the one-interrupt-per-turn restriction is ACTOR-LOCAL (p.91 subject is the character; Black Rock Vanguard is an actor-scoped override) and No Repeats + `standardMoveUsed` are MIGRATED to typed `ledger:*` keys (schema 12) and REMOVED; the one-attack gate is `ledger:turn:core:attack-this-turn` (distinct from the `attackedThisTurn` U10 fact); the `any-turn` per-actor windows (one-interrupt-during-any-turn, No Repeats, Slashed, dangerous terrain) reopen at every turn start while owner-relative `turn` pools refresh only at the owner's turn; the dangerous-terrain once-per-turn reading is recorded as adopted adjudication `icon-1.5:dangerous-terrain:damage-cadence`; lifecycle reset recipes ownerless noops | TRUE |
| U17 Ordering | `primitives/ordering.ts` | COMPLETE/AUTHORITATIVE (T6.2 recorded same-owner decision + T6.3 turn-boundary consumers) | recorded same-owner permutation LANDED (T6.2); turn-boundary consumers (non-active-owner-first, hostile-before-beneficial, same-owner controller-choice at real call sites) LANDED (T6.3); duplicate lifecycle/listing-order authority REMOVED | TRUE |

**Only U10, U13, U15 meet the complete-contract bar.** Everything else has an
outstanding §1 consumer migration or unbuilt seam. This is materially more
conservative than `6591d5a`, and it is the honest code-and-§1 truth.

---

## C. Exhaustive acceptance matrix (criterion 3)

For each §1 row, every named acceptance obligation → the exact test that
satisfies it, or a classification. Obligation classes: **POSITIVE /
NEGATIVE / BOUNDARY / REPLAY**. Status: **PASS** (exact test exists),
**PASS (composed)** (proved by a composed tranche test), **MISSING** (no test
proves the named obligation), **OBSOLETE** (authoritative contract validly
changed, reason given).

| U | §1 obligation | Exact test | Class | Result |
| --- | --- | --- | --- | --- |
| U1 | captured position stays exact after moving | `reference.test.ts` (positive captured-exactness; replay identical-literal + Binder purity) | POS/NEG/BOUND/REPLAY | PASS |
| U1 | live ref re-resolves new position on later turn | `reference.test.ts` (live re-resolution; replay) | POS/REPLAY | PASS |
| U1 | unbound name rejects; captured≠live as live | `reference.test.ts` (negative) | NEG | PASS |
| U1 | empty collection ref / defeated-actor ref | `reference.test.ts` (boundary) | BOUND | PASS |
| U2 | TARGET_CONTROLLER / owner≠carrier distinct controllers | `roles.test.ts`; `t2-choice-roles.test.ts` | POS | PASS (composed) |
| U2 | underivable chooser rejects at command boundary | `roles.test.ts` (negative); `choiceEntitledPlayer` | NEG | PASS |
| U2 | self-collapse; ROLE≠ANCHOR rebound | `roles.test.ts` (boundary); `t5c1` rebound | BOUND | PASS |
| U2 | window responder replayed to same responder | `roles.test.ts` (replay same-frame-same-map) | REPLAY | PASS (composed) |
| U2 | aura/targeting/save-window read roles through `roles.ts` | **MISSING** — aura/targeting/save-window still derive locally | POS (migration) | MISSING |
| U3 | "all foes in range 3" == union of per-foe choices | `evaluate-query.test.ts`; `candidate.test.ts` | POS | PASS |
| U3 | entity/position/terrain candidates resolve | `evaluate-query.test.ts`; `t2-query-extension.test.ts` | POS | PASS |
| U3 | defeated/off-board/out-of-range/relation negative | `candidate.test.ts` / `evaluate-query.test.ts` | NEG | PASS |
| U3 | at-range passes; one-past fails (footprint) | `evaluate-query.test.ts` | BOUND | PASS |
| U3 | `selectActors` parity + `rangeOrigin` replay | existing fixture parity; `t2-query-extension.test.ts` | REPLAY | PASS |
| U4 | required/optional/cardinality/distinct/bounds | `choice.test.ts` (23 tests) | POS/NEG/BOUND | PASS |
| U4 | chooser-role derivation | `t2-choice-roles.test.ts` | POS | PASS |
| U4 | position choice legality through U3 | `t2-choice-roles.test.ts` + teleport fixtures | POS/BOUND | PASS |
| U4 | `abilityUseChoices`/`talentChoices` fold-through | `ability-use-choices.test.ts` exercises the fold directly, NOT through `resolveChoice` | POS (migration) | MISSING (not through shared validator) |
| U4 | optional-decline never defaults (window timing) | `t5c-u13-decision-window.test.ts`; `t5c1` | BOUND | PASS (composed) |
| U5 | count(query) / distance(ref,ref) / percent-base-max | `t2-expression-algebra.test.ts` | POS | PASS |
| U5 | divide-by-zero/unknown-stat rejects | `t2-expression-algebra.test.ts` (negative) | NEG | PASS |
| U5 | usage reads | **MISSING** — usage reads not landed (`usage(key,scope)` value absent) | POS | MISSING |
| U5 | quarter-mark/0-count boundary; replay Finesse | `hp-threshold.test.ts`; `finesse.test.ts` (replay) | BOUND/REPLAY | PASS (composed) |
| U6 | bloodied/quarter/compare-compound gates | `evaluate-predicate` via T2 fixtures / `t2-query-ext`; `hp-threshold.test.ts` | POS | PASS |
| U6 | mark-exists / in-stance / inside-aura / acted-this-round / used-scope / effect-still-exists | `t3-usage.test.ts` (used-scope), `t4-effect-exists.test.ts`, `effect-exists` fixtures | POS | PASS (composed) |
| U6 | range/area gate-body fold parity | **MISSING** — range.ts/area.ts gates still fold locally | POS (migration) | MISSING |
| U7 | non-self `rangeOrigin` resolves | `evaluate-query.test.ts` / `t2-query-extension.test.ts` | POS | PASS |
| U7 | teleport planned-path + rebound-origin replay | `spellblade.test.ts`; `t5c1` rebound | REPLAY | PASS (composed) |
| U7 | aura/teleport/creation origins unified onto `SpatialAnchor` | **MISSING** — these remain specialists w/o shared-anchor parity | POS (migration) | MISSING |
| U8 | durations / usage / lifecycle agree on one Clock | `scope.test.ts` (17) + `t6-u8-scope-consolidation.test.ts` (use-ledger reset routes through U8) | POS/REPLAY | PASS (use-ledger reset); duration/lifecycle parity still PARTIAL |
| U8 | N-boundary / next-match / slow-turn boundary | `scope.test.ts` | POS/BOUND | PASS |
| U8 | turn/round/combat usage reset via Clock reads | `t6-u8-scope-consolidation.test.ts` proves turn-start refreshes `ledger:turn:*`, round-start `ledger:round:*`, turn/round-end + combat-end refresh nothing, and the reset replays identically | POS/NEG/BOUND/REPLAY | PASS (use-ledger reset via U8; `expireBoundaryEffects` duration fields remain a MISSING migration) |
| U9 | Slay / Collide / Pacified-break provenance | `t4-facts-provenance.test.ts`; `t5c1` collide | POS | PASS (composed) |
| U9 | provenance fields byte-identical on replay split | `t5c1`/`damage-ledger.test.ts` | REPLAY | PASS (composed) |
| U9 | resolution-triggers read via recorded facts, not re-derivation | `t4-facts-provenance.test.ts`; `resolution-triggers.ts` still reconstructs — **MISSING** | POS (migration) | MISSING |
| U10 | durable facts ride RMA event; replay consumes | `t4-final-contracts.test.ts`; `t4-closeout.test.ts` | POS/REPLAY | PASS |
| U10 | overlapping routes fire once (resolution-scoped de-dup) | `t4-dedup.test.ts`; `t4-corrective.test.ts` | BOUND | PASS |
| U10 | executedStepIds/derivedTriggers not a fact substitute | `t5c1` (documented flow bookkeeping) | NEG | PASS (composed) |
| U11 | rush-then-damage / remove-then-place / teleport-adjacency | `t5a-u11-flow.test.ts` | POS | PASS |
| U11 | repeat N+1 sees N; for-each; invoke; bind; emit-fact | `t5a-u11-flow.test.ts` | POS | PASS |
| U11 | invalid intermediate leg rejects whole command | `t5a-u11-flow.test.ts` (negative) | NEG | PASS |
| U11 | zero-repeat / empty for-each no-op; U15 swap simultaneous | `t5a-u11-flow.test.ts` | BOUND | PASS |
| U11 | mid-flow player decision (`choose`) recorded + replayed | `t5a`/`t5c` prove `open-window`/`suspend` carry U4; **a distinct `choose` node has no source-backing** — OBSOLETE as a requirement (see §E) | REPLAY | PASS (composed, via open-window) |
| U12 | deferred rule against THEN-CURRENT state | `t5b-u12-continuation.test.ts` | POS | PASS |
| U12 | captured stays captured; live stays live | `t5b-u12-continuation.test.ts` | POS | PASS |
| U12 | held result immutable; cancelled/expired never resume | `t5b-u12-continuation.test.ts` (negative/boundary) | NEG/BOUND | PASS |
| U12 | multiple continuations use U17 ordering; full replay | `t5b`; `t5c1` ordering | REPLAY | PASS (composed) |
| U12 | resolver end-of-turn effects (Polaris/Carnevale) on continuations | `polaris`/`carnevale` still use per-source delayed logic — **MISSING** | POS (migration) | MISSING |
| U13 | when-damaged/defeated/save-rolled open exactly | `t5c-u13-decision-window.test.ts` | POS | PASS |
| U13 | answer validates via U4 resolveChoice; decline legal | `t5c1`; `t5c-u13` | POS/NEG | PASS |
| U13 | nested LIFO; same-trigger turn-order; owner ambiguity fail-closed | `t5c-u13`; `t5c1` H4 | BOUND | PASS |
| U13 | replay byte-identical zero fresh RNG/decisions | `t5c-u13`; `t5c1` | REPLAY | PASS |
| U14 | one ModifierRule shape drives range/area/cost/attack/damage/save | `t3-modifiers.test.ts`; `rue` parity | POS | PASS (composed) |
| U14 | typed permission distinctness; wildcard impossible; unowned never folds | `t3-modifiers.test.ts` | POS/NEG | PASS |
| U14 | conflicting rules deterministic winner; scope filter; predicate flips | `t3-modifiers.test.ts` | BOUND | PASS |
| U14 | fold-dependent attack/damage replay byte-identical | `attack-modifiers.test.ts`/`mastery.test.ts` (replay) | REPLAY | PASS (composed) |
| U14 | `RuleModifier` stat bag folded as typed query points | **MISSING** — `RuleModifier` still a stat/op bag consumed by `encounter-adapter`/mutations without a typed query point | POS (migration) | MISSING |
| U15 | cost+swap+creation grouped commit; partial legality rejects whole | `t3-transaction.test.ts`; `spatial-authority.test.ts` | POS/NEG | PASS |
| U15 | exact-count creation fails closed; never partial-apply denied group | `t3-transaction.test.ts`; `entity-creation` | NEG | PASS |
| U15 | empty group / cap-reduced success boundary | `t3-transaction.test.ts` | BOUND | PASS |
| U15 | swap + exact-creation replay byte-identical | `t3-transaction.test.ts`; `t5a` | REPLAY | PASS (composed) |
| U16 | N-per-round cap; per-use magnitude; refresh at boundary | `t3-usage.test.ts`; `use-ledger.test.ts` | POS | PASS |
| U16 | capped use rejected; unequipped never consumes | `t3-usage.test.ts` | NEG | PASS |
| U16 | cap reduced by override; refresh-vs-combat; shared ledger across actors | `t3-usage.test.ts` | BOUND | PASS |
| U16 | once-per-trigger across routes fires once; de-dup replay | `t4-dedup.test.ts`; `t5c1` | REPLAY | PASS |
| U16 | raw `interruptUses`/`interruptUsedThisTurn`/`slashedTriggeredThisTurn`/`dangerousTerrainTriggeredThisTurn` migrated (schema 11); `usedAbilityIds`(No Repeats)+`standardMoveUsed` migrated (schema 12); one-interrupt-per-turn ACTOR-LOCAL; one-attack gate split from the `attackedThisTurn` fact; any-turn per-actor windows + owner-relative resets; dangerous-terrain adjudication pinned | `t6-4-usage-global-ledger.test.ts` (17 adversarial); `encounter.test.ts` migration fold; `source-adjudications.test.ts` | POS/BOUND/REPLAY + NEG (shortcut) | PASS (T6.4 + T6.4a) |
| U17 | source-order step ordering; turn-order | `t3-ordering.test.ts`; `t5c1` | POS | PASS |
| U17 | LIFO nesting; controller-choice yields typed choice (never resolved) | `t3-ordering.test.ts`; `t5c-u13` | POS | PASS |
| U17 | undefined/unorderable rejects, never silent iterate | `t3-ordering.test.ts` (negative) | NEG | PASS |
| U17 | **same-owner simultaneous effects — recorded ordering decision + replay** | `t6-2-u17-recorded-ordering.test.ts` (30): positive A→B/B→A, permutation validation, suspension/state, replay (serialize/replay, permuted-array invariance, no fresh decision); `rooms.test.ts` responder authorization; `t5c1` pinned cases | BOUND/REPLAY | PASS (T6.2) |
| U17 | hostile-before-beneficial / non-active-owner-first / controller-choice turn-boundary consumers | `t6-3-turn-boundary-ordering.test.ts` (27): deterministic non-owner-first + hostile-before-beneficial at the real END_TURN boundary, same-owner A→B/B→A recorded choice, 3+ permutation, wrong responder, permutation validation, fail-closed cross-owner + missing-owner, suspension/exact-once, replay with permuted input, interrupt/phase boundaries; registry-order permutation invariance; `aura.test.ts`/`turn-transition.test.ts`/`conditions.test.ts` pinned cases | POS/BOUND/REPLAY | PASS (T6.3) |

**Criterion 3 is NOT PASS**: MISSING rows remain for U2 (aura/targeting/
save-window routing), U4/U5, U6 (gate-body fold), U7, U8 (Clock-read resets),
U9, U12 (resolver end-of-turn), and U14 (`RuleModifier`). The U17 recorded
same-owner ordering + replay obligation is **PASS (T6.2)**, the U17
breakdown consumers obligation is **PASS (T6.3)**, and the U16 raw-field
consolidation obligation is now **PASS (T6.4)**. Each remaining MISSING row
is a named §1 obligation without a satisfying test.

---

## D. Actual remaining blocker set (derived, not inherited)

Ranked by **dependency**, not census frequency. Foundations first; each is a
real §1 consumer-migration or unbuilt seam, confirmed at code HEAD.

1. **U8 — Scope/Clock consolidation.** T6.1 migrated the **use-ledger reset
   authority** onto U8: `primitives/usage.ts` now owns `resetBoundaryFor` /
   `usagePeriodForResetBoundary` (which period a boundary refreshes), and the
   lifecycle turn/round reset recipes call `refreshUsageLedgerForBoundary` /
   `usageLedgerHoldsForBoundary` instead of hard-coding `ledger:turn:*` /
   `ledger:round:*` prefix interpretation. `scope.test.ts` (17) + the new
   `t6-u8-scope-consolidation.test.ts` (8) prove the consumers route through
   the Clock. U8 REMAINS PARTIAL: `RuleDuration` consumers, `RuleTiming`
   boundary reads, lifecycle phase-duration expiry, and the scheduler's
   round-count reads still re-key temporal boundaries separately. Foundational:
   U5 round/turn reads, U12 Clock triggers, U13 window timing, U16 resets.
2. **U16 — raw durable usage fields.** `interruptUses`,
   `interruptUsedThisTurn`, `attackedThisTurn`, `slashedTriggeredThisTurn`,
   `dangerousTerrainTriggeredThisTurn` were durable usage-restriction state
   beside the ledger. Classification (per §16): `interruptUses` /
   `interruptUsedThisTurn` / `attackedThisTurn` → usage entitlement (U16);
   `slashed`/`dangerousTerrain` → once-per-turn reaction de-dup (U10/typed
   de-dup ledger). **T6.4 DONE:** `interruptUses`, `interruptUsedThisTurn`,
   `slashedTriggeredThisTurn`, `dangerousTerrainTriggeredThisTurn` migrated
   onto the typed `ledger:*` authority (schema-11 migration folds them 1:1 and
   drops the raw fields); the one-attack gate lives on
   `ledger:turn:core:attack-this-turn`; the `attackedThisTurn` resolution
   fact is retained and documented as a U10 specialist; replay + schema-11
   migration proofs added. **T6.4a (this tranche) completes the U16 closure:**
   the one-interrupt-per-turn window is corrected to ACTOR-LOCAL (p.91
   subject is the character; the rejected battlefield-global scan is gone),
   `usedAbilityIds` (No Repeats) and `standardMoveUsed` are re-audited and
   migrated to typed `ledger:*` keys (schema 12), and the dangerous-terrain
   damage-cadence contradiction is recorded as adopted adjudication
   `icon-1.5:dangerous-terrain:damage-cadence`. U2 role-consumer routing is
   the next smallest blocker.**
4. **U2 — route role consumers.** Aura bearer/member, `targeting.ts` relation
   reads, save-window ownership, and command-layer choice responder routing
   onto `roles.ts` `deriveRoles`/`choiceEntitledPlayer`, with parity tests, OR
   prove each is a disjoint retained specialist under the §3 four-part test.
5. **U12 — resolver end-of-turn effects.** Polaris meteor / Carnevale
   per-source delayed logic → armed continuations with Clock triggers.
6. **U4 — ability-use-choices / talentChoices through `resolveChoice`** (or
   proven closed-table parity with a boundary test).
7. **U14 — `RuleModifier` stat bag → typed query points** (parity-proved
   retained projection or migrated).
8. **U6 — range/area gate-body fold migration** onto the U6 predicate/`U14`
   algebra.
9. **U3 — area / persistent-instance / rule-source query domains** (only when
   a source unit needs them — do not build speculatively; narrow the contract
   if source evidence does not justify).
10. **U1 — legacy context slots → typed refs** across runtime/choice/
    bonus-damage/resolvers.

T6.1 implemented the **U8 use-ledger reset seam alone** (a contained,
behavior-preserving consumer migration with parity + replay tests). **T6.2
landed the recorded same-owner ordering seam (U17)** — the recorded-decision
half of the §1 contract — as a separate, independent decision-arbitration
surface (U17 + U4 + U13), with the U8 temporal migration untouched. U17
remains PARTIAL on its turn-boundary consumers (item 2 above); U16 is the
next smallest-first blocker after U8/U17's landed halves.

---

## E. Retained-specialist closure report (deliverable F) — §3 four-part test

The §3 test: (1) semantically distinct responsibility; (2) stated boundary;
(3) no overlapping input yields a divergent answer; (4) parity/boundary tests
where drift is plausible. Applied to every surviving apparent duplicate.

| Location | Responsibility | 1 sess. distinct? | 2 boundary written? | 3 divergent overlap? | 4 parity test? | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `kernels/aura.ts` member/relation derivation | aura membership geometry + relation | Partial — relation read is U2-shaped | Documented in §1 U2 | Plausible (side vs role) | **No** | **NOT closed** → U2 blocker |
| `primitives/targeting.ts` relation reads | direct-target eligibility | Partial — relation read is U2-live | Documented | Plausible | **No** | **NOT closed** → U2 blocker |
| `primitives/save-window.ts` owner policy | save resolution priming | Partial — owner is U2 | Documented | Plausible | **No** | **NOT closed** → U2 blocker |
| `ability-use-choices.ts` (kernel fold) | closed trait-table spend tables | Yes (candidate supply + spend) | Documented | No (data tables, not legality) | Existing fold tests, not vs U4 | **CLOSED as specialist** for candidate/supply; legality NOT routed through U4 → leave U4 item |
| `RuleModifier` stat bag | persistent effect-instance projection | Yes (instance data, not a fold) | Documented | Plausible vs U14 | **No** | **NOT closed** → U14 item |
| `range.ts` / `area.ts` gate bodies | range/area legality folds | Yes (domain legality) | Documented | Plausible vs U6/U14 | **No parity** | **NOT closed** → U6 item |
| per-resolver hand-sequenced code | named ability sequencing | Yes | Documented (U11 sequencing) | No (resolvers are content) | covered by fixtures | **CLOSED** |
| `resolution-triggers.ts` reconstruction | derived facts projection | Partial | Documented | Plausible vs recorded facts | **No** | **NOT closed** → U9 item |
| `DamageWindowLedger.window` | replay handoff provenance | Yes | Documented | Differs from U13 (opens via ledger, never answers) | `t5c1`/`damage-ledger.test.ts` | **CLOSED** |
| `RuleContinuationState` executedStepIds/derivedTriggers | reactive same-ability fold ledger | Yes (flow bookkeeping, not facts) | Documented | No (not a fact substitute; `t5c1`) | `t5c1` H3 | **CLOSED** |
| `EncounterPendingInterrupt` compat alias | window schema alias | Yes (compat) | Documented | No | migration tests | **CLOSED** |
| `kernels/mastery-fold.ts` | thin adapter over shared ModifierRule registry | Yes | Documented | No | `mastery.test.ts` | **CLOSED** |
| cost-payment / `spatialBatchId` / `countMode:exact` / `requiresLegalSpatialBatch` | per-domain legality under U15 grouping | Yes (domain legality; U15 owns grouping) | Documented as instantiations | No if same-seam | `t3-transaction.test.ts`; `spatial-authority.test.ts` | **CLOSED** (parity via transaction tests) |
| `teleport-choice` | position-domain choice | Yes | Documented | No (routes through shared legality) | `spellblade`/teleport fixtures | **CLOSED** |
| `foe-recipes` dash / trait reactions | area-inclusion reads | Yes | Documented | No (read through `insideArea`) | fixtures | **CLOSED** |

The specialists that are NOT closed to the four-part bar are exactly the
consumers listed in §D blockers (U2, U6, U9, U14) — they are real residual
items, not doc-able away.

---

## F. U18 / U19 decision (deliverable G)

Reconfirmed from actual evidence, unchanged from `6591d5a`:

- **U18 Attachment/Contribution — NOT PROMOTED.** After T5c.1 every named
  contribution kind resolves onto an existing underlay (U14 `ModifierRule`
  one-shape, U11 flow steps, U13 windows, U12 continuations, U4 choices, U3
  queries, U1/U2 registration/ownership). The novel attachment/equipment
  registry facet is content-registration glue, not new algebra. `mastery-fold.ts`
  still reads the shared `ModifierRule` registry. No evidence of a common
  authority eliminating duplication emerged in this audit.
- **U19 Intent — NOT PROMOTED.** Command-boundary candidate/save/entity/
  placement legality and reducer replay-safe mutation application are
  distinct responsibilities; the typed intents (`SpatialIntent`,
  `creationSpatial`, `SaveWindowSpec`) are the domain authorities' validation
  contracts. No same-typed intent is validated by two independently drifting
  implementations. Creating U19 as a wrapper would add a layer, not closure.

---

## G. Final hard-gate verdict (deliverable H) — mirrors §4 exactly

Evaluate each §4 criterion as written.

| # | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | U1–U17 source-backed contracts current and true of code | **PASS** | Every §1 row is now current and code-true: PARTIAL underlays truthfully state their unfinished migrations (U2, U3, U4, U5, U6, U7, U8, U9, U11, U12, U14) and LANDED/AUTHORITATIVE rows match code (U10, U13, U15, U16, U17). The U11 `choose` contract and the U8 `use-ledger` reset row were reconciled; U16 reached AUTHORITATIVE in T6.4a once all six closure gates were met (actor-local interrupts, `usedAbilityIds`/`standardMoveUsed` migrated, the dangerous-terrain adjudication recorded, no competing authority, acceptance suite green) — see §B/§D. Note: a contract truthfully stating `PARTIAL` still satisfies §4.1; incompleteness is judged under §4.2/§4.3/§4.4, not §4.1 |
| 2 | One clearly owned semantic authority each; named locations migrated or documented retained specialists | **FAIL** | Unresolved: U2 role consumers, U8 `RuleDuration`/`RuleTiming`/lifecycle/scheduler surfaces (use-ledger reset migrated in T6.1), U14 `RuleModifier`, U9 reconstruction, U6 gate-body folds, U12 resolver effects. U16 raw fields REMOVED (T6.4 schema 11 + T6.4a schema 12); the one-interrupt-per-turn window is ACTOR-LOCAL; `usedAbilityIds`/`standardMoveUsed` are gone; `attackedThisTurn` retained as a documented U10 fact specialist. U17's lifecycle registration-order and expiry misfiring-order duplicate authorities are REMOVED (T6.3) |
| 3 | Required acceptance tests exist and pass | **FAIL (not established)** | Exhaustive matrix (deliverable C) has MISSING rows for U2, U4, U5, U6, U7, U8 (duration/lifecycle expiry), U9, U12, U14. The U17 recorded same-owner ordering + replay obligation is PASS (T6.2) and the U17 turn-boundary consumers obligation is PASS (T6.3); the U16 usage/entitlement acceptance rows are PASS (T6.4 + T6.4a). The remaining PARTIAL rows (U2/U4/U5/U6/U7/U8/U9/U12/U14) lack a closed acceptance suite, so the criterion as a whole is NOT ESTABLISHED |
| 4 | No known duplicate competing authority | **FAIL** | U2 role reads in aura/targeting/save-window; U8 `RuleDuration`/`RuleTiming`/scheduler temporal surfaces beside Clock (use-ledger reset now routes through U8); U14 `RuleModifier` bag beside the fold. U16 no longer duplicates the ledger on raw actor fields (T6.4 + T6.4a; the architecture `bespoke-u16-entitlement-field` guard forbids reintroducing them). The U17 duplicate ordering authority is REMOVED (T6.3) |
| 5 | Full suite green | **PASS** | typecheck / npm test (1818) / build / audits / source-artifacts / e2e green at this commit (see §I verification) |
| 6 | U18/U19 decided | **PASS** | Both NOT promoted from code evidence (§F) |
| 7 | Generated docs regenerated (byte-stable) | **PASS** | `audit:class-job-census` regenerates byte-stable; census unchanged; no source promotion |

**Verdict. UNDERLAY PHASE COMPLETE: NOT DECLARED. The gate remains OPEN.**

Failing criteria: §4.2 (FAIL), §4.3 (FAIL—not established), §4.4 (FAIL).
§4.1 now PASSES (all contracts current and true of code). Prior
`6591d5a` failed §4.2/§4.4 only; `bc352dd` additionally established §4.3 was
never proved (Criterion-3 representative defect) and reopened U2/U8/U17. T6.1
migrated the U8 use-ledger reset seam (keeping U8 truthfully PARTIAL on its
remaining `RuleDuration`/`RuleTiming`/lifecycle/scheduler items). T6.2
landed the recorded same-owner ordering decision seam (U17 + U4 + U13),
keeping U17 truthfully PARTIAL on its turn-boundary consumers. T6.3 landed
those remaining turn-boundary consumers (non-active-owner-first,
hostile-before-beneficial, same-owner controller-choice at real call sites),
demoting the lifecycle registration order to discovery/enumeration and
removing the expiry listing-order tie-break — **U17 is now
COMPLETE/AUTHORITATIVE**. T6.4 migrated U16's raw regional usage fields onto
the typed ledger (and removed them from the schema), so U16 no longer has a
duplicate authority beside the ledger either.

**Tranche sequence (from post-T6.3 evidence):**
1. **T6.1** — U8 use-ledger reset authority consolidated onto the
   Clock (`scope.ts` owns "which period a boundary refreshes"; lifecycle reset
   recipes route through it). DONE (§C patch, §D parity/replay tests).
2. **T6.2** — recorded same-owner ordering seam (U17): identify the owner
   entitled to order through U2, open the ONE U4/U13 decision window, record
   the selected order as durable `resolvedOrder` ranks, replay that recorded
   order (no invented total order, no array-order fallback). DONE
   (`t6-2-u17-recorded-ordering.test.ts`, `rooms.test.ts` responder
   authorization).
3. **T6.3** — U17 turn-boundary consumers: route the lifecycle
   phases and boundary expiries through the p.108 `turnBoundaryOrdering`
   authority, defer a same-owner tie onto the ONE recorded ordering window,
   and fail closed on cross-owner/missing-owner — the lifecycle
   registration-order-as-boundary-authority duplicate is REMOVED. DONE
   (`t6-3-turn-boundary-ordering.test.ts`, 27 cases; pinned
   `aura`/`turn-transition`/`conditions` cases).
4. **T6.4** — U16 raw usage/entitlement field consolidation onto the typed
   ledger. Classified the five raw fields, migrated four
   (`interruptUses`, `interruptUsedThisTurn`, `slashedTriggeredThisTurn`,
   `dangerousTerrainTriggeredThisTurn`) onto U16 `ledger:*` entries and
   REMOVED them from the `EncounterActor` type/checkpoint schema; split the
   one-attack gate (`ledger:turn:core:attack-this-turn`) from the
   `attackedThisTurn` U10 resolution fact (only the fact remains, as a
   documented retained specialist); added the `any-turn` per-actor scope for
   the ACTOR-LOCAL one-interrupt-during-any-turn window, Slashed
   once-per-turn, and dangerous-terrain once-per-turn; routed the lifecycle
   reset recipes through ownerless maintenance noops so clearing keys can
   never fabricate a U17 same-owner tie (they run after ordered effects).
   DONE (`t6-4-usage-global-ledger.test.ts`, 9 adversarial cases; and the
   new architecture `bespoke-u16-entitlement-field` guard).
4a. **T6.4a (this tranche, corrective closure)** — the T6.4 one-interrupt
   window was originally read as battlefield-GLOBAL; re-reading the exact
   p.91 passage (`"only one interrupt during any turn, (yours or another
   character's)"`) confirms the grammatical subject is the CHARACTER, so the
   one-per-turn entitlement is ACTOR-LOCAL (Alice and Carol each interrupt
   once during Bob's turn independently). T6.4a removed the battlefield
   scan (`interruptWindowUsedBy`), made `interruptWindowAvailableFor` read
   only the acting actor's own `any-turn` mark, and keyed Black Rock
   Vanguard as an actor-scoped override. T6.4a also re-ran the `usedAbilityIds`
   and `standardMoveUsed` audits and migrated both to typed `ledger:*` keys
   (schema 12: No Repeats as per-source any-turn marks; standard move as an
   owner-relative `turn` gate distinct from Dash) rather than retaining them
   as scheduler/raw specialists; verified and formally recorded the
   dangerous-terrain damage-cadence source contradiction as adopted
   adjudication `icon-1.5:dangerous-terrain:damage-cadence` (once per turn);
   and reconciled the docs to the actual result. The six §8 gate conditions
   for U16 AUTHORITATIVE are now met. DONE (`t6-4-usage-global-ledger.test.ts`
   17 adversarial cases; `source-adjudications.test.ts` pin).
5. Then **U2** role-consumer routing with parity tests; then the remaining U8
   surfaces (`RuleDuration`/`RuleTiming`/lifecycle); then U12 resolver
   effects; then U4/U14/U6/U9 closures; then U1/U3 residuals — each with a
   parity/replay proof.

No source promotion accompanies or precedes this gate; promotion stays
delayed until the gate closes. T6.1 reopened U2/U8/U17 and then migrated the
U8 use-ledger reset authority; T6.2 landed the U17 recorded-decision seam.
Reopening + honest migration is a successful tranche result, not a failure.

T6.4a is the corrective pass that closes U16's remaining audits: the
T6.4 one-interrupt-per-turn window was corrected from battlefield-global to
actor-local, `usedAbilityIds` and `standardMoveUsed` were migrated to typed
`ledger:*` keys (schema 12), and the dangerous-terrain damage-cadence
contradiction was formally recorded and pinned. **U16 is now AUTHORITATIVE**
only because all six §8 gate conditions (source-accurate actor-local
interrupts, both migrations, the recorded adjudication, no competing
executing authority, the full named acceptance suite green) are demonstrably
met — not merely because the original four raw fields were removed. The
UNDERLAY PHASE gate stays OPEN on U2/U8/U12/U14/U9/U6.

---

## I. Verification discipline

T6.1, T6.2, and T6.3 are **implementation tranches**: production code changed
(the U8 use-ledger reset authority; the U17 recorded same-owner ordering
seam; the U17 turn-boundary lifecycle consumers; the U16 raw usage-field
consolidation), so the full §4.5 suite was actually rerun at this commit,
not inherited:
- `npm run typecheck` — PASS;
- `npm test` — **1818 pass** (the T6.4 baseline + the T6.4a corrected
  interrupt/No-Repeats/standard-move ledger assertions + the new
  `t6-4-usage-global-ledger` adversarial cases + the new architecture guard
  cases + the `source-adjudications` dangerous-terrain pin + the
  `encounter`/`mastery`/`bastion`/`knave`/`movement`/`conditions`/
  `damage-ledger`/`t5c1`/`rooms` test updates to read the typed ledger); all
  updated assertions read the U16 `ledger:*` keys, never the removed fields;
- `npm run build` — PASS;
- `npm run audit:architecture` / `audit:automation` /
  `audit:source-fidelity --strict` / `audit:outcome-triggers` — PASS;
- `npm run verify:source-artifacts` / `verify:extraction` — PASS (byte-for-byte);
- `npm run test:e2e` — PASS; `npm run test:e2e:transport` — PASS;
- `npm run audit:class-job-census` — regenerated **byte-stable** (no source
  promotion in this tranche: only substrate consolidation, so the blocker
  census is unchanged);
- `git diff --check` — clean.

No generated status/census files were hand-edited; the census regenerated
byte-stable. (The `attackOncePerTurnKey` / interrupt gate keys were added to
the architecture audit's protocol-level kernel exemptions with the same
justification as the pre-existing `core:standard-move` / `fool:masquerade`
entries — the shared U16 core-mechanic gate vocabulary, not per-content
resolvers.)