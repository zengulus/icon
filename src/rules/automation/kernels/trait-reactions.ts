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
 * reaction already fired within this round?" It therefore routes through the
 * U16 core (`primitives/usage.ts`): `roundLedgerKey` is `usageKey` in the
 * `round` period (byte-identical `ledger:round:<sourceId>`, so the shared
 * gate, the reset lifecycle recipe, and the durable checkpoint format never
 * drift), `roundLedgerAvailable` reads availability through U16's
 * `usageCount`/`ledgerAvailable`, and the consume mark is U16's
 * `consumeUsageMutation` (one-shot set true). A round-start lifecycle recipe
 * clears the key, so the gate resets at the next round boundary.
 *
 * The wired rows themselves live in `content/jobs/trait-reactions.ts` and
 * register through `registerTraitReaction`. This module contains only the
 * closed registry, the fold, and the round-ledger helpers (thin U16
 * adapters), and deliberately no source IDs of its own.
 */
import type { EncounterActor, EncounterState } from '../../types.js';
import type { RuleMutation } from '../primitives/types.js';
import { consumeUsageMutation, ledgerAvailable, usageKey } from '../primitives/usage.js';
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

/** The durable round-ledger key for a reaction's once-per-round gate — U16
 * CORE (`usageKey` in the `round` period). Byte-identical to the long-standing
 * `ledger:round:<sourceId>` format, so the shared gate, the U16 reset
 * lifecycle recipe, and the checkpoint format stay one authority. */
export function roundLedgerKey(sourceId: string): string {
  return usageKey({ sourceId, ownerId: '', scope: 'round' });
}

/** Whether the actor's round ledger still allows this reaction to fire — U16
 * CORE availability (the recorded usage count is below the one-shot cap). The
 * fold never reconstructs availability from the raw `ruleState` directly. */
export function roundLedgerAvailable(actor: EncounterActor, key: string): boolean {
  return ledgerAvailable(actor, key);
}

/**
 * The shared job-trait reaction fold: after an ability's program produced its
 * mutations, append every equipped wired job-trait reaction whose trigger
 * fired, with its source id and (for gated rows) its once-per-round ledger
 * mark. The returned mutations ride the ability's RULE_MUTATIONS_APPLIED
 * event, so replay applies exactly what the command boundary decided. A trait
 * outside the wired table, or one whose trigger did not fire (or whose
 * once-per-round gate is already consumed this round), contributes nothing.
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
    const ledgerKey = reaction.gate === 'once-per-round' ? roundLedgerKey(traitId) : null;
    if (ledgerKey && !roundLedgerAvailable(actor, ledgerKey)) continue;
    // Deciding the trigger from durable sources never re-rolls or re-decides.
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
    const context: TraitReactionContext = { state, mutations, actorId: actor.id };
    const built: TraitReactionMutation[] = reaction.build(actor.id, triggerTargetIds, context);
    if (ledgerKey) {
      // U16 CORE consume: the once-per-round mark is persisted as a typed U16
      // ledger mutation (one-shot set true), never a hand-rolled state write.
      const mark = consumeUsageMutation(traitId, actor.id, ledgerKey) as Extract<RuleMutation, { kind: 'state' }>;
      built.push({ kind: 'state', sourceActorId: mark.sourceActorId, actorId: mark.actorId, key: mark.key, operation: mark.operation, value: mark.value });
    }
    for (const mutation of built) out.push({ ...mutation, sourceId: traitId } as RuleMutation);
  }
  return out;
}
