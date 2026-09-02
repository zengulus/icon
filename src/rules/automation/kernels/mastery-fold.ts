import { type MasteryOwnerView } from './mastery.js';
import {
  constantModifierValue,
  effectivePermission,
  enumeratedModifierValue,
  foldEnumeratedModifiers,
  foldNumberModifiers,
  modifierRuleHolds,
  modifierRulesForSource,
  registerModifierRule,
  registerPermissionRule,
  type ModifierFoldView,
  type ModifierGate,
} from '../primitives/modifiers.js';
import { resolveModifierNumber } from './evaluate-modifiers.js';
import type { RuleExecutionContext } from '../primitives/types.js';

/**
 * Mastery modifier-fold kernel (docs/rules-foundations.md K-P5).
 *
 * ICON 1.5 masteries modify their parent ability's execution. Most mastery
 * texts decompose into the same reusable modifier families the engine already
 * answers at execution time (listed-range, area shape, attack modifiers…);
 * this module is the single reusable, source-ID-free seam for the families
 * that had no queryable authority before:
 *
 *   - `interrupt-rank` — an interrupt's rank IS its per-round use count
 *     (p.91); a mastery like MANGONEL ("Catapult becomes Interrupt 3",
 *     p.123) or PERFECT BATTLEMENT ("becomes interrupt 2", p.122) overrides
 *     that authority. The fold is consumed wherever the engine reads an
 *     interrupt's per-round allowance (the USE_ABILITY gate, window
 *     availability scans), so the extra uses are mechanically real.
 *   - `damage-type` — a delivery conversion on the parent ability's damage
 *     instances (EXCALIBUR: "All 1 piercing damage listed by this ability
 *     becomes divine", p.225). Content resolvers ask for the effective type
 *     of the instance they are about to emit; the shared damage pipeline
 *     then applies the converted type's exact semantics (divine bypasses
 *     Defiance and vigor).
 *   - `unlimited-range` — "has no maximum range" (PERFECT BATTLEMENT,
 *     p.122): a bounded range check the caller owns collapses to unbounded
 *     while the rule holds. This is the source's own wording — not a large
 *     numeric approximation.
 *
 * A content module registers one reviewed `MasteryModifierRule` per source
 * clause (`content/jobs/mastery-modifier-recipes.ts`). The kernel never
 * branches on a source ID: `sourceId` is provenance/registry key only and
 * `abilityId` selects the parent ability. Every query requires the parent
 * ability to be equipped AND mastered (`hasMastery`) AND its gate to hold
 * against current state — a mastery must never fire for an unequipped
 * parent, for a different mastered ability, or outside its source
 * conditions. Queries are pure functions of the supplied view, so command
 * planning and replay read the same authority.
 */

/** The source-defined conditions under which a mastery modifier applies — the
 * shared U14 gate union (always / round-at-least are the mastery families). */
export type MasteryFoldGate = import('../primitives/modifiers.js').ModifierGate;

/** The reusable modifier families this kernel owns — each maps to a shared
 * U14 query point: `interrupt-rank` (set), `damage-type` (set with the
 * `from` guard), and the `range-bound` permission (immune). */
export type MasteryModifier =
  /** Override the parent interrupt's rank (= uses per round). Last match wins. */
  | { kind: 'interrupt-rank'; rank: number }
  /** Convert the parent ability's damage instances of type `from` to `to`. */
  | { kind: 'damage-type'; from: string; to: string }
  /** Remove the parent ability's maximum-range bound ("no maximum range"). */
  | { kind: 'unlimited-range' }
  /** Make the parent ability's action Repeatable (p.290 semantics) for the
   * mastered actor: it may be used again within the same turn, ignoring the
   * p.91 No Repeats rule AND (for an interrupting action) the actor-local
   * one-interrupt-per-turn window and the named interrupt's between-turn
   * pool — the mastery grants repeated use, as with e.g. Phantom Bolts
   * ("when the ability triggers again, you may deal… instead of replacing
   * the aura", p.158). This is the REDUCER-consistent typed authority (the
   * event's `repeatable` tag means the reducer records no usage mark). */
  | { kind: 'repeatable' };

/** The minimal actor read the gates need — satisfied by both the encounter
 * actor and the resolver runtime actor view. */
export interface MasteryFoldActorView extends MasteryOwnerView {
  hp?: number;
  /** The BASE maximum — the p.81 bloodied-gate bar (the adapter projects
   * `baseMaxHp`; adjudication icon-1.5:combat:bloodied-base-max). */
  maximumHp?: number;
}

/** The minimal state read the gates need: the round number plus the acting
 * actor's ownership/mastery surface. */
export interface MasteryFoldStateView {
  round: number;
  actors: Readonly<Record<string, MasteryFoldActorView>>;
}

/** The fold read for a rule-program execution: resolvers inside an ability
 * program ask the same authority the command gates do, built from the runtime
 * actor views (which carry `abilityIds`/`masteredAbilityIds`/hp surfaces
 * structurally). */
export function masteryFoldRuleRuntimeView(context: RuleExecutionContext): MasteryFoldStateView {
  return { round: context.state.round, actors: context.state.actors };
}

export interface MasteryModifierRule {
  /** Exact source id of the mastery unit (e.g. `bastion:catapult:mastery`). */
  sourceId: string;
  /** The parent ability whose execution this rule modifies. */
  abilityId: string;
  /** Source conditions (default: unconditional). */
  gate?: MasteryFoldGate;
  modifier: MasteryModifier;
}

/** Register a reviewed mastery-modifier rule (content/jobs). Each family
 * converts to the shared U14 substrate: `interrupt-rank` and `damage-type`
 * become shared ModifierRule rows, `unlimited-range` becomes a `range-bound`
 * permission row (immune). The mastery fold reads the shared registry. */
export function registerMasteryModifierRule(rule: MasteryModifierRule): void {
  // Every mastery row REQUIRES the parent ability equipped AND mastered
  // (`hasMastery`) — that ownership requirement is part of the mastery
  // semantics independent of the source gate, so it is baked into the shared
  // row's gates as the `mastery` gate (the shared evaluator's mastery gate IS
  // `hasMastery`). A `{ kind: 'always' }` source gate then means "no extra
  // round condition", never "applies without mastering".
  const gates: ModifierGate[] = [{ kind: 'mastery', abilityId: rule.abilityId }];
  if (rule.gate && rule.gate.kind !== 'always') gates.push(rule.gate);
  switch (rule.modifier.kind) {
    case 'interrupt-rank':
      registerModifierRule({
        sourceId: rule.sourceId,
        ownerId: rule.abilityId,
        queryPoint: 'interrupt-rank',
        scope: 'default',
        operation: 'set',
        value: constantModifierValue(rule.modifier.rank),
        ...(gates.length > 0 ? { gates } : {}),
      });
      break;
    case 'damage-type':
      registerModifierRule({
        sourceId: rule.sourceId,
        ownerId: rule.abilityId,
        queryPoint: 'damage-type',
        scope: 'default',
        operation: 'set',
        value: enumeratedModifierValue(rule.modifier.to),
        from: rule.modifier.from,
        ...(gates.length > 0 ? { gates } : {}),
      });
      break;
    case 'unlimited-range':
      registerPermissionRule({
        sourceId: rule.sourceId,
        ownerId: rule.abilityId,
        queryPoint: 'range-bound',
        kind: 'immune',
        ...(gates.length > 0 ? { gates } : {}),
      });
      break;
    case 'repeatable':
      registerPermissionRule({
        sourceId: rule.sourceId,
        ownerId: rule.abilityId,
        queryPoint: 'repeatable',
        kind: 'immune',
        ...(gates.length > 0 ? { gates } : {}),
      });
      break;
  }
}

/** Project a MasteryFoldStateView + actor onto the shared U14 fold view. */
function masteryFoldView(view: MasteryFoldStateView, actorId: string): ModifierFoldView {
  const actor = view.actors[actorId];
  return {
    round: view.round,
    actor: {
      id: actorId,
      hp: actor?.hp,
      maximumHp: actor?.maximumHp,
      abilityIds: actor?.abilityIds,
      masteredAbilityIds: actor?.masteredAbilityIds,
    },
    conditionsFor: () => new Set<string>(),
  };
}

/**
 * True when every registered rule of the named mastery source unit is
 * satisfied for this actor right now (parent equipped AND mastered AND all
 * source gates holding). Program-level folds that alter a value inside a
 * parent resolver (PERFECT BATTLEMENT's "deals 4 damage instead of 2") ask
 * this instead of re-stating the gate locally, so the source conditions
 * live in exactly one place — the registered rows. Reads the shared
 * registry through the shared gate evaluator.
 */
export function masteryModifierActive(
  view: MasteryFoldStateView,
  actorId: string,
  sourceId: string,
): boolean {
  const rules = modifierRulesForSource(sourceId);
  if (rules.length === 0) return false;
  const foldView = masteryFoldView(view, actorId);
  return rules.every((rule) => modifierRuleHolds(rule, foldView, rule.ownerId, {}));
}

/**
 * The authoritative per-round interrupt allowance for `abilityId`: the base
 * rank the caller would otherwise use (the source catalog cost value), after
 * every registered `interrupt-rank` mastery rule whose parent is mastered
 * and whose gate holds. Deterministic in registration order; the last match
 * wins, exactly like the range/area kernels' override semantics. Folds
 * through the shared U14 `foldNumberModifiers`.
 */
export function effectiveInterruptRank(
  view: MasteryFoldStateView,
  actorId: string,
  abilityId: string,
  baseRank: number,
): number {
  const rank = foldNumberModifiers('interrupt-rank', 'default', baseRank, abilityId, masteryFoldView(view, actorId), {}, resolveModifierNumber);
  return Math.max(1, Math.floor(rank));
}

/**
 * The authoritative delivery type for a damage instance the parent ability's
 * resolver is about to emit: every registered `damage-type` conversion whose
 * parent is mastered and whose gate hold applies in registration order, so
 * chained conversions compose deterministically. An unmatched base type
 * passes through unchanged — the fold never invents a conversion. Folds
 * through the shared U14 `foldEnumeratedModifiers` with the `from` guard.
 *
 * Generic over the caller's damage-type literal so an unconverted base type
 * keeps its exact type at the call site.
 */
export function convertedDamageType<T extends string>(
  view: MasteryFoldStateView,
  actorId: string,
  abilityId: string,
  baseType: T,
): T {
  const type = foldEnumeratedModifiers('damage-type', 'default', baseType, abilityId, masteryFoldView(view, actorId));
  return type as T;
}

/**
 * True when the parent ability's maximum-range bound is removed for this
 * actor ("no maximum range") — the caller keeps owning what its bound
 * applies to; the fold only answers whether it collapses. Reads the shared
 * `range-bound` permission registry (immune).
 */
export function hasUnlimitedRange(
  view: MasteryFoldStateView,
  actorId: string,
  abilityId: string,
): boolean {
  return effectivePermission('range-bound', abilityId, masteryFoldView(view, actorId)) !== null;
}

/**
 * True when a registered `repeatable` mastery modifier rule grants the named
 * parent ability repeated in-turn use to this actor (the p.290 Repeatable
 * semantic the mastered actor is entitled to). Reads the shared `repeatable`
 * permission registry (immune) gated on the parent being equipped AND
 * mastered AND the source conditions. The REDUCER consumes the same
 * determination (the command stamps `repeatable` on the recorded event, and
 * the reducer records no usage mark), so authorization and persistence can
 * never disagree.
 */
export function masteryActionRepeatable(
  view: MasteryFoldStateView,
  actorId: string,
  abilityId: string,
): boolean {
  return effectivePermission('repeatable', abilityId, masteryFoldView(view, actorId)) !== null;
}
