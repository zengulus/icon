# Passive projection template

A passive — a trait, role baseline, or mark that turns source text into a
mechanical condition — becomes mechanically active only through a **closed,
source-ID recipe** in `src/rules/automation/kernels/passive-projection.ts` (trait
recipes and mark-condition projections) or a dedicated audited manifest like
`content/foes/trait-recipes.ts`. Nothing in this module parses trait/role prose, mark
state text, or display titles at runtime: the registry is keyed on exact
`sourceId` + `markId` + the specific reviewed state, and an entry ships with a
source-page replay fixture **and** a negative fixture proving non-recipe text
stays inert.

This is the "one shared contract, replayed per instance" pattern from
`docs/foe-template.md`, applied to passives: the 8 class traits, 65 job
traits, 612 foe traits, 19 foe phases, and 6 foe role baselines are all
instances of a few dozen source behaviors, so **no per-passive resolver code
exists**.

---

## 1. Author the recipe

### Trait → condition recipes

Add one entry to `CHARACTER_TRAIT_CONDITION_RECIPES`, keyed by the exact trait
`sourceId`, listing the condition(s) it projects:

```ts
'stalwart:trait:fortify': ['fortify'],
```

A trait is projectable only when the projected condition is already a real
engine mechanic with a shared reducer path (the way `dodge`, `flying`,
`slip`, `aetherwall`, `skirmisher`, `finesse`, `chain-reaction`,
`aether-user`, and `fortify` are). If the condition's delivery/trigger matrix
is not complete, the trait stays source-visible — do **not** project a
condition whose mechanic is not wired (see the rules-foundations gates for
Defiance, Counter, Dodge, Sturdy, Stealth, Unstoppable, and the foe role
baselines).

### Mark → condition projections

Marks are the other reviewed passive source. The Rot slice (ICON p.186) is
the reference implementation:

- **Grants** — `projectedMarkConditionGrants`: a `rot` mark from
  `harvester:rot` with `state.kind === 'ally'` projects a literal
  `regeneration` condition (p.104: gain 4 vigor at turn end while bloodied).
- **Suppressions** — `projectedMarkConditionSuppressions`: a `rot` mark from
  `harvester:rot` with `state.kind === 'foe'` and `state.noDefiance === true`
  suppresses `defiance` on its carrier while marked.

Both are **ephemeral**: the durable `marks` array is the record; the
projection is computed per-read and never written back. Key every case on the
exact `sourceId`, `markId`, and the specific state field the source names —
arbitrary mark state must stay inert.

Rules of thumb:

- **Key on IDs, not shape.** Same `markId` from a non-recipe source, an
  unreviewed `kind`, or a look-alike `state` object projects nothing.
- **Closed registry.** Every reviewed ID is listed; the audit and negative
  tests enforce that anything not listed stays unprojected.
- **Ephemeral.** Projections read from durable state (`traitIds`, `marks`)
  and never mutate it, so replay and live execution see the identical set.
- **Role baselines are reviewed rows, not prose.** `FOE_ROLE_BASELINE_RECIPES`
  is the closed p.298 table keyed by `FoeRoleId`: `skirmisher` → `dodge`,
  `artillery` → `slip` + `aetherwall`, `heavy` → `rampart`; mob, leader, and
  legend project no condition. Non-condition halves stay with their dedicated
  mechanics: the Heavy's armor-2 Guard is `guardArmorBonus` in the damage
  kernel, the Legend's Juggernaut is the round-start clear in the
  turn-transition boundary, and the Skirmisher's diagonal/full-speed dash is
  a movement-planning recipe. `projectedRoleConditions(roleId)` feeds
  `encounterConditionSet` exactly like the trait recipes.

## 2. Wire (automatic)

`encounterConditionSet(actor)` in `src/rules/automation/kernels/encounter-adapter.ts`
is the single projection point every consumer (damage kernel, movement
planner, triggers, save paths) reads. It folds in, in order:

1. durable statuses + conditions + active-effect grants,
2. trait passives (`projectedPassiveConditions`),
3. mark grants, then
4. mark suppressions (so a suppression can remove a condition the actor
   actually carries).

Adding a recipe needs no per-consumer wiring — the set flows to every
consumer automatically.

## 3. Write the fixtures

Add scenarios to the job fixture that owns the source (the Rot slice lives in
`__tests__/harvester.test.ts`), modeled on the existing slices:

- **Positive** — run the ability that creates the mark through `EXECUTE_RULE`
  (the same command surface the VTT/transport use) with `scriptedDice(...)`,
  assert the projected condition appears in `encounterConditionSet`, and
  verify `applyEvents(state, events)` replays to the identical state.
- **Behavioral** — assert the projected mechanic actually fires through the
  shared kernel (e.g. the REGENERATE ally-mark restores 4 vigor at turn end
  while bloodied; the noDefiance foe-mark lets a lethal blow defeat instead of
  flooring at 1 HP and granting temporary immunity).
- **Negative** — prove the registry is closed: a same-`markId` mark from a
  non-recipe source, an unreviewed `kind` with a noDefiance-shaped state, and
  a fabricated trait ID all leave the projected set unchanged.

## 4. Update docs and verify

- Note the slice and its remaining fidelity gaps in `docs/rules-coverage.md`
  (the passive projection section) and `docs/roadmap.md`.
- Run the full gate:

```bash
npm run typecheck
npm test
npm run build
npm run audit:automation   # read completePrograms / completeClauses; passive
                           # projections are not active command authority, so
                           # audit counts change only if an allowlist entry +
                           # fixture promote a unit to EXECUTE_RULE authority
```

The audit numbers feed back into `__tests__/coverage.test.ts` — copy them,
don't hand-compute.
