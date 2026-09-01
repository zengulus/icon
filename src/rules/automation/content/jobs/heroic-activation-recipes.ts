/**
 * Heroic-activation content recipes (ICON pp.116, 121, 127, 134, 141 — the
 * Stalwart class Heroics mechanic and the four heroic-granting job traits).
 *
 * ICON p.116: "Stalwarts can push themselves beyond their normal limits,
 * performing heroics and activating any heroic triggered effects of an
 * ability. Each job has different ways of performing heroics." Heroic is a
 * DECLARATION: the player says "I use this ability's heroic effects when I
 * use it". The generic command transaction (kernels/heroic-activation.ts)
 * turns that intent into a validated-player-activation ONLY when a row here
 * proves availability, pays the recorded cost, and emits the consequence
 * mutations atomically — a caller naming `heroic` never bypasses the
 * transaction, and owning a trait alone is never proof of a legal
 * activation.
 *
 * These rows are CONTENT DATA: named source trait IDs live here (never in
 * the generic kernel); each row REGISTERS its activation contract into the
 * kernel's registry at module load (content → kernel). The kernel folds only
 * the declared fields:
 *
 * - **Strive** (bastion, p.121): "You may cause any ability to trigger its
 *   heroic effects when you use it, and increase the distance of any shoves
 *   by +1. If you do, after that ability resolves, you can't use heroics
 *   until the end of your next turn, and deal half damage during that
 *   turn." Availability: not currently locked out. Consequence: a durable
 *   Heroic lockout until the end of the owner's NEXT turn. The "+1 shove
 *   distance" and "half damage during that turn" halves have no generic
 *   shove-distance / source-half-damage modifier seams yet — they are the
 *   row's precisely-blocked `missingSeams` (the lockout half is exact).
 *
 * - **Demon Strength** (demon-slayer, p.127): "You can make any ability
 *   Heroic when you use it. If you do, you can't attack or use Heroics
 *   until the end of your following turn." Availability: not locked out.
 *   Consequence: the same durable Heroic lockout; the attack gate reads the
 *   identical condition id (`encounter.ts` imports `DEMON_STRENGTH_LOCKOUT_CONDITION`),
 *   so the lockout genuinely prevents later illegal Heroic AND attack
 *   declarations.
 *
 * - **Wolfheart** (colossus, p.134): "Once a round, you may sacrifice 25%
 *   of your max hp to make an ability Heroic and increase the distance of
 *   any flight, rush, or dash as part of that move by +1." Availability:
 *   once per ROUND (a round-scoped U16 utilization ledger). Cost: an actual
 *   sacrifice of 25% of the owner's BASE maximum hp (p.107 "% HEALTH" —
 *   percentage costs always consider the base max, never the wounds-
 *   adjusted bar; the declared rounding is deterministic content data).
 *   Sacrifice costs are paid at the start of an ability, cannot be reduced,
 *   ignored, transferred, or resisted, cannot bring your hp below 1, and
 *   can be paid even when the owner lacks the hp (p.97 glossary) — the ONLY
 *   legally unpayable case is an owner that cannot pay at all (0 hp), which
 *   fails the transaction atomically. Source text grants NO post-use
 *   lockout for Wolfheart (unlike Strive/Demon Strength/Spite). The "+1
 *   flight/rush/dash distance" half has no generic movement-distance
 *   modifier seam yet — it is the row's precisely-blocked `missingSeam`.
 *
 * - **Spite** (knave, p.141): "You can choose to use the Heroic effects of
 *   any ability when you use it. However, after it resolves, gain Hatred+
 *   of the closest foe to you until the end of your next turn and you can't
 *   use Heroics again for the same duration. If multiple foes are
 *   equidistant, you can choose." Availability: not locked out; the
 *   nearest-foe tie is a recorded U4 choice (an EQUIDISTANT tie with no
 *   recorded choice FAILS — never an invented tie-break). Consequence:
 *   Hatred+ of the chosen closest foe (the shared `hatred` condition whose
 *   `hatred-of` provenance halves damage against every other foe) plus the
 *   same-duration Heroic lockout.
 *
 * The lockout condition rides the shared `condition` mutation surface with
 * an owner turn-end duration; "until the end of your NEXT turn" counted from
 * the owner's own turn means the condition survives the currently-ending
 * turn when the heroic was used mid-turn and expires at the OWNER's
 * subsequent turn end (the generic condition lifecycle owns that counting,
 * exactly as the existing intimidate-mastery "until the end of your next
 * turn" row, lifecycle-recipes.ts).
 */
import { registerHeroicActivationRule, type HeroicActivationRule } from '../../kernels/heroic-activation.js';

export const DEMON_STRENGTH_LOCKOUT_CONDITION = 'demon-strength:heroic-lockout';
export const SPITE_LOCKOUT_CONDITION = 'spite:heroic-lockout';
export const STRIVE_LOCKOUT_CONDITION = 'strive:heroic-lockout';

/** The four heroics-granting trait rows (the closed content table — the
 * kernel never names a trait id). */
const HEROIC_ACTIVATION_RULES: readonly HeroicActivationRule[] = [
  {
    kind: 'strive',
    sourceId: 'bastion:trait:strive',
    requiresNotLockedOut: { conditionId: STRIVE_LOCKOUT_CONDITION },
    applyLockout: { conditionId: STRIVE_LOCKOUT_CONDITION, durationTurns: 2 },
    missingSeams: ['shove-distance-modifier', 'heroic-half-damage'],
  },
  {
    kind: 'demon-strength',
    sourceId: 'demon-slayer:trait:demon-strength',
    requiresNotLockedOut: { conditionId: DEMON_STRENGTH_LOCKOUT_CONDITION },
    applyLockout: { conditionId: DEMON_STRENGTH_LOCKOUT_CONDITION, durationTurns: 2 },
    missingSeams: [],
  },
  {
    kind: 'wolfheart',
    sourceId: 'colossus:trait:wolfheart',
    oncePerRound: { ledgerSourceId: 'colossus:trait:wolfheart' },
    sacrifice: { percentOfBaseMaximumHp: 25, rounding: 'up' },
    missingSeams: ['movement-distance-modifier'],
  },
  {
    kind: 'spite',
    sourceId: 'knave:trait:spite',
    requiresNotLockedOut: { conditionId: SPITE_LOCKOUT_CONDITION },
    applyLockout: { conditionId: SPITE_LOCKOUT_CONDITION, durationTurns: 2 },
    applyHatred: { ofClosestFoe: true, tieIsRecordedChoice: true, durationTurns: 2 },
    missingSeams: [],
  },
];

for (const rule of HEROIC_ACTIVATION_RULES) {
  registerHeroicActivationRule(rule);
}