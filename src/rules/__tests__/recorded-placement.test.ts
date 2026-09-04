import '../automation/content/registry.js';
import { describe,expect,it } from 'vitest';
import { actorFromCharacter,applyEvents,createEncounter,createFoe,executeCommand } from '../encounter.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { resolveCapturedPositionListChoice } from '../automation/kernels/choice.js';
import { chooseEntityCreation } from '../automation/kernels/creation-choice.js';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { evaluatePositions } from '../automation/kernels/evaluate-query.js';
import { contextAfterMutations } from '../automation/kernels/execute-flow.js';
import { RuleProgramViolation } from '../automation/kernels/violations.js';
import type { RuleExecutionContext,RuleExecutionInput } from '../automation/primitives/types.js';
import type { Position } from '../types.js';
import { scriptedDice,startEncounterTo,validCharacter } from './fixtures.js';

// Source: ICON 1.5 pp.92/95/108 (range/free space/LoS), 149–150 (bombs),
// 169–170 (cloud/portal), 178 (landing/motes), 193 (shrine), 201 (Tarot/Astra),
// 212 (optional Blackstar terrain), 234–235 (geyser/difficult-terrain spout).
function fixture() {
  let state = createEncounter('Recorded placement');
  const hero = actorFromCharacter(validCharacter('Chooser'), { x: 4, y: 4 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Target', { x: 6, y: 4 });
  const ally = actorFromCharacter(validCharacter('Passenger'), { x: 4, y: 6 });
  for (const actor of [hero, foe, ally]) state = executeCommand(state, { type: 'ADD_ACTOR', actor }).state;
  state = startEncounterTo(state, hero.id);
  const use = (abilityId: string, input: RuleExecutionInput = {}, targets: string[] = [], dice: number[] = []) =>
    executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId, input, targetIds: targets }, scriptedDice(...dice));
  const context = (input: RuleExecutionInput = {}, sourceId = 'fixture:placement'): RuleExecutionContext => ({
    sourceId, actionId: 'default', timing: 'use', actorId: hero.id, state: encounterRuleState(state), encounterState: state, input, dice: scriptedDice(),
  });
  return { state, hero, foe, ally, use, context };
}
function code(run: () => unknown) {
  try { run(); return 'accepted'; } catch (error) {
    if (error instanceof RuleProgramViolation) return error.code;
    throw error;
  }
}

const ordinary = [
  ['stormbender:geyser', 'geyser-position', { x: 7, y: 6 }, 'geyser'],
  ['warden:underway', 'portal-position', { x: 5, y: 5 }, 'underway'],
  ['sealer:spirit-shrine', 'shrine-position', { x: 3, y: 4 }, 'shrine'],
] as const;
describe('recorded use-time entity placement', () => {
  it.each(ordinary)('%s preserves a non-first chosen cell and replays it', (ability, key, cell, type) => {
    const f = fixture();
    const input: { positions: Record<string, Position[]> } = { positions: { [key]: [{ ...cell }] } };
    const result = f.use(ability, input);
    expect(Object.values(result.state.entities).filter((entity) => entity.type === type).flatMap((entity) => entity.positions)).toEqual([cell]);
    input.positions[key][0] = { x: 0, y: 0 }; // ambient input cannot alter the event
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
  });
  it.each(ordinary)('%s rejects absent, extra, out-of-grid and occupied choices without consuming state', (ability, key, cell) => {
    const f = fixture(); const before = structuredClone(f.state);
    expect(code(() => f.use(ability))).toBe('choice.position-required');
    expect(code(() => f.use(ability, { positions: { [key]: [cell, { x: 3, y: 3 }] } }))).toBe('choice.position-count');
    for (const invalid of [{ x: -1, y: 4 }, { x: 4, y: 4 }, { x: 50, y: 50 }]) {
      expect(code(() => f.use(ability, { positions: { [key]: [invalid] } }))).toBe('choice.position-unavailable');
    }
    expect(f.state).toEqual(before);
  });
  it('requires a recorded choice even with exactly one creation candidate; never finds a fallback', () => {
    const f = fixture(); const cell = { x: 3, y: 3 };
    const region = { origin: cell, radius: 0, includeOrigin: true, space: { kind: 'any' as const } };
    const request = { ownerId: f.hero.id, entityType: 'geyser', count: 1, state: { height: 1 }, spatial: { origin: f.hero.position, originSize: 1, maxRange: 4 } };
    expect(code(() => chooseEntityCreation(f.context(), 'where', 'Creation', region, request))).toBe('choice.position-required');
    expect(chooseEntityCreation(f.context({ positions: { where: [cell] } }), 'where', 'Creation', region, request).positions).toEqual([cell]);
    f.state.grid.terrain.push({ position: cell, type: 'impassable', elevation: 0 });
    expect(code(() => chooseEntityCreation(f.context({ positions: { where: [cell] } }), 'where', 'Creation', region, request))).toBe('choice.position-unavailable');
  });
  it('rejects blocked creator LoS and preserves large-creator footprint range', () => {
    const f = fixture();
    f.state.actors[f.hero.id].size = 2;
    const input = { positions: { 'geyser-position': [{ x: 9, y: 5 }] } }; // distance 4 from footprint
    const result = f.use('stormbender:geyser', input);
    expect(Object.values(result.state.entities).some((e) => e.positions[0].x === 9)).toBe(true);
    for (let y = 0; y < f.state.grid.height; y++) f.state.grid.terrain.push({ position: { x: 7, y }, type: 'impassable', elevation: 0 });
    expect(code(() => f.use('stormbender:geyser', input))).toBe('choice.position-unavailable');
  });
  it('Spirit Shrine can stack on an object, then explicitly replace an adjacent shrine at a different cell', () => {
    const f = fixture();
    f.state.entities.base = { id: 'base', type: 'boulder', kind: 'object', ownerId: null, positions: [{ x: 3, y: 4 }], state: { height: 1 }, duration: null };
    const result = f.use('sealer:spirit-shrine', { positions: { 'shrine-position': [{ x: 3, y: 4 }] } });
    expect(Object.values(result.state.entities).filter((e) => e.type === 'shrine')).toHaveLength(1);
    // Use the resolver's own command with a fresh action budget, preserving its existing shrine.
    f.state.entities = result.state.entities;
    const replacement = f.use('sealer:spirit-shrine', { positions: { 'shrine-position': [{ x: 5, y: 5 }] } });
    expect(Object.values(replacement.state.entities).filter((e) => e.type === 'shrine').map((e) => e.positions)).toEqual([[{ x: 5, y: 5 }]]);
    expect(applyEvents(f.state, replacement.events)).toEqual(replacement.state);
  });
  it('Carnevale requires two distinct recorded cells, never pads or relocates a bomb', () => {
    const f = fixture(); const cells = [{ x: 3, y: 5 }, { x: 5, y: 5 }];
    expect(code(() => f.use('fool:carnevale'))).toBe('choice.position-required');
    expect(code(() => f.use('fool:carnevale', { positions: { 'bomb-positions': cells.slice(0, 1) } }))).toBe('choice.position-count');
    expect(code(() => f.use('fool:carnevale', { positions: { 'bomb-positions': [cells[0], cells[0]] } }))).toBe('choice.position-distinct');
    const result = f.use('fool:carnevale', { positions: { 'bomb-positions': cells } });
    expect(Object.values(result.state.entities).filter((e) => e.type === 'bomb').flatMap((e) => e.positions)).toEqual(cells);
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
    f.state.entities = result.state.entities;
    expect(code(() => f.use('fool:carnevale', { positions: { 'bomb-positions': cells } }))).toBe('choice.position-unavailable');
  });
  it('the bomb cap suppresses only creation; remaining capacity determines how many positions are needed', () => {
    const f = fixture();
    for (let i = 0; i < 6; i++) f.state.entities[`bomb:${i}`] = {
      id: `bomb:${i}`, type: 'bomb', ownerId: f.hero.id, kind: 'summon', positions: [{ x: i, y: 0 }], state: {}, duration: null,
    };
    const capped = f.use('fool:carnevale');
    expect(Object.values(capped.state.entities).filter((e) => e.type === 'bomb')).toHaveLength(6);
    expect(capped.state.actors[f.hero.id].ruleState['carnevale:armed']).toBe(true);
    expect(applyEvents(f.state, capped.events)).toEqual(capped.state);
    delete f.state.entities['bomb:5'];
    const cell = { x: 5, y: 5 };
    const result = f.use('fool:carnevale', { positions: { 'bomb-positions': [cell] } });
    expect(Object.values(result.state.entities).filter((e) => e.type === 'bomb')).toHaveLength(6);
    expect(Object.values(result.state.entities).some((e) => e.positions.some((p) => p.x === 5 && p.y === 5))).toBe(true);
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
  });
  it('Waterspout requires existing adjacent difficult terrain and never fabricates it', () => {
    const f = fixture(); const input = { positions: { 'waterspout-position': [{ x: 3, y: 4 }] } };
    expect(code(() => f.use('stormbender:waterspout', input))).toBe('choice.position-unavailable');
    f.state.grid.terrain.push({ position: { x: 3, y: 4 }, type: 'difficult', elevation: 0 }, { position: { x: 2, y: 4 }, type: 'difficult', elevation: 0 });
    expect(code(() => f.use('stormbender:waterspout', { positions: { 'waterspout-position': [{ x: 2, y: 4 }] } }))).toBe('choice.position-unavailable');
    const result = f.use('stormbender:waterspout', input);
    expect(Object.values(result.state.entities).find((e) => e.type === 'waterspout')?.positions).toEqual(input.positions['waterspout-position']);
    expect(result.state.terrainEffects).toEqual(f.state.terrainEffects);
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
  });
});

describe('recorded terrain subsets and regions', () => {
  it('Mist Strider records both clouds, measures each from the creator, and uses the small template', () => {
    const f = fixture(); f.state.actors[f.hero.id].ruleState['slow-turn'] = true;
    const input = { positions: { 'area-center': [{ x: 1, y: 4 }], 'charge-cloud': [{ x: 7, y: 4 }] } };
    expect(code(() => f.use('warden:mist-strider', { positions: { 'area-center': input.positions['area-center'] } }))).toBe('choice.position-required');
    const result = f.use('warden:mist-strider', input);
    const clouds = result.state.terrainEffects.filter((e) => e.terrain === 'mist-cloud');
    expect(clouds.map((e) => e.positions.length)).toEqual([5, 5]);
    expect(clouds[0].positions).toContainEqual({ x: 1, y: 4 });
    expect(clouds[1].positions).toContainEqual({ x: 7, y: 4 });
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
  });
  it('Tarot effect 3 requires exactly two spaces in the small blast, including occupied spaces', () => {
    const f = fixture(); const cells = [{ x: 6, y: 4 }, { x: 6, y: 5 }];
    expect(code(() => f.use('seer:chaos-tarot', {}, [f.foe.id], [3]))).toBe('choice.position-required');
    expect(code(() => f.use('seer:chaos-tarot', { positions: { 'chaos-tarot-terrain': [{ x: 7, y: 5 }, cells[0]] } }, [f.foe.id], [3]))).toBe('choice.position-unavailable');
    const result = f.use('seer:chaos-tarot', { positions: { 'chaos-tarot-terrain': cells } }, [f.foe.id], [3]);
    expect(result.state.terrainEffects.find((e) => e.terrain === 'difficult')?.positions).toEqual(cells);
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
  });
  it('Astra records terrain and the meteor cell; its adjacent damage follows the recorded meteor', () => {
    const f = fixture(); const input = { positions: { 'astra-terrain': [{ x: 6, y: 4 }, { x: 6, y: 5 }], 'meteor-position': [{ x: 5, y: 5 }] } };
    const result = f.use('seer:astra', input, [f.foe.id], [12, 4, 6]);
    expect(Object.values(result.state.entities).find((e) => e.type === 'meteor')?.positions).toEqual([{ x: 5, y: 5 }]);
    const event = result.events.find((e) => e.type === 'RULE_MUTATIONS_APPLIED');
    expect(event && event.type === 'RULE_MUTATIONS_APPLIED' && event.mutations.some((m) => m.kind === 'damage' && m.actorId === f.ally.id && m.amount === 2)).toBe(true);
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
  });
  it('Blackstar permits declining its up-to-three terrain and validates the large-blast subset', () => {
    const f = fixture(); f.state.round = 6; f.state.actors[f.hero.id].hp = 10;
    const declined = f.use('enochian:blackstar', {}, [f.foe.id], [12, 4, 4, 4]);
    expect(declined.state.terrainEffects.some((e) => e.terrain === 'difficult')).toBe(false);
    const cells = [{ x: 6, y: 4 }, { x: 6, y: 6 }];
    const result = f.use('enochian:blackstar', { positions: { 'blackstar-terrain': cells } }, [f.foe.id], [12, 4, 4, 4]);
    expect(result.state.terrainEffects.find((e) => e.terrain === 'difficult')?.positions).toEqual(cells);
    expect(code(() => f.use('enochian:blackstar', { positions: { 'blackstar-terrain': [{ x: 8, y: 6 }] } }, [f.foe.id], [12, 4, 4, 4]))).toBe('choice.position-unavailable');
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
  });
  it('Symphony requires separated recorded motes and creates only the number funded by blessings', () => {
    const f = fixture(); f.state.actors[f.hero.id].resources.blessing = 2;
    expect(code(() => f.use('chanter:symphony'))).toBe('choice.position-required');
    expect(code(() => f.use('chanter:symphony', { positions: { 'mote-positions': [{ x: 1, y: 1 }, { x: 2, y: 1 }] } }))).toBe('choice.position-separation');
    const cells = [{ x: 1, y: 1 }, { x: 8, y: 8 }];
    const result = f.use('chanter:symphony', { positions: { 'mote-positions': cells } });
    expect(result.state.terrainEffects.filter((e) => e.terrain === 'symphony-mote').flatMap((e) => e.positions)).toEqual(cells);
    expect(result.state.actors[f.hero.id].resources.blessing).toBe(0);
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
    f.state.terrainEffects = result.state.terrainEffects;
    expect(code(() => f.use('chanter:symphony', { positions: { 'mote-positions': [{ x: 2, y: 1 }, { x: 9, y: 9 }] } }))).toBe('choice.position-unavailable');
  });
});

describe('placement after preceding mutations', () => {
  it('Strongarm requires a recorded rotation and Comeback landing before the spin', () => {
    const f = fixture();
    f.state.actors[f.hero.id].talents = { 'knave:strongarm': 1 };
    f.state.actors[f.hero.id].hp = 10;
    expect(code(() => f.use('knave:strongarm', { options: { direction: 'clockwise' } }, [f.foe.id]))).toBe('choice.position-required');
    const positions = { 'strongarm-adjacency': [{ x: 3, y: 4 }] };
    expect(code(() => f.use('knave:strongarm', { positions }, [f.foe.id]))).toBe('choice.option-required');
    expect(code(() => f.use('knave:strongarm', { positions, options: { direction: 'sideways' } }, [f.foe.id]))).toBe('choice.option-invalid');
    for (const direction of ['clockwise', 'counter-clockwise']) {
      const result = f.use('knave:strongarm', { positions, options: { direction } }, [f.foe.id]);
      const event = result.events.find((e) => e.type === 'RULE_MUTATIONS_APPLIED');
      expect(event && event.type === 'RULE_MUTATIONS_APPLIED' && event.mutations.filter((m) => m.kind === 'move')[1]).toMatchObject({ movement: 'place', positions: [{ x: 3, y: 4 }] });
      expect(applyEvents(f.state, result.events)).toEqual(result.state);
    }
  });
  it('Dervish records each landing against the actual moved source and earlier passenger placement', () => {
    const f = fixture();
    const other = actorFromCharacter(validCharacter('Second passenger'), { x: 3, y: 6 });
    f.state.actors[other.id] = other;
    f.state.actors[f.hero.id].ruleState['slow-turn'] = true;
    const input = { positions: { [`dervish-landing:${f.ally.id}`]: [{ x: 5, y: 5 }], [`dervish-landing:${other.id}`]: [{ x: 6, y: 5 }] } };
    const result = f.use('chanter:dervish', input, [f.ally.id, other.id]);
    expect(result.state.actors[f.ally.id].position).toEqual({ x: 5, y: 5 });
    expect(result.state.actors[other.id].position).toEqual({ x: 6, y: 5 });
    expect(applyEvents(f.state, result.events)).toEqual(result.state);
    input.positions[`dervish-landing:${other.id}`] = [{ x: 5, y: 5 }];
    const before = structuredClone(f.state);
    expect(code(() => f.use('chanter:dervish', input, [f.ally.id, other.id]))).toBe('choice.position-unavailable');
    expect(f.state).toEqual(before); // no passenger stranded by the failed choice
  });
  it('the U11 snapshot leaves the original state untouched and U3 checks the entire passenger footprint', () => {
    const f = fixture(); f.state.actors[f.ally.id].size = 2;
    const context = contextAfterMutations(f.context(), [{ kind: 'move', sourceId: 'fixture', sourceActorId: f.hero.id, actorId: f.ally.id, movement: 'remove', positions: [], distance: null, direction: null, phasing: false }]);
    expect(f.state.actors[f.ally.id].onBattlefield).toBe(true);
    const candidates = evaluatePositions({ origin: f.hero.position, radius: 1, includeOrigin: true, space: { kind: 'unoccupied', excludeActorId: f.ally.id }, placementActorId: f.ally.id }, context);
    expect(candidates).not.toContainEqual({ x: 3, y: 3 }); // anchor free, rest overlaps hero
    expect(candidates).toContainEqual({ x: 2, y: 3 }); // only the far footprint edge is adjacent
  });
});

describe('U4 position-list contract', () => {
  it('is source-independent, preserves recorded order, and rejects fractional/NaN/duplicate coordinates', () => {
    const f = fixture(); const candidates: Position[] = [{ x: 2, y: 2 }, { x: 3, y: 3 }];
    const choice = { key: 'where', label: 'Two cells', required: true, minimum: 2, maximum: 2 };
    for (const sourceId of ['fixture:a', 'different:unregistered']) {
      const context = f.context({ positions: { where: [...candidates].reverse() } }, sourceId);
      expect(resolveCapturedPositionListChoice(choice, candidates, context)).toEqual([...candidates].reverse());
      expect(resolveCapturedPositionListChoice(choice, [...candidates].reverse(), context)).toEqual([...candidates].reverse());
    }
    for (const x of [1.5, NaN, Infinity]) expect(code(() => resolveCapturedPositionListChoice(choice, candidates, f.context({ positions: { where: [{ x, y: 2 }, candidates[1]] } })))).toBe('choice.position-invalid');
    expect(code(() => resolveCapturedPositionListChoice(choice, candidates, f.context({ positions: { where: [candidates[0], candidates[0]] } })))).toBe('choice.position-distinct');
  });
});
