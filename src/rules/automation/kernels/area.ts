import type { RuleSourceUnit } from '../../source-units.js';
import { hasMastery } from './mastery.js';
import type { RuleAction, RuleClauseCompilation, RuleProgramCompilation } from '../primitives/types.js';

/**
 * Area modifier kernel (docs/rules-foundations.md §Area).
 *
 * ICON's AoE vocabulary is the p.97 patterns — Line X, Arc X, Blast
 * (small/medium/large templates), Burst X. The shared geometry
 * (`area-geometry.ts`) owns the deterministic pattern math; this kernel owns
 * the MODIFIER seam: a source unit (talent/mastery) can override the shape
 * or size of its parent ability's area under source-defined gates, and the
 * parent resolver derives its EFFECTIVE area at command time — exactly the
 * shape the range kernel gives listed-range changes.
 *
 * Only the shapes with exact source authority are first-class here: `line`
 * and `arc`. Blast templates are visual-only in the PDF and are deliberately
 * NOT approximated by this kernel; a unit whose complete semantics need an
 * exact blast template stays unresolved (`blast-template`).
 *
 * A content module registers a reviewed `AreaModifierRule` per source unit
 * (`content/jobs/area-recipes.ts`). The kernel never branches on a source
 * ID: `sourceId` is provenance for audit/replay, `abilityId` selects the
 * parent ability the rule modifies, and the gates read current encounter
 * state (round, talent choice, mastery, bloodied/stealth) at command time.
 */

/** The minimal actor read the gates need — satisfied by both the reducer
 * actor and the rule runtime actor view (`RuleActorView`), so resolvers pass
 * their own source actor plus the round. */
export interface AreaStateActor {
  hp?: number;
  maximumHp?: number;
  abilityIds?: readonly string[];
  masteredAbilityIds?: readonly string[];
  talents?: Readonly<Record<string, 1 | 2>>;
  conditions?: ReadonlySet<string>;
}

export interface AreaStateView {
  round: number;
  actor: AreaStateActor;
}

export type AreaModifierShape = 'line' | 'arc';

export type AreaModifierGate =
  /** The actor has the stealth condition. */
  | { kind: 'stealth' }
  /** The actor is bloodied (at or under 50% of the wounds-adjusted maximum). */
  | { kind: 'comeback' }
  /** The current round is at least `value` (ICON "at round 4 or later"). */
  | { kind: 'round-at-least'; value: number }
  /** The actor has mastered the named parent ability (equipped AND mastered). */
  | { kind: 'mastery'; abilityId: string }
  /** The actor has the named talent rank equipped for the parent ability. */
  | { kind: 'talent'; talent: 1 | 2 };

/** A registered area-modifier rule: how one content unit changes its parent
 * ability's area shape/size. Deterministic: rules apply in registration
 * order, later shape/length values win. */
export interface AreaModifierRule {
  /** The exact source unit id that owns this rule (talent/mastery id). */
  sourceId: string;
  /** The parent ability whose area this rule modifies. */
  abilityId: string;
  /** Optional action scope (default: all actions of the ability). */
  actionId?: string;
  /** Shape override (e.g. Sturmreiten mastery: line → arc). */
  shape?: AreaModifierShape;
  /** Length/size override (e.g. Soul Shot talent 2: line 3 → line 6). */
  length?: number;
  /** All listed gates must hold for the rule to apply. */
  gates?: AreaModifierGate[];
}

const areaModifierRules: AreaModifierRule[] = [];

/** Register an area-modifier rule (content/jobs/area-recipes.ts). */
export function registerAreaModifierRule(rule: AreaModifierRule): void {
  areaModifierRules.push(rule);
}

function gateHolds(rule: AreaModifierRule, gate: AreaModifierGate, view: AreaStateView): boolean {
  const actor = view.actor;
  switch (gate.kind) {
    case 'stealth':
      return actor.conditions?.has('stealth') ?? false;
    case 'comeback': {
      const maximum = actor.maximumHp ?? 0;
      return maximum > 0 && (actor.hp ?? 0) <= maximum / 2;
    }
    case 'round-at-least':
      return view.round >= gate.value;
    case 'mastery':
      return hasMastery(actor, gate.abilityId);
    case 'talent':
      return actor.talents?.[rule.abilityId] === gate.talent;
    default:
      return false;
  }
}

/** The authoritative area descriptor for an ability after every registered
 * modifier applies. The caller supplies the base descriptor its program
 * would otherwise use, so both the reducer and the runtime resolvers agree on
 * the same effective authority. Evaluated against current state at command
 * time — a gate that stops holding (round passes, bloodied heals, mastery
 * unequipped) reverts the area immediately. The resolver runs the parent
 * ability, so the ability-equip requirement is implicit. */
export function effectiveAreaFor(
  view: AreaStateView,
  actorId: string,
  abilityId: string,
  baseShape: AreaModifierShape,
  baseLength: number,
  actionId?: string,
): { shape: AreaModifierShape; length: number } {
  let shape = baseShape;
  let length = baseLength;
  for (const rule of areaModifierRules) {
    if (rule.abilityId !== abilityId) continue;
    if (rule.actionId !== undefined && rule.actionId !== actionId) continue;
    if (!(rule.gates ?? []).every((gate) => gateHolds(rule, gate, view))) continue;
    if (rule.shape) shape = rule.shape;
    if (rule.length !== undefined) length = rule.length;
  }
  return { shape, length: Math.max(1, Math.floor(length)) };
}

// ── Audit compilation ────────────────────────────────────────────────────────

/** Compile a reviewed area-modifier source unit (a talent or mastery whose
 * COMPLETE semantics are the shape/size change on its parent ability) into
 * the same typed passive vocabulary the other kernel compilers use. The rule
 * is already folded at the parent resolver whenever the actor equips the
 * parent ability and the gates hold, so the program is audit-complete
 * without adding EXECUTE_RULE authority. */
export function compileAreaModifierRecipe(unit: RuleSourceUnit): RuleProgramCompilation | null {
  if (!areaModifierRules.some((rule) => rule.sourceId === unit.id)) return null;
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
