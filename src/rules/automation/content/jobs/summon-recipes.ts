import { registerSummonSuites } from '../../kernels/summon-recipes.js';
import type { JobSummonSuite } from '../../kernels/summon-recipes.js';

/**
 * F6 job-summon suites (docs/rules-foundations.md §7).
 *
 * The six Job "Summons" rule rows, registered into the
 * `kernels/summon-recipes.ts` registry on import. The rows supply the
 * deterministic placement contract the engine executes (free space within
 * `defaultRange`, at most `maxActive` per owner) while the summon
 * action/effect text stays on the row as the documented table-facing
 * behavior, exactly as the ability programs keep their source text on every
 * event.
 */
export const JOB_SUMMON_SUITES: readonly JobSummonSuite[] = [
  {
    jobId: 'fool',
    sourceId: 'fool:summon-rules',
    entityTypes: ['bomb'],
    defaultRange: 2,
    maxActive: 6,
    mechanic: 'Bombs summon into a free space in range 2 (unless a different range is specified) and cap at six active per owner.',
    tableFacing: 'The bomb is Size 1 intangible, can be carried/removed by characters entering its space, and detonates via the Carnevale turn-end gamble (wired) or the documented movement-entry detonation.',
  },
  {
    jobId: 'shade',
    sourceId: 'shade:summon-rules',
    entityTypes: ['shadow'],
    defaultRange: 2,
    maxActive: 6,
    mechanic: 'Shadows summon into a free space in range 2 (unless a higher range is specified) and cap at six active per owner; shadow clouds are uncapped terrain.',
    tableFacing: 'A shadow is Size 1 intangible, shares space with characters, deals 2 damage to a foe that enters/starts on it, and grants stealth to an ally that enters it (documented entry triggers).',
  },
  {
    jobId: 'warden',
    sourceId: 'warden:summon-rules',
    entityTypes: ['beast'],
    defaultRange: 2,
    maxActive: 6,
    mechanic: 'Beasts summon into a free space in range 2 (unless a different range is listed) and cap at six active per owner.',
    tableFacing: 'A beast is Size 1 intangible; all beasts may dash 1 at the start of your turn and pounce at a foe in range 3 for unerring damage equal to distance (documented summon actions).',
  },
  {
    jobId: 'harvester',
    sourceId: 'harvester:summon-rules',
    entityTypes: ['thrall', 'plant'],
    defaultRange: 2,
    maxActive: 6,
    mechanic: 'Thralls (and plants) summon into a free space in range 2 unless a different range is listed; thralls cap at six active per owner, plants are uncapped terrain.',
    tableFacing: 'A thrall is Size 1 intangible; all thralls may dash 2 at the start of your turn, deal 1 piercing damage to an adjacent foe, then become a plant (documented summon action).',
  },
  {
    jobId: 'seer',
    sourceId: 'seer:summon-rules',
    entityTypes: ['wild-card'],
    defaultRange: 2,
    maxActive: 6,
    mechanic: 'Wild cards summon into a free space in range 2 if no other range is listed and cap at six active per owner.',
    tableFacing: 'A wild card is Size 1 intangible with an inactive small blast; allied area abilities touching its space activate it, extending the area to include the card (documented summon effect).',
  },
  {
    jobId: 'stormbender',
    sourceId: 'stormbender:summon-rules',
    entityTypes: ['salt-sprite'],
    defaultRange: 2,
    maxActive: 6,
    mechanic: 'Salt sprites summon into a free space in range 2 unless a different range is specified and cap at six active per owner.',
    tableFacing: 'A salt sprite is Size 1 intangible and immobile, both summon and difficult-terrain effect; shoves into its space trigger collide, awaken it, and resolve the ally/fly or foe/shove response (documented summon effect).',
  },
];

registerSummonSuites(JOB_SUMMON_SUITES);
