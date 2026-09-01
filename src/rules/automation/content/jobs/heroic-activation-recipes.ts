/**
 * Heroic-activation content recipes (ICON pp.116, 121, 127, 134, 141 — the
 * Stalwart class Heroics mechanic, the four heroic-granting job traits, and
 * the Stalwart Gambit).
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
 * These rows are CONTENT DATA: named source trait/class ids live here (never
 * in the generic kernel); each row REGISTERS its activation contract into
 * the kernel's registry at module load (content → kernel). The kernel folds
 * only the declared fields:
 *
 * - **Strive** (bastion, p.121): "You may cause any ability to trigger its
 *   heroic effects when you use it, and increase the distance of any shoves
 *   by +1. If you do, after that ability resolves, you can't use heroics
 *   until the end of your next turn, and deal half damage during that
 *   turn." FAILS CLOSED: the "+1 shove distance" and "half damage during
 *   that turn" halves have no generic shove-distance / source-damage-halving
 *   folds yet, and the half-damage clause is a mandatory DOWNside of taking
 *   Heroic — granting the lockout while omitting the damage penalty would be
 *   a partial source unit. The row stays registered (census/provenance) with
 *   its precise `missingSeams`; the declaration is rejected until complete.
 *
 * - **Demon Strength** (demon-slayer, p.127): "You can make any ability
 *   Heroic when you use it. If you do, you can't attack or use Heroics
 *   until the end of your following turn." Fully executable: the durable
 *   lockout condition blocks later Heroic declarations (this row's own
 *   availability gate) AND later attacks (the attack gate in encounter.ts
 *   reads the same condition id).
 *
 * - **Wolfheart** (colossus, p.134): "Once a round, you may sacrifice 25%
 *   of your max hp to make an ability Heroic and increase the distance of
 *   any flight, rush, or dash as part of that move by +1." FAILS CLOSED:
 *   the once-per-round gate and the 25%-of-base-max sacrifice (p.107 "%
 *   HEALTH" figure, p.97 glossary) are representable, but the "+1 flight/rush/dash
 *   distance" half has no generic movement-distance modifier seam yet. The
 *   benefit is a mandatory half of the sacrifice — a partial version never
 *   executes. The row stays registered with its precise `missingSeam`.
 *
 * - **Spite** (knave, p.141): "You can choose to use the Heroic effects of
 *   any ability when you use it. However, after it resolves, gain Hatred+
 *   of the closest foe to you until the end of your next turn and you can't
 *   use Heroics again for the same duration. If multiple foes are
 *   equidistant, you can choose." Fully executable: both consequences are a
 *   POST-RESOLUTION continuation (U12) — evaluated against THEN-CURRENT
 *   state after the ability's own movements/defeats are final. A unique
 *   closest foe is source-determined and resolves without asking; an
 *   equidistant tie opens the U13 window below (the recorded U4 choice —
 *   never an invented tie-break).
 *
 * - **Stalwart Gambit** (stalwart class, p.116): "If you take a Stalwart
 *   ability while your primary Job is not Stalwart, you gain Heroics and
 *   may trigger one Heroic effect for free once per combat." Fully
 *   executable: a non-Stalwart character (actor `classId` ≠ 'stalwart')
 *   using a Stalwart-class ability (the ability catalog's `classId` ===
 *   'stalwart' — Bastion/Demon Slayer/Colossus job abilities) may declare
 *   Heroic once per combat with no cost. Ordinary Stalwart-class characters
 *   (whose primary job IS Stalwart) are unaffected — their own job-trait
 *   recipe governs; the gambit row never applies to them.
 *
 * The lockout condition rides the shared `condition` mutation surface with
 * an owner turn-end duration; "until the end of your NEXT turn" counted from
 * the owner's own turn means the condition survives the currently-ending
 * turn when the heroic was used mid-turn and expires at the OWNER's
 * subsequent turn end (the generic condition lifecycle owns that counting,
 * exactly as the existing intimidate-mastery "until the end of your next
 * turn" row, lifecycle-recipes.ts).
 */
import { registerHeroicActivationRecipe, type HeroicActivationRecipe } from '../../kernels/heroic-activation.js';
import { registerDecisionContinuation } from '../../kernels/continuation-runtime.js';
import { findAbility } from '../../../catalog.js';
import { footprintDistance } from '../../primitives/spatial-intent.js';
import type { EncounterActor, EncounterState } from '../../../types.js';
import type { RuleMutation } from '../../primitives/types.js';

export const DEMON_STRENGTH_LOCKOUT_CONDITION = 'demon-strength:heroic-lockout';
export const SPITE_LOCKOUT_CONDITION = 'spite:heroic-lockout';
export const STRIVE_LOCKOUT_CONDITION = 'strive:heroic-lockout';
/** The Spite post-resolution continuation's resume dispatch key. */
export const SPITE_POST_RESOLUTION_PROGRAM = 'knave:trait:spite:post-resolution';

/** The Stalwart Gambit ledger key (the once-per-combat free Heroic). */
const STALWART_GAMBIT_LEDGER = 'stalwart:gambit:heroics';

/** The heroic-granting source rows (the closed content table — the kernel
 * never names a trait/class id). Rows with non-empty `missingSeams` are
 * REGISTERED but fail closed (never execute a partial version). */
const HEROIC_ACTIVATION_RECIPES: readonly HeroicActivationRecipe[] = [
  {
    sourceId: 'bastion:trait:strive',
    missingSeams: ['shove-distance-modifier', 'heroic-half-damage'],
    applies: ({ actor }) => (actor.traitIds ?? []).includes('bastion:trait:strive'),
    availability: [{ kind: 'not-locked-out', conditionId: STRIVE_LOCKOUT_CONDITION }],
    costs: [],
    preResolutionEffects: [{ kind: 'apply-condition', conditionId: STRIVE_LOCKOUT_CONDITION, durationTurns: 2 }],
  },
  {
    sourceId: 'demon-slayer:trait:demon-strength',
    missingSeams: [],
    applies: ({ actor }) => (actor.traitIds ?? []).includes('demon-slayer:trait:demon-strength'),
    availability: [{ kind: 'not-locked-out', conditionId: DEMON_STRENGTH_LOCKOUT_CONDITION }],
    costs: [],
    preResolutionEffects: [{ kind: 'apply-condition', conditionId: DEMON_STRENGTH_LOCKOUT_CONDITION, durationTurns: 2 }],
  },
  {
    sourceId: 'colossus:trait:wolfheart',
    missingSeams: ['movement-distance-modifier'],
    applies: ({ actor }) => (actor.traitIds ?? []).includes('colossus:trait:wolfheart'),
    availability: [{ kind: 'once-per-round', ledgerSourceId: 'colossus:trait:wolfheart' }],
    costs: [{ kind: 'sacrifice-percent', percentOfBaseMaximumHp: 25, rounding: 'up' }],
    preResolutionEffects: [],
  },
  {
    sourceId: 'knave:trait:spite',
    missingSeams: [],
    applies: ({ actor }) => (actor.traitIds ?? []).includes('knave:trait:spite'),
    availability: [{ kind: 'not-locked-out', conditionId: SPITE_LOCKOUT_CONDITION }],
    costs: [],
    preResolutionEffects: [],
    postResolutionContinuation: {
      kind: 'hatred-of-closest-foe',
      programId: SPITE_POST_RESOLUTION_PROGRAM,
      durationTurns: 2,
      tieIsRecordedChoice: true,
    },
  },
  {
    sourceId: 'stalwart:gambit',
    missingSeams: [],
    // Stalwart Gambit (p.116): a character whose primary job is NOT a
    // Stalwart-class job gains Heroics for the Stalwart abilities they take.
    // Identified through the durable ownership surface — the actor's classId
    // (encounter construction) and the ability catalog's classId — never a
    // name match. Ordinary Stalwart-class characters are covered by their own
    // job-trait recipe; this row never applies to them.
    applies: ({ actor, abilityId }) =>
      actor.classId !== 'stalwart'
      && typeof abilityId === 'string'
      && findAbility(abilityId)?.classId === 'stalwart',
    availability: [{ kind: 'once-per-combat', ledgerSourceId: STALWART_GAMBIT_LEDGER }],
    costs: [],
    preResolutionEffects: [],
  },
];

for (const recipe of HEROIC_ACTIVATION_RECIPES) {
  registerHeroicActivationRecipe(recipe);
}

/** The living battlefield foes of `actorId` ordered by canonical footprint
 * distance from the actor's current footprint, closest first. Pure function
 * of state — the single closest-foe query both Spite branches share. */
function closestFoesOf(state: EncounterState, actorId: string): EncounterActor[] {
  const actor = state.actors[actorId];
  if (!actor?.position) return [];
  const foes = Object.values(state.actors).filter((candidate) =>
    candidate.id !== actorId
    && candidate.side !== actor.side
    && !candidate.defeated
    && candidate.onBattlefield
    && candidate.position !== null);
  if (foes.length === 0) return [];
  const anchor = actor.position;
  const distances = foes.map((foe) => ({
    foe,
    distance: footprintDistance({ position: anchor, size: actor.size }, { position: foe.position!, size: foe.size }),
  }));
  const minimum = Math.min(...distances.map((entry) => entry.distance));
  return distances.filter((entry) => entry.distance === minimum).map((entry) => entry.foe);
}

/** Spite's post-resolution consequences: Hatred+ of the chosen closest foe
 * (the shared `hatred` condition whose `sourceActorId` IS the hated foe —
 * the apply path records `ruleState['hatred-of']` from it, and the damage
 * authority halves damage against every other foe, p.104) plus the same-
 * duration Heroic lockout. Both apply AFTER the ability resolves (p.141). */
function spiteConsequenceMutations(ownerId: string, hatedId: string, durationTurns: number, sourceId: string): RuleMutation[] {
  return [
    {
      kind: 'condition',
      sourceId,
      sourceActorId: hatedId, // ← the hated foe: the shared `hatred-of` provenance.
      actorId: ownerId,
      conditionId: 'hatred',
      operation: 'apply',
      potency: 'plus',
      duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: durationTurns },
    },
    {
      kind: 'condition',
      sourceId,
      sourceActorId: ownerId,
      actorId: ownerId,
      conditionId: SPITE_LOCKOUT_CONDITION,
      operation: 'apply',
      potency: 'normal',
      duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: durationTurns },
    },
  ];
}

/** The Spite POST-RESOLUTION decision continuation (p.141 "after it
 * resolves"): the armed U12 continuation is resumed by the reducer after the
 * ability's own mutations apply, so the closest-foe query sees the RESOLVED
 * battlefield (the ability may move the Knave, defeat the former closest
 * foe, or change presence).
 *
 * - Unique closest foe → the source determines the target; the deterministic
 *   `autoResolve` branch applies WITHOUT asking (`windowRequired` false).
 * - Equidistant tie → the U13 window opens (`windowRequired` true) and the
 *   owner records the choice among the tied foes; the recorded answer rides
 *   the held continuation (`capturedValues.decision`) and `resolve` applies
 *   it — never an invented tie-break.
 */
registerDecisionContinuation({
  programId: SPITE_POST_RESOLUTION_PROGRAM,
  choice: {
    key: 'closest-foe',
    label: 'Choose the closest foe to hate',
    kind: 'actors',
    relation: 'foe',
    required: true,
    minimum: 1,
    maximum: 1,
  },
  // The window is reserved for the source-granted decision: an equidistant
  // tie. A unique closest foe is source-determined — no window.
  windowRequired: (state, continuation) => {
    const ownerId = continuation.ownerRef.kind === 'captured-actor' ? continuation.ownerRef.actorId : '';
    if (!ownerId) throw new Error('spite.post-resolution: the continuation owner is not a single actor.');
    return closestFoesOf(state, ownerId).length > 1;
  },
  autoResolve: (state, continuation) => {
    const ownerId = continuation.ownerRef.kind === 'captured-actor' ? continuation.ownerRef.actorId : '';
    if (!ownerId) throw new Error('spite.post-resolution: the continuation owner is not a single actor.');
    const closest = closestFoesOf(state, ownerId);
    if (closest.length !== 1) {
      throw new Error(`spite.post-resolution: expected a unique post-resolution closest foe (found ${closest.length}).`);
    }
    const durationTurns = Number(continuation.capturedValues?.durationTurns ?? 2);
    return spiteConsequenceMutations(ownerId, closest[0]!.id, durationTurns, continuation.programId);
  },
  consume: () => [],
  resolve: (state, continuation) => {
    const ownerId = continuation.ownerRef.kind === 'captured-actor' ? continuation.ownerRef.actorId : '';
    if (!ownerId) throw new Error('spite.post-resolution: the continuation owner is not a single actor.');
    const chosenId = continuation.capturedValues?.decision;
    const closest = closestFoesOf(state, ownerId);
    if (typeof chosenId !== 'string' || !closest.some((foe) => foe.id === chosenId)) {
      throw new Error('spite.post-resolution: the recorded closest-foe choice is not among the equidistant closest foes — fail closed, never an invented tie-break.');
    }
    const durationTurns = Number(continuation.capturedValues?.durationTurns ?? 2);
    return spiteConsequenceMutations(ownerId, chosenId, durationTurns, continuation.programId);
  },
});
