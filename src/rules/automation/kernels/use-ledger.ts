/**
 * Use-ledger kernel — the source-ID-free usage gate family
 * (docs/rules-foundations.md non-glossary foundation #8).
 *
 * One durable gate represents "once per turn", "once per round", and "once
 * per combat" with automatic reset at the authoritative lifecycle boundary:
 *
 * - `once-per-round` — a durable `ledger:round:<sourceId>` flag written when
 *   the use fires; a round-start lifecycle recipe clears every actor's round
 *   ledger. This is the F9 reactive job-trait fold's existing gate
 *   (`kernels/trait-reactions.ts` `roundLedgerKey` writes the identical key
 *   format), so the shared gate and F9 can never drift.
 * - `once-per-turn` — a durable `ledger:turn:<sourceId>` flag; a turn-start
 *   lifecycle recipe clears the flag on the actor whose turn begins.
 * - `once-per-combat` — a durable `ledger:combat:<sourceId>` flag that
 *   remains spent for the rest of the encounter (the encounter state ends
 *   with combat, so no reset boundary is needed).
 *
 * The decision is made once at the command boundary and the mark rides the
 * ability's recorded event as a `state` mutation, so replay applies exactly
 * what the command decided and never re-decides whether the gate was open.
 *
 * This module contains no source IDs; `sourceId`/`gateSourceId` are
 * content-owned provenance strings recorded verbatim.
 */
import type { EncounterActor } from '../../types.js';
import type { RuleMutation } from '../primitives/types.js';

export type UseLedgerPeriod = 'turn' | 'round' | 'combat';

/** The durable ruleState key for a usage gate. The round format matches the
 * F9 reactive fold's `ledger:round:<sourceId>` keys exactly. */
export function useLedgerKey(period: UseLedgerPeriod, sourceId: string): string {
  return `ledger:${period}:${sourceId}`;
}

/** Whether the actor's ledger still allows the gated use to fire. */
export function useLedgerAvailable(actor: Pick<EncounterActor, 'ruleState'>, key: string): boolean {
  return !actor.ruleState[key];
}

/** The durable mark mutation: setting the gate's key records the use so a
 * second attempt is rejected until the boundary resets it. */
export function consumeUseLedgerMutation(
  sourceId: string,
  actorId: string,
  period: UseLedgerPeriod,
  gateSourceId: string,
): RuleMutation {
  return {
    kind: 'state',
    sourceId,
    sourceActorId: actorId,
    actorId,
    key: useLedgerKey(period, gateSourceId),
    operation: 'set',
    value: true,
  };
}

/** True when the actor holds any ledger key of the given period (the
 * lifecycle reset recipes' cheap precondition). */
export function holdsUseLedgerKey(actor: Pick<EncounterActor, 'ruleState'>, period: UseLedgerPeriod): boolean {
  const prefix = `ledger:${period}:`;
  return Object.keys(actor.ruleState).some((key) => key.startsWith(prefix));
}
