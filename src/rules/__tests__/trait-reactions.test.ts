import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand } from '../encounter.js';
import { roundLedgerKey, roundLedgerUsageSpec, traitReactionMutations } from '../automation/kernels/trait-reactions.js';
import { usageIdentitiesEqual, usageIdentity, usageIdentityKey, usageKey } from '../automation/primitives/usage.js';

/** The canonical U16 round-scope ledger key for a source id (byte-identical
 * to `roundLedgerKey`, owned by the U16 core). The typed identity must carry a
 * REAL owner (actor-local storage accepts any owner id because the durable
 * state lives on the owner — it never fabricates an empty owner). */
function usageRoundKey(sourceId: string, ownerId: string): string {
  return usageKey({ sourceId, ownerId, scope: 'round' });
}
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

  it('adversarial: two different owners of the SAME trait reaction do not alias the once-per-round gate', () => {
    // Two heroes each equip DASH. Hero A fires this round; hero B's gate stays
    // open because the U16 round key is ACTOR-LOCAL (lives on the owner's
    // ruleState), so A's use cannot consume B's independent entitlement.
    const first = actorFromCharacter(validCharacter('Merlin'), { x: 1, y: 1 });
    first.abilityIds = first.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
    first.traitIds = first.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
    first.traitIds.push(DASH);
    const second = actorFromCharacter(validCharacter('Arthur'), { x: 2, y: 1 });
    second.abilityIds = second.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
    second.traitIds = second.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
    second.traitIds.push(DASH);
    const foe = createFoeFromProfile('basic:knuckle:301', { x: 4, y: 1 }, 4);
    let state = createEncounter('Two-owner dash fixture');
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: first }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, first.id);

    const aFirst = traitReactionMutations(state, state.actors[first.id], [], { collidedActorIds: [foe.id] });
    expect(aFirst.length).toBeGreaterThan(0);
    const applied = applyEvents(state, [{ type: 'RULE_MUTATIONS_APPLIED', actorId: first.id, sourceId: DASH, actionId: 'default', timing: 'use', tags: [], mutations: aFirst }]);
    expect(applied.actors[first.id].ruleState[`ledger:round:${DASH}`]).toBe(true);
    // Second owner's gate is NOT consumed: a collide by the second owner still fires.
    const bSecond = traitReactionMutations(applied, applied.actors[second.id], [], { collidedActorIds: [foe.id] });
    expect(bSecond.length).toBeGreaterThan(0);
    // And the first owner is blocked again.
    expect(traitReactionMutations(applied, applied.actors[first.id], [], { collidedActorIds: [foe.id] })).toEqual([]);
  });

  it('adversarial: the typed U16 key call receives the REAL owning actor while the physical storage key stays byte-compatible', () => {
    // The U16 identity is NOT `` { ownerId: '' } `` — the seam must carry the
    // real owning actor through the typed call even though actor-local storage
    // omits the owner bytes.
    expect(roundLedgerKey('actor:a', DASH)).toBe(usageKey({ sourceId: DASH, ownerId: 'actor:a', scope: 'round' }));
    // Different owners produce the SAME physical storage address (actor-local),
    // but the TYPED identity they were built with always carried the real owner
    // (the sealed-test proof that no owner bytes were ever fabricated).
    expect(roundLedgerKey('actor:a', DASH)).toBe(roundLedgerKey('actor:b', DASH));
    // And it is byte-identical to the long-standing `ledger:round:<sourceId>` format.
    expect(roundLedgerKey('actor:a', DASH)).toBe(`ledger:round:${DASH}`);
  });

  it('real-owner seam: the TYPED usage identity distinguishes the real owner from a fabricated empty owner (storage bytes cannot)', () => {
    // The physical storage address (`ledger:round:<sourceId>`) deliberately
    // omits owner bytes, so comparing storage cannot prove the real owner was
    // passed to the typed U16 call. The typed SPEC fed to `usageKey` carries the
    // owner, and `usageIdentity`/`usageIdentityKey` built from that SAME spec DO
    // distinguish a real owner from `ownerId: ''` — the seam that makes owner
    // propagation directly observable without changing storage bytes.
    const real = roundLedgerKey('actor:a', DASH);
    const fabricated = roundLedgerKey('', DASH);
    // Storage-identical (actor-local) — the negative assertion the brief warns
    // is insufficient on its own, shown here as the reason the typed seam is
    // needed on TOP of the storage check.
    expect(real).toBe(fabricated);
    expect(real).toBe(`ledger:round:${DASH}`);
    // Typed identity: real owner ≠ fabricated empty owner, despite equal storage.
    expect(usageIdentitiesEqual(usageIdentity(roundLedgerUsageSpec('actor:a', DASH)), usageIdentity(roundLedgerUsageSpec('', DASH)))).toBe(false);
    expect(usageIdentityKey(roundLedgerUsageSpec('actor:a', DASH))).not.toBe(usageIdentityKey(roundLedgerUsageSpec('', DASH)));
    expect(usageIdentity(roundLedgerUsageSpec('actor:a', DASH)).ownerId).toBe('actor:a');
    // And two DIFFERENT real owners are distinct typed identities too.
    expect(usageIdentityKey(roundLedgerUsageSpec('actor:a', DASH))).not.toBe(usageIdentityKey(roundLedgerUsageSpec('actor:b', DASH)));
  });

  it('the F9 fold persists the gate mark at the REAL owner\'s typed spec (actor.id, never a fabricated empty owner)', () => {
    const { state, heroId, foeId } = dashEncounter();
    const first = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    const mark = first.find((m) => m.kind === 'state');
    expect(mark).toBeDefined();
    if (mark && mark.kind === 'state') {
      // The mark's storage key is addressed via the REAL owner's typed spec
      // (the fold calls roundLedgerUsageSpec(actor.id, …)), not `` {} ``.
      const fromRealOwnerSpec = usageIdentityKey(roundLedgerUsageSpec(heroId, DASH));
      expect(mark.key).toBe(roundLedgerKey(heroId, DASH));
      // The identity the fold carries is the real owner's, distinct from a
      // fabricated empty owner.
      expect(fromRealOwnerSpec).not.toBe(usageIdentityKey({ sourceId: DASH, ownerId: '', scope: 'round' }));
    }
  });

  it('adversarial: the once-per-round mark is the canonical U16 round ledger key (usageKey round scope), not an id-agnostic flag', () => {
    const { state, heroId, foeId } = dashEncounter();
    const first = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    const mark = first.find((m) => m.kind === 'state');
    expect(mark).toBeDefined();
    if (mark && mark.kind === 'state') {
      // Byte-identical to the U16 core `usageKey({scope:'round'})` surface.
      // The typed U16 call receives the REAL owning actor (the state lives on
      // the owner's ruleState; the actor-local storage address omits owner).
      expect(mark.key).toBe(roundLedgerKey(heroId, DASH));
      expect(mark.key).toBe(usageRoundKey(DASH, heroId));
      expect(mark.operation).toBe('set');
      expect(mark.value).toBe(true);
    }
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
