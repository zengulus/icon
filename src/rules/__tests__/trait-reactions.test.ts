import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand } from '../encounter.js';
import { traitReactionMutations } from '../automation/kernels/trait-reactions.js';
import type { EncounterState } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';
import { turnEligibleActorIds } from '../turn-scheduler.js';

/**
 * F9 once-per-round reactive job-trait fold (docs/rules-foundations.md §10
 * item 1). A wired job trait may declare a post-application reaction (collide
 * / shove / slay) gated once per round by a durable `ledger:round:*` flag that
 * resets at the round-start boundary. Proved on `stormbender:trait:
 * dash-on-the-rocks` (ICON p.230): 1/round when you cause a character to
 * collide, gain 1 aether and deal 1 piercing damage as a burst-1 area centered
 * on the collided character (the burst never affects the ability user, p.97).
 */

const DASH = 'stormbender:trait:dash-on-the-rocks';

interface Fixture {
  state: EncounterState;
  heroId: string;
  foeId: string;
}

function dashEncounter(heroAt = { x: 1, y: 1 }, foeAt = { x: 3, y: 1 }): Fixture {
  let state = createEncounter('Dash on the Rocks fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), heroAt);
  hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
  hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
  hero.traitIds.push(DASH);
  const foe = createFoeFromProfile('basic:knuckle:301', foeAt, 4);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, heroId: hero.id, foeId: foe.id };
}

/** End every actor's turn in insertion order, advancing through the round and
 * running the round-start lifecycle (which resets the round ledger). Each
 * boundary leaves the scheduler awaiting a controller choice, so the fixture
 * explicitly selects the next actor in insertion order (ICON p.87). */
function endAllTurns(state: EncounterState): EncounterState {
  let next = state;
  for (const id of Object.keys(state.actors)) {
    if (next.activeActorId !== id) {
      if (next.activeActorId !== null) next = executeCommand(next, { type: 'END_TURN', actorId: next.activeActorId }, scriptedDice()).state;
      const eligible = turnEligibleActorIds(next);
      if (!eligible.includes(id)) throw new Error('endAllTurns: ' + id + ' is not eligible here.');
      next = executeCommand(next, { type: 'TAKE_TURN', actorId: id }, scriptedDice()).state;
    }
    next = executeCommand(next, { type: 'END_TURN', actorId: id }, scriptedDice()).state;
  }
  return next;
}

describe('F9 once-per-round reactive job-trait fold', () => {
  it('dash-on-the-rocks fires on a collide: gain 1 aether + burst-1 piercing damage on the collided character, plus the ledger mark', () => {
    const { state, heroId, foeId } = dashEncounter();
    const mutations = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    expect(mutations).toContainEqual(expect.objectContaining({ kind: 'resource', actorId: heroId, resourceId: 'aether', operation: 'gain', amount: 1 }));
    expect(mutations).toContainEqual(expect.objectContaining({ kind: 'damage', actorId: foeId, damageType: 'piercing', amount: 1, delivery: 'area' }));
    expect(mutations).toContainEqual(expect.objectContaining({ kind: 'state', key: `ledger:round:${DASH}`, value: true }));
  });

  it('the burst excludes the ability user even when adjacent (ICON p.97)', () => {
    // hero at (2,1) is within burst 1 of a collided foe at (3,1).
    const { state, heroId, foeId } = dashEncounter({ x: 2, y: 1 }, { x: 3, y: 1 });
    const mutations = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    const damages = mutations.filter((m) => m.kind === 'damage');
    expect(damages.some((m) => m.actorId === heroId)).toBe(false);
    expect(damages.some((m) => m.actorId === foeId)).toBe(true);
  });

  it('does not fire when no collide occurred (negative)', () => {
    const { state, heroId } = dashEncounter();
    expect(traitReactionMutations(state, state.actors[heroId], [], {})).toEqual([]);
  });

  it('once-per-round: a second collide in the same round fires nothing (gate consumed)', () => {
    const { state, heroId, foeId } = dashEncounter();
    const first = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    expect(first.length).toBeGreaterThan(0);
    // Apply the first fold (records the ledger mark), then a second collide.
    const applied = applyEvents(state, [{ type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: DASH, actionId: 'default', timing: 'use', tags: [], mutations: first }]);
    const second = traitReactionMutations(applied, applied.actors[heroId], [], { collidedActorIds: [foeId] });
    expect(second).toEqual([]);
  });

  it('replay applies exactly what the command decided (ledger marks and damage both reapplied deterministically)', () => {
    const { state, heroId, foeId } = dashEncounter();
    const mutations = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    const event: never[] = [{ type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: DASH, actionId: 'default', timing: 'use', tags: [], mutations }] as never;
    const once = applyEvents(state, event);
    const twice = applyEvents(state, event);
    expect(once).toEqual(twice);
    expect(once.actors[heroId].resources.aether).toBe(1);
    expect(once.actors[foeId].hp).toBeLessThan(state.actors[foeId].hp);
  });

  it('the once-per-round gate resets at the round-start boundary', () => {
    const { state, heroId, foeId } = dashEncounter();
    const first = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    let next = applyEvents(state, [{ type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: DASH, actionId: 'default', timing: 'use', tags: [], mutations: first }]);
    expect(next.actors[heroId].ruleState[`ledger:round:${DASH}`]).toBe(true);
    // Advance the full round; the round-start lifecycle resets the ledger.
    next = endAllTurns(next);
    expect(next.actors[heroId].ruleState[`ledger:round:${DASH}`]).toBeUndefined();
    const again = traitReactionMutations(next, next.actors[heroId], [], { collidedActorIds: [foeId] });
    expect(again.length).toBeGreaterThan(0);
  });
});
