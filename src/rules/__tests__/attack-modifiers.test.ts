import { describe, expect, it } from 'vitest';
import { executeRuleProgram } from '../automation/kernels/runtime.js';
import { bullStrengthCollideMutations } from '../automation/content/jobs/attack-modifier-recipes.js';
import { traitAttackModifier } from '../automation/kernels/attack-modifiers.js';
import { bonusDamageDiceForUse } from '../automation/kernels/bonus-damage.js';
import '../automation/content/registry.js';
import { JOB_TRAIT_RECIPES } from '../automation/content/jobs/job-trait-recipes.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState, Position, TerrainCell } from '../types.js';
import type { RuleMutation, RuleProgram } from '../automation/primitives/types.js';import { scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';
import { bullStrengthCollideKey, useLedgerAvailable } from '../automation/kernels/use-ledger.js';
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
    // path traits, so the closed inventory is now 27. The heroic-activation
    // tranche (2026-09-01) added Demon Strength and Spite (the validated
    // heroic transaction + attack-gate lockout), so it is now 29.
    expect(Object.values(JOB_TRAIT_RECIPES).filter((recipe) => recipe.status === 'wired')).toHaveLength(29);
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

describe('Pulverize (p.134)', () => {
  it('attacking a lower target deals GENUINE bonus damage (one extra die, keep highest); two or more elevations higher SOURCE-FORCES the exceed', () => {
    // ICON p.134: "When you start an attack ability on higher elevation than
    // your target, it deals bonus damage." Bonus damage is the p.102 dice
    // mechanic — roll one extra damage die, keep the normal number of
    // highest dice — NOT a flat +2. With a light attack (1 [D] die) the
    // trait rolls a second damage die and keeps the higher one.
    const { state, hero, foe } = traitEncounter({
      traitIds: ['colossus:trait:pulverize'],
      foeAt: { x: 3, y: 1 },
      elevation: 2,
    });
    const result = executeCommand(state, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(12, 3, 6, 2, 5));
    const event = attackEventOf(result)!;
    const { state: control, hero: controlHero, foe: controlFoe } = traitEncounter({
      traitIds: ['colossus:trait:furious-berserk'],
      foeAt: { x: 3, y: 1 },
      elevation: 2,
    });
    const controlResult = executeCommand(control, {
      type: 'BASIC_ATTACK', actorId: controlHero.id, targetId: controlFoe.id, weight: 'light',
    }, scriptedDice(12, 3, 6, 2, 5));
    const controlEvent = attackEventOf(controlResult)!;
    // Same d20 (12) and the same two boon rolls (3, 6 → modifier 6): the
    // sustained d20 + boon total hits in both. The damage dice follow:
    // control rolls one [D] die (2), the trait rolls an EXTRA die (5) and
    // keeps the highest (5). rawDamage = kept 5 + fray 4 = 9 vs control
    // 2 + 4 = 6 — the trait adds the KEPT DIE (3), never a flat +2 (which
    // would yield 8, not 9 — the scripted dice discriminate the p.102
    // keep-highest bonus-damage mechanic from a flat substitute).
    expect(event.rawDamage).toBe(9);
    expect(controlEvent.rawDamage).toBe(6);
    expect(event.rawDamage).toBe(controlEvent.rawDamage + 3);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('two or more elevations higher SOURCE-FORCES the VM exceed branch — regardless of the roll, and never without the trait', () => {
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
    const fact = (result: ReturnType<typeof executeRuleProgram>) => {
      const attack = result.mutations.find((mutation) => mutation.kind === 'attack');
      return attack && attack.kind === 'attack' ? attack.exceed === true : false;
    };
    // The source text is "…If you are two or more levels higher, it also
    // triggers all exceed effects" — a SOURCE-FORCED exceed, not a threshold
    // reduction. With the trait, the exceed FACT is true regardless of the
    // roll: d20 6 + boon (elevation) 1 = 7 hits (defense 6) with a low total
    // and the exceed branch still fires; a miss at d20 2 records the fact too.
    expect(exceeded(run(['colossus:trait:pulverize'], scriptedDice(6, 1, 1)))).toBe(true);
    expect(fact(run(['colossus:trait:pulverize'], scriptedDice(6, 1, 1)))).toBe(true);
    expect(fact(run(['colossus:trait:pulverize'], scriptedDice(2, 1, 1)))).toBe(true); // miss — the elevation still forces the fact
    // Without the trait, 14 < 15 → no natural exceed and nothing forces it.
    expect(exceeded(run([], scriptedDice(13, 1, 1)))).toBe(false);
    expect(fact(run([], scriptedDice(13, 1, 1)))).toBe(false);
  });

  it('the command boundary records a SOURCE-FORCED exceed activation for a Pulverize attack (and never without the trait)', () => {
    // The elevation condition produces the SAME trigger as the natural 15+
    // roll, but with source-forced provenance (trigger-provenance.ts) — the
    // boundary records how the trigger became active, it never forges one.
    const { state, hero, foe } = traitEncounter({ traitIds: ['colossus:trait:pulverize'], abilityIds: ['freelancer:strafe-shot'], elevation: 2 });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'freelancer:strafe-shot', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] } }, attackTargetId: foe.id,
    }, scriptedDice(6, 1, 1));
    const event = result.events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED');
    expect(event && event.type === 'RULE_MUTATIONS_APPLIED'
      ? event.triggerActivations?.some(({ trigger, provenance }) => trigger === 'exceed' && provenance === 'source-forced')
      : false).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);

    const control = traitEncounter({ traitIds: ['colossus:trait:furious-berserk'], abilityIds: ['freelancer:strafe-shot'], elevation: 2 });
    const controlResult = executeCommand(control.state, {
      type: 'EXECUTE_RULE', actorId: control.hero.id, sourceId: 'freelancer:strafe-shot', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [control.foe.id] } }, attackTargetId: control.foe.id,
    }, scriptedDice(6, 1, 1));
    const controlEvent = controlResult.events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED');
    expect(controlEvent && controlEvent.type === 'RULE_MUTATIONS_APPLIED'
      ? controlEvent.triggerActivations?.some(({ trigger, provenance }) => trigger === 'exceed' && provenance === 'source-forced')
      : false).toBe(false);
    expect(applyEvents(control.state, controlResult.events)).toEqual(controlResult.state);
  });

  it('the elevation BONUS-DAMAGE half is an ability-use fold, not an attack modifier (unit)', () => {
    // "When you start an attack ability on higher elevation than your target,
    // it deals bonus damage" (p.135) — "it" is the attack ABILITY, so the
    // bonus die rides the shared ability-use bonus-damage fold
    // (`bonusDamageDiceForUse`, kernels/bonus-damage.ts), never an attack-
    // space-only provenance field. The attack-modifier trait fold keeps only
    // the SOURCE-FORCED exceed half (two or more elevations higher).
    const owner = { traitIds: ['colossus:trait:pulverize'], state: {} };
    expect(traitAttackModifier(owner, 0)).toMatchObject({ bonusDamageFlat: 0, forceExceed: false });
    expect(traitAttackModifier(owner, 1)).toMatchObject({ bonusDamageFlat: 0, forceExceed: false });
    expect(traitAttackModifier(owner, 2)).toMatchObject({ bonusDamageFlat: 0, forceExceed: true });
    // The ability-use fold awards the die at one or more elevations higher
    // against the attack target, and none when the target is not lower.
    const { state, hero, foe } = traitEncounter({ traitIds: ['colossus:trait:pulverize'], foeAt: { x: 3, y: 1 }, elevation: 1 });
    expect(bonusDamageDiceForUse(state, hero, 'colossus:takedown', [foe.id])).toBe(1);
    expect(bonusDamageDiceForUse(state, hero, 'colossus:takedown', [hero.id])).toBe(0); // self target — no lower foe
    const { state: flat, hero: flatHero, foe: flatFoe } = traitEncounter({ traitIds: ['colossus:trait:pulverize'], foeAt: { x: 3, y: 1 } });
    expect(bonusDamageDiceForUse(flat, flatHero, 'colossus:takedown', [flatFoe.id])).toBe(0); // same elevation
  });

  it('Pulverize bonus damage is ABILITY-WIDE: a collateral [D] roll of the same attack ability carries the die too (discriminating test)', () => {
    // Source interpretation (documented in attack-modifier-recipes.ts /
    // docs/rules-coverage.md): "it deals bonus damage" refers to the attack
    // ABILITY — every damage roll the ability makes carries one extra die
    // (p.102 keep-highest), including collateral [D] rolls of the same
    // ability, never only the attack-space damage. Build a synthetic AoE
    // attack program whose collateral effect rolls [D]: the boundary folds
    // Pulverize's die into `abilityUseModifiers`, and BOTH damage rolls
    // consume an extra die through the shared keep-highest evaluation.
    const hero = (id: string, traitIds: string[], side: 'heroes' | 'foes') => ({
      id, side, position: { x: side === 'heroes' ? 0 : 3, y: 0 }, hp: 20, maxHp: 40, vitality: 10, vigor: 0,
      defense: 6, armor: 0, speed: 4, dash: 2, fray: 4, damageDie: 6, actions: 2, attacked: false,
      size: 1, defeated: false, conditions: new Set<string>(), statuses: [],
      statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
      resources: {}, state: {}, traitIds, talents: {}, abilityIds: [], masteredAbilityIds: [], marks: [],
    });
    const state = {
      round: 1, grid: { width: 10, height: 10 },
      actors: { hero: hero('hero', ['colossus:trait:pulverize'], 'heroes'), foeA: hero('foeA', [], 'foes'), foeB: hero('foeB', [], 'foes') },
      entities: {}, terrainEffects: [],
      terrainAt: () => new Set<string>(),
      elevationAt: (position: Position) => (position.x === 0 ? 2 : 0),
    };
    const program: RuleProgram = {
      schemaVersion: 1, rulesVersion: '1.5', id: 'program:test', sourceId: 'test:aoe-attack',
      source: { page: 1, sectionId: 'test' }, name: 'AoE attack', classification: 'encounter', dependencies: [],
      actions: [{ id: 'use', name: 'AoE attack', timing: 'use', costs: [], tags: ['attack'], range: null, area: null, choices: [], steps: [
        { id: 'attack', timing: 'use', effects: [{
          kind: 'attack', target: { kind: 'input', key: 'target' },
          onHit: [
            // Direct attack damage: one [D] (keep-highest with the bonus die).
            { kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'damage-roll', actor: { kind: 'self' }, dice: { kind: 'constant', value: 1 } }, damageType: 'normal', delivery: 'hit', ignoreCover: false },
            // COLLATERAL [D] roll of the SAME ability (an AoE attack whose
            // area effect rolls [D]) — under the ability-wide reading this
            // roll also carries the bonus die.
            { kind: 'damage', target: { kind: 'input', key: 'collateral' }, amount: { kind: 'damage-roll', actor: { kind: 'self' }, dice: { kind: 'constant', value: 1 } }, damageType: 'normal', delivery: 'area', ignoreCover: false },
          ], onMiss: [],
        }] },
      ] }],
    };
    // The boundary would fold Pulverize's die into abilityUseModifiers at
    // the ability-use query point; replay applies the recorded rolls.
    const run = (abilityUseModifiers?: { bonusDamageDice?: number }) => executeRuleProgram(program, {
      state, actorId: 'hero', sourceId: 'test:aoe-attack', actionId: 'use', timing: 'use',
      // d20 12, boon d6s 3+6 → 6 (total 18 hits defense 6), base damage 2
      // and 2, bonus damage dice 5 and 5.
      input: { actorIds: { target: ['foeA'], collateral: ['foeB'] } }, dice: scriptedDice(12, 3, 6, 2, 2, 5, 5), triggers: new Set(),
      ...(abilityUseModifiers ? { abilityUseModifiers } : {}),
    }, {});
    const without = run();
    const withTrait = run({ bonusDamageDice: 1 });
    const damageOf = (result: ReturnType<typeof executeRuleProgram>) => result.mutations
      .filter((mutation): mutation is Extract<RuleMutation, { kind: 'damage' }> => mutation.kind === 'damage')
      .map((mutation) => ({ actorId: mutation.actorId, amount: mutation.amount }));
    // WITHOUT the trait each [D] roll keeps its single die (2 and 2). WITH
    // the trait, EVERY damage roll of the ability rolls one extra die and
    // keeps the higher (p.102): the direct roll keeps 2 (2 vs 2) AND the
    // COLLATERAL roll keeps 5 (5 vs 5) — the collateral roll consumed a
    // second die exactly because the bonus is ability-wide, never
    // attack-space-only. (If the bonus were attack-space-only, the
    // collateral roll would still consume just one die and keep 2.)
    expect(damageOf(without)).toEqual([{ actorId: 'foeA', amount: 2 }, { actorId: 'foeB', amount: 2 }]);
    expect(damageOf(withTrait)).toEqual([{ actorId: 'foeA', amount: 2 }, { actorId: 'foeB', amount: 5 }]);
  });
});

describe('Bull\'s Strength (p.149)', () => {
  /** A single synthetic colliding shove from the hero (pushed into the hero's
   * own cell or an impassable cell, so `collidingShoveTargets` reports it). */
  const shove = (heroId: string, targetId: string): RuleMutation => ({
    kind: 'move', sourceId: 'test', sourceActorId: heroId, actorId: targetId, movement: 'shove', distance: 1,
    positions: [], direction: { x: -1, y: 0 }, phasing: false,
  });

  /** Hero at (1,1), foe A at (2,1) (a -x shove lands on the hero → collide),
   * impassable cell at (3,1), foe B at (4,1) (a -x shove lands on the
   * impassable cell → collide). */
  function bullStrengthEncounter(): { state: EncounterState; hero: EncounterActor; foeA: EncounterActor; foeB: EncounterActor } {
    const { state, hero, foe } = traitEncounter({
      traitIds: ['bastion:trait:bull-s-strength'],
      abilityIds: ['bastion:heracule'],
      heroAt: { x: 1, y: 1 },
      foeAt: { x: 2, y: 1 },
      terrainCells: [{ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 }],
    });
    const foeB = createFoe('Grim', { x: 4, y: 1 });
    state.actors[foeB.id] = foeB;
    return { state, hero, foeA: foe, foeB };
  }

  it('a colliding shove deals 2 damage to the shoved character and records the per-target any-turn guard on the owner', () => {
    const { state, hero, foeA } = bullStrengthEncounter();
    const hpBefore = state.actors[foeA.id].hp;
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [foeA.id],
    }, scriptedDice());
    const bullDamage = bullDamageOf(result);
    expect(bullDamage).toHaveLength(1);
    expect(bullDamage[0]).toMatchObject({ actorId: foeA.id, amount: 2 });
    // Heracule's own attack also damages the foe; the hp drop is the sum of
    // the recorded damage mutations (attack + collide).
    const foeDamage = result.events.flatMap((event) => event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [])
      .filter((mutation): mutation is Extract<RuleMutation, { kind: 'damage' }> => mutation.kind === 'damage' && mutation.actorId === foeA.id);
    const totalDamage = foeDamage.reduce((sum, mutation) => sum + mutation.amount, 0);
    expect(result.state.actors[foeA.id].hp).toBe(hpBefore - totalDamage);
    // The gate is a recorded U16 consume mutation keyed on the TARGET and
    // stored on the OWNER's ruleState, so replay applies it too. The owner
    // (Bastion) holds it — never the target's own ruleState.
    const key = bullStrengthCollideKey(foeA.id);
    const guardMutation = result.events.flatMap((event) => event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [])
      .find((mutation) => mutation.kind === 'state' && mutation.key === key);
    expect(guardMutation).toMatchObject({ value: true, actorId: hero.id });
    expect(result.state.actors[hero.id].ruleState[key]).toBe(true);
    expect(result.state.actors[foeA.id].ruleState[key]).toBeUndefined();
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('the fold awards the collide damage exactly once per target within one command', () => {
    const { state, hero, foeA, foeB } = bullStrengthEncounter();
    // Same target shoved twice in one command: one damage, one consume — the
    // planning set dedupes by the U16 owner+target identity.
    const sameTarget = bullStrengthCollideMutations(state, [shove(hero.id, foeA.id), shove(hero.id, foeA.id)]);
    expect(sameTarget.filter((mutation) => mutation.kind === 'damage')).toHaveLength(1);
    expect(sameTarget.filter((mutation) => mutation.kind === 'state')).toHaveLength(1);
    // Two DIFFERENT targets each collide: each takes its own damage — the
    // per-target gate never merges two recipients into one use.
    const twoTargets = bullStrengthCollideMutations(state, [shove(hero.id, foeA.id), shove(hero.id, foeB.id)]);
    expect(twoTargets.filter((mutation) => mutation.kind === 'damage')).toHaveLength(2);
    expect(twoTargets.filter((mutation) => mutation.kind === 'state')).toHaveLength(2);
    expect(twoTargets.filter((mutation) => mutation.kind === 'state' && mutation.key === bullStrengthCollideKey(foeB.id))).toHaveLength(1);
  });

  it('a consumed target does not block a different target (per-target isolation)', () => {
    const { state, hero, foeA, foeB } = bullStrengthEncounter();
    // Simulate target A's already-recorded consume (a prior collide this turn).
    state.actors[hero.id].ruleState[bullStrengthCollideKey(foeA.id)] = true;
    const appended = bullStrengthCollideMutations(state, [shove(hero.id, foeA.id), shove(hero.id, foeB.id)]);
    // A: blocked (no new damage, no new consume). B: still entitled.
    expect(appended.filter((mutation) => mutation.kind === 'damage')).toHaveLength(1);
    expect(appended[0]).toMatchObject({ actorId: foeB.id, amount: 2 });
    expect(appended.filter((mutation) => mutation.kind === 'state')).toHaveLength(1);
    expect(appended.find((mutation) => mutation.kind === 'state' && mutation.key === bullStrengthCollideKey(foeB.id))).toBeDefined();
  });

  it('the battlefield any-turn window reopens at the next actor\'s turn start — no owner-turn dependency', () => {
    const { state, hero, foeA } = bullStrengthEncounter();
    const collided = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [foeA.id],
    }, scriptedDice()).state;
    const key = bullStrengthCollideKey(foeA.id);
    expect(useLedgerAvailable(collided.actors[hero.id], key)).toBe(false);
    // A second collide shove this turn (the fold, window still consumed) fires
    // no additional damage and records no new consume.
    expect(bullStrengthCollideMutations(collided, [shove(hero.id, foeA.id)])).toEqual([]);
    // The window is BATTLEFIELD any-turn: ending the owner's turn and starting
    // the FOE's turn reopens it — the Bastion never takes its own turn between.
    let s = executeCommand(collided, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    s = executeCommand(s, { type: 'TAKE_TURN', actorId: foeA.id }, scriptedDice()).state;
    expect(useLedgerAvailable(s.actors[hero.id], key)).toBe(true);
  });
});
