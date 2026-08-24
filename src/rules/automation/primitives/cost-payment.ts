/**
 * Cost-payment transaction primitives (docs/rules-foundations.md §10 item 1).
 *
 * One source-ID-free answer to "what must be validated and paid at the
 * beginning of an ability/action before its effects resolve, and how is that
 * payment represented durably for replay?" This module owns the vocabulary:
 *
 * - availability: how much of a resource a payer can actually spend
 *   (`resolve` combines the party pool with personal resolve, ICON p.99);
 * - validation: typed `CostPaymentViolation`s for insufficient resources,
 *   insufficient actions, and an unavailable payer;
 * - payment mutations: the durable `resource` spend and `sacrifice` HP-cost
 *   mutations that ride the ability's recorded event, so replay applies
 *   exactly what the command boundary decided.
 *
 * ICON Combat Glossary *Sacrifice X*: reduce HP by X as a cost, paid at the
 * beginning of the action; cannot be reduced, ignored, transferred, or
 * resisted; cannot reduce the payer below 1 HP; may still be paid when the
 * payer has less HP than the nominal amount. It is represented as a durable
 * `damage` mutation with the `sacrifice` damage type: the shared application
 * path bypasses vigor and every mitigation step, floors HP at 1, and — by
 * returning before the damage-window logic — never opens ordinary
 * when-damaged / defeated windows merely because HP changed (ICON p.107
 * "when you are damaged by a foe's ability" triggers do not fire for a cost
 * the character pays itself).
 *
 * This module contains no source IDs. Content supplies provenance strings
 * verbatim; kernels and primitives never interpret them.
 */
import type { RuleMutation } from './types.js';

export type CostPaymentViolationCode = 'insufficient-resource' | 'action-insufficient' | 'payer-unavailable';

/** A structured rejection for a cost that cannot be paid at the beginning of
 * the action. Converted to the encounter's `RuleViolation` at the command
 * boundary so an unpayable mandatory cost rejects BEFORE any effect resolves
 * or any RNG is consumed. */
export class CostPaymentViolation extends Error {
  readonly code: CostPaymentViolationCode;
  constructor(code: CostPaymentViolationCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CostPaymentViolation';
  }
}

/** The minimal durable reads a payment needs from its payer. */
export interface ResourcePayer {
  resources: Readonly<Record<string, number>>;
}

/**
 * The total amount of a resource the payer can actually spend. `resolve` is
 * the one shared resource that is not purely per-actor: the party pool
 * (`partyResolve`) is spent first, then personal resolve (ICON p.99 — resolve
 * is "spent at the beginning of the action", personal resolve backs the party
 * pool). Every other resource is read from the payer's own pool.
 */
export function availableResource(
  payer: ResourcePayer,
  partyResolve: number,
  resourceId: string,
): number {
  return resourceId === 'resolve'
    ? partyResolve + (payer.resources['personal-resolve'] ?? 0)
    : payer.resources[resourceId] ?? 0;
}

/** Reject when the payer cannot cover `amount` of `resourceId`. `describe`
 * builds the caller's message from the actual available amount, so each
 * command surface keeps its established wording while sharing one authority. */
export function assertResourceSufficient(
  payer: ResourcePayer,
  partyResolve: number,
  resourceId: string,
  amount: number,
  describe: (available: number) => string,
): void {
  const available = availableResource(payer, partyResolve, resourceId);
  if (available < amount) throw new CostPaymentViolation('insufficient-resource', describe(available));
}

/** Reject when the payer has fewer actions remaining than a declared action
 * cost. */
export function assertActionsSufficient(
  actionsRemaining: number,
  amount: number,
  describe: () => string,
): void {
  if (actionsRemaining < amount) throw new CostPaymentViolation('action-insufficient', describe());
}

/** The payer of a sacrifice cost must exist and be able to act. The AMOUNT is
 * never insufficient: Sacrifice may be paid even when the payer has less HP
 * than the nominal amount, and it can never reduce the payer below 1 HP. */
export function assertSacrificePayable(
  payer: { defeated: boolean; onBattlefield: boolean } | undefined,
  describe: () => string,
): void {
  if (!payer || payer.defeated || !payer.onBattlefield) {
    throw new CostPaymentViolation('payer-unavailable', describe());
  }
}

/** The durable resource-spend mutation every payment authority emits (F10
 * ability-use choices, the VM runtime costs, the command gates). Replay
 * applies exactly this record. */
export function resourceSpendMutation(
  sourceId: string,
  actorId: string,
  resourceId: string,
  amount: number,
): RuleMutation {
  return {
    kind: 'resource',
    sourceId,
    actorId,
    resourceId,
    operation: 'spend',
    amount,
    minimum: 0,
    maximum: null,
  };
}

/** The durable action-spend mutation for a declared action cost. */
export function actionSpendMutation(sourceId: string, actorId: string, amount: number): RuleMutation {
  return { kind: 'actions', sourceId, actorId, operation: 'spend', amount };
}

/**
 * The durable Sacrifice payment: a `damage` mutation whose `sacrifice` type
 * the shared application path resolves as an unmitigable HP cost (bypasses
 * vigor, floors at 1 HP, opens no when-damaged/defeated window). `payerId`
 * is whoever pays the HP cost (the ability user for ordinary sacrifices;
 * the source can name a different payer where the rule says so). The amount
 * is never clamped here — the floor-1 rule belongs to application, and
 * replay must record the nominal amount verbatim.
 */
export function sacrificeMutation(sourceId: string, payerId: string, amount: number): RuleMutation {
  return {
    kind: 'damage',
    sourceId,
    sourceActorId: payerId,
    actorId: payerId,
    amount,
    damageType: 'sacrifice',
    instance: 1,
    delivery: 'effect',
    ignoreCover: true,
  };
}
