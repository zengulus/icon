import '../automation/content/registry.js';
import { windowHeldDamage } from '../automation/kernels/decision-window.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { applyRuleMutations } from '../automation/kernels/encounter-adapter.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo, interruptUses, interruptUsedThisTurn} from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Colossus
 * ability set (ICON p.133–138). Each scenario resolves through the shared
 * encounter reducer and must replay to the identical state through applyEvents.
 *
 * Triggered extras derive from authoritative facts, never caller assertions:
 * Exceed from the ability's OWN 15+ roll (the shared attack authority's
 * exceed fact), Charge from the durable slow-turn flag, Heroic from a
 * validated declaration, and Collide from the resolution's own shove/defeat
 * facts. Boiling Blood's defy-death and Massive Overhead's next-attack
 * enhancement are reducer lifecycle hooks wired into the damage and attack
 * pipelines.
 */

interface ColossusFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor;
}

function colossusEncounter(options: { foe?: Position; second?: Position | null } = {}): ColossusFixture {
  let state = createEncounter('Colossus fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second: second! };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Colossus ability automation (p.133–138)', () => {
  it('keeps the eight source-reviewed abilities executable and Raging Wolf unresolved', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('colossus:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const colossusIds = JOBS.find((job) => job.id === 'colossus')!.abilities.map(({ id }) => id);
    expect(colossusIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(8);
    expect(EXECUTABLE_JOB_ABILITY_IDS.has('colossus:raging-wolf')).toBe(false);
    expect(compileRuleSourceUnit(findRuleSourceUnit('colossus:raging-wolf')!).unsupportedClauses.length).toBeGreaterThan(0);
  });

  it('Valkyrie: true-strike attack, weakened target, and no fly when adjacent', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:valkyrie', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(mutationsOf(result.events, 'colossus:valkyrie')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'weakened' },
      { kind: 'attack', d20: 12, hit: true, critical: false },
      { kind: 'damage', actorId: foe.id, amount: 8 },
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(result.state.actors[foe.id].statuses).toContain('weakened');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Valkyrie: Exceed creates a pit under the target', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    // Exceed is the ability's own attack roll at 15+ (ICON p.93): the roll
    // is scripted to 15 so the program's `exceed` trigger step fires from
    // the recorded attack fact — never a command assertion.
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'colossus:valkyrie',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(15, 4));
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions.some((cell) => cell.x === foe.position.x && cell.y === foe.position.y))).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Upheaval: creates a height-1 boulder and shoves adjacent characters away', () => {
    const { state, hero, foe } = colossusEncounter({ foe: { x: 8, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:upheaval', targetIds: [] }, scriptedDice());
    const boulder = Object.values(result.state.entities).find((entity) => entity.type === 'object' && entity.ownerId === hero.id);
    expect(boulder).toBeDefined();
    expect(boulder!.state.height).toBe(1);
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 }); // shoved 1 away from the boulder
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(result.state.actors[foe.id].position).toEqual({ x: 8, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Dropkick: sacrifice 6 and damage an adjacent foe', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:dropkick', targetIds: [foe.id] }, scriptedDice(4));
    expect(mutationsOf(result.events, 'colossus:dropkick')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'damage', actorId: hero.id, amount: 6, damageType: 'sacrifice' },
      { kind: 'damage', actorId: foe.id, amount: 8 },
    ]);
    expect(result.state.actors[hero.id].hp).toBe(34);
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Massive Overhead: the next attack deals bonus damage and creates a pit', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    const armed = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'colossus:massive-overhead',
      actionId: 'default',
      timing: 'use',
      input: {},
    }, scriptedDice()).state;
    expect(armed.actors[hero.id].ruleState['massive-overhead']).toBe(true);

    const attack = executeCommand(armed, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:valkyrie', targetIds: [foe.id] }, scriptedDice(12, 6, 4));
    // The bonus damage die keeps the higher of 6 and 4, so the hit deals 6 + 4 fray.
    expect(attack.state.actors[foe.id].hp).toBe(22);
    expect(attack.state.actors[hero.id].ruleState['massive-overhead']).toBeUndefined();
    expect(attack.state.actors[hero.id].resources['bonus-damage']).toBe(0);
    expect(attack.state.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions.some((cell) => cell.x === foe.position.x && cell.y === foe.position.y))).toBe(true);
  });

  it('Takedown: two actions, attack damage, and stuns both characters', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:takedown', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(mutationsOf(result.events, 'colossus:takedown')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'condition', actorId: hero.id, conditionId: 'stunned' },
      { kind: 'condition', actorId: foe.id, conditionId: 'stunned' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 8 },
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(0);
    expect(result.state.actors[hero.id].statuses).toContain('stunned');
    expect(result.state.actors[foe.id].statuses).toContain('stunned');
    expect(result.state.actors[foe.id].hp).toBe(24);
  });

  it('Takedown: Exceed grants True Strike ON the current attack — folded from the SAME 15+ roll, never a next-attack grant', () => {
    // "Exceed or Heroic: Gains true strike and creates a pit under your
    // target." (p.135) The exceed classification reads the PRE-fold roll
    // total (d20 15), then the granted true strike applies to THIS attack:
    // the authoritative attack mutation and its direct damage both carry the
    // true-strike facts (dodge ignored) — and the same roll fires the exceed
    // pit step afterwards.
    const { state, hero, foe } = colossusEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:takedown', targetIds: [foe.id] }, scriptedDice(15, 4));
    const mutations = mutationsOf(result.events, 'colossus:takedown');
    const attackMutation = mutations.find((mutation) => mutation.kind === 'attack') as { exceed?: boolean; trueStrike?: boolean } | undefined;
    expect(attackMutation).toMatchObject({ exceed: true, trueStrike: true });
    const hitDamage = mutations.find((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id);
    expect(hitDamage && hitDamage.kind === 'damage' ? hitDamage.ignoreDodge === true : false).toBe(true);
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions.some((cell) => cell.x === foe.position.x && cell.y === foe.position.y))).toBe(true);
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('stunned');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Takedown + Evasion (no Heroic, no forced Exceed): a 4+ Evasion cancels the attack BEFORE the roll — no d20, no boon dice, no natural Exceed, no pit', () => {
    // ICON p.104: Evasion checks BEFORE the attack roll. A natural Exceed
    // cannot exist until the roll, so an evaded attack consumes NO d20 and NO
    // boon dice, records no total, and carries no exceed — the exceed-granted
    // true strike can never retroactively erase the already-resolved Evasion
    // check, and no pit opens.
    const { state, hero, foe } = colossusEncounter({ second: null });
    state.actors[foe.id].conditions.push({ id: 'evasion', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const seq = scriptedDice(5);
    let diceCalls = 0;
    const counting = {
      die(sides: number) {
        diceCalls += 1;
        return seq.die(sides); // evasion d6 = 5
      },
    };
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:takedown', targetIds: [foe.id] }, counting);
    const mutations = mutationsOf(result.events, 'colossus:takedown');
    const attackMutation = mutations.find((mutation) => mutation.kind === 'attack') as { exceed?: boolean; trueStrike?: boolean; evasionRoll?: number | null; d20?: number | null; hit?: boolean; boon?: number } | undefined;
    expect(attackMutation).toMatchObject({ d20: null, boon: 0, exceed: false, trueStrike: false, evasionRoll: 5, hit: false });
    // ONLY the evasion d6 was consumed — no d20 and no boon die.
    expect(diceCalls).toBe(1);
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit')).toBe(false);
    expect(result.state.actors[foe.id].hp).toBe(28); // miss damage = fray 4
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Takedown + Heroic + Evasion: Heroic is known BEFORE the roll, so True Strike suppresses the Evasion check — no Evasion die, one attack roll', () => {
    // "Exceed or Heroic: Gains true strike" (p.135). Heroic is a pre-roll
    // fact: the declaration exists before the attack, so the true strike it
    // grants is also pre-roll — Evasion (p.104, checked before the roll) is
    // suppressed entirely and no Evasion d6 is consumed. The attack then
    // rolls ONCE.
    const { state, hero, foe } = colossusEncounter({ second: null });
    // Demon Strength is the fully-executable heroic source (Strive fails
    // closed while its shove/half-damage seams are missing); the entitlement
    // is incidental to the attack-timing semantics under test.
    hero.traitIds = ['demon-slayer:trait:demon-strength'];
    state.actors[hero.id].traitIds = ['demon-slayer:trait:demon-strength'];
    state.actors[foe.id].conditions.push({ id: 'evasion', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const seq = scriptedDice(12, 4);
    let diceCalls = 0;
    const counting = {
      die(sides: number) {
        diceCalls += 1;
        return seq.die(sides); // d20 12, boon d6 4
      },
    };
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'colossus:takedown',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      attackTargetId: foe.id,
      triggers: ['heroic'],
    }, counting);
    const mutations = mutationsOf(result.events, 'colossus:takedown');
    const attackMutation = mutations.find((mutation) => mutation.kind === 'attack') as { exceed?: boolean; trueStrike?: boolean; evasionRoll?: number | null; d20?: number | null; hit?: boolean } | undefined;
    expect(attackMutation).toMatchObject({ d20: 12, exceed: false, trueStrike: true, evasionRoll: null, hit: true });
    // The attack roll (d20 + boon) is the ONLY consumption — no Evasion die.
    expect(diceCalls).toBe(2);
    const hitDamage = mutations.find((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id);
    expect(hitDamage && hitDamage.kind === 'damage' ? hitDamage.ignoreDodge === true : false).toBe(true);
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions.some((cell) => cell.x === foe.position.x && cell.y === foe.position.y))).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Takedown: a natural Exceed exists only AFTER the roll — Evasion resolves first, then the surviving attack acquires the exceed true strike for its remaining consequences', () => {
    // A natural Exceed cannot exist until the attack roll, so the Evasion
    // check happens FIRST (its d6 is genuinely consumed and recorded). When
    // the check fails (d6 < 4), the attack rolls ONCE; if that roll totals
    // 15+, the exceed-granted true strike applies to the CURRENT attack's
    // remaining consequences — the dodge/miss-damage treatment — never
    // erasing the resolved Evasion check and never a second roll.
    const { state, hero, foe } = colossusEncounter({ second: null });
    state.actors[foe.id].conditions.push({ id: 'evasion', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    // evasion d6 3 (fails), d20 15 (exceeds), boon d6 4.
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:takedown', targetIds: [foe.id] }, scriptedDice(3, 15, 4));
    const mutations = mutationsOf(result.events, 'colossus:takedown');
    const attackMutation = mutations.find((mutation) => mutation.kind === 'attack') as { exceed?: boolean; trueStrike?: boolean; evasionRoll?: number | null; d20?: number | null; hit?: boolean } | undefined;
    expect(attackMutation).toMatchObject({ d20: 15, exceed: true, trueStrike: true, evasionRoll: 3, hit: true });
    const hitDamage = mutations.find((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id);
    expect(hitDamage && hitDamage.kind === 'damage' ? hitDamage.ignoreDodge === true : false).toBe(true);
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions.some((cell) => cell.x === foe.position.x && cell.y === foe.position.y))).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Takedown: a NON-Exceed attack keeps normal Evasion behavior against an evading target', () => {
    // No exceed → no exceed-granted true strike → the attack keeps the
    // ordinary evasion resolution: the target's evasion d6 rolls and, at 4+,
    // cancels the attack (the recorded attack has no d20).
    const { state, hero, foe } = colossusEncounter({ second: null });
    state.actors[foe.id].conditions.push({ id: 'evasion', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    // evasion d6 3 (fails), d20 12, boon d6 4: the attack survives and hits
    // with no exceed.
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:takedown', targetIds: [foe.id] }, scriptedDice(3, 12, 4));
    const mutations = mutationsOf(result.events, 'colossus:takedown');
    const attackMutation = mutations.find((mutation) => mutation.kind === 'attack') as { exceed?: boolean; trueStrike?: boolean; evasionRoll?: number | null; d20?: number | null; hit?: boolean } | undefined;
    expect(attackMutation).toMatchObject({ d20: 12, exceed: false, trueStrike: false, evasionRoll: 3, hit: true });
    const hitDamage = mutations.find((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id);
    expect(hitDamage && hitDamage.kind === 'damage' ? hitDamage.ignoreDodge === true : false).toBe(false);
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit')).toBe(false);
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Takedown + Pulverize: a SOURCE-FORCED Exceed (elevation ≥ 2) follows the same staged path — true strike before evasion', () => {
    // Pulverize (p.134) forces the exceed fact from the attack-START
    // elevation regardless of the roll. When that forced exceed rides
    // Takedown's exceed-gated true strike, the staged fold must grant the
    // true strike BEFORE settling evasion — same seam, source-forced
    // provenance.
    let state = createEncounter('Staged forced-exceed fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    hero.traitIds = ['colossus:trait:pulverize'];
    const foe = createFoe('Relict', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    // Terrain elevation must be set before the encounter starts (SET_TERRAIN
    // is setup-phase); the trait's source-forced exceed then reads it.
    state = executeCommand(state, { type: 'SET_TERRAIN', cell: { position: hero.position, type: 'basic', elevation: 2 } }).state;
    state = startEncounterTo(state, hero.id);
    state.actors[foe.id].conditions.push({ id: 'evasion', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    // Low roll (d20 8) — the exceed comes from the elevation, not the roll.
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:takedown', targetIds: [foe.id] }, scriptedDice(8, 4));
    const mutations = mutationsOf(result.events, 'colossus:takedown');
    const attackMutation = mutations.find((mutation) => mutation.kind === 'attack') as { exceed?: boolean; trueStrike?: boolean; evasionRoll?: number | null; d20?: number | null; hit?: boolean } | undefined;
    // The forced exceed granted true strike BEFORE evasion could roll.
    expect(attackMutation).toMatchObject({ d20: 8, exceed: true, trueStrike: true, evasionRoll: null, hit: true });
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Takedown: without Exceed the same attack has no true strike and opens no pit', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:takedown', targetIds: [foe.id] }, scriptedDice(12, 4));
    const mutations = mutationsOf(result.events, 'colossus:takedown');
    const attackMutation = mutations.find((mutation) => mutation.kind === 'attack') as { exceed?: boolean; trueStrike?: boolean } | undefined;
    expect(attackMutation).toMatchObject({ exceed: false, trueStrike: false });
    const hitDamage = mutations.find((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id);
    expect(hitDamage && hitDamage.kind === 'damage' ? hitDamage.ignoreDodge === true : false).toBe(false);
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit')).toBe(false);
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Takedown: sacrificing 4 avoids the self-stun', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'colossus:takedown',
      actionId: 'default',
      timing: 'use',
      input: { numbers: { sacrifice: 4 } },
      attackTargetId: foe.id,
    }, scriptedDice(12, 4));
    expect(result.state.actors[hero.id].statuses).not.toContain('stunned');
    expect(result.state.actors[hero.id].hp).toBe(36); // sacrificed 4, stayed above 1
    expect(result.state.actors[foe.id].statuses).toContain('stunned');
  });

  it('Great Suplex: remove, fly, replace the foe, then damage, slashed, and stunned', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:great-suplex', targetIds: [foe.id] }, scriptedDice(4));
    expect(result.state.actors[hero.id].hp).toBe(34); // sacrificed 6
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 1 }); // flew half of 6
    expect(result.state.actors[foe.id].position).toEqual({ x: 5, y: 1 });
    expect(result.state.actors[foe.id].onBattlefield).toBe(true);
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(result.state.actors[foe.id].statuses).toContain('slashed');
    expect(result.state.actors[foe.id].statuses).toContain('stunned');
    expect(result.state.actors[hero.id].actionsRemaining).toBe(0);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Gigaton Whip: true-strike attack and shove 2', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:gigaton-whip', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(mutationsOf(result.events, 'colossus:gigaton-whip')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: foe.id, movement: 'shove', distance: 2 },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 4 },
    ]);
    expect(result.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(28);
  });

  it('Raging Wolf fails closed until its optional cumulative sequence has command-time authority', () => {
    const { state, hero } = colossusEncounter({ second: null });
    state.actors[hero.id].abilityIds.push('colossus:raging-wolf');
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:raging-wolf', targetIds: [],
    }, scriptedDice())).toThrow(/not an independently executable ICON rule/i);
  });

  it('Boiling Blood: arms defy-death and bonus damage as an interrupt', () => {
    const { state, hero } = colossusEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:boiling-blood', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].activeEffects.some(({ effectId }) => effectId === 'defy-death')).toBe(true);
    expect(result.state.actors[hero.id].resources['bonus-damage']).toBe(1);
    expect(interruptUses(result.state.actors[hero.id], 'colossus:boiling-blood')).toBe(1);
    expect(interruptUsedThisTurn(result.state.actors[hero.id])).toBe(true);
  });

  it('Boiling Blood: defy-death keeps the user at 1 hp instead of defeated, and grants bonus damage', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    const armed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:boiling-blood', targetIds: [] }, scriptedDice()).state;

    // A wound that would defeat the hero instead leaves them fighting on at 1 hp.
    armed.actors[hero.id].hp = 2;
    armed.actors[hero.id].vigor = 0;
    applyRuleMutations(armed, [{ kind: 'damage', sourceId: 'test', sourceActorId: foe.id, actorId: hero.id, amount: 10, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false }]);
    expect(armed.actors[hero.id].hp).toBe(1);
    expect(armed.actors[hero.id].defeated).toBe(false);

    // While defying death the hero's next ability attack keeps the higher damage die.
    const attack = executeCommand(armed, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:valkyrie', targetIds: [foe.id] }, scriptedDice(12, 6, 4));
    expect(attack.state.actors[foe.id].hp).toBe(22); // 6 (kept) + 4 fray instead of 4 + 4
  });

  it('Boiling Blood: a lethal foe blow is held until the defeat interrupt arms defy-death (p.138)', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    // Without Righteous Disdain, the only damage hold available is the
    // defeated trigger — so the window records the defeated trigger.
    state.actors[hero.id].abilityIds = state.actors[hero.id].abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain');
    state.actors[hero.id].hp = 2;
    state.actors[hero.id].vigor = 0;

    // 10 normal - armor 2 = 8 determined; lethal (8 >= 2). The blow is held.
    const held = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-blow',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [{ kind: 'damage', sourceId: 'fixture:foe-blow', sourceActorId: foe.id, actorId: hero.id, amount: 10, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
    }]);
    expect(held.actors[hero.id].hp).toBe(2); // held, not defeated yet
    expect(held.actors[hero.id].defeated).toBe(false);
    const window = held.decisionWindows.find((candidate) => candidate.actorId === hero.id && candidate.kind === 'defeated');
    expect(window).toBeDefined();
    expect(windowHeldDamage(window!)).toMatchObject({ amount: 8, sourceActorId: foe.id });

    // Boiling Blood resolves before the blow lands: the hero fights on, and
    // the held lethal blow is clamped to 1 hp by the newly armed defy-death.
    const interrupt = executeCommand(held, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'colossus:boiling-blood',
      actionId: 'default',
      timing: 'interrupt',
      input: {},
    }, scriptedDice());
    expect(interrupt.state.actors[hero.id].activeEffects.some(({ effectId }) => effectId === 'defy-death')).toBe(true);
    expect(interrupt.state.actors[hero.id].resources['bonus-damage']).toBe(1);
    expect(interrupt.state.actors[hero.id].hp).toBe(1); // the held blow landed but cannot defeat
    expect(interrupt.state.actors[hero.id].defeated).toBe(false);
    expect(interruptUses(interrupt.state.actors[hero.id], 'colossus:boiling-blood')).toBe(1);
    expect(applyEvents(held, interrupt.events)).toEqual(interrupt.state);
  });

  it('Boiling Blood: a defiant hero\'s lethal blow never opens a defeated window (p.104 floor)', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    // Without Righteous Disdain, the only damage hold available would be the
    // defeated trigger — so this proves the protected blow is not treated as
    // a defeat at all.
    state.actors[hero.id].abilityIds = state.actors[hero.id].abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain');
    state.actors[hero.id].hp = 2;
    state.actors[hero.id].vigor = 0;
    state.actors[hero.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });

    // 10 normal - armor 2 = 8 determined; lethal (8 >= 2), but Defiance
    // floors the application at 1 HP, so there is no defeat to interrupt.
    const blown = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-blow',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [{ kind: 'damage', sourceId: 'fixture:foe-blow', sourceActorId: foe.id, actorId: hero.id, amount: 10, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
    }]);
    expect(blown.actors[hero.id]).toMatchObject({ hp: 1, defeated: false });
    expect(blown.actors[hero.id].conditions.some(({ id }) => id === 'defiance')).toBe(false);
    expect(blown.actors[hero.id].ruleState['damage-immune']).toBe(true);
    expect(blown.decisionWindows.some((window) => window.actorId === hero.id && window.kind === 'defeated')).toBe(false);
    expect(blown.decisionWindows.every((window) => !windowHeldDamage(window))).toBe(true); // nothing was held
  });

  it('Boiling Blood: a defy-death hero\'s lethal blow never opens a defeated window (p.138 floor)', () => {
    const { state, hero, foe } = colossusEncounter({ second: null });
    state.actors[hero.id].abilityIds = state.actors[hero.id].abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain');
    state.actors[hero.id].hp = 2;
    state.actors[hero.id].vigor = 0;
    // The hero is already defying death (Boiling Blood's persistent effect
    // shape from colossus-programs.ts) and still has an unused defeated
    // interrupt, so only the application-time floor stands between them and
    // defeat.
    state.actors[hero.id].activeEffects.push({
      id: 'fixture:defy-death', sourceId: 'colossus:boiling-blood', ownerId: hero.id, effectId: 'defy-death',
      duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: 2 }, modifiers: [], triggers: ['defeated'], state: {},
    });

    const blown = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-blow',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [{ kind: 'damage', sourceId: 'fixture:foe-blow', sourceActorId: foe.id, actorId: hero.id, amount: 10, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
    }]);
    expect(blown.actors[hero.id]).toMatchObject({ hp: 1, defeated: false });
    expect(blown.decisionWindows.some((window) => window.actorId === hero.id && window.kind === 'defeated')).toBe(false);
    expect(blown.decisionWindows.every((window) => !windowHeldDamage(window))).toBe(true);
  });

  it('Takedown under reversed actor insertion order is byte-identical: the migrated live slots resolve by recorded identity, never object order', () => {
    // The canonical Takedown fixture with a second actor ADDED BEFORE the
    // target: the migrated source/attack-target reads resolve by recorded slot
    // identity, so the outcome and replay are identical to the canonical order.
    let swapped = createEncounter('Colossus insertion');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 2, y: 1 });
    const grim = createFoe('Grim', { x: 8, y: 1 });
    swapped = executeCommand(swapped, { type: 'ADD_ACTOR', actor: grim }).state;
    swapped = executeCommand(swapped, { type: 'ADD_ACTOR', actor: hero }).state;
    swapped = executeCommand(swapped, { type: 'ADD_ACTOR', actor: foe }).state;
    swapped = startEncounterTo(swapped, hero.id);
    const result = executeCommand(swapped, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:takedown', targetIds: [foe.id] }, scriptedDice(15, 4));
    const mutations = mutationsOf(result.events, 'colossus:takedown');
    // Same recorded identities → same mutations as the canonical fixture: the
    // attack hits the recorded target, the exceed fires from the same 15+ roll,
    // and the stuns/terrain land on the recorded identities.
    expect(mutations.some((mutation) => mutation.kind === 'attack' && mutation.actorId === hero.id && mutation.targetId === foe.id && mutation.d20 === 15 && mutation.exceed === true)).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'condition' && mutation.actorId === hero.id && mutation.conditionId === 'stunned')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'condition' && mutation.actorId === foe.id && mutation.conditionId === 'stunned')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'terrain' && mutation.terrain === 'pit')).toBe(true);
    expect(result.state.actors[hero.id].statuses).toContain('stunned');
    expect(result.state.actors[foe.id].statuses).toContain('stunned');
    expect(applyEvents(swapped, result.events)).toEqual(result.state);
  });

});
