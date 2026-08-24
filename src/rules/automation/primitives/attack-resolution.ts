import { rollBoonOrCurse, type DiceSource } from '../../dice.js';
import type { RuleExecutionContext } from './types.js';

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
  /** Unerring (p.105): the attack ignores cover and aetherwall. Distinct from
   * True Strike, which ignores Dodge — unerring does not. */
  unerring?: boolean;
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
  /** Unerring (p.105) ignores the Aetherwall halving. */
  ignoreAetherwall: boolean;
  /** Kept for diagnostics/event builders; the rolled boon is already final. */
  netBoon: number;
  /** Flat trait bonus damage applied to this attack's direct damage. */
  bonusFlat: number;
}

export interface AttackDamageProvenance {
  ignoreDodge: boolean;
  ignoreCover: boolean;
  /** Unerring (p.105) ignores the Aetherwall halving in addition to cover. */
  ignoreAetherwall: boolean;
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
export function attackDamageProvenance(intent: Pick<AttackIntent, 'elevationModifier' | 'trueStrike' | 'bonusDamageFlat' | 'unerring'>): AttackDamageProvenance {
  return {
    ignoreDodge: intent.trueStrike ?? false,
    ignoreCover: Math.trunc(intent.elevationModifier ?? 0) > 0 || Boolean(intent.unerring),
    ignoreAetherwall: Boolean(intent.unerring),
    bonusFlat: Math.max(0, Math.trunc(intent.bonusDamageFlat ?? 0)),
  };
}

/**
 * Resolver-driven attacks record their roll's durable rules facts through
 * this WeakMap (keyed on the execution context object, which is per-command),
 * so the shared damage builder can consume the immediately preceding attack's
 * provenance without mutating command input or leaking it into VM branches.
 * It is restricted to the matching target and hit/miss delivery. Replay never
 * consults it — the recorded mutations already carry the resolved facts.
 */
const resolvedAttackDamage = new WeakMap<RuleExecutionContext, Map<string, AttackDamageProvenance>>();

/** Record the provenance of a resolved attack for the matching target. */
export function rememberAttackDamage(context: RuleExecutionContext, targetId: string, provenance: AttackDamageProvenance): void {
  const byTarget = resolvedAttackDamage.get(context) ?? new Map<string, AttackDamageProvenance>();
  byTarget.set(targetId, provenance);
  resolvedAttackDamage.set(context, byTarget);
}

/** The provenance a direct hit/miss damage mutation should inherit for this
 * target, or undefined for non-direct deliveries (collateral area damage,
 * later delayed damage, unrelated effects). Falls back to the universal p.89
 * high-ground cover exception for auto-hit resolvers that emit a direct
 * attack mutation without calling the shared attack authority; auto-hits
 * never need a miss-Dodge exception. */
export function directAttackDamageProvenance(
  context: RuleExecutionContext,
  targetId: string,
  delivery: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain',
): AttackDamageProvenance | undefined {
  if (delivery !== 'hit' && delivery !== 'miss') return undefined;
  const remembered = resolvedAttackDamage.get(context)?.get(targetId);
  if (remembered) return remembered;
  const source = context.state.actors[context.actorId];
  const target = context.state.actors[targetId];
  if (!source?.position || !target?.position) return undefined;
  return attackDamageProvenance({
    elevationModifier: context.state.elevationAt(source.position) - context.state.elevationAt(target.position),
  });
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
