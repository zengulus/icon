import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterState } from '../types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/**
 * Trigger provenance (ICON p.95 + the deriveTriggers contract): Charge,
 * Comeback, and Finishing Blow are derived from AUTHORITATIVE STATE (the
 * durable slow-turn flag, the bloodied target); Exceed is derived from the
 * ability's OWN attack roll at 15+; Collide and Slay derive from the
 * resolution's OWN shove/defeat facts. None of them may be asserted by a
 * command — a forged assertion fails closed before any cost, effect, or RNG
 * runs. Heroic and Infuse are genuine caller declarations (they gate a
 * resource spend / a Stalwart gambit decision) and remain assertable.
 *
 * The direct-context clause tests elsewhere (conditions.test.ts,
 * harvester.test.ts, talents.test.ts) still prove resolver-local clauses by
 * constructing the recorded-fact context BY HAND — that is the documented
 * seam for clauses that the reactive append pass cannot re-enter, not a
 * command path.
 */
function triggerFixture(): { state: EncounterState; heroId: string; targetId: string } {
  let state = createEncounter('Trigger authority fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  const foe = createFoe('Relict', { x: 2, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, heroId: hero.id, targetId: foe.id };
}

const forged = (trigger: string) => (state: EncounterState, heroId: string, targetId: string) =>
  executeCommand(state, {
    type: 'EXECUTE_RULE',
    actorId: heroId,
    sourceId: 'bastion:battering-ram',
    actionId: 'default',
    timing: 'use',
    input: { actorIds: { target: [targetId] } },
    triggers: [trigger],
  }, scriptedDice());

describe('trigger authority: command triggers are provenance-checked', () => {
  it('rejects every state/resolution-derived trigger a caller forges on EXECUTE_RULE', () => {
    for (const trigger of ['charge', 'comeback', 'finishing-blow', 'exceed', 'slay', 'collide']) {
      const { state, heroId, targetId } = triggerFixture();
      expect(() => forged(trigger)(state, heroId, targetId))
        .toThrowError(expect.objectContaining({ code: 'rule.trigger-forged' }));
    }
  });

  it('rejects a forged trigger BEFORE any cost, effect, or RNG runs', () => {
    const { state, heroId, targetId } = triggerFixture();
    const before = JSON.stringify(state);
    expect(() => forged('charge')(state, heroId, targetId)).toThrowError(expect.objectContaining({ code: 'rule.trigger-forged' }));
    expect(JSON.stringify(state)).toBe(before); // planning never mutates the input state
    expect(state.actors[heroId].actionsRemaining).toBe(2);
    expect(state.actors[targetId].hp).toBe(32);
  });

  it('still accepts the caller-authoritative triggers — heroic and infuse', () => {
    const { state, heroId, targetId } = triggerFixture();
    const heroic = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: heroId,
      sourceId: 'bastion:battering-ram',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [targetId] } },
      triggers: ['heroic'],
    }, scriptedDice());
    // The Collide-or-Heroic reaction granted by the declared Heroic: the foe
    // is slashed and the 1-action cost is refunded (2 actions: spent then
    // returned).
    expect(heroic.state.actors[targetId].statuses).toContain('slashed');
    expect(heroic.state.actors[heroId].actionsRemaining).toBe(2); // spent 1, refunded 1
    expect(applyEvents(state, heroic.events)).toEqual(heroic.state);

    const infuse = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: heroId,
      sourceId: 'bastion:battering-ram',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [targetId] } },
      triggers: ['infuse'],
    }, scriptedDice());
    expect(infuse.events.some((event) => event.type === 'RULE_MUTATIONS_APPLIED')).toBe(true);
    expect(applyEvents(state, infuse.events)).toEqual(infuse.state);
  });

  it('keeps the genuine derivation path intact (slow-turn → charge, resolution shove → collide)', () => {
    // The gate never replaces derivation: authoritative state and resolution
    // facts still produce the same triggers command paths consume. Charge
    // flows from the durable slow-turn flag into both the shared range
    // authority and resolver reads (geomancer/chanter charge suites), and
    // Collide derives from the resolution's own shove mutations (bastion
    // collide suites) — both were converted to gate-free fixtures when the
    // gate landed.
    let stanced = createEncounter('Trigger authority derive fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.talents = { ...hero.talents, 'demon-slayer:draken-cross': 2 };
    hero.ruleState['slow-turn'] = true;
    hero.ruleStateOwners['slow-turn'] = hero.id;
    const foe = createFoe('Relict', { x: 5, y: 1 });
    stanced = executeCommand(stanced, { type: 'ADD_ACTOR', actor: hero }).state;
    stanced = executeCommand(stanced, { type: 'ADD_ACTOR', actor: foe }).state;
    stanced = startEncounterTo(stanced, hero.id);
    // A slow turn with the charge-gated range rule: the derived Charge makes
    // the range-4 attack target legal through the shared range fold.
    const result = executeCommand(stanced, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6));
    expect(result.state.actors[foe.id].hp).toBe(13); // 32 - 4 primary fray - 15, at range 5 (charge range)
    expect(applyEvents(stanced, result.events)).toEqual(result.state);
  });
});