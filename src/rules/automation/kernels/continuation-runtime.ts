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
import type { ArmedContinuation, ContinuationPayload, RuleChoice, RuleMutation } from '../primitives/types.js';
import { continuationOrderKey, resumeContinuation } from '../primitives/continuation.js';
import type { ClockObservation } from '../primitives/scope.js';
import type { Fact } from '../primitives/facts.js';
import type { EncounterState } from '../../types.js';
import { applyRuleMutations } from './encounter-adapter.js';
import { openDecisionWindow } from './decision-window.js';

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

/** A DECISION continuation row (U13): a deferred rule whose trigger opens a
 * player/GM decision window instead of auto-resolving. The source's "may"/
 * "can" language is preserved — the engine never chooses a default.
 *
 * - `consume` runs at window-open (the boundary where the trigger fired):
 *   deterministic mutations that retire the triggering resource (e.g. the
 *   Great Giorgios mark — the challenge's opportunity passed at the marked
 *   foe's turn end, whether the user rushes or not).
 * - `resolve` runs at answer time when the user accepts: deterministic
 *   mutations computed against THEN-CURRENT state at the command boundary
 *   and recorded on the answer event (no dice, no choices — the decision
 *   itself is the recorded command input).
 *
 * U12 itself stays choice-free: the DECISION lives in the U13 window;
 * U12 only carries the deferred rule (what will resume). */
export interface DecisionContinuationRow {
  /** The exact program id that armed continuations this row gates. */
  programId: string;
  /** The U4 choice spec the window offers (accept/decline and beyond). */
  choice: RuleChoice;
  /** Applied at window-open: deterministic consumption mutations. */
  consume(state: EncounterState, continuation: ArmedContinuation): RuleMutation[];
  /** Applied at answer time on accept: deterministic THEN-CURRENT mutations. */
  resolve(state: EncounterState, continuation: ArmedContinuation): RuleMutation[];
}

const continuationResolvers: Record<string, ContinuationResolver> = {};
const decisionContinuationRows: Record<string, DecisionContinuationRow> = {};

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

/** Register a DECISION continuation row (content): the program's deferred
 * rule opens a U13 choice window at its trigger instead of auto-resolving. */
export function registerDecisionContinuation(row: DecisionContinuationRow): void {
  decisionContinuationRows[row.programId] = row;
}

/** The closed decision registry (dispatch by recorded program id). */
export function decisionContinuationFor(programId: string): DecisionContinuationRow | undefined {
  return decisionContinuationRows[programId];
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
  const due: ArmedContinuation[] = [];
  for (const continuation of state.continuations) {
    const decision = resumeContinuation(continuation, now, facts);
    if (!decision.ok) {
      if (decision.status !== 'expired') stillArmed.push(continuation);
      continue;
    }
    const payload = decision.payload;
    if (payload.kind === 'held-result') {
      // Held results waiting on a window are drained by the window machinery
      // (U13); a held result never auto-resumes at a boundary (a window-
      // gated held result is never due at a Clock/Fact boundary at all).
      // Keep it armed.
      stillArmed.push(continuation);
      continue;
    }
    due.push(continuation);
  }
  // U17 ordering identity: the RESUME sequence follows each continuation's
  // declared ordering policy (else its durable identity) — NEVER the raw
  // `state.continuations` iteration order. Permuting the collection cannot
  // change the resume sequence.
  due.sort((first, second) => {
    const firstKey = continuationOrderKey(first);
    const secondKey = continuationOrderKey(second);
    if (firstKey !== secondKey) return firstKey < secondKey ? -1 : 1;
    return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
  });
  for (const continuation of due) {
    const payload = continuation.payload;
    // Held results never reach this loop: window-gated held results are kept
    // armed above (drained by U13 window machinery), and a boundary-resume
    // of a held result is a wiring error — fail closed rather than resume
    // an already-determined result outside its owning window.
    if (payload.kind === 'held-result') {
      throw new Error(`Cannot resume held-result continuation ${continuation.id} at a boundary: it is gated by its owning decision window.`);
    }
    // U13: a DECISION continuation opens a choice window at its trigger
    // instead of auto-resolving — the source's "may"/"can" language is
    // preserved (the engine never chooses a default). The continuation is
    // consumed (it armed the window); the recorded answer later resolves it.
    const decisionRow = decisionContinuationFor(payload.resumeId ?? continuation.programId);
    if (decisionRow) {
      const ownerId = continuation.ownerRef.kind === 'captured-actor'
        ? continuation.ownerRef.actorId
        : undefined;
      if (ownerId === undefined) {
        throw new Error(`Cannot open a decision window for continuation ${continuation.id}: the owner reference is not a single actor.`);
      }
      const id = `decision:${continuation.id}`;
      openDecisionWindow(state, {
        id,
        kind: 'choice',
        actorId: ownerId,
        provenance: { sourceId: continuation.programId },
        heldPayload: continuation,
        choice: decisionRow.choice,
      });
      // The trigger fired: consume the triggering resource deterministically
      // (the window-open consumption mutations, e.g. the mark removal).
      applyRuleMutations(state, decisionRow.consume(state, continuation));
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
