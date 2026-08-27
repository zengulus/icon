import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position, StatusSaveCommandInput } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/** The two player-selected Teleport destinations Nothung's program reads from
 * the generic durable position input (the same cast pattern Party Favor's
 * mine placement uses — the USE_ABILITY surface exposes only Blessing
 * choices on its `input`; the runtime spreads the full object through). */
const nothungTeleports = (first: Position, second: Position): StatusSaveCommandInput =>
  ({ positions: { 'teleport-1': [first], 'teleport-2': [second] } }) as unknown as StatusSaveCommandInput;

/**
 * Source-derived golden fixtures for the independently executable Spellblade
 * ability set (ICON p.222–229), the third Wright job. The wind wall and the
 * lightning arch are `atherwand` / `bifrost-arch` terrain effects; spikes are
 * `lightning-spike` entities. Each scenario must replay to the identical state
 * through applyEvents.
 */

interface SpellbladeFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
}

function spellbladeEncounter(options: {
  foe?: Position; second?: Position | null;
} = {}): SpellbladeFixture {
  let state = createEncounter('Spellblade fixture');
  const hero = actorFromCharacter(validCharacter('Aether Duelist'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 3, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 5, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Spellblade ability automation (p.222–229)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('spellblade:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const spellbladeIds = JOBS.find((job) => job.id === 'spellblade')!.abilities.map(({ id }) => id);
    expect(spellbladeIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Blitz: attacks [D], makes the foe vulnerable, then player-selected teleports and pierces twice', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:blitz', targetIds: [foe.id], input: { positions: { 'teleport-0': [{ x: 2, y: 1 }] } } }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(26); // 32 - [D] 4 - 1 - 1
    expect(result.state.actors[foe.id].statuses).toContain('vulnerable');
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 }); // teleported to player choice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Odinforce: enters the stance with a d6 power die at 3, and a bolt spends one', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const stanced = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:odinforce', targetIds: [] }, scriptedDice());
    expect(stanced.state.actors[hero.id].stance).toMatchObject({ stanceId: 'odinforce' });
    expect(stanced.state.actors[hero.id].ruleState['spellblade:odinforce:die']).toBe(3);

    // The bolt is a free action on the same source program, so the fixture
    // clears the same-turn repeat gate.
    stanced.state.actors[hero.id].usedAbilityIds = [];
    const bolt = executeCommand(stanced.state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:odinforce',
      actionId: 'bolt',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice());
    expect(bolt.state.actors[hero.id].ruleState['spellblade:odinforce:die']).toBe(2);
    expect(bolt.state.actors[foe.id].hp).toBe(31); // 32 - 1 piercing
    const replayed = applyEvents(stanced.state, []);
    replayed.actors[hero.id].usedAbilityIds = [];
    expect(applyEvents(replayed, bolt.events)).toEqual(bolt.state);
  });

  it('Nothung: both teleports are player-selected destinations (Teleport 1, p.88)', () => {
    const { state, hero, foe, second } = spellbladeEncounter({ foe: { x: 2, y: 1 }, second: { x: 2, y: 0 } });
    // ICON p.225 lists "Effect: Teleport 1" twice with no direction: each is
    // a chosen unoccupied space within range 1. Choose a first destination
    // NOT toward the target (west instead of east), then a second destination
    // within 1 of the post-first position.
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 0, y: 1 }, { x: 0, y: 2 }),
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[hero.id].position).toEqual({ x: 0, y: 2 }); // both chosen destinations applied in order
    expect(result.state.actors[foe.id].hp).toBe(18); // 32 - (4 + 5 + fray 4) - 1 piercing (adjacent second)
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (arc)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Nothung: the second teleport is measured from the post-first position, not the starting position', () => {
    const { state, hero, foe } = spellbladeEncounter({ foe: { x: 3, y: 1 }, second: null });
    // First destination west to (0,1). The second destination (1,2) is
    // within Teleport 1 of (0,1) (distance 1) but distance 2 from the
    // starting cell (1,1): only the post-first origin makes it legal.
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 0, y: 1 }, { x: 1, y: 2 }),
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
    // The same second destination chosen from the STARTING position (no
    // first teleport) would be out of range: the legality is positional.
  });

  it('Nothung: an illegal first destination is rejected (nothing consumed)', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    // Out of range (distance 2 > Teleport 1).
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 3, y: 1 }, { x: 0, y: 1 }),
    }, scriptedDice(12, 4, 5))).toThrowError(expect.objectContaining({ code: 'move.range' }));
    // Occupied (the target's adjacent cell).
    const adjacent = spellbladeEncounter({ foe: { x: 2, y: 1 }, second: null });
    expect(() => executeCommand(adjacent.state, {
      type: 'USE_ABILITY', actorId: adjacent.hero.id, abilityId: 'spellblade:nothung', targetIds: [adjacent.foe.id],
      input: nothungTeleports({ x: 2, y: 1 }, { x: 0, y: 1 }),
    }, scriptedDice(12, 4, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-unavailable' }));
    // Missing destination.
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: { positions: { 'teleport-1': [{ x: 0, y: 1 }] } } as unknown as StatusSaveCommandInput,
    }, scriptedDice(12, 4, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-required' }));
    // Nothing was consumed: the actions are intact and the hero never moved.
    expect(hero.actionsRemaining).toBe(2);
    expect(hero.position).toEqual({ x: 1, y: 1 });
  });

  it('Nothung: an illegal second destination is rejected (nothing consumed)', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    // First leg legal; second destination out of range of the post-first
    // position (distance 2 from (0,1)).
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 0, y: 1 }, { x: 0, y: 3 }),
    }, scriptedDice(12, 4, 5))).toThrowError(expect.objectContaining({ code: 'move.range' }));
    expect(hero.actionsRemaining).toBe(2);
    expect(hero.position).toEqual({ x: 1, y: 1 });
  });

  it('Nothung: hostile rampart blocks a chosen teleport destination (p.104)', () => {
    const { state, hero, foe } = spellbladeEncounter({ foe: { x: 3, y: 1 }, second: null });
    // A fortify foe projects rampart over its adjacent cells; a teleport
    // into (2,1) (adjacent to the foe) enters rampart and is denied by the
    // F1 gateway — even though the destination is in range and unoccupied.
    state.actors[foe.id].conditions.push({ id: 'fortify', sourceId: 'fixture:fortify', ownerId: foe.id, potency: 'normal', duration: null });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 2, y: 1 }, { x: 2, y: 1 }),
    }, scriptedDice(12, 4, 5));
    // The first leg is rampart-denied (no move), so the hero stays at (1,1)
    // and the second leg resolves from there — both landings denied.
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Nothung: a rampart-denied first teleport re-anchors the second leg at the actor’s actual position', () => {
    const { state, hero, foe } = spellbladeEncounter({ foe: { x: 3, y: 1 }, second: null });
    // A hostile rampart terrain effect covers exactly (2,1) — the first
    // chosen destination passes the in-grid/range/occupancy pre-check but
    // the F1 gateway denies the teleport (entering rampart differs from
    // leaving, p.104). The second destination (3,0) is within Teleport 1 of
    // the INTENDED first destination (2,1) but distance 2 from the actor’s
    // ACTUAL position (1,1). With the first leg denied, the second choice is
    // illegal from where the actor really stands, so the command is rejected
    // (nothing consumed) rather than executing a 2-space teleport.
    state.terrainEffects.push({ id: 'fixture:rampart', sourceId: 'fixture:rampart', ownerId: foe.id, terrain: 'rampart', positions: [{ x: 2, y: 1 }], height: null, duration: null });
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 2, y: 1 }, { x: 3, y: 0 }),
    }, scriptedDice(12, 4, 5))).toThrowError(expect.objectContaining({ code: 'move.range' }));
    expect(hero.actionsRemaining).toBe(2);
    expect(hero.position).toEqual({ x: 1, y: 1 });
    // Control: when the first leg is valid, the second leg is still measured
    // from the POST-first position — (3,0) is distance 2 from the starting
    // cell (1,1) but distance 1 from the first destination (0,1), and the
    // path applies both legs in order.
    const control = spellbladeEncounter({ foe: { x: 3, y: 1 }, second: null });
    const moved = executeCommand(control.state, {
      type: 'USE_ABILITY', actorId: control.hero.id, abilityId: 'spellblade:nothung', targetIds: [control.foe.id],
      input: nothungTeleports({ x: 0, y: 1 }, { x: 1, y: 0 }),
    }, scriptedDice(12, 4, 5));
    expect(moved.state.actors[control.hero.id].position).toEqual({ x: 1, y: 0 });
    expect(applyEvents(control.state, moved.events)).toEqual(moved.state);
  });

  it('Nothung talent 2: comeback widens both player-selected teleports to 4', () => {
    const { state, hero, foe } = spellbladeEncounter({ foe: { x: 3, y: 2 }, second: null });
    state.actors[hero.id].talents = { 'spellblade:nothung': 2 };
    state.actors[hero.id].hp = 1; // bloodied → the comeback clause holds
    // Each destination is independently chosen within Teleport 4: first
    // west to (5,1) (distance 4), then north-west to (1,5) (distance 4 from
    // the post-first position (5,1)).
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 5, y: 1 }, { x: 1, y: 5 }),
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 5 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
    // A destination at distance 5 (beyond Teleport 4) is still rejected.
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 6, y: 1 }, { x: 1, y: 5 }),
    }, scriptedDice(12, 4, 5))).toThrowError(expect.objectContaining({ code: 'move.range' }));
  });

  it('Nothung talent 2: equipped but Comeback inactive keeps both teleports at 1', () => {
    const { state, hero, foe } = spellbladeEncounter({ foe: { x: 3, y: 2 }, second: null });
    state.actors[hero.id].talents = { 'spellblade:nothung': 2 };
    // Full HP → Comeback inactive → Teleport 1: a distance-4 first
    // destination is rejected even though the talent is equipped.
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 5, y: 1 }, { x: 0, y: 1 }),
    }, scriptedDice(12, 4, 5))).toThrowError(expect.objectContaining({ code: 'move.range' }));
    // Legal Teleport-1 destinations still work.
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 0, y: 1 }, { x: 1, y: 0 }),
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 0 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Nothung talent 1: against a bloodied foe the 2[D] roll gains a bonus die and deals 1 piercing again on hit', () => {
    const { state, hero, foe } = spellbladeEncounter({ foe: { x: 3, y: 1 }, second: null });
    state.actors[hero.id].talents = { 'spellblade:nothung': 1 };
    state.actors[foe.id].hp = 16; // bloodied (Relict max 32 → at/below 16)
    // d20 12 hits; the 2[D] roll carries one bonus die → three rolls 4, 3, 6
    // keep the highest two (6 + 4 = 10) + fray 4 = 14, then the extra
    // 1 piercing instance on hit (the p.102 keep-highest semantics).
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id],
      input: nothungTeleports({ x: 0, y: 1 }, { x: 0, y: 1 }),
    }, scriptedDice(12, 4, 3, 6));
    expect(result.state.actors[foe.id].hp).toBe(16 - 14 - 1);
    expect(applyEvents(state, result.events)).toEqual(result.state);

    // Talent NOT equipped against the same bloodied foe: plain 2[D]+fray, no
    // bonus die, no extra piercing instance.
    const bare = spellbladeEncounter({ foe: { x: 3, y: 1 }, second: null });
    bare.state.actors[bare.foe.id].hp = 16;
    const noTalent = executeCommand(bare.state, {
      type: 'USE_ABILITY', actorId: bare.hero.id, abilityId: 'spellblade:nothung', targetIds: [bare.foe.id],
      input: nothungTeleports({ x: 0, y: 1 }, { x: 0, y: 1 }),
    }, scriptedDice(12, 4, 3));
    expect(noTalent.state.actors[bare.foe.id].hp).toBe(16 - (4 + 3 + 4));
    expect(applyEvents(bare.state, noTalent.events)).toEqual(noTalent.state);

    // Talent equipped against a NOT-bloodied foe: no bonus die, no extra
    // piercing instance (Comeback/target gates must hold, not just the
    // talent being equipped).
    const healthy = spellbladeEncounter({ foe: { x: 3, y: 1 }, second: null });
    healthy.state.actors[healthy.hero.id].talents = { 'spellblade:nothung': 1 };
    const full = executeCommand(healthy.state, {
      type: 'USE_ABILITY', actorId: healthy.hero.id, abilityId: 'spellblade:nothung', targetIds: [healthy.foe.id],
      input: nothungTeleports({ x: 0, y: 1 }, { x: 0, y: 1 }),
    }, scriptedDice(12, 4, 3));
    expect(full.state.actors[healthy.foe.id].hp).toBe(32 - (4 + 3 + 4));
    expect(applyEvents(healthy.state, full.events)).toEqual(full.state);
  });

  it('Nothung slay/infuse (GRAM): flurries 1 piercing twice to foes in a burst 2 (self)', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    state.actors[hero.id].resources.aether = 3;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:nothung',
      actionId: 'gram',
      timing: 'use',
      input: {},
    }, scriptedDice());
    expect(result.state.actors[hero.id].resources.aether).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 1 - 1
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Ätherwand: creates a line 3 wall of crackling winds in range 4', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:atherwand', targetIds: [foe.id] }, scriptedDice());
    const wall = result.state.terrainEffects.filter((effect) => effect.terrain === 'atherwand');
    expect(wall).toHaveLength(1);
    expect(wall[0]?.positions.length).toBeGreaterThanOrEqual(3);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Fulminate: marks a character in range 6, giving them aura 2', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:fulminate', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'fulminate')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Bifröst: sweeps a line 3 arch dealing 2 piercing, leaving the arch behind', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:bifrost',
      actionId: 'default',
      timing: 'use',
      input: { directions: { line: { x: 1, y: 0 } } },
    }, scriptedDice());
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2 piercing
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'bifrost-arch')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rampant Nail: impales a lightning spike in range 3 with a d6 power die at 0', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:rampant-nail', targetIds: [foe.id] }, scriptedDice());
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'lightning-spike')).toBe(false); // target space is occupied; creation is declined
    expect(result.state.actors[hero.id].ruleState['spellblade:rampant-nail:die']).toBe(0);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Sturmreiten: teleports to the end of a line 3 and pierces the characters in it', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:sturmreiten',
      actionId: 'default',
      timing: 'interrupt',
      input: { directions: { line: { x: 1, y: 0 } } },
    }, scriptedDice());
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 1 }); // end of the line 3
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2 piercing
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Drifting Leaf: 2[D]+fray on hit, shatters the foe, frays the line, and gains Leaf on the Wind', () => {
    const { state, hero, foe, second } = spellbladeEncounter({ foe: { x: 3, y: 1 }, second: { x: 2, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:drifting-leaf', targetIds: [foe.id], input: { positions: { 'teleport': [{ x: 1, y: 2 }] } } }, scriptedDice(12, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - (4 + 5 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('shattered');
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (line)
    expect(result.state.actors[hero.id].ruleState['spellblade:leaf-on-the-wind']).toBe(true);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 }); // teleported to player choice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
