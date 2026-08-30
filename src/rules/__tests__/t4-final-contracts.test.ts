/**
 * t4-final-contracts.test.ts — Phase T4 FINAL contract fixes (command/event
 * level), proving the four contracts are TRUE IN THE IMPLEMENTATION:
 *
 *   1. Resolution identity is a durable monotonic `resolutionSerial` on the
 *      encounter (independent of the bounded eventLog, replay-safe, survives
 *      save/load migration) — resolution ids never repeat after truncation.
 *   2. Damage is determined ONCE at the command boundary (stamped on the
 *      mutation); U10 `damage-applied` facts and the reducer both consume the
 *      SAME recorded outcome; a later no-op mutation records no false fact;
 *      replay applies the recorded result without a second semantic decision.
 *   3. U16 `trigger-resolved` markers ride the durable RULE_MUTATIONS_APPLIED
 *      facts (byte-identical across replay); one resolution + one triggered
 *      step = one marker; a second resolution = a distinct marker.
 *   4. U10 effect facts carry the canonical LIVE instance id the reducer
 *      creates/removes (`effectInstanceId`); removals address the specific
 *      instance; the end-to-end effect-still-exists chain is exact.
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { evaluatePredicate } from '../automation/kernels/runtime.js';
import type { Fact } from '../automation/primitives/facts.js';
import { RULE_PROGRAM_SCHEMA_VERSION, type RuleExecutionContext, type RuleMutation, type RuleProgram } from '../automation/primitives/types.js';
import {
  actorFromCharacter,
  applyEvents,
  createEncounter,
  createFoe,
  executeCommand,
  executeRuleProgramWithReactiveTriggers,
  MAX_ENCOUNTER_EVENT_LOG,
  migrateEncounter,
  replayEncounter,
} from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState, Position } from '../types.js';
import { endTurnTo, scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

type RMA = Extract<EncounterEvent, { type: 'RULE_MUTATIONS_APPLIED' }>;

/** The recorded effect fact of a resolution, narrowed to the effect member. */
function effectFactOf(facts: readonly Fact[] | undefined, operation: 'apply' | 'remove'): Extract<Fact, { kind: 'effect' }> | undefined {
  const fact = facts?.find((candidate) => candidate.kind === 'effect' && candidate.operation === operation);
  return fact !== undefined && fact.kind === 'effect' ? fact : undefined;
}

function startedEncounter(): { state: EncounterState; hero: EncounterActor; foe: EncounterActor } {
  let state = createEncounter('T4 final contracts');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  const foe = createFoe('Relict', { x: 3, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero: state.actors[hero.id], foe: state.actors[foe.id] };
}

function contextOf(state: EncounterState, actorId: string, sourceId: string, targetIds: string[]): RuleExecutionContext {
  return {
    state: encounterRuleState(state),
    actorId,
    sourceId,
    actionId: 'default',
    timing: 'use',
    input: { actorIds: { target: targetIds } },
    dice: scriptedDice(),
    triggers: new Set(),
  };
}

function programWith(steps: RuleProgram['actions'][number]['steps']): RuleProgram {
  return {
    schemaVersion: RULE_PROGRAM_SCHEMA_VERSION,
    rulesVersion: '1.5',
    id: 'test:t4-final',
    sourceId: 'test:t4-final',
    source: { page: 1, sectionId: 't4' },
    name: 'T4 final fixture',
    classification: 'encounter',
    dependencies: [],
    actions: [{ id: 'default', name: 'T4', timing: 'use', costs: [], tags: [], range: null, area: null, choices: [], steps }],
  };
}

function rmaEvent(
  state: EncounterState,
  result: ReturnType<typeof executeRuleProgramWithReactiveTriggers>,
  sourceId: string,
  actorId: string,
): RMA {
  return {
    type: 'RULE_MUTATIONS_APPLIED',
    actorId,
    sourceId,
    actionId: 'default',
    timing: 'use',
    tags: [],
    mutations: result.mutations,
    resolutionFacts: result.resolutionFacts,
    facts: result.facts,
    resolutionId: result.resolutionId,
  };
}

// ── 1. Durable monotonic resolution identity ────────────────────────────────
describe('T4 final — Fix 1: monotonic durable resolution identity', () => {
  /** A benign RULE_MUTATIONS_APPLIED noise event that advances the durable
   * resolution serial (and is eventually truncated from the bounded log). */
  function noiseEvent(actorId: string): RMA {
    return {
      type: 'RULE_MUTATIONS_APPLIED', actorId, sourceId: 'fixture:noise', actionId: 'default',
      timing: 'use', tags: [], mutations: [],
    };
  }

  it('resolution ids stay unique past MAX_ENCOUNTER_EVENT_LOG truncation (never array-length derived)', () => {
    const { state, hero, foe } = startedEncounter();
    state.actors[hero.id].traitIds.push('vagabond:trait:prowl');
    const beyond = MAX_ENCOUNTER_EVENT_LOG + 10;
    const noise: EncounterEvent[] = Array.from({ length: beyond }, () => noiseEvent(hero.id));
    const saturated = applyEvents(state, noise);
    // The durable serial advanced past the log bound; the log itself truncated.
    expect(saturated.resolutionSerial).toBe(beyond);
    expect(saturated.eventLog).toHaveLength(MAX_ENCOUNTER_EVENT_LOG);
    const prowl = (current: EncounterState) => executeCommand(current, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'vagabond:trait:prowl', actionId: 'default', timing: 'use', input: {},
    });
    // The next resolution id derives from the DURABLE serial, not the log.
    const first = prowl(saturated);
    const firstRma = first.events.find((event): event is RMA => event.type === 'RULE_MUTATIONS_APPLIED')!;
    expect(firstRma.resolutionId).toBe(`res:vagabond:trait:prowl:${beyond + 1}`);
    // A second, SEPARATE use of the same source (after the turn rotates and
    // the once-per-turn gate clears) never collides with the first, even
    // though the bounded log has long since truncated the history.
    const rotated = endTurnTo(endTurnTo(first.state, foe.id), hero.id);
    const second = prowl(rotated);
    const secondRma = second.events.find((event): event is RMA => event.type === 'RULE_MUTATIONS_APPLIED')!;
    expect(secondRma.resolutionId).toBe(`res:vagabond:trait:prowl:${beyond + 2}`);
    expect(secondRma.resolutionId).not.toBe(firstRma.resolutionId);
    // Replay of the recorded events reproduces the identical serials.
    expect(replayEncounter(saturated, [firstRma]).resolutionSerial).toBe(beyond + 1);
  });

  it('save/load migration preserves the next monotonic resolution identity', () => {
    const { state, hero } = startedEncounter();
    state.actors[hero.id].traitIds.push('vagabond:trait:prowl');
    const saturated = applyEvents(state, [noiseEvent(hero.id), noiseEvent(hero.id), noiseEvent(hero.id)]);
    expect(saturated.resolutionSerial).toBe(3);
    // Full checkpoint round-trip: the durable serial survives save/load.
    const loaded = migrateEncounter(JSON.parse(JSON.stringify(saturated)));
    expect(loaded.resolutionSerial).toBe(3);
    const next = executeCommand(loaded, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'vagabond:trait:prowl', actionId: 'default', timing: 'use', input: {},
    });
    const nextRma = next.events.find((event): event is RMA => event.type === 'RULE_MUTATIONS_APPLIED')!;
    expect(nextRma.resolutionId).toBe('res:vagabond:trait:prowl:4');
  });

  it('legacy checkpoints migrate deterministically from their recorded history', () => {
    const { state, hero } = startedEncounter();
    state.actors[hero.id].traitIds.push('vagabond:trait:prowl');
    const withHistory = applyEvents(state, [noiseEvent(hero.id), noiseEvent(hero.id)]);
    const legacy = JSON.parse(JSON.stringify(withHistory)) as EncounterState;
    delete (legacy as Partial<EncounterState>).resolutionSerial;
    const migrated = migrateEncounter(legacy);
    // Derived from the recorded RULE_MUTATIONS_APPLIED count (the historical
    // derivation), so the next serial continues exactly where it left off.
    expect(migrated.resolutionSerial).toBe(2);
    const next = executeCommand(migrated, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'vagabond:trait:prowl', actionId: 'default', timing: 'use', input: {},
    });
    const nextRma = next.events.find((event): event is RMA => event.type === 'RULE_MUTATIONS_APPLIED')!;
    expect(nextRma.resolutionId).toBe('res:vagabond:trait:prowl:3');
  });
});

// ── 2. Single determined-damage handoff ─────────────────────────────────────
describe('T4 final — Fix 2: damage determined once, recorded, applied exactly', () => {
  function damageSteps(amounts: number[]): RuleProgram['actions'][number]['steps'] {
    return amounts.map((amount, index) => ({
      id: `strike-${index}`,
      timing: 'use' as const,
      effects: [
        { kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'constant', value: amount }, damageType: 'normal', delivery: 'hit', ignoreCover: true },
      ],
    }));
  }

  it('determination happens once: the stamped amount equals the fact amount AND the reducer-applied vitals delta', () => {
    const { state, hero, foe } = startedEncounter();
    state.actors[foe.id].armor = 3; // p.93 armor reduces normal damage
    const before = state.actors[foe.id].hp;
    const result = executeRuleProgramWithReactiveTriggers(programWith(damageSteps([5])), contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:damage:1');
    const damageMutation = result.mutations.find((mutation): mutation is Extract<RuleMutation, { kind: 'damage' }> => mutation.kind === 'damage')!;
    // The command boundary stamped the single determination.
    expect(damageMutation.determined).toEqual({ amount: 2 });
    const fact = result.facts!.find((candidate) => candidate.kind === 'damage-applied');
    expect(fact).toMatchObject({ recipientId: foe.id, amount: 2 });
    const event = rmaEvent(state, result, 'test:t4-final', hero.id);
    const applied = applyEvents(state, [event]);
    // The reducer consumed the recorded amount — U10 and the applied vitals
    // agree exactly.
    expect(applied.actors[foe.id].hp).toBe(before - 2);
    // Replay applies the same recorded result without re-deciding.
    expect(replayEncounter(state, [event]).actors[foe.id].hp).toBe(before - 2);
  });

  it('the reducer consumes the recorded outcome and does NOT invoke a second semantic decision', () => {
    const { state, hero, foe } = startedEncounter();
    state.actors[foe.id].armor = 3;
    const before = state.actors[foe.id].hp;
    // A deliberately DIVERGENT record: the raw amount is 100, the recorded
    // determination is 7. If the reducer re-determined, armor would reduce
    // 100 → 97; consuming the record applies exactly 7.
    const stamped: Extract<RuleMutation, { kind: 'damage' }> = {
      kind: 'damage', sourceId: 'fixture:stamped', sourceActorId: hero.id, actorId: foe.id,
      amount: 100, damageType: 'normal', instance: 0, delivery: 'hit', ignoreCover: true, determined: { amount: 7 },
    };
    const event: RMA = {
      type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'fixture:stamped', actionId: 'default',
      timing: 'use', tags: [], mutations: [stamped],
    };
    const applied = applyEvents(state, [event]);
    expect(applied.actors[foe.id].hp).toBe(before - 7);
  });

  it('first damage defeats the target; the second queued damage records no false applied fact', () => {
    const { state, hero, foe } = startedEncounter();
    state.actors[foe.id].hp = 5;
    state.actors[foe.id].vigor = 0;
    const result = executeRuleProgramWithReactiveTriggers(programWith(damageSteps([10, 10])), contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:defeat:1');
    const [first, second] = result.mutations.filter((mutation): mutation is Extract<RuleMutation, { kind: 'damage' }> => mutation.kind === 'damage');
    expect(first!.determined!.amount).toBe(10);
    // The SECOND damage no-ops: the target was defeated by the first, so the
    // sequential simulation records 0 — U10 never claims a false application.
    expect(second!.determined!.amount).toBe(0);
    const facts = result.facts!.filter((candidate) => candidate.kind === 'damage-applied');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ recipientId: foe.id, amount: 10 });
    const applied = applyEvents(state, [rmaEvent(state, result, 'test:t4-final', hero.id)]);
    expect(applied.actors[foe.id].defeated).toBe(true);
  });

  it('sequential damage reflects sequential state: an earlier mutation changes the second determination', () => {
    const { state, hero, foe } = startedEncounter();
    const before = state.actors[foe.id].hp;
    // Step 1 applies Vulnerable to the target; step 2 deals 10 normal damage.
    // Vulnerable adds +1 to the incoming instance (p.93) — the SECOND damage's
    // determination must see the FIRST mutation's effect.
    const program = programWith([
      { id: 'mark-vulnerable', timing: 'use', effects: [
        { kind: 'condition', target: { kind: 'input', key: 'target' }, conditionId: 'vulnerable', operation: 'apply', potency: 'normal' },
      ] },
      ...damageSteps([10]),
    ]);
    const result = executeRuleProgramWithReactiveTriggers(program, contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:seq:1');
    const damage = result.mutations.find((mutation): mutation is Extract<RuleMutation, { kind: 'damage' }> => mutation.kind === 'damage')!;
    // Determined against the POST-vulnerable state: 10 + 1 (never 10).
    expect(damage.determined).toEqual({ amount: 11 });
    const fact = result.facts!.find((candidate) => candidate.kind === 'damage-applied')!;
    expect(fact).toMatchObject({ amount: 11 });
    const applied = applyEvents(state, [rmaEvent(state, result, 'test:t4-final', hero.id)]);
    expect(applied.actors[foe.id].hp).toBe(before - 11);
    expect(encounterRuleState(applied).actors[foe.id].conditions.has('vulnerable')).toBe(true);
  });
});

// ── 3. Durable U16 trigger-resolved markers ─────────────────────────────────
describe('T4 final — Fix 3: trigger-resolved markers persist on the event', () => {
  function collideProgram(): RuleProgram {
    return programWith([
      { id: 'shove', timing: 'use', effects: [
        { kind: 'move', target: { kind: 'input', key: 'target' }, movement: 'shove', distance: { kind: 'constant', value: 2 } },
      ] },
      { id: 'on-collide', timing: 'use', trigger: 'collide', effects: [
        { kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 1 } },
      ] },
    ]);
  }

  function collideEncounter(terrain: Position[] = []): { state: EncounterState; hero: EncounterActor; foe: EncounterActor } {
    const { state, hero, foe } = startedEncounter();
    for (const position of terrain) state.grid.terrain.push({ position, type: 'impassable', elevation: 0 });
    return { state, hero, foe };
  }

  it('the U16 marker is persisted on RULE_MUTATIONS_APPLIED facts and replays byte-identically', () => {
    const { state, hero, foe } = collideEncounter([{ x: 4, y: 1 }]);
    const result = executeRuleProgramWithReactiveTriggers(collideProgram(), contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:marker:1');
    const markers = result.facts!.filter((fact) => fact.kind === 'trigger-resolved');
    expect(markers).toHaveLength(1);
    const marker = markers[0]!;
    expect(marker).toMatchObject({ sourceId: 'test:t4-final', ownerId: hero.id, trigger: 'collide' });
    const event = rmaEvent(state, result, 'test:t4-final', hero.id);
    const markerJson = JSON.stringify(markers);
    // The applied event carries the SAME durable marker list…
    const applied = applyEvents(state, [event]);
    const appliedRma = applied.eventLog.find((candidate): candidate is RMA => candidate.type === 'RULE_MUTATIONS_APPLIED')!;
    expect(JSON.stringify(appliedRma.facts!.filter((fact) => fact.kind === 'trigger-resolved'))).toBe(markerJson);
    // …and replay reproduces the identical marker identities.
    const replay = replayEncounter(state, [event]);
    expect(JSON.stringify((replay.eventLog.find((candidate): candidate is RMA => candidate.type === 'RULE_MUTATIONS_APPLIED') as RMA).facts!.filter((fact) => fact.kind === 'trigger-resolved'))).toBe(markerJson);
  });

  it('one resolution with multiple Collides has ONE Collide marker', () => {
    const rows = [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }];
    let state = createEncounter('multi-collide-final');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    const foes: EncounterActor[] = [];
    for (const position of rows) {
      const foe = createFoe(`Relict${position.y}`, position);
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
      foes.push(state.actors[foe.id]);
    }
    state = startEncounterTo(state, hero.id);
    state.grid.terrain.push({ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 });
    const program = programWith([
      { id: 'shove', timing: 'use', effects: [
        { kind: 'move', target: { kind: 'input', key: 'target' }, movement: 'shove', distance: { kind: 'constant', value: 1 } },
      ] },
      { id: 'on-collide', timing: 'use', trigger: 'collide', effects: [
        { kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 1 } },
      ] },
    ]);
    const result = executeRuleProgramWithReactiveTriggers(program, contextOf(state, hero.id, 'test:t4-final', foes.map((foe) => foe.id)), {}, state, 'res:multi:1');
    const markers = result.facts!.filter((fact) => fact.kind === 'trigger-resolved' && fact.trigger === 'collide');
    // Three Collide routing facts → ONE triggered-step resolution (once-per-ability).
    expect(markers).toHaveLength(1);
    // And the step executed exactly once.
    expect(result.selectedSteps.filter((step) => step.id === 'on-collide')).toHaveLength(1);
  });

  it('a second resolution gets a DISTINCT Collide marker', () => {
    const { state, hero, foe } = collideEncounter([{ x: 4, y: 1 }]);
    const program = collideProgram();
    const one = executeRuleProgramWithReactiveTriggers(program, contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:marker:1');
    const two = executeRuleProgramWithReactiveTriggers(program, contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:marker:2');
    const oneMarker = one.facts!.find((fact) => fact.kind === 'trigger-resolved')!;
    const twoMarker = two.facts!.find((fact) => fact.kind === 'trigger-resolved')!;
    expect(oneMarker.instanceId).not.toBe(twoMarker.instanceId);
    expect(oneMarker.instanceId).toContain('"res:marker:1"');
    expect(twoMarker.instanceId).toContain('"res:marker:2"');
  });
});

// ── 4. Canonical effect-instance identity ───────────────────────────────────
describe('T4 final — Fix 4: U10 effect facts carry the reducer\u2019s durable instance id', () => {
  function persistentProgram(operation: 'add' | 'remove'): RuleProgram {
    return programWith([{
      id: `persistent-${operation}`, timing: 'use', effects: [
        { kind: 'persistent', target: { kind: 'input', key: 'target' }, operation, effectId: 'aura', duration: { kind: 'combat' }, modifiers: [], triggers: [], state: {} },
      ],
    }]);
  }

  it('the application fact carries the EXACT live instance id the reducer creates', () => {
    const { state, hero, foe } = startedEncounter();
    const result = executeRuleProgramWithReactiveTriggers(persistentProgram('add'), contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:effect:1');
    const applyFact = effectFactOf(result.facts, 'apply')!;
    expect(applyFact.effectInstanceId).toBeDefined();
    const event = rmaEvent(state, result, 'test:t4-final', hero.id);
    const applied = applyEvents(state, [event]);
    const live = applied.actors[foe.id].activeEffects;
    expect(live).toHaveLength(1);
    // The live instance id IS the recorded effectInstanceId — one identity.
    expect(live[0]!.id).toBe(applyFact.effectInstanceId);
  });

  it('a removal event names that same id; the removal fact records it and the reducer removes exactly it', () => {
    const { state, hero, foe } = startedEncounter();
    const applyResult = executeRuleProgramWithReactiveTriggers(persistentProgram('add'), contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:effect:1');
    const applyId = effectFactOf(applyResult.facts, 'apply')!.effectInstanceId!;
    const withInstance = applyEvents(state, [rmaEvent(state, applyResult, 'test:t4-final', hero.id)]);
    // The removal is resolved against the LIVE instance: the command boundary
    // stamps the SAME id and the removal fact records it.
    const removeResult = executeRuleProgramWithReactiveTriggers(persistentProgram('remove'), contextOf(withInstance, hero.id, 'test:t4-final', [foe.id]), {}, withInstance, 'res:effect:2');
    const removeMutation = removeResult.mutations.find((mutation): mutation is Extract<RuleMutation, { kind: 'persistent' }> => mutation.kind === 'persistent')!;
    expect(removeMutation.instanceId).toBe(applyId);
    const removeFact = effectFactOf(removeResult.facts, 'remove')!;
    expect(removeFact.effectInstanceId).toBe(applyId);
    const removed = applyEvents(withInstance, [rmaEvent(withInstance, removeResult, 'test:t4-final', hero.id)]);
    expect(removed.actors[foe.id].activeEffects).toHaveLength(0);
  });

  it('removing persistent instance A leaves coexisting instance B alive', () => {
    const { state, hero, foe } = startedEncounter();
    // Instance A: applied at revision r.
    const applyA = executeRuleProgramWithReactiveTriggers(persistentProgram('add'), contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:effect:1');
    const idA = effectFactOf(applyA.facts, 'apply')!.effectInstanceId!;
    const withA = applyEvents(state, [rmaEvent(state, applyA, 'test:t4-final', hero.id)]);
    // Instance B: a second, coexisting instance of the SAME effect/source/owner.
    const applyB = executeRuleProgramWithReactiveTriggers(persistentProgram('add'), contextOf(withA, hero.id, 'test:t4-final', [foe.id]), {}, withA, 'res:effect:2');
    const idB = effectFactOf(applyB.facts, 'apply')!.effectInstanceId!;
    const withAB = applyEvents(withA, [rmaEvent(withA, applyB, 'test:t4-final', hero.id)]);
    expect(withAB.actors[foe.id].activeEffects.map((effect) => effect.id).sort()).toEqual([idA, idB].sort());
    // Remove instance A BY ITS IDENTITY — B stays.
    const removal: RMA = {
      type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'test:t4-final', actionId: 'default',
      timing: 'use', tags: [], mutations: [{
        kind: 'persistent', sourceId: 'test:t4-final', ownerId: hero.id, operation: 'remove', actorId: foe.id,
        effectId: 'aura', duration: { kind: 'combat' }, modifiers: [], triggers: [], state: {}, instanceId: idA,
      }],
    };
    const removed = applyEvents(withAB, [removal]);
    expect(removed.actors[foe.id].activeEffects.map((effect) => effect.id)).toEqual([idB]);
  });

  it('owner-A mark removal leaves owner-B same-named mark intact', () => {
    let state = createEncounter('mark owners');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const ally = actorFromCharacter(validCharacter('Bryn'), { x: 1, y: 3 });
    const foe = createFoe('Relict', { x: 3, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const markProgram = (ownerId: string): RuleProgram => programWith([{
      id: 'mark', timing: 'use', effects: [
        { kind: 'mark', target: { kind: 'input', key: 'target' }, operation: 'apply', markId: 'incubus', state: {} },
      ],
    }]);
    // Owner A places its mark.
    const markA = executeRuleProgramWithReactiveTriggers(markProgram(hero.id), contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:mark:1');
    const idA = effectFactOf(markA.facts, 'apply')!.effectInstanceId!;
    const withA = applyEvents(state, [rmaEvent(state, markA, 'test:t4-final', hero.id)]);
    // Owner B places the SAME-named mark (owner B replaces only B's own).
    const markB = executeRuleProgramWithReactiveTriggers(markProgram(ally.id), contextOf(withA, ally.id, 'test:t4-final', [foe.id]), {}, withA, 'res:mark:2');
    const idB = effectFactOf(markB.facts, 'apply')!.effectInstanceId!;
    const withAB = applyEvents(withA, [rmaEvent(withA, markB, 'test:t4-final', ally.id)]);
    expect(withAB.actors[foe.id].marks.map((mark) => mark.id).sort()).toEqual([idA, idB].sort());
    // Owner A removes its OWN mark by its identity — owner B's identical mark survives.
    const removal: RMA = {
      type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'test:t4-final', actionId: 'default',
      timing: 'use', tags: [], mutations: [{
        kind: 'mark', sourceId: 'test:t4-final', ownerId: hero.id, operation: 'remove', actorId: foe.id,
        markId: 'incubus', state: {}, instanceId: idA,
      }],
    };
    const removed = applyEvents(withAB, [removal]);
    expect(removed.actors[foe.id].marks.map((mark) => mark.id)).toEqual([idB]);
  });

  it('end-to-end effect-still-exists: apply fact → live exact instance → true → removal → false', () => {
    const { state, hero, foe } = startedEncounter();
    const applyResult = executeRuleProgramWithReactiveTriggers(persistentProgram('add'), contextOf(state, hero.id, 'test:t4-final', [foe.id]), {}, state, 'res:e2e:1');
    const applyFact = effectFactOf(applyResult.facts, 'apply')!;
    const instanceId = applyFact.effectInstanceId!;
    const withInstance = applyEvents(state, [rmaEvent(state, applyResult, 'test:t4-final', hero.id)]);
    // The live instance is the exact recorded instance.
    expect(withInstance.actors[foe.id].activeEffects[0]!.id).toBe(instanceId);
    const read = (target: EncounterState): boolean => evaluatePredicate(
      { kind: 'effect-still-exists', target: { kind: 'self' }, effectKind: 'persistent', effectId: 'aura', sourceId: 'test:t4-final', instanceId },
      {
        state: encounterRuleState(target), actorId: foe.id, sourceId: 'test:t4-final', actionId: 'default',
        timing: 'use', input: {}, dice: scriptedDice(),
      } as RuleExecutionContext,
    );
    // Application fact → the EXACT live instance exists.
    expect(read(withInstance)).toBe(true);
    // Removal event naming the SAME instance → the exact read turns false.
    const removal: RMA = {
      type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'test:t4-final', actionId: 'default',
      timing: 'use', tags: [], mutations: [{
        kind: 'persistent', sourceId: 'test:t4-final', ownerId: hero.id, operation: 'remove', actorId: foe.id,
        effectId: 'aura', duration: { kind: 'combat' }, modifiers: [], triggers: [], state: {}, instanceId,
      }],
    };
    const removed = applyEvents(withInstance, [removal]);
    expect(read(removed)).toBe(false);
  });
});
