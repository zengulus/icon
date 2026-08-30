/**
 * usage.ts — U16 USAGE / ENTITLEMENT LEDGER (CORE form, Phase T3).
 *
 * "How many times has/may this rule be used or triggered within Scope X?" —
 * DISTINCT from the spendable-resource economy (a resource spend consumes a
 * pool; a usage entitlement counts uses against a scope and resets at the
 * scope's boundary). ICON gates with scoped entitlement everywhere:
 * once-per-turn / once-per-round / N-per-round / N-per-combat / first-use
 * (p.99, p.105), "once per ability even when multiple routes would trigger
 * it" (p.105), once-per-target, dangerous-terrain once per turn, slashed
 * once per turn, one attack-tag ability per turn (p.129 Special), the
 * no-repeat ability rule, limit break once/combat, Vigilance once per
 * trigger (p.105), interrupt refresh, and per-use magnitude ("2nd/3rd use
 * dashes 3/2/1").
 *
 * The ledger is DURABLE STATE with a typed vocabulary: a use decision is
 * made ONCE at the command boundary and recorded as a `state` mutation
 * (`consumeUsageMutation`) riding the ability's event; replay applies the
 * recorded marks and never re-decides whether a gate was open. The durable
 * keys keep the engine's long-standing byte-identical format
 * (`ledger:<scope>:<sourceId>`, shared with the F9 reactive fold and the
 * use-ledger kernel), so checkpoint state and the lifecycle reset recipes
 * stay valid.
 *
 * T3 CORE vs the U10 completion (staged DAG): the core ledger — keys,
 * gates, caps, counts, consume/refresh, per-use magnitude, and the
 * de-duplication IDENTITY key — needs only U1 (owner/reference keys) + U8
 * (the reset Clock) and lands here. The FULL de-dup identity for trigger
 * families additionally reads U10 facts (\"did THIS trigger event already
 * happen?\") and completes U16 in T4. `usageIdentity` below is the CORE
 * identity; it is NOT described as complete until its U10 fact read exists.
 *
 * Foundation: no source IDs (sourceId is a content-owned provenance key),
 * no kernel imports. Uses U1 reference-key identity (ownerId/targetId are
 * the U1 reference-key forms) and U8 boundaries (the reset Clock per
 * period); folds U14 `use-cap` modifier rules for count-override caps.
 */
import type { BoundaryRef } from './scope.js';
import type { RuleMutation } from './types.js';
import type { ModifierFoldView } from './modifiers.js';
import { foldNumberModifiers } from './modifiers.js';

/** The reset boundaries the core ledger understands. Each maps to a U8
 * boundary on the shared Clock: turn (the actor's own next turn-start),
 * round (round-start), combat (never — the encounter ends with combat). */
export type UsagePeriod = 'turn' | 'round' | 'combat';

/** The typed identity of one usage ledger entry: which source unit, used by
 * which owner (the U1 reference-key form), optionally against which target,
 * within which scope. */
export interface UsageKeySpec {
  /** The gated rule/source unit id (provenance key, never parsed). */
  sourceId: string;
  /** The owning actor id — the durable state lives on this actor, so the
   * owner is the actor whose ruleState holds the key. */
  ownerId: string;
  /** Optional target reference id for per-target gates (once-per-target). */
  targetId?: string;
  scope: UsagePeriod;
}

/** The canonical durable state key for a usage entry. Byte-identical to the
 * engine's long-standing `ledger:<period>:<sourceId>` format (the F9
 * reactive fold's `roundLedgerKey` and the use-ledger kernel write exactly
 * this key), so the shared gate, the F9 fold, and the lifecycle reset
 * recipes can never drift. An optional target ref extends the key with a
 * `:target:<id>` suffix — a per-target gate never collides with the
 * per-source gate. */
export function usageKey(spec: UsageKeySpec): string {
  const base = `ledger:${spec.scope}:${spec.sourceId}`;
  return spec.targetId === undefined ? base : `${base}:target:${spec.targetId}`;
}

/** The CORE de-duplication identity: the canonical key for \"one use of this
 * rule by this owner against this target within this scope\". The FULL
 * trigger-family de-dup identity additionally reads U10 facts and completes
 * in T4 — this CORE key is the T3 part that is valid without U10. */
export function usageIdentity(spec: UsageKeySpec): string {
  return usageKey(spec);
}

/** The U8 reset boundary for a period: turn gates reset at the owner's own
 * next turn-start, round gates at the next round-start, combat gates never
 * reset (the encounter ends with combat). */
export function resetBoundaryFor(period: UsagePeriod, ownerId: string): BoundaryRef {
  switch (period) {
    case 'turn':
      return { kind: 'boundary', boundary: 'turn', edge: 'start', subject: { kind: 'live', domain: 'actor', name: { kind: 'id', id: ownerId } } };
    case 'round':
      return { kind: 'boundary', boundary: 'round', edge: 'start' };
    case 'combat':
      return { kind: 'boundary', boundary: 'combat', edge: 'end' };
  }
}

/** The minimal actor read surface for the ledger: the durable ruleState the
 * keys live in. Satisfied by EncounterActor and the rule runtime view. */
export interface UsageLedgerActor {
  ruleState: Readonly<Record<string, unknown>>;
}

/** The recorded use count for a key: a boolean true counts as one use, a
 * number is its own count, absent is zero. Deterministic — replay reads the
 * same durable marks. */
export function usageCount(actor: UsageLedgerActor, key: string): number {
  const value = actor.ruleState[key];
  if (value === true) return 1;
  if (typeof value === 'number') return Math.max(0, Math.floor(value));
  return 0;
}

/** Whether the ledger still allows a use: the recorded count is below the
 * cap. Absent a cap the gate is one-shot (count < 1), matching the
 * long-standing use-ledger availability. */
export function ledgerAvailable(actor: UsageLedgerActor, key: string, cap: number = 1): boolean {
  return usageCount(actor, key) < cap;
}

/** The effective per-scope cap for a source unit: the base cap after every
 * registered U14 `use-cap` modifier applies (the use-count-override family:
 * \"use count override\", resource-cap overrides). Folds through the shared
 * modifier registry at the `use-cap` query point. */
export function usageCap(
  sourceId: string,
  scope: UsagePeriod,
  baseCap: number,
  view: ModifierFoldView,
  ownerAbilityId: string,
): number {
  const folded = foldNumberModifiers('use-cap', scope, baseCap, ownerAbilityId, view);
  return Math.max(0, Math.floor(folded));
}

/**
 * The durable consume mutation: records one use so a second attempt is
 * rejected until the reset boundary. One-shot gates (cap 1) write the
 * long-standing boolean `set true` mark (byte-identical to
 * `consumeUseLedgerMutation`); N-per-scope gates increment a durable count.
 * The decision is made once at the command boundary and the mark rides the
 * recorded event — replay never re-decides.
 */
export function consumeUsageMutation(
  sourceId: string,
  actorId: string,
  key: string,
  options: { cap?: number; amount?: number } = {},
): RuleMutation {
  const cap = options.cap ?? 1;
  const amount = options.amount ?? 1;
  if (cap === 1 && amount === 1) {
    return {
      kind: 'state',
      sourceId,
      sourceActorId: actorId,
      actorId,
      key,
      operation: 'set',
      value: true,
    };
  }
  return {
    kind: 'state',
    sourceId,
    sourceActorId: actorId,
    actorId,
    key,
    operation: 'increment',
    value: amount,
  };
}

/** The durable refresh mutation: clears a usage key at its reset boundary so
 * the gate re-opens. The lifecycle reset recipes already clear
 * `ledger:turn:*` / `ledger:round:*` by prefix; this is the typed
 * per-key surface for refresh hooks. */
export function refreshUsageMutation(
  sourceId: string,
  actorId: string,
  key: string,
): RuleMutation {
  return {
    kind: 'state',
    sourceId,
    sourceActorId: actorId,
    actorId,
    key,
    operation: 'clear',
  };
}

/** Per-use magnitude read: the ORDINAL of the next use (0 before the first
 * use, 1 after the first, …). Consumers key per-use magnitude tables on the
 * ordinal — \"2nd/3rd use dashes 3/2/1\" reads `usageRead(key)` at the
 * command boundary, and the magnitude rides the recorded use. */
export function usageRead(actor: UsageLedgerActor, key: string): number {
  return usageCount(actor, key);
}

/** True when the actor holds any usage key of the given period (the
 * lifecycle reset recipes' cheap precondition). */
export function holdsUsageKey(actor: UsageLedgerActor, period: UsagePeriod): boolean {
  const prefix = `ledger:${period}:`;
  return Object.keys(actor.ruleState).some((key) => key.startsWith(prefix));
}
