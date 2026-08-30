# T5c.1 — Adversarial integrated audit of T5a–T5c (2026-08-31)

Corrective, not expansive. Lead: S4 (Encounter Runtime & Replay), with S2
(substrate) and S9 (verification) as secondary. No source-unit promotion, no
unresolved-unit wiring, no census change.

## Confirmed defects (fixed in patch B)

| Severity | Invariant | Source / code evidence | Actual behavior (before) | Required behavior | Correction |
| --- | --- | --- | --- | --- | --- |
| High | U12 trigger identity must mean the exact causal trigger (H1) | p.107; `primitives/continuation.ts` | Held results used a coarse kind-only `fact` trigger (`save-resolved` / `damage-applied`). They could never fire, but claimed coarse fact semantics — a silent kind-only cross-fire hazard and a false contract. | A held result is gated by the exact U13 window that carries it; a coarse same-kind fact can never satisfy it. | New `ContinuationTrigger` `{ kind: 'window'; windowId }`. `continuationDue` returns `false` for it at every boundary; held results are drained only by the U13 window machinery. Migrated held payloads are re-gated onto their owning window id. |
| High | HELD RESULT vs DEFERRED RULE boundary (H2) | p.128 Righteous Disdain (owner ≠ damaged ally); p.143 Sucker Punch | RD `when-damaged` window opened for the TARGET (owner == recipient). `EncounterHeldDamage` carried no `targetId`. | The when-damaged owner is DISTINCT from the damaged ally within Range 2; the held blow applies to the damaged ally, never the owner, against the owner-independent determined amount. | `whenDamagedInterruptOwner` answers for an ALLY in Range 2; held payload and `EncounterHeldDamage` carry `targetId`; drain/apply use the payload's target. Owner's armor/vigor/resistance never re-mitigate the held amount. |
| High | Choice/default leakage at `ANSWER_DECISION_WINDOW` (H3) | p.107 `can`/`may`; U4 `choice.ts` | `decisionValueFor` read raw buckets: omitted required boolean → `false`, number → `0`, option/actor/position/direction → `''`; option membership/numeric bounds/actor/direction legality unvalidated; a non-boolean `'maybe'` counted as accept. | A missing REQUIRED answer rejects; explicit `false` records a legal decline; option membership, numeric/actor/position/direction validity enforced through the shared choice authority. | `ANSWER_DECISION_WINDOW` routes the window's `RuleChoice` through `resolveChoice` (the U4 kernel: required-missing rejects, candidate legality via U3/U7); the recorded value is projected from the VALIDATED `ChosenValue`. `resolveBoolean` now rejects non-boolean input. |
| High | One semantic ordering authority, no invented deterministic tie-breaks (H4) | p.107; U17 | `orderDecisionWindows` sorted same-instant ties by `kind` lexicographically and by registration `order` — presented as a game rule. `resumeDueContinuations` resumed `state.continuations` in raw iteration order. | Different trigger kinds at the same instant have NO source-defined total order; same-owner ambiguity is a recorded decision; resume order follows the U17 ordering identity, never array order. | Removed the lexicographic kind sort and the registration-`order` fallback. `orderDecisionWindows` and `popDecisionWindowStack` FAIL CLOSED on same-instant same-side/​​same-owner ties. `resumeDueContinuations` sorts due continuations by `continuationOrderKey` (U17). |
| High | Durable window identity (H6) | `decision-window.ts` | Window ids derived from `decisionWindows.length` — closing a window permits length reuse, so a later window could reuse a closed window's id within a revision; replay could collide. | A closed window's id is never reused; ids are unique for the encounter lifetime. | `nextWindowId` mints ids from a per-encounter monotonic `windowSerial` (`EncounterState.windowSerial`, schema 10, migrated, validated in the VTT snapshot). Replay advances it exactly like every recorded reduction. |
| High | U11 suspension/resume resumes the exact unexecuted computation (H8) | `execute-flow.ts` `FlowPlanner.suspendAt` | Suspension captured only the innermost list tail; a partial `repeat`/`for-each` lost the unexecuted iterations/items. | Suspension inside a partially consumed loop resumes every remaining iteration/item exactly once, each re-bound. | `FlowPlanner` walk stack now frames `list` / `repeat` / `for-each`; `suspendAt` composes the remaining execution as existing `sequence`/`bind` nodes (no new vocabulary). |
| Medium | RD held damage replays a final per-recipient applied amount, not owner-mitigated (H2/H9) | p.128 | Held damage applied to `window.actorId` (owner) on drain; an interrupt's incidental explicitly-zero no-op to the target wrongly suppressed the held blow. | The held determined amount applies to the damaged target after the interrupt against then-current state; only real re-dealt damage to the held target consumes it. | `resolveHeldInterruptWindows` and the interrupt `applyEvents` path apply to `heldDamage.targetId`; an explicit no-op (`determined.amount === 0`) does not count as re-dealing the blow. |

## Hypotheses disproved (no defect)

| Hypothesis | Result |
| --- | --- |
| A second quasi-window authority survived T5c (cat. 5 competitor) | **Disproved.** `trigger-window.ts` deleted; `EncounterPendingInterrupt` is a compatibility alias only; `pendingInterrupts` / per-window `heldDamage`/`heldSave`/`heldResult` fields are gone; `DamageWindowLedger.window` is replay handoff metadata (`openDamageWindowFromLedger` re-derives the responding owner deterministically) — it never independently answers a window. |
| Window `targetId` should be the window owner | **Disproved by p.128.** The owner answers for an ally's blow; the held datum is the damaged character's determined amount. |
| Replay needed fresh RNG on `applyEvents` | **Disproved.** `applyEvents` accepts no dice; every roll/decision is recorded on the event. The H9 end-to-end replay proves the full stream reproduces the command-built state with zero fresh RNG/choice. |

## Fidelity/claims reconciliation

The roadmap T5c paragraph's claim that held results "never auto-fire" was
TRUE but underspecified — it was delivered via the U13 boundary not firing
coarse facts, not via an explicit trigger. The implementation now makes the
causal identity explicit (a `window` trigger), so the claim is true at the
record level, not just by the boundary's restraint.

The underlay-completion-plan U12 "Documented boundaries" text described the
held-result fact-trigger seam; it is updated to the exact owning-window
trigger. No claims in these docs were stronger than the pre-patch
implementation in a way that required a behavioral change beyond the tables
above.

## Intentionally deferred (outside T5c.1)

- **Legacy migrated RD held-damage windows** re-derive `targetId = actorId`
  (owner == recipient) because the schema-9 held-damage record carried no
  target. A real legacy owner-distinct checkpoint cannot be reconstructed
  losslessly; this is a migration-data limitation, not a runtime authority.
- **Multiple eligible when-damaged owners** for one blow remain
  adjudication-needed (the single deterministic owner is chosen in durable
  registration order; a recorded owner-ordering decision is a U4 addition).
- The pending-durable-identity work for T6 (a typed persistence identifier
  for continuations/windows) is not started here.