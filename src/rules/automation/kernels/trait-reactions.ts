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
import type { UsageIdentity, UsageKeySpec } from '../primitives/usage.js';
import { consumeUsageMutation, ledgerAvailable, usageIdentity, usageKey } from '../primitives/usage.js';
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

/** The TYPED U16 usage spec for a reaction's once-per-round gate — the seam
 * that proves the REAL owner is propagated into the typed authority call
 * even though the ACTOR-LOCAL physical storage key deliberately omits owner
 * bytes. `usageIdentity` built from this spec distinguishes the real owner
 * from a fabricated empty owner (the storage address cannot). The fold
 * constructs the ledger through this spec, so the real owning actor is
 * observable at the typed boundary — never `ownerId: ''`.
 */
export function roundLedgerUsageSpec(ownerId: string, sourceId: string): UsageKeySpec {
  return { sourceId, ownerId, scope: 'round' };
}

/** The durable round-ledger key for a reaction's once-per-round gate — U16
 * CORE (`usageKey` in the `round` period). Byte-identical to the long-standing
 * `ledger:round:<sourceId>` format, so the shared gate, the U16 reset
 * lifecycle recipe, and the checkpoint format stay one authority.
 *
 * The TYPED U16 identity receives the REAL owning actor (`ownerId` via
 * `roundLedgerUsageSpec`) even though the ACTOR-LOCAL storage address
 * deliberately omits owner bytes (the durable state lives on the owner, so
 * two owners of the same source never alias a shared key). The seam must
 * never fabricate an empty owner to the U16 typed call — typed semantic
 * identity and actor-local storage are distinct. */
export function roundLedgerKey(ownerId: string, sourceId: string): string {
  return usageKey(roundLedgerUsageSpec(ownerId, sourceId));
}

/** Whether the actor's round ledger still allows this reaction to fire — U16
 * CORE availability (the recorded usage count is below the one-shot cap). The
 * fold never reconstructs availability from the raw `ruleState` directly. */
export function roundLedgerAvailable(actor: EncounterActor, key: string): boolean {
  return ledgerAvailable(actor, key);
}

/** A private brand that makes a `OncePerRoundGate` structurally unforgeable:
 * only the U16 authority (`oncePerRoundGate`) can stamp it, because the symbol
 * is declared in THIS module and NEVER exported — arbitrary consumers cannot
 * even NAME the property, so a plain/aliased object (even one seeded with a
 * real gate's `key` / `consume` / `identity`) is not assignable to
 * `OncePerRoundGate`. A consumer may inspect and use a real gate result, but
 * cannot manufacture a substitute whose semantic answers (key / available /
 * consume / identity) were derived anywhere else.
 *
 * The brand is a real runtime symbol (`unique symbol = Symbol('…')`) so the
 * gate genuinely carries it, but the gate object is TRANSIENT — only `consume`
 * (a `state` mutation) rides the durable event and enters checkpoint state, and
 * that mutation never includes the brand, so no durable bytes change. */
const oncePerRoundGateBrand: unique symbol = Symbol('oncePerRoundGateBrand');

/**
 * The ONE authoritative U16 plan for a reaction's once-per-round gate (T8d).
 * The U16 authority derives the key, the availability answer, AND the consume
 * mark together in a single object; the F9 fold consumes ONLY this plan. It
 * cannot recompute availability / key / consume independently while still
 * "using" U16 nominally — the answers it acts on come from this object.
 *
 * The type carries a private `readonly [oncePerRoundGateBrand]: true` seam. The
 * brand's symbol is declared but NEVER exported, so the ONLY way to obtain a
 * value assignable to `OncePerRoundGate` is to call `oncePerRoundGate` — the
 * sole producer — which stamps the brand. No object-literal, cast, alias, or
 * locally-computed reconstruction can satisfy the type (each is a compile
 * error), so "if the engine accepts something as a U16 once-per-round gate
 * result, it was actually produced by U16."
 *
 * The typed `identity` carries the REAL owning actor (actor-local storage
 * bytes omit the owner), so a fabricated empty owner is distinguishable at
 * the typed boundary even though the physical key cannot.
 */
export interface OncePerRoundGate {
  /** The typed U16 storage address (actor-local; never reconstructed locally). */
  readonly key: string;
  /** Whether THIS actor's own round ledger still allows the reaction to fire
   * (the fold gates on this — never raw `ruleState`). */
  readonly available: boolean;
  /** The U16 consume mutation to persist when the reaction fires (the fold
   * pushes this VERBATIM — it never hand-builds a state mark). */
  readonly consume: Extract<RuleMutation, { kind: 'state' }>;
  /** The typed de-dup identity carrying the REAL owner. */
  readonly identity: UsageIdentity;
  /** The private U16 brand — stamps this object as `oncePerRoundGate`'s ONLY
   * valid result. Deliberately absent from the exported members of the type.
   * (type-only; no durable bytes). */
  readonly [oncePerRoundGateBrand]: true;
}

/** Resolve the once-per-round gate through the U16 authority (the ONLY
 * producer of a `OncePerRoundGate` — it alone can stamp the private brand).
 * Derived in one place from the REAL owner's typed spec. */
export function oncePerRoundGate(actor: EncounterActor, sourceId: string): OncePerRoundGate {
  const spec = roundLedgerUsageSpec(actor.id, sourceId);
  const key = usageKey(spec);
  return {
    key,
    available: ledgerAvailable(actor, key),
    consume: consumeUsageMutation(sourceId, actor.id, key) as Extract<RuleMutation, { kind: 'state' }>,
    identity: usageIdentity(spec),
    [oncePerRoundGateBrand]: true,
  };
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
    // The once-per-round gate is the U16 plan: key + availability + consume
    // resolved TOGETHER by the U16 authority from the REAL owner's typed spec.
    // The fold acts on the plan only (fail-closed on the plan's availability);
    // it never recomputes availability from raw ruleState or rebuilds the key.
    const gate = reaction.gate === 'once-per-round' ? oncePerRoundGate(actor, traitId) : null;
    if (gate && !gate.available) continue;
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
    if (gate) {
      // Persist the U16 plan's consume mark VERBATIM — resolved ONCE by the U16
      // authority. The fold never re-derives or hand-builds the mark.
      built.push(gate.consume);
    }
    for (const mutation of built) out.push({ ...mutation, sourceId: traitId } as RuleMutation);
  }
  return out;
}
