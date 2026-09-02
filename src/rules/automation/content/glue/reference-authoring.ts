/**
 * reference-authoring.ts — the SHARED CONTENT-AUTHORING REFERENCE ADAPTER
 * (U1 Reference / Binding surface for named content resolvers).
 *
 * Named resolver files answer, in the middle of an ability program, "what
 * thing does this later rule clause refer to?" — the ability user, the attack
 * target, the trigger source/targets, an actor the player chose at the
 * command boundary, or a referent bound by an earlier operation. Before this
 * module each resolver spelled those reads ad hoc:
 *
 *     context.state.actors[context.actorId]
 *     context.state.actors[context.attackTargetId]
 *     context.state.actors[context.triggerSourceId]
 *     context.input.actorIds?.[key]
 *
 * That is the U1 RESIDUAL listed in `docs/u8-u1-underlay-census.md`. This
 * adapter expresses REFERENCE INTENT — not shortened syntax — by COMPOSING the
 * ONE U1 vocabulary (`primitives/reference.ts`): every accessor builds a typed
 * `Reference<'actor'>` (LIVE slot/bound, CAPTURED recorded id, or an ordered
 * plural collection) and resolves it through `resolveReference`, the single
 * resolution authority. It is deliberately NOT a second reference system and
 * it deliberately does NOT expose a generic `getActor(id)` convenience — the
 * eight accessors are the entire surface: LIVE slots, CAPTURED recorded
 * selections (plural and single), the strict `resolveCapturedActor` and the
 * lifecycle-sensitive `resolveCapturedActorWeak` for durable fact-carried
 * identities, and bound names. There is exactly ONE captured-actor contract
 * per accessor — never a flag that switches strict/weak behavior.
 *
 * Semantics each accessor makes explicit (and the parity/adversarial suite
 * proves):
 *
 * - LIVE source / attack-target / trigger-source refs re-read the CURRENT
 *   actor state at resolve time (the ability user is never a stale snapshot).
 * - CAPTURED command-selected actors preserve the RECORDED identity from the
 *   recorded command input — replay applies the recorded choice and never
 *   re-derives it from later state.
 * - Trigger targets resolve as an ORDERED COLLECTION of every recorded
 *   target, never one arbitrary member (plural slot semantics).
 * - Bound references resolve domain-verified: a name bound to a position
 *   cannot satisfy an actor reference (`domain-mismatch` → reject).
 * - Malformed/missing refs REJECT rather than guess: an absent optional
 *   SINGLE slot (`attack-target`, `trigger-source`) legitimately resolves to
 *   `undefined`; a slot that NAMES an actor absent from state, a bound name
 *   that is unbound, or a captured recorded identity that no longer resolves
 *   is a hard `RuleProgramViolation` (fail closed).
 *
 * Cardinality stays where the source contract lives: this adapter never
 * collapses a collection to "first actor" — callers that select `[0]` do so
 * as their own U4 choice-cardinality policy, and query-shaped selectors
 * remain U3 (never adapted here). Provenance/ownership reads of
 * `context.actorId` (e.g. `sourceActorId:` on emitted mutations) are NOT
 * reference resolution and remain at the emitting site.
 *
 * Layer: content glue → primitives only (U1 constructors + resolveReference).
 * No kernels, no source IDs, no engine imports.
 */
import { RuleProgramViolation } from '../../kernels/violations.js';
import {
  capturedActor,
  capturedActorWeak,
  liveActorSlot,
  liveTriggerTargets,
  liveActorBound,
  referenceCollection,
  resolveReference,
} from '../../primitives/reference.js';
import type { Reference } from '../../primitives/reference.js';
import type { RuleActorView, RuleExecutionContext, RuleRuntimeState } from '../../primitives/types.js';
import type { ReferenceResolution } from '../../primitives/reference.js';
import type { EncounterActor, EncounterState } from '../../../types.js';

/** The context shape captured-actor resolution needs: only `state` is read
 * (never dice/input/windows), and it may be a fold/lifecycle EncounterState
 * or a resolver RuleExecutionContext. */
type CapturedResolutionContext = { state: RuleRuntimeState | EncounterState };

/** Internal: thread the caller's state through the ONE authority. Captured
 * resolution reads only `context.state.actors`; the down-cast is the single
 * seam (the object is the full actor — a structural superset of the view). */
function resolveCapturedVia(context: CapturedResolutionContext, id: string): ReferenceResolution<'actor'> {
  return resolveReference(capturedActor(id), { state: context.state } as RuleExecutionContext);
}
function resolveCapturedWeakVia(context: CapturedResolutionContext, id: string): ReferenceResolution<'actor'> {
  return resolveReference(capturedActorWeak(id), { state: context.state } as RuleExecutionContext);
}

const violation = (code: string, detail: string): RuleProgramViolation => new RuleProgramViolation(code, detail);

/** A resolved actor view, or undefined when the OPTIONAL singular slot was
 * legitimately absent (never for a named-but-missing actor, which rejects). */
export type OptionalActor = RuleActorView | undefined;

/** Resolve the shared failure modes of `resolveReference` into this API's
 * fail-closed contract. Absent singular slot → undefined; everything else
 * that is not a successful actor resolution is a hard violation. */
function actorFromResolution(
  resolution: ReturnType<typeof resolveReference<'actor'>>,
  what: string,
): RuleActorView | undefined {
  if (resolution.ok) {
    if (resolution.value.kind !== 'actor') throw violation('reference.domain-mismatch', `${what} did not resolve to an actor.`);
    return resolution.value.actor;
  }
  switch (resolution.problem) {
    case 'missing-slot':
      return undefined; // optional singular slot absent — a legitimate absence
    case 'missing-actor':
      throw violation('reference.missing-actor', `${what} names an actor that does not exist in the current state.`);
    case 'unknown-bound-name':
      throw violation('reference.unknown-bound', `${what} names a bound referent that was never bound by an earlier operation.`);
    case 'domain-mismatch':
      throw violation('reference.domain-mismatch', `${what} resolved to a non-actor domain.`);
    case 'actor-without-position':
      throw violation('reference.actor-without-position', `${what} actor has no position.`);
    case 'missing-entity':
      throw violation('reference.missing-entity', `${what} names an entity that does not exist.`);
    default:
      throw violation('reference.unresolved', `${what} could not be resolved.`);
  }
}

function actorCollectionFromResolution(
  resolution: ReturnType<typeof resolveReference<'actor'>>,
  what: string,
): RuleActorView[] {
  if (resolution.ok) {
    if (resolution.value.kind !== 'collection') throw violation('reference.domain-mismatch', `${what} did not resolve to an ordered actor collection.`);
    return resolution.value.items.map((item) => {
      if (item.kind !== 'actor') throw violation('reference.domain-mismatch', `${what} contains a non-actor element.`);
      return item.actor;
    });
  }
  throw violation(
    resolution.problem === 'missing-actor' ? 'reference.missing-actor' : 'reference.unresolved',
    `${what} could not be resolved as an ordered actor collection.`,
  );
}

// ---------------------------------------------------------------------------
// Typed reference constructors (identity intent, composed from U1)
// ---------------------------------------------------------------------------

/** LIVE source-actor reference: the ability user, re-read at resolve time. */
export function sourceActorRef(): Reference<'actor'> {
  return liveActorSlot('source');
}

/** LIVE attack-target reference: the primary attack target of this ability. */
export function attackTargetRef(): Reference<'actor'> {
  return liveActorSlot('attack-target');
}

/** LIVE trigger-source reference: the actor that triggered this window. */
export function triggerSourceRef(): Reference<'actor'> {
  return liveActorSlot('trigger-source');
}

/** Live plural trigger-targets reference: EVERY recorded trigger target in
 * recorded order — never one arbitrary member. */
export function triggerTargetsRef(): Reference<'actor'> {
  return liveTriggerTargets();
}

/** CAPTURED command-selected actor references: the recorded identities the
 * player chose at the command boundary, as an ordered homogeneous collection.
 * The identity is the RECORDED id — replay applies the recorded choice and
 * never re-derives it from later state. The caller supplies the ids read from
 * the recorded command input; `resolveCapturedSelectedActors` does that read
 * for the common `input.actorIds[key]` shape. */
export function capturedSelectedActorsRef(ids: readonly string[]): Reference<'actor'> {
  return referenceCollection(ids.map(capturedActor));
}

// ---------------------------------------------------------------------------
// Resolved accessors (the content-authoring surface)
// ---------------------------------------------------------------------------

/** Resolve the LIVE SOURCE ACTOR (the ability user) against current state.
 * Always present in a valid resolution context; a dangling source actor id
 * rejects (`reference.missing-actor`), it never silently no-ops. */
export function resolveSourceActor(context: RuleExecutionContext): RuleActorView {
  const resolution = resolveReference(sourceActorRef(), context);
  if (!resolution.ok || resolution.value.kind !== 'actor') {
    throw violation('reference.missing-actor', 'The ability user (source actor) does not exist in the current state.');
  }
  return resolution.value.actor;
}

/** Resolve the LIVE ATTACK TARGET, or undefined when the ability legitimately
 * has no primary attack target (an absent singular slot). A slot that names
 * an actor absent from state rejects rather than guessing. */
export function resolveAttackTarget(context: RuleExecutionContext): OptionalActor {
  return actorFromResolution(resolveReference(attackTargetRef(), context), 'The attack target');
}

/** Resolve the LIVE TRIGGER SOURCE, or undefined when the current window was
 * triggered without one (an absent singular slot). */
export function resolveTriggerSource(context: RuleExecutionContext): OptionalActor {
  return actorFromResolution(resolveReference(triggerSourceRef(), context), 'The trigger source');
}

/** Resolve the plural trigger targets as an ORDERED COLLECTION of every
 * recorded target. An empty trigger-target list is a legitimate empty
 * collection; a recorded id that no longer exists rejects. */
export function resolveTriggerTargets(context: RuleExecutionContext): RuleActorView[] {
  return actorCollectionFromResolution(resolveReference(triggerTargetsRef(), context), 'The trigger targets');
}

/** Resolve the CAPTURED command-selected actors under `input.actorIds[key]`
 * as an ordered collection of the RECORDED identities. Absent key/empty list
 * is a legitimate empty selection; a recorded id that no longer resolves
 * rejects (never re-derived, never guessed). Cardinality decisions (single vs
 * multi, minimum/maximum) remain with the caller's U4 choice policy. */
export function resolveCapturedSelectedActors(context: RuleExecutionContext, key: string): RuleActorView[] {
  const ref = capturedSelectedActorsRef(context.input.actorIds?.[key] ?? []);
  return actorCollectionFromResolution(resolveReference(ref, context), `The captured command-selected actors (${key})`);
}

/** STRICT single captured actor — "the remembered identity, which must still
 * resolve." An absent ID (`undefined` or the legacy `''` sentinel) is the
 * CALLER-SIDE presence border → `undefined`, exactly like the live
 * optional-singleton accessors; a PRESENT id whose actor is absent from
 * state fails closed `reference.missing-actor`. Composes the strict
 * `capturedActor` kind through the ONE resolution authority (captured
 * resolution reads only `context.state`). Returns the full `EncounterActor`
 * (the same object `resolveReference` resolves — a superset of the view, so
 * fold/lifecycle guards can keep reading `defeated`, `onBattlefield`,
 * `ruleState`, `activeEffects`, …). Used by durable identities whose
 * carriers guarantee presence while the fact lives: engine combat never
 * removes actors from the map (REMOVE_ACTOR is setup-only), defeat leaves
 * them present-but-`defeated`, and defeat cleanup strips owner-stamped
 * marks/effects/summons — so a present-id-missing-actor here is a dangling
 * reference, not a lifecycle state. */
export function resolveCapturedActor(context: CapturedResolutionContext, id: string | null | undefined): EncounterActor | undefined {
  if (id === undefined || id === null || id === '') return undefined;
  const resolution = resolveCapturedVia(context, id);
  if (!resolution.ok) {
    throw violation(
      resolution.problem === 'missing-actor' ? 'reference.missing-actor' : 'reference.unresolved',
      `The captured actor "${id}" could not be resolved.`,
    );
  }
  if (resolution.value.kind !== 'actor') throw violation('reference.domain-mismatch', `The captured actor "${id}" resolved to a non-actor domain.`);
  return resolution.value.actor as unknown as EncounterActor;
}

/** LIFECYCLE-SENSITIVE (weak) single captured actor — "the actor originally
 * associated with this fact, if that actor still exists." Absent-ID border
 * as above; a PRESENT id whose actor is gone resolves to `undefined` (the
 * explicit `captured-actor-weak` `absent` resolution — a valid
 * lifecycle-expiration outcome, never an error). Used by carriers whose
 * authors DECLARE a tolerant lifetime: legacy/imported fact owners
 * (encounter-hooks infer only "when the owner is still known") and
 * `?? null`-shaped optional origin reads. Strict and weak are distinct U1
 * contracts — never one accessor switched by caller flags. */
export function resolveCapturedActorWeak(context: CapturedResolutionContext, id: string | null | undefined): EncounterActor | undefined {
  if (id === undefined || id === null || id === '') return undefined;
  const resolution = resolveCapturedWeakVia(context, id);
  if (!resolution.ok) {
    throw violation(
      resolution.problem === 'missing-actor' ? 'reference.missing-actor' : 'reference.unresolved',
      `The weak captured actor "${id}" could not be resolved.`,
    );
  }
  if (resolution.value.kind === 'absent') return undefined;
  if (resolution.value.kind !== 'actor') throw violation('reference.domain-mismatch', `The weak captured actor "${id}" resolved to a non-actor domain.`);
  return resolution.value.actor as unknown as EncounterActor;
}

/** Resolve a BOUND actor referent named by an earlier operation
 * (`BIND <actors> AS <name>`). The bound reference's DOMAIN is verified by
 * U1: an unbound name or a bound non-actor rejects. */
export function resolveBoundActor(context: RuleExecutionContext, name: string): RuleActorView {
  const resolution = resolveReference(liveActorBound(name), context);
  if (!resolution.ok) {
    const code =
      resolution.problem === 'unknown-bound-name'
        ? 'reference.unknown-bound'
        : resolution.problem === 'domain-mismatch'
          ? 'reference.domain-mismatch'
          : 'reference.unresolved';
    throw violation(code, `The bound actor referent "${name}" could not be resolved as an actor.`);
  }
  if (resolution.value.kind !== 'actor') {
    throw violation('reference.domain-mismatch', `The bound actor referent "${name}" resolved to a non-actor domain.`);
  }
  return resolution.value.actor;
}