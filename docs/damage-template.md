# Damage ledger template

Every damage instance that an event log serializes must be a
`DamageLedgerEntry` (`src/rules/automation/kernels/damage-ledger.ts`) that declares
**which side of the handoff it is**. This is the F0 foundation rule from
`docs/rules-foundations.md` §1:

- A **source amount** (`handoff: 'source'`) is pre-mitigation raw damage. It
  replays through `determineAndApplyEncounterDamage`, so p.93 reductions and
  halving are re-derived — safe because determination is pure and
  deterministic.
- A **final amount** (`handoff: 'determined'`) is a persisted post-mitigation
  amount. It replays through `applyDeterminedEncounterDamage` with the
  recorded application provenance (floor, defeat, immunity). Re-mitigating it
  would apply the reductions twice.

**Never introduce another numeric `damage` field without this designation and
a source/replay pair covering armor, Resistance, Defiance, and vigor.**

## 1. Decide the handoff

| The event records… | Handoff | Replay entry point |
| --- | --- | --- |
| A raw source amount (VM `damage` mutations, p.89 terrain, delayed lifecycle damage, Slashed) | `source` | `determineAndApplyEncounterDamage` |
| An already-determined amount (basic attack, Vigilance, held interrupt windows, legacy `ABILITY_RESOLVED`) | `determined` | `applyDeterminedEncounterDamage` |

`applyDamageLedger(state, entry)` is the single replay consumer: it routes by
`handoff` to the correct kernel entry point, so an event branch never
hand-rolls an `EncounterHeldDamage` literal or re-codes p.93 arithmetic.

## 2. Author the entry

Both handoffs record the same fields:

```ts
{
  handoff: 'determined',             // or 'source'
  targetId, sourceActorId,           // sourceActorId null for terrain
  sourceRuleId,                      // exact source ID, e.g. 'core:light-attack'
  instance,                          // 1 = one damage instance
  delivery,                          // 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain'
  damageType,                        // 'normal' | 'piercing' | 'divine'
  bypassVigor?, ignoreArmor?,        // source-specific exceptions — never 'divine' as shorthand
  ignoreDefiance?, ignoreCover, ignoreDodge?, covered?,
  amount,                            // source amount ('source') or determined amount ('determined')
  appliedAmount, hpDamage, vigorDamage,
  flooredAt1,                        // 'defiance' | 'defy-death' | null — the application floor
  defeated, woundGained,
  window,                            // DamageWindowLedger | null (F4 trigger provenance)
}
```

Rules of thumb:

- **The floor is a recorded result, not a re-inference.** Defiance (p.104)
  and Defy Death (p.138) clamp the target to 1 hp at application time. A
  `determined` entry records `flooredAt1` and the full determined `amount` so
  replay re-triggers the floor from the lethal number — never from the
  reduced applied amount alone.
- **Exceptions stay typed and narrow.** `bypassVigor`, `ignoreArmor`, and
  `ignoreDefiance` are distinct source exceptions; do not collapse them into
  `damageType: 'divine'`. `ignoreDefiance` does not bypass the generic
  `damage-immune` bit.
- **Lifecycle damage is `source`.** Dangerous terrain, Slashed ability moves,
  and delayed effects (e.g. Great Giorgios) write the raw amount and let the
  kernel re-derive mitigation at replay.
- **Held windows keep the determined amount.** An interrupt window's
  `heldDamage` is the final mitigated amount; do not serialize it as a source
  entry (that would re-apply armor).

## 2.5 The attack-roll ledger (`AttackResolutionLedger`)

An attack is more than its damage: `ATTACK_RESOLVED` events additionally
carry an `attackResolution` record — the authority provenance the direct
target gate validated (relation, maximum range, line of effect), the terrain
cover resolved at command time, the attack-window choices the attack opened
(`null` for basic attacks until F4 trigger provenance lands), and the
attack's **downstream damage instance** (the same `DamageLedgerEntry`, nested
as `damage`). Replay applies `attackResolution.damage` through
`applyDamageLedger`; the record is what a future trigger window (Vigilance's
"a foe within range 2 attacks", Counter's "damaged by an ability") consumes
instead of re-validating the target from mutable state.

## 3. Wire it

1. Add `ledger?: DamageLedgerEntry` to the event shape in `src/rules/types.ts`
   (optional, so historical logs without one stay replayable).
2. Build the entry at command time where the kernel preview is computed —
   `attackEvents`, `vigilanceEvents`, and `movementEvents` in
   `src/rules/encounter.ts` are the reference implementations.
3. In the `applyEvents` replay branch, prefer the ledger and keep the legacy
   fallback:

```ts
if (event.ledger) applyDamageLedger(state, event.ledger);
else { /* legacy field replay (documented) */ }
```

## 4. Fixtures and docs

- Add a matrix case to `__tests__/damage-ledger.test.ts`: the same blow
  through basic attack, VM, terrain, held damage, delayed/Slashed, and
  reactive (Counter) damage, each replay-verified through `applyEvents`, plus
  a defiant-target floor case and a legacy-fallback case.
- Include a ledger-only event (strip the legacy flag) so the test proves
  replay *consumes* the ledger rather than passing via the fallback.
- Note the migrated shape in `docs/rules-coverage.md` and `docs/roadmap.md`.

## 5. Verify

```bash
npm run typecheck
npm test
npm run build
npm run audit:automation   # unchanged — the ledger is replay provenance,
                           # not EXECUTE_RULE authority
```
