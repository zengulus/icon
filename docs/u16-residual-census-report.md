# U16 Residual Usage-State Census & Migration — 2026-08-31

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
| `bull-s-strength:collided` | May the once-per-turn collide bonus fire again this turn? | `useLedgerAvailable` (new) | BS collide fold → `consumeUsageMutation`; shared core:turn-ledger-reset | owner-relative turn | **MIGRATE U16** | genuine once-per-turn entitlement (fresh census find — the WIP list was not complete). |

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
| `monogatari:*` | tale / grant / charge / turn-start-pos | reducer + recipes | recipes reset at song boundary | per-song | **RETAINED CONTENT STATE** | once-per-song content boundary, not a U16 UsagePeriod |
| `demon-edge:window` (+round), `hissatsu:armed`, `ace:armed`, `trick-shot:armed`, `carnevale:armed` | one-shot armed windows | attack-modifier fold / reducer | recipes arm + consume | armed mode | **RETAINED CONTENT STATE** | armed one-shot modifiers, not once-per-scope usage counts |
| `aria:pending` / `damaged`, `morrigan:pending`, `phoenix-rage:active`, `orogenic/storm-hilt-rage:active`, `warding-bolts:owner`, `gallows-humor:die`, `massive-overhead` | pending / active / owner / die value | various reducer + recipes | recipes set / clear | mode / provenance | **RETAINED CONTENT STATE** | mode, pending, provenance, or recorded value — none answers may/how-many-times within a scope |
| `attackedThisTurn` | did this actor already attack (historical)? | Soul Blade / Carnevale / Hissatsu / Monogatari / VM readers | reducer | turn (fact) | **RETAINED U10 FACT** (previously settled) | historical resolution fact; the one-attack entitlement is the distinct owner-relative `attack-this-turn` ledger key |

No candidate was classified UNRESOLVED: every live mark had sufficient
evidence to determine its semantic question, lifetime, and whether it is a
usage gate. States whose name suggested usage but which are not entitlement
(`charged`, `armed`, `:used` with no reader, `triggered` mark state) were
classified by what they actually gate.

## Deliverable 4 — Genuine U16 duplicates migrated (exact list)

1. `chain-reaction-used` → `chainReactionOncePerRoundKey` (`ledger:round:core:chain-reaction`)
2. `incubus:triggered` → `incubusOncePerRoundKey` (`ledger:round:shade:incubus`)
3. `stampede:triggered` → `stampedeOncePerRoundKey` (`ledger:round:warden:stampede`)
4. `gates-of-hell:vigilance-rushed` → `vigilanceRushOncePerTurnKey` (`ledger:any-turn:gates-of-hell:vigilance-rushed`)
5. `midas:used` → `midasOncePerCombatKey` (`ledger:combat:geomancer:midas`, cap 2)
6. `bull-s-strength:collided` → `bullStrengthOncePerTurnKey` (`ledger:turn:core:bull-s-strength`)

## Deliverable 5 — Retained U10 facts / content state / other-underlay with disjointness proof

| retained | disjointness proof |
| --- | --- |
| `damage-immune` | `u16-residual-census.test.ts` negative-substitute: toggling immunity never changes the U16 gate answer and never reopens/consumes a ledger key; boundary test: it clears by `set false` at the turn boundary independent of round-ledger life. |
| `sucker-punch:used` | no production reader exists for it as a gate; a flag no code consults cannot block a use. |
| armed/charged/pending flags (`wicked-sheath:charged` etc.) | they are consumed by the next attack/step as mode, never counted against a scope; no fallback usage gate. |
| `attackedThisTurn` | documented U10 historical fact; the one-attack **entitlement** is the separate owner-relative `attack-this-turn` key (established in T6.4, not reopened here). |
| `monogatari:granted` | once-per-song content boundary (resets when a new tale is set); "song" is not a U16 UsagePeriod — pushing it onto the ledger would invent a scope. |

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
| `bull-s-strength:collided` | fold `useLedgerAvailable(source, bullStrengthOncePerTurnKey())` → `consumeUsageMutation`; shared `core:turn-ledger-reset` at owner's next turn-start (bespoke turn-end clear removed) |

## Deliverable 8 — Adversarial / replay results

New adversarial + replay coverage in `src/rules/__tests__/u16-residual-census.test.ts`
(6 cases) and the re-written Bull's Strength cases in `attack-modifiers.test.ts`:

- same source, two owners → no alias (chain-reaction second owner untouched; BS owner-local)
- once-per-round reset occurs at the round boundary exactly once, and a fresh
  proc regenerates the consumed mark
- combat scope never resets early (Midas persists across rounds; a third use is
  rejected by the cap)
- owner-relative turn vs any-turn distinction: Bull's Strength refreshes only at
  the OWNER's turn-start, not when foes cycle
- unavailable second use produces no effects (BS: a gate-consumed fold returns `[]`)
- replay byte-identity: `applyEvents` reproduces the migrated transitions
- damage-immune mode is disjoint from the U16 gate both directions

All 1889 tests pass (vs 1887 at HEAD; two pre-existing strict-fidelity failures
introduced by the T9g changelog were repaired — see below).

## Deliverable 9 — U16 final status

**AUTHORITATIVE.** Against the §8 criterion:

1. typed scope/identity/count/consume/reset contract complete — yes.
2. every live usage-entitlement consumer censused — yes (exhaustive census).
3. every such consumer routes through U16 — yes (all six migrated).
4. retained facts/content states have explicit semantic-disjointness proof — yes.
5. zero unresolved competing usage gates remain — yes (fresh census clean).
6. owner/scope/source distinctions preserved — yes (turn / any-turn / round / combat; mark-owner vs actor-local).
7. adversarial + replay tests pass — yes.
8. architecture guards prevent obvious regrowth — yes (architecture-audit test pins the six migrated keys and bans the raw fields; the kernel source-id exemption allowlist includes the new gate provenance).

## Deliverable 10 — U1–U17 matrix delta

Only U16 changed by fresh evidence (PARTIAL → AUTHORITATIVE). U2/U13/U17 stay
AUTHORITATIVE; U8/U14/U9/U6/U12/U4/U5/U7 stay PARTIAL. No U10/U15/U3/etc. row
needed a change on this tranche's evidence.

## Deliverable 11 — Census 427 / zero promotion

`npm run audit:class-job-census` regenerates `docs/blocker-census.json` +
`.md` byte-stable: **427 unresolved, no promoted units**. (`git diff` on the
census files after regeneration is empty.)

## Deliverable 12 — UNDERLAY PHASE

**OPEN.** U8 (`RuleDuration` / `RuleTiming` / lifecycle / scheduler), plus
U14/U9/U6/U12/U4/U5/U7, remain PARTIAL.

## Deliverable 13 — Next smallest coherent underlay tranche

From the post-migration fresh audit: **U8 duration / timing / scheduler
surfaces** (`RuleDuration`, `RuleTiming`, lifecycle timing, scheduler clocks,
scheduler `turnTaken`/`turnsTakenThisRound` reads). U16 reads nothing of this
(Bull's Strength now refreshes through the shared turn-ledger reset), so U16
can be certified independently; U8 remains the smallest remaining substrate
seam. **Not implemented in this pass.**

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