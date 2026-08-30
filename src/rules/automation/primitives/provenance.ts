/**
 * provenance.ts — U9 PROVENANCE / DELIVERY DIMENSIONS: the typed vocabulary
 * for "what source caused this outcome; who owned/initiated it; what
 * ability/action/effect it came from; how it was delivered; what prior
 * resolution it derives from" — richer than a bare `sourceId`.
 *
 * ICON semantics are causal, and provenance must answer their questions
 * exactly: Pacified breaks on damage from a FOE'S ability/action (not
 * self/terrain, p.94); Slay means THIS ability reduced a character to 0
 * (p.103 glossary); Collide means shoved INTO an obstruction AS PART OF
 * THIS ability (p.102/103); dangerous terrain has its own delivery (p.95/
 * p.108); unerring/cover/dodge provenance on attacks (p.104/105); delivery
 * modes distinguish hit/miss/area/effect/save-success/terrain damage.
 *
 * Provenance is TYPED DIMENSIONS, not an expanding bag of unrelated boolean
 * flags. The plan's `DeliverySourceKind` is the ontology's missing piece:
 * it distinguishes whether the DELIVERY originated from an actor, terrain,
 * entity, or the environment — conceptually separate from the SOURCE
 * identity (which rule/actor) that caused it.
 *
 * The key separation: SOURCE IDENTITY vs DELIVERY KIND. `sourceId`/
 * `ownerId`/`sourceActorId`/`actionId` name who/what caused the outcome;
 * `delivery` + `deliverySource` describe HOW it reached the recipient. A
 * reflected/secondary delivery keeps the ORIGINAL source identity (the
 * initiating actor/ability) while recording its own delivery kind — so
 * provenance survives reflection without becoming mis-attributed.
 *
 * Foundations: no source IDs (every id here is an opaque provenance key,
 * never interpreted), no kernel imports. Uses U1 reference-key identity
 * (the id fields are the U1 reference-key forms). Consumed by U10 facts
 * (each fact carries the applicable provenance dimensions), U16 (de-dup keyed
 * on cause + usage identity), and the damage/attack/save domain authorities.
 */
import type { RuleMutation } from './types.js';

/** The DELIVERY-SOURCE ontology: where the delivery physically originated.
 * DISTINCT from the source identity — an actor-initiated attack that lands
 * through terrain delivers as `actor` with terrain delivery; terrain-based
 * damage delivers as `terrain`; a summon/entity's damage as `entity`; pure
 * environment damage as `environment`. This is the plan's missing piece. */
export type DeliverySourceKind = 'actor' | 'terrain' | 'entity' | 'environment';

/** The delivery modes ICON distinguishes (p.104/105 delivery on damage, and
 * the attack-result delivery a damage instance rides). */
export type RuleDelivery =
  | 'hit'
  | 'miss'
  | 'area'
  | 'effect'
  | 'save-success'
  | 'terrain'
  /** A direct/primary delivery with no special mode. */
  | 'direct'
  /** A reflected/redirected delivery — the provenance keeps the initiating
   * source identity while marking the reflection. */
  | 'reflected'
  /** A triggered delivery (riding a resolved trigger fact). */
  | 'triggered';

/** The movement modes a move outcome can carry (so a movement fact /
 * movement-entry trigger can name exactly how an actor arrived). */
export type RuleMovementMode =
  | 'rush' | 'shove' | 'fly' | 'teleport' | 'place' | 'remove' | 'swap';

/** A role/degree the recipient plays in a delivery — an attack's damage
 * landing on its intended target vs a collateral recipient in an area. */
export type ProvenanceRole = 'attack-target' | 'collateral' | 'recipient';

/** The full provenance record. Fields are OPTIONAL typed dimensions — only
 * the dimensions the resolve point genuinely knows are filled; an
 * unrecognized question is simply absent (never a guessed boolean). */
export interface Provenance {
  /** The rule/source unit that caused the outcome (opaque provenance key). */
  sourceId: string;
  /** The actor who owned/initiated the resolution (U1 reference-key form). */
  ownerId?: string;
  /** The specific actor/entity whose ability/action caused the outcome —
   * may differ from `ownerId` for reflected/secondary delivery, so the true
   * origin is never lost to a later hop. */
  sourceActorId?: string;
  /** The specific action/effect within the source this outcome came from. */
  actionId?: string;
  /** How the result was delivered. */
  delivery?: RuleDelivery;
  /** Where the delivery originated (actor/terrain/entity/environment). */
  deliverySource?: DeliverySourceKind;
  /** The movement mode, when this outcome is a movement. */
  movementMode?: RuleMovementMode;
  /** Whether the resolution was voluntary, forced, or a granted/borrowed
   * action (movement-entry folds distinguish forced entries). */
  volition?: 'voluntary' | 'forced' | 'granted';
  /** The recipient's role in the delivery (attack-target vs collateral). */
  role?: ProvenanceRole;
  /** The recipient id (U1 reference-key form), when an explicit one exists. */
  recipientId?: string;
  /** Reflection/redirection: this outcome was bounced from its original
   * target or redirected from its original receiver. The ORIGINAL
   * sourceActorId/sourceId remain the initiating identity — never reset. */
  rebound?: boolean;
  redirect?: boolean;
  /** Prior resolution this outcome derives from: the U1 reference key / U10
   * fact instance id of the fact that produced this one. */
  derivedFromFact?: string;
  /** Directly-nested previous provenance in a causal/trigger chain. */
  parent?: Provenance;
}

/** True when two provenances name the SAME causal origin (same initiating
 * source AND same initiating actor). Delivery mechanics, movement mode, and
 * recipient are NOT part of "who caused this" — a reflected hit derives from
 * the original attacker. The source-fidelity gate (Slay = THIS ability's
 * damage, p.103) and ownership guards read this relation. */
export function sameCausalOrigin(first: Provenance, second: Provenance): boolean {
  return first.sourceId === second.sourceId
    && (first.sourceActorId ?? first.ownerId) === (second.sourceActorId ?? second.ownerId);
}

/** Derive a provenance record at a resolve point for an actor-initiated
 * outcome. The mutation's own fields are authoritative (sourceId, the
 * initiating actor, the delivery kind, the recipient, the movement-mode);
 * dimensions the mutation does not carry stay ABSENT. The initiating
 * `sourceActorId` is preserved as the causal origin, so a downstream
 * reflection reading `sameCausalOrigin` cannot be mis-attributed. */
export function provenanceOfMutation(
  mutation: RuleMutation,
  options: { ownerId?: string; actionId?: string; volition?: Provenance['volition']; deliverySource?: DeliverySourceKind; derivedFromFact?: string } = {},
): Provenance {
  const sourceId = mutation.sourceId;
  let delivery: RuleDelivery | undefined;
  let deliverySource = options.deliverySource;
  let movementMode: RuleMovementMode | undefined;
  let recipientId: string | undefined;
  let sourceActorId: string | undefined;
  let role: ProvenanceRole | undefined;
  let ownerId = options.ownerId;

  switch (mutation.kind) {
    case 'attack':
      // The attacker is `actorId`; the attack delivers directly to its target.
      sourceActorId = mutation.actorId;
      ownerId = ownerId ?? mutation.actorId;
      recipientId = mutation.targetId;
      delivery = 'direct';
      role = 'attack-target';
      break;
    case 'damage':
      sourceActorId = mutation.sourceActorId;
      ownerId = ownerId ?? mutation.sourceActorId;
      recipientId = mutation.actorId;
      delivery = mutation.delivery;
      role = 'recipient';
      break;
    case 'heal':
    case 'vigor':
    case 'actions':
    case 'resource':
      delivery = 'effect';
      recipientId = mutation.actorId;
      break;
    case 'condition':
      sourceActorId = mutation.sourceActorId;
      ownerId = ownerId ?? mutation.sourceActorId;
      recipientId = mutation.actorId;
      delivery = 'effect';
      break;
    case 'cure':
      recipientId = mutation.actorId;
      delivery = 'effect';
      break;
    case 'move':
      sourceActorId = mutation.sourceActorId;
      ownerId = ownerId ?? mutation.sourceActorId;
      recipientId = mutation.actorId;
      movementMode = mutation.movement;
      delivery = 'direct';
      break;
    case 'terrain':
      sourceActorId = mutation.sourceActorId;
      ownerId = ownerId ?? mutation.sourceActorId;
      deliverySource = deliverySource ?? 'environment';
      delivery = 'area';
      break;
    case 'entity':
      ownerId = ownerId ?? mutation.ownerId;
      deliverySource = deliverySource ?? (mutation.category === 'object' ? 'environment' : 'entity');
      delivery = 'effect';
      break;
    case 'mark':
      ownerId = ownerId ?? mutation.ownerId;
      recipientId = mutation.actorId;
      delivery = 'effect';
      break;
    case 'stance':
      sourceActorId = mutation.sourceActorId;
      ownerId = ownerId ?? mutation.sourceActorId;
      recipientId = mutation.actorId;
      delivery = 'effect';
      break;
    case 'persistent':
    case 'modifier':
      ownerId = ownerId ?? mutation.ownerId;
      recipientId = mutation.actorId;
      delivery = 'effect';
      break;
    case 'save':
      recipientId = mutation.actorId;
      delivery = 'save-success';
      break;
    case 'defeat':
      ownerId = ownerId ?? mutation.actorId;
      delivery = 'effect';
      break;
    case 'state':
      recipientId = mutation.actorId;
      delivery = 'effect';
      break;
    case 'phase':
    case 'end-turn':
      ownerId = ownerId ?? mutation.sourceActorId;
      delivery = 'effect';
      break;
    case 'resolution-facts':
      break;
  }

  return {
    sourceId,
    ...(ownerId !== undefined ? { ownerId } : {}),
    // ALWAYS preserve the causal origin (`sourceActorId`) when the mutation
    // names one — even when it equals the owner. Stripping it when equal
    // would let a later reflection hop white-out the true origin.
    ...(sourceActorId !== undefined ? { sourceActorId } : {}),
    ...(options.actionId !== undefined ? { actionId: options.actionId } : {}),
    ...(delivery !== undefined ? { delivery } : {}),
    ...(deliverySource !== undefined ? { deliverySource } : {}),
    ...(movementMode !== undefined ? { movementMode } : {}),
    ...(options.volition !== undefined ? { volition: options.volition } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(recipientId !== undefined ? { recipientId } : {}),
    ...(options.derivedFromFact !== undefined ? { derivedFromFact: options.derivedFromFact } : {}),
  };
}