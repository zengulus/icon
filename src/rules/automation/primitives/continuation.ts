/**
 * continuation.ts — U12 CONTINUATION / SUSPENSION: the single durable
 * authority for suspended/future execution.
 *
 * The core semantic distinction is explicit and impossible to blur:
 *
 *   1. **DEFERRED RULE** — something is armed now but executes later against
 *      THEN-CURRENT game state (ICON Delay at the start of the slow turn,
 *      p.87; end-of-turn detonations; mark detonations; "at the start of its
 *      next turn" clauses, p.94/p.105).
 *   2. **HELD RESULT** — a result has already been determined and is merely
 *      waiting for a boundary/window to close. It is NEVER recomputed,
 *      rerolled, or replaced merely because it resumed later (Sucker Punch
 *      p.143: the original save result already exists when the interrupt
 *      becomes available — a reroll is a NEW recorded result caused by the
 *      interrupt, not recomputation of the original save).
 *
 * Replay semantics: `armContinuation` is a pure construction; the resume
 * gate (`resumeContinuation`) is a pure deterministic function of the
 * continuation's recorded trigger + the observed Clock/Fact record + the
 * recorded epoch — zero fresh decisions, zero fresh RNG. CAPTURED refs and
 * captured values are durable literals; LIVE refs re-resolve against
 * then-current state at resume time. HELD RESULT payloads resume exactly as
 * recorded.
 *
 * Non-responsibilities: NOT the scheduler (clocks/scheduler tell it WHEN a
 * trigger occurs); NOT U13 (it carries what will resume, it does not decide
 * who gets a reaction window); NOT RNG; NOT a query language (U3 owns
 * eligibility); NOT role semantics beyond carrying U2 roles.
 *
 * Dependencies: U1 (references, LIVE/CAPTURED), U2 (roles — carried
 * opaquely as Reference<'actor'> for owner/controller), U8 (Clock/Scope +
 * ClockObservation), U10 (Fact kinds for fact triggers), U17 (orderingKey).
 * No source IDs, no kernel imports, no per-source branches: source-specific
 * resume behavior is registered OUTSIDE this primitive (content resolver
 * rows) and dispatched by the kernel by the continuation's program id.
 */
import type { Position } from '../../types.js';
import { type Fact } from './facts.js';
import type { Binder, Reference } from './reference.js';
import type { ClockObservation, Scope } from './scope.js';
import { boundaryEquals, boundaryReached, scopeSatisfied, type BoundaryRef } from './scope.js';
import { orderingKey, type OrderingPolicy } from './ordering.js';
import type { RuleEffect, RuleMutation } from './types.js';

/** What makes an armed continuation become due. Either a U8 Clock boundary
 * (relative clocks need the epoch recorded at arm time) or a recorded U10
 * Fact outcome (a specific fact kind must be present in the observed fact
 * history).
 *
 * Fact triggers are CORRELATED to the exact causal instance: when the arming
 * site knows the triggering fact's deterministic `instanceId`, it records it
 * (`instanceId`) so an UNRELATED fact of the same kind can never satisfy the
 * continuation — two same-kind continuations in the same resolution never
 * cross-fire. Without a recorded instance the trigger matches by kind alone
 * (the documented coarse seam for DEFERRED rules that have no causal
 * instance identity).
 *
 * HELD RESULTS are NOT gated by a Fact at all: they are gated by the U13
 * decision window that carries them. `{ kind: 'window'; windowId }` records
 * that truth explicitly — the owning window's resolution is what drains the
 * held result, and no Clock/Fact boundary observation can EVER satisfy it
 * (`continuationDue` returns false for a window trigger at every boundary).
 * This replaces the earlier fake kind-only `save-resolved`/`damage-applied`
 * triggers on held results, which could never fire but claimed coarse fact
 * semantics — a silent kind-only cross-fire hazard. */
export type ContinuationTrigger =
  | { kind: 'clock'; clock: ClockObservation['last'] extends never ? never : BoundaryRef; epoch?: ClockObservation }
  | { kind: 'fact'; factKind: Extract<Fact, { instanceId: string }>['kind']; instanceId?: string }
  /** The held result is gated by the U13 decision window that carries it
   * (by exact window identity, never by a same-kind Fact). The boundary
   * resume gate can never fire it; U13 drains it when the window resolves. */
  | { kind: 'window'; windowId: string };

/**
 * The U12 armed-continuation record. Durable, JSON-clean, deterministic.
 *
 * - `id` — stable deterministic identity (provenance).
 * - `programId` — the source program/action that armed the continuation;
 *   content resolver rows register against it (the resume DISPATCH key,
 *   never a semantic branch in this primitive).
 * - `ownerRef` — the U2 owner/controller role (a LIVE actor ref, resolved
 *   at resume time).
 * - `trigger` — the U8 Clock / U10 Fact trigger spec.
 * - `refs` — U1 references with explicit LIVE vs CAPTURED semantics.
 *   LIVE refs are re-resolved against then-current state at resume time;
 *   CAPTURED kinds are durable literals that never re-read later state.
 * - `capturedValues` — explicitly captured literal values (a chosen
 *   battlefield position, a determined amount, a mark id).
 * - `binder` — U1 names bound at arm time, carried so the deferred rule can
 *   reference earlier-operation outputs without re-deriving them.
 * - `expires` — a U8 Scope (default permanent); `epoch` is the Clock
 *   observation recorded at arm time so relative expiries count from
 *   establishment, never from an absolute round number.
 * - `ordering` — the U17 ordering identity/policy (interrupt nesting, turn
 *   order, arm order) — never incidental array insertion order.
 * - `payload` — the explicit deferred-rule vs held-result discriminant.
 */
export interface ArmedContinuation {
  id: string;
  /** The source program/action identity that armed the continuation. */
  programId: string;
  /** The step/point within the program the continuation resumes at. */
  continuationPoint?: string;
  /** The U2 owner/controller (who the continuation belongs to). */
  ownerRef: Reference<'actor'>;
  /** The Clock/Fact trigger specification. */
  trigger: ContinuationTrigger;
  /** U1 references with explicit LIVE vs CAPTURED semantics (ordered). */
  refs: readonly Reference[];
  /** Explicitly captured literal values, keyed by name (durable literals). */
  capturedValues?: Readonly<Record<string, string | number | boolean | Position | null>>;
  /** U1 names bound at arm time (earlier-operation outputs). */
  binder?: Binder;
  /** Source-required state/preconditions the resume expects (fail-closed
   * when absent is handled by the resolver row, never guessed here). */
  requiredState?: Readonly<Record<string, string | number | boolean | null>>;
  /** Expiry/cancellation spec. Default `{ kind: 'permanent' }`. */
  expires?: { scope: Scope; epoch?: ClockObservation };
  /** U17 ordering identity/policy for nested/multiple continuations. */
  ordering?: OrderingPolicy;
  /** The deferred-rule vs held-result discriminant. */
  payload: ContinuationPayload;
}

/** The explicit payload discriminant. `deferred-rule` resolves later
 * against THEN-CURRENT state (through the content resolver row keyed by
 * `programId`); `held-result` is an already-determined result waiting for a
 * boundary/window to close — it resumes exactly as recorded. */
export type ContinuationPayload =
  | {
      kind: 'deferred-rule';
      /** The resume body's source identity (dispatch key for the content
       * resolver row). Defaults to the record's `programId`. */
      resumeId?: string;
    }
  | {
      kind: 'held-result';
      /** What the held result IS, captured as a durable literal. */
      result: HeldResult;
    };

/** A held, already-determined result. Each variant carries the exact data
 * needed to resume WITHOUT recomputation. */
export type HeldResult =
  /** A determined save (Sucker Punch p.143: the original save result already
   * exists when the interrupt becomes available; the window holds it). */
  | {
      kind: 'save';
      targetId: string;
      /** The evaluated save modifier (boon/curse) applied to both rolls. */
      boon: number;
      threshold: number;
      roll: number;
      success: boolean;
      windowKind?: string;
      windowId?: string;
      statusId?: string;
      /** Who initiated the save's source ability (the reroll's provenance). */
      sourceActorId: string;
      /** The durable F2 modifier breakdown, so a reroll reproduces the exact
       * evaluated modifier policy (source + policy boon/curse + Blessing). */
      modifiers?: { sourceModifier: number; saveBoon: number; saveCurse: number; blessing: boolean };
      /** The original save's outcome branch — regenerating either outcome
       * without re-reading the source ability. */
      onSuccess: RuleEffect[];
      onFailure: RuleEffect[];
    }
  /** A determined damage amount held unapplied while a window is open (ICON
   * p.107). The amount is final — replay never recalculates mitigation. */
  | {
      kind: 'damage';
      targetId: string;
      amount: number;
      damageType: 'normal' | 'piercing' | 'divine' | 'sacrifice';
      sourceActorId: string;
      sourceId: string;
      instance: number;
      delivery: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain';
      ignoreCover: boolean;
      /** Source-specific HP routing, recorded so the held blow reapplies
       * exactly as it was determined (piercing terrain, divine). */
      bypassVigor?: boolean;
      /** Source-specific application exception (Bleak Mercy p.144). */
      ignoreDefiance?: boolean;
      /** Audit provenance for a determined True-Strike instance. */
      ignoreDodge?: boolean;
    }
  /** A held ability's effect list (a targeted ability held while its
   * interrupt window is open — costs already paid). */
  | { kind: 'held-effects'; targetId: string; mutations: RuleMutation[] };

/** A pure construction of the durable armed record. `armContinuation` never
 * mutates state — the caller stores the returned record in the encounter's
 * durable continuation collection. Deterministic: the id and the record are
 * a pure function of the inputs. */
export function armContinuation(input: {
  id: string;
  programId: string;
  continuationPoint?: string;
  ownerRef: Reference<'actor'>;
  trigger: ContinuationTrigger;
  payload: ContinuationPayload;
  refs?: readonly Reference[];
  capturedValues?: ArmedContinuation['capturedValues'];
  binder?: Binder;
  requiredState?: ArmedContinuation['requiredState'];
  expires?: ArmedContinuation['expires'];
  ordering?: OrderingPolicy;
}): ArmedContinuation {
  return {
    id: input.id,
    programId: input.programId,
    ...(input.continuationPoint !== undefined ? { continuationPoint: input.continuationPoint } : {}),
    ownerRef: input.ownerRef,
    trigger: input.trigger,
    refs: input.refs ?? [],
    ...(input.capturedValues !== undefined ? { capturedValues: input.capturedValues } : {}),
    ...(input.binder !== undefined ? { binder: input.binder } : {}),
    ...(input.requiredState !== undefined ? { requiredState: input.requiredState } : {}),
    ...(input.expires !== undefined ? { expires: input.expires } : {}),
    ...(input.ordering !== undefined ? { ordering: input.ordering } : {}),
    payload: input.payload,
  };
}

/** A canonical ordering key for a continuation — its U17 policy when one is
 * declared, else its deterministic identity (stable, never array order). */
export function continuationOrderKey(continuation: ArmedContinuation): string {
  return continuation.ordering ? orderingKey(continuation.ordering) : continuation.id;
}

/** The durable identity under which a continuation is stored/resumed. */
export function continuationIdentity(continuation: ArmedContinuation): string {
  return continuation.id;
}

/** Whether a continuation has reached its expiry clock (a `permanent` scope
 * never expires). Pure: relative expiries compare the recorded epoch against
 * the current observation — never an absolute round number. */
export function continuationExpired(
  continuation: ArmedContinuation,
  now: ClockObservation,
): boolean {
  if (!continuation.expires) return false;
  const scope = continuation.expires.scope;
  if (scope.kind === 'permanent') return false;
  return scopeSatisfied(scope, now, continuation.expires.epoch);
}

/** The deterministic boundary observation the scheduler feeds the resume
 * gate: the boundary that just transitioned. Counts are the caller's
 * responsibility (per-boundary occurrence counters when relative clocks are
 * in use); the resume gate itself reads `last`. */
export function clockObservationForBoundary(boundary: BoundaryRef, counts: Readonly<Record<string, number>> = {}): ClockObservation {
  return { last: boundary, counts };
}

/** The resume gate — PURE and replay-deterministic. Answers whether the
 * continuation is DUE at the current boundary/fact observation. For a clock
 * trigger, `now` must name the boundary; for a fact trigger, `facts` is the
 * recorded fact history (a missing trigger fact means the continuation does
 * NOT fire — the boundary drains it as pending). No RNG, no choices, no
 * mutable-availability re-evaluation: replay derives the same answer from
 * the same durable record. */
export function continuationDue(
  continuation: ArmedContinuation,
  now: ClockObservation,
  facts: readonly Fact[] = [],
): boolean {
  if (continuationExpired(continuation, now)) return false;
  const trigger = continuation.trigger;
  switch (trigger.kind) {
    case 'clock': {
      // A clock trigger fires when the observed boundary IS the trigger's
      // boundary (relative clocks additionally need the recorded epoch).
      if (!boundaryEquals(now.last, trigger.clock)) return false;
      if (trigger.epoch !== undefined) {
        return boundaryReached({ kind: 'boundary', boundary: trigger.clock }, now, trigger.epoch);
      }
      return true;
    }
    case 'fact':
      // Correlated by the exact causal fact instance when recorded: an
      // unrelated same-kind fact can never satisfy the continuation. Without
      // a recorded instance, match by kind (the documented coarse seam).
      return facts.some((fact) => fact.kind === trigger.factKind
        && (trigger.instanceId === undefined || fact.instanceId === trigger.instanceId));
    case 'window':
      // A window-gated held result is drained by the U13 window machinery by
      // exact window identity — NEVER by a Clock/Fact boundary observation.
      // The resume gate therefore never considers a window trigger due; a
      // held result can never auto-fire merely because a coarse same-kind
      // Fact exists in the history.
      return false;
  }
}

/** The pure resume decision: `ok: true` with the recorded payload when the
 * continuation is due, `ok: false` with the continuation intact otherwise
 * (pending, or expired/cancelled — an expired continuation never resumes).
 * The caller executes the returned payload through its own authority; this
 * function performs no execution and consumes no RNG. */
export function resumeContinuation(
  continuation: ArmedContinuation,
  now: ClockObservation,
  facts: readonly Fact[] = [],
):
  | { ok: true; continuation: ArmedContinuation; payload: ContinuationPayload }
  | { ok: false; continuation: ArmedContinuation; status: 'pending' | 'expired' | 'not-due' } {
  if (continuationExpired(continuation, now)) return { ok: false, continuation, status: 'expired' };
  if (!continuationDue(continuation, now, facts)) return { ok: false, continuation, status: 'not-due' };
  return { ok: true, continuation, payload: continuation.payload };
}

/** Build the U12 HELD-RESULT continuation for a rolled save (Sucker Punch,
 * p.143): the original save result already exists and is merely waiting for
 * the reroll window to close. The payload resumes EXACTLY as recorded —
 * a reroll is a separately recorded result caused by the interrupt, never a
 * recomputation of this held result. The trigger names the OWNING window
 * (`windowId`) — the held result is gated by the window's identity, never by
 * a coarse `save-resolved` Fact (the boundary can never auto-fire it). */
export function heldSaveContinuation(input: {
  id: string;
  sourceId: string;
  ownerActorId: string;
  targetId: string;
  boon: number;
  threshold: number;
  roll: number;
  success: boolean;
  /** The owning U13 window's durable id — the exact identity that gates this
   * held result (U13 drains it when the window resolves; no boundary fact
   * can ever satisfy it). */
  windowId: string;
  /** The save record's OWN window id (legacy save-window provenance, kept on
   * the payload for the reroll record — distinct from the owning U13 window
   * id in the trigger). */
  saveWindowId?: string;
  windowKind?: string;
  statusId?: string;
  sourceActorId: string;
  modifiers?: { sourceModifier: number; saveBoon: number; saveCurse: number; blessing: boolean };
  onSuccess: RuleEffect[];
  onFailure: RuleEffect[];
}): ArmedContinuation {
  return armContinuation({
    id: input.id,
    programId: input.sourceId,
    ownerRef: { kind: 'captured-actor', actorId: input.ownerActorId },
    // Gated by the owning window's exact identity: the window machinery
    // (U13) drains it when the window resolves; no Clock/Fact boundary can
    // ever satisfy it.
    trigger: { kind: 'window', windowId: input.windowId },
    payload: {
      kind: 'held-result',
      result: {
        kind: 'save',
        targetId: input.targetId,
        boon: input.boon,
        threshold: input.threshold,
        roll: input.roll,
        success: input.success,
        ...(input.windowKind !== undefined ? { windowKind: input.windowKind } : {}),
        ...(input.saveWindowId !== undefined ? { windowId: input.saveWindowId } : {}),
        ...(input.statusId !== undefined ? { statusId: input.statusId } : {}),
        sourceActorId: input.sourceActorId,
        ...(input.modifiers !== undefined ? { modifiers: input.modifiers } : {}),
        onSuccess: input.onSuccess,
        onFailure: input.onFailure,
      },
    },
  });
}

/** Build the U12 HELD-RESULT continuation for determined-but-unapplied
 * damage (ICON p.107): the final mitigated amount is held while the
 * when-damaged/defeated window is open. The payload resumes exactly as
 * recorded — replay never recalculates mitigation. The trigger names the
 * OWNING window (`windowId`) — the held result is gated by the window's
 * identity, never by a coarse `damage-applied` Fact (the boundary can never
 * auto-fire it). */
export function heldDamageContinuation(input: {
  id: string;
  programId: string;
  ownerActorId: string;
  targetId: string;
  amount: number;
  damageType: 'normal' | 'piercing' | 'divine' | 'sacrifice';
  sourceActorId: string;
  sourceId: string;
  instance: number;
  delivery: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain';
  ignoreCover: boolean;
  /** The owning U13 window's durable id — the exact identity that gates this
   * held result (U13 drains it when the window resolves). */
  windowId: string;
  bypassVigor?: boolean;
  ignoreDefiance?: boolean;
  ignoreDodge?: boolean;
}): ArmedContinuation {
  return armContinuation({
    id: input.id,
    programId: input.programId,
    ownerRef: { kind: 'captured-actor', actorId: input.ownerActorId },
    // Gated by the owning window's exact identity: the window machinery
    // (U13) drains it when the window resolves; no Clock/Fact boundary can
    // ever satisfy it.
    trigger: { kind: 'window', windowId: input.windowId },
    payload: {
      kind: 'held-result',
      result: {
        kind: 'damage',
        targetId: input.targetId,
        amount: input.amount,
        damageType: input.damageType,
        sourceActorId: input.sourceActorId,
        sourceId: input.sourceId,
        instance: input.instance,
        delivery: input.delivery,
        ignoreCover: input.ignoreCover,
        ...(input.bypassVigor !== undefined ? { bypassVigor: input.bypassVigor } : {}),
        ...(input.ignoreDefiance !== undefined ? { ignoreDefiance: input.ignoreDefiance } : {}),
        ...(input.ignoreDodge !== undefined ? { ignoreDodge: input.ignoreDodge } : {}),
      },
    },
  });
}

/** The expiry scope type (U8). */
export type ContinuationExpiryScope = Scope;
