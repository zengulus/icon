# T8b — Audit-Integrity Correction Tranche (2026-08-31)

Lead specialization: S9 (audit/verification) with S2 (architecture guards on
U2/U16 authority), S4 (replay/entitlement semantics), and S1 (source/fidelity
boundaries). This is a **corrective underlay-audit tranche only**: it lands
**zero** previously unresolved ICON source units. It does not begin the next
underlay-completion tranche.

The purpose is to repair the remaining places where the prior T8 audit claimed
semantic authority without actually proving semantic routing. It has been
audited from **fresh HEAD**, not inferred from the T8 report.

Governing invariant:

> **One semantic question must have one executing authority.** Equivalent code
> is still duplicate authority. Symbol presence, identical storage keys,
> identical output bytes, and green happy-path tests do not prove migration.

## 1. Fresh HEAD

Audited commit: **`a49b1b2`** ("Deepseek unfuck tranch", HEAD at tranche
start), after T7 (`a531f12`). All code/seam classification below verifies the
**current worktree** on top of that HEAD; the worktree itself restores no
broken claims.

## 2. Corrected U1–U17 matrix

`ABSENT | SKELETON | PARTIAL | AUTHORITATIVE`. No intermediate states.

| Underlay | Declared authority | Classification | Execution-grounded reason |
| --- | --- | --- | --- |
| U1 Reference/Binding | `primitives/reference.ts` | PARTIAL | Typed refs + LIVE/CAPTURED exist; legacy context slots (`actorId`/`attackTargetId`/`triggerSourceId`/`damageRecipientId`) remain resolution sources, so reference binding is not yet the single executing authority everywhere. |
| U2 Role/Perspective | `primitives/roles.ts` | **AUTHORITATIVE** (repaired, then re-certified) | The prior T7/T8 authority claim HID a false closure: `kernels/aura.ts` locally mapped the semantic perspective from the spatial-origin case (`perspectiveActorId: actor.id` / `entity.ownerId`) while carrying the U2 symbol. Repaired this tranche: `auraOriginRefs` now CALLS the U2 authority `auraRelationPerspectiveId` with the origin FACTS (actor→bearer, entity→creator/owner, ownerless→null fail-closed). Same for the content seam (`chanter-programs.ts` Gentleness) and `kernels/candidate.ts` (`relationPerspectiveIdFromContext`). `deriveRoles`/`resolveRoleSelector`/`windowResponderId`/`choiceEntitledPlayer` route decision-window/choice responders through U2. `matchesTargetRelation` (`targeting.ts`) is a proven-disjoint retained specialist (takes the already-derived perspective actor as `source`; never answers "relative to whom"). Guard upgraded to call-form routing (see §5); adversarial mutations CAUGHT (§6). |
| U3 Query/Candidate | `kernels/evaluate-query.ts` + `primitives/query.ts` | PARTIAL | area/persistent-instance/rule-source query domains, and ordering beyond min-distance, are un-migrated. |
| U4 Choice/Decision | `kernels/choice.ts` | PARTIAL | `ability-use-choices`/`talentChoices` folds are not (yet) validated through `resolveChoice`. |
| U5 Value/Expression | `kernels/evaluate-value.ts` | PARTIAL | inline per-resolver arithmetic; typed non-numeric values and usage reads absent. |
| U6 Predicate/Condition | `kernels/evaluate-predicate.ts` | PARTIAL | range/area gate-body folds still fold locally; the `acted-this-round` predicate reads the `attackedThisTurn` fact. |
| U7 Anchor/Spatial Frame | `primitives/anchor.ts` + `spatial-intent.ts` | PARTIAL | aura/teleport/creation origins not unified onto one `SpatialAnchor` authority (specialists without a shared-anchor parity proof). |
| U8 Scope/Clock | `primitives/scope.ts` | PARTIAL | `RuleDuration`/`RuleTiming`/lifecycle-expiry/scheduler round counters still re-key temporal boundaries separately. |
| U9 Provenance/Cause | `primitives/provenance.ts` | PARTIAL | `resolution-triggers`/`damage-ledger`/movement folds still reconstruct provenance they could read. |
| U10 Fact/Resolved Outcome | `primitives/facts.ts` | PARTIAL | Facts durable and consumed; movement/shove-rush-fly vs remove/place and save-outcome representability not yet positively proven → conservative demotion retained. |
| U11 Flow/Sequence | `kernels/execute-flow.ts` | PARTIAL | per-resolver hand-sequenced code. |
| U12 Continuation/Suspension | `primitives/continuation.ts` | PARTIAL | resolver end-of-turn deferred effects still use per-source delayed logic. |
| U13 Window/Decision Point | `kernels/decision-window.ts` | **AUTHORITATIVE** (re-audited from HEAD) | ONE `DecisionWindowRecord`; save/interrupt/choice/held/deferred/ordering all compose through it; no parallel pending-window schema owns decision semantics; held results never recomputed; responder derivation recorded/semantic; replay consumes recorded outcome. Re-attested against current HEAD. |
| U14 Modifier/Policy | `primitives/modifiers.ts` | PARTIAL | `RuleModifier` stat bag not fully folded as typed query points. |
| U15 Transaction/Atomic Commit | `primitives/transaction.ts` | PARTIAL | `transaction.ts` is a sound generic grouping/snapshot authority, but not every flow that decides "which proposed changes validate together before commit" is proven to route through it (conservative demotion retained). |
| U16 Usage/Entitlement | `primitives/usage.ts` + `kernels/use-ledger.ts` | **PARTIAL** | Single canonical-ledger authority restored (F9 `trait-reactions` repaired in T8 and re-verified here), BUT the typed-OWNER seam was fabricated: `roundLedgerKey` passed `ownerId: ''` to the typed U16 call. Repaired this tranche to pass the REAL owning actor (storage bytes unchanged). A census of residual actor-level trigger marks (`chain-reaction-used`, `incubus:triggered`, `stampede:triggered`, `gates-of-hell:vigilance-rushed`, `damage-immune`, per-source `:used`) must prove each is U10/mark de-dup or content-owned state before AUTHORITATIVE. |
| U17 Ordering/Arbitration | `primitives/ordering.ts` | **AUTHORITATIVE** (re-audited from HEAD) | All mechanically meaningful simultaneous ordering (source-order, stack/LIFO, turn-order, turn-boundary non-active-owner-first + hostile-before-beneficial, same-owner recorded ordering) routes through `primitives/ordering.ts` (`applyOrdering` / `turnBoundaryOrdering` / `sameOwnerOrderingDecision`), consumed by `runtime.ts`, `lifecycle.ts`, `decision-window.ts`, and `encounter.ts`. Registry/discovery arrays are enumeration, not game rules; cross-owner/missing-owner/same-side-different-owner ties FAIL CLOSED; incidental array order never decides. Re-attested. |

## 3. Full consumer census — every U1–U17 (no omitted bucket)

Each row: **semantic question**, **executing authority**, **MIGRATED**,
**RETAINED SPECIALIST** (+ 4-part proof), **UNRESOLVED DUPLICATE**. A consumer
that could not be confidently classified is classified `UNRESOLVED DUPLICATE`
until proven otherwise.

### U1 Reference / Binding
- **Question:** *What thing/value does a later rule clause refer to?*
- **Authority:** `primitives/reference.ts` (`Reference<D>`, `Binder`,
  `resolveReference`, `domainOf`).
- **MIGRATED:** `RuleContinuationState`/flow continuation refs through
  `continuation.ts`; `candidate.ts` anchor selector ids.
- **RETAINED SPECIALIST:** legacy context slots (`actorId`,
  `attackTargetId`, `triggerSourceId`, `triggerTargetIds`,
  `damageRecipientId`, input buckets) remain live-ref resolution sources.
  1. Q: resolve a legacy implicit ref by slot name.
  2. Disjoint: these ARE the resolution sources the new `Reference` case maps
     onto — the legacy reads are the migration surface, not a second semantics.
  3. Cannot reconstruct answers: they supply the raw identity the typed engine
     has not yet claimed.
  4. Negative: rows are flagged PARTIAL precisely because the migration is
     incomplete (this is the declared residual).
- **UNRESOLVED DUPLICATE:** none found in a substituting capacity (the legacy
  reads are understood residual, not a competing typed authority).

### U2 Role / Perspective
- **Question:** *Relative to whom is this clause interpreted (source, owner,
  controller, chooser, payer, recipient, carrier, creator, attacker,
  defender, original-user, current-origin)?*
- **Authority:** `primitives/roles.ts` (`RoleFrame`, `deriveRoles`,
  `resolveRoleSelector`, `roleFrameFromContext`, `relationPerspectiveId`,
  `windowResponderId`, `auraRelationPerspectiveId`).
- **MIGRATED:** `kernels/candidate.ts` (`relationPerspectiveIdFromContext` →
  the actor whose SIDE establishes self/ally/foe); `kernels/aura.ts`
  (`auraRelationPerspectiveId` for actor→bearer, entity→creator/owner,
  ownerless→null fail-closed); `content/jobs/programs/chanter-programs.ts`
  Gentleness stance-aura perspective (`auraRelationPerspectiveId`);
  `kernels/choice.ts` `choiceEntitledPlayer` (chooser/controller via
  `resolveRoleSelector`); `kernels/decision-window.ts` ordering chooser
  (`resolveRoleSelector` over the durable `RoleFrame`, fail closed).
- **RETAINED SPECIALIST:** `primitives/targeting.ts` `matchesTargetRelation`.
  1. Q: compare two already-derived sides under a relation token (self/ally/foe).
  2. Disjoint: it never answers "whose side is the perspective"; it takes the
     U2-derived perspective actor as `source` and compares `source.side` vs
     `target.side` — the perspective derivation lives in the caller (U2).
  3. Cannot reconstruct U2's answer: a side comparison presupposes the
     perspective; it has no rule mapping origin-kind/owner → perspective.
  4. Negative: an architecture fixture proves a locally re-derived relation
     perspective (using `context.actorId` instead of U2) fails the guard.
- **UNRESOLVED DUPLICATE:** none found in the generic layer this pass. The
  side comparisons in `decision-window.ts` (`sideRank`, `source.side ===
  target.side` in the damage-window recipes) and `turn-scheduler.ts` are U17
  turn-side facts and foe-vs-ally damage-window facts, NOT U2 perspective
  derivations — disjoint.

### U3 Query / Candidate
- **Question:** *What things currently qualify?*
- **Authority:** `kernels/evaluate-query.ts` + `primitives/query.ts`,
  `kernels/candidate.ts`.
- **MIGRATED:** `selectActors`; direct-target gate
  (`assertDirectTarget` via `validateActorCandidate`); area inclusion;
  position candidates / teleport legality; `nearestCandidates` (min-distance
  set, no invented tie).
- **RETAINED SPECIALIST:** `primitives/targeting.ts` direct-target problem
  vocabulary (relation/range/stealth/LoS seeds) — parameterized eligibility,
  fed the perspective actor.
- **UNRESOLVED DUPLICATE:** terrain/entity/area/instance query domains and
  ordering beyond min-distance not yet merged behind one Query type (declared
  residual → PARTIAL).

### U4 Choice / Decision
- **Question:** *Which member/option/value did the entitled player choose?*
- **Authority:** `kernels/choice.ts` (`resolveChoice`/`resolveChoices`,
  `choiceEntitledPlayer`).
- **MIGRATED:** actor/position/direction/option/number/boolean/ordering choice
  validation; teleport-position legality (via `teleport-choice.ts` consuming
  the same violation codes).
- **RETAINED SPECIALIST:** `kernels/teleport-choice.ts` (in-grid + unoccupied
  + Rampart-leg refinements over the shared validator).
- **UNRESOLVED DUPLICATE:** `ability-use-choices`/`talentChoices` folds not yet
  validated through `resolveChoice` (declared residual → PARTIAL).

### U5 Value / Expression
- **Question:** *What scalar does this rule evaluate to right now?*
- **Authority:** `RuleNumber` + `evaluateNumber` (`kernels/runtime.ts`).
- **MIGRATED:** `evaluateNumber` callers; query-range dynamic values;
  modifier numeric values (U14 resolution seam).
- **RETAINED SPECIALIST:** pure scalar compositions translated at the
  kernel boundary (context-dependent expressions FAIL CLOSED).
- **UNRESOLVED DUPLICATE:** inline per-resolver arithmetic and typed
  non-numeric values not yet folded (declared residual → PARTIAL).

### U6 Predicate / Condition
- **Question:** *Is this rule clause applicable now?*
- **Authority:** `RulePredicate` + `evaluatePredicate` (`kernels/evaluate-predicate.ts`).
- **MIGRATED:** `used-scope` (U16), `effect-still-exists` (U10) reads.
- **RETAINED SPECIALIST:** range/area gate-body folds that stay local.
- **UNRESOLVED DUPLICATE:** those local gate-body folds still independently
  evaluate some applicability (declared residual → PARTIAL).

### U7 Anchor / Spatial Frame
- **Question:** *From where is this spatial rule measured/attached?*
- **Authority:** `primitives/anchor.ts` + `spatial-intent.ts` (`SpatialAnchor`).
- **MIGRATED:** `candidate.ts` query range-origin; `choice.ts` position range.
- **RETAINED SPECIALIST:** `RuleArea.origin`, `teleport-choice` arbitrary-origin
  selection, creation-spatial contract (placement region vs creator LoS/range).
- **UNRESOLVED DUPLICATE:** aura/teleport/creation origins not yet unified onto
  the one `SpatialAnchor` authority (declared residual → PARTIAL).

### U8 Scope / Clock
- **Question:** *Within what temporal/usage boundary is this interpreted?*
- **Authority:** `primitives/scope.ts` (`Clock`, `BoundaryRef`, `boundaryReached`).
- **MIGRATED:** U16 reset boundary reads (`usagePeriodForResetBoundary`).
- **RETAINED SPECIALIST:** lifecycle turn/round machinery.
- **UNRESOLVED DUPLICATE:** `RuleDuration`/`RuleTiming`/lifecycle-expiry /
  scheduler round counters still re-key temporal boundaries separately
  (declared residual → PARTIAL).

### U9 Provenance / Cause
- **Question:** *What caused this outcome?*
- **Authority:** `primitives/provenance.ts`
  (`DeliverySourceKind`, `RuleDelivery`, `RuleMovementMode`, `sameCausalOrigin`,
  `provenanceOfMutation`).
- **MIGRATED:** mutation provenance derivation at resolve points.
- **RETAINED SPECIALIST:** `attackDamageProvenance`, `delivery` on damage
  mutations, `cause: TurnEndCause`, movement-entry `voluntary` flag.
- **UNRESOLVED DUPLICATE:** `resolution-triggers`/`damage-ledger`/movement
  folds still reconstruct provenance they could read (declared residual).

### U10 Fact / Resolved Outcome
- **Question:** *What authoritative thing has already happened?*
- **Authority:** `primitives/facts.ts` (`Fact` union, `recordFacts`,
  `hasResolvedAsFact`, `effectExistsLive`, U16 `trigger-resolved`).
- **MIGRATED:** fact recording + `resolutionId` riding
  `RULE_MUTATIONS_APPLIED`; `resolution-triggers.ts` projects
  byte-compatible facts.
- **RETAINED SPECIALIST:** damage/held/save ledgers (fuller fact composition
  is U12-scoped).
- **UNRESOLVED DUPLICATE:** movement vs shove/rush/fly vs remove/place and
  save-outcome representability not positively proven → PARTIAL (conservative
  demotion retained).

### U11 Flow / Sequence
- **Question:** *In what order are operations executed, and what can later
  operations observe?*
- **Authority:** `kernels/execute-flow.ts` (`executeRuleProgram`,
  `effectsToMutations`, `orderedSelectedSteps`).
- **MIGRATED:** open-window → U13 → U4 mid-flow decision carriage.
- **RETAINED SPECIALIST:** per-resolver hand-sequenced code.
- **UNRESOLVED DUPLICATE:** those per-resolver sequences (declared residual).

### U12 Continuation / Suspension
- **Question:** *What part of this rule is armed now but resolves later?*
- **Authority:** `primitives/continuation.ts` (`ArmedContinuation`,
  `heldDamageContinuation`, `heldSaveContinuation`).
- **MIGRATED:** directed/suspended continuations ride `DecisionWindowRecord`.
- **RETAINED SPECIALIST:** lifecycle `delayed` phase; deferred end-of-turn
  sites.
- **UNRESOLVED DUPLICATE:** resolver end-of-turn effects and save-window AST
  still use per-source delayed logic (declared residual).

### U13 Window / Decision Point
- **Question:** *Has ordinary resolution paused to permit/react to a decision?*
- **Authority:** `kernels/decision-window.ts` (`DecisionWindowRecord`,
  `openDecisionWindow`, `closeDecisionWindow`, `orderDecisionWindows`,
  `windowHeldDamage`/`windowHeldSave`, `openOrderingDecisionWindow`,
  `openTurnBoundaryOrderingWindow`, `decideDamageWindow`).
- **MIGRATED:** when-damaged / defeated / save-rolled / uses-ability /
  area-inclusion / targeted-by-ability / choice windows all open through the
  ONE record; `trigger-window.ts` and `pendingInterrupts`
  migrated/deleted; holder responder derivation semantic/recorded; held
  results never recomputed; replay consumes recorded outcome.
- **RETAINED SPECIALIST:** `save-window.ts` (rolling a save) and
  `gamble-window.ts` (recorded dice) — distinct domain primitives, NOT
  windows (disjoint question: produce a roll vs pause for a decision).
- **UNRESOLVED DUPLICATE:** none found in current HEAD; no second schema owns
  pending-decision semantics. Retained AUTHORITATIVE.

### U14 Modifier / Policy
- **Question:** *How does an attached rule alter a typed query point?*
- **Authority:** `primitives/modifiers.ts` (recipe shape, gate evaluator,
  typed permission query points).
- **MIGRATED:** range/area/mastery/bonus-damage permission and numeric folds.
- **RETAINED SPECIALIST:** `cost-payment.ts` (function-shaped cost-list
  rewriting), `attack-modifiers.ts` armed one-shot fold, scaled/recipient
  bonus-damage function rows, aura/save-window boon-curse consumption sites,
  damage-exception mutation fields.
- **UNRESOLVED DUPLICATE:** the `RuleModifier` stat bag not yet fully folded as
  typed query points (declared residual → PARTIAL).

### U15 Transaction / Atomic Commit
- **Question:** *Which proposed state changes must validate together before any
  commit?*
- **Authority:** `primitives/transaction.ts` (`TransactionSpec`,
  `validateTransaction`, `proposeAtomicGroup`).
- **MIGRATED:** the Masquerade spatial-batch command gate (simultaneous mode).
- **RETAINED SPECIALIST:** per-list `cost-payment`, spatial gateway per-leg
  legality stays in the spatial domain.
- **UNRESOLVED DUPLICATE:** cost/payment, spatial batches/swaps, exact-count
  creation, sacrifice+payoff, split-pool, grouped movement/flow — not each
  PROVEN to route through the single grouping/snapshot/atomicity authority →
  PARTIAL (conservative demotion retained).

### U16 Usage / Entitlement Ledger
- **Question:** *How many times has/may this rule be used/triggered within
  scope X?*
- **Authority:** `primitives/usage.ts` + `kernels/use-ledger.ts`
  (`usageKey`, `ledgerAvailable`, `consumeUsageMutation`,
  `usagePeriodForResetBoundary`, `usageIdentity*`).
- **MIGRATED:** F9 `kernels/trait-reactions.ts` once-per-round gate
  (`roundLedgerKey`/`roundLedgerAvailable`/consume through the U16 core, with
  the REAL owning actor this tranche); the reducer/lifecycle reset recipes read
  through `use-ledger.ts` / U8.
- **RETAINED SPECIALIST:** `attackedThisTurn` (U10 historical resolution fact,
  NOT the one-attack entitlement); scheduler/clock fields (`turnTaken`,
  `turnsTakenThisRound`); Delay flags (`slow-turn`, `six-hells:slow-turn`).
- **UNRESOLVED DUPLICATE candidates (keeps U16 PARTIAL):** actor-level
  once-per-round/turn trigger/de-dup marks —
  `chain-reaction-used`, `incubus:triggered`, `stampede:triggered`,
  `gates-of-hell:vigilance-rushed`, `damage-immune`, and per-source
  `:used`/`:charged` flags. Each must be classified U10 fact-backed de-dup or
  content-owned state before U16 re-certification. They do not rebuild the
  `ledger:*` key, so they are not the worst class, but they are not proven
  disjoint.

### U17 Ordering / Arbitration
- **Question:** *When multiple operations are simultaneously eligible, what
  determines their order?*
- **Authority:** `primitives/ordering.ts` (`OrderingPolicy`,
  `applyOrdering`, `turnBoundaryOrdering`, `sameOwnerOrderingDecision`,
  `policyYieldsChoice`).
- **MIGRATED:** `runtime.ts` step ordering; `lifecycle.ts` turn-boundary
  ordering; `decision-window.ts` interrupt LIFO + total order; `encounter.ts`
  turn-boundary ordering + deferred ordering windows; recorded same-owner
  ordering consumed from durable `resolvedOrder` ranks (never array/registration
  order).
- **RETAINED SPECIALIST:** the scheduler's turn election/turn sequence (the
  recorded turn order the turn-order policy reads — a distinct, written
  authority); `modifiers.ts` explicit `ordering` fold field (declarative
  projection order, a written specialist, not a game rule).
- **UNRESOLVED DUPLICATE:** none found in current HEAD. Incidental registration
  / listing / array order never mechanically decides; cross-owner /
  missing-owner / same-side-different-owner ties FAIL CLOSED. Retained
  AUTHORITATIVE.

## 4. U2 result

**T8's U2 AUTHORITATIVE claim did NOT survive untrammelled; it hid a false
closure that this tranche repaired, then genuinely re-certified.**

The found competing implementation was **`kernels/aura.ts`**: it produced an
`AuraOriginRef` carrying `perspectiveActorId` but locally decided that value
from the spatial-origin case — actor-origin → `actor.id`, entity-origin →
`entity.ownerId` — while importing/carrying the U2 symbol so the symbol-presence
guard could not detect the bypass. That is exactly the "calling the local result
by the canonical name does not make it a U2 consumer" case.

**Repair.** The semantic rule (actor aura → bearer perspective; entity aura →
creator/owner perspective; ownerless entity → no ally/foe perspective) was moved
behind a NEW U2 authority `auraRelationPerspectiveId(origin)` in
`primitives/roles.ts`. `auraOriginRefs` now supplies only the origin FACTS
(`{ kind: 'actor', bearerId }` / `{ kind: 'entity', creatorOrOwnerId }`) and
CALLS the U2 authority. The same content seam (`chanter-programs.ts` Gentleness
stance-aura origin) and `candidate.ts` were verified to route through U2.

**Concrete semantic call path (current HEAD):**
```
auraOriginRefs(state, def)
  → auraRelationPerspectiveId({ kind:'actor', bearerId: actor.id })       [roles.ts U2]
    / auraRelationPerspectiveId({ kind:'entity', creatorOrOwnerId: entity.ownerId })
  → perspectiveActorId  (null ⇒ only `characters` relations; no manufactured side)
  → isAuraMember:  actor.side === state.actors[perspectiveActorId].side

candidate.actingActor(context)
  → relationPerspectiveIdFromContext(context) = relationPerspectiveId(roleFrameFromContext(context))
  → context.state.actors[perspectiveId].side   [roles.ts U2]

decision-window openOrdering*/choiceEntitledPlayer
  → resolveRoleSelector(chooser, deriveRoles(frame))                       [roles.ts U2]
```
ROLE ≠ ANCHOR preserved: `AuraOriginRef.actorId`/`entityId` remain the spatial
origin; `perspectiveActorId` is the semantic role. Rebound distinctions
(original-user ≠ current-origin; creator ≠ owner ≠ carrier ≠ spatial anchor ≠
affected member) remain representable.

## 5. U16 result

**Real owner identity, byte-compatible storage, F9 routes through U16.**

- **Real owner carried through the typed U16 call.** `roundLedgerKey(ownerId,
  sourceId)` now calls `usageKey({ sourceId, ownerId, scope: 'round' })` with
  the REAL owning actor (`actor.id` at the F9 fold site), never a fabricated
  `''`. The T8 seam that passed `ownerId: ''` is gone — typed semantic identity
  no longer fabricates an empty owner.
- **Actor-local physical storage remains compatible.** `usageKey` still emits
  `ledger:round:<sourceId>` (owner bytes intentionally omitted because durable
  state lives on the owner), so the shared gate, the reset lifecycle recipe,
  and the checkpoint format are byte-identical. Two owners of the SAME trait
  reaction never alias a shared key because the durable state is actor-local;
  the typed identity distinguishes them (two-owner isolation test).
- **F9 availability/consume/key all route through U16.** `roundLedgerKey` →
  `usageKey`; `roundLedgerAvailable` → `ledgerAvailable`; the consume mark →
  `consumeUsageMutation` (one-shot `set true`). No raw `ruleState[key]` read,
  no hand-rolled mark, no local key reconstruction.

## 6. Guard mutation results

For each adversarial mutation, `CAUGHT | NOT CAUGHT`. The guards were upgraded
so that **symbol presence is not authority evidence** — they now require the
canonical symbol to be genuinely CALLED (call-form routing), and forbid the
local re-derivation patterns directly.

| # | Mutation | Guard | Result |
| --- | --- | --- | --- |
| M1 | U2 (aura): keep every U2 symbol AND `auraRelationPerspectiveId` call, but reintroduce `perspectiveActorId: actor.id` / `perspectiveActorId: entity.ownerId` local derivation | `u2-perspective-authority` (`AURA_LOCAL_PERSPECTIVE_RESTORE_RE`) | **CAUGHT** |
| M2 | U2 (aura): keep symbols, reintroduce `origin.side` / `.side ?? null` anchor-derived relation | `u2-perspective-authority` (`AURA_ANCHOR_SIDE_RESTORE_RE`) | **CAUGHT** |
| M3 | U2 (candidate): keep `relationPerspectiveIdFromContext` imported but use `context.actorId` for the relation read | `u2-perspective-authority` (symbol must be CALLED) | **CAUGHT** |
| M4 | U16 F9 availability: keep all U16 imports but gate on `!actor.ruleState[key]` | `u16-usage-ledger-routing` (Check 8, symbol must be CALLED) | **CAUGHT** |
| M5 | U16 F9 consume: keep all U16 imports but emit the state mark by hand | Check 8 (consume must be CALLED) | **CAUGHT** |
| M6 | U16 F9 key: keep all U16 imports but rebuild the key by string concatenation / alternate spelling | Check 7 (`U16_LEDGER_KEY_RECONSTRUCTION_RE`) + Check 8 | **CAUGHT** |
| M7 | A non-authority file reconstructs `` `ledger:${scope}:${sourceId}` `` | Check 7 | **CAUGHT** |

Every relevant mutation is **CAUGHT**; no gotcha depends on symbol presence or
pattern-matching one historical spelling.

## 7. Tests / verification (exact results)

- **Typecheck:** `npx tsc --noEmit` → clean.
- **Full suite:** `npm test` → **122 files, 1859 tests passed**.
- **Fidelity audit:** `src/rules/__tests__/fidelity-audit.test.ts` → 41 passed.
  (Repaired pre-existing T8 integrity failures by allowlisting the T8/T8b
  changelog-prose strong tokens in `src/rules/fidelity/claims.ts`, matching the
  established T6.3/T7 convention.)
- **Architecture audit:** `npm run audit:architecture` → 115 files checked,
  **zero violations**; `architecture-audit.test.ts` → **42 passed** (incl. the
  M1–M7 adversarial fixtures).
- **Automation audit:** `npm run audit:automation` → exit 0.
- **Source fidelity strict:** `npm run audit:source-fidelity -- --strict` →
  no integrity violations.
- **Outcome/trigger audit:** `npm run audit:outcome-triggers` → exit 0.
- **Source artifacts:** `npm run verify:source-artifacts` → structurally valid,
  pinned PDF present.
- **Replay / usage / role suites:** `t7-u2-role-consumers`,
  `trait-reactions`, `t6-4-usage-global-ledger`, `t3-usage`, `use-ledger` → all
  pass (69 tests together).
- **Blocker census:** `npm run audit:class-job-census` → **byte-stable at 427
  unresolved**, diff clean on `docs/blocker-census*`.
- **Build:** `npm run build` → exit 0.
- **`git diff --check`** → clean.

## 8. Source census

**Zero** previously unresolved ICON source units were promoted, newly wired, or
reclassified in this tranche. `docs/blocker-census.json` remained byte-stable at
**427** unresolved. Only generic substrate changed (roles.ts U2 authority +
aura/chanter routing, trait-reactions owner seam, architecture guards, tests,
fidelity allowlist).

## 9. Gate state

**UNDERLAY PHASE: OPEN.**

OPEN is a direct consequence of the corrected matrix — multiple U1–U17
contracts remain PARTIAL (U1, U3, U4, U5, U6, U7, U8, U9, U10, U11, U12, U14,
U15, U16). AUTHORITATIVE rows are U2, U13, U17. It is not inferred from the
test count.

## 10. Next tranche (named from repaired evidence, NOT started)

The smallest coherent next completion, in dependency order over the corrected
matrix:

**U16 — finish the usage/entitlement closure.** (a) Complete the census of the
remaining actor-level once-per-round/turn trigger/de-dup marks
(`chain-reaction-used`, `incubus:triggered`, `stampede:triggered`,
`gates-of-hell:vigilance-rushed`, `damage-immune`, per-source `:used`/`:charged`)
— classify each as U10 fact-backed de-dup (retained, documented) or migrate to a
typed U16 `ledger:*` entry, carrying the real owning actor through the typed
identity; (b) if a mark is genuinely usage entitlement, migrate it and extend
the F9 guard/tests to cover the new consumer; (c) re-audit that U16 has zero
unresolved duplicates before attempting AUTHORITATIVE.

Do NOT begin it in this tranche. Alternatives with equal standing (do not run
together): U10 fact-vocabulary completeness for movement/save distinctions, or
U15 proving every atomic-group route goes through `transaction.ts`.

---

*This document is current-state and intentionally does not claim closure. The
goal was not to restore the number of closed underlays; it was to ensure that
where the audit says one authority, the implementation actually has one.*