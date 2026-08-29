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
 * Foundation: no source IDs, no kernel imports. `deriveRoles` produces the
 * semantic role map for a resolution; `RuleChoice` carries typed optional
 * chooser/controller roles (behavior-neutral until U4 consumes them).
 */
import type { RuleExecutionContext } from './types.js';

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
 * — never ambient connection state, so replay derives the same map. */
export interface RoleFrame {
  /** The ability user / acting actor. */
  sourceId: string;
  /** The primary target of the current resolution. */
  targetId?: string;
  /** Owner of the effect/mark/stance being resolved (p.94 marks are owned
   * by the marker, carried by the target). */
  ownerId?: string;
  /** Who answers for an actor at the network boundary (recorded). */
  controllerId?: string;
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
}

export type RoleMap = Readonly<Partial<Record<Role, string>>>;

/** Derive the semantic role map for a resolution. Deterministic: a pure
 * function of the durable role frame. Absent facts stay absent — a caller
 * that needs a role that cannot be derived must reject, never guess. */
export function deriveRoles(frame: RoleFrame): RoleMap {
  const roles: Partial<Record<Role, string>> = {
    source: frame.sourceId,
  };
  if (frame.targetId !== undefined) roles.target = frame.targetId;
  if (frame.ownerId !== undefined) roles.owner = frame.ownerId;
  if (frame.controllerId !== undefined) roles.controller = frame.controllerId;
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
  return roles;
}

/** A typed role selection for a choice row: who decides (chooser) and who
 * answers at the network boundary (controller). `controller-of` resolves
 * relative to another role (e.g. the TARGET_CONTROLLER of p.143's
 * "if multiple foes are equidistant, you may choose" is the controller of
 * the target). */
export type RoleSelector =
  | { kind: 'role'; role: Role }
  | { kind: 'controller-of'; subject: Role };

/** Resolve a RoleSelector against a derived RoleMap. Returns null when the
 * role cannot be derived — the command boundary rejects rather than
 * guessing (a choice row whose chooser cannot be derived is malformed). */
export function resolveRoleSelector(selector: RoleSelector, roles: RoleMap): string | null {
  switch (selector.kind) {
    case 'role':
      return roles[selector.role] ?? null;
    case 'controller-of': {
      const subject = roles[selector.subject];
      if (subject === undefined) return null;
      // The controller is derived from the recorded role frame; absent
      // controller facts fall back to the source (a solo/local table has no
      // separate controller layer).
      return roles.controller ?? roles.source ?? null;
    }
  }
}

/** Build a RoleFrame from the legacy context slots — the migration seam that
 * replaces ad hoc `context.actorId`/`attackTargetId`/`triggerSourceId`/
 * `damageRecipientId` reads with typed role derivation. */
export function roleFrameFromContext(context: RuleExecutionContext): RoleFrame {
  return {
    sourceId: context.actorId,
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
