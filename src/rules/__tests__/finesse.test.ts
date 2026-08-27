import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { executeRuleProgram } from '../automation/kernels/runtime.js';
import { action, damageDie } from '../automation/primitives/job-kit.js';
import type { RuleExecutionContext, RuleProgram } from '../automation/primitives/types.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { findRuleSourceUnit } from '../source-units.js';
import { scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

/**
 * Vagabond Finesse class trait (ICON p.116): "You deal bonus damage to
 * bloodied foes." This is a RECIPIENT-scoped bonus-damage grant
 * (content/jobs/bonus-damage-recipes.ts through kernels/bonus-damage.ts):
 * the shared damage-roll authority adds one bonus die — "roll one more die
 * than normal, then pick the highest" (ICON p.102) — per bloodied damage
 * recipient at the roll query point. The primary attack target's state never
 * leaks onto other recipients, and a bloodied secondary recipient never
 * loses the die because the primary target is healthy.
 *
 * Vagabond Gambit (ICON p.145): "If you take a Vagabond Ability as a
 * non-Vagabond class, your vagabond abilities benefit from Finesse." The
 * engine's authoritative ownership surface (the character's durable
 * `classId` and the ability catalog's `classId`) decides the branch — never
 * a name match.
 */
describe('Vagabond Finesse class trait (p.116)', () => {
  it('audits executable through the recipient bonus-damage rule', () => {
    const unit = findRuleSourceUnit('vagabond:trait:finesse')!;
    expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
  });

  it('deals bonus damage to a bloodied foe (roll one more die, keep highest)', () => {
    let state = createEncounter('Finesse fixture');
    const hero = actorFromCharacter(validCharacter('Rogue'), { x: 1, y: 1 });
    hero.abilityIds = ['knave:low-blow'];
    hero.traitIds = ['vagabond:trait:finesse'];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 2, y: 1 });
    foe.hp = 10; // bloodied (Relict max 32 → at/below 16)
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    // d20 12 hits; damage dice 3 then 4 — the bonus die keeps the highest → 4 + fray 4.
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:low-blow', targetIds: [foe.id] }, scriptedDice(12, 3, 4));
    expect(result.state.actors[foe.id].hp).toBe(10 - (4 + 4));
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('no bonus die against a healthy foe', () => {
    const healthy = createEncounter('Finesse fixture');
    const healthyHero = actorFromCharacter(validCharacter('Rogue'), { x: 1, y: 1 });
    healthyHero.abilityIds = ['knave:low-blow'];
    healthyHero.traitIds = ['vagabond:trait:finesse'];
    healthyHero.chapter = 3;
    const healthyFoe = createFoe('Relict', { x: 2, y: 1 });
    let healthyState = executeCommand(healthy, { type: 'ADD_ACTOR', actor: healthyHero }).state;
    healthyState = executeCommand(healthyState, { type: 'ADD_ACTOR', actor: healthyFoe }).state;
    healthyState = startEncounterTo(healthyState, healthyHero.id);
    const plain = executeCommand(healthyState, { type: 'USE_ABILITY', actorId: healthyHero.id, abilityId: 'knave:low-blow', targetIds: [healthyFoe.id] }, scriptedDice(12, 5));
    expect(plain.state.actors[healthyFoe.id].hp).toBe(23); // 32 - (5 + 4)
    expect(applyEvents(healthyState, plain.events)).toEqual(plain.state);
  });

  it('no ordinary Finesse bonus without the trait', () => {
    const bare = createEncounter('Finesse fixture');
    const bareHero = actorFromCharacter(validCharacter('Rogue'), { x: 1, y: 1 });
    bareHero.abilityIds = ['knave:low-blow'];
    bareHero.traitIds = [];
    bareHero.chapter = 3;
    const bareFoe = createFoe('Relict', { x: 2, y: 1 });
    bareFoe.hp = 10;
    let bareState = executeCommand(bare, { type: 'ADD_ACTOR', actor: bareHero }).state;
    bareState = executeCommand(bareState, { type: 'ADD_ACTOR', actor: bareFoe }).state;
    bareState = startEncounterTo(bareState, bareHero.id);
    const noTrait = executeCommand(bareState, { type: 'USE_ABILITY', actorId: bareHero.id, abilityId: 'knave:low-blow', targetIds: [bareFoe.id] }, scriptedDice(12, 5));
    expect(noTrait.state.actors[bareFoe.id].hp).toBe(1); // 10 - (5 + 4)
    expect(applyEvents(bareState, noTrait.events)).toEqual(noTrait.state);
  });

  it('a single ability damaging a bloodied and a healthy foe distinguishes the recipients', () => {
    // The recipient-level fold is exercised at the roll query point with the
    // actual recipient threaded per damage effect target: one ability that
    // rolls [D] against every foe must award the bonus die to the bloodied
    // foe and not to the healthy one.
    let state = createEncounter('Finesse multi-recipient fixture');
    const hero = actorFromCharacter(validCharacter('Rogue'), { x: 1, y: 1 });
    hero.traitIds = ['vagabond:trait:finesse'];
    const bloodied = createFoe('Relict', { x: 2, y: 1 });
    bloodied.hp = 10; // bloodied
    const healthy = createFoe('Relict', { x: 3, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: bloodied }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: healthy }).state;
    const program: RuleProgram = {
      schemaVersion: 1,
      rulesVersion: '1.5',
      id: 'program:fixture:multi-damage',
      sourceId: 'fixture:multi-damage',
      source: { page: 116, sectionId: 'vagabond' },
      name: 'Multi-recipient damage fixture',
      actions: [action({
        name: 'Multi-recipient damage fixture',
        timing: 'use',
        steps: [{ id: 'strike', timing: 'use', effects: [
          { kind: 'damage', target: { kind: 'all', relation: 'foe' }, amount: damageDie(1), damageType: 'normal', delivery: 'effect' },
        ] }],
      })],
      dependencies: [],
      classification: 'encounter',
    };
    const context: RuleExecutionContext = {
      state: encounterRuleState(state),
      encounterState: state,
      actorId: hero.id,
      sourceId: 'fixture:multi-damage',
      actionId: 'default',
      timing: 'use',
      input: {},
      dice: scriptedDice(3, 4, 2),
    };
    const result = executeRuleProgram(program, context);
    const byActor = new Map(result.mutations.filter((mutation) => mutation.kind === 'damage')
      .map((mutation) => [mutation.actorId, mutation.amount]));
    // Bloodied foe rolls one bonus die (3 and 4 → keep 4); the healthy foe
    // rolls a single die (2). The primary target is irrelevant: each
    // recipient is judged on its own bloodied state.
    expect(byActor.get(bloodied.id)).toBe(4);
    expect(byActor.get(healthy.id)).toBe(2);
  });

  it('Vagabond Gambit: a non-Vagabond class benefits on a Vagabond ability', () => {
    let state = createEncounter('Gambit fixture');
    // A stalwart-class hero (Bastion primary job) that took a Fool (Vagabond
    // class) ability: the Gambit extends Finesse to that ability even though
    // the character has no Finesse trait.
    const hero = actorFromCharacter(validCharacter('Paladin'), { x: 1, y: 1 });
    hero.abilityIds = ['fool:cavaliere'];
    hero.traitIds = [];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 2, y: 1 });
    foe.hp = 10; // bloodied
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    // d20 12 hits; dice 3 then 4 — the Gambit bonus keeps the highest. The
    // fixture hero carries Bastion class stats (fray 4), so [D]+fray = 4 + 4.
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:cavaliere', targetIds: [foe.id] }, scriptedDice(12, 3, 4));
    expect(result.state.actors[foe.id].hp).toBe(10 - (4 + 4));
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Vagabond Gambit does NOT grant Finesse to a non-Vagabond ability', () => {
    let state = createEncounter('Gambit control fixture');
    const hero = actorFromCharacter(validCharacter('Paladin'), { x: 1, y: 1 });
    hero.abilityIds = ['colossus:valkyrie'];
    hero.traitIds = [];
    hero.chapter = 1;
    const foe = createFoe('Relict', { x: 2, y: 1 });
    foe.hp = 10; // bloodied
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    // A single damage die: the Gambit must not grant a global Finesse to the
    // hero's own-class (stalwart) ability. Fixture hero: Bastion stats (fray 4).
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:valkyrie', targetIds: [foe.id] }, scriptedDice(12, 5));
    expect(result.state.actors[foe.id].hp).toBe(10 - (5 + 4));
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('stacks with another legitimate bonus-damage instance (one more die each, p.102)', () => {
    let state = createEncounter('Finesse stacking fixture');
    const hero = actorFromCharacter(validCharacter('Rogue'), { x: 1, y: 1 });
    hero.abilityIds = ['knave:low-blow'];
    hero.traitIds = ['vagabond:trait:finesse'];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 2, y: 1 });
    foe.hp = 12; // bloodied
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    // One extra die from Finesse plus one from the p.102 bonus-damage charge
    // (Blackheart/Demon Edge one-shot resource): three dice total, keep the
    // highest (6) → 6 + fray 4.
    state.actors[hero.id].resources['bonus-damage'] = 1;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:low-blow', targetIds: [foe.id] }, scriptedDice(12, 3, 4, 6));
    expect(result.state.actors[foe.id].hp).toBe(12 - (6 + 4));
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
