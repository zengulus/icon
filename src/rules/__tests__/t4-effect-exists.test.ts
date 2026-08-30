/**
 * t4-effect-exists.test.ts — Phase T4 U6 completion: `effect-still-exists`.
 *
 * The predicate reads through the U10 fact/instance seam
 * (`effectExistsLive`) against the target's LIVE effect surfaces — the
 * general active-effect state authority stays in its domain; U6 only reads
 * through the generic reference/fact seam and FAILS CLOSED when the required
 * instance identity cannot be represented on the projected view.
 *
 * Covered here: true for the specific live instance then false after it
 * ends/removes, coexisting same-source instances not aliasing (specific
 * instance → fail closed, never guess), persistent any-instance presence,
 * and deterministic evaluation.
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

  it('status and stance read their live surfaces', () => {
    const status = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'status' as const, effectId: 'sealed' };
    expect(evaluatePredicate(status, ctx('hero', { statuses: [{ id: 'sealed', potency: 'normal' }] }))).toBe(true);
    expect(evaluatePredicate(status, ctx('hero', { statuses: [] }))).toBe(false);
    const stance = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'stance' as const, effectId: 'pattern' };
    expect(evaluatePredicate(stance, ctx('hero', { stance: { stanceId: 'pattern' } }))).toBe(true);
    expect(evaluatePredicate(stance, ctx('hero', { stance: null }))).toBe(false);
  });

  it('a persistent effect is present via any-instance; a specific coexisting instance fails closed (never aliases)', () => {
    const a = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'persistent' as const, effectId: 'aura', sourceId: 'fixture:gate' };
    // Any-instance presence: one aura exists.
    expect(evaluatePredicate(a, ctx('hero', { activeEffects: [{ sourceId: 'fixture:gate', effectId: 'aura', radius: 2 }] }))).toBe(true);
    expect(evaluatePredicate(a, ctx('hero', { activeEffects: [] }))).toBe(false);
    // A SPECIFIC instance key is not representable on the projected view
    // (only sourceId/effectId/radius) → fail closed, never guess which one.
    const specific = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'persistent' as const, effectId: 'aura', sourceId: 'fixture:gate', instanceKey: 'inst:persistent:fixture:gate:hero:aura#0' };
    expect(() => evaluatePredicate(specific, ctx('hero', { activeEffects: [{ sourceId: 'fixture:gate', effectId: 'aura' }] }))).toThrow(/cannot be disambiguated/);
  });

  it('effectExistsLive returns the discriminated fail-closed result (primitive level)', () => {
    const view = actorView('hero', { activeEffects: [{ sourceId: 'a', effectId: 'aura' }] });
    const anyIdentity: EffectInstanceIdentity = { kind: 'persistent', sourceId: 'a', targetId: 'hero', effectId: 'aura', anyInstance: true };
    expect(effectExistsLive(view, anyIdentity)).toEqual({ ok: true, exists: true });
    const specific: EffectInstanceIdentity = { kind: 'persistent', sourceId: 'a', targetId: 'hero', effectId: 'aura', instanceKey: 'inst:persistent:a:hero:aura#0' };
    expect(effectExistsLive(view, specific)).toEqual({ ok: false, problem: 'effect-instance-unrepresentable' });
    // Two different owners' conditions are distinct by effect id (the live
    // surface has no owner dimension); presence is honest for the id.
    expect(effectExistsLive(actorView('a', { conditions: new Set(['weakened']) }), { kind: 'condition', sourceId: 'x', targetId: 'a', effectId: 'weakened' })).toEqual({ ok: true, exists: true });
  });

  it('deterministic: the same live view answers identically (replay)', () => {
    const live = ctx('hero', { conditions: new Set(['weakened']) });
    const predator = { kind: 'effect-still-exists' as const, target: { kind: 'self' as const }, effectKind: 'condition' as const, effectId: 'weakened' };
    expect(evaluatePredicate(predator, live)).toBe(evaluatePredicate(predator, live));
  });
});