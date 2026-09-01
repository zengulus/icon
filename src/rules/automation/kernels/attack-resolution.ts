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
 *   Rebirth modifiers for this ability only;
 * - the trait fold's SOURCE-FORCED exceed (Pulverize, p.134): two or more
 *   elevations higher forces every exceed effect regardless of the roll —
 *   OR'd into the authoritative exceed fact, never approximated as a
 *   threshold change.
 *
 * The resolved rules facts (cover/dodge/aetherwall provenance, flat bonus
 * damage) are recorded against the execution context so the shared damage
 * builder hands them to the attack's direct hit/miss damage only — never to
 * collateral area damage, later delayed damage, or unrelated effects.
 *
 * This module contains no source IDs. Content supplies provenance strings
 * verbatim; the kernel never interprets them.
 */
import { rememberAttackDamage, rollAttackStage, settleStagedAttackRoll, netBoonFor, resolvePreRollEvasion, type AttackDamageProvenance, type AttackRoll } from '../primitives/attack-resolution.js';
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
  /** Source-declared staged true strike (a RuleEffect's
   * `trueStrikeOnExceed`, Takedown p.135 "Exceed or Heroic: Gains true
   * strike"): the attack's OWN exceed classification grants True Strike ON
   * THE CURRENT ATTACK. Folded AFTER the exceed is derived from the
   * pre-fold roll total (no circularity) and BEFORE the hit/miss damage
   * resolves — its dodge consequence rides the attack's damage provenance.
   * Never a "next attack" grant. */
  trueStrikeOnExceed?: boolean;
  /** Ability-declared auto-hit. */
  autoHit?: boolean;
  /** Attachment-declared unerring (for a mastered parent ability). */
  unerring?: boolean;
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
  /** SOURCE-FORCED exceed (Pulverize p.134): the trait's text forces the
   * exceed fact without the 15+ natural condition. The attack mutation's
   * `exceed` field already includes it — this is the classification the
   * boundary uses to record source-forced provenance. */
  forceExceed: boolean;
  /** The p.89/p.104/p.105 facts for this attack's direct damage only. */
  damageProvenance: AttackDamageProvenance;
  /** The F6 fold result — one-shot consumers read `consumedTraitModifier`. */
  traitModifier: TraitAttackModifier;
  /** The effective damage die for this attack's [D] (an armed d10-style
   * override, else the character's ordinary die). Direct hit/miss damage
   * rolls must use this; collateral area/effect damage keeps the ordinary
   * die. */
  damageDie: number;
  /** The d20 + boon/curse stage this settled attack was folded from. Exposes
   * the PRE-FOLD total (before exceed-derived properties like Takedown's
   * true strike were folded) for tests and replay diagnostics — the exceed
   * fact always derives from THIS same roll, never a second one. */
  stage: { d20: number | null; boon: number; total: number | null; netBoon: number };
}

/** Resolve one ordinary attack from `source` against `target` through the
 * shared authority, in the source's explicit phases:
 *
 * ```text
 * AttackPreRollFacts
 *     declared true strike
 *     heroic-derived true strike
 *     source-forced-exceed-derived true strike
 *         ↓
 * PreRollDefenseWindow
 *     Evasion (p.104 — checked BEFORE the attack roll; a pre-roll true
 *     strike suppresses it entirely)
 *         ↓
 * AttackRoll (ONCE)
 *     d20 + boons/curses
 *     total
 *     natural Exceed
 *     critical
 *         ↓
 * PostRollCurrentAttackFold
 *     natural-Exceed-derived properties
 *     e.g. Takedown p.135 true strike for the CURRENT attack's remaining
 *     damage semantics (dodge / miss-damage treatment)
 *         ↓
 * Hit/miss + direct damage
 * ```
 *
 * Deterministic: all reads come from the execution context (including the
 * recorded dice source), so replay applies the recorded mutation rather than
 * re-deciding anything. */
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
  const intent = {
    defense: target.defense,
    sourceBoon: (options.boons ?? 0) + traitModifier.boons + (context.abilityUseModifiers?.boons ?? 0) + (auraAttack.boons ?? 0) - (auraAttack.curses ?? 0) - targetAuraCurse,
    elevationModifier,
    sourceDazed: source.conditions.has('dazed'),
    targetEvasion: target.conditions.has('evasion'),
    trueStrike: (options.trueStrike ?? false) || traitModifier.trueStrike,
    autoHit: options.autoHit ?? false,
    bonusDamageFlat: traitModifier.bonusDamageFlat + (context.abilityUseModifiers?.bonusDamage ?? 0),
    exceedThreshold: traitModifier.exceedThreshold ?? undefined,
    unerring: Boolean(options.unerring) || traitModifier.unerring,
  };
  // The authoritative exceed fact: the natural 15+ (post-threshold) roll OR
  // a source-forced exceed (Pulverize p.134 "…it also triggers all exceed
  // effects"). Natural and forced activation of the same trigger collapse
  // to one semantic exceed (trigger-provenance.ts) — never double-fired.
  const forceExceed = traitModifier.forceExceed;
  const exceedThreshold = traitModifier.exceedThreshold ?? 15;
  const exceededBy = (total: number | null, threshold: number | null) => total !== null && total >= (threshold ?? 15);

  // ── AttackPreRollFacts ──
  // True Strike available BEFORE the attack roll:
  //  * declared true strike (ability effect / armed trait);
  //  * heroic-derived (Takedown p.135 "Exceed or Heroic: Gains true
  //    strike" — the Heroic declaration exists before the roll);
  //  * source-forced-exceed-derived (Pulverize p.134 elevation ≥ 2 forces
  //    the exceed fact at attack START, never from a later roll; boundary
  //    source-forced exceeds — Ace / Massive Overhead / Open The Gates —
  //    arrive as a pre-existing `exceed` trigger on the context).
  const heroicDerivedTrueStrike = options.trueStrikeOnExceed === true && context.triggers?.has('heroic') === true;
  const forcedExceedTrueStrike = options.trueStrikeOnExceed === true && (forceExceed || context.triggers?.has('exceed') === true);
  const preRollTrueStrike = intent.trueStrike || heroicDerivedTrueStrike || forcedExceedTrueStrike;

  // ── PreRollDefenseWindow (Evasion, p.104) ──
  // Resolved BEFORE the attack roll. An evaded attack is cancelled: no d20
  // and no boon dice are consumed, and no natural Exceed exists (nothing
  // was rolled — a suppressed natural exceed is not a fact this attack
  // carries). Source-forced exceed never needs a roll and still stands. A
  // pre-roll true strike suppresses the check entirely (no d6 consumed).
  const autoHit = intent.autoHit ?? false;
  const evasion = resolvePreRollEvasion(intent, preRollTrueStrike, context.dice);

  // ── AttackRoll (ONCE) + PostRollCurrentAttackFold ──
  // The attack rolls exactly ONCE: an evaded attack consumes nothing; a
  // surviving attack rolls its one d20 + boon/curse stage. Natural Exceed
  // exists only AFTER that roll, so Takedown's exceed-granted true strike
  // applies to the CURRENT attack's remaining consequences (dodge /
  // miss-damage treatment) — it can never retroactively erase the
  // already-resolved Evasion check (an evaded attack never reaches the
  // roll), and it is never a "next attack" grant.
  let attack: AttackRoll;
  let rawStage: { d20: number | null; boon: number; total: number | null; netBoon: number };
  if (evasion.evaded) {
    // Cancelled: the attack consumed ONLY the pre-roll Evasion d6 — no d20,
    // no boon dice. A suppressed natural exceed is not a fact this attack
    // carries.
    rawStage = { d20: null, boon: 0, total: null, netBoon: netBoonFor(intent) };
    attack = settleStagedAttackRoll(rawStage, intent, evasion, preRollTrueStrike);
  } else {
    rawStage = rollAttackStage(intent, context.dice);
    const naturalExceed = exceededBy(rawStage.total, exceedThreshold);
    const effectiveTrueStrike = preRollTrueStrike || (options.trueStrikeOnExceed === true && naturalExceed);
    // The genuinely-made pre-roll Evasion roll (which failed) is recorded on
    // the attack — the check happened FIRST, then the single attack roll.
    attack = settleStagedAttackRoll(rawStage, intent, evasion, effectiveTrueStrike);
  }
  const { d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit: recordedAutoHit, ignoreDodge, ignoreCover, ignoreAetherwall, bonusFlat, bonusDice, exceedThreshold: recordedExceedThreshold } = attack;
  // The recorded exceed fact derives from the SETTLED roll (an evaded attack
  // records no total, so its suppressed natural exceed is not a fact this
  // attack carries — source-forced exceed, which never needs a roll, still
  // stands). For a surviving staged attack this is the same single roll.
  const exceed = exceededBy(total, exceedThreshold) || forceExceed;
  const damageProvenance = { ignoreDodge: trueStrike || ignoreDodge, ignoreCover, ignoreAetherwall, bonusFlat, bonusDice };
  rememberAttackDamage(context, target.id, damageProvenance);
  const attackMutation: RuleMutation = {
    kind: 'attack', sourceId: context.sourceId, actorId: source.id, targetId: target.id, d20, boon, total, hit, critical,
    exceed, exceedThreshold: recordedExceedThreshold ?? 15, evasionRoll, trueStrike, autoHit: recordedAutoHit,
  };
  return {
    attackMutation, d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit: recordedAutoHit,
    exceedThreshold: recordedExceedThreshold ?? 15,
    forceExceed,
    damageProvenance,
    traitModifier,
    damageDie: traitModifier.damageDieOverride ?? source.damageDie,
    stage: rawStage,
  };
}
