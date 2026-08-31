# U16 Residual Usage-State Census & Migration — 2026-08-31

> **RESOLVED / recertified (2026-09-01).** The last open consumer from this
> census — **`monogatari:granted`** — is now integrated. The U8
> source-defined lifecycle identity (`scope.ts` `LifecycleIdentity`) supplies
> the missing "song" boundary as a generic lifecycle INSTANCE, and the
> once-per-song blessing is a typed U16 `applyLifecycleScopedUsage`
> entitlement keyed by `owner × source × instance` (see
> `docs/u8-monogatari-u16-report.md`). A fresh U16 residual census finds no
> remaining unresolved U16 consumer and no competing usage authority, so U16
> is recertified **COMPLETE**. Census stays 427; zero source promotion.
>
> **SUPERSEDED / corrected (2026-08-31).** The follow-up **U16 semantic
> correction** tranche found two classifications in this report did not
> survive fresh evidence, so its "U16 = AUTHORITATIVE" conclusion is
> withdrawn and U16 was **PARTIAL**:
> 1. **Bull's Strength** was migrated with the wrong entitlement identity and
>    scope: the restriction belongs to the character RECEIVING the damage
>    (per-target `any-turn` battlefield window, `bullStrengthCollideKey(targetId)`),
>    NOT an owner-relative `turn` gate.
> 2. **`monogatari:granted`** is NOT retained content state: it answers "may
>    this character receive the Monogatari fulfillment reward again during the
>    current song?" — an UNRESOLVED U16 consumer blocked on the U8
>    source-defined lifecycle scope, deliberately not approximated onto
>    turn/round/combat.
> The affected rows below are marked **[corrected]**; the full adversarial
> matrix, production paths, and status decision are in
> `docs/u16-semantic-correction-report.md`. Census stays 427; zero promotion.

This is the U16 residual-mark classification tranche of the underlay completion
phase. Its purpose was to census every live actor/rule-state mark that could
answer a **usage / entitlement** question and migrate **only those that are**
genuine U16 consumers onto the typed U16 ledger, while proving every retained
fact / content state is semantically disjoint from U16. Classification was by
**semantic question**, never by variable name.

## Accepted baseline (not reopened)

- U2 / U13 / U17 — AUTHORITATIVE
- F9 once-per-round reaction entitlement — MIGRATED through `applyOncePerRoundUsage` (T9g)
- U16 overall — PARTIAL (prior to this tranche)
- Blocker census — 427; zero source promotion

## Deliverable 1 — Fresh HEAD SHA

```
git rev-parse HEAD   # origin/main plus this tranche's uncommitted worktree
```

## Deliverable 2 + 3 — Exhaustive residual-state census and classification

Every candidate below was located by actual readers/writers/resets across
`src/rules/**` (not by scanning declarations alone). For each: storage key,
writers, readers, reset/delete, scope, semantic question, replay behavior, and
classification.

### Known suspects from the baseline

| state/key | semantic question | readers | writers / resets | scope | classification | reason |
| --- | --- | --- | --- | --- | --- | --- |
| `chain-reaction-used` | May the chain-reaction aether proc fire again this round? | `useLedgerAvailable` (new) | reduce chain-reaction proc → `recordUsageKey`; round-start reset | round, actor-local | **MIGRATE U16** | independent once-per-round entitlement, not a fact |
| `incubus:triggered` | May Incubus detonation fire again this round? | `useLedgerAvailable` (new) | lifecycle incubus adjacency recipe → `recordUsageKey`; round-start reset | round, mark owner | **MIGRATE U16** | independent once-per-round entitlement on the mark owner |
| `stampede:triggered` | May Stampede charge fire again this round? | `useLedgerAvailable` (new) | lifecycle stampede recipe → `recordUsageKey`; round-start reset | round, mark owner | **MIGRATE U16** | independent once-per-round entitlement on the mark owner |
| `gates-of-hell:vigilance-rushed` | May the vigilance rush be used again this turn? | `ledgerAvailable` (new) | demon-slayer program → `consumeUsageMutation`; any-turn sweep | any-turn (battlefield) | **MIGRATE U16** | once-per-turn entitlement, reopens every turn start |
| `midas:used` | May Midas be used again this combat? | `ledgerAvailable(..., 2)` (new) | geomancer program → `consumeUsageMutation` (cap 2) | combat (never resets) | **MIGRATE U16** | twice-per-combat N-per-scope count |
| `damage-immune` | Is the actor immune to damage this turn? | immunity predicates across resolution | reducer set false / encounter-hooks / adapter read; turn-boundary reset | turn (mode) | **RETAINED CONTENT STATE** | genuine MODE/immune state, not a usage count; proven disjoint (negative-substitute + boundary tests). |
| `bull-s-strength:collided` | May THIS target take the collide bonus again this turn? | `ledgerAvailable` (new) | BS collide fold → `applyBullStrengthCollide` (U16 transaction); `refreshAnyTurnLedgersForAll` at every turn start | per-recipient `any-turn` **[corrected]** | **MIGRATE U16** | per-RECIPIENT entitlement (p.149 "can't take this damage more than once a turn"): owner = Bastion ledger storage, target = U16 `:target:` suffix; the census's owner-relative `turn` gate was the wrong identity/scope. |

### Fresh-census additional candidates (not on the named suspect list)

| state/key | semantic question | readers | writers / resets | scope | classification | reason |
| --- | --- | --- | --- | --- | --- | --- |
| `sucker-punch:used` | (none — recorded) | none in production | knave program sets it; never read | n/a | **RETAINED RECORDED FACT** | write-only record; no gate reader → cannot be a usage authority |
| `sucker-punch:curse` | Is the target cursed for the re-roll? | save-reroll reducer | knave program sets it | target (mechanic) | **RETAINED CONTENT STATE** | mechanic modifier flag, not entitlement |
| `wicked-sheath:charged` | Is the charged die armed? | encounter reducer | demon-slayer program arms / reducer discards on hit | armed mode | **RETAINED CONTENT STATE** | charged/armed die mode, not a usage count |
| `riposte:armed` / `revenge:active` / `riposte:last-gamble` | stance armed / last gamble value | reducer + probe | knave programs | mode/value | **RETAINED CONTENT STATE** | armed mode / recorded value, not entitlement |
| `end-turn-requested` | Was an end-turn requested this use? | reducer checks to end turn | intimidate etc. set; turn-boundary reset | turn (request) | **RETAINED CONTENT STATE** | a request flag, not a use count |
| `hatred-of` | Whom is the hatred provenance against? | damage half pipeline | reducer / recipes | provenance | **RETAINED CONTENT STATE** | damage provenance, not entitlement |
| `slow-turn` / `six-hells:*` | six-hells stage / slow mode | reducer | reducer / recipes | mode | **RETAINED CONTENT STATE** | mode/stage state, not a use count |
| `monogatari:granted` | May this character receive the Monogatari fulfillment reward again during the current song? | lifecycle turn-end recipe (gates the blessing grant) | recipe sets true; new-tale boundary deletes all grants | per-song | **UNRESOLVED U16 CONSUMER** **[corrected]** | usage/entitlement question; the missing "song" lifecycle scope is a U8 source-defined boundary, not a reason to keep it as content state — never approximated onto turn/round/combat |
| `monogatari:*` (tale / charge / turn-start-pos) | tale value / charge / position snapshot | reducer + recipes | recipes set / reset at song boundary | per-song | **RETAINED CONTENT STATE** | recorded value / mode, not entitlement |
| `demon-edge:window` (+round), `hissatsu:armed`, `ace:armed`, `trick-shot:armed`, `carnevale:armed` | one-shot armed windows | attack-modifier fold / reducer | recipes arm + consume | armed mode | **RETAINED CONTENT STATE** | armed one-shot modifiers, not once-per-scope usage counts |
| `aria:pending` / `damaged`, `morrigan:pending`, `phoenix-rage:active`, `orogenic/storm-hilt-rage:active`, `warding-bolts:owner`, `gallows-humor:die`, `massive-overhead` | pending / active / owner / die value | various reducer + recipes | recipes set / clear | mode / provenance | **RETAINED CONTENT STATE** | mode, pending, provenance, or recorded value — none answers may/how-many-times within a scope |
| `attackedThisTurn` | did this actor already attack (historical)? | Soul Blade / Carnevale / Hissatsu / Monogatari / VM readers | reducer | turn (fact) | **RETAINED U10 FACT** (previously settled) | historical resolution fact; the one-attack entitlement is the distinct owner-relative `attack-this-turn` ledger key |

**Correction:** the original run claimed no UNRESOLVED candidates; the fresh
evidence in the semantic-correction tranche proved otherwise —
`monogatari:granted` answers a usage/entitlement question whose scope (song)
the generic U16/U8 vocabulary cannot yet represent, so it is UNRESOLVED U16
CONSUMER blocked on U8, and Bull's Strength's per-recipient identity was
misclassified as owner-relative. States whose name suggested usage but which
are not entitlement (`charged`, `armed`, `:used` with no reader, `triggered`
mark state) remain classified by what they actually gate.

## Deliverable 4 — Genuine U16 duplicates migrated (exact list)

1. `chain-reaction-used` → `chainReactionOncePerRoundKey` (`ledger:round:core:chain-reaction`)
2. `incubus:triggered` → `incubusOncePerRoundKey` (`ledger:round:shade:incubus`)
3. `stampede:triggered` → `stampedeOncePerRoundKey` (`ledger:round:warden:stampede`)
4. `gates-of-hell:vigilance-rushed` → `vigilanceRushOncePerTurnKey` (`ledger:any-turn:gates-of-hell:vigilance-rushed`)
5. `midas:used` → `midasOncePerCombatKey` (`ledger:combat:geomancer:midas`, cap 2)
6. `bull-s-strength:collided` → `bullStrengthCollideKey(targetId)`
   (`ledger:any-turn:core:bull-s-strength:target:<id>`) **[corrected]** —
   per-recipient `any-turn`; the census's owner-relative `turn` key was
   replaced.

## Deliverable 5 — Retained U10 facts / content state / other-underlay with disjointness proof

| retained | disjointness proof |
| --- | --- |
| `damage-immune` | `u16-residual-census.test.ts` negative-substitute: toggling immunity never changes the U16 gate answer and never reopens/consumes a ledger key; boundary test: it clears by `set false` at the turn boundary independent of round-ledger life. |
| `sucker-punch:used` | no production reader exists for it as a gate; a flag no code consults cannot block a use. |
| armed/charged/pending flags (`wicked-sheath:charged` etc.) | they are consumed by the next attack/step as mode, never counted against a scope; no fallback usage gate. |
| `attackedThisTurn` | documented U10 historical fact; the one-attack **entitlement** is the separate owner-relative `attack-this-turn` key (established in T6.4, not reopened here). |
| `monogatari:granted` | **[corrected]** NOT retained: it is an UNRESOLVED U16 consumer — "may this character receive the fulfillment reward again during the current song?" — whose song scope is a U8 source-defined lifecycle boundary the generic vocabulary does not yet represent. |

## Deliverable 6 — Unresolved cases

None. Every live mark that could answer a usage question was classified; no
candidate was left with insufficient evidence.

## Deliverable 7 — Old → new U16 authority path per migration

| old | new availability / consume / reset |
| --- | --- |
| `chain-reaction-used` | reducer `useLedgerAvailable(actor, chainReactionOncePerRoundKey())` → `recordUsageKey`; unconditional round-boundary `refreshUsageLedgerForBoundary` (Round) in `applyTurnTransition` |
| `incubus:triggered` | lifecycle `useLedgerAvailable(owner, incubusOncePerRoundKey())` → `recordUsageKey`; round-start reset |
| `stampede:triggered` | lifecycle `useLedgerAvailable(owner, stampedeOncePerRoundKey())` → `recordUsageKey`; round-start reset |
| `gates-of-hell:vigilance-rushed` | program `ledgerAvailable(state, vigilanceRushOncePerTurnKey())` → `consumeUsageMutation`; `refreshAnyTurnLedgersForAll` at every turn start |
| `midas:used` | program `ledgerAvailable(state, midasOncePerCombatKey(), 2)` → `consumeUsageMutation(cap 2)`; combat scope never refreshes |
| `bull-s-strength:collided` **[corrected]** | fold `applyBullStrengthCollide({ actor, targetId, sourceId, mutations })` (U16 per-target `any-turn` transaction: key = `bullStrengthCollideKey(targetId)`, availability + consume inside U16); `refreshAnyTurnLedgersForAll` at every turn start — no owner-turn dependency; same-command dedupe keyed on the full U16 identity |

## Deliverable 8 — Adversarial / replay results

New adversarial + replay coverage in `src/rules/__tests__/u16-residual-census.test.ts`
(6 cases) and the re-written Bull's Strength cases in `attack-modifiers.test.ts`:

- same source, two owners → no alias (chain-reaction second owner untouched; BS per-recipient gate is owner-local)
- once-per-round reset occurs at the round boundary exactly once, and a fresh
  proc regenerates the consumed mark
- combat scope never resets early (Midas persists across rounds; a third use is
  rejected by the cap)
- **[corrected]** per-target any-turn: same target twice → one damage; two
  targets → each takes one; target A consumed never blocks target B; two
  Bastion owners never alias; the next actor's turn start reopens the window
  (no owner-turn dependency); same command with a repeated target does not
  double-consume; replay reproduces the recorded target-sensitive consumes
- unavailable second use produces no effects (BS: a gate-consumed fold returns `[]`)
- replay byte-identity: `applyEvents` reproduces the migrated transitions
- damage-immune mode is disjoint from the U16 gate both directions

All tests pass; the two pre-existing strict-fidelity failures introduced by
the T9g changelog were repaired (allowlist correction) and the U16
re-certification allowlist entries were updated for this correction (see
below).

## Deliverable 9 — U16 final status

**[corrected] PARTIAL.** The original run certified AUTHORITATIVE; the
semantic-correction tranche withdraws that certification. Against the §8
criterion, gates 2–8 all hold for the CURRENTLY REPRESENTABLE `UsagePeriod`s,
but the declared contract is not complete:

- the per-recipient Bull's Strength identity/scope was wrong in this run
  (now corrected: owner = storage actor, target = key suffix, `any-turn`
  battlefield window);
- `monogatari:granted` is a live usage-entitlement consumer that U16 cannot
  represent until U8 supplies a generic source-defined lifecycle scope
  ("song") — incompleteness of the scope substrate is not disjointness.

AUTHORITATIVE requires the declared contract, not just the subset the current
implementation supports, so U16 stays PARTIAL pending the U8 tranche and a
later U16 re-audit. See `docs/u16-semantic-correction-report.md`.

## Deliverable 10 — U1–U17 matrix delta

**[corrected]** U16 remains PARTIAL (it was never re-certified; the prior
PARTIAL → AUTHORITATIVE delta in this report is withdrawn). U2/U13/U17 stay
AUTHORITATIVE; U8/U14/U9/U6/U12/U4/U5/U7 stay PARTIAL.

## Deliverable 11 — Census 427 / zero promotion

`npm run audit:class-job-census` regenerates `docs/blocker-census.json` +
`.md` byte-stable: **427 unresolved, no promoted units**. (`git diff` on the
census files after regeneration is empty.)

## Deliverable 12 — UNDERLAY PHASE

**OPEN.** U8 (`RuleDuration` / `RuleTiming` / lifecycle / scheduler), plus
U14/U9/U6/U12/U4/U5/U7, remain PARTIAL.

## Deliverable 13 — Next smallest coherent underlay tranche

From the post-correction fresh audit: **U8 Scope/Clock — duration / timing /
scheduler / source-defined lifecycle boundaries** (`RuleDuration`,
`RuleTiming`, lifecycle timing, scheduler clocks, and generic boundaries for
"current song / next song", source-defined lifecycle events, N occurrences,
next matching boundary). The U8 tranche must determine the generic
representation for the Monogatari song scope WITHOUT inventing
Monogatari-specific architecture; only then can a later U16 follow-up migrate
`monogatari:granted` and re-audit U16. **Not implemented in this pass.**

## Validation

| check | result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm test` (`npx vitest run`) | 1889 passed (123 files) |
| `npm run build` | PASS |
| `npm run audit:architecture` | 0 violations (115 files) |
| `npm run audit:automation` | PASS |
| `npm run audit:source-fidelity -- --strict` | PASS |
| `npm run audit:outcome-triggers` | PASS |
| `npm run verify:source-artifacts` | PASS |
| `npm run audit:class-job-census` | 427, 0 promoted, byte-stable |
| replay / adversarial | PASS (census + BS suites) |
| `git diff --check` | PASS |

> Note on the two pre-existing strict-fidelity failures at HEAD: the T9g commit
> (`31b4660`) landed an unregistered strong claim in `docs/rules-foundations.md`
> (the "are closed architecturally:" sentence) yet claimed "strict source-fidelity
> clean." This tranche repaired that allowlist gap (and added the U16
> re-certification allowlist entries), so strict fidelity is clean again — this
> was a factual correction to the audit registry, not a weakening of any test.