import type { RuleSourceUnit } from '../../source-units.js';
import type { Position } from '../../types.js';
import { footprintDistance } from '../primitives/spatial-intent.js';
import { hasMastery } from './mastery.js';
import type { RuleAction, RuleClauseCompilation, RuleProgramCompilation } from '../primitives/types.js';

/**
 * Range/distance kernel (docs/rules-foundations.md §Range).
 *
 * ICON range semantics split into two distinct families, and this module is
 * the single reusable authority for both:
 *
 *   1. TARGET LEGALITY — "can this ability legally choose this target?" The
 *      listed range of an ability can be modified (added to, overridden,
 *      conditionally enlarged, made dynamic), and that modification must
 *      affect authoritative target validation, never only UI display.
 *   2. DISTANCE-DEPENDENT EFFECTS — "given a legal use, does the distance
 *      change the result?" Exact-range and distance-gated predicates
 *      (Trigrammaton's "at exactly range 3", Aetherwall's "outside range 2")
 *      inspect distance without ever expanding a targeting range.
 *
 * Distance is always the engine's canonical p.92 footprint metric
 * (`footprintDistance`, L∞ from the edge of the origin space) — there is
 * exactly one distance implementation, shared by targeting, area centers,
 * auras, and these predicates.
 *
 * A content module registers a reviewed `RangeModifierRule` per source unit
 * (`content/jobs/range-recipes.ts`). The kernel never branches on a source
 * ID: `sourceId` is provenance for audit/replay, `abilityId` selects the
 * parent ability the rule modifies, and the gate reads current encounter
 * state (stealth, bloodied/comeback, mastery) at command time.
 */

/** The minimal read surface both the reducer state (`EncounterState`) and the
 * rule runtime view (`RuleRuntimeState`) satisfy: positions/sizes for the
 * canonical distance, the round number for dynamic ranges, and the
 * condition/HP/mastery reads the gates need. */
export interface RangeStateView {
  round: number;
  actors: Readonly<Record<string, {
    id: string;
    position: Position | null;
    size?: number;
    hp?: number;
    maximumHp?: number;
    abilityIds?: readonly string[];
    masteredAbilityIds?: readonly string[];
    /** The equipped talent choice per ability (1 or 2) — a talent-gated rule
     * applies only when the actor selected the rank that owns the rule. */
    talents?: Readonly<Record<string, 1 | 2>>;
  }>>;
  /** The encounter condition set for an actor (the stealth gate). */
  conditionsFor(actorId: string): ReadonlySet<string>;
}

/** The canonical distance between two actors: the shared p.92 footprint
 * metric (L∞ between occupied footprints). Size-1 actors collapse to the
 * point-cell Chebyshev distance. */
export function distanceBetween(view: RangeStateView, fromId: string, toId: string): number {
  const from = view.actors[fromId];
  const to = view.actors[toId];
  if (!from?.position || !to?.position) return Number.POSITIVE_INFINITY;
  return footprintDistance(
    { position: from.position, size: from.size },
    { position: to.position, size: to.size },
  );
}

/** Is `toId` within `range` (inclusive) of `fromId`? */
export function isWithinRange(view: RangeStateView, fromId: string, toId: string, range: number): boolean {
  return distanceBetween(view, fromId, toId) <= range;
}

/** Is `toId` at exactly `range` from `fromId`? Exact-range predicates inspect
 * distance; they never change a targeting range. */
export function isExactlyRange(view: RangeStateView, fromId: string, toId: string, range: number): boolean {
  return distanceBetween(view, fromId, toId) === range;
}

// ── Range modifier registry ──────────────────────────────────────────────────

export type RangeModifierMode = 'add' | 'override';

export type RangeModifierGate =
  /** The actor has the stealth condition (Incubus talent 1: "If you make it
   * from stealth"). */
  | { kind: 'stealth' }
  /** The actor is bloodied (Harvest talent 2: "Comeback: Range 5"). */
  | { kind: 'comeback' }
  /** The actor has mastered the named parent ability (mastery rows). */
  | { kind: 'mastery'; abilityId: string };

/** A registered range-modifier rule: how one content unit modifies its parent
 * ability's listed range. Deterministic: rules apply in registration order,
 * `add` accumulates and the last matching `override` wins. */
export interface RangeModifierRule {
  /** The exact source unit id that owns this rule (talent/mastery id). */
  sourceId: string;
  /** The parent ability whose listed range this rule modifies. */
  abilityId: string;
  mode: RangeModifierMode;
  /** Fixed value, or `'round'` for a dynamic range equal to the round number
   * (Open the Gates talent 2). */
  value: number | 'round';
  /** Optional action scope (default: all actions of the ability). */
  actionId?: string;
  /** Optional talent-equip gate: the rule applies only while the acting
   * actor has this rank selected for the parent ability (a talent source
   * unit never applies to an actor who did not choose it). */
  talent?: 1 | 2;
  /** Optional condition gate evaluated against the acting actor at command
   * time. Without a gate the rule always applies. */
  gate?: RangeModifierGate;
}

const rangeModifierRules: RangeModifierRule[] = [];

/** Register a range-modifier rule (content/jobs/range-recipes.ts). */
export function registerRangeModifierRule(rule: RangeModifierRule): void {
  rangeModifierRules.push(rule);
}

function ruleApplies(rule: RangeModifierRule, view: RangeStateView, actorId: string): boolean {
  const actor = view.actors[actorId];
  if (!actor) return false;
  if (rule.talent !== undefined && actor.talents?.[rule.abilityId] !== rule.talent) return false;
  switch (rule.gate?.kind) {
    case 'stealth':
      return view.conditionsFor(actorId).has('stealth');
    case 'comeback': {
      const maximum = actor.maximumHp ?? 0;
      return maximum > 0 && (actor.hp ?? 0) <= maximum / 2;
    }
    case 'mastery':
      return hasMastery(actor, rule.gate.abilityId);
    default:
      return true;
  }
}

/**
 * The authoritative listed range of an ability after every registered
 * modifier for `abilityId` (scoped to `actionId` when given) applies. The
 * caller supplies the base range it would otherwise use (the source catalog
 * range for USE_ABILITY, the program action's range for EXECUTE_RULE), so
 * both gates agree on the same effective authority. Evaluated against the
 * current encounter state at command time — a conditional gate that stops
 * being true (stealth lost, healed above half) shrinks the range back
 * immediately.
 */
export function effectiveAbilityRange(
  view: RangeStateView,
  actorId: string,
  abilityId: string,
  baseRange: number,
  actionId?: string,
): number {
  let range = baseRange;
  for (const rule of rangeModifierRules) {
    if (rule.abilityId !== abilityId) continue;
    if (rule.actionId !== undefined && rule.actionId !== actionId) continue;
    if (!ruleApplies(rule, view, actorId)) continue;
    range = rule.mode === 'add'
      ? range + (rule.value === 'round' ? view.round : rule.value)
      : rule.value === 'round' ? view.round : rule.value;
  }
  return Math.max(0, Math.floor(range));
}

// ── Audit compilation ────────────────────────────────────────────────────────

/** Compile a reviewed range-modifier source unit (a talent or mastery whose
 * COMPLETE semantics are the listed-range change — never a distance
 * predicate, which belongs to the attack/damage modifiers) into the same
 * typed passive vocabulary the other kernel compilers use. The rule is
 * already folded at both command gates whenever the actor equips the parent
 * ability and the gate holds, so the program is audit-complete without
 * adding EXECUTE_RULE authority. */
export function compileRangeModifierRecipe(unit: RuleSourceUnit): RuleProgramCompilation | null {
  if (!rangeModifierRules.some((rule) => rule.sourceId === unit.id)) return null;
  const clause: RuleClauseCompilation = {
    id: `${unit.id}:clause:1`,
    label: 'passive',
    text: unit.rulesText,
    effects: [],
    complete: true,
    unsupportedText: '',
  };
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing: 'passive',
    costs: [],
    tags: [],
    range: null,
    area: null,
    choices: [],
    steps: [{ id: `${unit.id}:projection`, timing: 'passive', effects: [] }],
  };
  return {
    program: {
      schemaVersion: 1,
      rulesVersion: '1.5',
      id: `program:${unit.id}`,
      sourceId: unit.id,
      source: unit.source,
      name: unit.name,
      actions: [action],
      dependencies: unit.parentId ? [unit.parentId] : [],
      classification: 'encounter',
    },
    clauses: [clause],
    unsupportedClauses: [],
  };
}
