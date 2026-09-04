/**
 * F8a action-cost override fold tests.
 *
 * The fold (registered via CostModifierRule in cost-payment kernel) is the
 * single reusable authority that determines the effective action cost for a
 * pure action-cost-override ability (Valiant, Shadow Play, Polaris) at
 * round >= 4 when mastery is equipped.
 *
 * These tests exercise the full command path: executeCommand → event →
 * applyEvents/replay, not just the fold in isolation.
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState } from '../types.js';
import { expectCommandPurity, scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

// ── Fixture helpers ────────────────────────────────────────────────────────

interface CostOverrideFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

function costOverrideFixture(options: {
  abilityId?: string;
  mastered?: boolean;
  round?: number;
} = {}): CostOverrideFixture {
  const abilityId = options.abilityId ?? 'bastion:valiant';
  const mastered = options.mastered ?? true;
  const round = options.round ?? 4;

  let state = createEncounter('Action-cost override fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [abilityId];
  hero.chapter = 3;
  if (mastered) {
    hero.masteredAbilityIds = [abilityId];
  }
  const foe = createFoe('Relict', { x: 5, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  state.round = round;
  return { state, hero, foe };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('F8a action-cost override fold', () => {
  describe('bastion:valiant mastery — round-gated free action', () => {
    it('round < 4: Valiant costs 1 action', () => {
      const { state, hero } = costOverrideFixture({ round: 3 });
      const result = executeCommand(
        state,
        { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:valiant', targetIds: [] },
        scriptedDice(),
      );
      // Action was consumed
      expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
      // Replay from pre-command snapshot reproduces result
      expect(applyEvents(state, result.events)).toEqual(result.state);
    });

    it('round >= 4: Valiant is free (no action consumed)', () => {
      const { state, hero } = costOverrideFixture({ round: 4 });
      const result = expectCommandPurity(
        state,
        { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:valiant', targetIds: [] },
        scriptedDice(),
      );
      // Action was NOT consumed
      expect(result.state.actors[hero.id].actionsRemaining).toBe(2);
    });

    it('round 6: Valiant is still free', () => {
      const { state, hero } = costOverrideFixture({ round: 6 });
      const result = executeCommand(
        state,
        { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:valiant', targetIds: [] },
        scriptedDice(),
      );
      expect(result.state.actors[hero.id].actionsRemaining).toBe(2);
    });
  });

  describe('negative: mastery not equipped', () => {
    it('round >= 4 but mastery not equipped: still costs 1 action', () => {
      const { state, hero } = costOverrideFixture({ mastered: false, round: 4 });
      const result = executeCommand(
        state,
        { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:valiant', targetIds: [] },
        scriptedDice(),
      );
      expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    });
  });

  describe('shade:shadow-play mastery — round-gated free action', () => {
    it('round >= 4 with mastery: free action', () => {
      // Shadow Play requires 2 other characters for its swap resolver.
      let state = createEncounter('Shadow Play fixture');
      const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
      hero.abilityIds = ['shade:shadow-play'];
      hero.masteredAbilityIds = ['shade:shadow-play'];
      hero.chapter = 3;
      const foe = createFoe('Relict', { x: 3, y: 1 });
      const other = createFoe('Grim', { x: 5, y: 1 });
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: other }).state;
      state = startEncounterTo(state, hero.id);
      state.round = 4;
      const result = executeCommand(
        state,
        { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:shadow-play', targetIds: [foe.id, other.id] },
        scriptedDice(),
      );
      // Action was NOT consumed (mastery free action)
      expect(result.state.actors[hero.id].actionsRemaining).toBe(2);
      // Replay
      expect(applyEvents(state, result.events)).toEqual(result.state);
    });
  });

  describe('seer:polaris mastery — round-gated free action', () => {
    it('round >= 4 with mastery: free action', () => {
      const { state, hero } = costOverrideFixture({ abilityId: 'seer:polaris', round: 4 });
      const result = expectCommandPurity(
        state,
        { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:polaris', targetIds: [] },
        scriptedDice(),
      );
      expect(result.state.actors[hero.id].actionsRemaining).toBe(2);
    });
  });

  describe('replay: deterministic command-time resolution', () => {
    it('round < 4 → action consumed; round >= 4 → free; both replay-equal', () => {
      // Round 3: costs action
      const low = costOverrideFixture({ round: 3 });
      const lowResult = executeCommand(
        low.state,
        { type: 'USE_ABILITY', actorId: low.hero.id, abilityId: 'bastion:valiant', targetIds: [] },
        scriptedDice(),
      );
      expect(applyEvents(low.state, lowResult.events)).toEqual(lowResult.state);

      // Round 4: free
      const high = costOverrideFixture({ round: 4 });
      const highResult = executeCommand(
        high.state,
        { type: 'USE_ABILITY', actorId: high.hero.id, abilityId: 'bastion:valiant', targetIds: [] },
        scriptedDice(),
      );
      expect(applyEvents(high.state, highResult.events)).toEqual(highResult.state);

      // The only difference should be the action spend mutation
      const lowSpend = lowResult.events.some(
        (e) => e.type === 'RULE_MUTATIONS_APPLIED' && e.mutations.some(
          (m) => m.kind === 'actions' && m.operation === 'spend',
        ),
      );
      const highSpend = highResult.events.some(
        (e) => e.type === 'RULE_MUTATIONS_APPLIED' && e.mutations.some(
          (m) => m.kind === 'actions' && m.operation === 'spend',
        ),
      );
      expect(lowSpend).toBe(true);
      expect(highSpend).toBe(false);
    });
  });
});
