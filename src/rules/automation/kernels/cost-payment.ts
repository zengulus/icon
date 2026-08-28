/**
 * Cost-payment transaction kernel (docs/rules-foundations.md §10 item 1).
 *
 * One transactional boundary for paying mechanical costs before an effect
 * resolves: the command gates validate the effective costs, reject an
 * unpayable mandatory cost BEFORE any effect or RNG, and the VM runtime pays
 * the same effective costs through the same mutation builders — so the amount
 * validated and the amount paid can never drift, and replay applies exactly
 * what the command boundary decided.
 *
 * Responsibilities (all source-ID-free):
 *
 * 1. **Cost modification** — a closed registry of `CostModifierRule`s that
 *    fold the effective costs for a paying actor at the beginning of the
 *    action (reduce an Infuse/Aether cost, replace one resource payment with
 *    another, alter a fixed sacrifice amount). Content registers the typed
 *    rules; the kernel folds them in registration order. Mirror of the range
 *    kernel's modifier discipline — never a per-content resolver.
 * 2. **Validation** — `assertRuleCostsPayable` rejects insufficient action /
 *    resource / sacrifice-payer before resolution. `resolve` availability
 *    combines the party pool with personal resolve (p.99).
 * 3. **Payment** — `ruleCostMutations` emits the durable `resource` spend and
 *    `sacrifice` HP-cost mutations in source order, exactly the shapes the
 *    reducer applies.
 *
 * The kernel deliberately imports no content and holds no source IDs.
 */
import type { EncounterState, Position } from '../../types.js';
import type { RuleCost, RuleCostKind, RuleMutation, RuleNumber, RuleRuntimeState } from '../primitives/types.js';
import {
  actionSpendMutation,
  assertActionsSufficient,
  assertResourceSufficient,
  assertSacrificePayable,
  resourceSpendMutation,
  sacrificeMutation,
  type CostPaymentViolation,
} from '../primitives/cost-payment.js';

export { CostPaymentViolation } from '../primitives/cost-payment.js';

/**
 * The source-ID-free read surface cost modifiers and the gate consume. Both
 * the raw encounter state and the VM runtime view adapt to this shape, so the
 * command gates and the runtime share one authority.
 */
export interface CostPaymentContext {
  round: number;
  /** The paying actor's id. */
  actorId: string;
  /** The ability/action paying the cost (provenance, never interpreted). */
  sourceId: string;
  /** The source unit's name, for command-surface rejection messages. */
  label: string;
  /** The party resolve pool (raw encounter state). The runtime view
   * pre-combines resolve into the actor's resources and passes 0 here. */
  partyResolve: number;
  actor: {
    resources: Readonly<Record<string, number>>;
    actionsRemaining: number;
    defeated: boolean;
    onBattlefield: boolean;
    position: Position | null;
    /** IDs of abilities equipped on this actor. */
    abilityIds: readonly string[];
    /** IDs of abilities this actor has mastered. */
    masteredAbilityIds: readonly string[];
  };
  /** Every actor (cost modifiers may gate on allies / in-range characters). */
  actors: ReadonlyArray<{
    id: string;
    side: string;
    defeated: boolean;
    onBattlefield: boolean;
    position: Position | null;
    resources: Readonly<Record<string, number>>;
  }>;
  /** Terrain lookup at a position (cost modifiers gate on standing in a
   * terrain area, e.g. an Elden Rune). */
  terrainAt?: (position: Position) => ReadonlySet<string>;
}

/** A content-registered cost modifier: gate + deterministic fold. */
export interface CostModifierRule {
  /** Content-owned provenance (audit only — never parsed). */
  sourceId: string;
  /** Does this rule apply to this payment right now? */
  applies(context: CostPaymentContext): boolean;
  /** Fold the effective costs. Return a new array; never mutate the input. */
  modify(costs: readonly RuleCost[], context: CostPaymentContext): RuleCost[];
}

const costModifierRules: CostModifierRule[] = [];

/** Register a content-owned cost-modifier rule (content/jobs/…). */
export function registerCostModifierRule(rule: CostModifierRule): void {
  costModifierRules.push(rule);
}

/** Fold every registered cost-modifier rule that applies, in registration
 * order. Pure — returns the effective costs without mutating the input. */
export function effectiveRuleCosts(costs: readonly RuleCost[], context: CostPaymentContext): RuleCost[] {
  let effective = [...costs];
  for (const rule of costModifierRules) {
    if (!rule.applies(context)) continue;
    effective = [...rule.modify(effective, context)];
  }
  return effective;
}

/** An evaluated cost: a declared RuleCost with its amount resolved. */
export interface EvaluatedCost {
  kind: RuleCostKind;
  amount: number;
  resourceId?: string;
}

/** Resolve the amounts of a (possibly modified) cost list with the caller's
 * number evaluator (the VM runtime's `integer`). */
export function evaluateCosts(
  costs: readonly RuleCost[],
  evaluate: (amount: RuleNumber) => number,
): EvaluatedCost[] {
  return costs.map((cost) => ({ kind: cost.kind, amount: evaluate(cost.amount), resourceId: cost.resourceId }));
}

/** The cost kinds actually paid at the beginning of the action. `free`,
 * `interrupt`, `round`, and `passive` kinds are not resource/action payments
 * here: free/passive have no cost, interrupt uses are tracked by the
 * interrupt-uses counter, and round costs are lifecycle-managed. */
const PAID_COST_KINDS: ReadonlySet<RuleCostKind> = new Set(['action', 'aether', 'resolve', 'use', 'combo', 'sacrifice']);

/** Adapt the raw encounter state to the shared cost-payment context. Resolve
 * availability combines the party pool (`state.partyResolve`) with the
 * actor's personal resolve — the same combination the runtime view performs
 * when it projects `resources.resolve`. */
export function costContextFromEncounter(
  state: EncounterState,
  actorId: string,
  sourceId: string,
  label: string,
): CostPaymentContext {
  const actor = state.actors[actorId];
  const terrainAt = (position: Position): ReadonlySet<string> => {
    const values = new Set<string>();
    for (const terrain of state.grid.terrain) {
      if (terrain.position.x === position.x && terrain.position.y === position.y) values.add(terrain.type);
    }
    for (const effect of state.terrainEffects) {
      if (effect.positions.some((candidate) => candidate.x === position.x && candidate.y === position.y)) values.add(effect.terrain);
    }
    return values;
  };
  return {
    round: state.round,
    actorId,
    sourceId,
    label,
    partyResolve: state.partyResolve,
    actor: {
      resources: actor?.resources ?? {},
      actionsRemaining: actor?.actionsRemaining ?? 0,
      defeated: actor?.defeated ?? true,
      onBattlefield: actor?.onBattlefield ?? false,
      position: actor?.position ?? null,
      abilityIds: actor?.abilityIds ?? [],
      masteredAbilityIds: actor?.masteredAbilityIds ?? [],
    },
    actors: Object.values(state.actors).map((candidate) => ({
      id: candidate.id,
      side: candidate.side,
      defeated: candidate.defeated,
      onBattlefield: candidate.onBattlefield,
      position: candidate.position ?? null,
      resources: candidate.resources,
    })),
    terrainAt,
  };
}

/** Adapt the VM runtime view (RuleRuntimeState) to the shared cost-payment
 * context. The runtime view already pre-combines resolve into the actor's
 * resources (`resources.resolve` = party pool + personal), so `partyResolve`
 * is 0 here — availability reads the combined value directly. */
export function costContextFromRuntime(
  state: RuleRuntimeState,
  actorId: string,
  sourceId: string,
  label: string,
): CostPaymentContext {
  const view = state.actors[actorId];
  return {
    round: state.round,
    actorId,
    sourceId,
    label,
    partyResolve: 0,
    actor: {
      resources: view?.resources ?? {},
      actionsRemaining: view?.actions ?? 0,
      defeated: view?.defeated ?? true,
      onBattlefield: Boolean(view?.position),
      position: view?.position ?? null,
      abilityIds: view?.abilityIds ?? [],
      masteredAbilityIds: view?.masteredAbilityIds ?? [],
    },
    actors: Object.values(state.actors).map((candidate) => ({
      id: candidate.id,
      side: candidate.side,
      defeated: candidate.defeated,
      onBattlefield: Boolean(candidate.position),
      position: candidate.position ?? null,
      resources: candidate.resources,
    })),
    terrainAt: (position) => state.terrainAt(position),
  };
}

/**
 * The beginning-of-action validation gate: reject a mandatory cost that
 * cannot be paid before any effect resolves or any RNG is consumed. Action
 * costs sum against the payer's remaining actions; resource costs aggregate
 * per resource (several spends of the same resource in one action are paid
 * together); Sacrifice never rejects on amount (floor 1, may overpay) — only
 * on payer availability.
 */
export function assertRuleCostsPayable(context: CostPaymentContext, costs: readonly EvaluatedCost[]): void {
  const payable = costs.filter((cost) => PAID_COST_KINDS.has(cost.kind));
  const actionTotal = payable.reduce((total, cost) => total + (cost.kind === 'action' ? cost.amount : 0), 0);
  if (actionTotal > 0) {
    assertActionsSufficient(context.actor.actionsRemaining, actionTotal, () => `${context.label} costs more actions than are available.`);
  }
  const resourceSpends = new Map<string, number>();
  for (const cost of payable) {
    if (cost.kind === 'action' || cost.kind === 'sacrifice') continue;
    const resourceId = cost.resourceId ?? cost.kind;
    resourceSpends.set(resourceId, (resourceSpends.get(resourceId) ?? 0) + cost.amount);
  }
  for (const [resourceId, amount] of resourceSpends) {
    assertResourceSufficient(
      context.actor,
      context.partyResolve,
      resourceId,
      amount,
      (available) => `${context.label} requires ${amount} ${resourceId}, but only ${available} is available.`,
    );
  }
  if (payable.some((cost) => cost.kind === 'sacrifice')) {
    assertSacrificePayable(context.actor, () => `${context.label} cannot be paid by an unavailable character.`);
  }
}

/**
 * The durable payment mutations for the effective (and validated) costs, in
 * source order. Each mutation is exactly the shape the reducer applies and
 * rides the ability's recorded event, so replay applies what the command
 * decided. Sacrifice emits the shared HP-cost mutation (floor 1, no
 * mitigation, no when-damaged window) rather than a resource spend.
 */
export function ruleCostMutations(context: CostPaymentContext, costs: readonly EvaluatedCost[]): RuleMutation[] {
  const mutations: RuleMutation[] = [];
  for (const cost of costs) {
    if (!PAID_COST_KINDS.has(cost.kind)) continue;
    if (cost.kind === 'action') {
      mutations.push(actionSpendMutation(context.sourceId, context.actorId, cost.amount));
    } else if (cost.kind === 'sacrifice') {
      mutations.push(sacrificeMutation(context.sourceId, context.actorId, cost.amount));
    } else {
      mutations.push(resourceSpendMutation(context.sourceId, context.actorId, cost.resourceId ?? cost.kind, cost.amount));
    }
  }
  return mutations;
}
