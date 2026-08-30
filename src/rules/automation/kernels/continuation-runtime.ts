/**
 * continuation-runtime.ts — U12 resume dispatch kernel.
 *
 * The U12 authority (`primitives/continuation.ts`) owns the armed record and
 * the pure resume gate; THIS kernel owns the deferred-rule EXECUTION seam:
 * content rows register source-specific deferred-rule resolvers against a
 * program id, and `resumeDueContinuations` fires every armed continuation
 * whose Clock/Fact trigger is due at a boundary — through the SAME shared
 * mutation authority (`applyRuleMutations`) every other reducer path uses,
 * never a second rules engine.
 *
 * Replay safety: the resume gate is a pure function of the recorded trigger
 * + the observed boundary (zero fresh RNG, zero fresh decisions, zero
 * mutable-availability re-checks). The resolver row executes recorded
 * continuation data against THEN-CURRENT state (LIVE refs re-resolve;
 * CAPTURED refs/values are durable literals) and returns deterministic
 * mutations; `applyRuleMutations` applies them exactly as event replay
 * applies them. An armed continuation whose trigger never arrives stays
 * pending (the boundary drains deterministically by simply never firing
 * it); an expired continuation is removed without resuming.
 *
 * Boundary (documented): a deferred-rule resolver may consume NO dice and
 * make NO choices — dice/choices belong to the command/window boundary and
 * ride recorded events. The resolver reads current state and emits
 * mutations only.
 */
import type { ArmedContinuation, ContinuationPayload, RuleMutation } from '../primitives/types.js';
import { resumeContinuation } from '../primitives/continuation.js';
import type { ClockObservation } from '../primitives/scope.js';
import type { Fact } from '../primitives/facts.js';
import type { EncounterState } from '../../types.js';
import { applyRuleMutations } from './encounter-adapter.js';

/** A deferred-rule resolver row: source-specific resume behavior registered
 * against the continuation's `programId` (content-owned; the kernel never
 * branches on source ids — it dispatches on the recorded key). */
export interface ContinuationResolver {
  /** The exact program id that armed continuations this row resolves. */
  programId: string;
  /** The deterministic resume body: pure state reads + mutation emission.
   * Must consume NO dice and make NO choices. */
  resolve(state: EncounterState, continuation: ArmedContinuation): RuleMutation[];
}

const continuationResolvers: Record<string, ContinuationResolver> = {};

/** Register a deferred-rule resolver row (content). Registration replaces
 * the row for the same program id — a single authority per program. */
export function registerContinuationResolver(resolver: ContinuationResolver): void {
  continuationResolvers[resolver.programId] = resolver;
}

/** The closed registry (registration order = declaration order; dispatch is
 * by recorded program id, never by registration order). */
export function continuationResolverFor(programId: string): ContinuationResolver | undefined {
  return continuationResolvers[programId];
}

/** Resume every armed continuation whose trigger is due at the observed
 * boundary. FAIL CLOSED: a due deferred-rule continuation without a
 * registered resolver row is a wiring error — the boundary rejects rather
 * than silently dropping the rule (an unregistered program id can never be
 * declared executable). Fired continuations are removed from the durable
 * collection; pending/expired ones stay (expired ones are dropped without
 * resuming). The resolver's mutations apply through the shared mutation
 * authority, so replay reproduces the identical application. */
export function resumeDueContinuations(
  state: EncounterState,
  now: ClockObservation,
  facts: readonly Fact[] = [],
): void {
  const stillArmed: ArmedContinuation[] = [];
  for (const continuation of state.continuations) {
    const decision = resumeContinuation(continuation, now, facts);
    if (!decision.ok) {
      if (decision.status !== 'expired') stillArmed.push(continuation);
      continue;
    }
    const payload = decision.payload;
    if (payload.kind === 'held-result') {
      // Held results waiting on a window are drained by the window machinery
      // (U13); a held result never auto-resumes at a boundary. Keep it armed.
      stillArmed.push(continuation);
      continue;
    }
    const resolver = continuationResolverFor(payload.resumeId ?? continuation.programId);
    if (!resolver) {
      throw new Error(`Cannot resume continuation ${continuation.id}: no deferred-rule resolver is registered for program ${payload.resumeId ?? continuation.programId}.`);
    }
    // Execute THEN-CURRENT state: the resolver re-resolves LIVE refs against
    // the state at resume time; captured refs/values are literals. Emitted
    // mutations apply through the shared authority — deterministic, no dice.
    applyRuleMutations(state, resolver.resolve(state, continuation));
  }
  state.continuations = stillArmed;
}

/** Convenience type surface for content rows. */
export type { ArmedContinuation, ContinuationPayload };
