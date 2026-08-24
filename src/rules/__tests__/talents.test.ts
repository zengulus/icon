import { describe, expect, it } from 'vitest';
import { collectRuleSourceUnits } from '../source-units.js';
import { getDocumentedTalentIds, getTalentRecipes } from '../automation/content/jobs/talent-recipes.js';
import { getExecutableTalentIds, isExecutableTalent, talentTriggerMutations } from '../automation/kernels/talent-recipes.js';
import '../automation/content/registry.js';
import { collidingShoveTargets } from '../automation/kernels/encounter-adapter.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, createFoeFromProfile, executeCommand } from '../encounter.js';
import type { RuleMutation } from '../automation/primitives/types.js';
import type { EncounterActor, EncounterEvent, EncounterState, StatusSaveCommandInput, TerrainCell } from '../types.js';

/** The USE_ABILITY command surface deliberately exposes only Blessing choices
 * on its `input` (the protocol keeps tactical selector input authoritative
 * reducer state), so the fixtures cast the Party Favor resolver's explicit
 * mine placement through — the runtime VM reads it exactly as a real client
 * would once the protocol permits tactical inputs. */
const minePlacement = (position: { x: number; y: number }): StatusSaveCommandInput =>
  ({ positions: { 'mine-position': [position] } }) as unknown as StatusSaveCommandInput;
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * F7 talent fixtures (docs/rules-foundations.md §8).
 *
 * `talent-recipes.ts` is the closed 288-row inventory (two talents per
 * ability). The wired tranche executes through the shared
 * `talentTriggerMutations` fold: a talent declares a trigger-effect
 * (`exceed` — the ability's attack roll totals 15+; `comeback` — the user is
 * bloodied; `finishing-blow` — the ability targets a bloodied foe, with
 * per-row condition overrides for extended eligibility; `slay` / `collide` —
 * post-application triggers decided by the same reactive dry run that
 * derives the ability's own clauses) and the effect mutations ride the
 * ability's RULE_MUTATIONS_APPLIED event, so replay applies exactly what the
 * command decided. Documented rows stay source-visible with their kernel
 * need. Each behavior has a control (the same ability without the talent,
 * or the trigger not firing), a replay pair, and the closed-registry
 * negatives pin that documented talents are never executable.
 */

interface TalentFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally?: EncounterActor;
}

function talentEncounter(abilityId: string, talent: 1 | 2, options: { heroAt?: { x: number; y: number }; foeAt?: { x: number; y: number }; allyAt?: { x: number; y: number }; bloodied?: boolean; plainFoe?: boolean; terrainCells?: TerrainCell[]; extraFoes?: Array<{ name?: string; at: { x: number; y: number } }> } = {}): TalentFixture {
  let state = createEncounter('Talent fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), options.heroAt ?? { x: 1, y: 1 });
  hero.abilityIds = [abilityId];
  hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
  hero.talents = { [abilityId]: talent };
  hero.chapter = 3;
  if (options.bloodied) hero.hp = 1;
  // A profile foe carries its role baseline (dodge on skirmishers, armor on
  // heavies); the plain generic foe (armor 0, no traits) keeps blast-damage
  // fixtures about the blast.
  const foe = options.plainFoe
    ? createFoe('Knuckle', options.foeAt ?? { x: 3, y: 1 })
    : createFoeFromProfile('basic:knuckle:301', options.foeAt ?? { x: 3, y: 1 }, 4);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  for (const extra of options.extraFoes ?? []) {
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: createFoe(extra.name ?? 'Knuckle two', extra.at) }).state;
  }
  if (options.allyAt) {
    const ally = actorFromCharacter(validCharacter('Rook'), options.allyAt);
    ally.id = 'actor:rook'; // validCharacter shares the hero's timestamp-derived id
    ally.characterId = 'rook';
    ally.abilityIds = [];
    ally.traitIds = ally.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  }
  for (const cell of options.terrainCells ?? []) {
    state = executeCommand(state, { type: 'SET_TERRAIN', cell }).state;
  }
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  const ally = options.allyAt ? Object.values(state.actors).find((actor) => actor.id !== hero.id && actor.side === 'heroes' && actor.id !== foe.id) : undefined;
  return { state, hero, foe, ally };
}

/** The talent-declared mutations on a command's events (sourceId ends with
 * `:talent:1` or `:talent:2`). */
const talentMutationsOf = (result: ReturnType<typeof executeCommand>, abilityId: string) =>
  result.events.flatMap((event) => event.type === 'RULE_MUTATIONS_APPLIED' && event.sourceId === abilityId
    ? event.mutations.filter((mutation) => 'sourceId' in mutation && typeof mutation.sourceId === 'string' && /:talent:[12]$/.test(mutation.sourceId))
    : []);

describe('F7 closed talent inventory', () => {
  it('covers exactly the 288 source talents with 29 wired / 4 program-level / 3 passive-projection / 252 documented', () => {
    const units = collectRuleSourceUnits();
    const sourceIds = units.filter((unit) => unit.kind === 'talent').map((unit) => unit.id);
    const recipes = getTalentRecipes(units);
    expect(Object.keys(recipes)).toHaveLength(288);
    expect(Object.keys(recipes).sort()).toEqual([...sourceIds].sort());
    // F7 + aura + HP-threshold: the three passive-projection rows (Rook t1,
    // Dervish t1, Gentleness t1) are continuous aura-membership projections,
    // not fold triggers or program-emitted variants.
    expect(getExecutableTalentIds().size).toBe(36);
    expect(getDocumentedTalentIds(units).size).toBe(252);
    for (const recipe of Object.values(recipes)) {
      expect(recipe.abilityId).toBeTruthy();
      if (recipe.status === 'wired') expect(recipe.triggerEffect).toBeDefined();
      else expect(recipe.triggerEffect).toBeUndefined();
    }
    // The program-level rows (Demon Cutter t2's pre-ability rush, Draken
    // Cross t2's charged medium blasts, Pyre t1's comeback ally immunity,
    // Divine Aegis t2's quarter-HP defiance) are executable through their
    // ability programs but carry no fold trigger-effect of their own.
    expect(recipes['demon-slayer:demon-cutter:talent:2']?.status).toBe('program-level');
    expect(recipes['demon-slayer:draken-cross:talent:2']?.status).toBe('program-level');
    expect(recipes['enochian:pyre:talent:1']?.status).toBe('program-level');
    expect(recipes['sealer:divine-aegis:talent:2']?.status).toBe('program-level');
  });

  it('a documented talent is never executable (closed negative)', () => {
    const units = collectRuleSourceUnits();
    const documented = [...getDocumentedTalentIds(units)][0];
    expect(isExecutableTalent(documented)).toBe(false);
  });
});

describe('F7 exceed trigger (attack roll 15+)', () => {
  it('Demon Cutter talent 1: an exceed roll gains 6 vigor, a low roll gains none', () => {
    const { state, hero, foe } = talentEncounter('demon-slayer:demon-cutter', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const exceed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(20, 6, 3));
    expect(talentMutationsOf(exceed, 'demon-slayer:demon-cutter')).toHaveLength(1);
    expect(exceed.state.actors[hero.id].vigor).toBe(6);
    expect(applyEvents(state, exceed.events)).toEqual(exceed.state); // replay

    const noExceed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(8, 6, 3));
    expect(talentMutationsOf(noExceed, 'demon-slayer:demon-cutter')).toHaveLength(0);
    expect(noExceed.state.actors[hero.id].vigor).toBe(0);
  });

  it('Strafe Shot talent 1: an exceed roll grants evasion until the start of your next turn', () => {
    const { state, hero, foe } = talentEncounter('freelancer:strafe-shot', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 4, y: 1 } });
    const exceed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:strafe-shot', targetIds: [foe.id] }, scriptedDice(20, 6));
    const evasion = exceed.state.actors[hero.id].conditions.find(({ id }) => id === 'evasion');
    expect(evasion).toBeDefined();
    expect(evasion?.sourceId).toBe('freelancer:strafe-shot:talent:1');
    expect(evasion?.duration?.kind).toBe('turn-start');
    expect(applyEvents(state, exceed.events)).toEqual(exceed.state); // replay

    const noExceed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:strafe-shot', targetIds: [foe.id] }, scriptedDice(8, 6));
    expect(noExceed.state.actors[hero.id].conditions.some(({ id }) => id === 'evasion')).toBe(false);
  });
});

describe('F7 comeback trigger (user bloodied)', () => {
  it('Low Blow talent 2: while bloodied the user gains vigilance +1, otherwise none', () => {
    const { state, hero, foe } = talentEncounter('knave:low-blow', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, bloodied: true });
    const comeback = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:low-blow', targetIds: [foe.id] }, scriptedDice(20, 6, 3));
    expect(talentMutationsOf(comeback, 'knave:low-blow')).toHaveLength(1);
    expect(comeback.state.actors[hero.id].resources.vigilance).toBe(1);
    expect(applyEvents(state, comeback.events)).toEqual(comeback.state); // replay

    const full = talentEncounter('knave:low-blow', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 } });
    const notBloodied = executeCommand(full.state, { type: 'USE_ABILITY', actorId: full.hero.id, abilityId: 'knave:low-blow', targetIds: [full.foe.id] }, scriptedDice(20, 6, 3));
    expect(talentMutationsOf(notBloodied, 'knave:low-blow')).toHaveLength(0);
    expect(notBloodied.state.actors[full.hero.id].resources.vigilance ?? 0).toBe(0);
  });

  it('Blazing Bond talent 2: while bloodied the user and the bonded ally gain defiance', () => {
    const { state, hero, ally, foe } = talentEncounter('enochian:blazing-bond', 2, { heroAt: { x: 1, y: 1 }, allyAt: { x: 3, y: 1 }, foeAt: { x: 5, y: 1 }, bloodied: true });
    const allyId = Object.values(state.actors).find((actor) => actor.id !== hero.id && actor.id !== foe.id)!.id;
    const comeback = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:blazing-bond', targetIds: [allyId] }, scriptedDice());
    expect(comeback.state.actors[hero.id].conditions.some(({ id, sourceId }) => id === 'defiance' && sourceId === 'enochian:blazing-bond:talent:2')).toBe(true);
    expect(comeback.state.actors[allyId].conditions.some(({ id, sourceId }) => id === 'defiance' && sourceId === 'enochian:blazing-bond:talent:2')).toBe(true);
    expect(applyEvents(state, comeback.events)).toEqual(comeback.state); // replay
    expect(ally?.id).toBeTruthy();
  });

  it('an un-equipped talent never folds (no talent map entry)', () => {
    const { state, hero, foe } = talentEncounter('knave:low-blow', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, bloodied: true });
    const withoutTalent = { ...state, actors: { ...state.actors, [hero.id]: { ...state.actors[hero.id], talents: {} } } };
    const result = executeCommand(withoutTalent, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:low-blow', targetIds: [foe.id] }, scriptedDice(20, 6, 3));
    expect(talentMutationsOf(result, 'knave:low-blow')).toHaveLength(0);
  });
});

describe('F7 slay trigger (post-application: the ability defeats a foe)', () => {
  it('Umbra talent 1: slaying a foe grants defiance, a non-slay does not', () => {
    const { state, hero, foe } = talentEncounter('shade:umbra', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    // Bring the foe to 3 HP so the d6+fray hit defeats it regardless of the
    // knuckle's armor / adjacent-space resistance math.
    state.actors[foe.id].hp = 3;
    const slay = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:umbra', targetIds: [foe.id] }, scriptedDice(12, 1, 6));
    expect(slay.state.actors[foe.id].defeated).toBe(true);
    const defiance = slay.state.actors[hero.id].conditions.find(({ id }) => id === 'defiance');
    expect(defiance).toBeDefined();
    expect(defiance?.sourceId).toBe('shade:umbra:talent:1');
    expect(applyEvents(state, slay.events)).toEqual(slay.state); // replay

    // Control: the same hit against a full-HP foe does not slay → no fold.
    const full = talentEncounter('shade:umbra', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    full.state.actors[full.foe.id].hp = 30;
    const noSlay = executeCommand(full.state, { type: 'USE_ABILITY', actorId: full.hero.id, abilityId: 'shade:umbra', targetIds: [full.foe.id] }, scriptedDice(12, 1, 6));
    expect(noSlay.state.actors[full.foe.id].defeated).toBe(false);
    expect(noSlay.state.actors[full.hero.id].conditions.some(({ id }) => id === 'defiance')).toBe(false);
  });
});

describe('F7 collide trigger (post-application: a shove collides)', () => {
  it('Valiant talent 1: a colliding shove grants unstoppable until the end of your turn', () => {
    const { state, hero, foe } = talentEncounter('bastion:valiant', 1, {
      heroAt: { x: 1, y: 1 },
      foeAt: { x: 3, y: 1 },
      // The second shove pushes the foe into the impassable cell → collide.
      terrainCells: [{ position: { x: 5, y: 1 }, type: 'impassable', elevation: 0 }],
    });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:valiant', targetIds: [foe.id] }, scriptedDice());
    const unstoppable = result.state.actors[hero.id].conditions.find(({ id }) => id === 'unstoppable');
    expect(unstoppable).toBeDefined();
    expect(unstoppable?.sourceId).toBe('bastion:valiant:talent:1');
    expect(unstoppable?.duration?.kind).toBe('turn-end'); // the rest of your turn
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Valiant talent 1: without a collision the fold does not fire (control)', () => {
    const { state, hero, foe } = talentEncounter('bastion:valiant', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 6, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:valiant', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'unstoppable')).toBe(false);
  });

  it('Dragon Dive talent 1: a colliding shove makes the collided character vulnerable', () => {
    const { state, hero, foe } = talentEncounter('geomancer:dragon-dive', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 9, y: 1 } });
    // A shove toward the grid edge collides (ICON p.95) — the same detection
    // the caller computes before folding.
    const shoves: RuleMutation[] = [{
      kind: 'move', sourceId: 'geomancer:dragon-dive', sourceActorId: hero.id, actorId: foe.id, movement: 'shove', distance: 1,
      positions: [], direction: { x: 1, y: 0 }, phasing: false,
    }];
    const fired = talentTriggerMutations(state, hero, 'geomancer:dragon-dive', shoves, [foe.id], { collidedActorIds: collidingShoveTargets(state, shoves) });
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ kind: 'condition', sourceId: 'geomancer:dragon-dive:talent:1', sourceActorId: hero.id, actorId: foe.id, conditionId: 'vulnerable', operation: 'apply' });
  });

  it('Dragon Dive talent 1: an unobstructed shove does not fire (control)', () => {
    const { state, hero, foe } = talentEncounter('geomancer:dragon-dive', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const shoves: RuleMutation[] = [{
      kind: 'move', sourceId: 'geomancer:dragon-dive', sourceActorId: hero.id, actorId: foe.id, movement: 'shove', distance: 1,
      positions: [], direction: { x: 1, y: 0 }, phasing: false,
    }];
    const fired = talentTriggerMutations(state, hero, 'geomancer:dragon-dive', shoves, [foe.id], { collidedActorIds: collidingShoveTargets(state, shoves) });
    expect(fired).toHaveLength(0);
  });

  it('Dragon Dive talent 1: the real ability (delay window, no shove in the base command) does not fire', () => {
    const { state, hero, foe } = talentEncounter('geomancer:dragon-dive', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:dragon-dive', targetIds: [foe.id] }, scriptedDice());
    expect(talentMutationsOf(result, 'geomancer:dragon-dive')).toHaveLength(0);
    expect(result.state.actors[foe.id].statuses).not.toContain('vulnerable');
  });
});

describe('F7 finishing-blow trigger (the ability targets a bloodied foe, with per-row eligibility)', () => {
  it('Party Favor talent 2: a dazed foe in the blast area activates the Finishing Blow effect (2 damage twice)', () => {
    const { state, hero, foe } = talentEncounter('fool:party-favor', 2, { heroAt: { x: 0, y: 3 }, foeAt: { x: 4, y: 1 }, plainFoe: true });
    state.actors[foe.id].conditions = [{ id: 'dazed', sourceId: 'fixture:daze', ownerId: null, potency: 'normal', duration: null }];
    const placed = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:party-favor',
      targetIds: [],
      input: minePlacement({ x: 3, y: 1 }),
    }, scriptedDice()).state;
    const detonated = executeCommand(placed, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:party-favor',
      actionId: 'detonate',
      timing: 'movement-end',
      input: {},
    }, scriptedDice(3));
    expect(talentMutationsOf(detonated, 'fool:party-favor')).toHaveLength(2); // 2 damage twice
    expect(detonated.state.actors[foe.id].hp).toBe(26); // 32 - 2 (base) - 2 - 2 (the activated clause)
    expect(applyEvents(placed, detonated.events)).toEqual(detonated.state); // replay
  });

  it('Party Favor talent 2: no dazed/blinded foe in the blast means no clause (control)', () => {
    const { state, hero, foe } = talentEncounter('fool:party-favor', 2, { heroAt: { x: 0, y: 3 }, foeAt: { x: 4, y: 1 }, plainFoe: true });
    const placed = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:party-favor',
      targetIds: [],
      input: minePlacement({ x: 3, y: 1 }),
    }, scriptedDice()).state;
    const detonated = executeCommand(placed, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:party-favor',
      actionId: 'detonate',
      timing: 'movement-end',
      input: {},
    }, scriptedDice(3));
    expect(talentMutationsOf(detonated, 'fool:party-favor')).toHaveLength(0);
    expect(detonated.state.actors[foe.id].hp).toBe(30); // 32 - 2 (base only)
  });

  it('Party Favor talent 2: a bloodied target already fires the ability\u2019s own clause — the talent never doubles (control)', () => {
    const { state, hero, foe } = talentEncounter('fool:party-favor', 2, { heroAt: { x: 0, y: 3 }, foeAt: { x: 4, y: 1 }, plainFoe: true });
    state.actors[foe.id].conditions = [{ id: 'dazed', sourceId: 'fixture:daze', ownerId: null, potency: 'normal', duration: null }];
    const placed = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:party-favor',
      targetIds: [],
      input: minePlacement({ x: 3, y: 1 }),
    }, scriptedDice()).state;
    const detonated = executeCommand(placed, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:party-favor',
      actionId: 'detonate',
      timing: 'movement-end',
      input: {},
      triggers: ['finishing-blow'], // the bloodied-target clause already fired
    }, scriptedDice(3));
    expect(talentMutationsOf(detonated, 'fool:party-favor')).toHaveLength(0);
    expect(detonated.state.actors[foe.id].hp).toBe(26); // 32 - 2 - 2 - 2 from the ability\u2019s own clause, not doubled
  });
});

describe('F7 comeback extras (the remaining user-bloodied trigger-effects)', () => {
  it('Riposte talent 2: while bloodied the user gains vigilance +1 after Riposte resolves, otherwise none', () => {
    const { state, hero, foe } = talentEncounter('knave:riposte', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 }, bloodied: true });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:riposte', targetIds: [] }, scriptedDice());
    expect(talentMutationsOf(result, 'knave:riposte')).toHaveLength(1);
    expect(result.state.actors[hero.id].resources.vigilance).toBe(1);
    expect(result.state.actors[hero.id].ruleState['riposte:armed']).toBe(true); // the stance still entered
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay

    const full = talentEncounter('knave:riposte', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const notBloodied = executeCommand(full.state, { type: 'USE_ABILITY', actorId: full.hero.id, abilityId: 'knave:riposte', targetIds: [] }, scriptedDice());
    expect(talentMutationsOf(notBloodied, 'knave:riposte')).toHaveLength(0);
    expect(notBloodied.state.actors[full.hero.id].resources.vigilance ?? 0).toBe(0);
  });
});

describe('F7 single-foe condition-grant family (the always trigger reads the ability\u2019s own mutations)', () => {
  it('Valiant talent 2: shoving exactly one foe grants that foe hatred after the ability resolves', () => {
    const { state, hero, foe } = talentEncounter('bastion:valiant', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:valiant', targetIds: [] }, scriptedDice());
    // The foe is the only adjacent character across both rushes; the talent
    // folds hatred onto it. Hatred is a status (core.ts p.104) — the status
    // lands in the foe's `statuses`, with the hated target recorded as
    // `ruleState['hatred-of']` for the damage pipeline's halving.
    expect(result.state.actors[foe.id].statuses).toContain('hatred');
    expect(result.state.actors[foe.id].ruleState['hatred-of']).toBe(hero.id);
    expect(talentMutationsOf(result, 'bastion:valiant')).toEqual([expect.objectContaining({ kind: 'condition', conditionId: 'hatred', operation: 'apply', sourceId: 'bastion:valiant:talent:2', actorId: foe.id })]);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Valiant talent 2: shoving two or more foes never grants hatred (control)', () => {
    // A second adjacent foe means the single-foe predicate fails.
    const { state, hero, foe } = talentEncounter('bastion:valiant', 2, {
      heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 },
      extraFoes: [{ at: { x: 1, y: 2 } }],
    });
    const foe2 = Object.values(state.actors).find((actor) => actor.side === 'foes' && actor.id !== foe.id)!;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:valiant', targetIds: [] }, scriptedDice());
    expect(result.state.actors[foe.id].statuses).not.toContain('hatred');
    expect(result.state.actors[foe2.id].statuses).not.toContain('hatred');
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Provoke talent 1: affecting exactly one foe grants that foe hatred', () => {
    const { state, hero, foe } = talentEncounter('knave:provoke', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:provoke', targetIds: [] }, scriptedDice());
    expect(result.state.actors[foe.id].statuses).toContain('hatred');
    expect(result.state.actors[foe.id].ruleState['hatred-of']).toBe(hero.id);
    expect(talentMutationsOf(result, 'knave:provoke')).toEqual([expect.objectContaining({ kind: 'condition', conditionId: 'hatred', operation: 'apply', sourceId: 'knave:provoke:talent:1', actorId: foe.id })]);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Provoke talent 1: affecting two or more foes never grants hatred (control)', () => {
    // A second adjacent foe means the single-foe predicate fails.
    const { state, hero, foe } = talentEncounter('knave:provoke', 1, {
      heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 },
      extraFoes: [{ at: { x: 1, y: 2 } }],
    });
    const foe2 = Object.values(state.actors).find((actor) => actor.side === 'foes' && actor.id !== foe.id)!;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:provoke', targetIds: [] }, scriptedDice());
    expect(result.state.actors[foe.id].statuses).not.toContain('hatred');
    expect(result.state.actors[foe2.id].statuses).not.toContain('hatred');
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Showdown talent 2: activating showdown grants the user stealth', () => {
    const { state, hero, foe } = talentEncounter('freelancer:showdown', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:showdown', targetIds: [foe.id] }, scriptedDice());
    const stealth = result.state.actors[hero.id].conditions.find(({ id }) => id === 'stealth');
    expect(stealth).toBeDefined();
    expect(stealth?.sourceId).toBe('freelancer:showdown:talent:2');
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Showdown talent 2: the un-equipped ability grants no stealth (control)', () => {
    const { state, hero, foe } = talentEncounter('freelancer:showdown', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const withoutTalent = { ...state, actors: { ...state.actors, [hero.id]: { ...state.actors[hero.id], talents: {} } } };
    const result = executeCommand(withoutTalent, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:showdown', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'stealth')).toBe(false);
  });
});

describe('F7 always trigger (unconditional augmentations, magnitude from state)', () => {
  it('Dropkick talent 2: the shoves always fire; a charged (slow) turn shoves 2 instead of 1', () => {
    const { state, hero, foe } = talentEncounter('colossus:dropkick', 2, {
      heroAt: { x: 3, y: 1 },
      foeAt: { x: 4, y: 1 },
      plainFoe: true,
    });
    // Charged: the same slow-turn flag `deriveTriggers` turns into `charge`.
    state.actors[hero.id].ruleState['slow-turn'] = true;
    const charged = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:dropkick', targetIds: [foe.id] }, scriptedDice(3));
    const shoves = talentMutationsOf(charged, 'colossus:dropkick').filter((mutation) => mutation.kind === 'move' && mutation.movement === 'shove');
    expect(shoves).toHaveLength(2);
    expect(charged.state.actors[foe.id].position).toEqual({ x: 6, y: 1 }); // shoved 2 away from the user
    expect(charged.state.actors[hero.id].position).toEqual({ x: 1, y: 1 }); // shoved 2 away from the foe
    expect(charged.state.actors[hero.id].hp).toBe(34); // the ability's sacrifice 6
    expect(charged.state.actors[foe.id].hp).toBe(25); // 32 - (d6 3 + fray 4)
    expect(applyEvents(state, charged.events)).toEqual(charged.state); // replay
  });

  it('Dropkick talent 2: uncharged shoves are 1 (control)', () => {
    const { state, hero, foe } = talentEncounter('colossus:dropkick', 2, {
      heroAt: { x: 3, y: 1 },
      foeAt: { x: 4, y: 1 },
      plainFoe: true,
    });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:dropkick', targetIds: [foe.id] }, scriptedDice(3));
    const shoves = talentMutationsOf(result, 'colossus:dropkick').filter((mutation) => mutation.kind === 'move' && mutation.movement === 'shove');
    expect(shoves).toHaveLength(2);
    expect(result.state.actors[foe.id].position).toEqual({ x: 5, y: 1 });
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 });
  });
});
describe('F7 comeback trigger — Intimidate talent 1', () => {
  it('Comeback: Rush 2 — bloodied user rushes 2 squares after the ability resolves', () => {
    const { state, hero, foe } = talentEncounter('knave:intimidate', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 }, bloodied: true });
    // Intimidate is chapter 2 — patch the hero's chapter before use
    state.actors[hero.id].chapter = 2;
    const comeback = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:intimidate', targetIds: [foe.id] }, scriptedDice());
    const rushMutations = talentMutationsOf(comeback, 'knave:intimidate').filter((m) => m.kind === 'move' && m.movement === 'rush');
    expect(rushMutations).toHaveLength(1);
    expect(rushMutations[0]).toMatchObject({ distance: 2, movement: 'rush' });
    expect(applyEvents(state, comeback.events)).toEqual(comeback.state); // replay
  });

  it('Comeback: Rush 2 — full HP user does not rush (control)', () => {
    const { state, hero, foe } = talentEncounter('knave:intimidate', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 } });
    state.actors[hero.id].chapter = 2;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:intimidate', targetIds: [foe.id] }, scriptedDice());
    const rushMutations = talentMutationsOf(result, 'knave:intimidate').filter((m) => m.kind === 'move' && m.movement === 'rush');
    expect(rushMutations).toHaveLength(0);
  });
});

describe('F7 exceed trigger — God-Hand talent 1', () => {
  it('Exceed: gain evasion until the end of your next turn', () => {
    const { state, hero, foe } = talentEncounter('sealer:god-hand', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 } });
    const exceed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:god-hand', targetIds: [foe.id] }, scriptedDice(20, 4));
    const evasion = exceed.state.actors[hero.id].conditions.find(({ id }) => id === 'evasion');
    expect(evasion).toBeDefined();
    expect(evasion?.sourceId).toBe('sealer:god-hand:talent:1');
    expect(evasion?.duration?.kind).toBe('turn-end');
    expect(applyEvents(state, exceed.events)).toEqual(exceed.state); // replay

    const noExceed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:god-hand', targetIds: [foe.id] }, scriptedDice(8, 4));
    expect(noExceed.state.actors[hero.id].conditions.some(({ id }) => id === 'evasion')).toBe(false);
  });
});

describe('F7 terrain-create always trigger', () => {
  it('Upheaval talent 2: creates a pit at the boulder position', () => {
    const { state, hero, foe } = talentEncounter('colossus:upheaval', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 8, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:upheaval', targetIds: [] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'colossus:upheaval').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'pit')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Underway talent 2: creates up to 3 difficult terrain adjacent to the underway', () => {
    const { state, hero, foe } = talentEncounter('warden:underway', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 8, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:underway', targetIds: [] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'warden:underway').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'difficult')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  // enochian:implode:talent:2 is reclassified — the pit is created by the
  // delay detonation lifecycle hook, not the fold.

  it('Eye of the Storm talent 1: creates pit and dangerous terrain at the target position', () => {
    const { state, hero, foe } = talentEncounter('stormbender:eye-of-the-storm', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 4, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:eye-of-the-storm', targetIds: [foe.id] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'stormbender:eye-of-the-storm').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(2); // pit + dangerous
    expect(result.state.terrainEffects.some((e) => e.terrain === 'pit')).toBe(true);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'dangerous')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Blitz talent 1: creates 2 spaces of dangerous terrain near the foe', () => {
    const { state, hero, foe } = talentEncounter('spellblade:blitz', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:blitz', targetIds: [foe.id] }, scriptedDice(20, 4));
    const terrainMutations = talentMutationsOf(result, 'spellblade:blitz').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'dangerous')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Morrigan talent 2: creates 2 dangerous terrain spaces in range 2 of the target', () => {
    const { state, hero, foe } = talentEncounter('warden:morrigan', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 4, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:morrigan', targetIds: [foe.id] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'warden:morrigan').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'dangerous')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Sidhe talent 1: creates 1 dangerous terrain adjacent to the foe', () => {
    const { state, hero, foe } = talentEncounter('warden:sidhe', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:sidhe', targetIds: [foe.id] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'warden:sidhe').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'dangerous')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('The Tower talent 2: creates 2 difficult terrain spaces in the blast area', () => {
    const { state, hero, foe } = talentEncounter('seer:the-tower', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:the-tower', targetIds: [foe.id] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'seer:the-tower').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'difficult')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Tsunami talent 1: creates a pit in the tsunami center space', () => {
    const { state, hero, foe } = talentEncounter('stormbender:tsunami', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:tsunami', targetIds: [] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'stormbender:tsunami').filter((m) => m.kind === 'terrain' && m.operation === 'create');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'pit')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Heave-Ho talent 1: creates pit under a foe', () => {
    const { state, hero, foe } = talentEncounter('stormbender:heave-ho', 1, { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:heave-ho', targetIds: [] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'stormbender:heave-ho').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'pit')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Waterspout talent 2: leaves difficult terrain at the vacated space', () => {
    const { state, hero, foe } = talentEncounter('stormbender:waterspout', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 8, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:waterspout', targetIds: [] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'stormbender:waterspout').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'difficult')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Terraforming talent 2: creates up to 3 dangerous terrain spaces in the area', () => {
    const { state, hero, foe } = talentEncounter('geomancer:terraforming', 2, { heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:terraforming', targetIds: [foe.id] }, scriptedDice());
    const terrainMutations = talentMutationsOf(result, 'geomancer:terraforming').filter((m) => m.kind === 'terrain');
    expect(terrainMutations.length).toBeGreaterThanOrEqual(1);
    expect(result.state.terrainEffects.some((e) => e.terrain === 'dangerous')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
