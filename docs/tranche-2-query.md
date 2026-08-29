# Tranche 2 — the QUERY/CANDIDATE underlay (landed 2026-08-29)

Second tranche of the underlay collapse plan in
[`generic-underlays.md`](generic-underlays.md). Goal: one generic
candidate-legality/query authority beneath both automatic targeting and the
landed U4 CHOOSE kernel, so "who is a legal target" is answered ONCE.

## What landed

### 1. One candidate authority — `src/rules/automation/kernels/candidate.ts`

- `evaluateActorCandidates(query, context)` returns the CandidateSet: every
  actor satisfying relation (p.92), defeated, on-battlefield, and optional
  dynamic-range constraints.
- `validateActorCandidate(actorId, query, context)` validates one id against
  the same rules and returns a structured `{legal, violation}` whose codes
  are the EXISTING legacy codes (`choice.actor-missing`,
  `choice.actor-defeated`, `choice.actor-relation`, `choice.actor-range`,
  `choice.actor-unavailable`) — the command boundary reads identically to
  before.
- Composition, not reimplementation: the kernel reuses
  `matchesTargetRelation` (primitives/targeting.ts), the canonical p.92
  `footprintDistance` (primitives/spatial-intent.ts), and `evaluateNumber`
  for dynamic range values. No source IDs anywhere. `rangeOrigin` is a
  `RuleSelector` seam for the future U7 anchor work (defaults to the acting
  actor today).

### 2. `kernels/choice.ts` consumes the CandidateSet

`resolveActors` no longer inlines relation/range checks (that was a second,
drifting copy of targeting eligibility). Each supplied id is validated
through `validateActorCandidate`; the choice kernel keeps ONLY choice
semantics: required/optional, cardinality, distinctness. All 23 pre-existing
`choice.test.ts` assertions pass unmodified — CHOOSE behavior is unchanged:
required missing still rejects before costs/RNG/mutations, optional missing
still declines (never defaults), chooser input stays durable/replay-safe.

### 3. Existing authorities unchanged

`selectActors` (kernels/runtime.ts) keeps its selector branches and remains
the RuleSelector→views authority; `queryDirectTarget`
(primitives/targeting.ts) remains the direct-target specialist with
Blind/Stealth/LoS policy; `kernels/teleport-choice.ts` remains the teleport
authority (in-grid + unoccupied + Rampart are spatial/domain constraints the
generic row cannot express — kept out of CHOOSE deliberately). No reverse
dependencies: primitives untouched, kernels import primitives only.

## Honest promotion result — 0 of 8 `{choice-input}` singletons

Every singleton was re-read against its ICON 1.5 passage (via the canonical
source manifest). U3 provides candidate legality; every one of the eight
additionally needs a durable per-ability choice WINDOW/CARRIAGE (U12
CONTINUATION / U13 WINDOW), which is the next tranche — not candidate
legality:

- `shade:shadow-play:talent:1` — post-swap teleport of the swapped foes
  (continuation window after the remove/place swap resolves).
- `shade:shadow-play:talent:2` — "one of them CAN gain evasion": choice of
  WHICH swapped ally, inside the swap resolution (per-ability durable
  choice carriage).
- `sealer:god-hand:talent:2` — Slay-triggered gain-or-lose combo choice
  (post-defeat window, valued choice input).
- `sealer:matsuri:talent:1` — Slay repeat whose referent (user vs ally
  teleport) is unresolved + the parent's optional ally-teleport window.
- `seer:eclipse:talent:2` — post-explosion re-damage to up to 3 chosen
  characters in the area (delayed/secondary resolution, U11 FLOW).
- `spellblade:fulminate:talent:1` / `talent:2` — ride Fulminate's
  start-of-turn/mark aura-teleport window; the window itself is
  unimplemented (U13).
- `knave:revenge:talent:2` — post-ability optional sacrifice with a
  gain-or-lose valued choice (post-ability window + valued input carriage).

Census regenerated twice, byte-stable at 426 (6/38/237/129/16): zero
promotions is the honest delta. `{choice-input}` remains the frontier
family, now precisely blocking on the U12/U13 choice-window underlay rather
than candidate legality. Next tranche per the plan: U12/U13 (continuation +
decision window), then re-derive the greedy order from the regenerated
census — do not follow the old greedy order.

## Tests

`src/rules/__tests__/candidate.test.ts` — 18 cases:

- CandidateSet filtering: relation any/self/ally/foe; defeated excluded by
  default and flipped by `includeDefeated`; position-less actors excluded by
  default and flipped by `includeOffBattlefield`; range at-boundary passes,
  one-past fails.
- `validateActorCandidate` structured violations carry the exact legacy
  codes; legal actor at exact range passes.
- QUERY⇄CHOOSE parity: every actor in the CandidateSet is accepted by
  `resolveChoice`; every excluded actor is rejected; `validateActorCandidate`
  and `resolveChoice` agree on every actor in the state.
