/**
 * roles.ts — U2 ROLE / PERSPECTIVE vocabulary: the typed distinction of
 * *relative to whom a clause is interpreted*.
 *
 * ICON semantics are perspective-dependent: "Ally" is defined relative to
 * the source ("another living ally", p.92); marks are OWNED by a marker and
 * CARRIED by a target (p.94); Sacrifice is PAID by the user (p.102/103);
 * Blessing tokens are owned by the character being saved (p.102/p.172); the
 * durable save-reroll window decides who owns the reroll (Sucker Punch,
 * p.143); interrupt legality is judged from the source/controller's position
 * (Masquerade, p.151). The engine must DERIVE which connected player is
 * entitled to answer a choice from semantic controller/chooser roles
 * (multiplayer/VTT authority).
 *
 * ROLE ≠ REFERENCE (U1): roles answer "relative to whom"; references name
 * things. ROLE ≠ ANCHOR (U7): "effects on the original user still apply to
 * the original user" even when the rebound character's space is the spatial
 * origin — the original-user role and the current-origin role can differ.
 *
 * Controller authority is subject-relative (corrective pass 2026-08-30).
 * `controller-of(source)` and `controller-of(target)` can resolve to TWO
 * DIFFERENT players in the same resolution when the source and the target
 * are controlled by different connected players. `RoleFrame.controllers`
 * records a per-SUBJECT-ROLE map of who controls the actor filling that role
 * (recorded durable state, never ambient websocket/session ownership, so
 * replay derives the same authority). `resolveRoleSelector` look up the
 * controller OF THE SUBJECT role only — it never falls back to the source
 * when the recorded controller is absent (an underivable semantic role
 * rejects rather than guesses, fail-closed).
 *
 * Foundation: no source IDs, no kernel imports. `deriveRoles` produces the
 * semantic role authority for a resolution; `RuleChoice` carries typed
 * optional chooser/controller roles (behavior-neutral until U4 consumes them).
 */
import type { RuleExecutionContext } from './types.js';

/**
 * The U2 authority's BRANDED perspective result. Only the U2 authority
 * (`relationPerspectiveId`, `relationPerspectiveIdFromContext`,
 * `auraRelationPerspectiveId`) can produce a `RelationPerspective`. A plain
 * id (`context.actorId`, `actor.id`, `entity.ownerId`, or any local alias of
 * them) is NOT assignable to a `RelationPerspective` slot — that is a TYPE
 * ERROR — so the value the downstream relation / aura-membership decision
 * actually consumes is structurally guaranteed to have come from the U2
 * authority (T8c: AUTHORITY RESULT USED, not merely AUTHORITY CALLED). The
 * branded id is still a string (usable as a `Record<string, …>` index), so
 * the seam adds proof without changing any durable bytes.
 */
declare const relationPerspectiveBrand: unique symbol;
export type RelationPerspective = string & { readonly [relationPerspectiveBrand]: true };

/** Brand a derived id as the U2 perspective result. Internal to the authority:
 * the ONLY place plain ids become `RelationPerspective`. Null (underivable)
 * stays null — a caller that needs a perspective must reject, never guess. */
function brandPerspective(id: string | null): RelationPerspective | null {
  return id === null ? null : (id as RelationPerspective);
}

/** The semantic roles a resolution can attribute. */
export type Role =
  | 'source'
  | 'owner'
  | 'controller'
  | 'chooser'
  | 'payer'
  | 'target'
  | 'recipient'
  | 'carrier'
  | 'creator'
  | 'trigger-source'
  | 'trigger-recipient'
  | 'attacker'
  | 'defender'
  | 'original-user'
  | 'current-origin';

/** The durable role facts a derivation reads. All optional except `sourceId`
 * (every resolution has a source). Recorded state + the durable choice rows
 * — never ambient connection state, so replay derives the same authority. */
export interface RoleFrame {
  /** The ability user / acting actor. */
  sourceId: string;
  /** The primary target of the current resolution. */
  targetId?: string;
  /** Owner of the effect/mark/stance being resolved (p.94 marks are owned
   * by the marker, carried by the target). */
  ownerId?: string;
  /** Who decides a choice (defaults to the controller, then the source). */
  chooserId?: string;
  /** Who pays a cost (p.102/103 Sacrifice is paid by the user). */
  payerId?: string;
  /** Who receives the damage/effect (p.105 when-damaged windows). */
  recipientId?: string;
  /** Who carries the mark/status/effect (p.94). */
  carrierId?: string;
  /** The creator/summoner of an entity (p.95 summons belong to their
   * summoner; removed when the summoner is defeated). */
  creatorId?: string;
  /** Who/what caused a trigger. */
  triggerSourceId?: string;
  /** Who/what the trigger resolves against. */
  triggerRecipientId?: string;
  /** The attacker in an attack resolution. */
  attackerId?: string;
  /** The defender in an attack resolution. */
  defenderId?: string;
  /** The original user before redirection/rebound. */
  originalUserId?: string;
  /** The current origin — a ROLE, distinct from the U7 spatial ANCHOR: the
   * rebound character's space is the anchor while the original user's role
   * is unchanged. */
  currentOriginId?: string;
  /** Subject-relative controller authority (multiplayer/VTT): for a SUBJECT
   * ROLE `r`, the connected player recorded as controlling the actor filling
   * `r` (e.g. `{ target: 'player-b', 'trigger-source': 'player-a' }`). An
   * ABSENT entry means no recorded controller for that subject — underivable,
   * fail closed. Range is recorded durable state, never ambient
   * websocket/session ownership, so replay derives the same map. */
  controllers?: Partial<Record<Role, string>>;
}

/** The derived semantic role authority for a resolution. Two halves:
 *
 *  - `roles`: the plain role→identity derivation (source, owner, target, …).
 *  - `controllers`: the subject-relative controller map — who controls each
 *    subject ROLE. A dedicated map (NOT global scalar fields like
 *    `targetControllerId`/`sourceControllerId`) so `controller-of(source)` and
 *    `controller-of(target)` can differ in the same resolution.
 *
 * Both are pure functions of the durable `RoleFrame`. Absent facts stay
 * absent — a caller that needs a role that cannot be derived must reject,
 * never guess. */
export interface RoleMap {
  roles: Partial<Record<Role, string>>;
  controllers: Partial<Record<Role, string>>;
}

/** Derive the semantic role map for a resolution. Deterministic: a pure
 * function of the durable role frame. Absent facts stay absent — a caller
 * that needs a role that cannot be derived must reject, never guess. */
export function deriveRoles(frame: RoleFrame): RoleMap {
  const roles: Partial<Record<Role, string>> = {
    source: frame.sourceId,
  };
  if (frame.targetId !== undefined) roles.target = frame.targetId;
  if (frame.ownerId !== undefined) roles.owner = frame.ownerId;
  if (frame.chooserId !== undefined) roles.chooser = frame.chooserId;
  if (frame.payerId !== undefined) roles.payer = frame.payerId;
  if (frame.recipientId !== undefined) roles.recipient = frame.recipientId;
  if (frame.carrierId !== undefined) roles.carrier = frame.carrierId;
  if (frame.creatorId !== undefined) roles.creator = frame.creatorId;
  if (frame.triggerSourceId !== undefined) roles['trigger-source'] = frame.triggerSourceId;
  if (frame.triggerRecipientId !== undefined) roles['trigger-recipient'] = frame.triggerRecipientId;
  if (frame.attackerId !== undefined) roles.attacker = frame.attackerId;
  if (frame.defenderId !== undefined) roles.defender = frame.defenderId;
  if (frame.originalUserId !== undefined) roles['original-user'] = frame.originalUserId;
  if (frame.currentOriginId !== undefined) roles['current-origin'] = frame.currentOriginId;
  return { roles, controllers: frame.controllers ?? {} };
}

/** A typed role selection for a choice row: who decides (chooser) and who
 * answers at the network boundary (controller). `controller-of` resolves the
 * controller OF THE SUBJECT role (e.g. the TARGET_CONTROLLER of p.143's
 * "if multiple foes are equidistant, you may choose" is the controller of the
 * target). */
export type RoleSelector =
  | { kind: 'role'; role: Role }
  | { kind: 'controller-of'; subject: Role };

/** Resolve a RoleSelector against a derived RoleMap. Returns null when the
 * role cannot be derived — the command boundary rejects rather than guessing
 * (a choice row whose chooser cannot be derived is malformed).
 *
 * `controller-of(subject)` is SUBJECT-RELATIVE: it returns the recorded
 * controller OF THAT SUBJECT role. It requires the subject to be derivable
 * AND a controller to be recorded for that subject; a missing controller for
 * an otherwise valid subject returns null (it does NOT silently fall back to
 * the source), because an underivable semantic role must reject rather than
 * guess. */
export function resolveRoleSelector(selector: RoleSelector, map: RoleMap): string | null {
  switch (selector.kind) {
    case 'role':
      return map.roles[selector.role] ?? null;
    case 'controller-of': {
      const subjectId = map.roles[selector.subject];
      if (subjectId === undefined) return null;
      const controller = map.controllers[selector.subject];
      if (controller === undefined) return null;
      return controller;
    }
  }
}

/** Build a RoleFrame from the legacy context slots — the migration seam that
 * replaces ad hoc `context.actorId`/`attackTargetId`/`triggerSourceId`/
 * `damageRecipientId` reads with typed role derivation. The legacy context
 * carries no recorded per-subject controller facts, so `controllers` stays
 * empty here (every controller-of resolution fails closed until a real
 * multiplayer/session authority records controllers). */
export function roleFrameFromContext(context: RuleExecutionContext): RoleFrame {
  return {
    sourceId: context.actorId,
    ...(context.ownerId !== undefined ? { ownerId: context.ownerId } : {}),
    targetId: context.attackTargetId,
    recipientId: context.damageRecipientId,
    triggerSourceId: context.triggerSourceId,
    triggerRecipientId: context.triggerTargetIds?.[0],
    attackerId: context.actorId,
    defenderId: context.attackTargetId,
    originalUserId: context.actorId,
    currentOriginId: context.actorId,
  };
}

/** The U2 authority for "relative to whom is a self/ally/foe relation
 * established": the actor whose SIDE is compared. ICON defines "ally"
 * relative to the source ("another living ally", p.92), so the default
 * relation perspective is the SOURCE role. Side/faction remains the
 * underlying factual property (U3 eligibility compares it); U2 decides WHO
 * is the perspective subject. Returns null only for a genuinely underivable
 * frame (no source) — callers fail closed rather than guessing an actor.
 * The return is the BRANDED `RelationPerspective`: a consumer cannot feed a
 * locally-aliased id into the perspective decision without a type error, so
 * the value that drives relation eligibility is provably the U2 result.
 */
export function relationPerspectiveId(frame: RoleFrame): RelationPerspective | null {
  return brandPerspective(frame.sourceId ?? null);
}

/** Convenience over the legacy context slots: the relation perspective for a
 * resolution is the source role it records, so candidate/aura/choice relation
 * reads never independently infer the perspective from an incidental field.
 * Returns the U2 BRANDED perspective (a consumer cannot substitute a local id).
 */
export function relationPerspectiveIdFromContext(context: RuleExecutionContext): RelationPerspective | null {
  return relationPerspectiveId(roleFrameFromContext(context));
}

/** The durable RESPONDER role a window/decision resolves to (U2 narrator for
 * U13): the window's actorId is the responder whose interrupt entitlement or
 * choice this is, and the recorded per-SUBJECT controller map is the network
 * responder authority. A window responder is a pure function of the durable
 * frame (never ambient connection state), so replay derives the same actor
 * and the network boundary maps it through the recorded controller. Returns
 * null when the frame cannot derive the responder role.
 */
export function windowResponderId(selector: RoleSelector, frame: RoleFrame): string | null {
  return resolveRoleSelector(selector, deriveRoles(frame));
}

/**
 * The U2 AURA MEMBER PERSPECTIVE authority: "relative to whom is an aura's
 * ally/foe membership interpreted?"
 *
 * ROLE ≠ ANCHOR (U7): the SPATIAL ORIGIN (whose square emits the aura, and the
 * U7 anchor membership is measured from) is a separate fact from the SEMANTIC
 * PERSPECTIVE subject (the actor whose SIDE establishes whether another
 * character is an ally or a foe). The aura KERNEL supplies the durable origin
 * FACTS (whether the aura sits on a character-bearer or on an entity, and who
 * the bearer / entity creator-owner is); U2 owns the mapping RULE:
 *
 *   - an actor-bearing aura is interpreted relative to its BEARER;
 *   - an entity-origin aura is interpreted relative to the entity's
 *     CREATOR/OWNER (an entity has no side of its own);
 *   - an OWNERLESS / neutral entity has NO derivable ally/foe perspective —
 *     the aura can only express `characters` membership, never a manufactured
 *     side.
 *
 * This keeps creator ≠ owner ≠ spatial anchor ≠ affected member representable:
 * an entity-origin aura's perspective is the creator/owner while its U7
 * spatial origin is the entity, and a Rebound original-user role never
 * collapses into the current-origin spatial anchor. Returns null exactly when
 * no ally/foe perspective is derivable — the consuming kernel FAILS CLOSED
 * (only `characters` relations apply) rather than guessing an actor from the
 * spatial anchor.
 */
export type AuraPerspectiveOrigin =
  | { kind: 'actor'; bearerId: string }
  | { kind: 'entity'; ownerId: string | null };

export function auraRelationPerspectiveId(origin: AuraPerspectiveOrigin): RelationPerspective | null {
  switch (origin.kind) {
    case 'actor':
      return brandPerspective(origin.bearerId);
    case 'entity':
      // The entity's canonical OWNER/SUMMONER identity is the perspective
      // subject (ICON p.95: a summon belongs to its summoner). Current engine
      // scope has ONE canonical identity per entity — creator and owner are
      // NOT distinct representable roles yet, and no source-required aura
      // semantics need them to differ. An ownerless entity has no derivable
      // ally/foe side (only `characters` membership applies). Null here is a
      // POSITIVE underivable result — the caller fails closed, never guesses.
      // The return is the U2 BRANDED perspective: an aliased local id can
      // never be placed in `AuraOriginRef.perspectiveActorId` without a type
      // error, so aura membership is provably U2-derived.
      return brandPerspective(origin.ownerId);
  }
}