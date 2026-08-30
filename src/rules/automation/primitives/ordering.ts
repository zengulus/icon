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
   * actor's side from the candidate list; with neither it is UNRESOLVED
   * (`missing-perspective`) rather than inventing a classification. */
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
   * keep the candidates' declared order within the beneficiary group. */
  | { kind: 'hostile-before-beneficial' }
  /** Non-active-owner-first (p.107): candidates that are NOT the active
   * actor's resolve before the active actor's own. */
  | { kind: 'non-active-owner-first' }
  /** Controller-choice: someone with authority (U2 role) decides the order.
   * The policy YIELDS A CHOICE (`policyYieldsChoice`); `applyOrdering`
   * returns a `yields-choice` unresolved result carrying the typed choice
   * and the caller routes the recorded ordering decision through U4 — the
   * engine never invents an order. */
  | { kind: 'controller-choice'; choice: RuleChoice }
  /** Explicit ordered list: candidates ordered by the given id list. An id
   * absent from the list is UNRESOLVED (`unknown-candidate`); the incoming
   * array order is never used as an accidental tie-break. */
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

/** What went wrong when an ordering policy cannot be resolved. FAIL CLOSED
 * means exactly this: the policy returns an unresolved result and the
 * command/window boundary REJECTS — it never silently falls back to the
 * caller's incoming array order (arbitrary caller array construction must
 * never become game semantics). */
export type OrderingProblem =
  /** source-order was applied without `context.sourceOrder` — the policy
   * cannot name the source listing it must order against. */
  | 'missing-source-order'
  /** turn-order was applied without `context.turnOrder` — the recorded
   * scheduler sequence is unavailable. */
  | 'missing-turn-order'
  /** hostile-before-beneficial was applied without a perspective actor/
   * side — the hostile/beneficial classification is underivable. */
  | 'missing-perspective'
  /** non-active-owner-first was applied without `context.activeActorId` —
   * the active owner is unknown. */
  | 'missing-active-owner'
  /** hostile-before-beneficial found a candidate whose side cannot be
   * derived (neither `candidate.side` nor a side-bearing classification of
   * the candidate is available). Unknown classification must NOT mean
   * beneficial — unresolved. */
  | 'missing-candidate-side'
  /** non-active-owner-first found a candidate whose ownership relative to
   * the active actor cannot be derived (it is not the active id and carries
   * no `isActiveOwner` flag). Unknown classification must NOT mean
   * not-active — unresolved. */
  | 'missing-candidate-ownership'
  /** controller-choice was passed to `applyOrdering` — the policy YIELDS a
   * choice and must never be resolved by this function. */
  | 'yields-choice'
  /** A candidate id is absent from the declared ordering authority
   * (sourceOrder / turnOrder / explicit-list). The policy cannot order what
   * it does not know; the incoming array order is never used as an
   * accidental tie-break. */
  | 'unknown-candidate';

/** The result of an ordering application. `ok: true` is the ordered
 * candidates; `ok: false` is the unresolved problem — the caller MUST
 * reject (or route a yielded choice through U4), never fall back to the
 * incoming order. */
export type OrderingResult =
  | { ok: true; ordered: OrderingCandidate[] }
  | { ok: false; problem: OrderingProblem; choice?: RuleChoice };

/** Apply one ordering policy to the candidates. Pure — a deterministic
 * function of the policy, the candidates, and the durable context. FAIL
 * CLOSED: a policy whose required context is absent, or whose candidates
 * are not fully covered by its declared ordering authority, returns
 * `ok: false` — it NEVER silently retains the incoming array order.
 * `controller-choice` yields a choice (`policyYieldsChoice`) and is never
 * resolved here: `applyOrdering` returns `ok: false, problem:
 * 'yields-choice'` carrying the choice spec, and the caller routes it
 * through the U4 choice authority. */
export function applyOrdering(
  policy: OrderingPolicy,
  candidates: readonly OrderingCandidate[],
  context: OrderingContext = {},
): OrderingResult {
  switch (policy.kind) {
    case 'source-order': {
      const sourceOrder = context.sourceOrder;
      if (sourceOrder === undefined) return { ok: false, problem: 'missing-source-order' };
      return orderByList(candidates, sourceOrder);
    }
    case 'controller-choice':
      // The policy yields a choice: the recorded player decision orders the
      // candidates, never this function. NEVER resolved here.
      return { ok: false, problem: 'yields-choice', choice: policy.choice };
    case 'stack':
      // Stack/LIFO needs no context: the most-recently-added candidate first
      // (interrupt nesting, p.107).
      return { ok: true, ordered: [...candidates].reverse() };
    case 'turn-order': {
      const turnOrder = context.turnOrder;
      if (turnOrder === undefined) return { ok: false, problem: 'missing-turn-order' };
      return orderByList(candidates, turnOrder);
    }
    case 'hostile-before-beneficial': {
      // Without a perspective actor/side the policy cannot classify hostile
      // vs beneficial — unresolved, never an invented classification.
      const perspectiveSide = context.perspectiveSide
        ?? (context.perspectiveActorId === undefined ? undefined : candidateSideOf(candidates, context.perspectiveActorId));
      if (perspectiveSide === undefined) return { ok: false, problem: 'missing-perspective' };
      // EVERY candidate must derive a side to be classified. An unsided
      // candidate is UNRESOLVED (`missing-candidate-side`) — unknown
      // classification must never silently mean beneficial.
      for (const candidate of candidates) {
        if (candidate.side === undefined) return { ok: false, problem: 'missing-candidate-side' };
      }
      const hostile: OrderingCandidate[] = [];
      const beneficial: OrderingCandidate[] = [];
      for (const candidate of candidates) {
        if (candidate.side !== perspectiveSide) {
          hostile.push(candidate);
        } else {
          beneficial.push(candidate);
        }
      }
      return { ok: true, ordered: [...hostile, ...beneficial] };
    }
    case 'non-active-owner-first': {
      const active = context.activeActorId;
      if (active === undefined) return { ok: false, problem: 'missing-active-owner' };
      // Every candidate needs AFFIRMATIVE ownership knowledge relative to
      // the active actor: the active id itself (own), an explicit
      // `isActiveOwner` flag (own or not-own), or it is UNRESOLVED
      // (`missing-candidate-ownership`) — unknown must never silently mean
      // not-active.
      for (const candidate of candidates) {
        const own = candidate.id === active || candidate.isActiveOwner === true;
        const notOwn = candidate.id !== active && candidate.isActiveOwner === false;
        if (!own && !notOwn) return { ok: false, problem: 'missing-candidate-ownership' };
      }
      const others: OrderingCandidate[] = [];
      const own: OrderingCandidate[] = [];
      for (const candidate of candidates) {
        if (candidate.id === active || candidate.isActiveOwner === true) {
          own.push(candidate);
        } else {
          others.push(candidate);
        }
      }
      return { ok: true, ordered: [...others, ...own] };
    }
    case 'explicit-list':
      return orderByList(candidates, policy.order);
  }
}

/** Order candidates by their position in the declared authority list. A
 * candidate absent from the list is UNRESOLVED (`ok: false,
 * 'unknown-candidate'`) — the policy cannot order what its authority does
 * not name, and the incoming array order is never used as a tie-break. */
function orderByList(candidates: readonly OrderingCandidate[], authority: readonly string[]): OrderingResult {
  const position = new Map(authority.map((id, index) => [id, index]));
  const ordered: OrderingCandidate[] = [];
  for (const candidate of candidates) {
    if (!position.has(candidate.id)) return { ok: false, problem: 'unknown-candidate' };
  }
  return {
    ok: true,
    ordered: [...candidates].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0)),
  };
}

/** The side of a candidate id within the candidate list (the perspective
 * side read for hostile-before-beneficial). */
function candidateSideOf(candidates: readonly OrderingCandidate[], id: string): string | undefined {
  return candidates.find((candidate) => candidate.id === id)?.side;
}
