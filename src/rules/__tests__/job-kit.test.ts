import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { CORE_RULE_RESOLVERS } from '../automation/kernels/core-resolvers.js';
import type { RuleAction, RuleExecutionContext } from '../automation/primitives/types.js';
import type { DiceSource } from '../dice.js';
import type { EncounterState } from '../types.js';
import {
  action,
  attackStep,
  compilation,
  conditionMutation,
  constant,
  damageMutation,
  occupied,
  ringAround,
  sourceActor,
  stateMutation,
  summonEntity,
  untilNextTurnEnd,
  walk,
} from '../automation/primitives/job-kit.js';
import { resolveAuthoritativeAttack } from '../automation/kernels/attack-resolution.js';
import { findRuleSourceUnit } from '../source-units.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/**
 * Direct unit coverage for the shared job-program building blocks in
 * job-kit.ts. The kit is the consolidation of the helpers the five shipped
 * job files used to inline; these tests pin the semantics future jobs rely on
 * (entity-aware movement, the VM-mirroring attack roll, and the canonical
 * mutation/compilation shapes).
 */

function board() {
  let state = createEncounter('Kit fixture');
  const hero = actorFromCharacter(validCharacter('Harlequin'), { x: 1, y: 1 });
  const foe = createFoe('Relict', { x: 3, y: 1 });
  const far = createFoe('Grim', { x: 5, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: far }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, far };
}

function kitContext(state: EncounterState, actorId: string, dice: DiceSource): RuleExecutionContext {
  return { state: encounterRuleState(state), actorId, sourceId: 'kit:test', actionId: 'default', timing: 'use', input: {}, dice };
}

describe('job-kit building blocks', () => {
  it('walk stops at characters when not phasing and passes through when phasing', () => {
    const { state, hero } = board();
    const ctx = kitContext(state, hero.id, scriptedDice());
    expect(walk(ctx, { x: 1, y: 1 }, { x: 1, y: 0 }, 5, false, hero.id)).toEqual({ x: 2, y: 1 });
    expect(walk(ctx, { x: 1, y: 1 }, { x: 1, y: 0 }, 5, true, hero.id)).toEqual({ x: 6, y: 1 });
  });

  it('summonEntity is the single summon seam: one INTENT mutation with placement region + creator LoS split, count, category', () => {
    const { state, hero } = board();
    const ctx = kitContext(state, hero.id, scriptedDice());
    // Hero (creator) at (1,1), foe at (3,1). Place two beasts around the FOE
    // (region = target) whose line of sight comes from the HERO (losOrigin),
    // not from the region center — the intent split PART 2 requires.
    const mutations = summonEntity(ctx, hero.id, 'beast', { x: 3, y: 1 }, { radius: 1, count: 2, losOrigin: { x: 1, y: 1 } });
    expect(mutations).toHaveLength(1);
    const mutation = mutations[0]!;
    expect(mutation).toMatchObject({
      kind: 'entity', operation: 'create', entityType: 'beast', ownerId: hero.id, count: 2,
      category: 'summon', countMode: 'up-to',
      creationSpatial: { origin: { x: 1, y: 1 }, originSize: 1 },
    });
    const cells = mutation.kind === 'entity' ? mutation.positions : [];
    // The candidate DOMAIN is the full placement region around the foe — no
    // pre-filtering of occupancy/LoS — so it includes the occupied foe center
    // cell (the validator rejects it) but not the (distant) hero cell.
    expect(cells.some((c) => c.x === 3 && c.y === 1)).toBe(true);
    expect(cells.some((c) => c.x === 1 && c.y === 1)).toBe(false);
    // Every candidate is within the Chebyshev region of the placement center.
    for (const cell of cells) {
      expect(Math.max(Math.abs(cell.x - 3), Math.abs(cell.y - 1))).toBeLessThanOrEqual(1);
    }
  });

  it('walk stops at the grid edge', () => {
    const { state, hero } = board();
    const ctx = kitContext(state, hero.id, scriptedDice());
    expect(walk(ctx, { x: 1, y: 1 }, { x: 1, y: 0 }, 50, true, hero.id)).toEqual({ x: 9, y: 1 });
  });

  it('occupied reports final-space availability for characters and OBJECTs, but not intangible summons', () => {
    const { state, hero, foe } = board();
    const base = kitContext(state, hero.id, scriptedDice());
    expect(occupied({ x: 3, y: 1 }, base, hero.id)).toBe(true);
    expect(occupied({ x: 3, y: 1 }, base, foe.id)).toBe(false);
    expect(occupied({ x: 4, y: 1 }, base, hero.id)).toBe(false);

    // A bomb is an intangible SUMMON (ICON p.95: summons "don't cause
    // obstruction or engagement") — its cell remains available under this
    // final-space occupancy test.
    const withSummon: RuleExecutionContext = {
      ...base,
      state: {
        ...base.state,
        entities: { ...base.state.entities, mine: { id: 'mine', type: 'bomb', ownerId: hero.id, positions: [{ x: 4, y: 1 }], state: {} } },
      },
    };
    expect(occupied({ x: 4, y: 1 }, withSummon, hero.id)).toBe(false);

    // An OBJECT entity (ICON p.95: "Objects ... provide obstruction, cover,
    // and can block line of sight") DOES obstruct.
    const withObject: RuleExecutionContext = {
      ...base,
      state: {
        ...base.state,
        entities: { ...base.state.entities, boulder: { id: 'boulder', type: 'boulder', ownerId: hero.id, positions: [{ x: 4, y: 1 }], state: {} } },
      },
    };
    expect(occupied({ x: 4, y: 1 }, withObject, hero.id)).toBe(true);
  });

  it('ringAround yields the eight neighbors clockwise from north', () => {
    expect(ringAround({ x: 2, y: 2 })).toEqual([
      { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 },
      { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 1 },
    ]);
  });

  it('resolveAttack produces deterministic hits and misses against a known defense', () => {
    const { state, hero, foe } = board();
    state.actors[foe.id].defense = 10;

    const hitCtx = kitContext(state, hero.id, scriptedDice(12));
    const hit = resolveAuthoritativeAttack(hitCtx, sourceActor(hitCtx, hero.id)!, sourceActor(hitCtx, foe.id)!);
    expect(hit.hit).toBe(true);
    expect(hit.attackMutation).toMatchObject({ d20: 12, boon: 0, total: 12, hit: true, critical: false, trueStrike: false, autoHit: false });

    const missCtx = kitContext(state, hero.id, scriptedDice(5));
    const miss = resolveAuthoritativeAttack(missCtx, sourceActor(missCtx, hero.id)!, sourceActor(missCtx, foe.id)!);
    expect(miss.hit).toBe(false);
    expect(miss.attackMutation).toMatchObject({ d20: 5, total: 5, hit: false, critical: false });
  });

  it('resolveAttack applies a boon, true strike, and autohit', () => {
    const { state, hero, foe } = board();
    state.actors[foe.id].defense = 10;

    const boonCtx = kitContext(state, hero.id, scriptedDice(12, 4));
    const booned = resolveAuthoritativeAttack(boonCtx, sourceActor(boonCtx, hero.id)!, sourceActor(boonCtx, foe.id)!, { boons: 1 });
    expect(booned.attackMutation).toMatchObject({ d20: 12, boon: 4, total: 16, hit: true });

    const strikeCtx = kitContext(state, hero.id, scriptedDice(12));
    const struck = resolveAuthoritativeAttack(strikeCtx, sourceActor(strikeCtx, hero.id)!, sourceActor(strikeCtx, foe.id)!, { trueStrike: true });
    expect(struck.attackMutation).toMatchObject({ trueStrike: true, boon: 0, d20: 12 });
    expect(struck.damageProvenance).toEqual({ ignoreDodge: true, ignoreCover: false, ignoreAetherwall: false, bonusFlat: 0 });
    expect(damageMutation(strikeCtx, foe.id, 3, 'miss')).toMatchObject({ ignoreDodge: true });

    const autoCtx = kitContext(state, hero.id, scriptedDice());
    const auto = resolveAuthoritativeAttack(autoCtx, sourceActor(autoCtx, hero.id)!, sourceActor(autoCtx, foe.id)!, { autoHit: true });
    expect(auto.attackMutation).toMatchObject({ autoHit: true, d20: null, boon: 0, total: null, hit: true, critical: false });
  });

  it('propagates high-ground cover immunity through job-kit and core named attacks', () => {
    const { state, hero, foe } = board();
    state.grid.terrain.push({ position: { ...hero.position }, type: 'basic', elevation: 1 });

    const kitCtx = kitContext(state, hero.id, scriptedDice(12, 1));
    const roll = resolveAuthoritativeAttack(kitCtx, sourceActor(kitCtx, hero.id)!, sourceActor(kitCtx, foe.id)!);
    expect(roll.damageProvenance).toMatchObject({ ignoreCover: true });
    expect(damageMutation(kitCtx, foe.id, 3, 'miss')).toMatchObject({ ignoreCover: true });

    const coreCtx: RuleExecutionContext = {
      ...kitContext(state, hero.id, scriptedDice(12, 1, 4)),
      sourceId: 'core:light-attack',
      input: { actorIds: { target: [foe.id] } },
    };
    const mutations = CORE_RULE_RESOLVERS['core:light-attack']!(coreCtx, {} as RuleAction);
    // ICON p.89: an attack from higher elevation ignores cover for its lower
    // target; this must hold for the core named resolver too.
    expect(mutations[1]).toMatchObject({ kind: 'damage', actorId: foe.id, ignoreCover: true });
  });

  it('mutation builders produce the canonical mutation shapes', () => {
    const { state, hero, foe } = board();
    const ctx = kitContext(state, hero.id, scriptedDice());
    expect(damageMutation(ctx, foe.id, 5, 'hit', 'divine')).toMatchObject({
      kind: 'damage', sourceId: 'kit:test', sourceActorId: hero.id, actorId: foe.id, amount: 5, damageType: 'divine', instance: 1, delivery: 'hit', ignoreCover: false,
    });
    expect(conditionMutation(ctx, foe.id, 'slashed')).not.toHaveProperty('duration');
    expect(conditionMutation(ctx, foe.id, 'hatred', 'plus', untilNextTurnEnd)).toMatchObject({
      kind: 'condition', actorId: foe.id, conditionId: 'hatred', operation: 'apply', potency: 'plus', duration: untilNextTurnEnd,
    });
    expect(stateMutation(ctx, hero.id, 'flag', true)).toMatchObject({ kind: 'state', actorId: hero.id, key: 'flag', operation: 'set', value: true });
  });

  it('attackStep builds the canonical weapon attack effect', () => {
    expect(attackStep({ boons: 1 })).toMatchObject({
      kind: 'attack',
      trueStrike: false,
      boons: constant(1),
      onHit: [expect.anything()],
      onMiss: [expect.anything()],
      onCritical: [expect.anything()],
    });
  });

  it('compilation helpers assemble a typed program from a source unit', () => {
    const unit = findRuleSourceUnit('fool:death')!;
    const result = compilation(unit, [action({ name: unit.name, timing: 'use' })], ['effect']);
    expect(result.program).toMatchObject({
      schemaVersion: 1,
      rulesVersion: '1.5',
      id: 'program:fool:death',
      sourceId: 'fool:death',
      name: unit.name,
      classification: 'encounter',
    });
    expect(result.program.actions).toHaveLength(1);
    expect(result.program.actions[0]).toMatchObject({ id: 'default', timing: 'use', costs: [], steps: [], range: null, area: null });
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0]).toMatchObject({ id: 'fool:death:effect:clause', label: 'effect', text: unit.rulesText, complete: true, unsupportedText: '' });
    expect(result.unsupportedClauses).toEqual([]);
  });
});
