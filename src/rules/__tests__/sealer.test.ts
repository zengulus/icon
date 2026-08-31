import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { noRepeatKey } from '../automation/kernels/use-ledger.js';
import { encounterConditionSet, encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterEvent, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Sealer
 * ability set (ICON p.189–196), the third Mendicant job. Shrines are `shrine`
 * entities, the salt field is `salt` terrain, and blessings are the `blessing`
 * resource. Each scenario must replay to the identical state through
 * applyEvents.
 */

interface SealerFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
  ally: EncounterActor | null;
}

function sealerEncounter(options: {
  foe?: Position; second?: Position | null; ally?: Position | null;
} = {}): SealerFixture {
  let state = createEncounter('Sealer fixture');
  const hero = actorFromCharacter(validCharacter('Exorcist'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 4, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second, ally };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Sealer ability automation (p.189–196)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('sealer:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const sealerIds = JOBS.find((job) => job.id === 'sealer')!.abilities.map(({ id }) => id);
    expect(sealerIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('God Hand: player-selected Teleport 1, attacks [D]+fray, seals, and blesses', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'sealer:god-hand', actionId: 'default', timing: 'use',
      input: { positions: { 'teleport': [{ x: 1, y: 2 }] } }, attackTargetId: foe.id,
    }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('sealed');
    expect(result.state.actors[hero.id].resources.blessing).toBe(1); // blessed (self preferred)
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 }); // teleported to player choice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('God Hand automatically applies its Exceed continuation without a caller trigger', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'sealer:god-hand', actionId: 'default', timing: 'use',
      input: { positions: { 'teleport': [{ x: 1, y: 2 }] } }, attackTargetId: foe.id,
    }, scriptedDice(20, 4));
    expect(result.state.actors[hero.id].vigor).toBe(3);
    const attackMutations = result.events.flatMap((event) => event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [])
      .filter((mutation) => mutation.kind === 'attack');
    expect(attackMutations).toHaveLength(1);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('God Hand does not apply Exceed below the authoritative threshold', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'sealer:god-hand', actionId: 'default', timing: 'use',
      input: { positions: { 'teleport': [{ x: 1, y: 2 }] } }, attackTargetId: foe.id,
    }, scriptedDice(10, 4));
    expect(result.state.actors[hero.id].vigor).toBe(0);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('God Hand combo (DEVIL HAND): player-selected Teleport 1, attacks with +1 boon and explodes the foe for 1 divine to other foes', () => {
    const { state, hero, foe, second } = sealerEncounter({ foe: { x: 2, y: 1 }, second: { x: 3, y: 0 } });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'sealer:god-hand',
      actionId: 'combo',
      timing: 'use',
      input: { positions: { 'teleport': [{ x: 1, y: 2 }] } },
      attackTargetId: foe.id,
    }, scriptedDice(12, 6, 4));
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(23); // 32 - (4 + fray 4) - 1 divine (the target is in its own blast)
    expect(result.state.actors[second!.id].hp).toBe(31); // 32 - 1 divine (medium blast)
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 }); // teleported to player choice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Grand Seal: seals and marks a foe in range 4', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:grand-seal', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].statuses).toContain('sealed');
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'grand-seal')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Grand Seal talent 1: a bloodied marked foe saves with +1 curse (p.192)', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    state.actors[hero.id].talents = { 'sealer:grand-seal': 1 };
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:grand-seal', targetIds: [foe.id] }, scriptedDice());
    expect(marked.state.actors[foe.id].marks.some(({ markId }) => markId === 'grand-seal')).toBe(true);
    // Bloodied (at or below half of Relict's 32 HP) with a saveable status.
    marked.state.actors[foe.id].hp = 16;
    marked.state.actors[foe.id].vigor = 0;
    marked.state.actors[foe.id].statuses.push('blind');
    marked.state.actors[foe.id].conditions.push({ id: 'blind', sourceId: 'fixture', ownerId: hero.id, potency: 'normal', duration: null });

    const heroEnded = endTurnTo(marked.state, foe.id, scriptedDice());
    expect(heroEnded.activeActorId).toBe(foe.id);
    // Two saves (sealed from the mark, blind); each rolls d20 + boon die.
    const ended = executeCommand(heroEnded, { type: 'END_TURN', actorId: foe.id }, scriptedDice(12, 1, 12, 1));
    const turnEndedEvent = ended.events.find((candidate) => candidate.type === 'TURN_ENDED' && candidate.actorId === foe.id);
    expect(turnEndedEvent?.type).toBe('TURN_ENDED');
    const turnEnded = turnEndedEvent as Extract<EncounterEvent, { type: 'TURN_ENDED' }>;
    const save = turnEnded.statusSaveMutations?.find((mutation) => mutation.kind === 'save' && mutation.statusId === 'blind');
    expect(save).toMatchObject({
      kind: 'save',
      actorId: foe.id,
      windowKind: 'status-clear',
      statusId: 'blind',
      roll: 12,
      boon: -1,
      total: 11,
      success: true,
      threshold: 10,
      modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 1, blessing: false },
    });
    expect(ended.state.actors[foe.id].statuses).not.toContain('blind');
    expect(applyEvents(heroEnded, ended.events)).toEqual(ended.state);
  });

  it('Grand Seal talent 1: the save curse is gated on the equipped choice and the live bloodied state', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    // Talent 2 instead of 1: a bloodied marked foe keeps the plain save.
    state.actors[hero.id].talents = { 'sealer:grand-seal': 2 };
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:grand-seal', targetIds: [foe.id] }, scriptedDice());
    marked.state.actors[foe.id].hp = 16;
    marked.state.actors[foe.id].vigor = 0;
    marked.state.actors[foe.id].statuses.push('blind');
    marked.state.actors[foe.id].conditions.push({ id: 'blind', sourceId: 'fixture', ownerId: hero.id, potency: 'normal', duration: null });
    expect(encounterRuleState(marked.state).actors[foe.id].statusSavePolicy.saveCurse).toBe(0);

    // The owner's talent is read live from the durable actor record: the same
    // mark starts cursing saves the moment the sealer is modeled with talent 1.
    marked.state.actors[hero.id].talents = { 'sealer:grand-seal': 1 };
    expect(encounterRuleState(marked.state).actors[foe.id].statusSavePolicy.saveCurse).toBe(1);

    // The bloodied read is live too: healing the marked foe removes the curse.
    marked.state.actors[foe.id].hp = 20;
    expect(encounterRuleState(marked.state).actors[foe.id].statusSavePolicy.saveCurse).toBe(0);
  });

  it('Grand Seal talent 2: a bloodied marked foe is pacified+ while marked (p.192)', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    state.actors[hero.id].talents = { 'sealer:grand-seal': 2 };
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:grand-seal', targetIds: [foe.id] }, scriptedDice());
    marked.state.actors[foe.id].hp = 16;
    marked.state.actors[foe.id].vigor = 0;
    // The projection is carrier-aware and live: the marked bloodied foe has
    // pacified with ongoing (plus) potency — it cannot be saved away (p.94).
    expect(encounterRuleState(marked.state).actors[foe.id].statuses).toContainEqual({ id: 'pacified', potency: 'plus' });
    expect(encounterConditionSet(marked.state.actors[foe.id], marked.state).has('pacified')).toBe(true);

    // Healing above bloodied drops the projection immediately (ephemeral —
    // the durable marks array stays the record).
    marked.state.actors[foe.id].hp = 20;
    expect(encounterRuleState(marked.state).actors[foe.id].statuses).not.toContainEqual({ id: 'pacified', potency: 'plus' });
    expect(encounterConditionSet(marked.state.actors[foe.id], marked.state).has('pacified')).toBe(false);
  });

  it('Grand Seal talent 2: the pacified+ grant is gated on the equipped choice', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    // Talent 1 instead of 2: a bloodied marked foe is not pacified.
    state.actors[hero.id].talents = { 'sealer:grand-seal': 1 };
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:grand-seal', targetIds: [foe.id] }, scriptedDice());
    marked.state.actors[foe.id].hp = 16;
    marked.state.actors[foe.id].vigor = 0;
    expect(encounterRuleState(marked.state).actors[foe.id].statuses).not.toContainEqual({ id: 'pacified', potency: 'plus' });
    expect(encounterConditionSet(marked.state.actors[foe.id], marked.state).has('pacified')).toBe(false);
  });

  it('Matsuri: player-selected Teleport 2, attacks 2[D]+fray, and an Exceed blasts the area', () => {
    const { state, hero, foe, second } = sealerEncounter({ foe: { x: 2, y: 1 }, second: { x: 2, y: 0 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'sealer:matsuri',
      actionId: 'default',
      timing: 'use',
      input: { positions: { 'teleport': [{ x: 2, y: 2 }] } },
      attackTargetId: foe.id,
      triggers: ['exceed'],
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - (4 + 5 + fray 4) - 2 divine (exceed blast)
    expect(result.state.actors[second!.id].hp).toBe(30); // 32 - 2 divine (large blast, foes)
    expect(result.state.actors[hero.id].vigor).toBe(3); // allies in the blast gain 3 vigor
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 2 }); // teleported to player choice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Spirit Shrine: creates a height 1 shrine, then raises it to height 2', () => {
    const { state, hero } = sealerEncounter({ second: null });
    const first = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:spirit-shrine', targetIds: [] }, scriptedDice());
    const shrines = Object.values(first.state.entities).filter((entity) => entity.type === 'shrine');
    expect(shrines).toHaveLength(1);
    expect(shrines[0]?.state.height).toBe(1);

    // The shrine-raise is the same ability used again while adjacent, so the
    // fixture clears the same-turn repeat gate.
    delete first.state.actors[hero.id].ruleState[noRepeatKey('sealer:spirit-shrine')];
    const second = executeCommand(first.state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:spirit-shrine', targetIds: [] }, scriptedDice());
    const raised = Object.values(second.state.entities).filter((entity) => entity.type === 'shrine');
    expect(raised[0]?.state.height).toBe(2);
    const replayed = applyEvents(state, first.events);
    delete replayed.actors[hero.id].ruleState[noRepeatKey('sealer:spirit-shrine')]; // mirrors the fixture's same-turn gate clear
    expect(applyEvents(replayed, second.events)).toEqual(second.state);
  });

  it('Sanctify: scatters salt in a medium blast and deals 1 divine to foes inside', () => {
    const { state, hero, foe, second } = sealerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 2 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:sanctify', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'salt')).toBe(true);
    expect(result.state.actors[foe.id].hp).toBe(31); // 32 - 1 divine
    expect(result.state.actors[second!.id].hp).toBe(31); // 32 - 1 divine
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Grand Banishment: player-selected Teleport 1, ends the turn, and marks a foe', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:grand-banishment', targetIds: [foe.id], input: { positions: { 'teleport': [{ x: 1, y: 2 }] } } }, scriptedDice());
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'grand-banishment')).toBe(true);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 }); // teleported to player choice
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    expect(result.state.activeActorId).toBeNull();
    expect(result.state.eligibleSide).toBe('foes');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Divine Aegis: marks an ally in range 4', () => {
    const { state, hero, ally } = sealerEncounter({ second: null, ally: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:divine-aegis', targetIds: [ally!.id] }, scriptedDice());
    expect(result.state.actors[ally!.id].marks.some(({ markId }) => markId === 'divine-aegis')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Justice: burst 2 (self) — foes take 1 divine, allies are blessed, then player-selected Teleport 2', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'sealer:justice',
      actionId: 'default',
      timing: 'interrupt',
      input: { positions: { 'teleport': [{ x: 1, y: 3 }] } },
    }, scriptedDice());
    expect(result.state.actors[foe.id].hp).toBe(31); // 32 - 1 divine
    expect(result.state.actors[hero.id].resources.blessing).toBe(1); // allies in the burst are blessed
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 3 }); // teleported to player choice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Justice combo (JUDGEMENT): gambles, player-selected self-teleport, and pacifies foes in range 2', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'sealer:justice',
      actionId: 'combo',
      timing: 'interrupt',
      input: { positions: { 'teleport': [{ x: 1, y: 4 }], 'foe-0': [{ x: 2, y: 4 }] } },
    }, scriptedDice(6)); // gamble 6 → teleport 3
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    expect(result.state.actors[foe.id].statuses).toContain('pacified');
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 4 }); // self-teleported to player choice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Open The Gates: player-selected Teleport 1, attacks with +1 boon that cannot miss, pacifying the foe', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'sealer:open-the-gates', actionId: 'default', timing: 'use',
      input: { positions: { 'teleport': [{ x: 1, y: 2 }] } }, attackTargetId: foe.id,
    }, scriptedDice(12, 6, 4));
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('pacified');
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 }); // teleported to player choice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Open The Gates combo (CENTER THE TEMPLE): player-selected teleport the round number and attacks', () => {
    const { state, hero, foe } = sealerEncounter({ second: null });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'sealer:open-the-gates',
      actionId: 'combo',
      timing: 'use',
      input: { positions: { 'teleport': [{ x: 1, y: 2 }] } },
      attackTargetId: foe.id,
    }, scriptedDice(12, 4));
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 }); // teleported to player choice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
