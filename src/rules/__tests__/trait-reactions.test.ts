import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand } from '../encounter.js';
import { traitReactionMutations } from '../automation/kernels/trait-reactions.js';
import { applyOncePerRoundUsage } from '../automation/kernels/use-ledger.js';
import type { RuleMutation } from '../automation/primitives/types.js';
import { usageKey } from '../automation/primitives/usage.js';

/** The canonical U16 round-scope ledger key for a source id (owned by the U16
 * core `usageKey`). The once-per-round entitlement lives behind the U16
 * operation `applyOncePerRoundUsage`; this is only the byte-compat address the
 * durable mark writes. */
function usageRoundKey(sourceId: string, ownerId: string): string {
  return usageKey({ sourceId, ownerId, scope: 'round' });
}
import type { EncounterActor, EncounterState } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';
import { turnEligibleActorIds } from '../turn-scheduler.js';

/**
 * F9 once-per-round reactive job-trait fold (docs/rules-foundations.md §10
 * item 1). A wired job trait may declare a post-application reaction (collide
 * / shove / slay) gated once per round. The ENTIRE once-per-round entitlement
 * transaction lives behind the U16 operation `applyOncePerRoundUsage` (the
 * consume mark is a durable `ledger:round:*` flag reset at the round-start
 * boundary). F9 owns ONLY whether the trigger occurred and the reaction's
 * ordinary effect mutations; U16 owns availability, the key, consumption, and
 * the grouping of the consume with the allowed effects. Proved on
 * `stormbender:trait:dash-on-the-rocks` (ICON p.230): 1/round when you cause a
 * character to collide, gain 1 aether and deal 1 piercing damage as a burst-1
 * area centered on the collided character (the burst never affects the ability
 * user, p.97).
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

  it('adversarial: the fold marks the REAL owner — the persisted mark carries actor.id, never a fabricated empty owner', () => {
    const { state, heroId, foeId } = dashEncounter();
    const first = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    const mark = first.find((m) => m.kind === 'state');
    expect(mark).toBeDefined();
    if (mark && mark.kind === 'state') {
      // The durable mark is addressed via the REAL owner's actor id (the
      // operation builds the consume from the actor argument) — never `` '' ``.
      expect(mark.key).toBe(usageRoundKey(DASH, heroId));
      expect(mark.actorId).toBe(heroId);
      expect(mark.sourceActorId).toBe(heroId);
      expect(mark.operation).toBe('set');
      expect(mark.value).toBe(true);
    }
  });

  it('adversarial: the once-per-round mark is the canonical U16 round ledger key (usageKey round scope), not an id-agnostic flag', () => {
    const { state, heroId, foeId } = dashEncounter();
    const first = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    const mark = first.find((m) => m.kind === 'state');
    expect(mark).toBeDefined();
    if (mark && mark.kind === 'state') {
      // Byte-identical to the U16 core `usageKey({scope:'round'})` surface — the
      // key is derived inside the U16 operation, never rejoined by F9.
      expect(mark.key).toBe(usageRoundKey(DASH, heroId));
      expect(mark.key).toBe(usageKey({ sourceId: DASH, ownerId: heroId, scope: 'round' }));
      expect(mark.key).toBe(`ledger:round:${DASH}`);
    }
  });
});

describe('U16 — the once-per-round entitlement is ONE U16 operation (F9 corrective)', () => {
  /** The ordinary reaction effect mutations F9 PROPOSES before U16 turns them
   * into an allowed once-per-round commit. */
  function proposedEffects(heroId: string): RuleMutation[] {
    return [
      { kind: 'resource', sourceId: DASH, actorId: heroId, resourceId: 'aether', operation: 'gain', amount: 1, minimum: 0, maximum: null },
      { kind: 'damage', sourceId: DASH, sourceActorId: heroId, actorId: 'foe', amount: 1, damageType: 'piercing', instance: 1, delivery: 'area', ignoreCover: false },
    ];
  }

  it('the operation returns unavailable when the round ledger is consumed, and the exact effect+consume bundle when open', () => {
    const { state, heroId } = dashEncounter();
    const proposed = proposedEffects(heroId);
    let result = applyOncePerRoundUsage({ actor: state.actors[heroId], sourceId: DASH, mutations: proposed });
    expect(result.available).toBe(true);
    if (result.available) {
      // The bundle is the caller's proposed effects PLUS exactly one U16 consume mark.
      expect(result.mutations.length).toBe(proposed.length + 1);
      const effects = result.mutations.slice(0, proposed.length);
      const mark = result.mutations[proposed.length];
      expect(effects).toEqual(proposed);
      expect(mark && mark.kind === 'state' ? mark : null).toMatchObject({
        key: usageRoundKey(DASH, heroId),
        actorId: heroId,
        operation: 'set',
        value: true,
      });
    }
    // Applying the returned bundle (the reducer applies recorded authority)
    // closes the gate: a second operation reports unavailable.
    const applied = applyEvents(state, [{ type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: DASH, actionId: 'default', timing: 'use', tags: [], mutations: result.available ? [...result.mutations] : [] }]);
    expect(applyOncePerRoundUsage({ actor: applied.actors[heroId], sourceId: DASH, mutations: proposed }).available).toBe(false);
  });

  it('adversarial 1 + 4: the operation takes the ACTOR — availability and owner are decided inside U16, so there is no separate raw-state check or fabricatable owner', () => {
    // An unavailable owner: the round ledger is already consumed (the seed
    // bundle was applied). The operation's `available` answer is the ONLY
    // authority F9 consumes — no raw `ruleState[` read remains in the fold.
    const { state, heroId } = dashEncounter();
    const seed = applyOncePerRoundUsage({ actor: state.actors[heroId], sourceId: DASH, mutations: proposedEffects(heroId) });
    expect(seed.available).toBe(true);
    let blocked = state;
    if (seed.available) {
      blocked = applyEvents(state, [{ type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: DASH, actionId: 'default', timing: 'use', tags: [], mutations: [...seed.mutations] }]);
    }
    expect(applyOncePerRoundUsage({ actor: blocked.actors[heroId], sourceId: DASH, mutations: proposedEffects(heroId) }).available).toBe(false);
    // Two DIFFERENT owners never alias: B's open gate is unaffected by A's mark
    // (the key lives on the owner; the operation decides per-actor).
    const { state: s2, heroId: aId } = dashEncounter();
    const b = actorFromCharacter(validCharacter('Arthur'), { x: 2, y: 1 });
    b.traitIds = b.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
    expect(applyOncePerRoundUsage({ actor: s2.actors[aId], sourceId: DASH, mutations: proposedEffects(aId) }).available).toBe(true);
    expect(applyOncePerRoundUsage({ actor: b, sourceId: DASH, mutations: proposedEffects(b.id) }).available).toBe(true);
  });

  it('adversarial 3: F9 exposes no ledger key to reconstruct — the commit mark is the canonical U16 round key from the returned bundle', () => {
    const { state, heroId, foeId } = dashEncounter();
    const fold = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    const foldMark = fold.find((m) => m.kind === 'state');
    // The fold's persisted mark equals the U16 operation's returned consume mark.
    const op = applyOncePerRoundUsage({ actor: state.actors[heroId], sourceId: DASH, mutations: proposedEffects(heroId) });
    expect(op.available).toBe(true);
    if (op.available && foldMark && foldMark.kind === 'state') {
      const opMark = op.mutations[op.mutations.length - 1];
      expect(foldMark.key).toBe(usageRoundKey(DASH, heroId));
      expect(opMark && opMark.kind === 'state' ? opMark.key : undefined).toBe(foldMark.key);
    }
    // The mark is NOT an id-agnostic rebuildable address chosen by F9 — it is
    // the canonical `ledger:round:<sourceId>` (actor-local) surface.
    expect(foldMark && foldMark.kind === 'state' ? foldMark.key : undefined).toBe(`ledger:round:${DASH}`);
  });

  it('adversarial 2 + 5: the consume mark exists ONLY inside the returned bundle — F9 cannot hand-build it or spread-alias a replacement', () => {
    // The fold commits `result.mutations` verbatim (asserted by the architecture
    // audit); behaviorally, committing it and then re-calling the operation shows
    // the bundle is self-consistent. A caller that hand-builds its own mark
    // instead of using the bundle would be constructing a competing transaction —
    // the API makes that path unnecessary because the bundle already carries the
    // mark, and the semantic pins make it impossible for the fold (no local state
    // literal, no separately-decided entitlement).
    const { state, heroId } = dashEncounter();
    const result = applyOncePerRoundUsage({ actor: state.actors[heroId], sourceId: DASH, mutations: proposedEffects(heroId) });
    expect(result.available).toBe(true);
    if (result.available) {
      // The bundle always exports the consume mark grouped with the effects; the
      // caller cannot obtain a mark without the bundle (nothing else exposes it).
      expect(result.mutations.filter((m) => m.kind === 'state')).toHaveLength(1);
    }
  });

  it('replay purity: the command decides once, the reducer applies the recorded bundle without rechecking entitlement', () => {
    const { state, heroId, foeId } = dashEncounter();
    const mutations = traitReactionMutations(state, state.actors[heroId], [], { collidedActorIds: [foeId] });
    const event: never[] = [{ type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: DASH, actionId: 'default', timing: 'use', tags: [], mutations }] as never;
    const once = applyEvents(state, event);
    const twice = applyEvents(state, event);
    expect(once).toEqual(twice);
  });

  it('the fold exposes no independent gate internals (key / availability / consume / owner) to forge', () => {
    // The API-boundary proof for the five adversarial paths: F9 proposes effects,
    // but it owns NONE of the entitlement pieces — no key derivation, no
    // availability recomputation, no consume construction, no owner parameter.
    // A competing once-per-round path therefore has nothing to build from here.
    const { readFileSync } = require('node:fs');
    const { resolve } = require('node:path');
    const src = readFileSync(resolve(import.meta.dirname ?? __dirname, '..', 'automation', 'kernels', 'trait-reactions.ts'), 'utf8');
    expect(src).not.toMatch(/OncePerRoundGate|oncePerRoundGate|oncePerRoundGateBrand/);
    expect(src).not.toMatch(/consumeUsageMutation/);
    expect(src).not.toMatch(/ledgerAvailable/);
    expect(src).not.toMatch(/usageKey\(|usageRoundKey/);
    expect(src).not.toMatch(/roundLedger|ownerId:\s*['"]['"]/);
    // The fold's only once-per-round authority is the U16 operation and its bundle.
    expect(src).toContain('applyOncePerRoundUsage');
    expect(src).toContain('result.available');
    expect(src).toContain('result.mutations');
    expect(src).toContain('out.push(...result.mutations)');
  });
});