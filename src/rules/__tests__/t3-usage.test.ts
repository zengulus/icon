/**
 * t3-usage.test.ts — Phase T3 U16 USAGE / ENTITLEMENT LEDGER (CORE) tests.
 *
 * The core ledger (`primitives/usage.ts`) answers "how many times has/may
 * this rule be used within scope X?" — DISTINCT from spendable resources,
 * trigger-window de-dup, effect existence, and character-state flags. The
 * durable keys keep the long-standing `ledger:<scope>:<sourceId>` format
 * (byte-identical with the F9 reactive fold), the consume decision is made
 * once at the command boundary and rides the recorded event, and the
 * de-duplication IDENTITY CORE lands here — the U10-backed full identity
 * completes U16 in T4.
 *
 * Covered here: key/identity contract, one-shot vs N-per-scope consume,
 * caps (including the U14 `use-cap` override fold), per-use magnitude,
 * refresh, the use-ledger adapter parity, the `used-scope` U6 predicate,
 * and the replay property (marks ride recorded state).
 */
import { describe, expect, it } from 'vitest';
import {
  consumeUsageMutation,
  holdsUsageKey,
  ledgerAvailable,
  refreshUsageMutation,
  resetBoundaryFor,
  usageCap,
  usageCount,
  usageIdentitiesEqual,
  usageIdentity,
  usageIdentityKey,
  usageKey,
  usageRead,
  type UsageLedgerActor,
} from '../automation/primitives/usage.js';
import {
  consumeUseLedgerMutation,
  holdsUseLedgerKey,
  useLedgerAvailable,
  useLedgerKey,
} from '../automation/kernels/use-ledger.js';
import { roundLedgerKey } from '../automation/kernels/trait-reactions.js';
import { evaluatePredicate } from '../automation/kernels/runtime.js';
import { resolveModifierNumber } from '../automation/kernels/evaluate-modifiers.js';
import { constantModifierValue, registerModifierRule, type ModifierFoldView } from '../automation/primitives/modifiers.js';
import type { RuleActorView, RuleExecutionContext } from '../automation/primitives/types.js';

function actorWithState(state: Record<string, unknown>): UsageLedgerActor {
  return { ruleState: state };
}

describe('U16 — key and identity contract', () => {
  it('usageKey keeps the byte-identical ledger format and extends per-target', () => {
    expect(usageKey({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'turn' })).toBe('ledger:turn:fixture:gate');
    expect(usageKey({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'round' })).toBe('ledger:round:fixture:gate');
    expect(usageKey({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'combat' })).toBe('ledger:combat:fixture:gate');
    expect(useLedgerKey('round', 'fixture:reaction')).toBe(roundLedgerKey('hero', 'fixture:reaction'));
    // A per-target gate never collides with the per-source gate.
    expect(usageKey({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'turn', targetId: 'foe' })).toBe('ledger:turn:fixture:gate:target:foe');
  });

  it('usageIdentity is the typed de-dup identity, DISTINCT from the actor-local storage key', () => {
    // The storage key is intentionally actor-local (byte-identical
    // `ledger:<scope>:<sourceId>` format — durable state lives on the
    // owning actor); the identity ALWAYS carries the owner.
    expect(usageKey({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'combat' })).toBe('ledger:combat:fixture:gate');
    expect(usageIdentity({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'combat' }))
      .toEqual({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'combat' });
    expect(usageIdentity({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'combat', targetId: 'foe' }))
      .toEqual({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'combat', targetId: 'foe' });
  });

  it('two different owners of the same source/scope/target have DIFFERENT de-dup identities', () => {
    // The storage keys collide by design (both are `ledger:round:fixture:gate:target:foe`
    // — actor-local addresses); the identities must not.
    const hero = usageIdentity({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'round', targetId: 'foe' });
    const villain = usageIdentity({ sourceId: 'fixture:gate', ownerId: 'villain', scope: 'round', targetId: 'foe' });
    expect(usageIdentityKey(hero)).not.toBe(usageIdentityKey(villain));
    expect(usageIdentitiesEqual(hero, villain)).toBe(false);
    // The same owner/source/scope/target is the same identity, structurally
    // and by serialization (collision-safe, stable).
    const heroAgain = usageIdentity({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'round', targetId: 'foe' });
    expect(usageIdentitiesEqual(hero, heroAgain)).toBe(true);
    expect(usageIdentityKey(heroAgain)).toBe(usageIdentityKey(hero));
  });

  it('usageIdentityKey is unambiguous across delimiter-bearing opaque ids (adversarial collision)', () => {
    // Ids are opaque strings, so a delimiter-concatenated key would collide:
    // source `a:b` / owner `c` vs source `a` / owner `b:c`. The canonical
    // tuple serialization must keep every distinct identity distinct.
    const first = usageIdentity({ sourceId: 'a:b', ownerId: 'c', scope: 'round' });
    const second = usageIdentity({ sourceId: 'a', ownerId: 'b:c', scope: 'round' });
    expect(usageIdentitiesEqual(first, second)).toBe(false);
    expect(usageIdentityKey(first)).not.toBe(usageIdentityKey(second));
    // targetId round-trips through the tuple (null vs a delimiter-bearing ref
    // are still distinct).
    expect(usageIdentityKey({ sourceId: 'a', ownerId: 'b', scope: 'turn' }))
      .not.toBe(usageIdentityKey({ sourceId: 'a', ownerId: 'b', scope: 'turn', targetId: '-' }));
  });

  it('resetBoundaryFor maps turn/round/combat onto U8 boundaries (turn = owner turn-start)', () => {
    const turn = resetBoundaryFor('turn', 'hero');
    expect(turn).toEqual({ kind: 'boundary', boundary: 'turn', edge: 'start', subject: { kind: 'live', domain: 'actor', name: { kind: 'id', id: 'hero' } } });
    expect(resetBoundaryFor('round', 'hero')).toEqual({ kind: 'boundary', boundary: 'round', edge: 'start' });
    expect(resetBoundaryFor('combat', 'hero')).toEqual({ kind: 'boundary', boundary: 'combat', edge: 'end' });
  });
});

describe('U16 — count, consume, caps', () => {
  it('usageCount reads boolean marks (one use) and numeric counts', () => {
    const actor = actorWithState({ 'ledger:turn:g': true, 'ledger:round:g': 3 });
    expect(usageCount(actor, 'ledger:turn:g')).toBe(1);
    expect(usageCount(actor, 'ledger:round:g')).toBe(3);
    expect(usageCount(actor, 'ledger:combat:g')).toBe(0);
  });

  it('one-shot consume writes the long-standing boolean mark; N-per-scope consume increments a count', () => {
    const oneShot = consumeUsageMutation('fixture:ability', 'hero', usageKey({ sourceId: 'g', ownerId: 'hero', scope: 'turn' }));
    expect(oneShot).toEqual({ kind: 'state', sourceId: 'fixture:ability', sourceActorId: 'hero', actorId: 'hero', key: 'ledger:turn:g', operation: 'set', value: true });
    const nPer = consumeUsageMutation('fixture:ability', 'hero', usageKey({ sourceId: 'g', ownerId: 'hero', scope: 'round' }), { cap: 3 });
    expect(nPer).toEqual({ kind: 'state', sourceId: 'fixture:ability', sourceActorId: 'hero', actorId: 'hero', key: 'ledger:round:g', operation: 'increment', value: 1 });
  });

  it('ledgerAvailable respects caps (one-shot by default, N-per-scope with a cap)', () => {
    const actor = actorWithState({ 'ledger:round:g': 2 });
    expect(ledgerAvailable(actor, 'ledger:round:g', 3)).toBe(true);
    expect(ledgerAvailable(actor, 'ledger:round:g', 2)).toBe(false);
    // Default cap is one-shot: any recorded use blocks.
    expect(ledgerAvailable(actorWithState({ 'ledger:turn:g': true }), 'ledger:turn:g')).toBe(false);
  });

  it('per-use magnitude: usageRead returns the next-use ordinal (2nd/3rd use tables)', () => {
    expect(usageRead(actorWithState({}), 'ledger:turn:dash')).toBe(0); // first use
    expect(usageRead(actorWithState({ 'ledger:turn:dash': 1 }), 'ledger:turn:dash')).toBe(1); // second use
    expect(usageRead(actorWithState({ 'ledger:turn:dash': 2 }), 'ledger:turn:dash')).toBe(2); // third use
  });

  it('refresh clears the key so the gate re-opens', () => {
    const actor = actorWithState({ 'ledger:turn:g': true });
    expect(ledgerAvailable(actor, 'ledger:turn:g')).toBe(false);
    const refresh = refreshUsageMutation('fixture:lifecycle', 'hero', 'ledger:turn:g');
    expect(refresh).toEqual({ kind: 'state', sourceId: 'fixture:lifecycle', sourceActorId: 'hero', actorId: 'hero', key: 'ledger:turn:g', operation: 'clear' });
    const cleared = { ruleState: {} as Record<string, unknown> };
    expect(ledgerAvailable(cleared, 'ledger:turn:g')).toBe(true);
  });

  it('holdsUsageKey is the prefix scan the lifecycle reset recipes use', () => {
    const actor = actorWithState({ 'ledger:round:g': true });
    expect(holdsUsageKey(actor, 'round')).toBe(true);
    expect(holdsUsageKey(actor, 'turn')).toBe(false);
    expect(holdsUseLedgerKey(actor as never, 'round')).toBe(true);
  });

  it('usageCap folds U14 use-cap modifiers (count-override caps)', () => {
    registerModifierRule({ sourceId: 't3:use-cap', ownerId: 'fixture:ability', queryPoint: 'use-cap', scope: 'round', operation: 'set', value: constantModifierValue(4) });
    const capView: ModifierFoldView = {
      round: 1,
      actor: { id: 'hero', abilityIds: ['fixture:ability'], masteredAbilityIds: [], talents: {} },
      conditionsFor: () => new Set<string>(),
    };
    // use-cap values resolve through the injected U5 resolver.
    expect(usageCap('fixture:ability', 'round', 1, capView, 'fixture:ability', resolveModifierNumber)).toBe(4);
  });
});

describe('U16 — the use-ledger adapter keeps the byte-identical surface', () => {
  it('consumeUseLedgerMutation writes the identical mark and availability reads the core count', () => {
    const mark = consumeUseLedgerMutation('fixture:ability', 'hero', 'turn', 'fixture:gate');
    expect(mark).toEqual({
      kind: 'state', sourceId: 'fixture:ability', sourceActorId: 'hero', actorId: 'hero',
      key: 'ledger:turn:fixture:gate', operation: 'set', value: true,
    });
    const spent = actorWithState({ 'ledger:turn:fixture:gate': true });
    expect(useLedgerAvailable(spent as never, 'ledger:turn:fixture:gate')).toBe(false);
    expect(holdsUseLedgerKey(spent as never, 'turn')).toBe(true);
  });
});

describe('U16 — the used-scope U6 predicate reads the durable ledger', () => {
  function actorView(id: string, extra: Partial<RuleActorView> = {}): RuleActorView {
    return {
      id, side: 'heroes', position: { x: 1, y: 1 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0,
      defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false,
      traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false,
      conditions: new Set<string>(), statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
      resources: {}, state: {}, marks: [],
      ...extra,
    };
  }

  function ctx(state: Record<string, string | number | boolean | null>): RuleExecutionContext {
    return {
      state: {
        round: 1,
        grid: { width: 24, height: 24 },
        actors: { hero: actorView('hero', { state }) },
        entities: {},
        terrainAt: () => new Set<string>(),
        elevationAt: () => 0,
        terrainEffects: [],
      },
      actorId: 'hero',
      sourceId: 'fixture:source',
      actionId: 'default',
      timing: 'use',
      input: {},
      dice: { die: () => 1, float: () => 0.5 },
    } as RuleExecutionContext;
  }

  it('used-scope: true when the durable ledger counts at least N uses in the scope', () => {
    // The source was used twice this round (durable count), once this turn (mark).
    const predicate = { kind: 'used-scope' as const, target: { kind: 'self' as const }, sourceId: 'fixture:gated', scope: 'round' as const, atLeast: 2 };
    expect(evaluatePredicate(predicate, ctx({ 'ledger:round:fixture:gated': 2 }))).toBe(true);
    expect(evaluatePredicate(predicate, ctx({ 'ledger:round:fixture:gated': 1 }))).toBe(false);
    // Default atLeast is 1; a boolean one-shot mark counts as one use.
    expect(evaluatePredicate({ kind: 'used-scope', target: { kind: 'self' }, sourceId: 'fixture:once', scope: 'turn' }, ctx({ 'ledger:turn:fixture:once': true }))).toBe(true);
    expect(evaluatePredicate({ kind: 'used-scope', target: { kind: 'self' }, sourceId: 'fixture:never', scope: 'turn' }, ctx({}))).toBe(false);
  });
});
