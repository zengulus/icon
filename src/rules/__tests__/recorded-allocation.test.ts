import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { resolveCapturedUnitAllocation } from '../automation/kernels/choice.js';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { RuleProgramViolation } from '../automation/kernels/violations.js';
import type { RuleExecutionContext, RuleExecutionInput } from '../automation/primitives/types.js';
import { scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

// Source: ICON 1.5 p.178 Symphony — "Remove up to four blessings from
// characters anywhere to create pulsing motes of energy ... creating terrain
// spaces". The player chooses every payer and every amount; each removed
// blessing independently creates one mote.
function fixture() {
  let state = createEncounter('Recorded allocation');
  const hero = actorFromCharacter(validCharacter('Allocator'), { x: 4, y: 4 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Target', { x: 6, y: 4 });
  const ally = actorFromCharacter(validCharacter('Holder'), { x: 4, y: 6 });
  for (const actor of [hero, foe, ally]) state = executeCommand(state, { type: 'ADD_ACTOR', actor }).state;
  state = startEncounterTo(state, hero.id);
  const use = (abilityId: string, input: RuleExecutionInput = {}, targets: string[] = [], dice: number[] = []) =>
    executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId, input, targetIds: targets }, scriptedDice(...dice));
  const context = (input: RuleExecutionInput = {}): RuleExecutionContext => ({
    sourceId: 'fixture:allocation', actionId: 'default', timing: 'use', actorId: hero.id,
    state: encounterRuleState(state), encounterState: state, input, dice: scriptedDice(),
  });
  return { state, hero, foe, ally, use, context };
}

function code(run: () => unknown) {
  try { run(); return 'accepted'; } catch (error) {
    if (error instanceof RuleProgramViolation) return error.code;
    throw error;
  }
}

const moteCells = [{ x: 1, y: 1 }, { x: 1, y: 3 }, { x: 1, y: 5 }];
const motes = (state: ReturnType<typeof fixture>['state']) =>
  state.terrainEffects.filter((effect) => effect.terrain === 'symphony-mote').flatMap((effect) => effect.positions);

describe('recorded unit allocation (U4)', () => {
  const candidates = [{ id: 'a', units: 2 }, { id: 'b', units: 1 }];
  const call = (input: RuleExecutionInput, required = false, maximum?: number) => {
    const f = fixture();
    return resolveCapturedUnitAllocation(
      { key: 'units', label: 'Units', required, maximum },
      candidates, f.context(input));
  };

  it('keeps repeated entries as distinct units and returns per-supplier counts', () => {
    expect(call({ actorIds: { units: ['a', 'a', 'b'] } })).toEqual([{ id: 'a', units: 2 }, { id: 'b', units: 1 }]);
  });
  it('reads absent or empty as the explicit zero-unit decision when optional', () => {
    expect(call({})).toEqual([]);
    expect(call({ actorIds: { units: [] } })).toEqual([]);
  });
  it('rejects a required allocation that is missing or empty', () => {
    expect(code(() => call({}, true))).toBe('choice.units-required');
    expect(code(() => call({ actorIds: { units: [] } }, true))).toBe('choice.units-required');
  });
  it('enforces total-unit bounds independent of the per-supplier capacity', () => {
    expect(code(() => call({ actorIds: { units: ['a', 'a', 'b'] } }, false, 2))).toBe('choice.units-count');
    expect(code(() => call({ actorIds: { units: ['a'] } }, false, undefined))).toBe('accepted');
  });
  it('rejects a supplier outside the candidate domain', () => {
    expect(code(() => call({ actorIds: { units: ['a', 'c'] } }))).toBe('choice.unit-ineligible');
  });
  it('rejects more units from a supplier than it can supply', () => {
    expect(code(() => call({ actorIds: { units: ['b', 'b'] } }))).toBe('choice.unit-capacity');
    expect(code(() => call({ actorIds: { units: ['a', 'a', 'a'] } }))).toBe('choice.unit-capacity');
  });
  it('rejects malformed recorded allocations', () => {
    expect(code(() => call({ actorIds: { units: 'a,b' as unknown as string[] } }))).toBe('choice.units-invalid');
    expect(code(() => call({ actorIds: { units: [3 as unknown as string] } }))).toBe('choice.units-invalid');
    expect(code(() => call({ actorIds: { units: ['a', ''] } }))).toBe('choice.units-invalid');
  });
});

describe('Symphony recorded blessing allocation (ICON p.178)', () => {
  it('removes exactly the recorded blessings, one mote per unit, and replays', () => {
    const f = fixture();
    f.state.actors[f.hero.id].resources.blessing = 1;
    f.state.actors[f.ally.id].resources.blessing = 2;
    const input = { actorIds: { 'symphony-blessings': [f.ally.id, f.ally.id, f.hero.id] }, positions: { 'mote-positions': moteCells } };
    const result = f.use('chanter:symphony', input);
    expect(result.state.actors[f.ally.id].resources.blessing).toBe(0);
    expect(result.state.actors[f.hero.id].resources.blessing).toBe(0);
    expect(motes(result.state)).toEqual(moteCells);
    input.actorIds['symphony-blessings'] = [f.hero.id]; // ambient input cannot alter the recorded event
    input.positions['mote-positions'][0] = { x: 9, y: 9 };
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
  });
  it('never greedily tops up: an unfunded holder keeps its blessings', () => {
    const f = fixture();
    f.state.actors[f.hero.id].resources.blessing = 4;
    const result = f.use('chanter:symphony', { actorIds: { 'symphony-blessings': [f.hero.id] }, positions: { 'mote-positions': [moteCells[0]] } });
    expect(result.state.actors[f.hero.id].resources.blessing).toBe(3);
    expect(motes(result.state)).toHaveLength(1);
  });
  it('an absent allocation is the explicit zero-unit decision, never an automatic spend', () => {
    const f = fixture();
    f.state.actors[f.hero.id].resources.blessing = 3;
    const result = f.use('chanter:symphony');
    expect(result.state.actors[f.hero.id].resources.blessing).toBe(3);
    expect(motes(result.state)).toHaveLength(0);
  });
  it('rejects over-capacity, ineligible and under-funded motes without consuming state', () => {
    const f = fixture();
    f.state.actors[f.hero.id].resources.blessing = 2;
    const before = structuredClone(f.state);
    expect(code(() => f.use('chanter:symphony', { actorIds: { 'symphony-blessings': [f.hero.id, f.hero.id, f.hero.id] } }))).toBe('choice.unit-capacity');
    expect(code(() => f.use('chanter:symphony', { actorIds: { 'symphony-blessings': [f.foe.id] } }))).toBe('choice.unit-ineligible');
    expect(code(() => f.use('chanter:symphony', { actorIds: { 'symphony-blessings': [f.hero.id, f.hero.id] }, positions: { 'mote-positions': [moteCells[0]] } }))).toBe('choice.position-count');
    expect(f.state).toEqual(before);
  });
  it('the mote count is exactly the recorded blessing total, not a fixed four', () => {
    const f = fixture();
    f.state.actors[f.hero.id].resources.blessing = 4;
    const two = f.use('chanter:symphony', { actorIds: { 'symphony-blessings': [f.hero.id, f.hero.id] }, positions: { 'mote-positions': [moteCells[0], moteCells[1]] } });
    expect(two.state.actors[f.hero.id].resources.blessing).toBe(2);
    expect(motes(two.state)).toHaveLength(2);
    // A third recorded position for a two-blessing allocation is malformed.
    expect(code(() => f.use('chanter:symphony', { actorIds: { 'symphony-blessings': [f.hero.id, f.hero.id] }, positions: { 'mote-positions': moteCells } }))).toBe('choice.position-count');
  });
});
