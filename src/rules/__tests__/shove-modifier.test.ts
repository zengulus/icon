/**
 * F8b shove-modifier fold tests.
 *
 * The fold (kernels/shove-modifier.ts) modifies shove mutation properties
 * (distance, direction) at the shove-resolution pipeline boundary. Content
 * registers reviewed ShoveModifierRule rows; the kernel folds them in
 * registration order.
 *
 * Decomposition of the 10 pure shove-modifier singletons:
 * - Distance modifiers (fold-applicable): demon-slayer:demon-claw:talent:2
 * - Direction modifiers (resolver-level): 5 units need resolver wiring
 * - New shove effects (resolver-level): 4 units need resolver wiring
 *
 * This test exercises the fold in isolation, not the full command path
 * (the resolver must emit the shove mutation first).
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { effectiveShoveMutation } from '../automation/kernels/shove-modifier.js';
import type { EncounterActor, EncounterState } from '../types.js';

// ── Minimal state fixtures ──────────────────────────────────────────────────

function minimalState(): EncounterState {
  return {
    schemaVersion: 7,
    rulesVersion: '1.5',
    id: 'test-encounter',
    name: 'Test',
    phase: 'active',
    round: 1,
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
    abilityIds: [],
    masteredAbilityIds: [],
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

function shoveMutation(overrides: Partial<{ sourceId: string; actorId: string; distance: number }> = {}) {
  return {
    kind: 'move' as const,
    sourceId: overrides.sourceId ?? 'test:ability',
    sourceActorId: overrides.actorId ?? 'hero-1',
    actorId: overrides.actorId ?? 'target-1',
    movement: 'shove' as const,
    distance: overrides.distance ?? 1,
    positions: [],
    direction: { x: 1, y: 0 },
    phasing: false,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('F8b shove-modifier fold', () => {
  describe('distance modifier: demon-slayer:demon-claw:talent:2', () => {
    it('talent equipped: shove distance increases from 1 to 2', () => {
      const state = minimalState();
      state.actors['hero-1'] = minimalActor({
        abilityIds: ['demon-slayer:demon-claw'],
        talents: { 'demon-slayer:demon-claw:talent:2': 2 },
      });
      const mutation = shoveMutation({ sourceId: 'demon-slayer:demon-claw', distance: 1 });
      const result = effectiveShoveMutation(mutation, state);
      expect(result).toMatchObject({ distance: 2 });
    });

    it('talent not equipped: shove distance unchanged', () => {
      const state = minimalState();
      state.actors['hero-1'] = minimalActor({
        abilityIds: ['demon-slayer:demon-claw'],
        talents: {},
      });
      const mutation = shoveMutation({ sourceId: 'demon-slayer:demon-claw', distance: 1 });
      const result = effectiveShoveMutation(mutation, state);
      expect(result).toMatchObject({ distance: 1 });
    });

    it('ability not equipped: shove distance unchanged', () => {
      const state = minimalState();
      state.actors['hero-1'] = minimalActor({
        abilityIds: [],
        talents: {},
      });
      const mutation = shoveMutation({ sourceId: 'demon-slayer:demon-claw', distance: 1 });
      const result = effectiveShoveMutation(mutation, state);
      expect(result).toMatchObject({ distance: 1 });
    });
  });

  describe('non-shove mutations pass through unchanged', () => {
    it('rush mutation is not modified', () => {
      const state = minimalState();
      state.actors['hero-1'] = minimalActor({
        abilityIds: ['demon-slayer:demon-claw'],
        talents: { 'demon-slayer:demon-claw:talent:2': 2 },
      });
      const mutation = {
        kind: 'move' as const,
        sourceId: 'demon-slayer:demon-claw',
        sourceActorId: 'hero-1',
        actorId: 'hero-1',
        movement: 'rush' as const,
        distance: null,
        positions: [{ x: 1, y: 0 }],
        direction: null,
        phasing: false,
      };
      const result = effectiveShoveMutation(mutation, state);
      expect(result).toEqual(mutation);
    });
  });

  describe('unknown ability: shove unchanged', () => {
    it('unregistered ability → base shove', () => {
      const state = minimalState();
      state.actors['hero-1'] = minimalActor();
      const mutation = shoveMutation({ sourceId: 'unknown:ability', distance: 1 });
      const result = effectiveShoveMutation(mutation, state);
      expect(result).toMatchObject({ distance: 1 });
    });
  });
});
