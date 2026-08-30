/**
 * t5a-u11-flow.test.ts — Phase T5a (U11 core FLOW / SEQUENCE) acceptance
 * proofs, command/event level.
 *
 * ICON p.85 ("Effects resolve in the order they are listed") and p.107 §4:
 * every operation in an ordinary ordered ability sequence observes the
 * ACTUAL INTERMEDIATE STATE produced by the preceding operations. These
 * tests prove the flow planner (`kernels/execute-flow.ts`) executes against
 * a PURE SIMULATED intermediate encounter state — NOT against the original
 * pre-state — while preserving command/event purity and deterministic
 * replay. Every core fixture is ADVERSARIAL: evaluating the same steps
 * against the original pre-state would produce a different result, so the
 * tests prove the new authority rather than merely exercising it.
 *
 * Covered acceptance proofs:
 *   1. rush → damage: the damage target query observes the post-rush position.
 *   2. remove → place: the vacated-space read observes the removal.
 *   3. teleport → adjacency: the adjacency test observes the teleported position.
 *   4. repeat: iteration N+1 sees the state iteration N produced.
 *   5. for-each over an already-derived CandidateSet executes deterministically.
 *   6. invoke reuses the same flow authority (shared simulation).
 *   7. bind (U1) propagation reaches later value reads; emit-fact (U10) rides
 *      the event's durable facts.
 *   8. an invalid intermediate operation rejects the whole command before
 *      durable commit (no partial mutation list, live state untouched).
 *   9. zero-repeat and empty-for-each are clean no-ops.
 *  10. U15 atomic-group semantics: a declared simultaneous swap applies every
 *      leg (never a sequential leg-by-leg artifact) and a denied group skips
 *      every leg — the simulation mirrors the reducer exactly.
 *  11. replay of an ordered multi-step ability (with a `spatialBatchId` swap
 *      and a dice-consuming damage roll) is byte-identical and performs no
 *      new decisions/RNG.
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import * as encounterAdapter from '../automation/kernels/encounter-adapter.js';
import { evaluateActorQuery } from '../automation/kernels/evaluate-query.js';
import { executeFlow, type FlowNode } from '../automation/kernels/execute-flow.js';
import { executeRuleProgram, RuleProgramViolation } from '../automation/kernels/runtime.js';
import { swapMutations } from '../automation/primitives/job-kit.js';
import { capturedActor, capturedPosition, liveRef } from '../automation/primitives/reference.js';
import { RULE_PROGRAM_SCHEMA_VERSION, type RuleExecutionContext, type RuleExecutionResult, type RuleMutation, type RuleProgram, type RuleResolverRegistry } from '../automation/primitives/types.js';
import {
  actorFromCharacter,
  applyEvents,
  createEncounter,
  createFoe,
  executeRuleProgramWithReactiveTriggers,
  replayEncounter,
} from '../encounter.js';
import type { EncounterEvent, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

type RMA = Extract<EncounterEvent, { type: 'RULE_MUTATIONS_APPLIED' }>;

const SOURCE = 'test:t5a-u11-flow';

function startedEncounter(): { state: EncounterState; heroId: string; foes: Record<string, string> } {
  let state = createEncounter('T5a U11 flow');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  state = applyEvents(state, [{ type: 'ACTOR_ADDED', actor: hero }]);
  const foes: Record<string, string> = {};
  for (const [label, position] of Object.entries({ foeA: { x: 3, y: 1 }, foeB: { x: 7, y: 1 } })) {
    const foe = createFoe(label, position);
    foes[label] = foe.id;
    state = applyEvents(state, [{ type: 'ACTOR_ADDED', actor: foe }]);
  }
  state = startEncounterTo(state, hero.id);
  return { state, heroId: hero.id, foes };
}

function programWith(steps: RuleProgram['actions'][number]['steps'], options: { resolverId?: string; tags?: string[] } = {}): RuleProgram {
  return {
    schemaVersion: RULE_PROGRAM_SCHEMA_VERSION,
    rulesVersion: '1.5',
    id: SOURCE,
    sourceId: SOURCE,
    source: { page: 85, sectionId: 't5a-u11-flow' },
    name: 'T5a U11 flow fixture',
    classification: 'encounter',
    dependencies: [],
    actions: [{
      id: 'default', name: 'U11', timing: 'use', costs: [], tags: options.tags ?? [], range: null, area: null, choices: [],
      ...(options.resolverId ? { resolverId: options.resolverId } : {}),
      steps,
    }],
  };
}

function contextOf(state: EncounterState, actorId: string, extra: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
  return {
    state: encounterAdapter.encounterRuleState(state),
    encounterState: state,
    actorId,
    sourceId: SOURCE,
    actionId: 'default',
    timing: 'use',
    input: {},
    dice: scriptedDice(4),
    triggers: new Set(),
    ...extra,
  };
}

function run(program: RuleProgram, context: RuleExecutionContext, state: EncounterState, resolvers: RuleResolverRegistry = {}, resolutionId = 'res:t5a:1'): RuleExecutionResult {
  return executeRuleProgramWithReactiveTriggers(program, context, resolvers, state, resolutionId);
}

function rmaEvent(actorId: string, sourceId: string, result: RuleExecutionResult): RMA {
  return {
    type: 'RULE_MUTATIONS_APPLIED',
    actorId,
    sourceId,
    actionId: 'default',
    timing: 'use',
    tags: [],
    mutations: result.mutations,
    ...(result.resolutionFacts ? { resolutionFacts: result.resolutionFacts } : {}),
    ...(result.facts ? { facts: result.facts } : {}),
    ...(result.resolutionId ? { resolutionId: result.resolutionId } : {}),
    ...(result.continuation ? { continuation: result.continuation } : {}),
  };
}

const damageMutationsOf = (mutations: RuleMutation[]): Extract<RuleMutation, { kind: 'damage' }>[] =>
  mutations.filter((mutation): mutation is Extract<RuleMutation, { kind: 'damage' }> => mutation.kind === 'damage');

describe('T5a U11 — flow executes against the SIMULATED intermediate state (adversarial fixtures)', () => {
  it('rush → damage: the damage target query observes the post-rush position (original-state evaluation would select NO target)', () => {
    const { state, heroId, foes } = startedEncounter();
    const foeA = foes.foeA!;
    const program = programWith([{
      id: 'base', timing: 'use', effects: [
        { kind: 'move', target: { kind: 'self' }, movement: 'rush', distance: { kind: 'constant', value: 1 }, directionInput: 'd' },
        { kind: 'damage', target: { kind: 'adjacent', origin: { kind: 'self' }, relation: 'foe' }, amount: { kind: 'constant', value: 5 }, damageType: 'normal', delivery: 'hit' },
      ],
    }]);
    const context = contextOf(state, heroId, { input: { directions: { d: { x: 1, y: 0 } }, actorIds: { target: [foeA] } } });
    // Pre-state adjacency of the hero at (1,1): foeA is at (3,1) — distance 2,
    // NOT adjacent. Only the simulated post-rush position (2,1) makes foeA
    // adjacent. Evaluating every step against the original pre-state would
    // therefore emit NO damage mutation at all.
    const result = run(program, context, state);
    const damages = damageMutationsOf(result.mutations);
    expect(damages).toHaveLength(1);
    expect(damages[0]!.actorId).toBe(foeA);
    // The durable mutations apply to the real state exactly as planned.
    const applied = applyEvents(state, [rmaEvent(heroId, SOURCE, result)]);
    expect(applied.actors[heroId]!.position).toEqual({ x: 2, y: 1 });
    expect(applied.actors[foeA]!.hp).toBe(32 - 5);
  });

  it('remove → place: the vacated-space read observes the removal (original-state evaluation would see the space occupied)', () => {
    const { state, heroId, foes } = startedEncounter();
    const foeA = foes.foeA!;
    const foeB = foes.foeB!;
    const program = programWith([{
      id: 'base', timing: 'use', effects: [
        // Remove foeA from the battlefield (its space (3,1) becomes free).
        { kind: 'move', target: { kind: 'input', key: 'victim', relation: 'any' }, movement: 'remove' },
        // Gate on the VACATED space: count of actors occupying (3,1) == 0.
        { kind: 'if', predicate: { kind: 'compare', left: { kind: 'count-query', query: { domain: 'actors', query: { occupying: { position: { x: 3, y: 1 } }, relation: 'any' } } }, operator: '=', right: { kind: 'constant', value: 0 } }, then: [
          { kind: 'damage', target: { kind: 'input', key: 'ally', relation: 'any' }, amount: { kind: 'constant', value: 3 }, damageType: 'normal', delivery: 'effect' },
        ] },
        // Place the user into the vacated space.
        { kind: 'move', target: { kind: 'self' }, movement: 'place', positionInput: 'vacated' },
      ],
    }]);
    const context = contextOf(state, heroId, { input: { actorIds: { victim: [foeA], ally: [foeB], target: [foeA] }, positions: { vacated: [{ x: 3, y: 1 }] } } });
    // Original-state evaluation: (3,1) is still occupied by foeA (count 1 ≠ 0),
    // so the gate would emit NO damage. The simulated state after the remove
    // sees count 0 and fires.
    const result = run(program, context, state);
    const damages = damageMutationsOf(result.mutations);
    expect(damages).toHaveLength(1);
    expect(damages[0]!.actorId).toBe(foeB);
    const applied = applyEvents(state, [rmaEvent(heroId, SOURCE, result)]);
    expect(applied.actors[foeA]!.onBattlefield).toBe(false);
    expect(applied.actors[heroId]!.position).toEqual({ x: 3, y: 1 });
  });

  it('teleport → adjacency: the adjacency test observes the teleported position (original-state evaluation would select NO target)', () => {
    // Place foeA at (4,1) (adjacent to the destination) and keep the default
    // foeB at (7,1) (distance 2 from the destination — not adjacent).
    let state = createEncounter('T5a teleport');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foeA = createFoe('teleport-target', { x: 4, y: 1 });
    const foeB = createFoe('far', { x: 7, y: 1 });
    state = applyEvents(state, [{ type: 'ACTOR_ADDED', actor: hero }, { type: 'ACTOR_ADDED', actor: foeA }, { type: 'ACTOR_ADDED', actor: foeB }]);
    state = startEncounterTo(state, hero.id);
    const program = programWith([{
      id: 'base', timing: 'use', effects: [
        { kind: 'move', target: { kind: 'self' }, movement: 'teleport', positionInput: 'dest' },
        { kind: 'damage', target: { kind: 'adjacent', origin: { kind: 'self' }, relation: 'foe' }, amount: { kind: 'constant', value: 4 }, damageType: 'normal', delivery: 'effect' },
      ],
    }]);
    const context = contextOf(state, hero.id, { input: { positions: { dest: [{ x: 5, y: 1 }] } } });
    // Pre-teleport the hero is at (1,1): foeA at (4,1) is distance 3 away.
    // Post-teleport (5,1) makes foeA adjacent (distance 1). Original-state
    // evaluation would emit NO damage.
    const result = run(program, context, state);
    const damages = damageMutationsOf(result.mutations);
    expect(damages).toHaveLength(1);
    expect(damages[0]!.actorId).toBe(foeA.id);
    const applied = applyEvents(state, [rmaEvent(hero.id, SOURCE, result)]);
    expect(applied.actors[hero.id]!.position).toEqual({ x: 5, y: 1 });
  });

  it('repeat: iteration N+1 sees the state iteration N produced (original-state evaluation would deal 5 twice)', () => {
    const { state, heroId, foes } = startedEncounter();
    const foeA = foes.foeA!;
    const program = programWith([{
      id: 'base', timing: 'use', effects: [{
        kind: 'repeat', times: { kind: 'constant', value: 2 }, effects: [{
          kind: 'if',
          predicate: { kind: 'has-condition', target: { kind: 'input', key: 'victim', relation: 'any' }, conditionId: 'marked' },
          then: [{ kind: 'damage', target: { kind: 'input', key: 'victim', relation: 'any' }, amount: { kind: 'constant', value: 1 }, damageType: 'normal', delivery: 'effect' }],
          otherwise: [
            { kind: 'condition', target: { kind: 'input', key: 'victim', relation: 'any' }, conditionId: 'marked', operation: 'apply' },
            { kind: 'damage', target: { kind: 'input', key: 'victim', relation: 'any' }, amount: { kind: 'constant', value: 5 }, damageType: 'normal', delivery: 'effect' },
          ],
        }],
      }],
    }]);
    const context = contextOf(state, heroId, { input: { actorIds: { victim: [foeA], target: [foeA] } } });
    const result = run(program, context, state);
    // Iteration 1 applies the mark + 5 damage. Only the SIMULATED state makes
    // iteration 2 see the mark and deal 1 instead of re-applying 5.
    const damages = damageMutationsOf(result.mutations);
    expect(damages.map((damage) => damage.amount)).toEqual([5, 1]);
    expect(result.mutations.filter((mutation) => mutation.kind === 'condition')).toHaveLength(1);
    const applied = applyEvents(state, [rmaEvent(heroId, SOURCE, result)]);
    expect(applied.actors[foeA]!.hp).toBe(32 - 5 - 1);
  });

  it('for-each over an already-derived CandidateSet executes deterministically through the flow authority', () => {
    const { state, heroId, foes } = startedEncounter();
    const foeA = foes.foeA!;
    const foeB = foes.foeB!;
    const context = contextOf(state, heroId);
    // The CandidateSet is derived ONCE through the shared U3 authority
    // (deterministic, de-duplicated by identity); the flow node only iterates
    // the ALREADY-DERIVED refs — it never re-queries.
    const candidates = evaluateActorQuery({ relation: 'foe' }, context);
    expect(candidates.map((entry) => entry.id)).toEqual([foeA, foeB]);
    const nodes: FlowNode[] = [{
      kind: 'for-each',
      items: candidates.map((entry) => capturedActor(entry.id)),
      bindName: 'victim',
      nodes: [{ kind: 'apply', effect: { kind: 'damage', target: { kind: 'bound', name: 'victim' }, amount: { kind: 'constant', value: 2 }, damageType: 'normal', delivery: 'effect' } }],
    }];
    const first = executeFlow(nodes, context);
    // CandidateSet order, not array-iteration order: [foeA, foeB] each dealt 2.
    expect(first.mutations.map((mutation) => mutation.kind === 'damage' ? mutation.actorId : null)).toEqual([foeA, foeB]);
    expect(first.mutations.every((mutation) => mutation.kind === 'damage' && mutation.amount === 2)).toBe(true);
    // Deterministic: a second run over the same inputs reproduces the exact
    // same mutation list (the loop never re-derives or re-orders).
    const second = executeFlow(nodes, context);
    expect(JSON.stringify(second.mutations)).toBe(JSON.stringify(first.mutations));
    // The durable mutations apply to the real state.
    const event: RMA = { type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: SOURCE, actionId: 'default', timing: 'use', tags: [], mutations: first.mutations };
    const applied = applyEvents(state, [event]);
    expect(applied.actors[foeA]!.hp).toBe(30);
    expect(applied.actors[foeB]!.hp).toBe(30);
  });

  it('invoke reuses the same flow authority — the invoked sub-flow shares the simulation', () => {
    const { state, heroId, foes } = startedEncounter();
    const foeA = foes.foeA!;
    const context = contextOf(state, heroId, { input: { directions: { d: { x: 1, y: 0 } }, actorIds: { target: [foeA] } } });
    const nodes: FlowNode[] = [
      { kind: 'apply', effect: { kind: 'move', target: { kind: 'self' }, movement: 'rush', distance: { kind: 'constant', value: 1 }, directionInput: 'd' } },
      { kind: 'invoke', nodes: [{ kind: 'apply', effect: { kind: 'damage', target: { kind: 'adjacent', origin: { kind: 'self' }, relation: 'foe' }, amount: { kind: 'constant', value: 3 }, damageType: 'normal', delivery: 'effect' } }] },
    ];
    const result = executeFlow(nodes, context);
    const damages = damageMutationsOf(result.mutations);
    // The invoked sub-flow's adjacency read observes the post-rush position:
    // foeA is only adjacent from (2,1). A shared-simulation failure (the
    // invoke re-seeding from the original state) would emit no damage.
    expect(damages).toHaveLength(1);
    expect(damages[0]!.actorId).toBe(foeA);
  });

  it('bind (U1) propagation reaches later value reads; emit-fact (U10) rides the flow result', () => {
    const { state, heroId, foes } = startedEncounter();
    const foeA = foes.foeA!;
    const nodes: FlowNode[] = [
      // CHOOSE a position AS landing — bound once, read later as a captured
      // position (distance is measured from the literal, never re-derived).
      { kind: 'bind', name: 'landing', reference: capturedPosition({ x: 5, y: 1 }) },
      { kind: 'apply', effect: { kind: 'damage', target: { kind: 'input', key: 'victim', relation: 'any' }, amount: { kind: 'distance', from: { kind: 'self' }, to: { ref: liveRef('position', { kind: 'bound', name: 'landing' }) } }, damageType: 'normal', delivery: 'effect' } },
      { kind: 'emit-fact', fact: { kind: 'movement', instanceId: 'fact:t5a:movement:0', sourceId: SOURCE, ownerId: heroId, actorId: heroId, mode: 'rush' } },
    ];
    const context = contextOf(state, heroId, { input: { actorIds: { victim: [foeA], target: [foeA] } } });
    const execution = executeFlow(nodes, context);
    const damages = damageMutationsOf(execution.mutations);
    // distance(hero at (1,1), landing (5,1)) = 4 — the bound captured
    // position propagates into the U5 value read.
    expect(damages).toHaveLength(1);
    expect(damages[0]!.amount).toBe(4);
    // U10 integration: the emit-fact node records the typed fact on the flow
    // result, so the event boundary can carry it. (Content does not emit
    // facts yet; final instanceId renumbering is U12/U13 boundary work.)
    expect(execution.facts).toHaveLength(1);
    expect(execution.facts[0]).toMatchObject({ kind: 'movement', mode: 'rush', ownerId: heroId });
  });

  it('an invalid intermediate operation rejects the WHOLE command before durable commit (no partial list, live state untouched)', () => {
    const { state, heroId, foes } = startedEncounter();
    const foeA = foes.foeA!;
    const program = programWith([{
      id: 'base', timing: 'use', effects: [
        // A perfectly valid first operation...
        { kind: 'damage', target: { kind: 'input', key: 'victim', relation: 'any' }, amount: { kind: 'constant', value: 3 }, damageType: 'normal', delivery: 'effect' },
        // ...then an INVALID intermediate operation: terrain creation requests
        // 2 cells but only 1 was supplied (fails closed, never silently
        // truncates to the supplied cell).
        { kind: 'terrain', operation: 'create', terrain: 'pit', positionInput: 'cells', count: { kind: 'constant', value: 2 } },
      ],
    }]);
    const context = contextOf(state, heroId, { input: { actorIds: { victim: [foeA], target: [foeA] }, positions: { cells: [{ x: 3, y: 1 }] } } });
    const before = structuredClone(state);
    let code = '';
    expect(() => {
      try {
        run(program, context, state);
      } catch (error) {
        if (error instanceof RuleProgramViolation) {
          code = error.code;
          throw error;
        }
        throw error;
      }
    }).toThrow(RuleProgramViolation);
    expect(code).toBe('choice.position-count');
    // Pre-commit rejection: no mutation list escaped the planner (the throw
    // happened before the plan completed, so no durable event can be built)
    // and the live encounter was never touched by planning.
    expect(state).toEqual(before);
    expect(() => executeRuleProgram(program, context)).toThrow(RuleProgramViolation);
  });

  it('zero-repeat and empty-for-each are clean no-ops', () => {
    const { state, heroId, foes } = startedEncounter();
    const foeA = foes.foeA!;
    const context = contextOf(state, heroId, { input: { actorIds: { victim: [foeA], target: [foeA] } } });
    const zeroRepeat = executeFlow([{ kind: 'repeat', times: { kind: 'constant', value: 0 }, nodes: [{ kind: 'apply', effect: { kind: 'damage', target: { kind: 'input', key: 'victim', relation: 'any' }, amount: { kind: 'constant', value: 100 }, damageType: 'normal', delivery: 'effect' } }] }], context);
    expect(zeroRepeat.mutations).toEqual([]);
    const emptyForEach = executeFlow([{ kind: 'for-each', items: [], bindName: 'victim', nodes: [{ kind: 'apply', effect: { kind: 'damage', target: { kind: 'bound', name: 'victim' }, amount: { kind: 'constant', value: 100 }, damageType: 'normal', delivery: 'effect' } }] }], context);
    expect(emptyForEach.mutations).toEqual([]);
  });
});

describe('T5a U11 — U15 atomic-group semantics stay correct under the simulation', () => {
  it('a legal simultaneous swap applies every leg — the follow-up read sees the POST-swap state (sequential leg-by-leg application would deny the swap)', () => {
    let state = createEncounter('T5a swap');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foeA = createFoe('swapper', { x: 2, y: 1 });
    const foeB = createFoe('observer', { x: 3, y: 1 });
    state = applyEvents(state, [{ type: 'ACTOR_ADDED', actor: hero }, { type: 'ACTOR_ADDED', actor: foeA }, { type: 'ACTOR_ADDED', actor: foeB }]);
    state = startEncounterTo(state, hero.id);
    const program = programWith([{
      id: 'base', timing: 'use', effects: [
        // Follow-up read AFTER the swap: adjacency of the hero.
        { kind: 'damage', target: { kind: 'adjacent', origin: { kind: 'self' }, relation: 'foe' }, amount: { kind: 'constant', value: 2 }, damageType: 'normal', delivery: 'effect' },
      ],
    }], { resolverId: 'swap' });
    const context = contextOf(state, hero.id);
    const resolvers: RuleResolverRegistry = {
      swap: (ctx) => swapMutations(ctx, 'place', [
        { actorId: hero.id, destination: { x: 2, y: 1 } },
        { actorId: foeA.id, destination: { x: 1, y: 1 } },
      ]),
    };
    const result = run(program, context, state, resolvers);
    const moves = result.mutations.filter((mutation): mutation is Extract<RuleMutation, { kind: 'move' }> => mutation.kind === 'move');
    expect(moves).toHaveLength(2);
    expect(moves.every((move) => move.spatialBatchId !== undefined)).toBe(true);
    // The atomic group applied BOTH legs to the simulation: the hero is at
    // (2,1), so foeB at (3,1) became adjacent and is targeted. A sequential
    // leg-by-leg application would have DENIED the swap (each destination
    // occupied until the other leg moves) and the read would see the
    // pre-swap state — targeting only foeA.
    const damages = damageMutationsOf(result.mutations);
    expect(new Set(damages.map((damage) => damage.actorId))).toEqual(new Set([foeA.id, foeB.id]));
    // The reducer applies the same group every-leg-or-none.
    const applied = applyEvents(state, [rmaEvent(hero.id, SOURCE, result)]);
    expect(applied.actors[hero.id]!.position).toEqual({ x: 2, y: 1 });
    expect(applied.actors[foeA.id]!.position).toEqual({ x: 1, y: 1 });
    expect(applied.actors[foeB.id]!.hp).toBe(30);
  });

  it('a denied swap group skips EVERY leg — the simulation mirrors the reducer (no partial swap)', () => {
    let state = createEncounter('T5a denied swap');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foeA = createFoe('swapper', { x: 2, y: 1 });
    state = applyEvents(state, [{ type: 'ACTOR_ADDED', actor: hero }, { type: 'ACTOR_ADDED', actor: foeA }]);
    state = startEncounterTo(state, hero.id);
    const program = programWith([{
      id: 'base', timing: 'use', effects: [
        // Follow-up read AFTER the swap: adjacency of the hero. If the
        // simulation had applied a PARTIAL swap (hero moved, foeA not), the
        // read would see different state than the reducer produces.
        { kind: 'damage', target: { kind: 'adjacent', origin: { kind: 'self' }, relation: 'foe' }, amount: { kind: 'constant', value: 2 }, damageType: 'normal', delivery: 'effect' },
      ],
    }], { resolverId: 'swap' });
    const context = contextOf(state, hero.id);
    const resolvers: RuleResolverRegistry = {
      swap: (ctx) => swapMutations(ctx, 'place', [
        // The hero's leg is out of bounds — the WHOLE declared group is denied.
        { actorId: hero.id, destination: { x: 99, y: 99 } },
        { actorId: foeA.id, destination: { x: 1, y: 1 } },
      ]),
    };
    const result = run(program, context, state, resolvers);
    // The follow-up read saw the PRE-swap state (the denied group applied no
    // leg): the hero at (1,1) is adjacent to foeA at (2,1).
    const damages = damageMutationsOf(result.mutations);
    expect(damages.map((damage) => damage.actorId)).toEqual([foeA.id]);
    // The reducer skips every leg of the denied group too — the simulation
    // and the replay application agree.
    const applied = applyEvents(state, [rmaEvent(hero.id, SOURCE, result)]);
    expect(applied.actors[hero.id]!.position).toEqual({ x: 1, y: 1 });
    expect(applied.actors[foeA.id]!.position).toEqual({ x: 2, y: 1 });
  });
});

describe('T5a U11 — replay of an ordered multi-step ability is byte-identical', () => {
  it('swap + post-swap adjacency damage (dice-consuming) + repeat replays byte-identical with no new decisions/RNG', () => {
    let state = createEncounter('T5a replay');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foeA = createFoe('victim', { x: 2, y: 1 });
    state = applyEvents(state, [{ type: 'ACTOR_ADDED', actor: hero }, { type: 'ACTOR_ADDED', actor: foeA }]);
    state = startEncounterTo(state, hero.id);
    const program = programWith([{
      id: 'base', timing: 'use', effects: [
        // Post-swap adjacency damage whose AMOUNT is a dice-consuming roll —
        // the rolled result must ride the recorded event (replay never
        // re-rolls).
        { kind: 'damage', target: { kind: 'adjacent', origin: { kind: 'self' }, relation: 'foe' }, amount: { kind: 'damage-roll', actor: { kind: 'self' }, dice: { kind: 'constant', value: 1 } }, damageType: 'normal', delivery: 'effect' },
        // Ordered repeat: iteration 2 observes iteration 1's applied mark.
        { kind: 'repeat', times: { kind: 'constant', value: 2 }, effects: [{
          kind: 'if',
          predicate: { kind: 'has-condition', target: { kind: 'input', key: 'victim', relation: 'any' }, conditionId: 'marked' },
          then: [{ kind: 'damage', target: { kind: 'input', key: 'victim', relation: 'any' }, amount: { kind: 'constant', value: 1 }, damageType: 'normal', delivery: 'effect' }],
          otherwise: [
            { kind: 'condition', target: { kind: 'input', key: 'victim', relation: 'any' }, conditionId: 'marked', operation: 'apply' },
            { kind: 'damage', target: { kind: 'input', key: 'victim', relation: 'any' }, amount: { kind: 'constant', value: 4 }, damageType: 'normal', delivery: 'effect' },
          ],
        }],
      }],
    }], { resolverId: 'swap' });
    const context = contextOf(state, hero.id, { input: { actorIds: { victim: [foeA.id], target: [foeA.id] } }, dice: scriptedDice(4) });
    const resolvers: RuleResolverRegistry = {
      swap: (ctx) => swapMutations(ctx, 'place', [
        { actorId: hero.id, destination: { x: 2, y: 1 } },
        { actorId: foeA.id, destination: { x: 1, y: 1 } },
      ]),
    };
    const result = run(program, context, state, resolvers, 'res:t5a:replay:1');
    // Ordered payload: swap legs, the rolled adjacency damage (amount 4 from
    // the scripted die), then the repeat's mark + 4, then 1.
    const moves = result.mutations.filter((mutation) => mutation.kind === 'move');
    const damages = damageMutationsOf(result.mutations);
    expect(moves).toHaveLength(2);
    expect(damages.map((damage) => damage.amount)).toEqual([4, 4, 1]);
    expect(result.mutations[0]).toMatchObject({ kind: 'move', actorId: hero.id, spatialBatchId: `${SOURCE}:spatial-swap` });
    const event = rmaEvent(hero.id, SOURCE, result);
    const first = applyEvents(state, [event]);
    const replayed = replayEncounter(state, [event]);
    // Replay consumes the RECORDED event — including the rolled damage, the
    // boundary stamps, the U10 facts, and the resolution identity — and
    // performs no new decisions or RNG (there is no planning path in replay
    // at all). The replayed event log must be byte-identical to the original
    // recorded event.
    expect(JSON.stringify(replayed.eventLog)).toBe(JSON.stringify([event]));
    const firstRma = first.eventLog.find((candidate): candidate is RMA => candidate.type === 'RULE_MUTATIONS_APPLIED')!;
    const replayedRma = replayed.eventLog.find((candidate): candidate is RMA => candidate.type === 'RULE_MUTATIONS_APPLIED')!;
    expect(JSON.stringify(replayedRma.mutations)).toBe(JSON.stringify(firstRma.mutations));
    expect(JSON.stringify(replayedRma.facts ?? [])).toBe(JSON.stringify(firstRma.facts ?? []));
    expect(JSON.stringify(replayedRma.resolutionId)).toBe(JSON.stringify(firstRma.resolutionId));
    // Final state identical: positions swapped, HP reflects the recorded rolls.
    expect(replayed.actors[hero.id]!.position).toEqual(first.actors[hero.id]!.position);
    expect(replayed.actors[foeA.id]!.position).toEqual(first.actors[foeA.id]!.position);
    expect(replayed.actors[foeA.id]!.hp).toEqual(first.actors[foeA.id]!.hp);
    expect(first.actors[hero.id]!.position).toEqual({ x: 2, y: 1 });
    expect(first.actors[foeA.id]!.position).toEqual({ x: 1, y: 1 });
    expect(first.actors[foeA.id]!.hp).toBe(32 - 4 - 4 - 1);
  });
});
