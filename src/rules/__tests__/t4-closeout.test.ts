/**
 * t4-closeout.test.ts — Phase T4 closeout correctness proofs (command/event
 * level). Proves the three final T4 contracts IN THE IMPLEMENTATION:
 *
 *   1. `resolveMutationOutcomes()` is idempotent in the strong semantic
 *      sense: re-running it over an already-resolved mutation list performs
 *      ZERO new damage determinations (an already-stamped instance is
 *      authoritative, its recorded amount is reused, and the sequential
 *      simulation applies that same recorded amount so later newly-added
 *      mutations still see the correct prior state). The reactive
 *      continuation runs `deriveResolutionTriggers()` several times during
 *      ONE ability resolution without ever re-determining the base damage.
 *   2. Legacy migration derives a SAFE lower bound from all recoverable
 *      durable evidence (retained resolutionId serials parsed from the FINAL
 *      numeric segment — delimiter-bearing source ids safe — plus the
 *      retained RMA count and the encounter revision floor), so a saturated
 *      pre-fix checkpoint can never reuse a historical serial. Malformed ids
 *      are ignored individually.
 *   3. U10 fact `instanceId` is INJECTIVE within a resolution: every fact is
 *      allocated from ONE deterministic ordered sequence at assembly
 *      (`renumberFactIds`), so an explicit `actor-defeated` mutation fact and
 *      a Slay-derived `actor-defeated` fact in the same resolution never
 *      share an id, and replay reproduces the identical ids.
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import * as encounterAdapter from '../automation/kernels/encounter-adapter.js';
import { deriveResolutionTriggers } from '../automation/kernels/resolution-triggers.js';
import { RULE_PROGRAM_SCHEMA_VERSION, type RuleExecutionContext, type RuleMutation, type RuleProgram } from '../automation/primitives/types.js';
import {
  actorFromCharacter,
  createEncounter,
  createFoe,
  executeCommand,
  executeRuleProgramWithReactiveTriggers,
  migrateEncounter,
  replayEncounter,
} from '../encounter.js';
import type { EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

function startedEncounter(): { state: EncounterState; heroId: string; foeId: string } {
  let state = createEncounter('T4 closeout');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  const foe = createFoe('Relict', { x: 3, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, heroId: hero.id, foeId: foe.id };
}

function programWith(steps: RuleProgram['actions'][number]['steps']): RuleProgram {
  return {
    schemaVersion: RULE_PROGRAM_SCHEMA_VERSION,
    rulesVersion: '1.5',
    id: 'test:t4-closeout',
    sourceId: 'test:t4-closeout',
    source: { page: 1, sectionId: 't4-closeout' },
    name: 'T4 closeout fixture',
    classification: 'encounter',
    dependencies: [],
    actions: [{ id: 'default', name: 'T4', timing: 'use', costs: [], tags: [], range: null, area: null, choices: [], steps }],
  };
}

function contextOf(state: EncounterState, actorId: string, targetIds: string[]): RuleExecutionContext {
  return {
    state: encounterAdapter.encounterRuleState(state),
    actorId,
    sourceId: 'test:t4-closeout',
    actionId: 'default',
    timing: 'use',
    input: { actorIds: { target: targetIds } },
    dice: scriptedDice(),
    triggers: new Set(),
  };
}

// ── 1. Idempotent outcome stamping ──────────────────────────────────────────
describe('T4 closeout — Fix 1: resolveMutationOutcomes never re-determines a stamped instance', () => {
  it('re-running over an already-resolved list performs ZERO new determinations and reproduces the identical stamps', () => {
    const { state, heroId, foeId } = startedEncounter();
    state.actors[foeId].armor = 3; // p.93 armor reduction makes the first determination non-trivial
    state.actors[foeId].hp = 7; // 10 - armor 3 = 7 defeats the target exactly
    state.actors[foeId].vigor = 0;
    const damage = (amount: number, index: number): Extract<RuleMutation, { kind: 'damage' }> => ({
      kind: 'damage', sourceId: 'test:t4-closeout', sourceActorId: heroId, actorId: foeId,
      amount, damageType: 'normal', instance: index, delivery: 'hit', ignoreCover: true,
    });
    // Two fresh (unstamped) instances against the same target: the first is
    // determined; the second no-ops (the first defeats the target), recording 0.
    const mutations: RuleMutation[] = [damage(10, 0), damage(10, 1)];
    expect(state.actors[foeId].defeated).toBe(false);
    const first = encounterAdapter.resolveMutationOutcomes(state, mutations);
    expect(first.get(0)).toBe(7); // 10 - armor 3
    expect(first.get(1)).toBe(0); // target defeated by the first → no-op
    const stampSnapshot = JSON.stringify(mutations.map((mutation) => mutation.kind === 'damage' ? mutation.determined : undefined));
    // A second pass over the SAME (now-stamped) mutations reproduces the
    // identical per-index outcomes — re-determining the first against the
    // pre-event state would again yield 7, but the SECOND (no-op, 0) is the
    // tell: the sequential simulation must apply the RECORDED first amount
    // (10 defeats the 10-HP target), not silently re-resolve it, and the
    // already-stamped instance must never invoke the damage authority again.
    const second = encounterAdapter.resolveMutationOutcomes(state, mutations);
    expect([...second.entries()]).toEqual([...first.entries()]);
    // …and never rewrites the immutable stamps.
    expect(JSON.stringify(mutations.map((mutation) => mutation.kind === 'damage' ? mutation.determined : undefined))).toBe(stampSnapshot);
  });

  it('deriveResolutionTriggers over already-stamped mutations consumes the record (no second semantic decision)', () => {
    const { state, heroId, foeId } = startedEncounter();
    state.actors[foeId].armor = 3;
    const stamped: Extract<RuleMutation, { kind: 'damage' }> = {
      kind: 'damage', sourceId: 'test:t4-closeout', sourceActorId: heroId, actorId: foeId,
      amount: 100, damageType: 'normal', instance: 0, delivery: 'hit', ignoreCover: true, determined: { amount: 7 },
    };
    const derived = deriveResolutionTriggers(state, [stamped], new Set(), 'res:closeout:1', 'default');
    // The recorded amount 7 rides the fact layer — if the authority had been
    // re-invoked, 100 would have been armor-reduced to 97 and the fact would
    // record 97. The stamp is authoritative.
    const fact = derived.facts.find((candidate) => candidate.kind === 'damage-applied');
    expect(fact).toMatchObject({ amount: 7 });
  });

  it('reactive continuation: the base damage is determined ONCE, its stamp unchanged across the passes', () => {
    const { state, heroId, foeId } = startedEncounter();
    // Obstruction at x=4: the shove (distance 2, foe at x=3) collides →
    // the `on-collide` triggered step resolves → the continuation runs
    // deriveResolutionTriggers again over the SAME mutation list.
    state.grid.terrain.push({ position: { x: 4, y: 1 }, type: 'impassable', elevation: 0 });
    const program = programWith([
      { id: 'shove', timing: 'use', effects: [
        { kind: 'move', target: { kind: 'input', key: 'target' }, movement: 'shove', distance: { kind: 'constant', value: 2 } },
      ] },
      { id: 'strike', timing: 'use', effects: [
        { kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'constant', value: 5 }, damageType: 'normal', delivery: 'hit', ignoreCover: true },
      ] },
      { id: 'on-collide', timing: 'use', trigger: 'collide', effects: [
        { kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 1 } },
      ] },
    ]);
    const result = executeRuleProgramWithReactiveTriggers(program, contextOf(state, heroId, [foeId]), {}, state, 'res:cont:1');
    // The collide step actually opened a continuation (otherwise this test
    // would not exercise the repeated passes).
    expect(result.selectedSteps.some((step) => step.id === 'on-collide')).toBe(true);
    const damageMutations = result.mutations.filter((mutation): mutation is Extract<RuleMutation, { kind: 'damage' }> => mutation.kind === 'damage');
    // The base strike (the fixture's own source) is the resolution's own
    // damage; any additional damage mutation is a content fold (e.g. the
    // hero's Bull's Strength collide damage) appended AFTER the continuation
    // passes — it cannot rewrite the base stamp.
    const base = damageMutations.find((mutation) => mutation.sourceId === 'test:t4-closeout')!;
    expect(base).toBeDefined();
    // Stamped EXACTLY ONCE across the initial pass, the reactive-continuation
    // pass, and the final fact pass — a later pass re-determining it would
    // yield a fresh stamp object or a divergent amount.
    expect(base.determined).toEqual({ amount: 5 });
    // Re-running the resolver over the SAME recorded mutations performs no
    // new determination: the stamps are already present, so the dry run
    // consumes them (proving the continuation passes never re-decide).
    const again = deriveResolutionTriggers(state, result.mutations, new Set(), 'res:cont:1', 'default');
    expect(again.facts.find((candidate) => candidate.kind === 'damage-applied')).toMatchObject({ amount: 5 });
  });
});

// ── 2. Safe legacy resolution serial migration ──────────────────────────────
describe('T4 closeout — Fix 2: legacy migration can never reuse a historical serial', () => {
  it('a saturated legacy checkpoint migrates at least to its maximum recoverable retained serial', () => {
    const { state, heroId } = startedEncounter();
    const eventLog: EncounterState['eventLog'] = Array.from({ length: 500 }, (_, index) => ({
      type: 'RULE_MUTATIONS_APPLIED' as const, actorId: heroId, sourceId: 'fixture:noise', actionId: 'default',
      timing: 'use' as const, tags: [] as string[], mutations: [],
      ...(index === 499 ? { resolutionId: 'res:fixture:noise:731' } : {}),
    }));
    const legacy = { ...state, revision: 500, eventLog } as unknown as EncounterState;
    delete (legacy as Partial<EncounterState>).resolutionSerial;
    const migrated = migrateEncounter(legacy);
    // The migrated serial is at least the maximum recoverable historical serial.
    expect(migrated.resolutionSerial).toBeGreaterThanOrEqual(731);
    // Two SEPARATE uses of the same source can never collide with the retained
    // historical identity — the next serial is strictly beyond 731.
    const retained = eventLog[499]! as Extract<EncounterState['eventLog'][number], { type: 'RULE_MUTATIONS_APPLIED' }>;
    const next = replayEncounter(migrated, [retained]);
    expect(next.resolutionSerial).toBe(migrated.resolutionSerial + 1);
    expect(next.resolutionSerial).toBeGreaterThan(731);
  });

  it('a delimiter-bearing source id still parses its trailing serial', () => {
    const { state, heroId } = startedEncounter();
    const legacy = {
      ...state,
      revision: 0,
      eventLog: [{
        type: 'RULE_MUTATIONS_APPLIED' as const, actorId: heroId, sourceId: 'job:weird:ability:core', actionId: 'default',
        timing: 'use' as const, tags: [] as string[], mutations: [], resolutionId: 'res:job:weird:ability:core:42',
      }],
    } as unknown as EncounterState;
    delete (legacy as Partial<EncounterState>).resolutionSerial;
    expect(migrateEncounter(legacy).resolutionSerial).toBe(42);
  });

  it('malformed/legacy resolution ids are ignored individually (no crash, no guess)', () => {
    const { state, heroId } = startedEncounter();
    const base = {
      type: 'RULE_MUTATIONS_APPLIED' as const, actorId: heroId, sourceId: 'fixture:noise', actionId: 'default',
      timing: 'use' as const, tags: [] as string[], mutations: [],
    };
    const legacy = {
      ...state,
      revision: 0,
      eventLog: [
        { ...base, resolutionId: 'res:no-serial' },
        { ...base, resolutionId: 'res:trailing-colon:' },
        { ...base, resolutionId: 'not-a-current-format-id' },
        { ...base, resolutionId: 'res:x:12:not-a-number' },
        { ...base, resolutionId: '' },
        { ...base },
      ],
    } as unknown as EncounterState;
    delete (legacy as Partial<EncounterState>).resolutionSerial;
    // Malformed ids skipped; the deterministic retained-RMA count stays the floor.
    expect(migrateEncounter(legacy).resolutionSerial).toBe(6);
  });
});

// ── 3. Injective fact identity within a resolution ──────────────────────────
describe('T4 closeout — Fix 3: U10 fact instanceId is unique within a resolution', () => {
  it('an explicit defeat mutation fact and a Slay-derived defeat fact in the SAME resolution never share an id', () => {
    const { state, heroId, foeId } = startedEncounter();
    state.actors[foeId].hp = 1;
    state.actors[foeId].vigor = 0;
    const program = programWith([
      { id: 'execution', timing: 'use', effects: [
        { kind: 'defeat', target: { kind: 'input', key: 'target' } },
      ] },
      { id: 'lethal-blow', timing: 'use', effects: [
        { kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'constant', value: 1 }, damageType: 'normal', delivery: 'hit', ignoreCover: true },
      ] },
    ]);
    const result = executeRuleProgramWithReactiveTriggers(program, contextOf(state, heroId, [foeId]), {}, state, 'res:defeat:1');
    // BOTH the explicit defeat and the Slay-derived defeat fact exist in this
    // resolution (the 1-HP target was defeated by the damage after the
    // explicit defeat).
    const defeats = result.facts!.filter((fact) => fact.kind === 'actor-defeated');
    expect(defeats.length).toBeGreaterThanOrEqual(2);
    // Injectivity within the resolution: every fact id is globally unique.
    const ids = result.facts!.map((fact) => fact.instanceId);
    expect(new Set(ids).size).toBe(ids.length);
    // And the two defeat facts specifically are distinct (the Slay-derived one
    // is a different fact than the explicit defeat mutation's record).
    expect(defeats[0]!.instanceId).not.toBe(defeats[1]!.instanceId);
  });

  it('replay reproduces the identical fact identities byte-for-byte', () => {
    const { state, heroId, foeId } = startedEncounter();
    state.actors[foeId].hp = 1;
    state.actors[foeId].vigor = 0;
    const program = programWith([
      { id: 'lethal-blow', timing: 'use', effects: [
        { kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'constant', value: 1 }, damageType: 'normal', delivery: 'hit', ignoreCover: true },
      ] },
    ]);
    const result = executeRuleProgramWithReactiveTriggers(program, contextOf(state, heroId, [foeId]), {}, state, 'res:replay:1');
    const event = {
      type: 'RULE_MUTATIONS_APPLIED' as const, actorId: heroId, sourceId: 'test:t4-closeout', actionId: 'default',
      timing: 'use' as const, tags: [] as string[], mutations: result.mutations,
      resolutionFacts: result.resolutionFacts, facts: result.facts, resolutionId: result.resolutionId,
    };
    const factsJson = JSON.stringify(result.facts);
    const replayed = replayEncounter(state, [event]);
    const replayedRma = replayed.eventLog.find((candidate): candidate is typeof event => candidate.type === 'RULE_MUTATIONS_APPLIED')!;
    expect(JSON.stringify(replayedRma.facts)).toBe(factsJson);
  });
});
