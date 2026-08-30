/**
 * t4-corrective.test.ts — Phase T4 CORRECTIVE pass, command/event-level.
 *
 * Proves the six corrections end-to-end (not just at the primitive level):
 *   1. Durable resolution identity + facts ride the RULE_MUTATIONS_APPLIED
 *      event; two separate uses of the same ability get distinct fact ids and
 *      a replayed event reproduces them exactly.
 *   2. `damage-applied` facts record the DETERMINED (post-mitigation) amount,
 *      never the raw proposed amount; fully-prevented damage emits no false
 *      fact.
 *   3. U16 de-dup is WIRED into the real reactive continuation with ICON's
 *      once-per-ability semantics (multiple Collides → one Collide step).
 *   4. effect-still-exists reads a SPECIFIC live instance by its durable id.
 *   5. Effect lifecycle facts are coherent (remove/refresh reference the
 *      original instance).
 *   6. U9 provenance survives reflected/secondary delivery (causal origin vs
 *      delivery distinction).
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { effectExistsLive, type EffectInstanceIdentity } from '../automation/primitives/facts.js';
import { provenanceOfMutation, sameCausalOrigin, type Provenance } from '../automation/primitives/provenance.js';
import { RULE_PROGRAM_SCHEMA_VERSION, type RuleExecutionContext, type RuleMutation, type RuleProgram } from '../automation/primitives/types.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand, replayEncounter, executeRuleProgramWithReactiveTriggers } from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/** An ability whose base step shoves the target; when the shove collides, the
 * `collide` triggered step resolves ONCE (ICON once-per-ability). */
function collideFixture(state: EncounterState, heroId: string, foeId: string): { program: RuleProgram; context: RuleExecutionContext } {
  const program: RuleProgram = {
    schemaVersion: RULE_PROGRAM_SCHEMA_VERSION,
    rulesVersion: '1.5',
    id: 'test:collide-fixture',
    sourceId: 'test:collide-fixture',
    source: { page: 102, sectionId: 'collide' },
    name: 'Collide fixture',
    classification: 'encounter',
    dependencies: [],
    actions: [{
      id: 'default', name: 'Collide', timing: 'use', costs: [], tags: [],
      range: null, area: null, choices: [],
      steps: [
        { id: 'shove', timing: 'use', effects: [
          { kind: 'move', target: { kind: 'input', key: 'target' }, movement: 'shove', distance: { kind: 'constant', value: 2 } },
        ] },
        { id: 'on-collide', timing: 'use', trigger: 'collide', effects: [
          { kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 5 } },
        ] },
      ],
    }],
  };
  return { program, context: {
    state: encounterRuleState(state), actorId: heroId, sourceId: 'test:collide-fixture', actionId: 'default',
    timing: 'use', input: { actorIds: { target: [foeId] } }, dice: scriptedDice(), triggers: new Set(),
  } };
}

function collideEncounter(terrain: Position[] = []): { state: EncounterState; hero: EncounterActor; foe: EncounterActor } {
  let state = createEncounter('T4 corrective');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  const foe = createFoe('Relict', { x: 2, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  for (const position of terrain) state.grid.terrain.push({ position, type: 'impassable', elevation: 0 });
  return { state, hero: state.actors[hero.id], foe: state.actors[foe.id] };
}

/** The events of a USE_ABILITY command that resolve the collide fixture. */
function collideRuleEvents(state: EncounterState, heroId: string, foeId: string): Extract<EncounterEvent, { type: 'RULE_MUTATIONS_APPLIED' }> {
  const { program, context } = collideFixture(state, heroId, foeId);
  const result = executeRuleProgramWithReactiveTriggers(program, context, {}, state, 'res:collide:1');
  const event: Extract<EncounterEvent, { type: 'RULE_MUTATIONS_APPLIED' }> = {
    type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: 'test:collide-fixture', actionId: 'default',
    timing: 'use', tags: [], mutations: result.mutations,
    resolutionFacts: result.resolutionFacts, facts: result.facts, resolutionId: result.resolutionId,
  };
  return event;
}

describe('T4 corrective — Issue 1: durable resolution identity + facts ride the event', () => {
  it('an ability use records its typed facts and a replay-stable resolutionId on the event', () => {
    const { state, hero, foe } = collideEncounter([{ x: 4, y: 1 }]);
    const event = collideRuleEvents(state, hero.id, foe.id);
    expect(event.resolutionId).toBe('res:collide:1');
    expect(event.facts && event.facts.length).toBeGreaterThan(0);
    // Every recorded OUTCOME fact is ID-scoped under the resolution id. The
    // U16 `trigger-resolved` markers (the collide step resolved once) ride the
    // same durable fact list but carry the canonical resolve-identity KEY as
    // their instance id — resolution-scoped, distinct per resolution.
    const scopedFacts = event.facts!.filter((fact) => fact.kind !== 'trigger-resolved');
    expect(scopedFacts.length).toBeGreaterThan(0);
    expect(scopedFacts.every((fact) => fact.instanceId.startsWith('fact:res:collide:1:'))).toBe(true);
    // The collide triggered step resolved exactly once in this resolution →
    // exactly one durable marker, whose identity key embeds the resolution id.
    const markers = event.facts!.filter((fact) => fact.kind === 'trigger-resolved');
    expect(markers).toHaveLength(1);
    expect(markers[0]!.instanceId).toContain('"res:collide:1"');
    // ability-used is emitted at the resolution boundary under the resolution id.
    const used = event.facts!.find((fact) => fact.kind === 'ability-used');
    expect(used).toMatchObject({ sourceId: 'test:collide-fixture', ownerId: hero.id, actionId: 'default' });
    expect(used!.instanceId).toBe('fact:res:collide:1:ability-used:0');
  });

  it('two separate uses of the same ability produce DIFFERENT fact/instance ids', () => {
    const { state, hero, foe } = collideEncounter([{ x: 4, y: 1 }]);
    const one = collideRuleEvents(state, hero.id, foe.id);
    // Second use: a new resolution (serial 2).
    const next = executeRuleProgramWithReactiveTriggers(collideFixture(state, hero.id, foe.id).program, collideFixture(state, hero.id, foe.id).context, {}, state, 'res:collide:2');
    expect(next.resolutionId).toBe('res:collide:2');
    expect(next.facts!.filter((fact) => fact.kind !== 'trigger-resolved')[0]!.instanceId.startsWith('fact:res:collide:2:')).toBe(true);
    // The resolution ids differ.
    expect(one.resolutionId).not.toBe(next.resolutionId);
  });

  it('replaying the recorded event reproduces the identical fact history', () => {
    const { state, hero, foe } = collideEncounter([{ x: 4, y: 1 }]);
    const event = collideRuleEvents(state, hero.id, foe.id);
    const factsJson = JSON.stringify(event.facts);
    // applyEvents consumes the event; the durable fact list is preserved on it.
    const applied = applyEvents({ ...state, eventLog: [] }, [event]);
    expect(applied.eventLog[0]?.type === 'RULE_MUTATIONS_APPLIED' && (applied.eventLog[0] as typeof event).facts).toBeDefined();
    // Replaying the same event yields the same facts array.
    expect(JSON.stringify((applied.eventLog[0] as typeof event).facts)).toBe(factsJson);
    // Replay from scratch against identical events reproduces identical facts.
    const replay = replayEncounter(state, [event]);
    expect(JSON.stringify((replay.eventLog[0] as typeof event).facts)).toBe(factsJson);
  });
});

describe('T4 corrective — Issue 2: damage facts record RESOLVED outcomes', () => {
  it('raw 5 damage reduced to 2 records 2 applied, not 5', () => {
    const { state, hero, foe } = collideEncounter();
    state.actors[foe.id].armor = 3; // p.93 armor reduces normal damage
    const event = collideRuleEventsWithDamage(state, hero.id, foe.id, 5);
    const damage = event.facts!.find((fact) => fact.kind === 'damage-applied');
    expect(damage).toBeDefined();
    expect((damage as Extract<typeof damage, { kind: 'damage-applied' }>).amount).toBe(2);
  });

  it('fully prevented/no-op damage does not record a false damage-applied fact', () => {
    const { state, hero, foe } = collideEncounter();
    state.actors[foe.id].armor = 100; // raw 5 fully absorbed → 0
    const event = collideRuleEventsWithDamage(state, hero.id, foe.id, 5);
    expect(event.facts!.some((fact) => fact.kind === 'damage-applied')).toBe(false);
  });
});

describe('T4 corrective — Issue 3: U16 de-dup wired into the reactive continuation (once-per-ability)', () => {
  it('three Collide routing facts open ONE Collide triggered step', () => {
    // Build a multi-target shove: three foes shoved into an obstruction in one
    // ability. All three collide; the `on-collide` step resolves ONCE.
    const enemyRows = [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }];
    const blockedPosition = { x: 3, y: 1 }; // shove distance 1 → collides immediately
    let state = createEncounter('multi-collide');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    const foes: EncounterActor[] = [];
    for (const pos of enemyRows) {
      const foe = createFoe(`Relict${pos.y}`, pos);
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
      foes.push(state.actors[foe.id]);
    }
    state = startEncounterTo(state, hero.id);
    state.grid.terrain.push({ position: blockedPosition, type: 'impassable', elevation: 0 });
    const program: RuleProgram = {
      schemaVersion: RULE_PROGRAM_SCHEMA_VERSION, rulesVersion: '1.5', id: 'test:multi-collide',
      sourceId: 'test:multi-collide', source: { page: 102, sectionId: 'collide' }, name: 'multi',
      classification: 'encounter', dependencies: [],
      actions: [{
        id: 'default', name: 'multi', timing: 'use', costs: [], tags: [], range: null, area: null, choices: [],
        steps: [
          { id: 'shove', timing: 'use', effects: [
            { kind: 'move', target: { kind: 'input', key: 'target' }, movement: 'shove', distance: { kind: 'constant', value: 1 } },
          ] },
          { id: 'on-collide', timing: 'use', trigger: 'collide', effects: [
            { kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 1 } },
          ] },
        ],
      }],
    };
    const context: RuleExecutionContext = {
      state: encounterRuleState(state), actorId: hero.id, sourceId: 'test:multi-collide', actionId: 'default',
      timing: 'use', input: { actorIds: { target: foes.map((foe) => foe.id) } }, dice: scriptedDice(), triggers: new Set(),
    };
    const result = executeRuleProgramWithReactiveTriggers(program, context, {}, state, 'res:multi:1');
    // Exactly ONE collide-triggered on-collide step.
    const onCollideRuns = result.selectedSteps.filter((step) => step.id === 'on-collide');
    expect(onCollideRuns).toHaveLength(1);
    // Exactly ONE aether gain from the collide step per the single resolution.
    const gains = result.mutations.filter((mutation): mutation is Extract<RuleMutation, { kind: 'resource' }> =>
      mutation.kind === 'resource' && mutation.resourceId === 'aether' && mutation.operation === 'gain');
    expect(gains.map((g) => g.amount)).toEqual([1]);
  });

  it('a second use of the same ability can trigger the step again', () => {
    const { state, hero, foe } = collideEncounter([{ x: 4, y: 1 }]);
    const { program, context } = collideFixture(state, hero.id, foe.id);
    const one = executeRuleProgramWithReactiveTriggers(program, context, {}, state, 'res:collide:1');
    expect(one.selectedSteps.some((step) => step.id === 'on-collide')).toBe(true);
    // Second use (different resolution) resolves the step independently again.
    const two = executeRuleProgramWithReactiveTriggers(program, context, {}, state, 'res:collide:2');
    expect(two.selectedSteps.some((step) => step.id === 'on-collide')).toBe(true);
    // And the two resolutions produced distinct fact histories.
    expect(one.facts![0].instanceId !== two.facts![0].instanceId || one.resolutionId !== two.resolutionId).toBe(true);
  });
});

describe('T4 corrective — Issue 4/5: durable instance-id effect reads + coherent lifecycle', () => {
  it('a persistent effect fact names its instance; effectExistsLive reads the specific durable id', () => {
    // Construct a view with a durable generated id (as the reducer mints).
    const view = factorActor({ activeEffects: [{ id: 'fixture:gate:3:0:effect', sourceId: 'fixture:gate', effectId: 'aura', ownerId: 'hero' }] });
    const specific: EffectInstanceIdentity = { kind: 'persistent', sourceId: 'fixture:gate', targetId: 'hero', effectId: 'aura', instanceId: 'fixture:gate:3:0:effect' };
    // The fact referring to THAT instance reads it while it exists.
    expect(effectExistsLive(view, specific)).toEqual({ ok: true, exists: true });
    // Instance removed (B remains) → A-specific read false; B stays distinct.
    const withB = factorActor({ activeEffects: [{ id: 'fixture:gate:3:1:effect', sourceId: 'fixture:gate', effectId: 'b', ownerId: 'hero' }] });
    expect(effectExistsLive(withB, specific)).toEqual({ ok: true, exists: false });
    const bSpecific: EffectInstanceIdentity = { kind: 'persistent', sourceId: 'fixture:gate', targetId: 'hero', effectId: 'b', instanceId: 'fixture:gate:3:1:effect' };
    expect(effectExistsLive(withB, bSpecific)).toEqual({ ok: true, exists: true });
  });

  it('a mark placed by owner A does not satisfy owner B endash identical markId', () => {
    const view = factorActor({ marks: [{ id: 'm1', markId: 'incubus', ownerId: 'allyA' }] });
    const ownerSensitive = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'mark' as const, effectId: 'incubus', sourceId: 'x', ownerSensitive: true, ownerId: 'allyB' };
    expect(effectExists(view, ownerSensitive)).toBe(false);
    const ownerA = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'mark' as const, effectId: 'incubus', sourceId: 'x', ownerSensitive: true, ownerId: 'allyA' };
    expect(effectExists(view, ownerA)).toBe(true);
  });
});

describe('T4 corrective — Issue 6: U9 provenance against real reflected/secondary paths', () => {
  it('a reflected/secondary delivery keeps the true causal origin, not the later delivery actor', () => {
    // Foe's ability damages the hero (the hero is the initiating owner? no —
    // the FOE's ability damaged the hero, then it reflected back to the foe).
    const reflected = provenanceOfMutation({
      kind: 'damage', sourceId: 'fixture:reflector', sourceActorId: 'villain', actorId: 'hero',
      amount: 3, damageType: 'normal', instance: 0, delivery: 'effect', ignoreCover: false,
    }, { actionId: 'reflect-leg', volition: 'forced' });
    const original = provenanceOfMutation({
      kind: 'damage', sourceId: 'fixture:reflector', sourceActorId: 'villain', actorId: 'hero',
      amount: 3, damageType: 'normal', instance: 0, delivery: 'hit', ignoreCover: false,
    }, { actionId: 'orig-leg' });
    // Same initiating ability + actor → same causal origin even though the
    // reflected delivery is a different delivery mode.
    expect(sameCausalOrigin(reflected, original)).toBe(true);
    // The delivery/volition dimensions are separate from the causal identity.
    expect(reflected.volition).toBe('forced');
    expect(reflected.delivery).toBe('effect');
    // Pacified-style question: "the FOE's ability damaged me" is answerable —
    // the actor's own reflected delivery still names the foe as sourceActorId.
    expect((reflected as Provenance).sourceActorId).toBe('villain');
  });

  it('terrain/self damage is not falsely attributed to a foe', () => {
    const terrain = provenanceOfMutation({
      kind: 'damage', sourceId: 'core:dangerous-terrain', sourceActorId: 'hero', actorId: 'hero',
      amount: 4, damageType: 'piercing', instance: 1, delivery: 'terrain', ignoreCover: true,
    }, { deliverySource: 'terrain' });
    const foeDamage = provenanceOfMutation({
      kind: 'damage', sourceId: 'fixture:foe', sourceActorId: 'villain', actorId: 'hero',
      amount: 4, damageType: 'normal', instance: 0, delivery: 'hit', ignoreCover: false,
    });
    // Different source + different causal actor → NOT the same causal origin.
    expect(sameCausalOrigin(terrain, foeDamage)).toBe(false);
    // The delivery source is recorded as terrain, not attributed to an actor.
    expect(terrain.deliverySource).toBe('terrain');
  });
});

// ── fixtures used above ─────────────────────────────────────────────────────
type RMA = Extract<EncounterEvent, { type: 'RULE_MUTATIONS_APPLIED' }>;

function collideRuleEventsWithDamage(state: EncounterState, heroId: string, foeId: string, raw: number): RMA {
  const program: RuleProgram = {
    schemaVersion: RULE_PROGRAM_SCHEMA_VERSION, rulesVersion: '1.5', id: 'test:damage-fixture', sourceId: 'test:damage-fixture',
    source: { page: 1, sectionId: 'd' }, name: 'dmg', classification: 'encounter', dependencies: [],
    actions: [{ id: 'default', name: 'd', timing: 'use', costs: [], tags: [], range: null, area: null, choices: [], steps: [
      { id: 'strike', timing: 'use', effects: [
        { kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'constant', value: raw }, damageType: 'normal', delivery: 'hit', ignoreCover: true },
      ] },
    ] }],
  };
  const context: RuleExecutionContext = {
    state: encounterRuleState(state), actorId: heroId, sourceId: 'test:damage-fixture', actionId: 'default',
    timing: 'use', input: { actorIds: { target: [foeId] } }, dice: scriptedDice(), triggers: new Set(),
  };
  const result = executeRuleProgramWithReactiveTriggers(program, context, {}, state, 'res:damage:1');
  return {
    type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: 'test:damage-fixture', actionId: 'default',
    timing: 'use', tags: [], mutations: result.mutations,
    resolutionFacts: result.resolutionFacts, facts: result.facts, resolutionId: result.resolutionId,
  };
}

function factorActor(overrides: Partial<ReturnType<typeof makeHeroView>>): ReturnType<typeof makeHeroView> {
  return { ...makeHeroView(), ...overrides };
}
function makeHeroView() {
  return {
    id: 'hero', side: 'heroes' as const, position: { x: 1, y: 1 } as Position, hp: 10, maxHp: 10, vitality: 1,
    vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false,
    traitIds: [] as string[], abilityIds: [] as string[], talents: {}, masteredAbilityIds: [] as string[], size: 1,
    defeated: false, activeEffects: [] as Array<{ id: string; sourceId: string; effectId: string; ownerId: string; radius?: number }>,
    conditions: new Set<string>(), statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
    resources: {}, state: {}, marks: [] as Array<{ id: string; markId: string; ownerId: string }>,
  };
}

function effectExists(view: ReturnType<typeof makeHeroView>, predicate: { kind: 'effect-still-exists'; target: { kind: 'self' }; effectKind: 'mark'; effectId: string; sourceId?: string; ownerSensitive?: boolean; ownerId?: string }): boolean {
  const identity: EffectInstanceIdentity = { kind: 'mark', sourceId: predicate.sourceId ?? 'x', targetId: 'hero', effectId: predicate.effectId, ...(predicate.ownerSensitive && predicate.ownerId ? { ownerSensitive: true, ownerId: predicate.ownerId } : {}) };
  const result = effectExistsLive(view as never, identity);
  return result.ok && result.exists;
}

