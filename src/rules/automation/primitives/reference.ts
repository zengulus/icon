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
 * Foundation: no source IDs, no kernel imports. The Binder is carried on the
 * execution context (`context.boundNames`) and will later ride continuation
 * records (U12).
 */
import type { Position } from '../../types.js';
import type { RuleActorView, RuleEntityView, RuleExecutionContext } from './types.js';

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

/** A typed name for a LIVE reference, resolved at use time. */
export type LiveReferenceName =
  | { kind: 'slot'; slot: 'source' | 'attack-target' | 'trigger-source' | 'trigger-targets' | 'damage-recipient' }
  | { kind: 'id'; id: string }
  | { kind: 'bound'; name: string };

/** The durable literal a CAPTURED reference preserves. */
export type CapturedReferenceValue =
  | { kind: 'actor'; actorId: string }
  | { kind: 'entity'; entityId: string }
  | { kind: 'position'; position: Position }
  | { kind: 'value'; value: string | number | boolean | null };

/** A typed reference. LIVE refs re-resolve against current state; CAPTURED
 * refs carry a durable literal; `collection` carries refs[] (e.g. `BIND
 * slain actors AS slain`). Structural and typed — never a stringly property
 * path. */
export type Reference =
  | { kind: 'live'; domain: ReferenceDomain; name: LiveReferenceName }
  | { kind: 'captured'; domain: 'actor' | 'entity' | 'position' | 'value'; value: CapturedReferenceValue }
  | { kind: 'collection'; refs: readonly Reference[] };

/** A resolved reference value. `id` is the identity-level resolution for
 * domains whose state reads belong to their consuming kernel (mark/stance/
 * terrain/area/resource/rule/roll); actor/entity/position/value resolve
 * against current state here. */
export type ResolvedReference =
  | { kind: 'actor'; actor: RuleActorView }
  | { kind: 'entity'; entity: RuleEntityView }
  | { kind: 'position'; position: Position }
  | { kind: 'value'; value: string | number | boolean | null }
  | { kind: 'id'; domain: ReferenceDomain; id: string }
  | { kind: 'collection'; items: readonly ResolvedReference[] };

export type ReferenceResolution =
  | { ok: true; value: ResolvedReference }
  | { ok: false; problem: 'unknown-bound-name' | 'missing-slot' | 'missing-actor' | 'missing-entity' | 'actor-without-position' };

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

/** Resolve the id a LIVE reference names from a slot or direct id.
 * Deterministic: reads the context verbatim. Bound names are resolved by
 * the caller (they may name CAPTURED/collection refs, not just ids). */
function resolveLiveId(name: LiveReferenceName, context: RuleExecutionContext): { ok: true; id: string; domain: ReferenceDomain } | { ok: false; problem: 'missing-slot' } {
  switch (name.kind) {
    case 'slot':
      switch (name.slot) {
        case 'source': return { ok: true, id: context.actorId, domain: 'actor' };
        case 'attack-target':
          return context.attackTargetId !== undefined
            ? { ok: true, id: context.attackTargetId, domain: 'actor' }
            : { ok: false, problem: 'missing-slot' };
        case 'trigger-source':
          return context.triggerSourceId !== undefined
            ? { ok: true, id: context.triggerSourceId, domain: 'actor' }
            : { ok: false, problem: 'missing-slot' };
        case 'trigger-targets': {
          const first = context.triggerTargetIds?.[0];
          return first !== undefined
            ? { ok: true, id: first, domain: 'actor' }
            : { ok: false, problem: 'missing-slot' };
        }
        case 'damage-recipient':
          return context.damageRecipientId !== undefined
            ? { ok: true, id: context.damageRecipientId, domain: 'actor' }
            : { ok: false, problem: 'missing-slot' };
      }
      break;
    case 'id':
      return { ok: true, id: name.id, domain: 'actor' };
    case 'bound':
      // Resolved by the caller (resolveReference's live branch); a bound
      // name can name a CAPTURED/collection ref, so there is no id here.
      return { ok: false, problem: 'missing-slot' };
  }
}

/** Resolve one reference deterministically against the current context.
 * A CAPTURED reference is a durable literal once captured — it never reads
 * later state (replay must never re-derive it). A LIVE reference re-resolves
 * at use time. Pure: no state is mutated, no RNG is consumed. */
export function resolveReference(ref: Reference, context: RuleExecutionContext): ReferenceResolution {
  switch (ref.kind) {
    case 'captured':
      switch (ref.value.kind) {
        case 'actor': {
          const actor = context.state.actors[ref.value.actorId];
          if (!actor) return { ok: false, problem: 'missing-actor' };
          return { ok: true, value: { kind: 'actor', actor } };
        }
        case 'entity': {
          const entity = context.state.entities[ref.value.entityId];
          if (!entity) return { ok: false, problem: 'missing-entity' };
          return { ok: true, value: { kind: 'entity', entity } };
        }
        case 'position':
          return { ok: true, value: { kind: 'position', position: ref.value.position } };
        case 'value':
          return { ok: true, value: { kind: 'value', value: ref.value.value } };
      }
      break;
    case 'collection': {
      const items: ResolvedReference[] = [];
      for (const item of ref.refs) {
        const resolution = resolveReference(item, context);
        if (!resolution.ok) return resolution;
        items.push(resolution.value);
      }
      return { ok: true, value: { kind: 'collection', items } };
    }
    case 'live': {
      // A BOUND name refers to whatever reference was bound by the earlier
      // operation — which may itself be CAPTURED (a chosen landing space), a
      // collection (`BIND slain actors AS slain`), or another LIVE ref.
      // Resolve the bound reference recursively rather than forcing an id.
      if (ref.name.kind === 'bound') {
        const boundRef = lookupBound(context.boundNames ?? EMPTY_BINDER, ref.name.name);
        if (boundRef === undefined) return { ok: false, problem: 'unknown-bound-name' };
        return resolveReference(boundRef, context);
      }
      const named = resolveLiveId(ref.name, context);
      if (!named.ok) return named;
      if (named.domain !== 'actor' && ref.domain !== 'actor') {
        // Non-actor named ids resolve at identity level; their state reads
        // belong to the consuming kernel.
        return { ok: true, value: { kind: 'id', domain: ref.domain, id: named.id } };
      }
      switch (ref.domain) {
        case 'actor': {
          const actor = context.state.actors[named.id];
          if (!actor) return { ok: false, problem: 'missing-actor' };
          return { ok: true, value: { kind: 'actor', actor } };
        }
        case 'entity': {
          const entity = context.state.entities[named.id];
          if (!entity) return { ok: false, problem: 'missing-entity' };
          return { ok: true, value: { kind: 'entity', entity } };
        }
        case 'position': {
          const actor = context.state.actors[named.id];
          if (!actor) return { ok: false, problem: 'missing-actor' };
          if (actor.position === null) return { ok: false, problem: 'actor-without-position' };
          return { ok: true, value: { kind: 'position', position: actor.position } };
        }
        default:
          return { ok: true, value: { kind: 'id', domain: ref.domain, id: named.id } };
      }
    }
  }
}

/** Convenience constructors (pure). */

/** A CAPTURED position reference — the durable literal case ("explode at the
 * chosen space", "return relative to your original location"). */
export function capturedPosition(position: Position): Reference {
  return { kind: 'captured', domain: 'position', value: { kind: 'position', position: { ...position } } };
}

/** A CAPTURED actor reference — the durable identity case (a defeated
 * character ref for "when the target is defeated" clauses stays resolvable
 * because the identity was captured, even though the actor leaves the
 * battlefield). */
export function capturedActor(actorId: string): Reference {
  return { kind: 'captured', domain: 'actor', value: { kind: 'actor', actorId } };
}

/** A LIVE actor reference naming a legacy context slot (e.g. the attack
 * target, the trigger source). */
export function liveActorSlot(slot: 'source' | 'attack-target' | 'trigger-source' | 'trigger-targets' | 'damage-recipient'): Reference {
  return { kind: 'live', domain: 'actor', name: { kind: 'slot', slot } };
}

/** A LIVE actor reference naming a bound name from an earlier operation. */
export function liveActorBound(name: string): Reference {
  return { kind: 'live', domain: 'actor', name: { kind: 'bound', name } };
}

/** A collection reference (e.g. `BIND slain actors AS slain`). */
export function referenceCollection(refs: readonly Reference[]): Reference {
  return { kind: 'collection', refs };
}
