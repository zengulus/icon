# U4 ↔ U13 recorded-choice contract

S2 substrate / S4 runtime migration; U4 remains PARTIAL overall.

`RuleChoiceAnswer` in `automation/primitives/types.ts` is the single durable
answer union. `RuleChoice.kind` derives from its discriminant. Actors and
ordering retain every ID, positions retain every coordinate, directions retain
the vector, and scalar answers retain their primitive value. Empty lists and
null scalar/vector payloads represent optional absence. False, zero, and empty
string are explicit supplied values, subject to the declared constraints.

`resolveChoice` remains the U4 validation authority for command buckets and
`ANSWER_DECISION_WINDOW` input. `resolveChoiceAnswer` projects tagged answers
onto that same validator through `choiceAnswerInput` — the ONE answer→bucket
adaptation path, which neither call site re-derives; a truncated answer
(missing payload, non-array list) rejects at the projection instead of
reaching U4, where a missing bucket would misread truncation as optional
absence. U4 rejects malformed values even on in-process calls;
actor/position legality still belongs to U3. No new source branches or
candidate selection authority were introduced.

The command timeline is input → U4 validation → complete answer → then-current
flow/continuation planning → `DECISION_ANSWERED` with answer and mutations →
replay of recorded mutations. Ordering retains its existing recorded-permutation
replay checks. Resumed flows restore each answer to its correct input bucket,
clearing the answered key first so optional absence cannot use ambient input.
Held continuations receive `choiceAnswer` on a local copy. The dispatcher
owns ONLY genuine optional absence — a declined answer skips the resolver
and records no consequence. Every explicit answer, including boolean false,
reaches the row's resolver: consequence semantics for a supplied value
belong to the content row, never to generic U13 dispatch. Failed validation
leaves the window open.

Great Giorgios (ICON 1.5 p.124, “may rush 4”; optionality p.107) runs on the
recorded boolean in its existing decision resolver: the affirmative resolves
the rush, and the explicit decline (false) is the row-owned no branch that
resolves nothing — the dispatcher never interprets the value. Spite's existing
closest-foe continuation consumes the actor-list answer instead of the old first-ID
scalar. Their movement, damage, timing, and candidate semantics are unchanged.

The seam also owns UNIT ALLOCATIONS, the one composite the plain actor/option/position lists could not express: `resolveCapturedUnitAllocation` reads a recorded list where each entry is ONE unit rather than an identity, so a repeated entry means a second unit from the same supplier (`["a","a","b"]` = two units from `a`, one from `b`). The caller declares the U3 supplier domain and each supplier's capacity; U4 owns presence, the total-unit bounds, supplier membership, and per-supplier capacity, and never picks a supplier or tops the remainder up. Symphony (ICON 1.5 p.178, "Remove up to four blessings from characters anywhere") is the production consumer: the recorded allocation is the spend, and the mote count is its total (plus two on Charge) — an absent allocation is the explicit zero-unit decision, not an automatic spend.

Compatibility: existing command/protocol input buckets are unchanged.
`ChosenValue` is an alias of the complete
answer type, with no separate semantics. Newly emitted decision events use the
tagged answer; historical scalar event shapes are not newly authored. Normal
non-ordering replay consumes recorded mutations without interpreting those old
values. Historical untagged ordering arrays are decoded to the canonical answer
before the same recorded-permutation check. Checkpoints remain current-state projections, not event archives.

Evidence: `recorded-choice-seam.test.ts` covers all seven kinds, full lists,
position/direction values, optional absence, invalid candidates and malformed
inputs with command/window error parity, truncated tagged answers rejecting
at the projection, held continuation carriage (explicit
boolean false reaches the resolver; optional absence skips it), ambient-input
clearing, JSON round trips, exact replay, and duplicate-answer rejection. Existing
Great Giorgios, Spite, flow, and ordering regressions retain production coverage.

Census reconciliation: the generic window-carried answer gap and Symphony's
blessing payer/quantity gap are closed. The canonical Class/Job blocker census
was regenerated with no artifact or executable membership delta. Dervish actor
selection/initial flight, ordinary summon placement, Underway portal 2, Demon
Claw Talent I/II, the `rushTowardFoes` direction fallbacks, and authoring folds
remain unresolved; this change does not promote source units or close phase gates.

Verification: architecture and automation audits, strict source fidelity, canonical
Class/Job census regeneration, typecheck, the vitest suite, client/server build,
transport E2E, and `git diff --check` passed.
