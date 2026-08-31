/**
 * Reactive job-trait fold kernel — the once-per-round reactive seam of the
 * resource-economy / use-ledger foundation (docs/rules-foundations.md §10 item
 * 1, non-glossary foundation #8 "once-per-round/combat use ledgers").
 *
 * A wired job trait may declare a *reaction*: a post-application trigger
 * (`collide` — one of the ability's shoves collided; `shove` — the ability
 * shoved at least one foe; `slay` — the ability reduced a character to 0 HP,
 * the same shared reactive dry runs the F7 talent fold uses) gated by an
 * optional `once-per-round` round ledger, and a deterministic `build` that
 * emits typed mutations for the firing actor.
 *
 * The fold decision is made once at the command boundary and the resulting
 * mutations ride the ability's RULE_MUTATIONS_APPLIED event (F0 durable-record
 * principle), exactly like the talent fold — replay applies exactly what the
 * command decided and never re-rolls or re-decides.
 *
 * The once-per-round gate is a U16 USAGE / ENTITLEMENT question: "has this
 * reaction already fired within this round?" The ENTIRE entitlement
 * transaction therefore lives behind the U16 operation
 * `applyOncePerRoundUsage` (`kernels/use-ledger.ts`): it owns the typed owner
 * identity, the round usage scope, the physical key derivation (byte-identical
 * `ledger:round:<sourceId>`, so the shared gate, the reset lifecycle recipe,
 * and the durable checkpoint format never drift), the availability check, the
 * consume mark, and the grouping of that consume with the allowed reaction
 * effects into one commit bundle. F9 owns ONLY the trigger decision and the
 * reaction's ordinary effect mutations (which it PROPOSES): it can propose
 * effects, but only U16 can turn them into an allowed once-per-round
 * transaction. A round-start lifecycle recipe clears the round ledger, so the
 * gate resets at the next round boundary.
 *
 * The wired rows themselves live in `content/jobs/trait-reactions.ts` and
 * register through `registerTraitReaction`. This module contains only the
 * closed registry and the fold, and deliberately no source IDs of its own. It
 * exposes no once-per-round gate internals (no key, availability, consume, or
 * usage identity) — those live behind the U16 operation and are invisible to
 * F9.
 */
import type { EncounterActor, EncounterState } from '../../types.js';
import type { RuleMutation } from '../primitives/types.js';
import { applyOncePerRoundUsage } from './use-ledger.js';
import { affectedFoeIds } from './talent-recipes.js';

/** The resolved mutation kinds a wired reaction may emit (each without its
 * sourceId — the kernel fills the reaction's source id at fold time). */
export type TraitReactionMutation =
  | Omit<Extract<RuleMutation, { kind: 'damage' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'resource' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'state' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'move' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'condition' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'vigor' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'terrain' }>, 'sourceId'>;

/** The fold context handed to a reaction row's `build`: the encounter state
 * and the ability's own produced mutations (for side-relative predicates and
 * area computation), plus the acting actor's id. */
export interface TraitReactionContext {
  state: EncounterState;
  mutations: readonly RuleMutation[];
  actorId: string;
}

/** A job trait's declared reactive trigger-effect. */
export interface TraitReaction {
  /** `collide` — one of the ability's shoves collided an obstruction;
   * `shove` — the ability shoved at least one foe; `slay` — the ability
   * reduced a character to 0 HP. All are post-application triggers decided by
   * the shared reactive dry runs on the ability's recorded mutations, never
   * re-decided at replay. */
  trigger: 'collide' | 'shove' | 'slay';
  /** `once-per-round` — the reaction fires at most once per round, gated by a
   * durable round ledger (reset at the round-start boundary). */
  gate?: 'once-per-round';
  /** Deterministic effect mutations: the firing actor, the trigger's own
   * targets (the collided / defeated actors, or the shoved foes), and the
   * fold context. */
  build(actorId: string, triggerTargetIds: readonly string[], context: TraitReactionContext): TraitReactionMutation[];
}

/** A registered wired reaction row: the reaction plus its mechanic text. */
export interface WiredTraitReactionRow {
  mechanic: string;
  reaction: TraitReaction;
}

const traitReactionRecipes: Record<string, WiredTraitReactionRow> = {};

/** Register a wired job-trait reaction row (content/jobs/trait-reactions.ts). */
export function registerTraitReaction(sourceId: string, row: WiredTraitReactionRow): void {
  traitReactionRecipes[sourceId] = row;
}

/** The reactive triggers the caller must precompute target ids for when this
 * actor acts. `collide` / `slay` need the shared post-application dry runs
 * (state clones); `shove` is derived from the ability's own mutations directly
 * in the fold, so it needs no precomputation. */
export function traitReactionNeededTriggers(actor: EncounterActor): Set<'collide' | 'slay'> {
  const needed = new Set<'collide' | 'slay'>();
  for (const traitId of actor.traitIds ?? []) {
    const trigger = traitReactionRecipes[traitId]?.reaction.trigger;
    if (trigger === 'collide') needed.add('collide');
    if (trigger === 'slay') needed.add('slay');
  }
  return needed;
}

/**
 * The shared job-trait reaction fold: after an ability's program produced its
 * mutations, append every equipped wired job-trait reaction whose trigger
 * fired, with its source id and (for gated rows) its once-per-round spend mark.
 * The returned mutations ride the ability's RULE_MUTATIONS_APPLIED event, so
 * replay applies exactly what the command boundary decided. A trait outside
 * the wired table, or one whose trigger did not fire (or whose once-per-round
 * entitlement is already consumed this round), contributes nothing.
 *
 * OWNERSHIP SPLIT (the once-per-round reactive seam):
 *   F9  owns  whether the reaction's trigger occurred and the reaction's
 *             ordinary effect mutations (which it PROPOSES, stamped with the
 *             trait's provenance).
 *   U16 owns  whether the usage remains available, what key represents the
 *             entitlement, how consumption is recorded, and the grouping of
 *             that consume with the allowed effects — all inside the single
 *             `applyOncePerRoundUsage` operation, whose returned bundle the
 *             fold commits VERBATIM. F9 can propose effects, but only U16 can
 *             turn them into an allowed once-per-round transaction.
 */
export function traitReactionMutations(
  state: EncounterState,
  actor: EncounterActor,
  mutations: readonly RuleMutation[],
  reactive: { collidedActorIds?: readonly string[]; slainActorIds?: readonly string[] } = {},
): RuleMutation[] {
  const out: RuleMutation[] = [];
  for (const traitId of actor.traitIds ?? []) {
    const recipe = traitReactionRecipes[traitId];
    const reaction = recipe?.reaction;
    if (!reaction) continue;
    // F9 owns the TRIGGER decision: whether this reaction's trigger fired (and
    // against which targets). Decided from durable sources — never re-rolled
    // or re-decided at replay.
    let triggerTargetIds: string[] = [];
    if (reaction.trigger === 'collide') {
      if (!(reactive.collidedActorIds?.length ?? 0)) continue;
      triggerTargetIds = [...reactive.collidedActorIds!];
    } else if (reaction.trigger === 'shove') {
      triggerTargetIds = affectedFoeIds(mutations, state, actor.id, ['shove']);
      if (triggerTargetIds.length === 0) continue;
    } else if (reaction.trigger === 'slay') {
      if (!(reactive.slainActorIds?.length ?? 0)) continue;
      triggerTargetIds = [...reactive.slainActorIds!];
    }
    // F9 owns the reaction's ordinary EFFECT mutations, proposed with the
    // trait's provenance stamped.
    const context: TraitReactionContext = { state, mutations, actorId: actor.id };
    const proposed: RuleMutation[] = reaction.build(actor.id, triggerTargetIds, context).map(
      (m) => ({ ...m, sourceId: traitId } as RuleMutation),
    );
    if (reaction.gate === 'once-per-round') {
      // U16 owns the ENTIRE once-per-round entitlement transaction in ONE
      // operation: typed owner identity, usage scope, key derivation,
      // availability, the consume mark, and its grouping with the allowed
      // effects. F9 PROPOSES the effects; only U16 can turn them into an
      // allowed once-per-round commit. The fold commits the returned bundle
      // VERBATIM (fail-closed: emit nothing when unavailable) and never
      // re-derives availability / key / consume itself.
      const result = applyOncePerRoundUsage({ actor, sourceId: traitId, mutations: proposed });
      if (!result.available) continue;
      out.push(...result.mutations);
    } else {
      out.push(...proposed);
    }
  }
  return out;
}
