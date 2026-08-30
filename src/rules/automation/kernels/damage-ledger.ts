import type { EncounterState } from '../../types.js';
import { applyDeterminedEncounterDamage, determineAndApplyEncounterDamage, type EncounterDamageIntent } from './encounter-adapter.js';
import type { AppliedDamage, DamageDelivery } from '../primitives/damage-resolution.js';
import { openDamageWindowFromLedger } from './decision-window.js';

/**
 * The durable damage ledger (ICON pp.93–107).
 *
 * One `DamageLedgerEntry` records one damage instance's full provenance so
 * replay consumes the record instead of re-inferring an outcome from a
 * reduced number: intent identity (source, target, delivery, exceptions),
 * the handoff side it serializes, the application result, and the
 * interrupt-window state.
 *
 * The foundation rule from `docs/rules-foundations.md` §1: every serialized
 * damage instance must declare **which side of the handoff it is**. A
 * `handoff: 'source'` entry is a source amount and replays through
 * `determineAndApplyEncounterDamage` (p.93 mitigation is re-derived, which is
 * safe because determination is pure and deterministic). A
 * `handoff: 'determined'` entry is a persisted final amount and replays
 * through `applyDeterminedEncounterDamage` (re-mitigating it would apply the
 * reductions twice). Never introduce another numeric damage field without
 * this designation and a source/replay pair covering armor, Resistance,
 * Defiance, and vigor.
 */
export type DamageHandoff = 'source' | 'determined';

/** Interrupt-window provenance for one damage instance (ICON p.107). */
export interface DamageWindowLedger {
  trigger: 'when-damaged' | 'defeated';
  /** true when the instance was held pending an interrupt answer. */
  held: boolean;
  /** How a held instance ultimately resolved. */
  resolution: 'applied' | 'prevented' | 're-dealt' | null;
}

/** The durable, replay-safe record of one damage instance. */
export interface DamageLedgerEntry {
  /** Which side of the handoff this entry serializes. */
  handoff: DamageHandoff;

  // --- Intent provenance (both handoffs) ---
  targetId: string;
  /** Terrain and other non-actor sources are null. */
  sourceActorId: string | null;
  sourceRuleId: string;
  instance: number;
  delivery: DamageDelivery;
  damageType: 'normal' | 'piercing' | 'divine';
  /** Source-specific HP routing (p.89 dangerous terrain, divine). Piercing
   * does not itself imply this flag. */
  bypassVigor?: boolean;
  /** Exact source exception to Armor (Bleak Mercy p.144); preserves every
   * non-Armor mitigation path. */
  ignoreArmor?: boolean;
  /** Exact source exception to Defiance's application-time HP floor. */
  ignoreDefiance?: boolean;
  ignoreCover: boolean;
  /** True Strike's direct-damage exception to Dodge (p.104). */
  ignoreDodge?: boolean;
  /** Terrain-cover state for source-side re-derivation (p.89). */
  covered?: boolean;

  /** The amount this entry serializes: the source amount for `source`
   * handoffs, the post-mitigation determined amount for `determined`. */
  amount: number;

  // --- Application ledger (both handoffs record the kernel outcome) ---
  appliedAmount: number;
  hpDamage: number;
  vigorDamage: number;
  /** The application-time HP floor that kept the target at 1 hp, or null.
   * Defy Death (p.138) and Defiance (p.104) are application floors, not
   * mitigation steps; the recorded result is what replay must not re-derive
   * from a reduced amount. */
  flooredAt1: 'defiance' | 'defy-death' | null;
  defeated: boolean;
  woundGained: boolean;
  /** Interrupt-window provenance. null means no window opened for this
   * instance (the F0 ledger carries the window record; opening windows from
   * it during replay is the F4 trigger-provenance foundation). */
  window: DamageWindowLedger | null;
}

/**
 * The durable attack-roll ledger (ICON pp.87–94, 107) — the second half of
 * the F0 foundation. One `AttackResolutionLedger` records what the direct
 * target gate validated (legal target, range, line of effect), the terrain
 * cover resolved at command time, the attack-window choices the attack
 * opened, and the attack's downstream damage instance (the same
 * `DamageLedgerEntry` the damage side records). The roll arithmetic itself is
 * already durable on the event (d20/boon/total/evasion/hit/critical); this
 * record is the *authority* provenance replay and trigger windows consume.
 */
export interface AttackResolutionLedger {
  /** Legal target provenance — exactly what the direct gate validated. */
  target: {
    relation: 'foe';
    maximumRange: number;
    lineOfSight: true;
  };
  /** Terrain cover resolved at command time (p.89); the attack's downstream
   * mitigation exception, matching the damage ledger's `covered`. */
  covered: boolean;
  /** Attack-window choices opened by this attack (ICON p.107). F4: a basic
   * attack records the when-damaged/defeated window decision here (null when
   * the target has no armed interrupt) so replay opens it from the record. */
  window: DamageWindowLedger | null;
  /** The attack's downstream damage instance — the durable application
   * ledger (determined amount, HP/vigor split, floor, defeat). */
  damage: DamageLedgerEntry;
}

/**
 * Apply one persisted ledger entry through the authoritative kernel, routing
 * by which side of the handoff it serializes. This is the single replay
 * entry point for every damage-carrying event shape; event branches must not
 * hand-roll `EncounterHeldDamage` literals or re-code p.93 arithmetic.
 */
export function applyDamageLedger(state: EncounterState, entry: DamageLedgerEntry): AppliedDamage | null {
  const target = state.actors[entry.targetId];
  if (!target || target.defeated) return null;
  // F4: a recorded held window is opened from the record — the blow is NOT
  // applied now; it applies when the interrupt answers the window or the
  // boundary drains it (openDamageWindowFromLedger never re-evaluates the
  // target's availability). The open function is the sole gate: a held record
  // it declines (unknown trigger, source handoff) falls through and applies
  // normally.
  if (entry.window?.held === true && openDamageWindowFromLedger(state, entry)) {
    return null;
  }
  const source = entry.sourceActorId ? state.actors[entry.sourceActorId] : undefined;
  if (entry.handoff === 'source') {
    const intent: EncounterDamageIntent = {
      targetId: entry.targetId,
      sourceActorId: entry.sourceActorId ?? undefined,
      sourceRuleId: entry.sourceRuleId,
      amount: entry.amount,
      damageType: entry.damageType,
      delivery: entry.delivery,
      instance: entry.instance,
      ignoreCover: entry.ignoreCover,
      ...(entry.bypassVigor !== undefined ? { bypassVigor: entry.bypassVigor } : {}),
      ...(entry.ignoreArmor !== undefined ? { ignoreArmor: entry.ignoreArmor } : {}),
      ...(entry.ignoreDefiance !== undefined ? { ignoreDefiance: entry.ignoreDefiance } : {}),
      ...(entry.ignoreDodge !== undefined ? { ignoreDodge: entry.ignoreDodge } : {}),
      ...(entry.covered !== undefined ? { covered: entry.covered } : {}),
    };
    return determineAndApplyEncounterDamage(state, intent);
  }
  return applyDeterminedEncounterDamage(state, target, source, {
    targetId: entry.targetId,
    amount: entry.amount,
    damageType: entry.damageType,
    bypassVigor: entry.bypassVigor ?? entry.damageType === 'divine',
    ...(entry.ignoreDefiance !== undefined ? { ignoreDefiance: entry.ignoreDefiance } : {}),
    sourceActorId: entry.sourceActorId ?? entry.sourceRuleId,
    sourceId: entry.sourceRuleId,
    instance: entry.instance,
    delivery: entry.delivery,
    ignoreCover: entry.ignoreCover,
    ...(entry.ignoreDodge !== undefined ? { ignoreDodge: entry.ignoreDodge } : {}),
  });
}
