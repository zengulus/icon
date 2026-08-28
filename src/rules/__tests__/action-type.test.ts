/**
 * F8 action-type/action-cost fold tests.
 *
 * The fold (kernels/action-type.ts) is the single reusable authority that
 * determines the effective action cost for a given ability on a given actor.
 * Mastery rows fold an existing ability's cost to free under encounter-state
 * gates (round >= 4); talent rows fold a new free-action ability gated on
 * the parent ability's active state.
 *
 * Tests exercise:
 * - positive: mastery-equipped actor, round >= 4 → free action
 * - negative: mastery-equipped actor, round < 4 → still costs action
 * - unequipped: talent ability not equipped → base cost unchanged
 * - replay: deterministic command-time resolution
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { effectiveAbilityActionCost } from '../automation/kernels/action-type.js';
import type { EncounterActor, EncounterState } from '../types.js';

// ── Minimal state fixtures ──────────────────────────────────────────────────

function minimalState(round: number = 1): EncounterState {
  return {
    schemaVersion: 7,
    rulesVersion: '1.5',
    id: 'test-encounter',
    name: 'Test',
    phase: 'active',
    round,
    lastSide: null,
    activeActorId: null,
    eligibleSide: 'heroes',
    turnPhase: 'normal',
    grid: { width: 10, height: 10, backgroundUrl: '', terrain: [] },
    actors: {},
    terrainEffects: [],
    entities: {},
    pendingInterrupts: [],
    partyResolve: 0,
    eventLog: [],
    revision: 0,
  };
}

function minimalActor(overrides: Partial<EncounterActor> = {}): EncounterActor {
  return {
    id: 'hero-1',
    name: 'Test Hero',
    side: 'heroes',
    actorKind: 'hero',
    classId: 'stalwart' as const,
    chapter: 1,
    position: { x: 0, y: 0 },
    size: 1,
    tokenUrl: '',
    onBattlefield: true,
    defeated: false,
    hp: 10,
    baseMaxHp: 10,
    wounds: 0,
    vigor: 0,
    vitality: 0,
    defense: 0,
    armor: 0,
    speed: 4,
    dash: 2,
    fray: 0,
    damageDie: 6,
    basicAttackRange: 1,
    actionsRemaining: 2,
    attackedThisTurn: false,
    standardMoveUsed: false,
    interruptUsedThisTurn: false,
    interruptUses: {},
    abilityIds: ['bastion:valiant'],
    masteredAbilityIds: ['bastion:valiant'],
    talents: {},
    traitIds: [],
    activeEffects: [],
    usedAbilityIds: [],
    marks: [],
    resources: {},
    statuses: [],
    conditions: [],
    ruleState: {},
    ruleStateOwners: {},
    stance: null,
    slashedTriggeredThisTurn: false,
    dangerousTerrainTriggeredThisTurn: false,
    turnTaken: false,
    turnsRemaining: 1,
    turnsTakenThisRound: 0,
    slow: false,
    controllerId: null,
    characterId: null,
    foeProfileId: null,
    roleId: null,
    foeKind: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('F8 action-type fold (kernels/action-type.ts)', () => {
  describe('mastery rows: round-gated free action', () => {
    it('bastion:valiant mastery: round < 4 → base action cost (1)', () => {
      const state = minimalState(3);
      const actor = minimalActor();
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'bastion:valiant', baseCost);
      expect(result).toEqual({ kind: 'action', value: 1 });
    });

    it('bastion:valiant mastery: round >= 4 → free action', () => {
      const state = minimalState(4);
      const actor = minimalActor();
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'bastion:valiant', baseCost);
      expect(result).toEqual({ kind: 'free', value: 0 });
    });

    it('colossus:massive-overhead mastery: round >= 4 → free action', () => {
      const state = minimalState(5);
      const actor = minimalActor({ abilityIds: ['colossus:massive-overhead'], masteredAbilityIds: ['colossus:massive-overhead'] });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'colossus:massive-overhead', baseCost);
      expect(result).toEqual({ kind: 'free', value: 0 });
    });

    it('seer:polaris mastery: round >= 4 → free action', () => {
      const state = minimalState(4);
      const actor = minimalActor({ abilityIds: ['seer:polaris'], masteredAbilityIds: ['seer:polaris'] });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'seer:polaris', baseCost);
      expect(result).toEqual({ kind: 'free', value: 0 });
    });

    it('warden:strength-of-the-pack mastery (2 action base): round >= 4 → free action', () => {
      const state = minimalState(6);
      const actor = minimalActor({
        abilityIds: ['warden:strength-of-the-pack'],
        masteredAbilityIds: ['warden:strength-of-the-pack'],
      });
      const baseCost = { kind: 'action' as const, value: 2 };
      const result = effectiveAbilityActionCost(state, actor, 'warden:strength-of-the-pack', baseCost);
      expect(result).toEqual({ kind: 'free', value: 0 });
    });
  });

  describe('negative: unequipped ability', () => {
    it('bastion:valiant mastery not equipped → base cost unchanged', () => {
      const state = minimalState(4);
      const actor = minimalActor({ abilityIds: [], masteredAbilityIds: [] });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'bastion:valiant', baseCost);
      expect(result).toEqual({ kind: 'action', value: 1 });
    });

    it('ability equipped but not mastered → base cost unchanged', () => {
      const state = minimalState(4);
      const actor = minimalActor({ masteredAbilityIds: [] });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'bastion:valiant', baseCost);
      expect(result).toEqual({ kind: 'action', value: 1 });
    });
  });

  describe('talent rows: terrain-gated free action', () => {
    it('shade:nocturne talent: nocturne terrain exists → free action', () => {
      const state = minimalState(1);
      state.terrainEffects.push({
        id: 'test-terrain',
        sourceId: 'shade:nocturne',
        ownerId: 'hero-1',
        terrain: 'shadow-cloud',
        positions: [{ x: 3, y: 3 }],
        height: null,
        duration: null,
      });
      const actor = minimalActor({
        abilityIds: ['shade:nocturne'],
        masteredAbilityIds: ['shade:nocturne'],
        talents: { 'shade:nocturne:talent:1': 1 },
      });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'shade:nocturne', baseCost);
      expect(result).toEqual({ kind: 'free', value: 0 });
    });

    it('shade:nocturne talent: no nocturne terrain → base cost unchanged', () => {
      const state = minimalState(1);
      const actor = minimalActor({
        abilityIds: ['shade:nocturne'],
        masteredAbilityIds: ['shade:nocturne'],
        talents: { 'shade:nocturne:talent:1': 1 },
      });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'shade:nocturne', baseCost);
      expect(result).toEqual({ kind: 'action', value: 1 });
    });

    it('warden:underway talent: stealth active → free action', () => {
      const state = minimalState(1);
      const actor = minimalActor({
        abilityIds: ['warden:underway'],
        masteredAbilityIds: ['warden:underway'],
        talents: { 'warden:underway:talent:1': 1 },
        conditions: [{ id: 'stealth', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null }],
      });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'warden:underway', baseCost);
      expect(result).toEqual({ kind: 'free', value: 0 });
    });

    it('warden:underway talent: no stealth → base cost unchanged', () => {
      const state = minimalState(1);
      const actor = minimalActor({
        abilityIds: ['warden:underway'],
        masteredAbilityIds: ['warden:underway'],
        talents: { 'warden:underway:talent:1': 1 },
      });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'warden:underway', baseCost);
      expect(result).toEqual({ kind: 'action', value: 1 });
    });

    it('enochian:elden-rune talent: rune terrain exists → free action', () => {
      const state = minimalState(1);
      state.terrainEffects.push({
        id: 'test-rune',
        sourceId: 'enochian:elden-rune',
        ownerId: 'hero-1',
        terrain: 'elden-rune',
        positions: [{ x: 1, y: 1 }],
        height: null,
        duration: null,
      });
      const actor = minimalActor({
        abilityIds: ['enochian:elden-rune'],
        masteredAbilityIds: ['enochian:elden-rune'],
        talents: { 'enochian:elden-rune:talent:1': 1 },
      });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'enochian:elden-rune', baseCost);
      expect(result).toEqual({ kind: 'free', value: 0 });
    });
  });

  describe('talent rows: talent not equipped → base cost unchanged', () => {
    it('shade:nocturne talent not equipped (no talent in talents map) → base cost', () => {
      const state = minimalState(1);
      state.terrainEffects.push({
        id: 'test-terrain',
        sourceId: 'shade:nocturne',
        ownerId: 'hero-1',
        terrain: 'shadow-cloud',
        positions: [{ x: 3, y: 3 }],
        height: null,
        duration: null,
      });
      const actor = minimalActor({
        abilityIds: ['shade:nocturne'],
        masteredAbilityIds: ['shade:nocturne'],
        talents: {},
      });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'shade:nocturne', baseCost);
      expect(result).toEqual({ kind: 'action', value: 1 });
    });

    it('warden:underway talent not equipped + stealth → base cost unchanged', () => {
      const state = minimalState(1);
      const actor = minimalActor({
        abilityIds: ['warden:underway'],
        masteredAbilityIds: ['warden:underway'],
        talents: {},
        conditions: [{ id: 'stealth', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null }],
      });
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'warden:underway', baseCost);
      expect(result).toEqual({ kind: 'action', value: 1 });
    });
  });

  describe('always-free abilities are unchanged', () => {
    it('ability already free → fold returns free', () => {
      const state = minimalState(1);
      const actor = minimalActor();
      const baseCost = { kind: 'free' as const, value: 0 };
      const result = effectiveAbilityActionCost(state, actor, 'bastion:valiant', baseCost);
      expect(result).toEqual({ kind: 'free', value: 0 });
    });
  });

  describe('unknown ability → base cost unchanged', () => {
    it('unregistered ability → base cost', () => {
      const state = minimalState(4);
      const actor = minimalActor();
      const baseCost = { kind: 'action' as const, value: 1 };
      const result = effectiveAbilityActionCost(state, actor, 'unknown:ability', baseCost);
      expect(result).toEqual({ kind: 'action', value: 1 });
    });
  });
});
