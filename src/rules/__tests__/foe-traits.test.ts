import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { determineAndApplyEncounterDamage, determineEncounterDamage, encounterConditionSet } from '../automation/kernels/encounter-adapter.js';
import { FOE_TRAIT_KEYWORD_RECIPES } from '../automation/content/foes/trait-recipes.js';
import {
  durableFoeTraitGrantConditions,
  foeTraitKeywordRecipe,
  isFullyExecutableFoeTraitRecipe,
  parseFoeTraitKeywordList,
  projectedFoeTraitConditions,
  projectedFoeTraitStats,
} from '../automation/kernels/foe-trait-recipes.js';
import { isIndependentlyExecutableManualProgram } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, createFoeFromProfile, executeCommand } from '../encounter.js';
import { FOE_PROFILES } from '../foes.js';
import { planMovementPath } from '../movement.js';
import { collectRuleSourceUnits, findRuleSourceUnit } from '../source-units.js';
import type { EncounterState, Position, TerrainCell } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * Foe special-traits keyword projections (ICON p.298 glossary + p.104
 * positive effects).
 *
 * The closed manifest in `content/foes/trait-recipes.ts` maps the exact
 * comma-separated keyword list of each reviewed source trait to durable
 * effects: projected conditions, durable combat-start grants (Defiance),
 * structured stats (Size/Armor/Speed), role-baseline keywords (Guard), and
 * explicitly pending keywords (Counter/Diaga/p.92 Size footprint) that keep
 * a row honestly incomplete in the audit while its wired keywords still
 * project.
 */

/** A minimal active encounter with a hero and one profile foe. */
function traitFixture(profileId: string, foeAt: Position, heroAt: Position): { state: EncounterState; heroId: string; foeId: string } {
  let state = createEncounter('Foe trait fixture');
  const hero = actorFromCharacter(validCharacter('Trait witness'), heroAt);
  const foe = createFoeFromProfile(profileId, foeAt);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, heroId: hero.id, foeId: foe.id };
}

describe('audited foe-trait keyword manifest (p.298/p.104)', () => {
  it('every registered row matches its exact source keyword list and is internally consistent', () => {
    const sourceTraits = collectRuleSourceUnits().filter((unit) => unit.kind === 'foe-trait');
    for (const [id, recipe] of Object.entries(FOE_TRAIT_KEYWORD_RECIPES)) {
      const source = sourceTraits.find((unit) => unit.id === id);
      expect(source, id).toBeDefined();
      const keywords = recipe.effects.map((effect) => effect.keyword);
      // Exact text: the row can only fire on the reviewed source text.
      expect(parseFoeTraitKeywordList(source!.rulesText), id).toEqual(keywords);
      expect(recipe.effects.length, id).toBeGreaterThan(0);
      expect(new Set(keywords).size, id).toBe(keywords.length);
      // The parent profile must actually carry the trait.
      const profileTrait = FOE_PROFILES.flatMap((profile) => profile.traits).find((trait) => trait.id === id);
      expect(profileTrait, id).toBeDefined();
    }
  });

  it('fully executable rows audit complete, mark the trait executable, and project their wired effects', () => {
    const sourceTraits = collectRuleSourceUnits().filter((unit) => unit.kind === 'foe-trait');
    for (const [id, recipe] of Object.entries(FOE_TRAIT_KEYWORD_RECIPES)) {
      const source = sourceTraits.find((unit) => unit.id === id)!;
      const profileTrait = FOE_PROFILES.flatMap((profile) => profile.traits).find((trait) => trait.id === id);
      const compilation = compileRuleSourceUnit(source);
      if (isFullyExecutableFoeTraitRecipe(id)) {
        expect(profileTrait?.automation, id).toBe('executable');
        expect(compilation.unsupportedClauses, id).toEqual([]);
        const conditions = recipe.effects.filter((effect) => effect.kind === 'condition').map((effect) => effect.condition);
        expect(compilation.program.actions[0], id).toMatchObject({ timing: 'passive', tags: conditions });
        // The compiled clause carries the projected conditions only.
        expect(compilation.clauses[0]?.effects.map((effect) => effect.kind === 'condition' ? effect.conditionId : null), id).toEqual(conditions);
        // Projected conditions reach every condition-set consumer through the fold.
        const actor = createFoe('Trait projection fixture', { x: 1, y: 1 });
        actor.traitIds = [id];
        for (const condition of conditions) {
          expect(encounterConditionSet(actor).has(condition), `${id}:${condition}`).toBe(true);
        }
        // These are durable passive projections, not newly opened active VM
        // authority. A client cannot invoke them through EXECUTE_RULE.
        expect(isIndependentlyExecutableManualProgram(id), id).toBe(false);
      } else {
        expect(profileTrait?.automation, id).toBe('structured');
        expect(compilation.unsupportedClauses.length, id).toBeGreaterThan(0);
        // A partial row still projects its wired subset — its unsupported text
        // names the pending keyword rather than failing the whole row.
        const actor = createFoe('Partial projection fixture', { x: 1, y: 1 });
        actor.traitIds = [id];
        for (const condition of recipe.effects.filter((effect) => effect.kind === 'condition').map((effect) => effect.condition)) {
          expect(encounterConditionSet(actor).has(condition), `${id}:${condition}`).toBe(true);
        }
      }
    }
  });

  it('applies p.298 Size/Armor/Speed keywords durably at profile construction and replays them', () => {
    const brute = createFoeFromProfile('basic:brute:300', { x: 1, y: 1 });
    expect(brute.size).toBe(2); // "Sturdy, Size 2"
    expect(brute.conditions.some(({ id }) => id === 'sturdy')).toBe(false); // Sturdy is projected, not durable

    const crab = createFoeFromProfile('ruin-beast:megacrab:352', { x: 1, y: 1 });
    expect(crab.armor).toBe(10); // "Size 2, Armor 10"

    const baggoth = createFoeFromProfile('ruin-beast:baggoth:347', { x: 1, y: 1 });
    expect(baggoth.speed).toBe(2); // "S ize 3, Speed 2, Sturdy"
    expect(baggoth.size).toBe(3);

    const evictor = createFoeFromProfile('relict:lord-evictor:341', { x: 1, y: 1 });
    expect(evictor.armor).toBe(2); // "Sturdy, Rampart, Armor 2"

    // The durable actor fields ride the ADD_ACTOR event, so replay produces
    // the same stats without re-deriving anything.
    let state = createEncounter('Foe stat replay fixture');
    const added = executeCommand(state, { type: 'ADD_ACTOR', actor: crab });
    expect(added.state.actors[crab.id]?.armor).toBe(10);
    expect(applyEvents(createEncounter('Foe stat replay fixture'), added.events).actors[crab.id]?.armor).toBe(10);
  });

  it('grants Defiance durably at combat start and consumes it exactly once (p.104), replay-safe', () => {
    const { state, heroId, foeId } = traitFixture('basic:berserker:301', { x: 2, y: 1 }, { x: 8, y: 8 });
    const foe = state.actors[foeId]!;
    // The durable grant landed on ENCOUNTER_STARTED — it is not a projection.
    expect(durableFoeTraitGrantConditions('basic:berserker:301:trait:special-traits')).toEqual(['defiance']);
    expect(foe.conditions.some(({ id }) => id === 'defiance')).toBe(true);
    expect(projectedFoeTraitConditions('basic:berserker:301:trait:special-traits')).toEqual([]);

    foe.hp = 1;
    determineAndApplyEncounterDamage(state, {
      targetId: foeId, sourceActorId: heroId, sourceRuleId: 'fixture', amount: 50,
      damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
    });
    expect(state.actors[foeId]!.hp).toBe(1); // Defiance floors the blow
    expect(state.actors[foeId]!.conditions.some(({ id }) => id === 'defiance')).toBe(false); // consumed
    expect(state.actors[foeId]!.ruleState['damage-immune']).toBe(true); // immune for the rest of the turn
    // The projection fold must not resurrect the consumed condition.
    expect(encounterConditionSet(state.actors[foeId]!).has('defiance')).toBe(false);

    determineAndApplyEncounterDamage(state, {
      targetId: foeId, sourceActorId: heroId, sourceRuleId: 'fixture', amount: 50,
      damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
    });
    expect(state.actors[foeId]!.hp).toBe(1); // the turn-end immunity holds

    // Replay from the recorded event log grants the same durable condition.
    let fresh = createEncounter('Foe defiance replay fixture');
    fresh = executeCommand(fresh, { type: 'ADD_ACTOR', actor: actorFromCharacter(validCharacter('Replay witness'), { x: 8, y: 8 }) }).state;
    fresh = executeCommand(fresh, { type: 'ADD_ACTOR', actor: createFoeFromProfile('basic:berserker:301', { x: 2, y: 1 }) }).state;
    const started = executeCommand(fresh, { type: 'START_ENCOUNTER' });
    expect(started.state.actors[Object.keys(started.state.actors)[0]]!).toBeDefined();
    const replayed = applyEvents(fresh, started.events);
    const berserker = Object.values(replayed.actors).find((actor) => actor.foeProfileId === 'basic:berserker:301');
    expect(berserker?.conditions.some(({ id }) => id === 'defiance')).toBe(true);
  });

  it('Sturdy caps foe-driven shoves at 1 for keyword-sturdy profiles (p.104)', () => {
    const { state, heroId, foeId } = traitFixture('basic:brute:300', { x: 2, y: 1 }, { x: 1, y: 1 });
    // Bastion Battering Ram (p.122) shoves an adjacent character 2.
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:battering-ram', targetIds: [foeId] }, scriptedDice());
    expect(result.state.actors[foeId]!.position).toEqual({ x: 3, y: 1 }); // 2 → 1, the sturdy cap
    expect(applyEvents(state, result.events)).toEqual(result.state);

    // Control: a non-sturdy warrior is shoved the full 2.
    const control = traitFixture('basic:warrior:300', { x: 2, y: 1 }, { x: 1, y: 1 });
    const controlResult = executeCommand(control.state, { type: 'USE_ABILITY', actorId: control.heroId, abilityId: 'bastion:battering-ram', targetIds: [control.foeId] }, scriptedDice());
    expect(controlResult.state.actors[control.foeId]!.position).toEqual({ x: 4, y: 1 });
    expect(applyEvents(control.state, controlResult.events)).toEqual(controlResult.state);
  });

  it('Armor 10 keyword reduces damage through the shared kernel', () => {
    const crab = createFoeFromProfile('ruin-beast:megacrab:352', { x: 1, y: 1 });
    const state = executeCommand(createEncounter('Armor fixture'), { type: 'ADD_ACTOR', actor: crab }).state;
    const determined = determineEncounterDamage(state, {
      targetId: crab.id, sourceRuleId: 'fixture', amount: 15,
      damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
    });
    // Effective armor = keyword Armor 10 + the heavy role's own Guard
    // baseline of 2 (p.298: "reduces damage to self and orthogonally
    // adjacent allies by 2 as armor").
    expect(determined.amount).toBe(3);
  });

  it('Immobile keyword denies core movement (p.104 special state)', () => {
    const kinfisher = createFoeFromProfile('ruin-beast:kinfisher:355', { x: 1, y: 1 });
    expect(kinfisher.size).toBe(2); // "Immobile, Size 2"
    const { state, heroId, foeId } = traitFixture('ruin-beast:kinfisher:355', { x: 1, y: 1 }, { x: 8, y: 8 });
    // The movement planner only lets the active actor move, so the foe must
    // be on turn for its Immobile denial to be observable.
    const foeTurn = executeCommand(state, { type: 'END_TURN', actorId: heroId }, scriptedDice()).state;
    const plan = planMovementPath(foeTurn, foeId, [{ x: 2, y: 1 }], 'standard');
    expect(plan.legal).toBe(false);
    expect(plan.issue?.code).toBe('move.immobile');
    expect(kinfisher.size).toBe(2);
  });

  it('Regeneration keyword grants 4 vigor at the bloodied end of turn (p.104)', () => {
    const fixture = traitFixture('scavenger:blood-broker:370', { x: 1, y: 1 }, { x: 8, y: 8 });
    let state = executeCommand(fixture.state, { type: 'END_TURN', actorId: fixture.heroId }, scriptedDice()).state;
    const foe = state.actors[fixture.foeId]!;
    foe.hp = 1; // bloodied
    foe.vigor = 0;
    const ended = executeCommand(state, { type: 'END_TURN', actorId: fixture.foeId }, scriptedDice());
    expect(ended.state.actors[fixture.foeId]!.vigor).toBe(4);
    expect(applyEvents(state, ended.events)).toEqual(ended.state);
  });

  it('Skirmisher keyword grants diagonal movement and full-speed dash (p.298)', () => {
    const { state, heroId, foeId } = traitFixture('basic:nocturnal:310', { x: 1, y: 1 }, { x: 8, y: 8 });
    expect(encounterConditionSet(state.actors[foeId]!).has('skirmisher')).toBe(true);
    const foeTurn = executeCommand(state, { type: 'END_TURN', actorId: heroId }, scriptedDice()).state;
    const diagonal = planMovementPath(foeTurn, foeId, [{ x: 2, y: 2 }], 'standard');
    expect(diagonal.legal).toBe(true);

    // Control: a warrior without the keyword cannot move diagonally.
    const control = traitFixture('basic:warrior:300', { x: 1, y: 1 }, { x: 8, y: 8 });
    const controlTurn = executeCommand(control.state, { type: 'END_TURN', actorId: control.heroId }, scriptedDice()).state;
    const blocked = planMovementPath(controlTurn, control.foeId, [{ x: 2, y: 2 }], 'standard');
    expect(blocked.legal).toBe(false);
    expect(blocked.issue?.code).toBe('move.orthogonal');
  });

  it('Speed 2 keyword lowers the standard-move allowance', () => {
    const { state, heroId, foeId } = traitFixture('ruin-beast:baggoth:347', { x: 1, y: 1 }, { x: 8, y: 8 });
    expect(state.actors[foeId]!.speed).toBe(2);
    const foeTurn = executeCommand(state, { type: 'END_TURN', actorId: heroId }, scriptedDice()).state;
    const two = planMovementPath(foeTurn, foeId, [{ x: 2, y: 1 }, { x: 3, y: 1 }], 'standard');
    expect(two.legal).toBe(true);
    const three = planMovementPath(foeTurn, foeId, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }], 'standard');
    expect(three.legal).toBe(false);
    expect(three.issue?.code).toBe('move.too-far');
  });

  it('Guard keyword rows are the heavy role baseline and mark their profiles executable', () => {
    for (const profileId of ['scavenger:boots:380', 'scavenger:fixer:380']) {
      const profile = FOE_PROFILES.find(({ id }) => id === profileId);
      expect(profile, profileId).toBeDefined();
      expect(profile?.roleId).toBe('heavy'); // Guard is the heavy role baseline
      const trait = profile!.traits.find((trait) => trait.id === `${profileId}:trait:traits`);
      expect(trait?.automation).toBe('executable');
      const compilation = compileRuleSourceUnit(findRuleSourceUnit(`${profileId}:trait:traits`)!);
      expect(compilation.unsupportedClauses).toEqual([]);
    }
  });

  it('Doomcloak is fully executable (Flying, Sturdy, Counter, Defiance all wired)', () => {
    const doomcloak = findRuleSourceUnit('ruin-beast:doomcloak:353:trait:special-traits')!;
    const compilation = compileRuleSourceUnit(doomcloak);
    expect(compilation.unsupportedClauses).toEqual([]);
    const actor = createFoe('Doomcloak projection fixture', { x: 1, y: 1 });
    actor.traitIds = [doomcloak.id];
    const conditions = encounterConditionSet(actor);
    expect(conditions.has('flying')).toBe(true);
    expect(conditions.has('sturdy')).toBe(true);
    expect(conditions.has('counter')).toBe(true);
    expect(conditions.has('defiance')).toBe(false); // durable: granted at combat start
    expect(durableFoeTraitGrantConditions(doomcloak.id)).toEqual(['defiance']);

    // Broker: Diaga, Defiance — the Diaga Leader cure stays pending.
    const broker = findRuleSourceUnit('scavenger:broker:381:trait:traits')!;
    expect(compileRuleSourceUnit(broker).unsupportedClauses[0]?.unsupportedText).toContain('Diaga');
    expect(durableFoeTraitGrantConditions(broker.id)).toEqual(['defiance']);
  });

  it('wired Counter rows project the condition and the reflect takes 2 (p.104)', () => {
    let state = createEncounter('Counter fixture');
    const hero = actorFromCharacter(validCharacter('Counter witness'), { x: 2, y: 1 });
    const foe = createFoe('Howler Counter fixture', { x: 1, y: 1 });
    foe.traitIds = ['ruin-beast:howler:346:trait:special-traits'];
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
    expect(encounterConditionSet(state.actors[foe.id]!).has('counter')).toBe(true);
    // The fixture hero has Armor 2, which absorbs the raw 2 Counter reflect.
    // Strip the armor so the reflect provably lands back on the attacker (the
    // resolver-driven reflect itself is covered in conditions.test.ts).
    const heroActor = state.actors[hero.id]!;
    heroActor.armor = 0;
    determineAndApplyEncounterDamage(state, {
      targetId: foe.id,
      sourceActorId: hero.id,
      sourceRuleId: 'test:strike',
      amount: 3,
      damageType: 'normal',
      instance: 1,
      delivery: 'hit',
      ignoreCover: false,
    });
    expect(state.actors[foe.id]!.hp).toBe(32 - 3); // the Counter foe took the 3
    expect(state.actors[hero.id]!.hp).toBe(40 - 2); // and reflected 2 back (armor stripped)
  });

  it('keeps every unregistered keyword-list trait unprojected (closed negative)', () => {
    const sourceTraits = collectRuleSourceUnits().filter((unit) => unit.kind === 'foe-trait');
    for (const source of sourceTraits) {
      if (foeTraitKeywordRecipe(source.id)) continue;
      expect(projectedFoeTraitConditions(source.id), source.id).toEqual([]);
      expect(projectedFoeTraitStats([source.id]), source.id).toEqual({});
      expect(durableFoeTraitGrantConditions(source.id), source.id).toEqual([]);
      expect(compileRuleSourceUnit(source).unsupportedClauses.length, source.id).toBeGreaterThan(0);
    }
    // The specific keyword-list rows without a projection: Mob, Enrage, and
    // the Leader Diaga rows stay source-visible.
    for (const id of [
      'basic:minions:311:trait:traits', // Mob
      'ruin-beast:brawler-beast:346:trait:special-traits', // Enrage
      'scavenger:sharkie:381:trait:traits', // Diaga
      'scavenger:monger:381:trait:traits', // Diaga
      'ruin-beast:symbiote:348:trait:traits', // Shelter, Diaga
    ]) {
      expect(foeTraitKeywordRecipe(id), id).toBeNull();
      expect(projectedFoeTraitConditions(id), id).toEqual([]);
      expect(compileRuleSourceUnit(findRuleSourceUnit(id)!).unsupportedClauses.length, id).toBeGreaterThan(0);
    }
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
