# Foe ability template

A foe ability becomes "independently executable" when it has a reviewed entry in
the recipe table `FOE_ABILITY_RECIPES` in
`src/rules/automation/foe-recipes.ts` — one declarative recipe per ability,
compiled into a typed `RuleProgram` with a named deterministic resolver by the
generic factories in the same file — plus a source-page replay fixture in
`__tests__/foe.test.ts`. The audit stops counting it as an unresolved
`foe-ability`.

The 1,365 source `foe-ability` units are far more repetitive than job abilities.
A handful of mechanics (the canonical "On hit: [D]+fray / Miss: fray" attack,
shoves, rushes, marks, blasts, terrain, self-buffs, end-turn abilities) cover
most of them, so **no per-ability resolver code exists**. Adding a new slice is
a data change plus a fixture: a recipe entry, an allowlist line that derives
from the table automatically, and golden mutation/replay assertions.

The shared building blocks live in `src/rules/automation/foe-kit.ts` (which
re-exports `job-kit.ts` and adds foe-specific selectors such as
`adjacentActors`). The first slices are the Crusher pilot (p.301, 3 abilities)
and the basic faction slice (p.300–302: Warrior, Soldier, Brute, Pepperbox,
Hunter — 17 abilities), covering every recipe kind below.

---

## 1. Author the recipe

Add one entry to `FOE_ABILITY_RECIPES`, keyed by the ability `sourceId` (e.g.
`basic:soldier:300:bash`). The recipe names a primitive and its parameterized
options; costs, tags, and the default range come from the source catalog
metadata, so the entry only carries the review decision:

```ts
'stray:foe-ability-id': {
  kind: 'shove',
  clauses: ['effect', 'collide'],
  range: 1,
  distance: 2,
  collideConditions: ['weakened'],
},
```

Recipe kinds (each maps to one generic resolver factory in `foe-recipes.ts`):

| Kind | Behavior | Example |
| --- | --- | --- |
| `attack` | The canonical attack: `hit` formula (`die` / `die-fray` / `die-fixed` / `fray` / `fixed`), optional `hitInstances`, `miss` (default fray), `trueStrike`, `boons`, `unerring` (ignore cover), `unerringWhenMarked`, p.102 `bonusDamage` (condition or mark; extra [D], keep highest), `hitConditions`, `hitShove`, `hitMark`, `splash` (adjacent foes of the source or the attack target), `atRange` (conditional effect at an exact range), `bloodiedEffect`, `preRush` (optional pre-attack rush, re-validated from the landing cell) | Headbutt, Cleave, Slash, Backhand, Backbreaker, Riddle, Hunter shot |
| `shove` | Damage (optional) plus a shove; `collideConditions` apply when the shove is stopped by an obstruction (ICON p.95 Collide) | Mighty Blow, Bash, Hurl |
| `rush` | Self rush; `endWeaken` weakens the first adjacent foe reached (Bull rush's "either weakened or shoved 1" — the weaken branch is resolved, the shove branch documented) | Bull rush, Valiant |
| `vigor` | Self vigor gain; `bloodiedAmount` replaces `amount` when bloodied | Bulk up |
| `mark` | Marks a foe within `range`; the mark's persistent benefit is wired into the affected abilities via `bonusDamage.mark` / `unerringWhenMarked` | Grapple, Hunt |
| `swap` | Swaps the source with an adjacent ally (free action) | Redondo |
| `dash-strike` | Dashes, then deals damage to the nearest foe within `range` of the landing cell | Strafe |
| `blast` | Area damage (`small`/`medium`/`large` = Chebyshev radius 1/2/3), `instances`, `conditions` on foes, `alliesStealth` / `alliesVigor` for allies in the area | Flash Bomb |
| `terrain` | Creates a terrain effect in the nearest free cell within `range` | Set Trap |
| `end-turn-stealth` | Dashes, gains stealth, and emits the `end-turn` mutation EXECUTE_RULE honors to auto-end the turn | Prowl |

Rules of thumb baked into the factories:

- **Costs, tags, and default range are source-derived** (the catalog metadata);
  only override `range` when the resolver needs a stricter positional gate
  (e.g. Hunter shot is "ranged 4" even though the catalog leaves `range: null`).
- **Deterministic defaults replace GM choices.** Where the source says "either
  … or …" or "may …", the first-listed deterministic branch is resolved and the
  alternative is documented in `docs/rules-coverage.md` (table-facing), never
  silently approximated.
- **Attacks report the exact generic-VM mutation shape** through
  `resolveAttack(...)`: evasion, boons, and the Dazed curse are honored, and
  `action.range` is the reducer's pre-move gate. `preRush` re-validates from
  the landing cell (the reducer gate ran against the original position).
- **Critical hits add one extra [D]** (the generic VM convention); **bonus
  damage** (p.102) rolls an extra [D] and keeps the higher result.
- **Collide detection mirrors the reducer's `shoveResolution`** (grid edge,
  living characters, impassable grid terrain), so the collide condition fires
  exactly when the applied shove would stop early.
- **"Repeatable" and "end turn" tags are recorded**; the foe turn still
  advances via the normal END_TURN command (same as jobs). The `end-turn`
  mutation kind is what EXECUTE_RULE honors to auto-end the turn.

## 2. Wire (automatic)

- **`src/rules/automation/manual-programs.ts`** — `EXECUTABLE_FOE_ABILITY_IDS`
  is derived from the table (`new Set(Object.keys(FOE_ABILITY_RECIPES))`), and
  the `foe-ability` branch of `compileManualRuleProgram` calls
  `compileFoeAbilityRecipe(unit, recipe)`. No hand-editing per ability.
- **`src/rules/automation/resolvers.ts`** — `FOE_RULE_RESOLVERS` is built from
  the table (`<abilityId>:effects`), so the registry is always in sync.
- **`src/rules/automation/index.ts`** — already re-exports `foe-recipes.js`.

## 3. Write the replay fixture

Add scenarios to `__tests__/foe.test.ts` modeled on the existing slices:

- `foeFixture(profileId, layout)` builds the encounter via `createEncounter`,
  `actorFromCharacter(validCharacter(...))`, and `createFoeFromProfile`,
  then `START_ENCOUNTER` and `END_TURN` on the hero to hand the turn to the
  foe. The hero's `when-damaged`/`defeated` interrupts (Righteous Disdain,
  Boiling Blood) are stripped so the foe blow applies instead of being held by
  the p.107 interrupt protocol.
- Each test runs the ability through `EXECUTE_RULE` (the same command surface
  the VTT/transport use) with `scriptedDice(...)` and asserts both the golden
  `mutationsOf(result.events, sourceId)` sequence (spend → attack → damage →
  conditions, in that order) and the resulting `result.state` — and that
  `applyEvents(state, events)` replays to the identical state.
- **Dice order matters**: the attack resolver consumes d20, then the boon die
  (if any), then the hit damage dice (in formula order), then the bonus
  damage dice (two, keep highest), then the critical die. Scripted values must
  cover every consumed roll.
- First test gates the audit: every id in `EXECUTABLE_FOE_ABILITY_IDS` has a
  recipe, `compileRuleSourceUnit(unit).unsupportedClauses` is empty, and the
  table size matches the reviewed slice count.

## 4. Update docs and verify

- Note the new slice and its fidelity gaps in `docs/rules-coverage.md` and
  `docs/roadmap.md`.
- Run the full gate:

```bash
npm run typecheck
npm test
npm run build
npm run audit:automation   # read completePrograms / completeClauses / foe-ability
```

The audit numbers feed back into `__tests__/coverage.test.ts` — copy them,
don't hand-compute.
