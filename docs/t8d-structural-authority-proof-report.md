# T8d — Structural Authority Proof Tranche (2026-08-31)

Lead specialization: S9 (audit/verification) with S2 (authority-proof
mechanism) and S4 (replay/entitlement). **Zero** previously unresolved ICON
source units were promoted.

Purpose: move the authority proof from lexical guards to **type/API
structure** — the semantic operation itself must be unable to accept a
plain/aliased value where the authority's result is required.

> **AUTHORITATIVE requires structural result ownership, not import/call/touch
> presence.**

## 1. Fresh HEAD

Audited commit before any T8d change: **`d06e38a`** (with the T8c worktree
already applied). T8c had already added the `RelationPerspective` brand (the
perspective *id* is typed) and structural audit guards. T8d found the two
remaining non-structural gaps and closes them by typing the consumption point.

## 2. Remaining gaps closed

### U2 candidate — the relation OPERATION now requires a U2 actor (was: a lexical guard)

**Before (T8c):** the perspective `id` was branded, but `matchesTargetRelation`
still accepted any `Pick<TargetCandidate,'id'|'side'>` as its source. The
bypass:
```ts
const ignored = relationPerspectiveIdFromContext(context);
const localId = context.actorId;          // plain/aliased id
return context.state.actors[localId];     // un-branded RuleActorView
```
compiled — the actor lookup returned a plain `RuleActorView` that satisfied
the old signature. The T8c guard banned only one literal spelling.

**After (T8d) — the semantic operation requires the U2-produced value:**
- `roles.ts` defines `RelationActor = RuleActorView & { readonly
  [relationSourceBrand]: true }`, a second `unique symbol` brand.
- `roles.ts` exposes the ONLY producer, `relationSourceFor(state,
  perspective: RelationPerspective): RelationActor | null` — it accepts a
  branded `RelationPerspective` and brands the resolved view. No other code
  can mint a `RelationActor`.
- `candidate.ts::actingActor` derives the perspective via U2 and resolves the
  source ONLY through `relationSourceFor`.
- `targeting.ts::matchesTargetRelation` (and `isEligibleTarget`,
  `eligibleTargets`, `queryDirectTarget`) type their **source** as
  `RelationActor`.

A plain/aliased lookup returns `RuleActorView`, which is **not assignable to
`RelationActor`** — so the bypass above is a compile error: the self/ally/foe
semantic decision structurally refuses a perspective that did not flow through
U2. This is dependency enforcement in the type, not a regex.

### U16 F9 — the once-per-round gate is ONE authoritative plan object (was: three loose calls)

**Before (T8c):** the fold called `usageKey` / `ledgerAvailable` /
`consumeUsageMutation` as separate calls with separate results. A bypass could
call each, touch their results, and independently recompute key / availability
/ mark from raw `ruleState` — with no structural reason to stop it.

**After (T8d):** `trait-reactions.ts::oncePerRoundGate(actor, sourceId)`
returns a single `OncePerRoundGate` plan:
```ts
{ key, available, consume, identity }   // key + availability + consume FROM U16
```
and is the ONLY producer of that plan. The fold gates on `gate.available` and
persists `gate.consume` **verbatim** — it never recomputes availability from
raw `ruleState`, never rebuilds the key (template or `['ledger',…].join(':')`
concatenation), and never hand-builds the mark. The U16 typed `identity`
carries the REAL owner, so a fabricated empty owner is distinguishable at the
typed boundary even though storage bytes omit it. (U16 stays PARTIAL
regardless — residual actor-level trigger marks are still uncensused, see §7.)

**The U16 F9 corrective (this tranche): `OncePerRoundGate` is now structurally
UNFORGEABLE.** The plan type carries a module-private `unique symbol` brand
(`oncePerRoundGateBrand`), and only `oncePerRoundGate` stamps it. The brand is
**not exported**, so arbitrary consumers cannot even name the required
property — a plain object (even one seeded with a real gate's `key` /
`available` / `consume` / `identity`, or carrying a locally recomputed
availability, a hand-built mutation, or an alternate-spelling key) is **a
compile error** when assigned to `OncePerRoundGate`. So "the engine accepts X
as a U16 once-per-round gate result ⇒ X was produced by U16" now holds at the
type level, not as a caller-discipline or lexical-guard claim. The gate object
is transient (only the `consume` state mutation rides the durable event), so
the brand never enters checkpoint bytes. The four adversarial cases (A1 forged
gate, A2 local availability, A3 local consume, A4 local key) are pinned by
`@ts-expect-error` compile proofs in `trait-reactions.test.ts` (see §4).

## 3. Authority → returned result → semantic operation paths

### U2 candidate
```
relationPerspectiveIdFromContext(context)                [roles.ts U2]
  → relationPerspectiveId(roleFrameFromContext(context))
  → returned RelationPerspective (null ⇒ throw, fail closed)
  → relationSourceFor(context.state.actors, perspective) [U2 SEALED producer]
  → returned RelationActor (null ⇒ throw, fail closed)
  → matchesTargetRelation(source: RelationActor, candidate, relation)  ← semantic op
```
Alternative semantic path: **none at the type level** — the `matchesTargetRelation`
SOURCE parameter is `RelationActor`, which only `relationSourceFor` can
produce; `context.state.actors[<plain or aliased id>]` is not assignable to it.

### U16 F9
```
oncePerRoundGate(actor, sourceId)                        [U16 plan producer]
  → roundLedgerUsageSpec(actor.id, sourceId)             [REAL owner]
  → usageKey(spec) ⇒ key
  → ledgerAvailable(actor, key) ⇒ available
  → consumeUsageMutation(sourceId, actor.id, key) ⇒ consume
  → { key, available, consume, identity }                ← the plan
  → fold gates on gate.available, persists gate.consume verbatim
```
Alternative semantic path: **none in the fold** — it consumes the plan; raw
`ruleState[` gating, key reconstruction, hand-built marks, and fabricated
empty owners are prevented (and additionally flagged by the audit). And
**nothing else can produce a valid `OncePerRoundGate`**: the plan type is
branded with the module-private `oncePerRoundGateBrand` unique symbol that only
`oncePerRoundGate` stamps (§2), so any object literal / cast / alias /
locally-recomputed construction is a compile error. The semantic answers a gate
carries (key / available / consume / identity) are therefore provably U16-derived
whenever the engine accepts the value as a gate result.

## 4. Adversarial mutations — CAUGHT

All keep the canonical authority call alive while bypassing its result.
Bypasses fail by **type/API structure** (first mechanism listed) or by the
audit (second, defensive).

| # | Bypass | Primary structural mechanism | Result |
| --- | --- | --- | --- |
| U2-M1 | U2 called, result ignored, source read from aliased `context.actorId` | `matchesTargetRelation` SOURCE is `RelationActor`; a plain lookup is a **compile error** (`@ts-expect-error` pinned in `t7-u2`) | **CAUGHT** |
| U2-M2/M3 | aura perspective from aliased actor id / entity ownership | `AuraOriginRef.perspectiveActorId` is `RelationPerspective`; a plain string is a **compile error** (`@ts-expect-error` pinned) | **CAUGHT** |
| U2-M4 | membership uses anchor/owner side | membership must read `state.actors[origin.perspectiveActorId]` (positive audit) + `origin.side` ban | **CAUGHT** |
| U16-M1 | `ledgerAvailable` called, gate reads raw aliased state | fold gates on the plan's `gate.available`; raw `ruleState[` gating is flagged | **CAUGHT** |
| U16-M2 | `consumeUsageMutation` touched, separate hand-built mark persisted | fold persists `gate.consume` verbatim; a hand-built mark not referencing a U16 result is flagged | **CAUGHT** |
| U16-M3 | `usageKey` called, key rebuilt via `['ledger',scope,id].join(':')` | plan derives the key in U16; key reconstruction (template or concat) is flagged | **CAUGHT** |
| U16-M4 | decoy real-owner call, actual path uses fabricated `''` owner | plan builds from the REAL owner's typed spec; `ownerId: ''` in the fold is flagged | **CAUGHT** |
| U16-A1 | forged gate: real authority called, then a plain object reusing `real.key` / `available` / `consume` / `identity` is built | `OncePerRoundGate` requires the private `oncePerRoundGateBrand`; a plain object is a **compile error** (`@ts-expect-error` in `trait-reactions.test.ts`); calling the real authority first does not make the forgery valid | **CAUGHT (structural)** |
| U16-A2 | local availability: real gate kept alive, availability independently typed from raw `ruleState` (`!hasOwnProperty(state, gate.key)`) | a gate stamped with a locally-derived `available` is a **compile error** (private brand missing); the fold gates on `gate.available` (positive audit) | **CAUGHT (structural)** |
| U16-A3 | local consume: real gate kept alive, an independently built mutation persisted | a gate stamped with a hand-built `consume` is a **compile error**; a fold persisting its own mark drops the `consumeUsageMutation` call (symbol-routing guard flags it) | **CAUGHT (structural + audit)** |
| U16-A4 | local key: real gate kept alive, key rejoined via `['ledger','round',id].join(':')` | a gate stamped with a locally-rejoined key is a **compile error**; dropped `usageKey` routing is flagged | **CAUGHT (structural, not a key-spelling regex)** |

## 5. Corrected U1–U17 census (mutually exclusive buckets)

Rule: *a retained specialist must answer a genuinely different semantic
question; a consumer that independently answers the underlay's question is an
UNRESOLVED DUPLICATE.*

| U | Semantic question | Authority | MIGRATED | RETAINED SPECIALIST (4-part proof) | UNRESOLVED DUPLICATE | Status |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | What does a reference mean? | `primitives/reference.ts` | continuation refs; candidate anchor selectors | — | legacy context-slot reads independently resolve "what does this slot mean" outside U1 | PARTIAL |
| U2 | Relative to whom? | `primitives/roles.ts` (`RelationPerspective` + `RelationActor` brands) | candidate (via `relationSourceFor`), aura, chanter, choice, decision-window | `matchesTargetRelation` — Q: given a U2 SOURCE, is X eligible; disjoint: it cannot derive the source; four-part: source is `RelationActor` (U2-only), no origin-kind/owner mapping, U2-M1..M4 guards + compile proofs | none | **AUTHORITATIVE** |
| U3 | What qualifies now? | `evaluate-query.ts`+`query.ts`+`candidate.ts` | actor candidates, direct-target gate, area inclusion, nearest | direct-target problem vocabulary — disjoint; cannot derive perspective | terrain/entity/area/instance domains, ordering beyond min-distance | PARTIAL |
| U4 | What did the player choose? | `kernels/choice.ts` | all choice-type validations, teleport legality | teleport-choice refinements — disjoint (operates on `resolveChoice` output) | `ability-use-choices`/`talentChoices` folds | PARTIAL |
| U5 | What scalar now? | `RuleNumber`+`evaluateNumber` | query ranges, modifier numerics | pure scalar translations — disjoint (FAIL CLOSED) | inline per-resolver arithmetic; typed non-numeric values | PARTIAL |
| U6 | Does this clause apply now? | `evaluate-predicate.ts` | used-scope, effect-still-exists | — | local range/area gate-body folds | PARTIAL |
| U7 | From where is this spatial rule measured? | `primitives/anchor.ts`+`spatial-intent.ts` | candidate range-origin, choice position range, teleport-choice origin positions (captured-position anchor via `validatePositionLegality`) | `RuleArea.origin` — Q: declarative placement shape (no runtime consumer); disjoint; `creationSpatial` — Q: resolved-position contract carried on the creation mutation for replay; disjoint; neither can reconstruct an anchor; guarded | aura origin derivation (`auraOriginRefs` measures membership from an independently-derived origin); `runtime.ts` `context.actorId`-as-anchor reads (T2+ de-dup) | PARTIAL |
| U8 | Within what boundary? | `primitives/scope.ts` | U16 reset reads | lifecycle turn/round machinery — disjoint; guarded | `RuleDuration`/`RuleTiming`/scheduler round counters | PARTIAL |
| U9 | What caused this? | `primitives/provenance.ts` | mutation provenance at resolve points | `attackDamageProvenance`, delivery fields, `voluntary` — disjoint; feed only | `resolution-triggers`/`damage-ledger`/movement folds reconstructing provenance | PARTIAL |
| U10 | What already happened? | `primitives/facts.ts` | fact recording, resolution-triggers projection | damage/held/save ledgers — disjoint (pre-fact); consumed by fact projection | movement/shove/rush/fly vs remove/place; save-outcome representability unproven | PARTIAL |
| U11 | What order do operations run? | `kernels/execute-flow.ts` | open-window→U13→U4 carriage | — | per-resolver hand-sequenced code | PARTIAL |
| U12 | What is armed now, resolves later? | `primitives/continuation.ts` | directed/suspended continuations on `DecisionWindowRecord` | lifecycle `delayed` phase — disjoint (executes, doesn't arm) | resolver end-of-turn effects; save-window per-source delayed logic | PARTIAL |
| U13 | Has resolution paused for a decision? | `kernels/decision-window.ts` | all window kinds through ONE record | `save-window.ts`/`gamble-window.ts` — disjoint (produce a recorded roll; cannot open/close windows) | none | **AUTHORITATIVE** |
| U14 | How does an attached rule alter a query point? | `primitives/modifiers.ts` | range/area/mastery/bonus-damage folds | `cost-payment.ts`, armed one-shot fold, aura/save boon-curse sites — disjoint; consume only | `RuleModifier` stat bag not fully typed | PARTIAL |
| U15 | Which changes validate together? | `primitives/transaction.ts` | Masquerade spatial-batch gate | per-list cost-payment, spatial per-leg legality — disjoint (feed the group, don't group) | cost-payment/spatial-swap/exact-count/sacrifice/split-pool/flow atomicity unproven | PARTIAL |
| U16 | How many uses within scope X? | `primitives/usage.ts`+`use-ledger.ts` | F9 via `oncePerRoundGate` plan (real owner, BRANDED-result proof §3–4); reducer/lifecycle resets | `attackedThisTurn` (U10 fact), scheduler clocks, Delay flags — disjoint; cannot gate uses | residual actor-level marks (`chain-reaction-used`, `incubus:triggered`, `stampede:triggered`, `gates-of-hell:vigilance-rushed`, `damage-immune`, per-source `:used`/`:charged`) | **PARTIAL** |
| U17 | Simultaneous order? | `primitives/ordering.ts` | runtime/lifecycle/decision-window/encounter ordering | scheduler turn election; `modifiers.ts` declarative ordering field — disjoint; cannot arbitrate | none | **AUTHORITATIVE** |

No consumer appears in both RETAINED SPECIALIST and UNRESOLVED DUPLICATE.
U7 reclassification (this tranche): teleport-choice origin positions are
MIGRATED (consumed via the shared captured-position anchor), `creationSpatial`
and `RuleArea.origin` are RETAINED SPECIALISTS, and the unresourced
measurement-origin derivations (aura, `runtime.ts` actorId-as-anchor) are
UNRESOLVED DUPLICATES — each in exactly one bucket (fixes the T8c table's
overlap).

## 6. Zero source promotion / census

**Zero** source units promoted. Blocker census byte-stable at **427**
unresolved. Changes are generic substrate only: `roles.ts`
(`RelationActor` + `relationSourceFor`), `targeting.ts` (source typed),
`candidate.ts`, `trait-reactions.ts` (`oncePerRoundGate` plan now BRANDED — the
private `oncePerRoundGateBrand` unique symbol makes the single producer claim
mechanically true), audit internals, tests, docs.

## 7. Verification

`npx tsc --noEmit` clean (incl. the `@ts-expect-error` structural proofs for the
two branded seams); `npm test` **122 files / 1883 passed**;
`npm run build` exit 0; `npm run audit:architecture` 115 files, 0 violations;
automation audit passes; strict source-fidelity — no integrity violations;
`audit:class-job-census` **427** (unchanged — the regenerated blocker-census
files are byte-identical); `git diff --check` clean. Full suite coverage
includes the replay/timing/encounter suites (round-ledger reset, deterministic
re-apply assert).

## 8. Gate

**UNDERLAY PHASE: OPEN** — 14 of 17 underlays remain PARTIAL per the
corrected matrix.

## 9. Next tranche (identified)

**U16 residual-marks census & migration** — LANDED (2026-08-31): each
actor-level mark (`chain-reaction-used`, `incubus:triggered`,
`stampede:triggered`, `gates-of-hell:vigilance-rushed`, `damage-immune`,
per-source `:used`/`:charged`) was classified and the genuine once-per-scope
entitlements migrated to typed U16 `ledger:*` entries (see
`docs/rules-foundations.md` §U16); U16 re-certified AUTHORITATIVE. The next
smallest underlay tranche is the U8 duration/timing/scheduler surface.

## Completion criterion

An authority function being merely called/touched is **not** routing proof;
the U2 candidate relation decision structurally requires a U2-branded
`RelationActor` and the U16 F9 gate consumes ONE U16-produced plan. The
`OncePerRoundGate` type is BRANDED with a module-private `unique symbol` that
only `oncePerRoundGate` stamps, so the "only producer" claim is NOW mechanically
true: the engine cannot accept a value as a U16 once-per-round gate result that
was not produced by U16. U2 remains AUTHORITATIVE and U16 stays PARTIAL
(residual unsold marks); had the U2 bar not been met, U2 would be PARTIAL.
Zero source units promoted.