/**
 * reference.ts — U1 REFERENCE vocabulary: the one typed way to name a thing
 * a later rule clause refers to.
 *
 * ICON distinguishes references that RESOLVE AGAINST CURRENT STATE from
 * values that were determined EARLIER and must never be re-derived:
 *
 *   - LIVE reference — resolve against current state at use time ("at the
 *     start of its next turn, damage adjacent characters": retain the actor
 *     ref; query its then-current position).
 *   - CAPTURED reference — preserve the source-required value/state from the
 *     earlier point ("at end of turn, explode at the chosen space": capture
 *     the position; "return relative to your original location": capture the
 *     position).
 *
 * The legacy implicit references this vocabulary supersedes are the context
 * slots (`context.actorId`, `attackTargetId`, `triggerSourceId`,
 * `triggerTargetIds`, `damageRecipientId`): a LIVE reference names one of
 * those slots, a direct id, or a name BOUND by an earlier operation
 * (`CHOOSE a position AS landing`, `QUERY adjacent foes AS nearby`). This
 * module owns the typed vocabulary and the deterministic resolution surface;
 * it is not a query language (U3 owns eligibility), not role semantics (U2
 * owns "relative to whom"), and not spatial measurement (U7 owns anchors).
 *
 * Type safety (corrective pass 2026-08-30): captured references are
 * SELF-DESCRIBING discriminated kinds — `captured-actor` carries ONLY an
 * `actorId`, `captured-position` carries ONLY a `Position` literal — so a
 * captured actor cannot structurally contain a position literal and a
 * captured position cannot structurally contain an actor id. `Reference<D>`
 * is a generic discriminated union whose CAPTURED member is narrowed to `D`
 * (`Reference<'actor'>` captured is only `captured-actor`). A `collection`
 * ref preserves its element domain (`Reference<D>[]`). A plural
 * trigger-targets slot resolves as an ORDERED COLLECTION of every recorded
 * target, never one arbitrary member. Bound-name resolution verifies the
 * resolved reference's domain against the declared `domain` (a bound actor
 * ref resolving to a bound position is `domain-mismatch` — reject), instead
 * of silently returning whatever was bound.
 *
 * Foundation: no source IDs, no kernel imports. The Binder is carried on the
 * execution context (`context.boundNames`) and will later ride continuation
 * records (U12).
 */
import type { Position } from '../../types.js';
import type { RuleActorView, RuleEntityView, RuleExecutionContext, RuleSelector } from './types.js';

/** The domains a Reference can name. */
export type ReferenceDomain =
  | 'actor'
  | 'entity'
  | 'position'
  | 'area'
  | 'terrain-effect'
  | 'persistent-effect'
  | 'mark'
  | 'stance'
  | 'resource-pool'
  | 'rule-source'
  | 'roll-result'
  | 'value';

/** What went wrong when a reference cannot resolve. */
export type ReferenceProblem =
  | 'unknown-bound-name'
  | 'missing-slot'
  | 'missing-actor'
  | 'missing-entity'
  | 'actor-without-position'
  | 'domain-mismatch';

/** The singular legacy context slots a LIVE reference can name. (The plural
 * `trigger-targets` slot is its own collection kind — see `liveTriggerTargets`.) */
export type SingularSlot = 'source' | 'attack-target' | 'trigger-source' | 'damage-recipient';

/** A typed name for a LIVE reference, resolved at use time. */
export type LiveReferenceName =
  | { kind: 'slot'; slot: SingularSlot }
  | { kind: 'id'; id: string }
  | { kind: 'bound'; name: string };

/** A typed reference, indexed by the DOMAIN `D` it resolves to. The CAPTURED
 * member narrows to D — the domain of the self-describing captured kind — so
 * `Reference<'actor'>`'s captured member is exactly
 * `{ kind:'captured-actor'; actorId }`. A captured actor structurally cannot
 * hold a Position and a captured position structurally cannot hold an actor
 * id. `collection` carries an element-homogeneous `Reference<D>[]`;
 * `plural-slot` names the trigger-targets slot (always actor domain) and
 * resolves to every target as an ordered collection. Structural and typed —
 * never a stringly property path. */
export type Reference<D extends ReferenceDomain = ReferenceDomain> =
  | { kind: 'live'; domain: D; name: LiveReferenceName }
  | (D extends 'actor' ? { kind: 'captured-actor'; actorId: string } | { kind: 'captured-actor-weak'; actorId: string }
    : D extends 'entity' ? { kind: 'captured-entity'; entityId: string }
    : D extends 'position' ? { kind: 'captured-position'; position: Position }
    : D extends 'value' ? { kind: 'captured-value'; value: string | number | boolean | null }
    : never)
  | { kind: 'collection'; refs: readonly Reference<D>[] }
  | { kind: 'plural-slot'; domain: 'actor'; slot: 'trigger-targets' };

/** A CAPTURED actor whose remembered identity may have legitimately expired
 * (the reference means "the actor originally associated with this fact, if
 * that actor still exists"). Resolves to the actor when present, or to an
 * explicit `{ kind: 'absent' }` result when the remembered actor no longer
 * exists — a VALID lifecycle-expiration outcome, never an error. This is a
 * genuinely distinct contract from the strict `captured-actor` (present id +
 * missing actor = fail closed `missing-actor`): the caller (a lifecycle
 * authority consuming a durable fact, mark, mote, continuation, or terrain
 * effect) picks which contract the carrier declares. Absence of the ID
 * itself (no reference ever recorded) is a caller-side presence decision at
 * the adapter border, not part of this kind. */
export interface CapturedActorWeakReference {
  kind: 'captured-actor-weak';
  actorId: string;
}

/** A resolved reference value. `id` is the identity-level resolution for
 * domains whose state reads belong to their consuming kernel (mark/stance/
 * terrain/area/resource/rule/roll); actor/entity/position/value resolve
 * against current state here. A collection/plural reference resolves to a
 * collection whose items carry the same element domain. The explicit
 * `absent` resolution (a remembered identity that legitimately expired) is
 * priced into the vocabulary ONLY where a lifecycle-sensitive reference kind
 * can produce it — the weak captured-actor kind, whose domain is `actor`;
 * since collections preserve their element domain, an actor collection can
 * carry absent items but no non-actor domain can ever resolve to absent.
 *
 * STRICT-vs-WEAK ACTOR PRECISION BOUND (documented, deliberately not
 * over-typed): `ResolvedReference<'actor'>` keeps the `absent` member even
 * though STRICT actor kinds (captured-actor, live source/attack-target/
 * trigger-source slots, live ids, live bound names bound to a strict ref,
 * the plural-slot collection) can never produce it. The runtime-producible
 * set is exactly: a `captured-actor-weak` literal, any COLLECTION whose
 * items contain a weak member, and any BOUND name whose bound referent is
 * (or contains) a weak member. The domain-level union cannot express that
 * distinction without indexing the resolution by the reference KIND
 * (`ResolvedReferenceFor<R extends Reference>`) — a redesign that would make
 * every strict call site's earlier `kind === 'absent'` narrowing dead code
 * while leaving bound/collection cases conservative in exactly the same
 * way, for zero runtime change. The public accessor surface already encodes
 * the distinction exactly: `resolveCapturedActor` (strict) returns the actor
 * or rejects; `resolveCapturedActorWeak` maps `absent` to `undefined`. The
 * runtime contract is pinned by tests: only the weak kind ever resolves to
 * absent, and strict actor resolutions never do. Consumers that need the
 * exact contract at the vocabulary level use the strict/weak kinds directly
 * (`capturedActor` vs `capturedActorWeak`) — the kinds themselves are typed;
 * only the union-level resolution type is conservative by design. */
export type ResolvedReference<D extends ReferenceDomain> =
  | (D extends 'actor' ? { kind: 'actor'; actor: RuleActorView }
    : D extends 'entity' ? { kind: 'entity'; entity: RuleEntityView }
    : D extends 'position' ? { kind: 'position'; position: Position }
    : D extends 'value' ? { kind: 'value'; value: string | number | boolean | null }
    : { kind: 'id'; domain: D; id: string })
  | { kind: 'collection'; items: readonly ResolvedReference<D>[] }
  | (D extends 'actor' ? { kind: 'absent' } : never);

export type ReferenceResolution<D extends ReferenceDomain = ReferenceDomain> =
  | { ok: true; value: ResolvedReference<D> }
  | { ok: false; problem: ReferenceProblem };

/** Result of adapting a reference-shaped actor selector onto U1. Query-shaped
 * selectors deliberately reject here: U3, not U1, owns candidate queries. */
export type ActorSelectorReferenceResolution =
  | ReferenceResolution<'actor'>
  | { ok: false; problem: 'selector-not-reference' };

/** Immutable name→Reference binding map. */
export interface Binder {
  readonly names: Readonly<Record<string, Reference>>;
}

export const EMPTY_BINDER: Binder = { names: {} };

/** Bind a name to a reference (pure — returns a new Binder). */
export function bind(binder: Binder, name: string, ref: Reference): Binder {
  return { names: { ...binder.names, [name]: ref } };
}

/** Look up a bound name; undefined when unbound. */
export function lookupBound(binder: Binder, name: string): Reference | undefined {
  return binder.names[name];
}

/** The resolved DOMAIN of a reference — used to verify bound-name resolution
 * is domain-safe (a bound actor ref resolving to a bound position must reject). */
export function domainOf(ref: Reference): ReferenceDomain | 'collection' {
  switch (ref.kind) {
    case 'live':
      return ref.domain;
    case 'captured-actor':
      return 'actor';
    case 'captured-actor-weak':
      return 'actor';
    case 'captured-entity':
      return 'entity';
    case 'captured-position':
      return 'position';
    case 'captured-value':
      return 'value';
    case 'plural-slot':
      return 'actor';
    case 'collection': {
      const first = ref.refs[0];
      return first === undefined ? 'collection' : domainOf(first);
    }
  }
}

/** A canonical, deterministic string key for a reference. Used for stable
 * equality and for subject-keyed occurrence counters on the Clock (U8). Pure:
 * a function only of the reference's structure. */
export function referenceKey(ref: Reference): string {
  switch (ref.kind) {
    case 'live':
      return `live:${ref.domain}:${liveNameKey(ref.name)}`;
    case 'captured-actor':
      return `captured-actor:${ref.actorId}`;
    case 'captured-actor-weak':
      return `captured-actor-weak:${ref.actorId}`;
    case 'captured-entity':
      return `captured-entity:${ref.entityId}`;
    case 'captured-position':
      return `captured-position:${JSON.stringify(ref.position)}`;
    case 'captured-value':
      return `captured-value:${JSON.stringify(ref.value)}`;
    case 'collection':
      return `collection:[${ref.refs.map(referenceKey).join(',')}]`;
    case 'plural-slot':
      return `plural:${ref.slot}`;
  }
}

function liveNameKey(name: LiveReferenceName): string {
  switch (name.kind) {
    case 'slot': return `slot:${name.slot}`;
    case 'id': return `id:${name.id}`;
    case 'bound': return `bound:${name.name}`;
  }
}

/** Structural reference equality (canonical-key compare). */
export function referenceEquals(a: Reference, b: Reference): boolean {
  return referenceKey(a) === referenceKey(b);
}

/** Resolve the id a LIVE reference names from a singular slot or direct id.
 * Deterministic: reads the context verbatim. Bound names are resolved by
 * the caller (they may name CAPTURED/collection refs, not just ids). */
function resolveLiveId(name: LiveReferenceName, context: RuleExecutionContext): { ok: true; id: string } | { ok: false; problem: 'missing-slot' } {
  switch (name.kind) {
    case 'slot':
      switch (name.slot) {
        case 'source': return { ok: true, id: context.actorId };
        case 'attack-target':
          return context.attackTargetId !== undefined
            ? { ok: true, id: context.attackTargetId }
            : { ok: false, problem: 'missing-slot' };
        case 'trigger-source':
          return context.triggerSourceId !== undefined
            ? { ok: true, id: context.triggerSourceId }
            : { ok: false, problem: 'missing-slot' };
        case 'damage-recipient':
          return context.damageRecipientId !== undefined
            ? { ok: true, id: context.damageRecipientId }
            : { ok: false, problem: 'missing-slot' };
      }
      break;
    case 'id':
      return { ok: true, id: name.id };
    case 'bound':
      // Resolved by the caller (resolveReference's live branch); a bound
      // name can name a CAPTURED/collection ref, so there is no id here.
      return { ok: false, problem: 'missing-slot' };
  }
}

/** Resolve one reference deterministically against the current context.
 * A CAPTURED reference is a durable literal once captured — it never reads
 * later state (replay must never re-derive it). A LIVE reference re-resolves
 * at use time. A bound name must match the declared domain (else
 * `domain-mismatch`). Pure: no state is mutated, no RNG is consumed. */
export function resolveReference<D extends ReferenceDomain>(ref: Reference<D>, context: RuleExecutionContext): ReferenceResolution<D> {
  // Run the resolution over the distributed union (D=ReferenceDomain), where
  // the captured member collapses to a concrete discriminated union that
  // narrows on `kind`. The typed constructors keep the per-domain invariant;
  // this internal cast is the single seam between it and the runtime switch.
  const anyRef = ref as Reference<ReferenceDomain>;
  const fail = <P extends ReferenceProblem>(problem: P): ReferenceResolution<D> => ({ ok: false, problem });
  const okActor = (actor: RuleActorView): ReferenceResolution<D> => ({ ok: true, value: { kind: 'actor', actor } } as ReferenceResolution<D>);

  switch (anyRef.kind) {
    case 'captured-actor': {
      const actor = context.state.actors[anyRef.actorId];
      if (!actor) return fail('missing-actor');
      return okActor(actor);
    }
    case 'captured-actor-weak': {
      // Lifecycle-sensitive capture: "the actor originally associated with
      // this fact, if it still exists." A missing actor is the EXPLICIT
      // `absent` resolution (valid expiry), never `missing-actor`.
      const actor = context.state.actors[anyRef.actorId];
      if (!actor) return { ok: true, value: { kind: 'absent' } } as ReferenceResolution<D>;
      return okActor(actor);
    }
    case 'captured-entity': {
      const entity = context.state.entities[anyRef.entityId];
      if (!entity) return fail('missing-entity');
      return { ok: true, value: { kind: 'entity', entity } } as ReferenceResolution<D>;
    }
    case 'captured-position':
      return { ok: true, value: { kind: 'position', position: anyRef.position } } as ReferenceResolution<D>;
    case 'captured-value':
      return { ok: true, value: { kind: 'value', value: anyRef.value } } as ReferenceResolution<D>;
    case 'collection': {
      const items: ResolvedReference<ReferenceDomain>[] = [];
      for (const item of anyRef.refs) {
        const resolution = resolveReference(item, context);
        if (!resolution.ok) return resolution as ReferenceResolution<D>;
        items.push(resolution.value);
      }
      return { ok: true, value: { kind: 'collection', items } } as ReferenceResolution<D>;
    }
    case 'plural-slot': {
      // The plural trigger-targets slot resolves to an ORDERED COLLECTION of
      // every recorded target — never to one arbitrary member. An absent slot
      // (no targets recorded) is a legitimate EMPTY collection, distinct from
      // a missing singular slot (which rejects with 'missing-slot').
      const ids = context.triggerTargetIds ?? [];
      const items: ResolvedReference<'actor'>[] = [];
      for (const id of ids) {
        const actor = context.state.actors[id];
        if (!actor) return fail('missing-actor');
        items.push({ kind: 'actor', actor });
      }
      return { ok: true, value: { kind: 'collection', items } } as ReferenceResolution<D>;
    }
    case 'live': {
      // A BOUND name refers to whatever reference was bound by the earlier
      // operation — which may itself be CAPTURED (a chosen landing space), a
      // collection (`BIND slain actors AS slain`), or another LIVE ref. The
      // bound reference's DOMAIN must match the declared `domain`: a reference
      // that declares actor must resolve to actor; a declared actor bound to a
      // position is `domain-mismatch` — reject, never silently reinterpret.
      if (anyRef.name.kind === 'bound') {
        const boundRef = lookupBound(context.boundNames ?? EMPTY_BINDER, anyRef.name.name);
        if (boundRef === undefined) return fail('unknown-bound-name');
        if (domainOf(boundRef) !== anyRef.domain) return fail('domain-mismatch');
        // Domain is now verified to match D; the distributed union resolution
        // is compatible with the narrowed return type.
        return resolveReference(boundRef, context) as ReferenceResolution<D>;
      }
      const named = resolveLiveId(anyRef.name, context);
      if (!named.ok) return named as ReferenceResolution<D>;
      switch (anyRef.domain) {
        case 'actor': {
          const actor = context.state.actors[named.id];
          if (!actor) return fail('missing-actor');
          return okActor(actor);
        }
        case 'entity': {
          const entity = context.state.entities[named.id];
          if (!entity) return fail('missing-entity');
          return { ok: true, value: { kind: 'entity', entity } } as ReferenceResolution<D>;
        }
        case 'position': {
          const actor = context.state.actors[named.id];
          if (!actor) return fail('missing-actor');
          if (actor.position === null) return fail('actor-without-position');
          return { ok: true, value: { kind: 'position', position: actor.position } } as ReferenceResolution<D>;
        }
        default:
          // Non-actor/entity/position domains resolve at identity level; their
          // state reads belong to the consuming kernel.
          return { ok: true, value: { kind: 'id', domain: anyRef.domain, id: named.id } } as unknown as ReferenceResolution<D>;
      }
    }
  }
}

/** Convenience constructors (pure). These are the typed API: each returns a
 * `Reference<D>` whose captured member is narrowed to `D`, so a captured actor
 * can never be built with a position literal and vice versa. */

/** A CAPTURED position reference — the durable literal case ("explode at the
 * chosen space", "return relative to your original location"). Domain `position`. */
export function capturedPosition(position: Position): Reference<'position'> {
  return { kind: 'captured-position', position: { ...position } };
}

/** A CAPTURED actor reference — the durable identity case (a defeated
 * character ref for "when the target is defeated" clauses stays resolvable
 * because the identity was captured, even though the actor leaves the
 * battlefield). Domain `actor`. STRICT: a present id whose actor is absent
 * from state is fail-closed `missing-actor`. */
export function capturedActor(actorId: string): Reference<'actor'> {
  return { kind: 'captured-actor', actorId };
}

/** A LIFECYCLE-SENSITIVE (weak) CAPTURED actor reference — "the actor
 * originally associated with this fact, if that actor still exists." The
 * remembered id may legitimately expire: resolution returns the actor when
 * present or an explicit `{ kind: 'absent' }` result when it has been
 * removed/expired. Used by durable facts (marks, motes, entities, terrain
 * effects, continuations) whose authors declare a tolerant lifetime. Domain
 * `actor`. */
export function capturedActorWeak(actorId: string): Reference<'actor'> {
  return { kind: 'captured-actor-weak', actorId };
}

/** A CAPTURED entity reference. Domain `entity`. */
export function capturedEntity(entityId: string): Reference<'entity'> {
  return { kind: 'captured-entity', entityId };
}

/** A CAPTURED scalar value reference. Domain `value`. */
export function capturedValue(value: string | number | boolean | null): Reference<'value'> {
  return { kind: 'captured-value', value };
}

/** A LIVE reference over an arbitrary domain (construct the typed name yourself). */
export function liveRef<D extends ReferenceDomain>(domain: D, name: LiveReferenceName): Reference<D> {
  return { kind: 'live', domain, name };
}

/** A LIVE actor reference naming a singular legacy context slot (e.g. the
 * attack target, the trigger source). Domain `actor`. */
export function liveActorSlot(slot: SingularSlot): Reference<'actor'> {
  return { kind: 'live', domain: 'actor', name: { kind: 'slot', slot } };
}

/** A LIVE actor reference naming a bound name from an earlier operation. */
export function liveActorBound(name: string): Reference<'actor'> {
  return { kind: 'live', domain: 'actor', name: { kind: 'bound', name } };
}

/** The plural trigger-targets slot as a collection reference. Resolves to
 * EVERY recorded trigger target in order (never the first element). */
export function liveTriggerTargets(): Reference<'actor'> {
  return { kind: 'plural-slot', domain: 'actor', slot: 'trigger-targets' };
}

/** A homogeneous collection reference (e.g. `BIND slain actors AS slain`).
 * Element domain is preserved by the type (`Reference<D>[]`). */
export function referenceCollection<D extends ReferenceDomain = ReferenceDomain>(refs: readonly Reference<D>[]): Reference<D> {
  return { kind: 'collection', refs };
}

/** Adapt the reference-shaped subset of `RuleSelector` onto the ONE U1 actor
 * reference vocabulary. `input` identities are CAPTURED because command
 * choices are already-recorded durable input; slots and bound names stay LIVE
 * and therefore re-resolve against current state. Returns null for U3 query
 * selectors rather than pretending a candidate query is a reference. */
export function actorReferenceForSelector(
  selector: RuleSelector | undefined,
  context: RuleExecutionContext,
): Reference<'actor'> | null {
  if (selector === undefined || selector.kind === 'self') return liveActorSlot('source');
  switch (selector.kind) {
    case 'attack-target': return liveActorSlot('attack-target');
    case 'trigger-source': return liveActorSlot('trigger-source');
    case 'trigger-targets': return liveTriggerTargets();
    case 'input': return referenceCollection((context.input.actorIds?.[selector.key] ?? []).map(capturedActor));
    case 'bound': return liveActorBound(selector.name);
    default: return null;
  }
}

/** Resolve a reference-shaped actor selector through U1. Consumers retain
 * their own policy (U3 eligibility, U4 cardinality, U7 exactly-one anchor),
 * while all identity/binding/LIVE-vs-CAPTURED meaning is decided here. */
export function resolveActorSelectorReference(
  selector: RuleSelector | undefined,
  context: RuleExecutionContext,
): ActorSelectorReferenceResolution {
  const ref = actorReferenceForSelector(selector, context);
  return ref === null
    ? { ok: false, problem: 'selector-not-reference' }
    : resolveReference(ref, context);
}
