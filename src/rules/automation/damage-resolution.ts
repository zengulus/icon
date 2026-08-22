/**
 * Framework-free damage primitives shared by the encounter adapter and every
 * event-replay path.  This is deliberately state-agnostic: encounter code is
 * responsible for deriving conditions, cover, ownership, and interrupt
 * windows, while this module owns the source-order arithmetic and HP/vigor
 * split.
 *
 * ICON pp.93–104: flat reductions happen before damage is halved, and a
 * damage instance is halved at most once even when multiple effects would
 * halve it.  Keeping that rule here prevents a new command path from quietly
 * reintroducing sequential halvings.
 */

export type ResolvableDamageType = 'normal' | 'piercing' | 'divine';
export type DamageDelivery = 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain';

export type DamagePrevention = 'damage-immune' | 'intangible' | 'dodge';
export type DamageReduction = 'weakened' | 'armor';
export type DamageHalving = 'pacified' | 'hatred' | 'resistance' | 'aetherwall' | 'cover';

export interface DamageIntent {
  /** Damage before source/target modifiers. Always one damage instance. */
  amount: number;
  damageType: ResolvableDamageType;
  delivery: DamageDelivery;
  /** This is a named source property, never client-provided authority. */
  sourceWeakened?: boolean;
  sourcePacified?: boolean;
  sourceHatredDiverts?: boolean;
  targetVulnerable?: boolean;
  targetArmor?: number;
  /** A source-specific exception to Armor. This is deliberately distinct from
   * Divine: it must not silently bypass Resistance, Cover, or Aetherwall. */
  ignoreArmor?: boolean;
  targetResistance?: boolean;
  targetAetherwall?: boolean;
  targetCovered?: boolean;
  targetIntangible?: boolean;
  targetDodge?: boolean;
  /** True Strike is an attack-scoped exception to Dodge (ICON p.104). */
  ignoreDodge?: boolean;
  targetDamageImmune?: boolean;
  /** An effect marked Unerring may opt out of cover once its source recipe
   * has been audited.  It does not currently imply aetherwall immunity. */
  ignoreCover?: boolean;
  /** Intangibility only ignores hostile effects; terrain/self effects do not
   * carry this flag. */
  hostile?: boolean;
}

export interface DeterminedDamage {
  readonly initialAmount: number;
  readonly amount: number;
  readonly prevention: DamagePrevention | null;
  readonly reductions: readonly DamageReduction[];
  /** Several reasons may be true, but application is a single ceil(/2). */
  readonly halvings: readonly DamageHalving[];
}

/**
 * Determine one complete damage instance.  This has no side effects and is
 * therefore safe for command previews and replay-event construction.
 */
export function determineDamage(intent: DamageIntent): DeterminedDamage {
  const initialAmount = Math.max(0, Math.floor(intent.amount));
  if (initialAmount === 0) return { initialAmount, amount: 0, prevention: null, reductions: [], halvings: [] };
  if (intent.targetDamageImmune) return { initialAmount, amount: 0, prevention: 'damage-immune', reductions: [], halvings: [] };
  if (intent.targetIntangible && intent.hostile) return { initialAmount, amount: 0, prevention: 'intangible', reductions: [], halvings: [] };
  if (!intent.ignoreDodge && intent.targetDodge && (intent.delivery === 'miss' || intent.delivery === 'area' || intent.delivery === 'save-success')) {
    return { initialAmount, amount: 0, prevention: 'dodge', reductions: [], halvings: [] };
  }

  let amount = initialAmount;
  const reductions: DamageReduction[] = [];
  if (intent.damageType === 'normal' && intent.sourceWeakened) {
    amount = Math.max(0, amount - 2);
    reductions.push('weakened');
  }
  // Vulnerable increases the incoming instance; it is not a mitigating
  // reduction and keeps its established position before armor.
  if (amount > 0 && intent.targetVulnerable) amount += 1;
  if (intent.damageType === 'normal' && !intent.ignoreArmor && (intent.targetArmor ?? 0) > 0) {
    amount = Math.max(0, amount - Math.max(0, Math.floor(intent.targetArmor ?? 0)));
    reductions.push('armor');
  }

  // Divine cannot be mitigated.  All non-divine halving sources collapse into
  // one final operation after reductions (ICON p.93).
  const halvings: DamageHalving[] = [];
  if (intent.damageType !== 'divine') {
    if (intent.sourcePacified) halvings.push('pacified');
    if (intent.sourceHatredDiverts) halvings.push('hatred');
    if (intent.targetResistance) halvings.push('resistance');
    if (intent.targetAetherwall) halvings.push('aetherwall');
    if (intent.targetCovered && !intent.ignoreCover) halvings.push('cover');
    if (halvings.length > 0) amount = Math.ceil(amount / 2);
  }
  return { initialAmount, amount, prevention: null, reductions, halvings };
}

export interface DamageVitals {
  hp: number;
  vigor: number;
}

export interface DeterminedDamageApplication {
  amount: number;
  bypassVigor: boolean;
  /** Defy Death is an application-time floor, not a mitigation step. */
  minimumHp?: number;
}

export interface AppliedDamage {
  readonly amountAttempted: number;
  readonly amountApplied: number;
  readonly hpDamage: number;
  readonly vigorDamage: number;
  readonly hp: number;
  readonly vigor: number;
  readonly preventedByMinimumHp: number;
}

/**
 * Apply fully determined damage to a pair of vitals.  The caller persists the
 * returned values and then runs defeat/reaction lifecycle policy.  Centralizing
 * this split makes piercing/divine, terrain, attacks, and delayed effects use
 * the same HP/vigor arithmetic.
 */
export function applyDeterminedDamageToVitals(vitals: DamageVitals, application: DeterminedDamageApplication): AppliedDamage {
  const amountAttempted = Math.max(0, Math.floor(application.amount));
  const hpBefore = Math.max(0, vitals.hp);
  const vigorBefore = Math.max(0, vitals.vigor);
  const minimumHp = Math.max(0, Math.floor(application.minimumHp ?? 0));
  const available = application.bypassVigor
    ? Math.max(0, hpBefore - minimumHp)
    : Math.max(0, vigorBefore + hpBefore - minimumHp);
  const amountApplied = Math.min(amountAttempted, available);
  const vigorDamage = application.bypassVigor ? 0 : Math.min(vigorBefore, amountApplied);
  const hpDamage = Math.min(Math.max(0, hpBefore - minimumHp), amountApplied - vigorDamage);
  return {
    amountAttempted,
    amountApplied,
    vigorDamage,
    hpDamage,
    hp: hpBefore - hpDamage,
    vigor: vigorBefore - vigorDamage,
    preventedByMinimumHp: amountAttempted - amountApplied,
  };
}
