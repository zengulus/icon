# Trigger-window template

Every interrupt window (ICON p.107) has **one decision point and one replay
entry point**, both in `src/rules/automation/kernels/decision-window.ts` (the
single U13 `DecisionWindowRecord`; the old `trigger-window.ts` is deleted).
This is the F4 foundation rule from `docs/rules-foundations.md` §5:

- `DAMAGE_WINDOW_RECIPES` is the closed registry keyed by trigger
  (`when-damaged`, `defeated`). Each row answers, from **durable provenance**
  — who damaged whom, with what determined amount, through which delivery —
  whether a window opens. The rows are ordered: when both triggers are armed
  the more specific one wins (when-damaged before defeated), matching p.107.
-  `decideDamageWindow(state, target, provenance)` is the single decision
  point. The single-pass VM path (`applyDamage` in `encounter-adapter.ts`)
  and the split-event path (a basic attack in `encounter.ts`) both call it,
  so they can never drift. The window it returns is opened through
  `openDecisionWindow` (the ONE record, carrying the determined blow as a
  U12 held-result `heldPayload`).
- A split event records the decision on its ledger at construction time
  (`AttackResolutionLedger.window` and the nested `DamageLedgerEntry.window`);
  replay opens the window from the record via
  `openDamageWindowFromLedger` — it never re-evaluates the target's
  availability or the blow's lethality. A held blow is **not applied** at
  replay; it applies when the interrupt answers the window or the boundary
  drains it.

**Never open a damage window inline without a `DAMAGE_WINDOW_RECIPES` row,
and never re-derive a held decision from mutable window state at replay.**

## 1. Decide the trigger

| The window opens when… | Trigger | Row |
| --- | --- | --- |
| A foe's determined damage would hit a target with an unused when-damaged interrupt (Righteous Disdain p.128) | `when-damaged` | `DAMAGE_WINDOW_RECIPES` (first — more specific) |
| A foe's determined damage would defeat a target with an unused defeated interrupt (Boiling Blood p.138), after the Defiance/Defy Death floors | `defeated` | `DAMAGE_WINDOW_RECIPES` (second) |

The decision inputs are the durable `DamageWindowProvenance`:
`targetId`, `sourceActorId` (null = terrain, never opens), the
post-mitigation `determinedAmount` (never the raw source amount),
`bypassVigor`, `damageType`, and `ignoreDefiance`.

## 2. Author a row

```ts
{
  trigger: 'when-damaged', // or 'defeated'
  opens: (state, target, provenance) => {
    const source = provenance.sourceActorId ? state.actors[provenance.sourceActorId] : undefined;
    return provenance.determinedAmount > 0
      && Boolean(source && source.side !== target.side)
      && hasAvailableWhenDamagedInterrupt(target);
  },
},
```

Rules of thumb:

- **The gate is provenance, not window state.** Do not read
  `state.pendingInterrupts` in `opens`; the decision must be identical at
  command time and at replay from the same pre-command state.
- **The `defeated` gate shares the application floors.** Use
  `prospectiveAppliedDefeat(target, amount, bypassVigor, { ignoreDefiance, damageType })`
  so the window gate and the blow that would be held agree about Defiance
  (p.104) and Defy Death (p.138).
- **The held payload is the determined amount.** The window holds the
  post-mitigation amount (the same window Righteous Disdain uses); re-applying
  armor would double-mitigate.

## 3. Wire a new damage-carrying path

1. VM mutations: `applyDamage` already routes through `decideDamageWindow` +
   `openDecisionWindow` — nothing to do.
2. Split events: call `decideDamageWindow` at construction, record the result
   on the ledger's `window` (and the attack's `AttackResolutionLedger.window`),
   and let `applyDamageLedger` open it from the record. Suppress the
   `ACTOR_DEFEATED` event for a held blow — the interrupt decides whether the
   target falls.
3. Never emit a held record whose trigger the registry does not own:
   `openDamageWindowFromLedger` declines unknown triggers and the damage
   applies normally.

## 4. Fixtures and docs

- Add cases to `__tests__/trigger-window.test.ts`:
  - the recorded decision rides the event and replay opens the window (blow
    held, not applied), then the boundary resolves it;
  - a `defeated` window for a lethal blow, with no defeat until the window
    resolves;
  - VM/split parity: the same blow through a VM mutation and a basic attack
    holds the identical amount;
  - a bite case: strip the `window` record and assert the blow applies
    immediately;
  - a closed-registry negative: a fabricated held record is ignored and the
    damage still applies.
- Note the migrated trigger in `docs/rules-coverage.md` and `docs/roadmap.md`.

## 5. Verify

```bash
npm run typecheck
npm test
npm run build
npm run audit:automation   # unchanged — window provenance is reducer
                           # behavior, not EXECUTE_RULE authority
```
