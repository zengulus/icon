# Lifecycle template

Every turn boundary (turn-start, turn-end, delayed, and — when they land —
round-start/round-end) is a durable `TurnTransitionIntent`
(`src/rules/automation/kernels/lifecycle.ts`). This is the F3 foundation rule
from `docs/rules-foundations.md` §4:

- The `TURN_ENDED` event records **why** the turn ended (`cause`), the
  **ordered participants** that ran (the lifecycle recipes whose `applies`
  gates passed at the command boundary), and the **dice/save windows**
  pre-rolled at the command boundary (Carnevale detonation gamble p.150,
  Monogatari song gamble p.179).
- Replay **consumes the recorded intent** — it never re-rolls dice windows
  and never re-decides which hooks run. A hook joins the boundary by adding a
  row to `LIFECYCLE_RECIPES`, never by editing `encounter.ts`'s drivers.

**Never hand-wire another turn-start/turn-end effect into `encounter.ts`.**
Register it as a recipe row instead.

## 1. Decide the phase

| The hook fires… | Phase | Notes |
| --- | --- | --- |
| At the start of the actor's turn | `turn-start` | Runs inside `resolveTurnStart`, after duration expiry and the slow-turn flag |
| At the end of the actor's turn | `turn-end` | Runs inside `resolveTurnEnd`, after duration expiry |
| At the marked foe's turn end, as a fresh move/trigger on the *next* turn's clock | `delayed` | Runs **after** the per-actor turn-flag reset (historical `resolveDelayedMarkEffects` position) — Great Giorgios p.124 is the reference row |

A hook that deals damage from a delayed rush belongs in `delayed`: its fresh
ability-move must be on the next turn's clock so triggers like Slashed can
fire again and the flags they set survive the boundary.

## 2. Author the recipe

```ts
const myHookTurnEnd: LifecycleRecipe = {
  sourceId: 'job:ability',          // exact source ID (ability/stance/mark id)
  phase: 'turn-end',                // 'turn-start' | 'turn-end' | 'delayed'
  // Cheap precondition deciding participation at the boundary. The body
  // keeps its own early returns as defense; both must agree.
  applies: (actor, state, diceWindows) => Boolean(actor.position),
  // The deterministic hook body. Use applyRuleMutations / the spatial
  // gateway for every effect so replay routes through the shared kernels.
  resolve: (state, actor, diceWindows) => {
    if (!actor.position) return;
    // ... deterministic effects ...
  },
};
```

Rules of thumb:

- **The body must be deterministic.** Replay never rolls dice; a hook that
  needs a die receives it as a `diceWindows` value pre-rolled at the command
  boundary (see `carnevaleGambleForTurnEnd` in
  `content/jobs/lifecycle-recipes.ts`).
- **`applies` and the body must agree.** `applies` decides the recorded
  `participants` list at the command boundary; the body re-checks as defense
  because the state may have drifted by the time replay runs.
- **Effects go through the shared kernels.** Damage → `applyRuleMutations`
  with the damage ledger, movement → `applySpatialIntent` via move
  mutations, saves → a recorded `SaveWindow`.
- **Order is a recorded contract.** Do not reorder `LIFECYCLE_RECIPES` rows;
  the boundary order is what both command and replay execute.

## 3. Register it

Add the row to `LIFECYCLE_RECIPES` in its phase's order. The registry is the
single source of truth — `planTurnTransition` reads it to record
participants and `runLifecyclePhase` executes exactly the recorded rows.

## 4. Fixtures and docs

- Add cases to `__tests__/turn-transition.test.ts`:
  - the recipe participates (its `sourceId` appears in `intent.participants`
    at the boundary where its gate passes) and replays to the identical
    state through `applyEvents`;
  - a bite case: strip the `sourceId` from `intent.participants` and assert
    the hook does **not** run on replay even though its gate still passes;
  - the dice window it consumes is recorded on `intent.diceWindows` and the
    recorded value (not a re-roll) is what applied;
  - a legacy case: drop `intent` from the event and assert the applies-gate
    fallback reproduces the mechanical result.
- Note the migrated hook in `docs/rules-coverage.md` and `docs/roadmap.md`.

## 5. Verify

```bash
npm run typecheck
npm test
npm run build
npm run audit:automation   # unchanged — lifecycle recipes are reducer
                           # hooks, not EXECUTE_RULE authority
```
