# Job-trait template

A Job trait (one of the 65 in `JOBS`) becomes mechanically active only
through a **closed, source-ID recipe**. The single inventory is
`src/rules/automation/content/jobs/job-trait-recipes.ts` (`JOB_TRAIT_RECIPES`): every row
states exactly how the trait executes — `wired` rows have real engine
mechanics, `documented` rows stay source-visible with the exact ruling a
player or GM makes at the table. Nothing parses trait prose at runtime, and
no trait is ever approximated from its display name.

A row is only `wired` when **all five foundation requirements hold**:

1. **Durable record** — the mechanic replays from the event/ledger record,
   never from mutable scratch state.
2. **Shared kernel** — the mechanic reuses an existing kernel path (damage
   pipeline, movement planner, save windows, lifecycle phases) instead of
   hand-writing a new one-off reducer.
3. **Declarative recipe** — the behavior lives in a registry row, not a
   hand-wired `if` in `encounter.ts`.
4. **Closed source-ID manifest** — `JOB_TRAIT_RECIPES` names the trait and
   its wiring home; `EXECUTABLE_JOB_TRAIT_IDS` / `DOCUMENTED_JOB_TRAIT_IDS`
   derive from it.
5. **Deterministic replay fixture** — `__tests__/job-traits.test.ts` proves
   the behavior changes combat and replays identically.

Everything else is explicitly `documented`, exactly like
`TABLE_FACING_MECHANICS` in `core.ts`.

## 1. Classify the trait

Read the trait's source text and decide which home its mechanic belongs to.
The five homes are:

| Home | Module | Example |
| --- | --- | --- |
| Whole-combat condition projection | `kernels/passive-projection.ts` `JOB_TRAIT_CONDITION_RECIPES` | Sealer martial arts → `dodge` |
| Lifecycle recipe (turn-end / turn-start / round-start) | `kernels/lifecycle.ts` `LIFECYCLE_RECIPES` | True Horn sturdy round-start/turn-start halves |
| Active typed resolver (`EXECUTE_RULE` use) | `content/jobs/job-trait-resolvers.ts` `JOB_TRAIT_RULE_RESOLVERS` | Knave taunt, Spellblade klingenkunst |
| Command/kernel hook | `encounter.ts` / `movement.ts` / `encounter-adapter.ts` | Path of the Aesi free Dash, Green Kenning terrain immunity |
| Combat-start durable grant or companion summon | `COMBAT_START_TRAIT_RECIPES` in `content/jobs/job-trait-recipes.ts` | Embersoul Defiance, Beast Master great beast |

A consumable condition (Defiance, Sturdy) is granted **durably** at combat
start — never projected, because a projection is re-derived on every
condition-set read and would resurrect a consumed condition.

## 2. Add the inventory row

Add the row to `JOB_TRAIT_RECIPES` with the exact `sourceId`, `name`,
`status` (`wired` | `documented`), the deterministic `mechanic` the engine
resolves, and the `detail` ruling for anything left table-facing. A `wired`
row must point at one of the five homes above.

## 3. Implement the mechanic

- **Projection** — add the condition to `JOB_TRAIT_CONDITION_RECIPES`; the
  fold in `projectedPassiveConditions` feeds `encounterConditionSet`, so the
  damage kernel, movement planner, and save paths all see it.
- **Lifecycle** — add a `LifecycleRecipe` row to `LIFECYCLE_RECIPES` at its
  phase position. A round-gated row's `applies` gate reads `state.round`;
  `planTurnTransition` evaluates the turn-start/round-start gates against the
  **next** round so the participant is recorded before the boundary advances.
  Replay executes exactly the recorded participants — the recorded list is
  the decision, never re-decided (the boundary may consume a gate's
  precondition, e.g. the end-of-turn status saves clear the statuses
  Blackheart counts; record such counts on `TurnDiceWindows` at plan time).
- **Resolver** — add a typed resolver to `JOB_TRAIT_RULE_RESOLVERS` and
  register it in `RULE_RESOLVERS`; add the trait to `activeJobTraits` in
  `content/glue/manual-programs.ts` so the generic VM compiles an executable action.
- **Combat start** — add the durable grant / `initState` seed / `summon`
  companion to `COMBAT_START_TRAIT_RECIPES`; `applyCombatStartTraitEffects`
  applies it once on `ENCOUNTER_STARTED` (idempotent, so replay is
  deterministic).

## 4. Write the fixtures

Every `wired` row gets a behavioral proof in `__tests__/job-traits.test.ts`:

- **Behavior** — the mechanic actually changes combat (a dodge absorbs a
  missed blow; a lifecycle grant lands at its boundary; a resolver executes
  through `EXECUTE_RULE`; a command hook changes movement cost).
- **Replay** — the executed command's events re-apply to the original state
  and produce the identical result.
- **Negative** — a `documented` row projects no condition and cannot execute
  through the generic VM (`rule.not-executable`).
- **Bite** — disable the wiring (the projection fold, the round-start phase
  driver) and confirm the relevant fixtures fail.

Companion summons additionally live in `__tests__/summons.test.ts`:
placement range at combat start, survival of the owner's defeat
(`state.companion` exempts the entity from `removeOwnedEphemera`), and the
per-owner entity cap (`summonCap` in `content/jobs/summon-recipes.ts`, six per type).

## 5. Update the docs

- `docs/rules-foundations.md` §7 — the executed F6 inventory and remaining
  documented rows.
- `freebuff-plan.md` — the F6 status.
- `docs/rules-coverage.md` — the audit note.
