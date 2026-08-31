import { describe, expect, it } from 'vitest';
import { executeRuleProgram } from '../automation/kernels/runtime.js';
import { bullStrengthCollideMutations } from '../automation/content/jobs/attack-modifier-recipes.js';
import { traitAttackModifier } from '../automation/kernels/attack-modifiers.js';
import '../automation/content/registry.js';
import { JOB_TRAIT_RECIPES } from '../automation/content/jobs/job-trait-recipes.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState, Position, TerrainCell } from '../types.js';
import type { RuleMutation, RuleProgram } from '../automation/primitives/types.js';import { scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';
import { useLedgerAvailable } from '../automation/kernels/use-ledger.js';
import { turnEligibleActorIds } from '../turn-scheduler.js';

/**
 * F6 attack-path trait modifier fixtures (docs/rules-foundations.md §7).
 *
 * The four promoted traits — Demon Edge, Hissatsu, Pulverize, Bull's
 * Strength — execute through the shared attack-modifier kernel
 * (`automation/attack-modifiers.ts`) and the lifecycle recipes. Each
 * behavior has a control (the same dice/setup without the trait or with the
 * trigger not firing), a replay pair (applyEvents rebuilds the identical
 * state), and a closed-registry negative (documented rows stay documented).
 *
 * Bastion fixture hero (validCharacter): defense 6, damage die d6, fray 4.
 */

interface TraitFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

function traitEncounter(options: {
  traitIds: string[];
  abilityIds?: string[];
  heroAt?: Position;
  foeAt?: Position;
  elevation?: number;
  chapter?: number;
  terrainCells?: TerrainCell[];
}): TraitFixture {
  let state = createEncounter('Attack-modifier fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), options.heroAt ?? { x: 1, y: 1 });
  hero.traitIds = [...options.traitIds];
  hero.abilityIds = options.abilityIds ?? [];
  hero.chapter = (options.chapter ?? 1) as 1 | 2 | 3;
  const foe = createFoe('Relict', options.foeAt ?? { x: 3, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (options.elevation) {
    state = executeCommand(state, { type: 'SET_TERRAIN', cell: { position: options.heroAt ?? { x: 1, y: 1 }, type: 'basic', elevation: options.elevation } }).state;
  }
  for (const cell of options.terrainCells ?? []) {
    state = executeCommand(state, { type: 'SET_TERRAIN', cell }).state;
  }
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe };
}

/** End every actor's turn in insertion order, advancing through the round.
 * Each boundary leaves the scheduler awaiting a controller choice, so the
 * fixture explicitly selects the next actor in insertion order (ICON p.87). */
function endAllTurns(state: EncounterState, dice = scriptedDice()): EncounterState {
  let next = state;
  for (const id of Object.keys(state.actors)) {
    if (next.activeActorId !== id) {
      if (next.activeActorId !== null) next = executeCommand(next, { type: 'END_TURN', actorId: next.activeActorId }, dice).state;
      const eligible = turnEligibleActorIds(next);
      if (!eligible.includes(id)) throw new Error('endAllTurns: ' + id + ' is not eligible here.');
      next = executeCommand(next, { type: 'TAKE_TURN', actorId: id }, dice).state;
    }
    next = executeCommand(next, { type: 'END_TURN', actorId: id }, dice).state;
  }
  return next;
}

/** End the currently active actor's turn (the round advances to the next
 * actor — used after an ability that already ended the acting actor's turn). */
function endCurrentActorTurn(state: EncounterState, dice = scriptedDice()): EncounterState {
  const activeId = state.activeActorId;
  return activeId ? executeCommand(state, { type: 'END_TURN', actorId: activeId }, dice).state : state;
}

const attackEventOf = (result: ReturnType<typeof executeCommand>) => result.events.find((event) => event.type === 'ATTACK_RESOLVED');

const bullDamageOf = (result: ReturnType<typeof executeCommand>) =>
  result.events.flatMap((event) => event.type === 'RULE_MUTATIONS_APPLIED'
    ? event.mutations.filter((mutation) => mutation.kind === 'damage' && mutation.sourceId === 'bastion:trait:bull-s-strength')
    : []);

describe('F6 attack-path trait registry', () => {
  it('promotes the four attack-family traits to wired rows', () => {
    for (const id of ['demon-slayer:trait:demon-edge', 'demon-slayer:trait:hissatsu', 'colossus:trait:pulverize', 'bastion:trait:bull-s-strength']) {
      expect(JOB_TRAIT_RECIPES[id].status).toBe('wired');
      expect(JOB_TRAIT_RECIPES[id].mechanic.length).toBeGreaterThan(0);
    }
    // Trigrammaton joined the wired rows through the range kernel's
    // exactly-range-3 attack fold, and the merge added additional attack
    // path traits, so the closed inventory is now 27.
    expect(Object.values(JOB_TRAIT_RECIPES).filter((recipe) => recipe.status === 'wired')).toHaveLength(27);
  });
});

describe('Demon Edge (p.140)', () => {
  const sixHells = (traitIds: string[]) => {
    const { state, hero, foe } = traitEncounter({
      traitIds,
      abilityIds: ['demon-slayer:six-hells-trigram'],
      foeAt: { x: 2, y: 1 },
      chapter: 3,
    });
    return { state, hero, foe };
  };

  it('arming a slow-turn arms the trait window as recorded mutations', () => {
    const { state, hero, foe } = sixHells(['demon-slayer:trait:demon-edge']);
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:six-hells-trigram', targetIds: [foe.id],
    }, scriptedDice());
    const armed = result.state.actors[hero.id];
    // Six Hells ends the turn in the same command, yet the window survives it
    // (the armed round is recorded; only a later round's turn-end clears it).
    expect(armed.resources.vigilance).toBe(1);
    expect(armed.resources['bonus-damage']).toBe(1);
    expect(armed.ruleState['demon-edge:window']).toBe(true);
    expect(armed.ruleState['demon-edge:true-strike']).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('the same ability without the trait arms nothing (control)', () => {
    const { state, hero, foe } = sixHells([]);
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:six-hells-trigram', targetIds: [foe.id],
    }, scriptedDice());
    const heroAfter = result.state.actors[hero.id];
    expect(heroAfter.resources.vigilance).toBe(0);
    expect(heroAfter.resources['bonus-damage']).toBe(0);
    expect(heroAfter.ruleState['demon-edge:window']).not.toBe(true);
    expect(heroAfter.ruleState['demon-edge:true-strike']).not.toBe(true);
  });

  it('the next attack consumes the one-shot true strike, and the window expires at the end of the owner\'s next turn', () => {
    const { state, hero, foe } = sixHells(['demon-slayer:trait:demon-edge']);
    const armed = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:six-hells-trigram', targetIds: [foe.id],
    }, scriptedDice()).state;
    // Six Hells ended the hero's turn and delayed its next turn (ICON p.95),
    // so round 2 opens with the foes; after the foe's round-2 turn the Slow
    // mini-round runs the hero's next (slow) turn.
    const foe1 = executeCommand(armed, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const afterFoe1 = endCurrentActorTurn(foe1);
    expect(afterFoe1.round).toBe(2);
    expect(afterFoe1.eligibleSide).toBe('foes');
    const foe2 = executeCommand(afterFoe1, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const afterFoe2 = endCurrentActorTurn(foe2);
    expect(afterFoe2.turnPhase).toBe('slow');
    const roundTwo = executeCommand(afterFoe2, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(roundTwo.round).toBe(2);
    expect(roundTwo.turnPhase).toBe('slow');
    // The evasion condition would normally force an evasion roll; Demon Edge's
    // true strike ignores it (p.104), so the recorded roll has no evasionRoll.
    roundTwo.actors[foe.id].conditions.push({ id: 'evasion', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const attack = executeCommand(roundTwo, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(10, 5, 6));
    const event = attackEventOf(attack)!;
    expect(event.evasionRoll).toBeNull(); // the armed true strike suppresses it
    expect(event.total).toBe(10); // Demon Edge grants true strike, not a boon
    expect(event.hit).toBe(true);
    const heroAfter = attack.state.actors[hero.id];
    expect(heroAfter.ruleState['demon-edge:true-strike']).not.toBe(true); // consumed
    // The window is still open during the hero's next turn, then the turn-end
    // recipe clears it (a round boundary has passed since arming).
    expect(heroAfter.ruleState['demon-edge:window']).toBe(true);
    const ended = endAllTurns(attack.state);
    const expired = ended.actors[hero.id];
    expect(expired.ruleState['demon-edge:window']).not.toBe(true);
    expect(expired.resources['bonus-damage']).toBe(0);
  });
});

describe('Hissatsu (p.141)', () => {
  it('a turn without attacking arms the next attack: +1 boon, true strike, d10', () => {
    const { state, hero, foe } = traitEncounter({
      traitIds: ['demon-slayer:trait:hissatsu'],
      foeAt: { x: 3, y: 1 },
    });
    let armed = endAllTurns(state); // the hero's un-attacked turn arms the trait
    expect(armed.actors[hero.id].ruleState['hissatsu:armed']).toBe(true);
    // Round 2 opens with the player side; the player selects the hero again.
    armed = executeCommand(armed, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    // The foe would evade; the armed true strike skips the evasion roll.
    armed.actors[foe.id].conditions.push({ id: 'evasion', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    // d20 7, boon d6 5, damage d10 6: total 12 (7 + 5) hits defense 6.
    const result = executeCommand(armed, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(7, 5, 6));
    const event = attackEventOf(result)!;
    expect(event.evasionRoll).toBeNull();
    expect(event.total).toBe(12);
    expect(event.hit).toBe(true);
    expect(event.rawDamage).toBe(10); // d10 6 + fray 4
    expect(result.state.actors[hero.id].ruleState['hissatsu:armed']).not.toBe(true); // consumed
    expect(applyEvents(armed, result.events)).toEqual(result.state);
  });

  it('without the trait the same dice miss (no boon) and roll the normal d6 (control)', () => {
    const { state, hero, foe } = traitEncounter({ traitIds: [], foeAt: { x: 3, y: 1 } });
    let armed = endAllTurns(state);
    expect(armed.actors[hero.id].ruleState['hissatsu:armed']).not.toBe(true);
    armed = executeCommand(armed, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    // The foe would evade, and without the armed true strike the evasion
    // roll happens (and, at 4+, cancels the attack entirely).
    armed.actors[foe.id].conditions.push({ id: 'evasion', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    // The evasion roll resolves before the d20, so the first scripted die is
    // the d6 evasion roll (5 → evades). The no-trait attack has no boon.
    const result = executeCommand(armed, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(5));
    const event = attackEventOf(result)!;
    expect(event.evasionRoll).toBe(5); // the foe's evasion condition rolls
    expect(event.total).toBeNull(); // evaded — no d20
    expect(event.hit).toBe(false);
    expect(event.rawDamage).toBe(4); // miss damage = fray
  });

  it('a turn WITH an attack does not arm', () => {
    const { state, hero, foe } = traitEncounter({
      traitIds: ['demon-slayer:trait:hissatsu'],
      foeAt: { x: 3, y: 1 },
    });
    const attacked = executeCommand(state, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(12, 4)).state;
    const ended = endAllTurns(attacked);
    expect(ended.actors[hero.id].ruleState['hissatsu:armed']).not.toBe(true);
  });
});

describe('Pulverize (p.142)', () => {
  it('attacking a lower target adds +2 flat damage, and only from two or more elevations higher does the exceed threshold drop', () => {
    // Two elevations higher: +2 flat on the hit (control: no trait, same dice).
    const { state, hero, foe } = traitEncounter({
      traitIds: ['colossus:trait:pulverize'],
      foeAt: { x: 3, y: 1 },
      elevation: 2,
    });
    const result = executeCommand(state, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(12, 6));
    const event = attackEventOf(result)!;
    const { state: control, hero: controlHero, foe: controlFoe } = traitEncounter({
      traitIds: ['colossus:trait:furious-berserk'],
      foeAt: { x: 3, y: 1 },
      elevation: 2,
    });
    const controlResult = executeCommand(control, {
      type: 'BASIC_ATTACK', actorId: controlHero.id, targetId: controlFoe.id, weight: 'light',
    }, scriptedDice(12, 6));
    const controlEvent = attackEventOf(controlResult)!;
    // Both hit with the same d20/boon; the trait adds exactly 2 to the damage.
    expect(controlEvent.rawDamage).toBe(event.rawDamage - 2);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('the VM exceed trigger fires on a 13+ at two elevations higher, not at 12 and not without the trait', () => {
    const actor = (id: string, side: 'heroes' | 'foes', traitIds: string[], x: number) => ({
      id, side, position: { x, y: 0 }, hp: 20, maxHp: 40, vitality: 10, vigor: 0,
      defense: 6, armor: 0, speed: 4, dash: 2, fray: 4, damageDie: 6, actions: 2, attacked: false,
      size: 1, defeated: false, conditions: new Set<string>(), statuses: [],
      statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
      resources: {}, state: {}, traitIds, talents: {}, abilityIds: [], masteredAbilityIds: [], marks: [],
    });
    const state = {
      round: 1, grid: { width: 10, height: 10 },
      actors: { hero: actor('hero', 'heroes', ['colossus:trait:pulverize'], 0), foe: actor('foe', 'foes', [], 3) },
      entities: {}, terrainEffects: [],
      terrainAt: () => new Set<string>(),
      elevationAt: (position: Position) => (position.x === 0 ? 2 : 0),
    };
    const program: RuleProgram = {
      schemaVersion: 1, rulesVersion: '1.5', id: 'program:pulverize', sourceId: 'test:pulverize',
      source: { page: 1, sectionId: 'test' }, name: 'Pulverize', classification: 'encounter', dependencies: [],
      actions: [{ id: 'use', name: 'Pulverize', timing: 'use', costs: [], tags: ['attack'], range: null, area: null, choices: [], steps: [
        { id: 'attack', timing: 'use', effects: [{
          kind: 'attack', target: { kind: 'input', key: 'target' },
          onHit: [
            { kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'constant', value: 5 }, damageType: 'normal', delivery: 'hit', ignoreCover: false },
            // The exceed-gated branch fires from the roll's branch context —
            // the same surface the runtime exceed detection feeds.
            { kind: 'if', predicate: { kind: 'trigger', trigger: 'exceed' }, then: [{ kind: 'vigor', target: { kind: 'self' }, amount: { kind: 'constant', value: 3 } }] },
          ], onMiss: [],
        }] },
      ] }],
    };
    const run = (traitIds: string[], dice: ReturnType<typeof scriptedDice>) => executeRuleProgram(program, {
      state: { ...state, actors: { ...state.actors, hero: { ...state.actors.hero, traitIds } } },
      actorId: 'hero', sourceId: 'test:pulverize', actionId: 'use', timing: 'use',
      input: { actorIds: { target: ['foe'] } }, dice, triggers: new Set(),
    }, {});
    const exceeded = (result: ReturnType<typeof executeRuleProgram>) => result.mutations.some((mutation) => mutation.kind === 'vigor');
    // d20 13 + boon (elevation) 1 = total 14 → 13+ threshold fires.
    expect(exceeded(run(['colossus:trait:pulverize'], scriptedDice(13, 1, 1)))).toBe(true);
    // d20 12 + 1 = 13 → still fires (13+).
    expect(exceeded(run(['colossus:trait:pulverize'], scriptedDice(12, 1, 1)))).toBe(true);
    // d20 11 + 1 = 12 → below 13 → no exceed.
    expect(exceeded(run(['colossus:trait:pulverize'], scriptedDice(11, 1, 1)))).toBe(false);
    // No trait: 14 < 15 → no exceed.
    expect(exceeded(run([], scriptedDice(13, 1, 1)))).toBe(false);
  });

  it('the kernel read is a pure elevation function (unit)', () => {
    const owner = { traitIds: ['colossus:trait:pulverize'], state: {} };
    expect(traitAttackModifier(owner, 0)).toMatchObject({ bonusDamageFlat: 0, exceedThreshold: null });
    expect(traitAttackModifier(owner, 1)).toMatchObject({ bonusDamageFlat: 2, exceedThreshold: null });
    expect(traitAttackModifier(owner, 2)).toMatchObject({ bonusDamageFlat: 2, exceedThreshold: 13 });
  });
});

describe('Bull\'s Strength (p.149)', () => {
  it('a colliding shove deals 2 damage to the shoved character and records the once-per-turn guard', () => {
    const { state, hero, foe } = traitEncounter({
      traitIds: ['bastion:trait:bull-s-strength'],
      abilityIds: ['bastion:heracule'],
      heroAt: { x: 1, y: 1 },
      foeAt: { x: 2, y: 1 },
      // Heracule's default shove pushes the foe away from the hero; the
      // impassable cell behind the foe stops the push → collide (p.95).
      terrainCells: [{ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 }],
    });
    const hpBefore = state.actors[foe.id].hp;
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [foe.id],
    }, scriptedDice());
    const bullDamage = bullDamageOf(result);
    expect(bullDamage).toHaveLength(1);
    expect(bullDamage[0]).toMatchObject({ actorId: foe.id, amount: 2 });
    // Heracule's own attack also damages the foe; the hp drop is the sum of
    // the recorded damage mutations (attack + collide).
    const foeDamage = result.events.flatMap((event) => event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [])
      .filter((mutation): mutation is Extract<RuleMutation, { kind: 'damage' }> => mutation.kind === 'damage' && mutation.actorId === foe.id);
    const totalDamage = foeDamage.reduce((sum, mutation) => sum + mutation.amount, 0);
    expect(result.state.actors[foe.id].hp).toBe(hpBefore - totalDamage);
    // The gate is a recorded U16 ledger consume mutation, so replay applies it too.
    const guardMutation = result.events.flatMap((event) => event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [])
      .find((mutation) => mutation.kind === 'state' && mutation.key === 'ledger:turn:core:bull-s-strength');
    expect(guardMutation).toMatchObject({ value: true });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('the fold awards the collide damage once even when an ability shoves twice (unit)', () => {
    const { state, hero, foe } = traitEncounter({
      traitIds: ['bastion:trait:bull-s-strength'],
      abilityIds: ['bastion:heracule'],
      heroAt: { x: 1, y: 1 },
      foeAt: { x: 2, y: 1 },
    });
    const shove = (targetId: string): RuleMutation => ({
      kind: 'move', sourceId: 'test', sourceActorId: hero.id, actorId: targetId, movement: 'shove', distance: 1,
      positions: [], direction: { x: -1, y: 0 }, phasing: false,
    });
    // Two shoves of the same foe (or two foes) both collide; only one damage.
    const appended = bullStrengthCollideMutations(state, [shove(foe.id), shove(foe.id)]);
    expect(appended.filter((mutation) => mutation.kind === 'damage')).toHaveLength(1);
    expect(appended.filter((mutation) => mutation.kind === 'state')).toHaveLength(1);
  });

  it('the gate refreshes at the owner\'s next turn-start so it can fire again', () => {
    const { state, hero, foe } = traitEncounter({
      traitIds: ['bastion:trait:bull-s-strength'],
      abilityIds: ['bastion:heracule'],
      heroAt: { x: 1, y: 1 },
      foeAt: { x: 2, y: 1 },
      terrainCells: [{ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 }],
    });
    const collided = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [foe.id],
    }, scriptedDice()).state;
    expect(useLedgerAvailable(collided.actors[hero.id], 'ledger:turn:core:bull-s-strength')).toBe(false);
    // A second collide shove this turn (the fold, gate now consumed) fires no
    // additional damage and records no new consume.
    const shove = (targetId: string): RuleMutation => ({
      kind: 'move', sourceId: 'test', sourceActorId: hero.id, actorId: targetId, movement: 'shove', distance: 1,
      positions: [], direction: { x: -1, y: 0 }, phasing: false,
    });
    expect(bullStrengthCollideMutations(collided, [shove(foe.id)])).toEqual([]);
    // Taking the owner's next turn (through every other actor) refreshes the
    // U16 owner-relative turn gate: end the owner's turn, take + end every
    // other actor, then take the owner's next turn (its turn-start recipe
    // clears the owner-relative `ledger:turn:*` gate).
    let s = executeCommand(collided, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    for (const id of Object.keys(s.actors)) {
      if (id === hero.id) continue;
      s = executeCommand(s, { type: 'TAKE_TURN', actorId: id }, scriptedDice()).state;
      s = executeCommand(s, { type: 'END_TURN', actorId: id }, scriptedDice()).state;
    }
    s = executeCommand(s, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(useLedgerAvailable(s.actors[hero.id], 'ledger:turn:core:bull-s-strength')).toBe(true);
  });
});
