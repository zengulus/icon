# Save window template

Every save that an event log serializes must be the F2 durable SaveWindow
record (`src/rules/automation/primitives/save-window.ts`): one `save` `RuleMutation`
carrying the window nature, the modifier breakdown, the denial policy, and
the continuation branch. This is the F2 foundation rule from
`docs/rules-foundations.md` §3:

- **`windowKind`** — `status-clear` (ordinary p.94 status saves),
  `cure-immediate` (the saves opened by a Cure, p.102), `effect` (a save
  against an ability effect — generic VM save effects, Penumbra p.162), or
  `movement` (a movement gate such as the Six Hells Trigram exit save,
  p.129). Relic and legend saves are `effect`-kind windows that construct the
  same spec; the record is generic, never per-source.
- **`modifiers`** — the evaluated boon/curse breakdown
  (`sourceModifier`, policy `saveBoon`/`saveCurse`, `blessing`), so a
  re-roll reproduces the exact modifier instead of reusing a rolled value.
- **denial policy** — `forced: true` records a roll that was denied (an
  automatic failure, e.g. Penumbra vs a blinded foe). Window-level denial
  (Sweet Torment suppressing a whole Cure/status window, p.144) is decided by
  the caller before any record exists, so nothing is emitted.
- **`branch`** — the continuation AST (`onSuccess` / `onFailure`) retained on
  the record so a save-reroll interrupt (Sucker Punch, p.143) or a future
  held window regenerates either outcome without re-reading the source.

**Never introduce a bare d20 save, or a save record without these four
facts, without a source/replay pair covering the kind, its modifiers, and its
denial policy.**

## 1. Decide the window kind

| The save… | `windowKind` | Replay/denial notes |
| --- | --- | --- |
| Clears an ordinary status (p.94) | `status-clear` | Resolves at turn boundaries; denial = Sweet Torment |
| Is opened by a Cure (p.102) | `cure-immediate` | Denial = Rot/Sweet Torment cure denial |
| Resists an ability effect (VM save effect, Penumbra p.162, future relic/legend) | `effect` | The only kind a save-reroll interrupt holds today |
| Gates a movement (Six Hells Trigram exit, p.129) | `movement` | Command gate: a failed save rejects the move at command time |

`resolveSaveWindow(context, target, spec)` is the single constructor: it
fills in the evaluated modifier, rolls d20 then the boon/curse die, and
emits the full record. Command construction and replay share this kernel.

## 2. Author the record

```ts
resolveSaveWindow(context, target, {
  id: `${context.sourceId}:status:${target.id}:${status.id}`, // stable windowId
  kind: 'status-clear',            // | 'cure-immediate' | 'effect' | 'movement'
  sourceId: context.sourceId,
  actorId: context.actorId,
  statusId: 'blind',               // only for status-clearing saves
  sourceModifier: 0,               // source boon/curse before policy
  spendBlessing: false,            // explicit p.102 choice (validated by caller)
  forceFailure: false,             // denied roll → `forced: true`, roll 0
  threshold: 10,                   // p.94 ordinary save target
  branch: {                        // continuation AST (optional)
    onSuccess: [{ kind: 'condition', target: { kind: 'trigger-targets' }, conditionId: 'blind', operation: 'remove', potency: 'normal' }],
    onFailure: [],
  },
}).mutation;
```

Rules of thumb:

- **The modifier breakdown is durable, never re-derived.** The mutation's
  `boon` is the *rolled* boon/curse value; `modifiers` is the evaluated
  breakdown. A re-roll computes the modifier from `modifiers` and rolls a
  fresh boon/curse — it never reuses the previous rolled value.
- **Denial is recorded, not re-inferred.** A `forced` save records
  `roll: 0, total: 0, success: false`; replay does not roll for it. Whole
  window denials (Sweet Torment) emit no record at all.
- **The continuation is the source branch, not a re-inference.** Status
  saves carry remove-on-success; effect saves carry their `onSuccess` /
  `onFailure` AST. A save-reroll interrupt regenerates from this branch.

## 3. Wire it

1. Emit the save through `resolveSaveWindow` (or reuse the shared status/Cure
   resolvers in `status-saves.ts`) — never a raw `dice.die(20)` gate.
2. For command-gate saves (movement), record the successful record on the
   event (e.g. `ACTOR_MOVED.exitSave`) so replay and future interrupt
   coverage read the same record; the failed branch rejects the command.
3. `saveRerollWindow` (encounter-adapter.ts) holds only `effect`-kind saves
   with a `branch` — the deliberate p.143 scope (see its comment for why
   status/Cure/movement saves are not held).

## 4. Fixtures and docs

- Keep the replay pairs green in `__tests__/save-window.test.ts`: one per
  kind (`status-clear`, `cure-immediate`, `effect`, `movement`), each
  replay-verified through `applyEvents`, plus a modifier-policy case (Rot's
  curse), a denial-policy case (`forced`), and a branch-record case.
- Extend the Sucker Punch fixtures in `__tests__/knave.test.ts` when the
  re-roll surface changes; the regenerated save must carry the same durable
  record as the original.
- Note the migrated shape in `docs/rules-foundations.md` §3 and
  `docs/rules-coverage.md` when a content area adopts the record.

## 5. Verify

```bash
npm run typecheck
npm test
npm run build
npm run audit:automation   # unchanged — the record is replay provenance,
                           # not EXECUTE_RULE authority
```
