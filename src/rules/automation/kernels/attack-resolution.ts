/**
 * Authoritative ordinary attack-resolution kernel (docs/rules-foundations.md
 * §7, the unified attack seam).
 *
 * One source-ID-free answer to "how does an ordinary ICON attack resolve,
 * regardless of execution path?" The declarative VM `attack` effect, named
 * Job ability resolvers, and the generic foe recipe attack all call
 * `resolveAuthoritativeAttack`; a future generic attack modifier has exactly
 * one place to integrate and thereby reaches every path automatically.
 *
 * The kernel composes existing authorities rather than re-implementing them:
 *
 * - `resolveAttackRoll` (primitives) — the roll itself: defense, boon/curse,
 *   elevation, Dazed, Evasion, True Strike, auto-hit, critical, the F6
 *   exceed-threshold override, unerring, and flat bonus damage;
 * - `traitAttackModifier` (kernels/attack-modifiers.ts, F6) — armed one-shot
 *   modifiers (Hissatsu / Demon Edge), permanent elevation mechanics
 *   (Pulverize), target-threshold flat damage (Blood Hunger), and exact-range
 *   gates (Trigrammaton) evaluated through the canonical p.92 footprint
 *   distance;
 * - the aura projection (kernels/aura.ts) — the attacker's own aura boons/
 *   curses plus any defensive curse an aura projects against the target;
 * - `context.abilityUseModifiers` (F10) — per-resolution Blessing of War /
 *   Rebirth modifiers for this ability only.
 *
 * The resolved rules facts (cover/dodge/aetherwall provenance, flat bonus
 * damage) are recorded against the execution context so the shared damage
 * builder hands them to the attack's direct hit/miss damage only — never to
 * collateral area damage, later delayed damage, or unrelated effects.
 *
 * This module contains no source IDs. Content supplies provenance strings
 * verbatim; the kernel never interprets them.
 */
import { rememberAttackDamage, resolveAttackRoll, type AttackDamageProvenance } from '../primitives/attack-resolution.js';
import { footprintDistance } from '../primitives/spatial-intent.js';
import type { RuleActorView, RuleExecutionContext, RuleMutation } from '../primitives/types.js';
import { traitAttackModifier, type TraitAttackModifier } from './attack-modifiers.js';
import { auraRuntimeView, projectedAuraAttackModifiers } from './aura.js';

/** The ability/effect-declared part of an attack. Everything else (F6 trait
 * fold, aura projections, F10 ability-use modifiers) folds in the kernel, so
 * callers only pass what their own source text contributes. */
export interface AuthoritativeAttackOptions {
  /** Ability-declared boons, already evaluated (a RuleEffect's `boons`). */
  boons?: number;
  /** Ability-declared true strike (a RuleEffect's `trueStrike`). */
  trueStrike?: boolean;
  /** Ability-declared auto-hit. */
  autoHit?: boolean;
}

/** The resolved ordinary attack: the durable attack mutation plus every
 * derived fact the caller needs to branch on (hit/miss/critical/Exceed) and
 * to emit direct hit/miss damage with the correct provenance. */
export interface AuthoritativeAttackResult {
  attackMutation: RuleMutation;
  d20: number | null;
  boon: number;
  total: number | null;
  hit: boolean;
  critical: boolean;
  evasionRoll: number | null;
  trueStrike: boolean;
  autoHit: boolean;
  /** The effective Exceed threshold after trait overrides (default 15). */
  exceedThreshold: number;
  /** The p.89/p.104/p.105 facts for this attack's direct damage only. */
  damageProvenance: AttackDamageProvenance;
  /** The F6 fold result — one-shot consumers read `consumedTraitModifier`. */
  traitModifier: TraitAttackModifier;
  /** The effective damage die for this attack's [D] (an armed d10-style
   * override, else the character's ordinary die). Direct hit/miss damage
   * rolls must use this; collateral area/effect damage keeps the ordinary
   * die. */
  damageDie: number;
}

/** Resolve one ordinary attack from `source` against `target` through the
 * shared authority. Deterministic: all reads come from the execution context
 * (including the recorded dice source), so replay applies the recorded
 * mutation rather than re-deciding anything. */
export function resolveAuthoritativeAttack(
  context: RuleExecutionContext,
  source: RuleActorView,
  target: RuleActorView,
  options: AuthoritativeAttackOptions = {},
): AuthoritativeAttackResult {
  const elevationModifier = source.position && target.position
    ? context.state.elevationAt(source.position) - context.state.elevationAt(target.position)
    : 0;
  // Aura membership feeds the same attack-modifier authority as the trait
  // fold: the attacker's own aura boons/curses plus any defensive curse an
  // aura projects against the target (netBoon, p.92).
  const auraView = auraRuntimeView(context.state);
  const auraAttack = projectedAuraAttackModifiers(auraView, source.id);
  const targetAuraCurse = projectedAuraAttackModifiers(auraView, target.id).targetCurses ?? 0;
  // Distance-gated F6 rules (Trigrammaton's exactly-range-3 boon/unerring)
  // read the canonical p.92 footprint metric — the same distance the
  // targeting gates use, so a modifier and a selector can never disagree.
  const distance = source.position && target.position
    ? footprintDistance({ position: source.position, size: source.size }, { position: target.position, size: target.size })
    : undefined;
  const traitModifier = traitAttackModifier(source, elevationModifier, { hp: target.hp, maxHp: target.maxHp, distance });
  const attack = resolveAttackRoll({
    defense: target.defense,
    sourceBoon: (options.boons ?? 0) + traitModifier.boons + (context.abilityUseModifiers?.boons ?? 0) + (auraAttack.boons ?? 0) - (auraAttack.curses ?? 0) - targetAuraCurse,
    elevationModifier,
    sourceDazed: source.conditions.has('dazed'),
    targetEvasion: target.conditions.has('evasion'),
    trueStrike: (options.trueStrike ?? false) || traitModifier.trueStrike,
    autoHit: options.autoHit ?? false,
    bonusDamageFlat: traitModifier.bonusDamageFlat + (context.abilityUseModifiers?.bonusDamage ?? 0),
    exceedThreshold: traitModifier.exceedThreshold ?? undefined,
    unerring: traitModifier.unerring,
  }, context.dice);
  const { d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit, ignoreDodge, ignoreCover, ignoreAetherwall, bonusFlat, exceedThreshold } = attack;
  const damageProvenance = { ignoreDodge, ignoreCover, ignoreAetherwall, bonusFlat };
  rememberAttackDamage(context, target.id, damageProvenance);
  const attackMutation: RuleMutation = {
    kind: 'attack', sourceId: context.sourceId, actorId: source.id, targetId: target.id, d20, boon, total, hit, critical,
    exceed: total !== null && total >= (exceedThreshold ?? 15), exceedThreshold: exceedThreshold ?? 15, evasionRoll, trueStrike, autoHit,
  };
  return {
    attackMutation, d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit,
    exceedThreshold: exceedThreshold ?? 15,
    damageProvenance,
    traitModifier,
    damageDie: traitModifier.damageDieOverride ?? source.damageDie,
  };
}
