/**
 * ordering.ts — U17 ORDERING / ARBITRATION: typed policies for "when
 * multiple operations are simultaneously eligible, what determines their
 * order" — NOT one `priority: number`.
 *
 * ICON defines several distinct ordering authorities: listed effect order
 * (p.85, p.107 §4 — "effects resolve in the order they are listed"),
 * interrupt nesting (most-recent trigger first, p.107), same-trigger
 * turn-order rules (p.107), turn-boundary ordering (non-turn-character
 * effects first, hostile before beneficial, the same-owner player
 * determines the rest — p.107), Delay ordering at slow-turn start (p.87),
 * and player ordering choices (p.107). Before this module every one of
 * those was scattered array order; this module gives them typed homes so
 * array construction order never silently becomes the game rule.
 *
 * A policy may YIELD A CHOICE: when the source gives someone (a player, the
 * GM) authority to ORDER the candidates, `policyYieldsChoice` returns the
 * typed U4 choice spec and the ordering decision becomes a recorded player
 * decision — NEVER a deterministic tie-break invented by the engine.
 *
 * Replay semantics: ordering is a pure function of the recorded policy +
 * durable state (`orderingKey` names the policy for durable identity);
 * replay never depends on array construction order. A controller-choice
 * ordering records the player's ordering decision and replays it.
 *
 * Foundation: no source IDs, no kernel imports. Uses U2 roles (side/owner
 * policy reads) and U4 choice (the policy→choice seam).
 */
import type { RuleChoice } from './types.js';
import type { RoleMap } from './roles.js';

/** A candidate an ordering policy orders: the identity the policy compares,
 * plus the side/owner facts the side- and owner-relative policies read. */
export interface OrderingCandidate {
  id: string;
  /** The side this candidate belongs to (heroes/foes) — the
   * hostile-before-beneficial read. */
  side?: string;
  /** Whether this candidate IS the active owner's (the
   * non-active-owner-first read). */
  isActiveOwner?: boolean;
}

/** The context an ordering policy reads: the active actor (whose turn/state
 * the ordering is relative to), a perspective actor (the "beneficial"
 * reference for hostile-before-beneficial), the recorded turn order, and
 * the derived role map (U2) for controller-choice entitlement. */
export interface OrderingContext {
  /** The active actor id (turn-order / non-active-owner-first reads). */
  activeActorId?: string;
  /** The perspective actor id: hostile-before-beneficial orders candidates
   * of a different side FIRST (a foe acting against you resolves before
   * your own beneficial effects, p.107). */
  perspectiveActorId?: string;
  /** The perspective actor's side (the hostile/beneficial classification
   * read). When absent, the policy falls back to reading the perspective
   * actor's side from the candidate list; with neither it fails closed
   * (source order) rather than inventing a classification. */
  perspectiveSide?: string;
  /** The recorded turn order (turn-order policy): candidates ordered by
   * their position in the scheduler's turn sequence. */
  turnOrder?: readonly string[];
  /** The full source-listing order (source-order policy): candidates
   * ordered by their position in the source's listing (p.85, p.107 §4).
   * This is the reference an ability's step list / a recipes registry
   * provides — a SUBSET of candidates re-sorts into source order by it. */
  sourceOrder?: readonly string[];
  /** The derived role map (U2) — controller-choice entitlement reads who
   * decides the order. */
  roleMap?: RoleMap;
}

/** The typed ordering policies. Each names a DISTINCT source authority:
 * never one numeric priority. */
export type OrderingPolicy =
  /** Source/listed order: candidates in their source-listing order (p.85,
   * p.107 §4). The engine's canonical ability-step order. */
  | { kind: 'source-order' }
  /** Stack / LIFO: the most-recently-added candidate first (interrupt
   * nesting, p.107: the most-recent trigger resolves first). */
  | { kind: 'stack' }
  /** Turn order: candidates ordered by the recorded scheduler turn
   * sequence. */
  | { kind: 'turn-order' }
  /** Hostile-before-beneficial (p.107 turn-boundary ordering): candidates
   * of a different side than the perspective actor come first; the rest
   * keep their source order. */
  | { kind: 'hostile-before-beneficial' }
  /** Non-active-owner-first (p.107): candidates that are NOT the active
   * actor's resolve before the active actor's own. */
  | { kind: 'non-active-owner-first' }
  /** Controller-choice: someone with authority (U2 role) decides the order.
   * The policy YIELDS A CHOICE (`policyYieldsChoice`); `applyOrdering`
   * returns the candidates in source order and the caller must resolve the
   * recorded ordering choice — the engine never invents an order. */
  | { kind: 'controller-choice'; choice: RuleChoice }
  /** Explicit ordered list: candidates ordered by the given id list
   * (unknown ids keep their source order after the listed ones). */
  | { kind: 'explicit-list'; order: readonly string[] };

/** Whether the policy delegates the order to a player/GM choice. A
 * controller-choice policy yields the typed U4 ChoiceSpec; the caller
 * routes the ordering through the choice authority and records the player's
 * ordering decision. */
export function policyYieldsChoice(policy: OrderingPolicy): RuleChoice | null {
  return policy.kind === 'controller-choice' ? policy.choice : null;
}

/** The durable identity of a policy (for ordering records / replay):
 * deterministic, JSON-clean. */
export function orderingKey(policy: OrderingPolicy): string {
  switch (policy.kind) {
    case 'source-order': return 'source-order';
    case 'stack': return 'stack';
    case 'turn-order': return 'turn-order';
    case 'hostile-before-beneficial': return 'hostile-before-beneficial';
    case 'non-active-owner-first': return 'non-active-owner-first';
    case 'controller-choice': return `controller-choice:${policy.choice.key}`;
    case 'explicit-list': return `explicit-list:${policy.order.join(',')}`;
  }
}

/** Apply one ordering policy to the candidates. Pure — a deterministic
 * function of the policy, the candidates, and the durable context. A policy
 * that yields a choice (controller-choice) returns the candidates in source
 * order: the recorded choice decides the final order, never this function.
 * An undefined/unrepresentable ordering never silently iterates — callers
 * that cannot resolve a yielded choice must reject, not fall back. */
export function applyOrdering(
  policy: OrderingPolicy,
  candidates: readonly OrderingCandidate[],
  context: OrderingContext = {},
): OrderingCandidate[] {
  switch (policy.kind) {
    case 'source-order': {
      const sourceOrder = context.sourceOrder ?? [];
      const position = new Map(sourceOrder.map((id, index) => [id, index]));
      return [...candidates].sort((a, b) => {
        const pa = position.get(a.id);
        const pb = position.get(b.id);
        if (pa === undefined && pb === undefined) return 0;
        if (pa === undefined) return 1;
        if (pb === undefined) return -1;
        return pa - pb;
      });
    }
    case 'controller-choice':
      // The policy yields a choice: the recorded player decision orders the
      // candidates, never this function. Candidates pass through in source
      // order for the choice UI; the resolved choice reorders them durably.
      return [...candidates];
    case 'stack':
      return [...candidates].reverse();
    case 'turn-order': {
      const turnOrder = context.turnOrder ?? [];
      const position = new Map(turnOrder.map((id, index) => [id, index]));
      return [...candidates].sort((a, b) => {
        const pa = position.get(a.id);
        const pb = position.get(b.id);
        if (pa === undefined && pb === undefined) return 0;
        if (pa === undefined) return 1;
        if (pb === undefined) return -1;
        return pa - pb;
      });
    }
    case 'hostile-before-beneficial': {
      // Without a perspective actor/side the policy cannot classify hostile
      // vs beneficial — candidates keep their source order (fail closed,
      // never an invented classification).
      const perspectiveSide = context.perspectiveSide
        ?? (context.perspectiveActorId === undefined ? undefined : candidateSideOf(candidates, context.perspectiveActorId));
      const hostile: OrderingCandidate[] = [];
      const beneficial: OrderingCandidate[] = [];
      for (const candidate of candidates) {
        if (perspectiveSide !== undefined && candidate.side !== undefined && candidate.side !== perspectiveSide) {
          hostile.push(candidate);
        } else {
          beneficial.push(candidate);
        }
      }
      return [...hostile, ...beneficial];
    }
    case 'non-active-owner-first': {
      const active = context.activeActorId;
      const others: OrderingCandidate[] = [];
      const own: OrderingCandidate[] = [];
      for (const candidate of candidates) {
        if (active !== undefined && (candidate.id === active || candidate.isActiveOwner)) {
          own.push(candidate);
        } else {
          others.push(candidate);
        }
      }
      return [...others, ...own];
    }
    case 'explicit-list': {
      const position = new Map(policy.order.map((id, index) => [id, index]));
      return [...candidates].sort((a, b) => {
        const pa = position.get(a.id);
        const pb = position.get(b.id);
        if (pa === undefined && pb === undefined) return 0;
        if (pa === undefined) return 1;
        if (pb === undefined) return -1;
        return pa - pb;
      });
    }
  }
}

/** The side of a candidate id within the candidate list (the perspective
 * side read for hostile-before-beneficial). */
function candidateSideOf(candidates: readonly OrderingCandidate[], id: string): string | undefined {
  return candidates.find((candidate) => candidate.id === id)?.side;
}
