import type { EncounterActor, EncounterEntity, EncounterHeldDamage, EncounterPendingInterrupt, EncounterState, EncounterTerrainEffect, Position, StatusId } from '../types.js';
import { resourceMaximum } from '../core.js';
import { applyDeterminedDamageToVitals, determineDamage, type AppliedDamage, type DamageDelivery, type DeterminedDamage } from './damage-resolution.js';
import { AREA_INCLUSION_INTERRUPT_IDS, DEFEATED_INTERRUPT_IDS, SAVE_REROLL_INTERRUPT_IDS, TARGETED_BY_ABILITY_INTERRUPT_IDS, USES_ABILITY_INTERRUPT_IDS, WHEN_DAMAGED_INTERRUPT_IDS } from './manual-programs.js';
import { projectedPassiveConditions } from './passive-projection.js';
import type { RuleActorView, RuleMutation, RuleRuntimeState } from './types.js';

const statusIds = new Set<StatusId>(['slashed', 'blind', 'dazed', 'hatred', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable']);
const samePosition = (first: Position, second: Position) => first.x === second.x && first.y === second.y;
const clone = <T>(value: T): T => structuredClone(value);

export function encounterConditionSet(actor: EncounterActor) {
  const conditions = new Set<string>(actor.statuses);
  for (const condition of actor.conditions) conditions.add(condition.id);
  for (const effect of actor.activeEffects) {
    for (const modifier of effect.modifiers) if (modifier.operation === 'grant' && typeof modifier.value === 'string') conditions.add(modifier.value);
  }
  // Trait-derived passives are a closed source-ID projection. Do not infer
  // conditions from trait/role prose here: only reviewed recipes affect
  // authoritative pathing or combat.
  for (const condition of projectedPassiveConditions(actor.traitIds)) conditions.add(condition);
  return conditions;
}

/** ICON p.94: a matching + condition makes that status ongoing. */
function projectedStatuses(actor: EncounterActor): RuleActorView['statuses'] {
  const ongoing = new Set(actor.conditions
    .filter(({ id, potency }) => potency === 'plus' && statusIds.has(id as StatusId))
    .map(({ id }) => id));
  const ids = new Set<string>(actor.statuses);
  // Imported historical state can contain a status condition without the
  // denormalized `statuses` entry.  Keep the projection authoritative rather
  // than silently dropping a saveable/ongoing status from a command.
  for (const condition of actor.conditions) if (statusIds.has(condition.id as StatusId)) ids.add(condition.id);
  return [...ids].map((id) => ({ id, potency: ongoing.has(id) ? 'plus' : 'normal' }));
}

/** ICON p.186 Rot only applies its hostile cure/vigor/save effects to the foe-mark branch. */
function hasFoeRotMark(state: EncounterState, actor: EncounterActor): boolean {
  return actor.marks.some((mark) => {
    if (mark.markId !== 'rot') return false;
    const kind = mark.state['kind'];
    if (kind === 'foe') return true;
    if (kind === 'ally') return false;
    // Legacy/imported marks predate the explicit `kind`; infer only when the
    // owner is still known, never from a missing owner.
    return state.actors[mark.ownerId]?.side !== undefined && state.actors[mark.ownerId]!.side !== actor.side;
  });
}

function sweetTormentRadius(actor: EncounterActor): number | null {
  const effect = actor.activeEffects.find(({ effectId }) => effectId === 'sweet-torment');
  if (!effect) return null;
  const value = effect.modifiers.find(({ operation, stat }) => operation === 'grant' && stat === 'aura')?.value;
  if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'constant' && 'value' in value && typeof value.value === 'number') return Math.max(0, value.value);
  return 1;
}

/** ICON p.144 Sweet Torment: foes in the active aura cannot be cured or save clear statuses. */
function inSweetTormentAura(state: EncounterState, target: EncounterActor): boolean {
  if (target.defeated || !target.onBattlefield) return false;
  return Object.values(state.actors).some((source) => {
    if (source.defeated || !source.onBattlefield || source.side === target.side) return false;
    const radius = sweetTormentRadius(source);
    return radius !== null && Math.max(Math.abs(source.position.x - target.position.x), Math.abs(source.position.y - target.position.y)) <= radius;
  });
}

/**
 * The command-time status-save policy is projected from durable encounter
 * state.  It deliberately has no snapshot field or migration: p.94/p.144/
 * p.186 are recomputed on every authoritative command and replay application.
 */
export function encounterStatusSavePolicy(state: EncounterState, actor: EncounterActor): RuleActorView['statusSavePolicy'] {
  const rot = hasFoeRotMark(state, actor);
  const sweetTorment = inSweetTormentAura(state, actor);
  return {
    cureDenied: rot || sweetTorment,
    statusSaveDenied: sweetTorment,
    saveBoon: 0,
    saveCurse: rot ? 1 : 0,
  };
}

export function encounterRuleState(state: EncounterState): RuleRuntimeState {
  return {
    round: state.round,
    grid: { width: state.grid.width, height: state.grid.height },
    actors: Object.fromEntries(Object.values(state.actors).map((actor): [string, RuleActorView] => [actor.id, {
      id: actor.id,
      side: actor.side,
      position: actor.onBattlefield ? { ...actor.position } : null,
      hp: actor.hp,
      maxHp: Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality),
      vitality: actor.vitality,
      vigor: actor.vigor,
      defense: actor.defense,
      armor: actor.armor,
      speed: actor.speed,
      dash: actor.dash,
      fray: actor.fray,
      damageDie: actor.damageDie,
      actions: actor.actionsRemaining,
      attacked: actor.attackedThisTurn,
      size: actor.size,
      defeated: actor.defeated,
      conditions: encounterConditionSet(actor),
      statuses: projectedStatuses(actor),
      statusSavePolicy: encounterStatusSavePolicy(state, actor),
      resources: { ...actor.resources, resolve: state.partyResolve + (actor.resources['personal-resolve'] ?? 0) },
      state: { ...actor.ruleState, phaseId: actor.ruleState.phaseId ?? null },
      marks: actor.marks.map(({ markId, ownerId }) => ({ markId, ownerId })),
    }])),
    entities: Object.fromEntries(Object.values(state.entities).map((entity) => [entity.id, {
      id: entity.id,
      type: entity.type,
      ownerId: entity.ownerId,
      position: entity.positions[0] ?? null,
      state: entity.state,
    }])),
    terrainEffects: state.terrainEffects.map((effect) => ({
      id: effect.id,
      terrain: effect.terrain,
      ownerId: effect.ownerId,
      positions: clone(effect.positions),
      height: effect.height,
    })),
    terrainAt(position) {
      const values = new Set<string>();
      for (const cell of state.grid.terrain) if (samePosition(cell.position, position)) values.add(cell.type);
      for (const effect of state.terrainEffects) if (effect.positions.some((candidate) => samePosition(candidate, position))) values.add(effect.terrain);
      return values;
    },
    elevationAt(position) {
      const terrain = state.grid.terrain.find((cell) => samePosition(cell.position, position));
      return (terrain?.elevation ?? 0) - (terrain?.type === 'pit' ? 1 : 0);
    },
  };
}

function generatedId(state: EncounterState, sourceId: string, mutationIndex: number, suffix: string) {
  return `${sourceId}:${state.revision}:${mutationIndex}:${suffix}`;
}

function removeOwnedEphemera(state: EncounterState, ownerId: string) {
  for (const [id, entity] of Object.entries(state.entities)) if (entity.ownerId === ownerId && entity.type !== 'object') delete state.entities[id];
  for (const actor of Object.values(state.actors)) {
    actor.marks = actor.marks.filter((mark) => mark.ownerId !== ownerId);
    actor.activeEffects = actor.activeEffects.filter((effect) => effect.ownerId !== ownerId);
  }
}

/** ICON p.138 Boiling Blood: while the defy-death effect is active, the
 * actor fights on at 1 hp instead of being defeated, and damage cannot reduce
 * them past 1 hp. The effect itself expires at the end of the actor's next
 * turn (or when combat ends), at which point the bonus damage ends too. */
export function defyDeathActive(actor: EncounterActor): boolean {
  return actor.activeEffects.some((effect) => effect.effectId === 'defy-death');
}

/**
 * The sole defeat lifecycle.  Event replay, delayed effects, damage, and an
 * explicit defeat mutation all delegate here so incapacitation never leaves
 * behind a stance, mark, active effect, or owned summon.
 */
export function defeatActor(state: EncounterState, actor: EncounterActor, options: { woundGained?: boolean } = {}) {
  if (actor.defeated) return;
  if (defyDeathActive(actor)) {
    actor.hp = Math.max(1, actor.hp);
    return;
  }
  actor.defeated = true;
  actor.hp = 0;
  actor.vigor = 0;
  actor.statuses = [];
  actor.conditions = [];
  actor.activeEffects = [];
  actor.marks = [];
  actor.stance = null;
  if (options.woundGained ?? actor.side === 'heroes') actor.wounds = Math.min(4, actor.wounds + 1);
  removeOwnedEphemera(state, actor.id);
  // Hatred of X ends while X is untargetable: a defeated character can no
  // longer be the target of hatred, so clear any hatred aimed at this actor.
  for (const candidate of Object.values(state.actors)) {
    if (candidate.ruleState['hatred-of'] !== actor.id) continue;
    delete candidate.ruleState['hatred-of'];
    delete candidate.ruleStateOwners['hatred-of'];
    candidate.statuses = candidate.statuses.filter((status) => status !== 'hatred');
    candidate.conditions = candidate.conditions.filter(({ id }) => id !== 'hatred');
  }
}

/** A position has Rampart when a rampart terrain effect covers it or it is
 * adjacent to a character that projects rampart (the Fortify trait, p.116). */
function rampartSourcesAt(state: EncounterState, position: Position): EncounterActor[] {
  const sources: EncounterActor[] = [];
  for (const effect of state.terrainEffects) {
    if (effect.terrain !== 'rampart' || !effect.positions.some((cell) => samePosition(cell, position))) continue;
    const owner = effect.ownerId ? state.actors[effect.ownerId] : undefined;
    if (owner) sources.push(owner);
  }
  for (const candidate of Object.values(state.actors)) {
    if (candidate.defeated || !candidate.onBattlefield) continue;
    const conditions = encounterConditionSet(candidate);
    if (!conditions.has('fortify') && !conditions.has('rampart')) continue;
    if (Math.max(Math.abs(candidate.position.x - position.x), Math.abs(candidate.position.y - position.y)) <= 1) sources.push(candidate);
  }
  return sources;
}

/** ICON p.104 Rampart: foes cannot enter or exit affected spaces by dashing,
 * flying, or teleporting. Slip and Unstoppable ignore rampart (p.105). */
export function rampartObstructs(state: EncounterState, mover: EncounterActor, position: Position): boolean {
  const conditions = encounterConditionSet(mover);
  if (conditions.has('slip') || conditions.has('unstoppable')) return false;
  return rampartSourcesAt(state, position).some((source) => source.side !== mover.side);
}

/** ICON p.94 Bloodied: at or below 50% of maximum HP (after wounds). */
export function isBloodied(actor: EncounterActor): boolean {
  return actor.hp <= Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality) / 2;
}

/**
 * ICON p.105: Vigor is capped at the actor's Vitality.  Rot and Shattered are
 * centralized here, so Cure, regeneration, and generic vigor mutations do
 * not drift into different denial/cap behavior.
 */
export function gainVigor(
  state: EncounterState,
  actor: EncounterActor,
  amount: number,
  options: { uncapped?: boolean; ignoreDenial?: boolean } = {},
): number {
  if (actor.defeated || amount <= 0) return 0;
  if (!options.ignoreDenial && (hasFoeRotMark(state, actor) || encounterConditionSet(actor).has('shattered'))) return 0;
  const before = actor.vigor;
  const maximum = options.uncapped ? Number.MAX_SAFE_INTEGER : actor.vitality;
  actor.vigor = Math.min(maximum, actor.vigor + Math.max(0, amount));
  return actor.vigor - before;
}

/** A fully typed, state-derived damage request.  New command paths should
 * build this rather than recoding p.93 mitigation arithmetic. */
export interface EncounterDamageIntent {
  targetId: string;
  sourceActorId?: string;
  sourceRuleId: string;
  amount: number;
  damageType: Exclude<EncounterHeldDamage['damageType'], 'sacrifice'>;
  delivery: DamageDelivery;
  instance: number;
  ignoreCover: boolean;
  /** Piercing is not a global HP-routing rule.  This is present only for a
   * source whose text explicitly says the instance bypasses vigor (p.89
   * dangerous terrain, or divine damage's core rule). */
  bypassVigor?: boolean;
  /** Exact source exception to Armor; unlike Divine it preserves every
   * non-Armor mitigation path. */
  ignoreArmor?: boolean;
  /** Exact source exception to Defiance's application-time HP floor. It does
   * not bypass the generic `damage-immune` state: that state needs durable
   * origin provenance before a source can be allowed to bypass only Defiance. */
  ignoreDefiance?: boolean;
  /** True Strike's direct-damage exception to Dodge (ICON p.104). */
  ignoreDodge?: boolean;
  /** Basic attacks derive terrain cover directly; other rule mutations use
   * their target's persistent cover state until the spatial gateway exists. */
  covered?: boolean;
}

/**
 * Derive the final damage amount without mutating encounter state.  It is
 * shared by event construction and VM mutation application, which makes the
 * recorded event amount match replay's authoritative mitigation order.
 */
export function determineEncounterDamage(state: EncounterState, intent: EncounterDamageIntent): DeterminedDamage {
  const target = state.actors[intent.targetId];
  if (!target) return determineDamage({ amount: 0, damageType: intent.damageType, delivery: intent.delivery });
  const source = intent.sourceActorId ? state.actors[intent.sourceActorId] : undefined;
  const sourceConditions = source ? encounterConditionSet(source) : new Set<string>();
  const targetConditions = encounterConditionSet(target);
  const sourceDistance = source && source.onBattlefield && target.onBattlefield
    ? Math.max(Math.abs(source.position.x - target.position.x), Math.abs(source.position.y - target.position.y))
    : 0;
  return determineDamage({
    amount: intent.amount,
    damageType: intent.damageType,
    delivery: intent.delivery,
    sourceWeakened: sourceConditions.has('weakened'),
    sourcePacified: sourceConditions.has('pacified'),
    sourceHatredDiverts: hatredDivertsDamage(state, source, target),
    targetVulnerable: targetConditions.has('vulnerable'),
    targetArmor: target.armor,
    ignoreArmor: intent.ignoreArmor,
    targetResistance: targetConditions.has('resistance'),
    targetAetherwall: targetConditions.has('aetherwall') && sourceDistance > 2,
    targetCovered: intent.covered ?? target.ruleState.cover === true,
    targetIntangible: targetConditions.has('intangible'),
    targetDodge: targetConditions.has('dodge'),
    ignoreDodge: intent.ignoreDodge,
    targetDamageImmune: target.ruleState['damage-immune'] === true,
    ignoreCover: intent.ignoreCover,
    hostile: Boolean(source && source.side !== target.side),
  });
}

/**
 * Determine and immediately apply a source damage instance.  This is the
 * authoritative entry point for reducer/lifecycle damage whose event does
 * not already carry a final determined amount.  Only historical replay and
 * interrupt windows, which explicitly persist the post-mitigation amount,
 * may call {@link applyDeterminedEncounterDamage} directly.
 *
 * Keeping those two entry points separate is deliberate: treating a raw
 * source amount as determined skips p.93 reductions/halving, while
 * determining an already-recorded legacy amount applies them twice.
 *
 * TODO(ICON-rules, pp.93–107): replace the remaining split event formats
 * with a durable DamageIntent -> DeterminedDamage -> AppliedDamage ledger.
 * That ledger must persist trigger/window provenance before these immediate
 * paths can safely create or re-open interrupts during replay.
 */
export function determineAndApplyEncounterDamage(
  state: EncounterState,
  intent: EncounterDamageIntent,
  options: DamageReactionOptions = {},
): AppliedDamage | null {
  const target = state.actors[intent.targetId];
  if (!target || target.defeated) return null;
  const source = intent.sourceActorId ? state.actors[intent.sourceActorId] : undefined;
  const determination = determineEncounterDamage(state, intent);
  if (determination.amount <= 0) return null;
  return applyDeterminedEncounterDamage(state, target, source, {
    amount: determination.amount,
    damageType: intent.damageType,
    bypassVigor: intent.bypassVigor ?? intent.damageType === 'divine',
    ...(intent.ignoreDefiance ? { ignoreDefiance: true } : {}),
    sourceActorId: intent.sourceActorId ?? intent.sourceRuleId,
    sourceId: intent.sourceRuleId,
    instance: intent.instance,
    delivery: intent.delivery,
    ignoreCover: intent.ignoreCover,
  }, options);
}

/** ICON p.104 Counter: 2 damage back for each applied damage instance. The
 * retaliation does not itself trigger counter, so chains cannot recurse.
 *
 * TODO(ICON-rules, pp.104–107): invoke this only from a durable
 * DamageWindow that proves the source was damaged by an ability. The current
 * call-site compatibility behavior is deliberately not evidence that the
 * Counter source unit has complete trigger coverage. */
export function retaliate(state: EncounterState, attacker: EncounterActor, counterOwner?: EncounterActor) {
  if (!attacker || attacker.defeated || attacker.ruleState['damage-immune'] === true) return;
  determineAndApplyEncounterDamage(state, {
    targetId: attacker.id,
    sourceActorId: counterOwner?.id,
    sourceRuleId: 'core:counter',
    amount: 2,
    damageType: 'normal',
    instance: 1,
    delivery: 'effect',
    ignoreCover: true,
  // Counter suppresses only another Counter response. It remains a damage
  // instance, so other source-triggered reactions such as Gentleness still
  // see it (ICON p.179).
  }, { allowCounter: false });
}

/** ICON p.179 Gentleness: true when a gentleness-stance character's aura 1
 * covers `actor` (the aura includes the stance user themselves). */
export function inGentlenessAura(state: EncounterState, actor: EncounterActor): boolean {
  if (!actor.position) return false;
  return Object.values(state.actors).some((candidate) =>
    candidate.stance?.stanceId === 'gentleness' && !candidate.defeated && candidate.onBattlefield && candidate.position
    && Math.max(Math.abs(candidate.position.x - actor.position.x), Math.abs(candidate.position.y - actor.position.y)) <= 1);
}

/** ICON p.179 Gentleness: any character that deals damage while in the stance's
 * aura takes 1 divine damage (applied directly, so it cannot reflect again).
 * This remains raw source damage until it reaches the shared pipeline; divine
 * bypasses mitigation and vigor there rather than by a special local write. */
export function gentlenessReflection(state: EncounterState, attacker: EncounterActor) {
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

/** ICON p.104 Hatred of X: half damage to foes other than X. The hated target
 * is stored as ruleState['hatred-of'] when the status is applied. */
export function hatredDivertsDamage(state: EncounterState, source: EncounterActor | undefined, target: EncounterActor): boolean {
  if (!source || source.side === target.side || !encounterConditionSet(source).has('hatred')) return false;
  const hatedId = source.ruleState['hatred-of'];
  if (typeof hatedId !== 'string' || hatedId === target.id) return false;
  const hated = state.actors[hatedId];
  if (!hated || hated.defeated || !hated.onBattlefield || hated.ruleState['damage-immune'] === true) return false;
  return true;
}

/** ICON p.107: true when `actor` has an unused `when-damaged` interrupt
 * (damage determined but not yet applied, e.g. Righteous Disdain p.128) — the
 * gate that lets foe damage be held instead of applied immediately. Mirrors
 * the USE_ABILITY gates: one interrupt per turn, and the ability's per-round
 * uses must remain. */
function hasAvailableWhenDamagedInterrupt(actor: EncounterActor): boolean {
  if (actor.interruptUsedThisTurn) return false;
  for (const [interruptId, { usesPerRound }] of Object.entries(WHEN_DAMAGED_INTERRUPT_IDS)) {
    if (actor.abilityIds.includes(interruptId) && (actor.interruptUses[interruptId] ?? 0) < usesPerRound) return true;
  }
  return false;
}

/** ICON p.107/p.138: true when `actor` has an unused `defeated` interrupt
 * (Boiling Blood) — the gate that holds a lethal foe blow so the interrupt can
 * resolve before the character is defeated. Mirrors the USE_ABILITY gates. */
function hasAvailableDefeatedInterrupt(actor: EncounterActor): boolean {
  if (actor.interruptUsedThisTurn) return false;
  for (const [interruptId, { usesPerRound }] of Object.entries(DEFEATED_INTERRUPT_IDS)) {
    if (actor.abilityIds.includes(interruptId) && (actor.interruptUses[interruptId] ?? 0) < usesPerRound) return true;
  }
  return false;
}

/** The effect mutations of a deferred ability: costs (actions, resource spends)
 * pay immediately; only the effects ride the window. */
function deferredEffects(mutations: RuleMutation[]): RuleMutation[] {
  return mutations.filter((mutation) => mutation.kind !== 'actions' && !(mutation.kind === 'resource' && mutation.operation === 'spend'));
}

/** True when the interrupt's per-round uses remain and the one-per-turn gate
 * is open, mirroring the USE_ABILITY checks. */
function interruptAvailable(actor: EncounterActor, abilityId: string, usesPerRound: number): boolean {
  return !actor.interruptUsedThisTurn && actor.abilityIds.includes(abilityId) && (actor.interruptUses[abilityId] ?? 0) < usesPerRound;
}

/** ICON p.107 — the deferred-trigger window for abilities that have not
 * resolved yet. Returns the window, or null when no armed interrupt covers
 * the event:
 * - `uses-ability` (p.122 Heroic Intervention): a foe's ability targets the
 *   armored ally of a character in the armed stance;
 * - `area-inclusion` (p.123 Perseus): an ally's area effect includes the
 *   character, who can become immune before it lands;
 * - `targeted-by-ability` (p.151 Masquerade): a character uses an ability
 *   against the Masquerade user, who swaps with a willing ally in range 3 and
 *   redirects the ability to that ally.
 * All three hold the ability's effect mutations (costs are paid by the
 * caller) until the interrupt resolves; Masquerade's window carries the
 * redirect so the effects retarget when they resolve. */
export function deferrableEffectWindow(
  state: EncounterState,
  sourceActorId: string,
  mutations: RuleMutation[],
): EncounterPendingInterrupt | null {
  const source = state.actors[sourceActorId];
  if (!source) return null;
  // 1. Heroic Intervention — a foe ability targeting the armored ally.
  if (source.side === 'foes') {
    for (const candidate of Object.values(state.actors)) {
      if (candidate.side === source.side || candidate.defeated || !candidate.stance) continue;
      const entry = USES_ABILITY_INTERRUPT_IDS[candidate.stance.stanceId];
      if (!entry || !interruptAvailable(candidate, entry.programId, entry.usesPerRound)) continue;
      const allyId = typeof candidate.stance.state.allyId === 'string' ? candidate.stance.state.allyId : undefined;
      if (!allyId || allyId === candidate.id) continue;
      const ally = state.actors[allyId];
      if (!ally || !ally.position || !candidate.position || Math.max(Math.abs(candidate.position.x - ally.position.x), Math.abs(candidate.position.y - ally.position.y)) > 4) continue;
      if (!mutations.some((mutation) => 'actorId' in mutation && mutation.actorId === allyId)) continue;
      return {
        id: `uses-ability:${allyId}:${state.revision}:${state.pendingInterrupts.length}`,
        actorId: candidate.id,
        trigger: 'uses-ability',
        triggeredAt: state.revision,
        order: state.pendingInterrupts.length,
        heldEffects: deferredEffects(mutations),
      };
    }
  }
  // 2. Perseus — an allied area effect includes the character.
  if (source.side === 'heroes') {
    for (const candidate of Object.values(state.actors)) {
      if (candidate.side !== 'heroes' || candidate.id === source.id || candidate.defeated) continue;
      if (!interruptAvailable(candidate, 'bastion:perseus', AREA_INCLUSION_INTERRUPT_IDS['bastion:perseus']!.usesPerRound)) continue;
      if (!mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === candidate.id && mutation.delivery === 'area')) continue;
      return {
        id: `area-inclusion:${candidate.id}:${state.revision}:${state.pendingInterrupts.length}`,
        actorId: candidate.id,
        trigger: 'area-inclusion',
        triggeredAt: state.revision,
        order: state.pendingInterrupts.length,
        heldEffects: deferredEffects(mutations),
      };
    }
  }
  // 3. Masquerade — a character uses an ability against the user, who swaps
  // with a willing ally in range 3; the ability is redirected to that ally.
  for (const candidate of Object.values(state.actors)) {
    if (candidate.side !== 'heroes' || candidate.id === source.id || candidate.defeated || !candidate.position) continue;
    if (!interruptAvailable(candidate, 'fool:masquerade', TARGETED_BY_ABILITY_INTERRUPT_IDS['fool:masquerade']!.usesPerRound)) continue;
    if (!mutations.some((mutation) => (mutation.kind === 'damage' || mutation.kind === 'condition' || mutation.kind === 'mark') && mutation.actorId === candidate.id)) continue;
    // When a foe's damage to this candidate will already be held by the
    // damage pipeline (when-damaged/defeated), that window wins: it is the
    // more specific p.107 mechanism for the same blow, and this interrupt's
    // redirect would otherwise hijack it.
    const foeDamage = mutations.find((mutation) => mutation.kind === 'damage' && mutation.actorId === candidate.id) as Extract<RuleMutation, { kind: 'damage' }> | undefined;
    if (source.side === 'foes' && foeDamage && (hasAvailableWhenDamagedInterrupt(candidate)
      || (hasAvailableDefeatedInterrupt(candidate) && (foeDamage.damageType === 'divine' ? foeDamage.amount >= candidate.hp : foeDamage.amount >= candidate.vigor + candidate.hp)))) continue;
    // A willing ally in range 3 is required to swap with.
    const ally = Object.values(state.actors).find((other) => other.side === 'heroes' && other.id !== candidate.id && !other.defeated && other.position
      && Math.max(Math.abs(other.position.x - candidate.position.x), Math.abs(other.position.y - candidate.position.y)) <= 3);
    if (!ally) continue;
    return {
      id: `targeted-by-ability:${candidate.id}:${state.revision}:${state.pendingInterrupts.length}`,
      actorId: candidate.id,
      trigger: 'targeted-by-ability',
      triggeredAt: state.revision,
      order: state.pendingInterrupts.length,
      heldEffects: deferredEffects(mutations),
      retarget: { fromActorId: candidate.id, toActorId: ally.id },
    };
  }
  return null;
}

/** ICON p.107/p.143: when a foe adjacent to a character with an available
 * save-reroll interrupt (Sucker Punch) rolls a save, the save's branch — the
 * save record plus the outcome effects generated for the rolled result — is
 * held in a `save-rolled` window until the interrupt re-rolls it. Only saves
 * generated from a program effect carry the `reroll` AST; resolver-rolled
 * saves (recover, diaga) cannot be re-rolled. */
export function saveRerollWindow(
  state: EncounterState,
  sourceActorId: string,
  mutations: RuleMutation[],
): EncounterPendingInterrupt | null {
  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index];
    if (mutation.kind !== 'save' || !mutation.reroll) continue;
    const saver = state.actors[mutation.actorId];
    if (!saver || saver.side !== 'foes' || !saver.position) continue;
    for (const candidate of Object.values(state.actors)) {
      if (candidate.side !== 'heroes' || candidate.defeated || !candidate.position) continue;
      if (!interruptAvailable(candidate, 'knave:sucker-punch', SAVE_REROLL_INTERRUPT_IDS['knave:sucker-punch']!.usesPerRound)) continue;
      if (Math.max(Math.abs(candidate.position.x - saver.position.x), Math.abs(candidate.position.y - saver.position.y)) > 1) continue;
      // The save's branch runs from the save record to the next save record.
      let end = index + 1;
      while (end < mutations.length && mutations[end]!.kind !== 'save') end += 1;
      return {
        id: `save-rolled:${saver.id}:${state.revision}:${state.pendingInterrupts.length}`,
        actorId: candidate.id,
        trigger: 'save-rolled',
        triggeredAt: state.revision,
        order: state.pendingInterrupts.length,
        heldSave: {
          targetId: saver.id,
          boon: mutation.reroll.boon,
          sourceId: mutation.sourceId,
          sourceActorId,
          onSuccess: mutation.reroll.onSuccess,
          onFailure: mutation.reroll.onFailure,
        },
        heldEffects: mutations.slice(index, end),
      };
    }
  }
  return null;
}

/** Apply fully-determined damage (all mitigation already resolved) to the
 * target, including defeat, defiance, counter, and reaction hooks. Shared by
 * direct event replay and the held-damage re-application, so a held blow
 * produces exactly the effects it would have produced immediately.
 *
 * Damage-window creation stays in `applyDamage`: replayed core events do not
 * have enough provenance yet to safely open a new interrupt window.  The
 * TODO in `rules-foundations.md` tracks upgrading those events to a full
 * DamageIntent ledger. */
/**
 * These switches intentionally name each reaction separately.  A single
 * `reactions: false` flag made Counter accidentally disable Gentleness for
 * the same source damage instance. Add a new reaction here only with a
 * source-specific recursion decision and a cross-reaction fixture.
 */
export interface DamageReactionOptions {
  allowCounter?: boolean;
  allowGentleness?: boolean;
}

export function applyDeterminedEncounterDamage(
  state: EncounterState,
  target: EncounterActor,
  source: EncounterActor | undefined,
  damage: EncounterHeldDamage,
  options: DamageReactionOptions = {},
): AppliedDamage | null {
  const { amount, damageType } = damage;
  const bypassVigor = damage.bypassVigor ?? damageType === 'divine';
  if (amount <= 0 || target.defeated || target.ruleState['damage-immune'] === true) return null;
  const targetConditions = encounterConditionSet(target);
  const wouldDefeatWithoutDefiance = bypassVigor
    ? amount >= target.hp
    : amount >= target.vigor + target.hp;
  const defiance = !damage.ignoreDefiance && targetConditions.has('defiance') && damageType !== 'divine' && wouldDefeatWithoutDefiance;
  // ICON p.138 Defy Death and p.104 Defiance both impose an application-time
  // HP floor. They are intentionally not folded into mitigation arithmetic.
  const applied = applyDeterminedDamageToVitals(target, {
    amount,
    bypassVigor,
    minimumHp: defyDeathActive(target) || defiance ? 1 : 0,
  });
  target.hp = applied.hp;
  target.vigor = applied.vigor;
  if (applied.amountApplied <= 0) return applied;
  if (source && source.side !== target.side) target.statuses = target.statuses.filter((status) => status !== 'pacified');
  if (defiance) {
    target.conditions = target.conditions.filter(({ id }) => id !== 'defiance');
    target.ruleState['damage-immune'] = true;
    target.ruleStateOwners['damage-immune'] = source?.id ?? null;
  } else if (target.hp <= 0) defeatActor(state, target);
  if (options.allowCounter !== false && source && source.side !== target.side && targetConditions.has('counter')) retaliate(state, source, target);
  // ICON p.178 Aria: foe damage while the performance is pending grows the
  // blast from small to medium to large at the start of the user's next turn.
  if (target.ruleState['aria:pending'] === true && source && source.side !== target.side) {
    target.ruleState['aria:damaged'] = Number(target.ruleState['aria:damaged'] ?? 0) + 1;
    target.ruleStateOwners['aria:damaged'] ??= null;
  }
  // ICON p.179 Chastise: a marked foe that damages a chosen character with an
  // ability triggers its retribution (dealt at the end of its turn).
  if (source && source.side === 'foes') {
    const retribution = source.marks.find((mark) => mark.markId === 'chastise-retribution');
    if (retribution) {
      const chosen: string[] = typeof retribution.state.chosen === 'string' ? JSON.parse(retribution.state.chosen) as string[] : [];
      if (chosen.includes(target.id)) retribution.state.triggered = true;
    }
  }
  // ICON p.179 Gentleness: a character that deals damage while in the stance's
  // aura takes 1 divine damage. Applied directly (mirroring Counter) so the
  // reflection cannot recurse.
  if (options.allowGentleness !== false && source && source.id !== target.id) gentlenessReflection(state, source);
  return applied;
}

/** ICON p.107: apply a window's held damage — the final mitigated amount that
 * was determined before the window opened — when its interrupt resolves, or at
 * the end of the turn when no interrupt answers it. The damage is prevented
 * (skipped) if the target became immune or was defeated while the window was
 * open, exactly as an immediate blow would have been. */
export function applyHeldDamage(state: EncounterState, targetId: string, held: EncounterHeldDamage) {
  const target = state.actors[targetId];
  const source = state.actors[held.sourceActorId];
  if (!target || target.defeated || target.ruleState['damage-immune'] === true) return;
  applyDeterminedEncounterDamage(state, target, source, held);
}

function applyDamage(state: EncounterState, mutation: Extract<RuleMutation, { kind: 'damage' }>) {
  const target = state.actors[mutation.actorId];
  const source = state.actors[mutation.sourceActorId];
  if (!target || target.defeated) return;
  if (mutation.damageType === 'sacrifice') {
    const applied = applyDeterminedDamageToVitals(target, {
      amount: mutation.amount,
      bypassVigor: true,
      minimumHp: 1,
    });
    target.hp = applied.hp;
    target.vigor = applied.vigor;
    return;
  }
  const determination = determineEncounterDamage(state, {
    targetId: target.id,
    sourceActorId: source?.id,
    sourceRuleId: mutation.sourceId,
    amount: mutation.amount,
    damageType: mutation.damageType,
    delivery: mutation.delivery,
    instance: mutation.instance,
    ignoreCover: mutation.ignoreCover,
    ignoreDodge: mutation.ignoreDodge,
    ignoreArmor: mutation.ignoreArmor,
  });
  const amount = determination.amount;
  if (amount <= 0) return;
  const bypassVigor = mutation.bypassVigor ?? mutation.damageType === 'divine';
  // ICON p.107: damage from a foe is held while the target has an available
  // when-damaged interrupt — the damage is determined but not applied yet, and
  // the interrupt resolves before it applies (p.128 Righteous Disdain). A
  // lethal blow is also held when the target has an available `defeated`
  // interrupt (Boiling Blood, p.138) so the character can fight on before
  // being defeated. The held damage applies after the interrupt resolves, or
  // at the end of the turn; an interrupt that re-deals the damage consumes it.
  const whenDamagedAvailable = hasAvailableWhenDamagedInterrupt(target);
  const defeatedAvailable = hasAvailableDefeatedInterrupt(target) && (bypassVigor ? amount >= target.hp : amount >= target.vigor + target.hp);
  if (amount > 0 && source && source.side !== target.side && state.pendingInterrupts && (whenDamagedAvailable || defeatedAvailable)) {
    state.pendingInterrupts.push({
      id: `when-damaged:${target.id}:${state.revision}:${state.pendingInterrupts.length}`,
      actorId: target.id,
      // The more specific trigger wins: when-damaged (the blow is determined
      // but not applied) before defeated (the blow would defeat the target).
      trigger: whenDamagedAvailable ? 'when-damaged' : 'defeated',
      triggeredAt: state.revision,
      order: state.pendingInterrupts.length,
      heldDamage: {
        amount,
        damageType: mutation.damageType,
        bypassVigor,
        sourceActorId: mutation.sourceActorId,
        sourceId: mutation.sourceId,
        instance: mutation.instance,
        delivery: mutation.delivery,
        ignoreCover: mutation.ignoreCover,
        ...(mutation.ignoreDodge ? { ignoreDodge: true } : {}),
        ...(mutation.ignoreDefiance ? { ignoreDefiance: true } : {}),
      },
    });
    return;
  }
  applyDeterminedEncounterDamage(state, target, source, {
    amount,
    damageType: mutation.damageType,
    bypassVigor,
    sourceActorId: mutation.sourceActorId,
    sourceId: mutation.sourceId,
    instance: mutation.instance,
    delivery: mutation.delivery,
    ignoreCover: mutation.ignoreCover,
    ...(mutation.ignoreDodge ? { ignoreDodge: true } : {}),
    ...(mutation.ignoreDefiance ? { ignoreDefiance: true } : {}),
  });
  // ICON p.107: damage dealt opens a 'when-damaged' interrupt window for the
  // target. Windows resolve most-recently-triggered first (LIFO by encounter
  // revision) and close at the end of the turn.
  if (amount > 0 && !target.defeated && state.pendingInterrupts) {
    state.pendingInterrupts.push({
      id: `when-damaged:${target.id}:${state.revision}:${state.pendingInterrupts.length}`,
      actorId: target.id,
      trigger: 'when-damaged',
      triggeredAt: state.revision,
      order: state.pendingInterrupts.length,
    });
  }
}

/** Resolve a declarative shove/rush (no explicit destination) to its final
 * position. A shove/rush without a client-supplied direction moves away from
 * the mutation's source actor along the dominant axis, and stops when the next
 * space is blocked — a grid edge, another living character, or impassable
 * terrain. Returns null when the mutation does not describe a directional
 * push, and reports whether the push collided with an obstruction (ICON
 * p.95 Collide) so the reducer can derive the trigger without a second rules
 * implementation. */
function shoveResolution(state: EncounterState, mutation: Extract<RuleMutation, { kind: 'move' }>): { position: Position; collided: boolean } | null {
  const actor = state.actors[mutation.actorId];
  if (!actor || actor.defeated || encounterConditionSet(actor).has('immobile')) return null;
  let direction = mutation.direction;
  if (!direction && mutation.distance && mutation.sourceActorId !== actor.id) {
    const source = state.actors[mutation.sourceActorId];
    if (source?.position) {
      const dx = actor.position.x - source.position.x;
      const dy = actor.position.y - source.position.y;
      direction = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    }
  }
  if (!direction || !mutation.distance) return null;
  const maximum = encounterConditionSet(actor).has('sturdy') && state.actors[mutation.sourceActorId]?.side !== actor.side ? Math.min(1, mutation.distance) : mutation.distance;
  let position = { ...actor.position };
  let collided = false;
  for (let step = 0; step < maximum; step += 1) {
    const next = { x: position.x + Math.sign(direction.x), y: position.y + Math.sign(direction.y) };
    const obstructed = next.x < 0 || next.y < 0 || next.x >= state.grid.width || next.y >= state.grid.height
      || Object.values(state.actors).some((candidate) => candidate.id !== actor.id && candidate.onBattlefield && !candidate.defeated && samePosition(candidate.position, next))
      || state.grid.terrain.some((cell) => samePosition(cell.position, next) && cell.type === 'impassable');
    if (obstructed) {
      collided = true;
      break;
    }
    position = next;
  }
  return { position, collided };
}

function applyMovement(state: EncounterState, mutation: Extract<RuleMutation, { kind: 'move' }>): boolean {
  const actor = state.actors[mutation.actorId];
  if (!actor || actor.defeated || encounterConditionSet(actor).has('immobile')) return false;
  const beforePosition = { ...actor.position };
  const beforeBattlefield = actor.onBattlefield;
  const moved = () => beforeBattlefield !== actor.onBattlefield || !samePosition(beforePosition, actor.position);
  if (mutation.movement === 'remove') {
    actor.onBattlefield = false;
    return moved();
  }
  if (mutation.movement === 'place') {
    // TODO(ICON-rules, pp.87–90, 107): replace these local destination paths
    // with a shared SpatialIntent gateway (bounds, occupancy, footprint,
    // rampart, hostile movement, line of effect, and source-specific choice).
    // Placement is forced movement (a throw, a summon), not a teleport, so
    // Rampart (p.104, which blocks dashing, flying, and teleporting only)
    // does not apply.
    const destination = mutation.positions.at(-1);
    if (destination) {
      actor.position = { ...destination };
      actor.onBattlefield = true;
    }
    return moved();
  }
  if (mutation.movement === 'teleport') {
    const destination = mutation.positions.at(-1);
    if (destination) {
      // Rampart: foes cannot enter or exit affected spaces by teleporting.
      const fromRampart = rampartObstructs(state, actor, actor.position);
      const toRampart = rampartObstructs(state, actor, destination);
      if (fromRampart === toRampart) {
        actor.position = { ...destination };
        actor.onBattlefield = true;
      }
    }
    return moved();
  }
  if (mutation.positions.length > 0) {
    actor.position = { ...mutation.positions.at(-1)! };
    actor.onBattlefield = true;
    return moved();
  }
  const resolved = shoveResolution(state, mutation);
  if (resolved) actor.position = resolved.position;
  return moved();
}

/**
 * ICON p.104 Slashed is a post-move damage trigger only when the moved
 * character or an ally used an ability to move them. Core Move/Dash do not
 * enter here: they are reducer commands, not ability mutations.
 *
 * TODO(ICON-rules, pp.94, 107): when a durable MoveIntent exists, attach the
 * source ability and trigger-window record there. Until then this is the sole
 * source-side gate; do not reintroduce Slashed in the generic movement planner
 * or infer it from position changes elsewhere.
 */
function applySlashedAfterAbilityMove(
  state: EncounterState,
  mutation: Extract<RuleMutation, { kind: 'move' }>,
  moved: boolean,
) {
  if (!moved) return;
  const actor = state.actors[mutation.actorId];
  const source = state.actors[mutation.sourceActorId];
  // Conditions are the canonical durable representation; `statuses` is a
  // compatibility projection for legacy/core consumers and may be absent on
  // a valid hydrated snapshot.
  if (!actor || !actor.onBattlefield || actor.defeated || actor.slashedTriggeredThisTurn || !encounterConditionSet(actor).has('slashed')) return;
  if (!source || source.side !== actor.side) return;
  determineAndApplyEncounterDamage(state, {
    targetId: actor.id,
    sourceRuleId: 'core:slashed',
    amount: 4,
    damageType: 'normal',
    instance: 1,
    delivery: 'effect',
    ignoreCover: true,
  });
  actor.slashedTriggeredThisTurn = true;
}

export function applyRuleMutation(state: EncounterState, mutation: RuleMutation, mutationIndex: number) {
  switch (mutation.kind) {
    case 'attack': break;
    case 'damage': applyDamage(state, mutation); break;
    case 'heal': {
      const actor = state.actors[mutation.actorId];
      if (actor && !actor.defeated) actor.hp = Math.min(mutation.maximum ?? Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality), actor.hp + mutation.amount);
      break;
    }
    case 'vigor': {
      const actor = state.actors[mutation.actorId];
      if (actor) gainVigor(state, actor, mutation.amount, { uncapped: mutation.uncapped });
      break;
    }
    case 'condition': {
      const actor = state.actors[mutation.actorId];
      if (!actor || actor.defeated) break;
      const source = state.actors[mutation.sourceActorId];
      if (mutation.operation === 'apply' && source && encounterConditionSet(source).has('sealed') && statusIds.has(mutation.conditionId as StatusId)) break;
      if (mutation.operation === 'apply' && source && source.side !== actor.side && encounterConditionSet(actor).has('unstoppable') && statusIds.has(mutation.conditionId as StatusId)) break;
      if (mutation.operation === 'remove') {
        actor.statuses = actor.statuses.filter((status) => status !== mutation.conditionId);
        actor.conditions = actor.conditions.filter(({ id }) => id !== mutation.conditionId);
        if (mutation.conditionId === 'hatred') {
          delete actor.ruleState['hatred-of'];
          delete actor.ruleStateOwners['hatred-of'];
        }
      } else if (statusIds.has(mutation.conditionId as StatusId)) {
        if (!actor.statuses.includes(mutation.conditionId as StatusId)) actor.statuses.push(mutation.conditionId as StatusId);
        if (mutation.potency === 'plus') actor.conditions.push({ id: mutation.conditionId, sourceId: mutation.sourceId, ownerId: mutation.sourceActorId, potency: 'plus', duration: mutation.duration ?? null });
        // Hatred of X carries its target X as provenance so the damage
        // pipeline can halve damage against every foe other than X.
        if (mutation.conditionId === 'hatred') {
          actor.ruleState['hatred-of'] = mutation.sourceActorId;
          actor.ruleStateOwners['hatred-of'] = mutation.sourceActorId;
        }
      } else if (!actor.conditions.some(({ id, sourceId }) => id === mutation.conditionId && sourceId === mutation.sourceId)) {
        actor.conditions.push({ id: mutation.conditionId, sourceId: mutation.sourceId, ownerId: mutation.sourceActorId, potency: mutation.potency, duration: mutation.duration ?? null });
      }
      break;
    }
    case 'cure': {
      const actor = state.actors[mutation.actorId];
      // The lifecycle-only Aria/Chastise reducer calls intentionally retain
      // their existing no-dice behavior; command-time Cure emits its saves
      // through status-saves.ts.  Both use this shared authoritative denial
      // and wounded-max-HP vigor calculation.  Shattered independently bars
      // vigor (p.104), but its normal-status save still follows this mutation.
      if (actor && !actor.defeated && !encounterStatusSavePolicy(state, actor).cureDenied) {
        const maximumHp = Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality);
        gainVigor(state, actor, actor.hp <= maximumHp / 2 ? actor.vitality : 4);
      }
      break;
    }
    case 'move': {
      const moved = applyMovement(state, mutation);
      applySlashedAfterAbilityMove(state, mutation, moved);
      break;
    }
    case 'resource': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      const current = actor.resources[mutation.resourceId] ?? 0;
      const raw = mutation.operation === 'set' ? mutation.amount : mutation.operation === 'spend' || mutation.operation === 'tick-down' ? current - mutation.amount : current + mutation.amount;
      // The shared-resource registry caps gains (e.g. one combo token at once,
      // p.103) unless the mutation itself declares a higher ceiling.
      const ceiling = mutation.maximum ?? resourceMaximum(mutation.resourceId) ?? Number.MAX_SAFE_INTEGER;
      actor.resources[mutation.resourceId] = Math.max(mutation.minimum ?? 0, Math.min(ceiling, raw));
      break;
    }
    case 'actions': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      actor.actionsRemaining = mutation.operation === 'set' ? mutation.amount : mutation.operation === 'spend' ? Math.max(0, actor.actionsRemaining - mutation.amount) : actor.actionsRemaining + mutation.amount;
      break;
    }
    case 'terrain': {
      if (mutation.operation === 'remove') state.terrainEffects = state.terrainEffects.filter((effect) => effect.terrain !== mutation.terrain || !effect.positions.some((position) => mutation.positions.some((candidate) => samePosition(position, candidate))));
      else {
        const effect: EncounterTerrainEffect = { id: generatedId(state, mutation.sourceId, mutationIndex, 'terrain'), sourceId: mutation.sourceId, ownerId: mutation.sourceActorId, terrain: mutation.terrain, positions: clone(mutation.positions), height: mutation.height, duration: mutation.duration ?? null };
        state.terrainEffects.push(effect);
      }
      break;
    }
    case 'entity': {
      if (mutation.operation === 'remove') {
        for (const [id, entity] of Object.entries(state.entities)) if (entity.type === mutation.entityType && entity.ownerId === mutation.ownerId) delete state.entities[id];
      } else {
        const entity: EncounterEntity = { id: generatedId(state, mutation.sourceId, mutationIndex, 'entity'), type: mutation.entityType, ownerId: mutation.ownerId, positions: clone(mutation.positions), state: { ...mutation.state }, duration: mutation.duration ?? null };
        state.entities[entity.id] = entity;
      }
      break;
    }
    case 'mark': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'remove') actor.marks = actor.marks.filter(({ markId }) => markId !== mutation.markId);
      else {
        actor.marks = actor.marks.filter(({ ownerId }) => ownerId !== mutation.ownerId);
        actor.marks.push({ id: generatedId(state, mutation.sourceId, mutationIndex, 'mark'), sourceId: mutation.sourceId, ownerId: mutation.ownerId, markId: mutation.markId, duration: mutation.duration ?? null, state: { ...mutation.state } });
        // TODO(ICON-rules, p.186): interpret reviewed Rot `noDefiance` and
        // ally Regenerate effects through an explicit source-ID passive
        // projection. Never make arbitrary mark state mechanically active.
      }
      break;
    }
    case 'stance': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'exit') actor.stance = null;
      else actor.stance = { id: generatedId(state, mutation.sourceId, mutationIndex, 'stance'), sourceId: mutation.sourceId, ownerId: mutation.sourceActorId, stanceId: mutation.stanceId, state: { ...mutation.state } };
      break;
    }
    case 'persistent': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'remove') actor.activeEffects = actor.activeEffects.filter(({ effectId }) => effectId !== mutation.effectId);
      else actor.activeEffects.push({ id: generatedId(state, mutation.sourceId, mutationIndex, 'effect'), sourceId: mutation.sourceId, effectId: mutation.effectId, ownerId: mutation.ownerId, duration: mutation.duration, modifiers: clone(mutation.modifiers), triggers: [...mutation.triggers], state: { ...mutation.state } });
      break;
    }
    case 'modifier': {
      const actor = state.actors[mutation.actorId];
      if (actor) actor.activeEffects.push({ id: generatedId(state, mutation.sourceId, mutationIndex, 'modifier'), sourceId: mutation.sourceId, effectId: `modifier:${mutation.modifier.stat}`, ownerId: mutation.ownerId, duration: mutation.duration, modifiers: [clone(mutation.modifier)], triggers: [], state: {} });
      break;
    }
    case 'save': break;
    case 'defeat': {
      const actor = state.actors[mutation.actorId];
      if (actor) defeatActor(state, actor);
      break;
    }
    case 'phase': {
      const actor = state.actors[mutation.actorId];
      if (actor) {
        actor.ruleState.phaseId = mutation.phaseId;
        actor.ruleStateOwners.phaseId = mutation.sourceActorId;
      }
      break;
    }
    case 'end-turn': {
      const actor = state.actors[mutation.actorId];
      if (actor) {
        actor.ruleState['end-turn-requested'] = true;
        actor.ruleStateOwners['end-turn-requested'] = mutation.sourceActorId;
      }
      break;
    }
    case 'state': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'clear') {
        delete actor.ruleState[mutation.key];
        delete actor.ruleStateOwners[mutation.key];
      } else if (mutation.operation === 'increment') {
        actor.ruleState[mutation.key] = Number(actor.ruleState[mutation.key] ?? 0) + Number(mutation.value ?? 1);
        actor.ruleStateOwners[mutation.key] = mutation.sourceActorId;
      } else {
        actor.ruleState[mutation.key] = mutation.value ?? null;
        actor.ruleStateOwners[mutation.key] = mutation.sourceActorId;
      }
      break;
    }
  }
}

export function applyRuleMutations(state: EncounterState, mutations: RuleMutation[]) {
  mutations.forEach((mutation, index) => applyRuleMutation(state, mutation, index));
}

/**
 * Predict the reactive triggers a mutation list will produce when applied
 * (ICON p.95): `collide` when a shove stops against an obstruction, and
 * `slay` when any character is reduced to 0 HP. The dry run applies to a
 * clone of the state so no live encounter data is touched and no dice are
 * consumed — mutation application is deterministic.
 */
export function reactiveRuleTriggers(state: EncounterState, mutations: RuleMutation[]): Set<'collide' | 'slay'> {
  const reactive = new Set<'collide' | 'slay'>();
  const simulation = structuredClone(state);
  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index];
    if (mutation.kind === 'move' && mutation.movement === 'shove' && mutation.positions.length === 0 && mutation.distance !== null) {
      if (shoveResolution(simulation, mutation)?.collided) reactive.add('collide');
    }
    applyRuleMutation(simulation, mutation, index);
  }
  for (const [id, actor] of Object.entries(simulation.actors)) {
    const before = state.actors[id];
    if (before && !before.defeated && actor.defeated) reactive.add('slay');
  }
  return reactive;
}
