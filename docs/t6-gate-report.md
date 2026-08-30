# T6 — Underlay Phase gate report (2026-08-31)

Baseline `f5830da` (landed T5c.1). Corrective/non-promotion tranche. **No
source unit was promoted**; the blocker census regenerates byte-stable.

## A. Pre-patch gate matrix (U1–U17)

Verified against actual HEAD code (module existence, consumer/routing
searches, duplicate reads), not the prior prose. Owning authority module
listed per underlay.

| U | Declared authority (HEAD) | Contract status | Duplicate/partial owners | Remaining consumers | Required T6 action |
| --- | --- | --- | --- | --- | --- |
| U1 Reference/Binding | `primitives/reference.ts` | TRUE | legacy context slots remain input/transport surfaces (documented) | refs carried by continuations/windows/choices | none blocking |
| U2 Role | `primitives/roles.ts` | TRUE | aura/targeting reads are specialists; no string/`source==owner` shortcuts found | chooser/controller carriage | none blocking |
| U3 Query/Candidate | `kernels/candidate.ts` + `evaluate-query.ts` (+ `primitives/query.ts` domain) | PARTIAL | teleport/placement/entity/spatial specialists documented; `freeCellNear` noted | per-domain gates | continue narrowing documented specialists |
| U4 Choice | `kernels/choice.ts` | PARTIAL | `ability-use-choices.ts` (closed trait-table spends) not routed through `resolveChoice`; U11 `choose` node unbuilt | `ability-use-choices`, talent folds, window choices | migrate `ability-use-choices` reads to `resolveChoice` OR prove specialist parity; build `choose` only if the U11 contract requires it |
| U5 Value | `kernels/evaluate-value.ts` | TRUE | inline resolver arithmetic retained per §2 rule | — | document any retained specialist boundary |
| U6 Predicate | `kernels/evaluate-predicate.ts` | TRUE | range/area gate bodies fold through predicate algebra (staged) | range/area gates | finish gate-body fold migration (staged) |
| U7 Anchor | `primitives/anchor.ts` (+ role/ref separation) | TRUE | aura/teleport/creation origins are specialists | — | none blocking |
| U8 Scope/Clock | `primitives/scope.ts` | TRUE | `RuleDuration` is a serialization surface projected onto U8 (documented) | durations/marks/expiry | none blocking |
| U9 Provenance | `primitives/provenance.ts` | PARTIAL | resolution/replay reconstruction noted | damage-ledger, triggers, movement provenance | continue recording rather than reconstructing (staged) |
| U10 Fact | `primitives/facts.ts` | TRUE | `executedStepIds`/`derivedTriggers` are flow bookkeeping only | reactive fold consumes recorded facts | none blocking |
| U11 Flow/Sequence | `kernels/execute-flow.ts` | **PARTIAL — doc now corrected** | per-resolver hand-sequenced code (documented specialists); `choose` node unbuilt | resolvers | do NOT build a second decision system; `choose` only if contract requires it (it routes through U13 now) |
| U12 Continuation | `primitives/continuation.ts` + `continuation-runtime.ts` | TRUE | T5c.1 closed the held-result trigger seam | legacy `RuleContinuationState` is bookkeeping | none blocking |
| U13 Window | `kernels/decision-window.ts` | TRUE | `DamageWindowLedger.window` is replay handoff provenance; `EncounterPendingInterrupt` is a compat alias; all open/answer/close/drain central | — | none blocking |
| U14 Modifier/Policy | `primitives/modifiers.ts` | PARTIAL | `RuleModifier` stat bag (effect-instance projection, not a fold) + listed registries | `RuleModifier`→typed query points | classify/parity-prove the effect-instance boundary (staged) |
| U15 Transaction | `primitives/transaction.ts` | TRUE | `spatialBatchId`/`requiresLegalSpatialBatch`/`creationSpatial` route through shared seams | — | none blocking |
| U16 Usage/Entitlement | `primitives/usage.ts` + `use-ledger.ts` | **PARTIAL — typed-ledger migration incomplete** | raw `interruptUses`/`interruptUsedThisTurn`/`attackedThisTurn`/`slashedTriggeredThisTurn`/`dangerousTerrainTriggeredThisTurn` durable fields | interrupt/attack/terrain gates | migrate genuine usage-restriction reads onto the U16 ledger (next tranche) |
| U17 Ordering | `primitives/ordering.ts` + `continuationOrderKey` + `orderDecisionWindows` | TRUE | T5c.1 removed invented tie-breaks and same-instant fail-closed | same-owner simultaneous decision seam | route same-owner ordering decision through U4 (recorded) |

**Doc-vs-code discrepancy found and fixed:** the U11 row's Current-state
`FlowNode` vocabulary parenthetical still claimed `open-window`/`suspend`
were "NOT landed yet"; T5c landed both (the `FlowNode` union contains them).
Corrected to "only the `choose` node remains unbuilt."

## C. U18 / U19 decision (evidence-based)

- **U18 Attachment/Contribution — NOT PROMOTED.** After T5c.1, every named
  contribution kind resolves onto an existing underlay: U14 one-recipe-shape
  `ModifierRule` (six registries fold through it), U11 flow steps/action
  grants, U13 windows / U11 suspend, U12 continuations, U4 choices, U3
  queries. The only novel facet (an attachment/equipment registry + U2-owner
  predicate) is content-registration glue, not new algebra. `mastery-fold.ts`
  still reads the shared `ModifierRule` registry. Full decision recorded in
  `docs/underlay-completion-plan.md` §2.
- **U19 Intent — NOT PROMOTED.** Command-boundary candidate/save/entity/
  placement legality and reducer replay-safe state application have different
  responsibilities; no same-typed-intent is validated by two drifting
  implementations. The typed intents (`SpatialIntent`, `creationSpatial`,
  `SaveWindowSpec`) are the domain authorities' validation contracts, not a
  missing wrapper layer. Full decision recorded in §2.

## D. Acceptance/replay mapping (spot, representative)

The named acceptance obligations in each §1 row map to real tranche suites:
`t5a-u11-flow.test.ts` (U11 intermediate-state/repeat/invoke/bind/replay),
`t5b-u12-continuation.test.ts` (U12 deferred/held/LIVE-CAPTURED/replay),
`t5c-u13-decision-window.test.ts` (U13 held-result/replay/identity/order),
`t5c1-adversarial-audit.test.ts` (the 17 demanded composed regressions),
plus foundation suites (`choice.test.ts`, `modifiers.test.ts`,
`usage.test.ts`, `ordering.test.ts`, `facts.test.ts`). **Only one §1 row**
(U16 interrupt-uses/attacked-this-turn) names migration obligations whose
completion is still pending — see E.

## E. Duplicate-authority closure report

| Location | Final state |
| --- | --- |
| `kernels/trigger-window.ts` | removed (registry moved into `decision-window.ts`) |
| `EncounterPendingInterrupt` / `pendingInterrupts` | removed; compat alias + migration only |
| per-window `heldDamage`/`heldSave`/`heldResult` | removed; carried as U12 `heldPayload` |
| `DamageWindowLedger.window` | retained handoff provenance (opens via `openDamageWindowFromLedger`, never independently answers) |
| `RuleContinuationState` (`executedStepIds`/`derivedTriggers`) | documented flow bookkeeping, not a fact substitute |
| `kernels/runtime.ts` | compatibility barrel; `effectsToMutations` moved to `execute-flow.ts` |
| `interrupt-uses` / `attacked-this-turn` / `slashed` / `dangerous-terrain` flags | **UNRESOLVED duplicate usage-restriction surface (U16) — reopened** |
| `ability-use-choices.ts` | retained specialist (closed trait tables); boundary documented but not U4-routed — parity not proven to the strict bar |
| `kernels/mastery-fold.ts` | thin adapter over shared `ModifierRule` registry |
| per-resolver hand-sequenced code | retained specialists with written boundaries (generic sequencing authority is U11) |

## G. Hard-gate criteria verdict

| # | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| 5 | Full required suite green | **PASS** | typecheck, 1731 tests, build, verify:source-artifacts, audit:architecture (0), audit:automation, audit:source-fidelity --strict, audit:outcome-triggers — all green |
| 6 | U18/U19 decided | **PASS** | both decided from code evidence; neither promoted (§2) |
| 7 | Generated docs regenerated (byte-stable) | **PASS** | `audit:class-job-census` regenerated; blocker-census.json/md byte-stable; no source promotion |
| 1 | U1–U17 source-backed contracts current and true | **OPEN** | rows are honest; U11 drift corrected, but U16 raw usage flags + U14 `RuleModifier` + U4 `ability-use-choices` + U11 `choose` are still PARTIAL with pending migration items |
| 2 | One clearly owned semantic authority each | **FAIL (U16)** | `interrupt-uses` / `attacked-this-turn` are a raw durable usage-restriction surface overlapping U16's declared scope; not migrated and not proven-parity |
| 3 | Required acceptance tests exist and pass | **PASS** | named obligations map to real tranche + foundation suites |
| 4 | No known duplicate competing authority | **FAIL** | the U16 typed-ledger migration is pending; `ability-use-choices`/`RuleModifier`/per-resolver boundaries are documented but not all proven to the four-part specialist-parity bar |

## Verdict

**UNDERLAY PHASE COMPLETE: NOT DECLARED. The gate remains OPEN.**

Failed criteria: **§4.2 / §4.4** — primarily U16's typed-ledger migration of
`interrupt-uses` / `interruptUsedThisTurn` / `attacked-this-turn` (and the
once-per-turn reaction flags) is incomplete, leaving a raw usage-restriction
surface beside the `primitives/usage.ts` authority; alongside the
`RuleModifier` → typed-query-point and `ability-use-choices` → U4-validation
rolls, several documented retained specialists have not been parity-proven
to the strict four-part standard.

**Smallest next corrective tranche (T6.1):**
1. Migrate the genuine usage-restriction reads (`interrupt-uses`,
   `interruptUsedThisTurn`, `attacked-this-turn`, per-turn reaction flags)
   onto the U16 ledger with schema-visible migration + replay tests, or
   reclassify each as scheduler/domain or de-dup state with a written
   boundary and parity proof.
2. Route `ability-use-choices.ts` reads through `resolveChoice` (or prove
   the closed-table boundary with a parity test).
3. Classify/parity-prove the `RuleModifier` effect-instance boundary, and
   finish the U6 range/area gate-body fold migration.
4. Decide the U11 `choose` node: the U13 route already carries U4 decisions,
   so confirm whether a distinct `choose` node is actually required or the
   contract should name `open-window` as the sole decision carriage.

No source promotion accompanies or precedes this gate; promotion is delayed
until the gate closes.