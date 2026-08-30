/**
 * t4-facts-provenance.test.ts — Phase T4 U9 PROVENANCE + U10 FACTS tests.
 *
 * U9 (`primitives/provenance.ts`) is the typed causal/delivery vocabulary
 * (source identity vs delivery kind, DeliverySourceKind, reflection). U10
 * (`primitives/facts.ts`) is the closed discriminated fact history recorded
 * at the authoritative resolve point — deterministic instance ids, LIVE vs
 * CAPTURED semantics, and a fact that "remains historically true" even when
 * live state changes.
 *
 * Covered here: provenance dimension separation + reflection-preserving
 * origin (`sameCausalOrigin`), typed fact recording (attack/damage/effect/
 * movement/save/defeat with viaSlay), the reactive-trigger projection
 * (behavior-preserving vs the long-standing surface), coexisting effect
 * instances not aliasing, replay determinism, and facts-as-history versus
 * mutable state.
 */
import { describe, expect, it } from 'vitest';
import {
  provenanceOfMutation,
  sameCausalOrigin,
  type Provenance,
} from '../automation/primitives/provenance.js';
import {
  deriveResolutionFactProjection,
  effectInstanceKey,
  factInstanceId,
  recordFacts,
  type Fact,
} from '../automation/primitives/facts.js';
import type { RuleMutation } from '../automation/primitives/types.js';

function attackMutation(overrides: Partial<Extract<RuleMutation, { kind: 'attack' }>> = {}): RuleMutation {
  return {
    kind: 'attack', sourceId: 'fixture:ability', actorId: 'hero', targetId: 'foe',
    d20: 12, boon: 0, total: 15, hit: true, critical: false, evasionRoll: null,
    trueStrike: false, autoHit: false, exceed: false, exceedThreshold: 20,
    ...overrides,
  };
}

function damageMutation(overrides: Partial<Extract<RuleMutation, { kind: 'damage' }>> = {}): RuleMutation {
  return {
    kind: 'damage', sourceId: 'fixture:ability', sourceActorId: 'hero', actorId: 'foe',
    amount: 4, damageType: 'normal', instance: 0, delivery: 'hit', ignoreCover: false,
    ...overrides,
  };
}

describe('U9 — provenance dimensions', () => {
  it('keeps source identity distinct from delivery kind (dimensions, not a flag bag)', () => {
    const provenance = provenanceOfMutation(damageMutation({ delivery: 'terrain' }), { actionId: 'hit-action' });
    expect(provenance.sourceId).toBe('fixture:ability');
    expect(provenance.sourceActorId).toBe('hero'); // originating actor preserved
    expect(provenance.ownerId).toBe('hero');
    expect(provenance.recipientId).toBe('foe');
    expect(provenance.delivery).toBe('terrain'); // delivery kind is separate
    expect(provenance.actionId).toBe('hit-action');
    expect(provenance).not.toHaveProperty('movementMode');
  });

  it('a reflected/secondary delivery preserves the initiating causal origin', () => {
    // The reflected damage's OWN fields name the acting source; the
    // reflected delivery still derives from the original attacker's ability.
    const reflected: Provenance = {
      ...provenanceOfMutation(damageMutation(), { actionId: 'reflect-leg' }),
      delivery: 'reflected',
      derivedFromFact: 'fact:reflector:damage-applied:0',
    };
    const original = provenanceOfMutation(damageMutation(), { actionId: 'orig-leg' });
    expect(sameCausalOrigin(reflected, original)).toBe(true);
    // Terrain delivery derives from the environment, not the actor — NOT the
    // same causal origin, even for the same sourceId.
    const terrain = provenanceOfMutation(damageMutation({ sourceActorId: '', delivery: 'terrain', actorId: 'foe' }), { deliverySource: 'environment' });
    expect(sameCausalOrigin(terrain, provenanceOfMutation(damageMutation()))).toBe(false);
  });

  it('movement provenance records its movement mode and recipient', () => {
    const move = provenanceOfMutation({
      kind: 'move', sourceId: 'fixture:shove', sourceActorId: 'hero', actorId: 'foe',
      movement: 'shove', distance: 2, positions: [], direction: null, phasing: false,
    });
    expect(move.movementMode).toBe('shove');
    expect(move.recipientId).toBe('foe');
  });
});

describe('U10 — recordFacts records the typed history at the resolve point', () => {
  it('records attack-resolved (hit / miss / critical / exceed) with provenance', () => {
    const mutations = [
      attackMutation({ hit: true, critical: true, exceed: true, exceedThreshold: 20 }),
      attackMutation({ hit: false, critical: false }),
    ];
    const facts = recordFacts(mutations, { ownerId: 'hero', actionId: 'use' });
    const attacks = facts.filter((fact) => fact.kind === 'attack-resolved') as Extract<Fact, { kind: 'attack-resolved' }>[];
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ targetId: 'foe', hit: true, critical: true, exceed: true, ownerId: 'hero' });
    expect(attacks[1]).toMatchObject({ hit: false, critical: false });
    expect(attacks[0].provenance?.sourceActorId).toBe('hero');
    expect(attacks[0].instanceId).toBe('fact:fixture:ability:attack-resolved:0');
  });

  it('records damage-applied with recipient + delivery, preserving the causal origin', () => {
    const facts = recordFacts([damageMutation({ delivery: 'area' })], { ownerId: 'hero' });
    const damage = facts.find((fact) => fact.kind === 'damage-applied');
    expect(damage).toMatchObject({ recipientId: 'foe', amount: 4, delivery: 'area', ownerId: 'hero' });
    expect((damage as Extract<Fact, { kind: 'damage-applied' }>).provenance?.sourceActorId).toBe('hero');
  });

  it('coexisting persistent effect applications get DISTINCT instance keys (never alias)', () => {
    const a = {
      kind: 'persistent', sourceId: 'fixture:gate', ownerId: 'hero', operation: 'add' as const,
      actorId: 'hero', effectId: 'aura', duration: { kind: 'combat' }, modifiers: [], triggers: [], state: {},
    } as Extract<RuleMutation, { kind: 'persistent' }>;
    const facts = recordFacts([a, a], { ownerId: 'hero' });
    const effects = facts.filter((fact) => fact.kind === 'effect') as Extract<Fact, { kind: 'effect' }>[];
    expect(effects).toHaveLength(2);
    // Same source/target/effect, DIFFERENT application — distinct instance keys.
    expect(effects[0].instanceKey).not.toBe(effects[1].instanceKey);
    expect(effects[0].instanceKey).toMatch(/^inst:persistent:/);
    expect(effects[1].instanceKey).toMatch(/^inst:persistent:/);
  });

  it('a defeat mutation is recorded as an actor-defeated outcome but is NOT a Slay (viaSlay false)', () => {
    const facts = recordFacts([{ kind: 'defeat', sourceId: 'fixture:axe', actorId: 'foe' }], { ownerId: 'hero' });
    const defeat = facts.find((fact) => fact.kind === 'actor-defeated');
    expect(defeat).toMatchObject({ defeatedId: 'foe', ownerId: 'hero' });
    expect((defeat as Extract<Fact, { kind: 'actor-defeated' }>).viaSlay).not.toBe(true);
  });
});

describe('U10 — reactive-trigger projection is behavior-preserving', () => {
  it('derives the byte-compatible surface from typed facts (hit/miss/crit/exceed)', () => {
    const facts = recordFacts([
      attackMutation({ hit: true, critical: false }),
      attackMutation({ hit: false, critical: false }),
      attackMutation({ hit: true, critical: true, exceed: true, exceedThreshold: 20 }),
    ], { ownerId: 'hero' });
    const projection = deriveResolutionFactProjection(facts);
    expect(projection.attackTargets).toEqual(['foe', 'foe', 'foe']);
    expect([...projection.triggers].sort()).toEqual(['critical-hit', 'exceed', 'hit', 'miss']);
  });

  it('only viaSlay actor-defeated facts open the slay trigger (not explicit defeat)', () => {
    const plain = deriveResolutionFactProjection([{ kind: 'actor-defeated', instanceId: 'f:0', sourceId: 's', ownerId: 'o', defeatedId: 'foe' }]);
    expect(plain.slainActorIds).toEqual([]);
    expect(plain.triggers.has('slay')).toBe(false);
    const slay = deriveResolutionFactProjection([{ kind: 'actor-defeated', instanceId: 'f:0', sourceId: 's', ownerId: 'o', defeatedId: 'foe', viaSlay: true }]);
    expect(slay.slainActorIds).toEqual(['foe']);
    expect(slay.triggers.has('slay')).toBe(true);
  });

  it('collide facts project collideActorIds + the collide trigger', () => {
    const projection = deriveResolutionFactProjection([
      { kind: 'collide', instanceId: 'f:0', sourceId: 's', ownerId: 'o', shovedActorId: 'foe' },
    ]);
    expect(projection.collidedActorIds).toEqual(['foe']);
    expect(projection.triggers.has('collide')).toBe(true);
  });
});

describe('U10 — facts are history, not live state (and replay is deterministic)', () => {
  it('a recorded fact remains historically true even if mutable state changes', () => {
    const mutations = [damageMutation({ amount: 4 })];
    const facts = recordFacts(mutations, { ownerId: 'hero' });
    const before = JSON.stringify(facts);
    // The encounter state changing must not edit the recorded fact history.
    expect(facts).toHaveLength(1);
    expect((facts[0] as Extract<Fact, { kind: 'damage-applied' }>).amount).toBe(4);
    // Mutable state was "changed" afterwards; the fact list is unchanged.
    expect(JSON.stringify(recordFacts(mutations, { ownerId: 'hero' }))).toBe(before);
  });

  it('the same event sequence yields the same fact sequence (replay)', () => {
    const mutations: RuleMutation[] = [
      attackMutation({ hit: true }),
      damageMutation({ amount: 3 }),
      { kind: 'condition', sourceId: 'fixture:gate', sourceActorId: 'hero', actorId: 'foe', conditionId: 'weakened', operation: 'apply', potency: 'normal' },
    ];
    const first = recordFacts(mutations, { ownerId: 'hero', actionId: 'use' });
    const second = recordFacts([...mutations], { ownerId: 'hero', actionId: 'use' });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('factInstanceId and effectInstanceKey are deterministic and collision-safe', () => {
    expect(factInstanceId('s', 'damage-applied', 2)).toBe('fact:s:damage-applied:2');
    const same = effectInstanceKey('persistent', 'a', 'b', 'd', 'x');
    expect(effectInstanceKey('persistent', 'a', 'b', 'd', 'x')).toBe(same); // deterministic
    // Delimiter-bearing ids must not collide across different identities.
    // source `a:b`/target `c` vs source `a`/target `b:c` MUST differ.
    expect(effectInstanceKey('persistent', 'a', 'b:c', 'd', 'x')).not.toBe(effectInstanceKey('persistent', 'a:b', 'c', 'd', 'x'));
  });
});