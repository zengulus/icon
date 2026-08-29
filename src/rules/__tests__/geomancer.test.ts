import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { RuleProgramViolation } from '../automation/kernels/runtime.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Geomancer
 * ability set (ICON p.215–221), the second Wright job. Boulders and statues
 * are `boulder` / `statue` entities; pits and difficult terrain are `pit` /
 * `difficult` terrain. Each scenario must replay to the identical state
 * through applyEvents.
 */

interface GeomancerFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
}

function geomancerEncounter(options: {
  foe?: Position; second?: Position | null;
} = {}): GeomancerFixture {
  let state = createEncounter('Geomancer fixture');
  const hero = actorFromCharacter(validCharacter('Earth Shaper'), { x: 1, y: 1 });
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

describe('Geomancer ability automation (p.215–221)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('geomancer:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const geomancerIds = JOBS.find((job) => job.id === 'geomancer')!.abilities.map(({ id }) => id);
    expect(geomancerIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Bio: shatters the target, [D]+fray on hit, and frays the small blast', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:bio', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('shattered');
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (area)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Bio infuse (BIOTIC): spends 3 aether, widens the blast, and shatters everyone inside', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    state.actors[hero.id].resources.aether = 3;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:bio',
      actionId: 'infuse',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(12, 4));
    expect(result.state.actors[hero.id].resources.aether).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(result.state.actors[second!.id].hp).toBe(28);
    expect(result.state.actors[second!.id].statuses).toContain('shattered');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Dragon Dive: ends the turn and delays the dive toward the chosen character', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:dragon-dive', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[hero.id].ruleState['dragon-dive:target']).toBe(foe.id);
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    expect(result.state.activeActorId).toBeNull();
    expect(result.state.eligibleSide).toBe('foes');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Geo: 2[D]+fray on hit, frays the blast, creates a boulder, and a Charge explodes the target', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:geo',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
      triggers: ['charge'],
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - (4 + 5 + fray 4) - 2 piercing (charge blast)
    expect(result.state.actors[second!.id].hp).toBe(26); // 32 - fray 4 (area) - 2 piercing (charge blast)
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'boulder')).toBe(true);
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Helix Heel: shocks the line for 2 piercing and a Charge shatters damaged foes', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 1 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:helix-heel',
      actionId: 'default',
      timing: 'use',
      input: { directions: { line: { x: 1, y: 0 } } },
      triggers: ['charge'],
    }, scriptedDice());
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2 piercing
    expect(result.state.actors[second!.id].hp).toBe(30); // 32 - 2 piercing
    expect(result.state.actors[foe.id].statuses).toContain('shattered');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Terraforming base: each bullet is one chosen effect, so boulders + pits each produce two (budget counts clauses, never objects)', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    // Uncharged base "choose two": selecting the boulders bullet and the pits
    // bullet budgets exactly two clauses aNd produces the full count of each.
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:terraforming',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'boulders,pits' } },
    }, scriptedDice());
    expect(Object.values(result.state.entities).filter((entity) => entity.type === 'boulder')).toHaveLength(2);
    expect(result.state.terrainEffects.filter((effect) => effect.terrain === 'pit')).toHaveLength(2);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Terraforming Charge: four distinct effect clauses are budgeted; boulders + pits each still produce their full count', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:terraforming',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'boulders,pits,difficult,remove' },
        // Line 3 fully inside the burst so the difficult bullet lands in-area.
        positions: { line: [{ x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 }] } },
      triggers: ['charge'],
    }, scriptedDice());
    expect(Object.values(result.state.entities).filter((entity) => entity.type === 'boulder')).toHaveLength(2);
    expect(result.state.terrainEffects.filter((effect) => effect.terrain === 'pit')).toHaveLength(2);
    expect(result.state.terrainEffects.filter((effect) => effect.terrain === 'difficult').length).toBeGreaterThanOrEqual(1);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Terraforming: a malformed/duplicate effect choice is rejected, never silently padded', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    const run = (effects: string) => executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects } },
    }, scriptedDice());
    // Two effects uncharged but the same bullet twice.
    expect(() => run('pits,pits')).toThrow(/same effect/);
    // One effect chosen when the base requires two.
    expect(() => run('boulders')).toThrow(/exactly 2/);
    // Unknown effect name.
    expect(() => run('boulders,mudslide')).toThrow(/Unknown Terraforming effect/);
  });

  it('Terraforming raise: the raise branch is one bullet WITH an internal player choice and lifts ANY object (raise over batch into row 2)', () => {
    // A hero pre-placed boulder sits at (4,1) inside the burst around foe (5,1).
    const { state, hero, foe } = geomancerEncounter({ second: null, foe: { x: 5, y: 1 } });
    state.entities['pre-boulder'] = { id: 'pre-boulder', type: 'boulder', ownerId: hero.id, positions: [{ x: 4, y: 1 }], state: { height: 1 }, duration: null };
    // Choose the raise/destroy bullet with the internal 'raise' branch selected.
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'pits,raise', raiseBranch: 'raise' }, positions: { raise: [{ x: 4, y: 1 }] } },
    }, scriptedDice());
    const raised = Object.values(result.state.entities).find((entity) => entity.id === 'pre-boulder');
    expect(raised).toBeTruthy();
    expect(raised!.state.height).toBe(2); // +1: raise applies to ANY existing object
    expect(result.state.terrainEffects.filter((effect) => effect.terrain === 'pit')).toHaveLength(2);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Terraforming destroy: the destroy branch removes only YOUR created objects, never a foe\u2019s (fail-closed)', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null, foe: { x: 5, y: 1 } });
    // One hero-owned boulder inside the burst, one foe-owned boulder inside too.
    state.entities['mine'] = { id: 'mine', type: 'boulder', ownerId: hero.id, positions: [{ x: 4, y: 1 }], state: { height: 1 }, duration: null };
    state.entities['theirs'] = { id: 'theirs', type: 'boulder', ownerId: 'foe-owner', positions: [{ x: 4, y: 2 }], state: { height: 1 }, duration: null };
    // Selecting your own object destroys it; the foe's object — never in the
    // chosen set — survives.
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'pits,raise', raiseBranch: 'destroy' }, positions: { destroy: [{ x: 4, y: 1 }] } },
    }, scriptedDice());
    expect(Object.values(result.state.entities).some((entity) => entity.id === 'mine')).toBe(false);
    expect(Object.values(result.state.entities).some((entity) => entity.id === 'theirs')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
    // Selecting a cell holding only a foe's object is an illegal target for your
    // own-object destruction -> fail-closed, never silently ignored.
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'pits,raise', raiseBranch: 'destroy' }, positions: { destroy: [{ x: 4, y: 2 }] } },
    }, scriptedDice())).toThrow(RuleProgramViolation);
  });

  it('Terraforming difficult: a Line 3 may extend OUTSIDE the burst with only one space inside (even without Talent I)', () => {
    // No talent equipped. The uncharged base picks two bullets. The Line 3 runs
    // from inside the burst (at 6,1 / 7,1) out beyond it (8,1): the source only
    // requires at least one line space in the area, so the line may leave it.
    const { state, hero, foe } = geomancerEncounter({ second: null, foe: { x: 4, y: 0 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        options: { effects: 'boulders,difficult' },
        positions: { line: [{ x: 5, y: 0 }, { x: 6, y: 0 }, { x: 7, y: 0 }] },
      },
    }, scriptedDice());
    const difficult = result.state.terrainEffects.filter((effect) => effect.terrain === 'difficult');
    expect(difficult).toHaveLength(1);
    // Burst around foe (4,0) covers x in [2,6], y in [0,2]. Cell (7,0) is outside.
    expect(difficult[0]!.positions.some((cell) => cell.x === 7 && cell.y === 0)).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Terraforming remove: removes only the chosen in-area cells, keeping a multi-cell record\u2019s out-of-area cells', () => {
    // A single difficult record spans both inside and outside the burst.
    const { state, hero, foe } = geomancerEncounter({ second: null, foe: { x: 5, y: 1 } });
    state.terrainEffects.push({ id: 'span-difficult', sourceId: 'fixture', ownerId: hero.id, terrain: 'difficult', positions: [{ x: 4, y: 0 }, { x: 9, y: 0 }], height: null, duration: null });
    // Burst around foe (5,1) covers x in [3,7], y in [0,3]. (4,0) is inside,
    // (9,0) is outside. Choose the remove bullet with only (4,0).
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'boulders,remove' }, positions: { remove: [{ x: 4, y: 0 }] } },
    }, scriptedDice());
    const difficult = result.state.terrainEffects.filter((effect) => effect.terrain === 'difficult');
    // The in-area cell is gone; the shared record shrank to its out-of-area cell.
    expect(difficult.some((effect) => effect.positions.some((cell) => cell.x === 4 && cell.y === 0))).toBe(false);
    expect(difficult.some((effect) => effect.positions.some((cell) => cell.x === 9 && cell.y === 0))).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Terraforming create: no boulder or pit is ever placed in a character-occupied space', () => {
    // Foe at (4,0); the burst around it is [2,6]×[0,2] (which the four-adjacent
    // pool expansion can widen only with Talent I + Charge — none here).
    const { state, hero, foe } = geomancerEncounter({ second: null, foe: { x: 4, y: 0 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'boulders,pits' } },
    }, scriptedDice());
    const boulders = Object.values(result.state.entities).filter((entity) => entity.type === 'boulder');
    const pits = result.state.terrainEffects.filter((effect) => effect.terrain === 'pit');
    expect(boulders).toHaveLength(2);
    expect(pits).toHaveLength(2);
    for (const b of boulders) expect([b.positions[0]!.x, b.positions[0]!.y]).not.toEqual([4, 0]);
    for (const p of pits.flatMap((e) => e.positions)) expect([p.x, p.y]).not.toEqual([4, 0]);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Terraforming create: rejects a Size>1 character\u2019s NON-ANCHOR footprint cells (ICON p.92)', () => {
    // A Size-2 foe anchored at (2,1) occupies footprint cells (3,1)/(3,2) — both
    // inside the burst around the target (5,1) — while its anchor sits outside it.
    // Character occupancy must be footprint-aware, never anchor-only.
    const { state, hero, foe, second } = geomancerEncounter({ second: { x: 2, y: 1 } });
    state.actors[second!.id].size = 2;
    // A geometric Line 3 running through the Size-2 footprint cell (3,2) is
    // rejected fail-closed: the only blocking occupancy is that footprint cell.
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        options: { effects: 'boulders,difficult' },
        positions: { line: [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }] },
      },
    }, scriptedDice())).toThrow(/character-occupied/);
    // boulders and pits also shun the whole footprint: none land on (3,1)/(3,2).
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'boulders,pits' } },
    }, scriptedDice());
    for (const b of Object.values(result.state.entities).filter((e) => e.type === 'boulder')) {
      expect([b.positions[0]!.x, b.positions[0]!.y]).not.toEqual([3, 1]);
      expect([b.positions[0]!.x, b.positions[0]!.y]).not.toEqual([3, 2]);
    }
    for (const p of result.state.terrainEffects.filter((e) => e.terrain === 'pit').flatMap((e) => e.positions)) {
      expect([p.x, p.y]).not.toEqual([3, 1]);
      expect([p.x, p.y]).not.toEqual([3, 2]);
    }
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Terraforming difficult: a Line 3 running through a character-occupied space is rejected fail-closed', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null, foe: { x: 5, y: 1 } });
    // A geometrically valid Line 3 that passes through the foe (5,1): forbidden.
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        options: { effects: 'boulders,difficult' },
        positions: { line: [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }] },
      },
    }, scriptedDice())).toThrow(/character-occupied/);
  });

  it('Terraforming raise: raises ANY existing object, including a foe-owned one, but respects the height ceiling of 3', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null, foe: { x: 5, y: 1 } });
    // A foe-owned boulder (raise applies to any object) and a hero-owned one
    // already at ceiling height.
    state.entities['foe-obj'] = { id: 'foe-obj', type: 'boulder', ownerId: 'foe-owner', positions: [{ x: 4, y: 1 }], state: { height: 1 }, duration: null };
    state.entities['at-ceiling'] = { id: 'at-ceiling', type: 'boulder', ownerId: hero.id, positions: [{ x: 4, y: 2 }], state: { height: 3 }, duration: null };
    // Raise the foe-owned object: 1 -> 2.
    const raised = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'pits,raise', raiseBranch: 'raise' }, positions: { raise: [{ x: 4, y: 1 }] } },
    }, scriptedDice());
    expect(raised.state.entities['foe-obj']!.state.height).toBe(2);
    expect(applyEvents(state, raised.events)).toEqual(raised.state); // replay
    // Trying to push an object at ceiling height 3 to 4 is rejected fail-closed.
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'pits,raise', raiseBranch: 'raise' }, positions: { raise: [{ x: 4, y: 2 }] } },
    }, scriptedDice())).toThrow(/height ceiling/);
  });

  it('Terraforming raise: a summon can never be raised (only objects)', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null, foe: { x: 5, y: 1 } });
    state.entities['my-summon'] = { id: 'my-summon', type: 'wyrm', ownerId: hero.id, positions: [{ x: 4, y: 1 }], state: {}, duration: null };
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'pits,raise', raiseBranch: 'raise' }, positions: { raise: [{ x: 4, y: 1 }] } },
    }, scriptedDice())).toThrow(/No object to raise/);
  });

  it('Terraforming destroy: can destroy ANY object you created in the area, not merely boulders', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null, foe: { x: 5, y: 1 } });
    state.entities['my-statue'] = { id: 'my-statue', type: 'statue', ownerId: hero.id, positions: [{ x: 4, y: 1 }], state: { held: null }, duration: null };
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'geomancer:terraforming', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'pits,raise', raiseBranch: 'destroy' }, positions: { destroy: [{ x: 4, y: 1 }] } },
    }, scriptedDice());
    expect(Object.values(result.state.entities).some((entity) => entity.id === 'my-statue')).toBe(false);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Obsidian Flesh: enters the stance with a d6 power die at 1', () => {
    const { state, hero } = geomancerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:obsidian-flesh', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].stance).toMatchObject({ stanceId: 'obsidian-flesh' });
    expect(result.state.actors[hero.id].ruleState['obsidian-flesh:die']).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Realignment: ends the statuses and damages the burst once per purged effect', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 2, y: 1 }, second: { x: 2, y: 0 } });
    state.actors[foe.id].statuses = ['sealed', 'vulnerable'];
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:realignment', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].statuses).not.toContain('sealed');
    expect(result.state.actors[foe.id].statuses).not.toContain('vulnerable');
    expect(result.state.actors[second!.id].hp).toBe(24); // 32 - 2 purged × fray 4 piercing
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Midas: replaces the targeted character with a height 1 statue', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:midas',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice());
    expect(result.state.actors[foe.id].onBattlefield).toBe(false);
    const statue = Object.values(result.state.entities).find((entity) => entity.type === 'statue');
    expect(statue).toBeDefined();
    expect(statue?.state.held).toBe(foe.id);
    expect(result.state.actors[hero.id].ruleState['midas:used']).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Quaking Palm: [D]+1 on hit, makes the foe vulnerable, and sets up vibrations', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:quaking-palm', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(27); // 32 - (4 + 1)
    expect(result.state.actors[foe.id].statuses).toContain('vulnerable');
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'quaking-palm')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
