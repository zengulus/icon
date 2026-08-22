# Job template

A job becomes "independently executable" when every one of its nine abilities
has a hand-authored typed `RuleProgram`, named deterministic resolvers, and a
source-page replay fixture — and the coverage audit stops counting it as an
unresolved `job-ability`. All sixteen current Job slices now use this recipe;
follow it when adding a future sourcebook Job so the coverage invariant stays
honest.

The shared building blocks live in `src/rules/automation/job-kit.ts`. It
consolidates the selectors, number/effect builders, mutation builders,
movement/geometry helpers, and the `clause`/`action`/`compilation` helpers the
early jobs used to inline. New jobs import from it instead of redefining them.

---

## 1. Author the program file

Create `src/rules/automation/<job>-programs.ts` from this skeleton. Keep the
job-specific work to the two exports at the bottom; everything above the
resolvers comes from the kit.

```ts
import { RuleProgramViolation } from './runtime.js';
import type { RuleSourceUnit } from '../source-units.js';
import type { RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from './types.js';
import {
  axisDirection, orthogonalNeighbors, sameCell, squareArea,
  constant, attackStep, comboCost,
  distance, sourceActor, occupied, impassable, walk, freeCellsInRange, resolveAttack, nearestFoe, ringAround,
  damageMutation, conditionMutation, stateMutation, vigorMutation, cureMutation,
  resourceMutation, stanceMutation, markMutation,
  shoveMutation, rushMutation, flyMutation, placeMutation, entityMutation, terrainMutation,
  untilNextTurnEnd, untilNextTurnStart,
  action, compilation,
} from './job-kit.js';

/**
 * Independently reviewed <Job> ability implementations (ICON p.XXX–XXX).
 * Each ability below has typed costs, targets, ranges, and tags from the
 * source catalog plus a hand-authored typed RuleProgram and a named
 * deterministic resolver.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - …call out anything the single-pass VM cannot yet express (save re-rolls,
 *   target-redirect interrupts, movement-entry triggers) and how it is modeled
 *   instead. These gaps are documented, never hidden.
 */

/** ICON p.XXX: … */
const someAbilityEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source?.position) return [];
  const mutations: RuleMutation[] = [];
  // …ability-specific, deterministic logic…
  return mutations;
};

export const STRAY_RULE_RESOLVERS: RuleResolverRegistry = {
  'stray:some-ability:effects': someAbilityEffects,
  // …one entry per named resolver…
};

export const STRAY_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'stray:some-ability': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack'],
    range: constant(1),
    resolverId: 'stray:some-ability:effects',
    steps: [{ id: 'attack', timing: 'use', effects: [attackStep()] }],
  })], ['effect', 'attack', 'on hit', 'miss']),
  // …one entry per ability sourceId (use `catalog.ts` + `source-units.ts` for ids)…
};
```

Rules of thumb baked into the kit and the existing slices:

- **Key programs by `sourceId`** (e.g. `stray:some-ability`), resolvers by
  `'<sourceId>:<step>'`.
- **Sub-actions** (combo upgrades, stance refreshes, interrupts, detonations)
  are extra `action`s on the same program with their own `resolverId`, executed
  through `EXECUTE_RULE` — the pattern Knave's combos and Fool's Party
  Favor/Gallows Humor/Cheat Time use.
- **Resolver-driven attacks** use `resolveAttack(...)` so the `attack` mutation
  matches the generic VM shape; **declarative attacks** use `attackStep(...)`.
- **Movement** goes through `walk(...)` (entity-aware, phasing flag) so it
  shares the exact geometry the VTT renders.
- Anything that is genuinely reactive across commands (a turn-start/turn-end
  lifecycle, a damage-triggered refresh) is a **reducer hook in
  `encounter.ts`**, not a VM resolver — mirror Dark Knight's hatred refresh and
  Carnevale's turn-end detonation.

## 2. Wire the four points

1. **`src/rules/automation/manual-programs.ts`**
   - Import `STRAY_ABILITY_PROGRAMS`.
   - Add all nine `stray:*` ability ids to `EXECUTABLE_JOB_ABILITY_IDS`.
   - Add the lookup to the `compileManualRuleProgram` chain:
     ```ts
     const stray = STRAY_ABILITY_PROGRAMS[unit.id];
     if (stray) return stray(unit);
     ```
2. **`src/rules/automation/resolvers.ts`**
   - Import `STRAY_RULE_RESOLVERS` and spread it into `RULE_RESOLVERS`.
3. **`src/rules/automation/index.ts`**
   - `export * from './<job>-programs.js';`
4. **Coverage gate tests**
   - The Job-suite tests and the catalog test assert the global
     `EXECUTABLE_JOB_ABILITY_IDS` set exactly equals the source catalog
     (currently `144`); when a future sourcebook adds a Job, add all nine IDs
     and update the source-cardinality fixture deliberately.
   - `coverage.test.ts` asserts the audit totals. Bump `completePrograms`
     (+9), drop `unsupportedPrograms` (−9) and `unsupportedByKind['job-ability']`
     (−9), and adjust `completeClauses` / `unsupportedClauses` by however many
     `clauseLabels` your programs declare. The authoritative numbers come from
     `npm run audit:automation` — copy them, don't hand-compute.

The new job's own test (below) also asserts exactly 9 executable ids, and the
catalog-level `content.test.ts` (`'job-ability': 144`) is **not** touched: that
is the total source-unit count, not an executability gate.

## 3. Write the replay fixture

Create `src/rules/__tests__/<job>.test.ts` modeled on `fool.test.ts`:

- A `board()` helper builds an encounter via `createEncounter`,
  `actorFromCharacter(validCharacter(...))`, and `createFoe`, then
  `START_ENCOUNTER`.
- Give the hero `abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS]` and a chapter.
- Each test runs one ability through `executeCommand` with `scriptedDice(...)`
  and asserts both the golden `mutationsOf(result.events, sourceId)` sequence
  and the resulting `result.state` — and that `applyEvents(state, events)`
  replays to the identical state.
- Sub-actions run through `EXECUTE_RULE` with the matching `sourceId`,
  `actionId`, and `timing`.
- First test gates the audit: every `stray:*` id is in
  `EXECUTABLE_JOB_ABILITY_IDS`, `automation === 'executable'` in the catalog,
  and `compileRuleSourceUnit(unit).unsupportedClauses` is empty.

## 4. Update docs and verify

- Note the new set and its fidelity gaps in `docs/rules-coverage.md` and
  `docs/roadmap.md` (exact counts are already pinned by the tests).
- Run the full gate:

```bash
npm run typecheck
npm test
npm run build
npm run audit:automation   # read completePrograms / completeClauses / job-ability
```

All four must be green; the audit numbers feed back into step 2.4.
