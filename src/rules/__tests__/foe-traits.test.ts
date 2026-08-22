import { describe, expect, it } from 'vitest';
import { compileRuleSourceUnit } from '../automation/compiler.js';
import { encounterConditionSet } from '../automation/encounter-adapter.js';
import { FOE_TRAIT_MOVEMENT_RECIPES, foeTraitMovementRecipe, projectedFoeTraitMovementConditions } from '../automation/foe-trait-recipes.js';
import { isIndependentlyExecutableManualProgram } from '../automation/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, createFoeFromProfile, executeCommand } from '../encounter.js';
import { FOE_PROFILES } from '../foes.js';
import { planMovementPath } from '../movement.js';
import { collectRuleSourceUnits } from '../source-units.js';
import type { Position, TerrainCell } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

const movementTraitTexts = new Set(['Flying', 'Phasing', 'Flying, Phasing', 'Phasing, Flying']);

/**
 * This is an audit of the fixed source artifact, not a runtime parser.  The
 * application projects only FOE_TRAIT_MOVEMENT_RECIPES' source IDs.
 */
function sourceMovementTraits() {
  return collectRuleSourceUnits()
    .filter((unit) => unit.kind === 'foe-trait' && movementTraitTexts.has(unit.rulesText))
    .sort((left, right) => left.id.localeCompare(right.id));
}

describe('audited foe-trait movement projections', () => {
  it('projects all and only the 36 reviewed source IDs, with exact source text', () => {
    const recipes = Object.entries(FOE_TRAIT_MOVEMENT_RECIPES).sort(([left], [right]) => left.localeCompare(right));
    const sourceTraits = collectRuleSourceUnits().filter((unit) => unit.kind === 'foe-trait');

    // 19 Flying-only + 14 Phasing-only + 3 both. Smoke Demon's p.410
    // `Phasing, Flying` is deliberately retained: order does not change its
    // two reviewed mechanics.
    expect(recipes).toHaveLength(36);
    expect(sourceMovementTraits().map(({ id }) => id)).toEqual(recipes.map(([id]) => id));

    for (const [id, recipe] of recipes) {
      const source = sourceTraits.find((unit) => unit.id === id);
      expect(source, id).toBeDefined();
      expect(source?.rulesText, id).toBe(recipe.rulesText);

      const profileTrait = FOE_PROFILES.flatMap((profile) => profile.traits).find((trait) => trait.id === id);
      expect(profileTrait?.automation, id).toBe('executable');

      const compilation = compileRuleSourceUnit(source!);
      expect(compilation.unsupportedClauses, id).toEqual([]);
      expect(compilation.program.actions).toHaveLength(1);
      expect(compilation.program.actions[0]).toMatchObject({ timing: 'passive', tags: recipe.conditions });
      expect(compilation.program.actions[0]?.steps[0]?.effects.map((effect) => effect.kind === 'condition' ? effect.conditionId : null), id).toEqual(recipe.conditions);

      const actor = createFoe('Trait projection fixture', { x: 1, y: 1 });
      actor.traitIds = [id];
      expect([...encounterConditionSet(actor)].filter((condition) => condition === 'flying' || condition === 'phasing'), id).toEqual(recipe.conditions);

      // These are durable passive projections, not newly opened active VM
      // authority. A client cannot invoke them through EXECUTE_RULE.
      expect(isIndependentlyExecutableManualProgram(id), id).toBe(false);
    }

    // Every source trait outside the explicit manifest remains unprojected.
    // This includes all ten exact `Sturdy` traits and all mixed/conditional
    // prose that happens to mention flight or phasing.
    for (const source of sourceTraits.filter(({ id }) => foeTraitMovementRecipe(id) === null)) {
      expect(projectedFoeTraitMovementConditions(source.id), source.id).toEqual([]);
      const profileTrait = FOE_PROFILES.flatMap((profile) => profile.traits).find((trait) => trait.id === source.id);
      expect(profileTrait?.automation, source.id).toBe('structured');
      expect(compileRuleSourceUnit(source).unsupportedClauses.length, source.id).toBeGreaterThan(0);
    }
    const sturdy = sourceTraits.filter(({ rulesText }) => rulesText === 'Sturdy');
    expect(sturdy).toHaveLength(10);
    for (const source of sturdy) expect(projectedFoeTraitMovementConditions(source.id), source.id).toEqual([]);
  });
});

interface ProfileMovementFixture {
  profileId: string;
  expectedConditions: readonly ('flying' | 'phasing')[];
  terrain: TerrainCell[];
  path: Position[];
  expectedPlan: { cost: number; dangerousDamage: number };
}

function activeProfileFoe(profileId: string, terrain: TerrainCell[]) {
  let state = createEncounter('Foe trait movement fixture');
  state = { ...state, grid: { ...state.grid, width: 8, height: 8, terrain } };
  const hero = actorFromCharacter(validCharacter('Movement witness'), { x: 7, y: 7 });
  const foe = createFoeFromProfile(profileId, { x: 1, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  state = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
  return { state, foe: state.actors[foe.id]! };
}

const profileMovementFixtures: readonly ProfileMovementFixture[] = [
  {
    profileId: 'basic:hellion:302',
    expectedConditions: ['flying'],
    terrain: [
      { position: { x: 2, y: 1 }, type: 'impassable', elevation: 3 },
      { position: { x: 3, y: 1 }, type: 'dangerous', elevation: 0 },
    ],
    path: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
    expectedPlan: { cost: 3, dangerousDamage: 0 },
  },
  {
    profileId: 'basic:shadow:303',
    expectedConditions: ['phasing'],
    terrain: [
      { position: { x: 2, y: 1 }, type: 'impassable', elevation: 0 },
      { position: { x: 3, y: 1 }, type: 'dangerous', elevation: 0 },
    ],
    path: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
    expectedPlan: { cost: 3, dangerousDamage: 2 },
  },
  {
    // This profile's source says `Phasing, Flying`; both conditions must be
    // projected even though their source order differs from Wraith/Swarm.
    profileId: 'demon:smoke-demon:410',
    expectedConditions: ['phasing', 'flying'],
    terrain: [
      { position: { x: 2, y: 1 }, type: 'impassable', elevation: 3 },
      { position: { x: 3, y: 1 }, type: 'dangerous', elevation: 0 },
    ],
    path: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
    expectedPlan: { cost: 3, dangerousDamage: 0 },
  },
];

for (const fixture of profileMovementFixtures) {
  it(`${fixture.profileId} projects its trait into deterministic movement and replay`, () => {
    const { state, foe } = activeProfileFoe(fixture.profileId, fixture.terrain);
    expect([...encounterConditionSet(foe)].filter((condition) => condition === 'flying' || condition === 'phasing')).toEqual(fixture.expectedConditions);

    const plan = planMovementPath(state, foe.id, fixture.path, 'standard');
    expect(plan).toMatchObject({ legal: true, ...fixture.expectedPlan });
    // The path's first step proves the profile can pass through an impassable
    // space; Flying additionally suppresses dangerous-terrain damage.
    expect(plan.steps[0]).toMatchObject({ to: fixture.path[0] });

    const moved = executeCommand(state, { type: 'MOVE', actorId: foe.id, path: fixture.path, mode: 'standard' }, scriptedDice());
    expect(moved.events[0]).toMatchObject({ type: 'ACTOR_MOVED', actorId: foe.id, path: fixture.path, dangerousDamage: fixture.expectedPlan.dangerousDamage });
    expect(moved.state.actors[foe.id]?.position).toEqual(fixture.path.at(-1));
    expect(applyEvents(state, moved.events)).toEqual(moved.state);
  });
}
