/**
 * Bonus-damage grant kernel (F6a, docs/rules-foundations.md §8).
 *
 * ICON p.102: "Bonus damage means roll one more die than normal, then pick
 * the highest." The engine's bonus-dice ROLL authority is the shared
 * `damage-roll` evaluation (the declarative VM) and `rollDamageDice` (named
 * resolvers). This module is the single reusable, source-ID-free seam that
 * decides HOW MANY bonus dice a single ability use carries, from
 * source-declared gates — it never rolls anything itself.
 *
 * A content module registers one `BonusDamageRule` per source clause
 * (content/jobs/bonus-damage-recipes.ts). The fold is evaluated at the
 * USE_ABILITY command boundary and its dice ride `abilityUseModifiers`, so
 * the ability's recorded damage mutations carry exactly what the command
 * decided (F0 durable record): replay applies the recorded roll and never
 * re-decides a gate.
 *
 * Rules key on the parent ability id and (for talent rows) the equipped
 * talent choice, and evaluate their gate against current encounter state at
 * use time — self bloodied (comeback), the attack target's bloodied/status
 * state, or a deterministic function of the fold view for scaled rows (e.g.
 * "one bonus die for every ally of your target adjacent to your target").
 * This module contains no source IDs: `sourceId` is provenance only.
 */
import type { EncounterActor, EncounterState } from '../../types.js';

/** ICON p.102: bloodied at or below half of the wounds-adjusted maximum
 * (same formula as the talent fold's inlined isBloodied — kept here to keep
 * the module graph acyclic). */
function isBloodied(actor: EncounterActor): boolean {
  return actor.hp <= Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality) / 2;
}

/** The source-defined conditions under which a bonus-damage rule applies. */
export type BonusDamageGate =
  /** Unconditional (the row's own scaled dice decide the magnitude). */
  | { kind: 'always' }
  /** The acting character is bloodied ("Comeback", ICON p.102). */
  | { kind: 'self-bloodied' }
  /** The ability's attack target is a bloodied foe (ICON p.102). */
  | { kind: 'target-bloodied' }
  /** The ability's attack target is suffering from a status ("if your foe is
   * suffering from a status"). Without `conditionId`, ANY status qualifies;
   * with one, only that exact condition. */
  | { kind: 'target-has-condition'; conditionId?: string };

/** The deterministic fold view handed to scaled `dice` rows. */
export interface BonusDamageFoldView {
  state: EncounterState;
  actorId: string;
  abilityId: string;
  targetIds: readonly string[];
}

export interface BonusDamageRule {
  /** Exact source id of the granting unit (talent / trait / mastery). */
  sourceId: string;
  /** The parent ability whose damage roll carries the bonus dice. */
  abilityId: string;
  /** For talent rows, the equipped talent choice (1 or 2) that arms the
   * bonus; the fold only fires when the actor chose this talent. */
  talent?: 1 | 2;
  /** Source conditions (default: unconditional). */
  gate?: BonusDamageGate;
  /** Bonus dice for the use. A number, or a deterministic function of the
   * fold view for scaled rows (an ally/foe count read from current state). */
  dice: number | ((view: BonusDamageFoldView) => number);
}

const bonusDamageRules: BonusDamageRule[] = [];

/** Register a bonus-damage grant rule (content/jobs/bonus-damage-recipes.ts). */
export function registerBonusDamageRule(rule: BonusDamageRule): void {
  bonusDamageRules.push(rule);
}

function targetActor(state: EncounterState, targetIds: readonly string[]): EncounterActor | undefined {
  const targetId = targetIds[0];
  return targetId ? state.actors[targetId] : undefined;
}

function gateHolds(gate: BonusDamageGate | undefined, state: EncounterState, actorId: string, targetIds: readonly string[]): boolean {
  if (!gate || gate.kind === 'always') return true;
  const actor = state.actors[actorId];
  if (!actor) return false;
  switch (gate.kind) {
    case 'self-bloodied': return isBloodied(actor);
    case 'target-bloodied': {
      const target = targetActor(state, targetIds);
      return Boolean(target && target.side !== actor.side && isBloodied(target));
    }
    case 'target-has-condition': {
      const target = targetActor(state, targetIds);
      if (!target || target.side === actor.side) return false;
      return gate.conditionId === undefined
        ? target.conditions.length > 0
        : target.conditions.some((condition) => condition.id === gate.conditionId);
    }
  }
}

/**
 * The total bonus dice a single use of `abilityId` carries for `actor`, per
 * every registered rule whose parent, talent choice, and gate hold. Evaluated
 * once at the USE_ABILITY command boundary; the result rides
 * `abilityUseModifiers` so the rolled damage mutations record it durably.
 */
export function bonusDamageDiceForUse(
  state: EncounterState,
  actor: EncounterActor,
  abilityId: string,
  targetIds: readonly string[],
): number {
  let total = 0;
  for (const rule of bonusDamageRules) {
    if (rule.abilityId !== abilityId) continue;
    if (rule.talent !== undefined && actor.talents?.[abilityId] !== rule.talent) continue;
    if (!gateHolds(rule.gate, state, actor.id, targetIds)) continue;
    const dice = typeof rule.dice === 'function' ? rule.dice({ state, actorId: actor.id, abilityId, targetIds }) : rule.dice;
    total += Math.max(0, Math.floor(dice));
  }
  return total;
}
