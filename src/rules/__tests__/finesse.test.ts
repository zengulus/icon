import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { findRuleSourceUnit } from '../source-units.js';
import { scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

/**
 * Vagabond Finesse class trait (ICON p.116): "You deal bonus damage to
 * bloodied foes." The `finesse` condition is projected from the equipped
 * trait (classes/trait-condition-recipes.ts through the shared passive
 * projection), and the shared damage-roll authority adds one bonus die —
 * "roll one more die than normal, then pick the highest" (ICON p.102) —
 * whenever the attack target is bloodied. No resolver code is needed: the
 * trait audits complete through its allowlist and this behavioral pair
 * proves the roll-time gate.
 */
describe('Vagabond Finesse class trait (p.116)', () => {
  it('audits executable and projects the finesse condition', () => {
    const unit = findRuleSourceUnit('vagabond:trait:finesse')!;
    expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
  });

  it('deals bonus damage against a bloodied foe (roll one more die, keep highest)', () => {
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
    // The `finesse` condition is projected onto the attacker's runtime view
    // from the trait (passive-projection kernel), so the shared damage-roll
    // authority adds the bonus die exactly when the attack target is bloodied.
    // d20 12 hits; damage rolls 3 then 4 — bonus damage keeps the highest → 4 + fray 4.
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:low-blow', targetIds: [foe.id] }, scriptedDice(12, 3, 4));
    expect(result.state.actors[foe.id].hp).toBe(10 - (4 + 4));
    expect(applyEvents(state, result.events)).toEqual(result.state);

    // Non-bloodied foe: a single die, no bonus.
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

    // Bloodied foe but the trait absent: no bonus die.
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
});
