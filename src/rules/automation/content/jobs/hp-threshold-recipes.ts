import { registerHpThresholdProjection } from '../../kernels/hp-threshold.js';

/**
 * Reviewed HP-threshold Job/Class trait passives (content/jobs).
 *
 * Same generic kernel as the foe rows (`kernels/hp-threshold.ts`); a Job
 * trait row is keyed by the owning trait id and projects while the owner is
 * at the threshold, through the shared condition fold.
 */

// ICON p.192 Colossus Furious Berserk: "While you're bloodied, you are
// sturdy, and gain vigilance +1 at the end of your turn." The sturdy half is
// the continuous projection (previously table-facing because no condition
// projected only while bloodied); the vigilance half stays the turn-end
// lifecycle recipe.
registerHpThresholdProjection({
  sourceId: 'colossus:trait:furious-berserk',
  threshold: 'bloodied',
  conditions: ['sturdy'],
});
