import { rollBoonOrCurse, type DiceSource } from '../../dice.js';

/**
 * Framework-free attack-roll kernel shared by basic attacks, declarative VM
 * attacks, and named job/foe resolvers.  Damage is intentionally separate:
 * this produces the recorded hit/miss/critical result that feeds a later
 * DamageIntent.
 *
 * ICON pp.92–95, 104: Evasion resolves before the attack roll; Dazed applies
 * a curse; elevation contributes to the attack modifier; a critical is a
 * successful total of 20+.
 *
 * TODO(ICON-rules, pp.87–92, 107): this intentionally receives already
 * legal source/target inputs. Targetability, Blind/Stealth, line of effect,
 * footprint range, and attack-window interrupts belong to TargetQuery and the
 * future durable AttackResolution event ledger, not to this roll primitive.
 */
export interface AttackIntent {
  defense: number;
  sourceBoon?: number;
  elevationModifier?: number;
  sourceDazed?: boolean;
  targetEvasion?: boolean;
  trueStrike?: boolean;
  autoHit?: boolean;
  /** Trait-lowered exceed threshold (Pulverize: 13 at two elevations higher). */
  exceedThreshold?: number;
  /** Trait-granted flat bonus damage applied to the attack's direct damage
   * (Pulverize: +2 against a lower target). Rides the damage provenance so
   * the attack's direct-target damage (and only it) receives the flat. */
  bonusDamageFlat?: number;
}

export interface AttackRoll {
  d20: number | null;
  boon: number;
  total: number | null;
  hit: boolean;
  critical: boolean;
  evasionRoll: number | null;
  trueStrike: boolean;
  autoHit: boolean;
  /** The exceed threshold this attack rolled against (Pulverize lowers it). */
  exceedThreshold: number | null;
  /** Damage-facing consequences of this specific attack.  These are kept
   * separate from hit determination because Dodge and Cover are resolved by
   * the shared damage kernel after an attack chooses its hit/miss branch. */
  ignoreDodge: boolean;
  ignoreCover: boolean;
  /** Kept for diagnostics/event builders; the rolled boon is already final. */
  netBoon: number;
  /** Flat trait bonus damage applied to this attack's direct damage. */
  bonusFlat: number;
}

export interface AttackDamageProvenance {
  ignoreDodge: boolean;
  ignoreCover: boolean;
  /** Flat trait bonus damage (Pulverize +2) that follows the attack into its
   * direct-target damage instance only. */
  bonusFlat: number;
}

/**
 * Rules provenance that must follow an attack into its direct damage branch.
 *
 * ICON p.89 grants a higher attacker cover immunity against a lower target;
 * p.104 gives True Strike an explicit Dodge exception.  Keep these as named
 * facts instead of asking later damage code to reconstruct an earlier roll.
 */
export function attackDamageProvenance(intent: Pick<AttackIntent, 'elevationModifier' | 'trueStrike' | 'bonusDamageFlat'>): AttackDamageProvenance {
  return {
    ignoreDodge: intent.trueStrike ?? false,
    ignoreCover: Math.trunc(intent.elevationModifier ?? 0) > 0,
    bonusFlat: Math.max(0, Math.trunc(intent.bonusDamageFlat ?? 0)),
  };
}

export function resolveAttackRoll(intent: AttackIntent, dice: DiceSource): AttackRoll {
  const trueStrike = intent.trueStrike ?? false;
  const autoHit = intent.autoHit ?? false;
  const damageProvenance = attackDamageProvenance(intent);
  const evasionRoll = !autoHit && !trueStrike && intent.targetEvasion ? dice.die(6) : null;
  const evaded = evasionRoll !== null && evasionRoll >= 4;
  // True Strike ignores Dodge, Blind, Evasion, and Stealth (p.104), but it
  // does not suppress Dazed's separate +1 curse.
  const netBoon = Math.trunc(intent.sourceBoon ?? 0)
    + Math.trunc(intent.elevationModifier ?? 0)
    - (intent.sourceDazed ? 1 : 0);
  const d20 = autoHit || evaded ? null : dice.die(20);
  const boon = autoHit || evaded ? 0 : rollBoonOrCurse(netBoon, dice).modifier;
  const total = d20 === null ? null : d20 + boon;
  const hit = autoHit || (!evaded && (total ?? 0) >= intent.defense);
  const critical = !autoHit && hit && (total ?? 0) >= 20;
  return { d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit, exceedThreshold: intent.exceedThreshold ?? null, ...damageProvenance, netBoon };
}
