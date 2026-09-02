import { determineAndApplyEncounterDamage, registerDefeatGuard, registerOnDamageDealtHook, registerStatusSavePolicySource, registerVigorDenialSource } from '../../kernels/encounter-adapter.js';
import { auraDefinitionFor, auraStateView, isInAura } from '../../kernels/aura.js';
import { resolveCapturedActorWeak } from '../glue/reference-authoring.js';
import { registerInterruptsPerTurnCapSource } from '../../kernels/use-ledger.js';
import type { EncounterActor, EncounterState } from '../../../types.js';

/** ICON p.124 Bastion Chapter 3 Black Rock Vanguard: "You can take any number
 * of interrupts per turn." This is an ACTOR-SPECIFIC override of the p.91
 * per-turn interrupt restriction for the owning Bastion only — it must never
 * raise any other actor's independent per-turn window. Registered here as a
 * content cap source; the kernel decides the window purely from the actor. */
registerInterruptsPerTurnCapSource((actor) => {
  if (actor.traitIds.includes('bastion:trait:black-rock-vanguard')) return Number.POSITIVE_INFINITY;
  return undefined;
});

/**
 * Source-specific encounter hooks (content/jobs).
 *
 * The job-ability behaviors that used to live inline in the encounter adapter
 * register here as kernel hooks, so `kernels/encounter-adapter.ts` contains
 * no source IDs: Boiling Blood's defy-death defeat guard, Rot's vigor denial
 * and save-curse policy, Sweet Torment's cure/status-save denial, and the
 * on-damage-dealt hooks (Gentleness reflection, Aria's pending-damage count,
 * Chastise retribution trigger).
 */

/** ICON p.186 Rot only applies its hostile cure/vigor/save effects to the foe-mark branch. */
function hasFoeRotMark(state: EncounterState, actor: EncounterActor): boolean {
  return actor.marks.some((mark) => {
    if (mark.markId !== 'rot') return false;
    const kind = mark.state['kind'];
    if (kind === 'foe') return true;
    if (kind === 'ally') return false;
    // Legacy/imported marks predate the explicit `kind`; infer only when the
    // owner is still known, never from a missing owner. The owner read is
    // therefore LIFECYCLE-SENSITIVE (weak captured resolution): a present id
    // whose actor is gone resolves to undefined (legitimate expiry — yet
    // another legacy/import inference blocker), never an error.
    const owner = resolveCapturedActorWeak({ state }, mark.ownerId);
    const ownerSide = owner?.side;
    return ownerSide !== undefined && ownerSide !== actor.side;
  });
}

/** ICON p.144 Sweet Torment: foes in the active aura cannot be cured or save
 * clear statuses. Membership is the generic aura kernel's — the durable aura
 * effect is the lifetime + radius record, and the kernel derives who is
 * inside from current positions (no local distance math). */
function inSweetTormentAura(state: EncounterState, target: EncounterActor): boolean {
  if (target.defeated || !target.onBattlefield) return false;
  const definition = auraDefinitionFor('knave:bleak-mercy');
  return definition !== null && isInAura(auraStateView(state), definition, target.id);
}

/** ICON p.179 Gentleness: true when a gentleness-stance character's aura 1
 * covers `actor` (the aura includes the stance user themselves). The stance
 * origin and radius come from the shared aura kernel. */
function inGentlenessAura(state: EncounterState, actor: EncounterActor): boolean {
  if (!actor.position) return false;
  const definition = auraDefinitionFor('chanter:gentleness');
  return definition !== null && isInAura(auraStateView(state), definition, actor.id);
}

/** ICON p.179 Gentleness: any character that deals damage while in the stance's
 * aura takes 1 divine damage (applied directly, so it cannot reflect again).
 * This remains raw source damage until it reaches the shared pipeline; divine
 * bypasses mitigation and vigor there rather than by a special local write. */
function gentlenessReflection(state: EncounterState, attacker: EncounterActor) {
  if (attacker.defeated || !attacker.onBattlefield || attacker.ruleState['damage-immune'] === true) return;
  if (!inGentlenessAura(state, attacker)) return;
  determineAndApplyEncounterDamage(state, {
    targetId: attacker.id,
    sourceRuleId: 'core:gentleness',
    amount: 1,
    damageType: 'divine',
    instance: 1,
    delivery: 'effect',
    ignoreCover: true,
  // The reflection cannot start a reaction loop: it neither opens Counter
  // nor reflects Gentleness again. This must stay narrower than Counter's
  // recursion guard, because a Counter hit can itself trigger Gentleness.
  }, { allowCounter: false, allowGentleness: false });
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

/** ICON p.138 Boiling Blood: while the defy-death effect is active, the actor
 * fights on at 1 hp instead of being defeated, and damage cannot reduce them
 * past 1 hp. The effect itself expires at the end of the actor's next turn
 * (or when combat ends), at which point the bonus damage ends too. */
registerDefeatGuard({
  sourceId: 'colossus:boiling-blood',
  active: (actor) => actor.activeEffects.some((effect) => effect.effectId === 'defy-death'),
});

// ICON p.186 Rot: the foe-mark branch denies hostile cure/vigor.
registerVigorDenialSource({
  sourceId: 'harvester:rot',
  denies: (state, actor) => hasFoeRotMark(state, actor),
});

// ICON p.186 Rot: a foe-marked character cannot be cured and saves with a curse.
registerStatusSavePolicySource({
  sourceId: 'harvester:rot',
  modify: (state, actor, policy) => {
    if (!hasFoeRotMark(state, actor)) return;
    policy.cureDenied = true;
    policy.saveCurse += 1;
  },
});

// ICON p.144 Sweet Torment: foes in the active aura cannot be cured or save clear statuses.
registerStatusSavePolicySource({
  sourceId: 'chanter:sweet-torment',
  modify: (state, actor, policy) => {
    if (!inSweetTormentAura(state, actor)) return;
    policy.cureDenied = true;
    policy.statusSaveDenied = true;
  },
});

// ICON p.179 Gentleness: a character that deals damage while in the stance's
// aura takes 1 divine damage. Applied directly (mirroring Counter) so the
// reflection cannot recurse.
registerOnDamageDealtHook({
  sourceId: 'chanter:gentleness',
  apply: (state, source, target, _damage, options) => {
    if (options.allowGentleness === false) return;
    if (!source || source.id === target.id) return;
    gentlenessReflection(state, source);
  },
});

// ICON p.178 Aria: foe damage while the performance is pending grows the
// blast from small to medium to large at the start of the user's next turn.
registerOnDamageDealtHook({
  sourceId: 'chanter:aria',
  apply: (_state, source, target) => {
    if (target.ruleState['aria:pending'] === true && source && source.side !== target.side) {
      target.ruleState['aria:damaged'] = Number(target.ruleState['aria:damaged'] ?? 0) + 1;
      target.ruleStateOwners['aria:damaged'] ??= null;
    }
  },
});

// ICON p.179 Chastise: a marked foe that damages a chosen character with an
// ability triggers its retribution (dealt at the end of its turn).
registerOnDamageDealtHook({
  sourceId: 'chanter:chastise',
  apply: (_state, source, target) => {
    if (!source || source.side !== 'foes') return;
    const retribution = source.marks.find((mark) => mark.markId === 'chastise-retribution');
    if (!retribution) return;
    const chosen: string[] = typeof retribution.state.chosen === 'string' ? JSON.parse(retribution.state.chosen) as string[] : [];
    if (chosen.includes(target.id)) retribution.state.triggered = true;
  },
});
