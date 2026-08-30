/**
 * t4-effect-exists.test.ts — Phase T4 U6 completion: `effect-still-exists`.
 *
 * The predicate reads through the U10 fact/instance seam
 * (`effectExistsLive`) against the target's LIVE effect surfaces — the
 * general active-effect state authority stays in its domain; U6 only reads
 * through the generic reference/fact seam. After the T4 corrective pass the
 * RuleActorView carries the authoritative DURABLE instance id + ownership, so
 * a specific-instance read is EXACT (never a synthesized key) and only a
 * genuinely ambiguous coexisting read without an exact id FAILS CLOSED.
 *
 * Covered here: true for the specific live instance by its durable id, then
 * false after it ends/removes; coexisting same-source instances never alias
 * (each names its own durable id); owner-sensitive mark reads distinguish
 * owners; and deterministic evaluation.
 */
import { describe, expect, it } from 'vitest';
import { evaluatePredicate } from '../automation/kernels/runtime.js';
import { effectExistsLive, type EffectInstanceIdentity } from '../automation/primitives/facts.js';
import type { RuleActorView, RuleExecutionContext } from '../automation/primitives/types.js';

function actorView(id: string, overrides: Partial<RuleActorView> = {}): RuleActorView {
  return {
    id, side: 'heroes', position: { x: 1, y: 1 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0,
    defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false,
    traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false,
    conditions: new Set<string>(), statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
    resources: {}, state: {}, marks: [],
    ...overrides,
  };
}

function ctx(actorId: string, overrides: Partial<RuleActorView> = {}): RuleExecutionContext {
  return {
    state: {
      round: 1,
      grid: { width: 24, height: 24 },
      actors: { [actorId]: actorView(actorId, overrides) },
      entities: {},
      terrainAt: () => new Set<string>(),
      elevationAt: () => 0,
      terrainEffects: [],
    },
    actorId,
    sourceId: 'fixture:source',
    actionId: 'default',
    timing: 'use',
    input: {},
    dice: { die: () => 1, float: () => 0.5 },
  } as RuleExecutionContext;
}

describe('U6 — effect-still-exists via the U10 instance seam', () => {
  it('true for the specific live condition instance, then false after it ends/removes', () => {
    const live = ctx('hero', { conditions: new Set(['weakened']) });
    const predator = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'condition' as const, effectId: 'weakened' };
    expect(evaluatePredicate(predator, live)).toBe(true);
    // The instance ends/removes → the specific instance no longer exists.
    const removed = ctx('hero', { conditions: new Set<string>() });
    expect(evaluatePredicate(predator, removed)).toBe(false);
  });

  it('status and stance read their live surfaces (stance by durable instance id)', () => {
    const status = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'status' as const, effectId: 'sealed' };
    expect(evaluatePredicate(status, ctx('hero', { statuses: [{ id: 'sealed', potency: 'normal' }] }))).toBe(true);
    expect(evaluatePredicate(status, ctx('hero', { statuses: [] }))).toBe(false);
    const stance = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'stance' as const, effectId: 'pattern' };
    expect(evaluatePredicate(stance, ctx('hero', { stance: { id: 'stance:pattern:1', ownerId: 'hero', stanceId: 'pattern' } }))).toBe(true);
    expect(evaluatePredicate(stance, ctx('hero', { stance: null }))).toBe(false);
    // A stance fact naming the durable instance id asks whether THAT SAME
    // instance still exists — exact, never a synthesized key.
    const specific = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'stance' as const, effectId: 'pattern', instanceId: 'stance:pattern:1' };
    expect(evaluatePredicate(specific, ctx('hero', { stance: { id: 'stance:pattern:1', ownerId: 'hero', stanceId: 'pattern' } }))).toBe(true);
    expect(evaluatePredicate(specific, ctx('hero', { stance: null }))).toBe(false);
  });

  it('a persistent effect answers by its specific durable id; coexisting instances never alias', () => {
    const aura = { sourceId: 'fixture:gate', effectId: 'aura', ownerId: 'hero', id: 'eff:aura:1', radius: 2 };
    // Any-instance presence: one aura exists.
    expect(evaluatePredicate(
      { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'persistent' as const, effectId: 'aura', sourceId: 'fixture:gate' },
      ctx('hero', { activeEffects: [aura] }),
    )).toBe(true);
    expect(evaluatePredicate(
      { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'persistent' as const, effectId: 'aura', sourceId: 'fixture:gate' },
      ctx('hero', { activeEffects: [] }),
    )).toBe(false);
    // A SPECIFIC instance by its durable id: exact. Removing instance A does
    // not make instance B disappear (coexisting instances keep distinct ids).
    const specificA = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'persistent' as const, effectId: 'aura', sourceId: 'fixture:gate', instanceId: 'eff:aura:1' };
    const both = [{ sourceId: 'fixture:gate', effectId: 'aura', ownerId: 'hero', id: 'eff:aura:1' }, { sourceId: 'fixture:gate', effectId: 'aura', ownerId: 'hero', id: 'eff:aura:2' }];
    expect(evaluatePredicate(specificA, ctx('hero', { activeEffects: both }))).toBe(true);
    // Instance A removed → A-specific read false, B still present as its own id.
    const onlyB = [{ sourceId: 'fixture:gate', effectId: 'aura', ownerId: 'hero', id: 'eff:aura:2' }];
    expect(evaluatePredicate(specificA, ctx('hero', { activeEffects: onlyB }))).toBe(false);
    expect(evaluatePredicate(
      { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'persistent' as const, effectId: 'aura', sourceId: 'fixture:gate', instanceId: 'eff:aura:2' },
      ctx('hero', { activeEffects: onlyB }),
    )).toBe(true);
  });

  it('effectExistsLive: exact durable-id reads, fail closed only on a genuinely ambiguous specific read', () => {
    const view = actorView('hero', { activeEffects: [{ id: 'eff:a', sourceId: 'a', effectId: 'aura', ownerId: 'hero' }] });
    const exact: EffectInstanceIdentity = { kind: 'persistent', sourceId: 'a', targetId: 'hero', effectId: 'aura', instanceId: 'eff:a' };
    expect(effectExistsLive(view, exact)).toEqual({ ok: true, exists: true });
    const notPresent: EffectInstanceIdentity = { kind: 'persistent', sourceId: 'a', targetId: 'hero', effectId: 'aura', instanceId: 'eff:missing' };
    expect(effectExistsLive(view, notPresent)).toEqual({ ok: true, exists: false });
    // A specific coexisting read WITHOUT an exact id is ambiguous → fail closed.
    const two = actorView('hero', {
      activeEffects: [
        { id: 'eff:a', sourceId: 'a', effectId: 'aura', ownerId: 'hero' },
        { id: 'eff:b', sourceId: 'a', effectId: 'aura', ownerId: 'hero' },
      ],
    });
    expect(effectExistsLive(two, { kind: 'persistent', sourceId: 'a', targetId: 'hero', effectId: 'aura' })).toEqual({ ok: false, problem: 'effect-instance-unrepresentable' });
  });

  it('a mark placed by owner A does not satisfy owner B endash identical markId', () => {
    const placeA = actorView('foe', { marks: [{ id: 'mark:incubus:1', markId: 'incubus', ownerId: 'allyA' }] });
    const ownerSensitive: EffectInstanceIdentity = { kind: 'mark', sourceId: 'fixture:source', targetId: 'foe', effectId: 'incubus', ownerSensitive: true, ownerId: 'allyB' };
    expect(effectExistsLive(placeA, ownerSensitive)).toEqual({ ok: true, exists: false });
    const ownerA: EffectInstanceIdentity = { kind: 'mark', sourceId: 'fixture:source', targetId: 'foe', effectId: 'incubus', ownerSensitive: true, ownerId: 'allyA' };
    expect(effectExistsLive(placeA, ownerA)).toEqual({ ok: true, exists: true });
  });

  it('deterministic: the same live view answers identically (replay)', () => {
    const live = ctx('hero', { conditions: new Set(['weakened']) });
    const predator = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'condition' as const, effectId: 'weakened' };
    expect(evaluatePredicate(predator, live)).toBe(evaluatePredicate(predator, live));
  });
});