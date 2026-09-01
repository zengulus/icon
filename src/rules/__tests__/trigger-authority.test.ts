import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterState } from '../types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/**
 * Trigger provenance (ICON p.95 + the trigger-authority gate): Charge,
 * Comeback, and Finishing Blow are derived from AUTHORITATIVE STATE (the
 * durable slow-turn flag, the bloodied target); Exceed is derived from the
 * ability's OWN attack roll at 15+; Collide and Slay derive from the
 * resolution's OWN shove/defeat facts. None of them may be asserted by a
 * command — a forged assertion fails closed before any cost, effect, or RNG
 * runs.
 *
 * Heroic is a genuine caller DECLARATION — but intent only: it becomes a
 * validated-player-activation when the character owns a heroic-granting
 * trait (Strive / Demon Strength / Wolfheart / Spite); a character without
 * entitlement fails closed. Infuse is NOT caller-assertable at all: it rides
 * the source-backed infuse ACTION whose aether cost the economy gate
 * validates ("caller named Infuse therefore Infuse is true" is never a valid
 * semantic proof).
 *
 * Source-forced activations (Ace's armed next attack, Gallows Humor's
 * empowered slay) are decided by the engine from durable armed state — the
 * recorded event carries the provenance record
 * (`triggerActivations: [{trigger, provenance}]`), and natural + forced
 * activation of the same trigger collapse to ONE activation.
 */
function triggerFixture(): { state: EncounterState; heroId: string; targetId: string } {
  let state = createEncounter('Trigger authority fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  // Demon Strength is the fully-executable heroic source (Strive fails
  // closed while its shove/half-damage seams are missing). The explicit
  // trait set makes the entitlement independent of catalog defaults.
  hero.traitIds = ['demon-slayer:trait:demon-strength'];
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

const ruleEvent = (result: ReturnType<typeof executeCommand>, sourceId: string) =>
  result.events.find((event) => event.type === 'RULE_MUTATIONS_APPLIED' && event.sourceId === sourceId);

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

  it('rejects Infuse as a caller-asserted trigger — Infuse rides the source-backed infuse action whose aether economy the cost gate validates', () => {
    // "Battering Ram + triggers:['infuse']" is NOT a valid semantic proof:
    // naming `infuse` would forge a resource decision the engine must make.
    // The legitimate path is the ability's infuse ACTION (e.g.
    // stormbender:rime actionId 'infuse', which pays 3 aether through the
    // cost gate and tags the resolution so the shared resolver sees it).
    const { state, heroId, targetId } = triggerFixture();
    expect(() => forged('infuse')(state, heroId, targetId))
      .toThrowError(expect.objectContaining({ code: 'rule.trigger-forged' }));
  });

  it('accepts a validated Heroic declaration from a heroic-capable character as a validated-player-activation', () => {
    const { state, heroId, targetId } = triggerFixture();
    // Aster owns Demon Strength: entitled to declare Heroic. The Battering
    // Ram Collide-or-Heroic reaction fires: the foe is slashed and the
    // 1-action cost is refunded (2 actions: spent then returned).
    const heroic = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: heroId,
      sourceId: 'bastion:battering-ram',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [targetId] } },
      triggers: ['heroic'],
    }, scriptedDice());
    expect(heroic.state.actors[targetId].statuses).toContain('slashed');
    expect(heroic.state.actors[heroId].actionsRemaining).toBe(2); // spent 1, refunded 1
    const event = ruleEvent(heroic, 'bastion:battering-ram');
    expect(event && event.type === 'RULE_MUTATIONS_APPLIED'
      ? event.triggerActivations?.some(({ trigger, provenance }) => trigger === 'heroic' && provenance === 'validated-player-activation')
      : false).toBe(true);
    expect(applyEvents(state, heroic.events)).toEqual(heroic.state);
  });

  it('rejects a Heroic declaration from a character that cannot Heroic — "I choose Heroic" is intent only', () => {
    // Strip the heroic-granting traits: the character has no source-entitled
    // way to trigger heroic effects, so the declaration fails closed before
    // any cost/effect/RNG — callers cannot add `heroic` to an arbitrary
    // source.
    const { state, heroId, targetId } = triggerFixture();
    state.actors[heroId].traitIds = [];
    expect(() => forged('heroic')(state, heroId, targetId))
      .toThrowError(expect.objectContaining({ code: 'rule.trigger-forged' }));
    expect(state.actors[targetId].hp).toBe(32); // nothing resolved
    expect(state.actors[heroId].actionsRemaining).toBe(2);
  });

  it('Ace: the armed next attack forces Exceed as a SOURCE-FORCED activation (no natural 15+ roll required)', () => {
    const { state, heroId, targetId } = triggerFixture();
    state.actors[heroId].ruleState['ace:armed'] = true;
    state.actors[heroId].ruleStateOwners['ace:armed'] = heroId;
    // d20 4 (no boons) is NOT a natural exceed (15+) — only the armed Ace
    // may force the exceed effects without the ordinary natural condition.
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: heroId,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: targetId,
    }, scriptedDice(4));
    const event = ruleEvent(result, 'demon-slayer:demon-cutter');
    expect(event && event.type === 'RULE_MUTATIONS_APPLIED'
      ? event.triggerActivations?.some(({ trigger, provenance }) => trigger === 'exceed' && provenance === 'source-forced')
      : false).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('keeps the genuine derivation path intact (slow-turn → charge, resolution shove → collide)', () => {
    // The gate never replaces derivation: authoritative state and resolution
    // facts still produce the same triggers command paths consume. Charge
    // flows from the durable slow-turn flag into both the shared range
    // authority and resolver reads (Draken Cross talent 2's charge-gated
    // range-5 fold, geomancer/chanter charge suites), and Collide derives
    // from the resolution's own shove mutations (bastion collide suites) —
    // both were converted to gate-free fixtures when the gate landed.
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
    // the range-4 attack target legal through the shared range fold. The
    // REQUIRED base Effect still needs its recorded area center (rule
    // unaffected by the Charge) — supplied at (6,4), out of every occupant's
    // way — and the attack-space target takes only the 15 attack damage.
    const result = executeCommand(stanced, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 6, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - 15, at range 5 (charge range); the attack space never takes the area fray too
    expect(applyEvents(stanced, result.events)).toEqual(result.state);
  });
});