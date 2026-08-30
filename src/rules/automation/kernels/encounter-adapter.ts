import type { EncounterActor, EncounterEntity, EncounterHeldDamage, EncounterPendingInterrupt, EncounterState, EncounterTerrainEffect, Position, StatusId } from '../../types.js';
import { seededDice } from '../../dice.js';
import { resourceMaximum } from '../../core.js';
import { applyDeterminedDamageToVitals, determineDamage, type AppliedDamage, type DamageDelivery, type DeterminedDamage } from '../primitives/damage-resolution.js';
import { projectedAuraSelfGrants, projectedMarkConditionGrants, projectedMarkConditionPotencies, projectedMarkConditionSuppressions, projectedPassiveConditions, projectedRoleConditions } from './passive-projection.js';
import { auraEffectRadius, auraStateView, projectedAuraArmorBonus, projectedAuraConditions, projectedAuraConditionPotencies } from './aura.js';
import { projectedHpThresholdConditions } from './hp-threshold.js';
import type { RangeStateView } from './range.js';
import type { AreaStateView } from './area.js';
import { effectiveInterruptRank, hasUnlimitedRange, type MasteryFoldActorView, type MasteryFoldStateView } from './mastery-fold.js';
import { applySpatialIntent, footprintCells, footprintDistance, footprintsOverlap, type SpatialIntent } from '../primitives/spatial-intent.js';
import { decideDamageWindow, openDamageWindow } from './trigger-window.js';
import { entityKind, entityKindOf, validateEntityCreation } from './entity-creation.js';
import type { RuleActorView, RuleExecutionContext, RuleMutation, RuleRuntimeState } from '../primitives/types.js';

const statusIds = new Set<StatusId>(['slashed', 'blind', 'dazed', 'hatred', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable']);
const samePosition = (first: Position, second: Position) => first.x === second.x && first.y === second.y;
const clone = <T>(value: T): T => structuredClone(value);

// ---------------------------------------------------------------------------
// Content hook registries (content/ registers source-specific behavior into
// the engine here; this module contains no source IDs of its own).
// ---------------------------------------------------------------------------

/** A defeat guard: while a registered guard is active for an actor, the
 * damage/defeat pipeline floors them at 1 hp instead of defeating them
 * (Boiling Blood's defy-death, content/jobs). */
export interface DefeatGuard {
  sourceId: string;
  active(actor: EncounterActor): boolean;
}
const defeatGuards: DefeatGuard[] = [];
/** Register a defeat guard (content/jobs/encounter-hooks.ts). */
export function registerDefeatGuard(guard: DefeatGuard): void {
  defeatGuards.push(guard);
}

/** A vigor denial source: while a registered source denies vigor for an
 * actor, Cure/regeneration/generic vigor grants do nothing to them
 * (Rot's hostile-cure block, content/jobs). */
export interface VigorDenialSource {
  sourceId: string;
  denies(state: EncounterState, actor: EncounterActor): boolean;
}
const vigorDenialSources: VigorDenialSource[] = [];
/** Register a vigor denial source (content/jobs/encounter-hooks.ts). */
export function registerVigorDenialSource(source: VigorDenialSource): void {
  vigorDenialSources.push(source);
}

/** A status-save policy source: mutates the projected policy for an actor
 * (Rot's save curse + cure denial, Sweet Torment's cure/status-save denial,
 * content/jobs). */
export interface StatusSavePolicySource {
  sourceId: string;
  modify(state: EncounterState, actor: EncounterActor, policy: RuleActorView['statusSavePolicy']): void;
}
const statusSavePolicySources: StatusSavePolicySource[] = [];
/** Register a status-save policy source (content/jobs/encounter-hooks.ts). */
export function registerStatusSavePolicySource(source: StatusSavePolicySource): void {
  statusSavePolicySources.push(source);
}

/** An armor bonus source: adds flat armor for a target (the Heavy role
 * baseline's Guard armor 2, content/foes). */
export interface ArmorBonusSource {
  sourceId: string;
  bonus(state: EncounterState, target: EncounterActor): number;
}
const armorBonusSources: ArmorBonusSource[] = [];
/** Register an armor bonus source (content/foes/role-baseline-recipes.ts). */
export function registerArmorBonusSource(source: ArmorBonusSource): void {
  armorBonusSources.push(source);
}

/** An on-damage-dealt hook: runs after an applied damage instance, for the
 * source-specific records and reflections the damage tail must preserve
 * (Gentleness reflection, Aria's pending-damage count, Chastise retribution
 * trigger, content/jobs). The `options` carry the caller's reaction gates
 * (e.g. allowGentleness), which a hook must honor. */
export interface OnDamageDealtHook {
  sourceId: string;
  apply(state: EncounterState, source: EncounterActor | undefined, target: EncounterActor, damage: AppliedDamage, options: DamageReactionOptions): void;
}
const onDamageDealtHooks: OnDamageDealtHook[] = [];
/** Register an on-damage-dealt hook (content/jobs/encounter-hooks.ts). */
export function registerOnDamageDealtHook(hook: OnDamageDealtHook): void {
  onDamageDealtHooks.push(hook);
}

/**
 * The full projected condition set of an actor. When `state` is supplied, it
 * additionally folds the continuous aura-membership projection
 * (`projectedAuraConditions`): an actor has an aura's conditions only while
 * it is currently inside the aura, so every consumer sees the same set and
 * movement immediately adds/removes the projection. Reducer paths always
 * pass the encounter state; the actor-only form is kept for tests and for
 * contexts without a spatial state (no aura is projected there).
 */
/** Adapt the reducer state to the range kernel's read surface (the same
 * positions/sizes/mastery the encounter authority carries, so the effective
 * ability range and the distance predicates are evaluated from authoritative
 * command-time state). */
export function rangeStateView(state: EncounterState, selectedTalentSourceIds?: ReadonlySet<string>): RangeStateView {
  const actors: RangeStateView['actors'] = Object.fromEntries(
    Object.values(state.actors).map((actor): [string, RangeStateView['actors'][string]] => [actor.id, {
      id: actor.id,
      position: actor.onBattlefield ? actor.position : null,
      size: actor.size,
      hp: actor.hp,
      maximumHp: Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality),
      abilityIds: actor.abilityIds,
      masteredAbilityIds: actor.masteredAbilityIds,
      talents: actor.talents,
    }]),
  );
  return { round: state.round, actors, conditionsFor: (actorId) => {
    const actor = state.actors[actorId];
    return actor ? encounterConditionSet(actor, state) : new Set<string>();
  }, ...(selectedTalentSourceIds ? { selectedTalentSourceIds } : {}) };
}

/** Adapt the reducer state to the area kernel's read surface for one actor
 * (the round plus the actor's authoritative HP/talent/mastery/condition
 * reads), so the effective-area authority is evaluated from command-time
 * state — the same discipline as `rangeStateView`. */
export function areaStateView(state: EncounterState, actorId: string): AreaStateView {
  const actor = state.actors[actorId];
  return {
    round: state.round,
    actor: {
      hp: actor?.hp,
      maximumHp: actor ? Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality) : undefined,
      abilityIds: actor?.abilityIds,
      masteredAbilityIds: actor?.masteredAbilityIds,
      talents: actor?.talents,
      conditions: actor ? encounterConditionSet(actor, state) : undefined,
    },
  };
}

/** The minimal mastery-fold read surface: ownership/mastery plus the round
 * (the round-gate family). */
export function masteryFoldStateView(state: EncounterState): MasteryFoldStateView {
  const actors: MasteryFoldStateView['actors'] = Object.fromEntries(
    Object.values(state.actors).map((actor): [string, MasteryFoldActorView] => [actor.id, {
      hp: actor.hp,
      maximumHp: Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality),
      abilityIds: actor.abilityIds,
      masteredAbilityIds: actor.masteredAbilityIds,
    }]),
  );
  return { round: state.round, actors };
}

export function encounterConditionSet(actor: EncounterActor, state?: EncounterState) {
  const conditions = new Set<string>(actor.statuses);
  for (const condition of actor.conditions) conditions.add(condition.id);
  for (const effect of actor.activeEffects) {
    for (const modifier of effect.modifiers) if (modifier.operation === 'grant' && typeof modifier.value === 'string') conditions.add(modifier.value);
  }
  // Trait-derived passives and p.298 role baselines are closed source-ID
  // projections. Do not infer conditions from trait/role prose here: only
  // reviewed recipes affect authoritative pathing or combat. Reviewed mark
  // state (ICON p.186) grants (e.g. REGENERATE's regeneration) and suppresses
  // (e.g. Rot's noDefiance) the same way, so every consumer sees the same
  // projected condition set.
  for (const condition of projectedPassiveConditions(actor.traitIds)) conditions.add(condition);
  // Aura-conditional self-grants (ICON Aura X): a bearer projects a condition
  // onto itself while it has an active aura persistent effect from a
  // registered source (e.g. Rook's "you also have counter while the aura is
  // active"). Derives from the durable activeEffects record — replay-safe.
  const activeAuraSourceIds = actor.activeEffects.filter((effect) => effect.effectId === 'aura').map((effect) => effect.sourceId);
  for (const condition of projectedAuraSelfGrants(activeAuraSourceIds, actor.abilityIds, actor.talents)) conditions.add(condition);
  for (const condition of projectedRoleConditions(actor.roleId)) conditions.add(condition);
  for (const condition of projectedMarkConditionGrants(actor.marks, actor, state)) conditions.add(condition);
  for (const condition of projectedMarkConditionSuppressions(actor.marks, actor, state)) conditions.delete(condition);
  // HP-threshold passives derive from the actor's own authoritative HP, so
  // they fold without a spatial state (unlike aura membership).
  for (const condition of projectedHpThresholdConditions(actor)) conditions.add(condition);
  if (state) {
    for (const condition of projectedAuraConditions(auraStateView(state), actor.id)) conditions.add(condition);
  }
  return conditions;
}

/** ICON p.94: a matching + condition makes that status ongoing. Aura
 * membership can upgrade an ordinary status to ongoing while the character is
 * inside the aura (Rampant Nail's vulnerable+ inside the nail's aura,
 * p.227): the aura potency projection folds into the same ongoing set, so
 * leaving the aura drops the character back to the ordinary status without
 * any durable snapshot. */
function projectedStatuses(actor: EncounterActor, state?: EncounterState): RuleActorView['statuses'] {
  const ongoing = new Set(actor.conditions
    .filter(({ id, potency }) => potency === 'plus' && statusIds.has(id as StatusId))
    .map(({ id }) => id));
  const ids = new Set<string>(actor.statuses);
  // Imported historical state can contain a status condition without the
  // denormalized `statuses` entry.  Keep the projection authoritative rather
  // than silently dropping a saveable/ongoing status from a command.
  for (const condition of actor.conditions) if (statusIds.has(condition.id as StatusId)) ids.add(condition.id);
  if (state) {
    for (const [conditionId, potency] of projectedAuraConditionPotencies(auraStateView(state), actor.id)) {
      if (!statusIds.has(conditionId as StatusId)) continue;
      if (potency === 'plus') ongoing.add(conditionId);
      else ids.add(conditionId);
    }
  }
  // F5: a reviewed mark projection can grant a status with an ongoing potency
  // (e.g. Grand Seal talent 2's pacified+ on a bloodied marked foe, p.192).
  // Unlike the aura projection (an upgrade-only overlay on an existing
  // status), the mark grant ADDS the status to the projected surface — the
  // carrier may have no ordinary pacified at all — so the id joins the ids
  // set in both potency branches and `plus` also marks it ongoing.
  for (const [conditionId, potency] of projectedMarkConditionPotencies(actor.marks, actor, state)) {
    if (!statusIds.has(conditionId as StatusId)) continue;
    ids.add(conditionId);
    if (potency === 'plus') ongoing.add(conditionId);
  }
  return [...ids].map((id) => ({ id, potency: ongoing.has(id) ? 'plus' : 'normal' }));
}

/**
 * The command-time status-save policy is projected from durable encounter
 * state.  It deliberately has no snapshot field or migration: the source
 * rules (p.94/p.144/p.186) are recomputed on every authoritative command and
 * replay application. The base policy is empty; registered content sources
 * (Rot, Sweet Torment — content/jobs/encounter-hooks.ts) mutate it.
 */
export function encounterStatusSavePolicy(state: EncounterState, actor: EncounterActor): RuleActorView['statusSavePolicy'] {
  const policy: RuleActorView['statusSavePolicy'] = {
    cureDenied: false,
    statusSaveDenied: false,
    saveBoon: 0,
    saveCurse: 0,
  };
  for (const source of statusSavePolicySources) source.modify(state, actor, policy);
  return policy;
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
      // The durable BASE maximum for p.107 "% HEALTH" reads (percentage
      // costs/damage use the base max, never the wounds-adjusted bar).
      baseMaxHp: actor.baseMaxHp,
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
      traitIds: [...actor.traitIds],
      talents: { ...actor.talents },
      abilityIds: [...actor.abilityIds],
      masteredAbilityIds: [...actor.masteredAbilityIds],
      activeEffects: actor.activeEffects.map((effect) => {
        const radius = auraEffectRadius({ sourceId: effect.sourceId, modifiers: effect.modifiers });
        const base = { id: effect.id, sourceId: effect.sourceId, effectId: effect.effectId, ownerId: effect.ownerId };
        return radius === null ? base : { ...base, radius };
      }),
      size: actor.size,
      defeated: actor.defeated,
      stance: actor.stance ? { id: actor.stance.id, ownerId: actor.stance.ownerId ?? null, stanceId: actor.stance.stanceId } : null,
      conditions: encounterConditionSet(actor, state),
      statuses: projectedStatuses(actor, state),
      statusSavePolicy: encounterStatusSavePolicy(state, actor),
      resources: { ...actor.resources, resolve: state.partyResolve + (actor.resources['personal-resolve'] ?? 0) },
      state: { ...actor.ruleState, phaseId: actor.ruleState.phaseId ?? null },
      marks: actor.marks.map(({ id, markId, ownerId }) => ({ id, markId, ownerId })),
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

/** Build the minimal U3 query/validation context over the encounter state
 * for one acting actor. The candidate authority (`kernels/candidate.ts`)
 * reads only `state.actors` and `context.actorId`, so the remaining fields
 * are inert placeholders and the seeded dice source is never consumed by
 * querying. One construction seam so command gates and content folds do not
 * hand-roll contexts for the same eligibility authority. */
export function encounterQueryContext(state: EncounterState, actorId: string, sourceId: string): RuleExecutionContext {
  return {
    state: encounterRuleState(state),
    actorId,
    sourceId,
    actionId: 'query',
    timing: 'use',
    input: {},
    dice: seededDice(0),
  };
}

/** The deterministic LIVE instance id the reducer mints for a created effect
 * (mark/stance/persistent/entity/terrain) — source + the encounter revision
 * the event applied under + the mutation's position + a kind suffix. The
 * command/event boundary stamps the SAME id onto effect mutations
 * (`instanceId`) so the reducer consumes the recorded identity instead of
 * inventing one after the fact has already recorded it; this function is the
 * legacy fallback for mutations (historical events) that carry no stamp. */
export function generatedId(state: EncounterState, sourceId: string, mutationIndex: number, suffix: string) {
  return `${sourceId}:${state.revision}:${mutationIndex}:${suffix}`;
}

function removeOwnedEphemera(state: EncounterState, ownerId: string) {
  for (const [id, entity] of Object.entries(state.entities)) {
    // ICON p.95/p.104: SUMMONS are removed when their controller is defeated;
    // OBJECTS survive ("Objects are not removed when you are defeated").
    // Persistent companions (Beast Master's great beast, Bound Spirit's
    // seraph, Selkie's elemental — state.companion) are source-exempt and
    // survive: "This summon persists even if you're defeated." The category
    // always comes from the single entity-kind registry, never a type string.
    if (entity.ownerId !== ownerId) continue;
    if (entityKindOf(entity) !== 'summon') continue;
    if (entity.state['companion'] === true) continue;
    delete state.entities[id];
  }
  for (const actor of Object.values(state.actors)) {
    actor.marks = actor.marks.filter((mark) => mark.ownerId !== ownerId);
    actor.activeEffects = actor.activeEffects.filter((effect) => effect.ownerId !== ownerId);
  }
}

/** True while any registered defeat guard is active for the actor (Boiling
 * Blood's defy-death, content/jobs): the actor fights on at 1 hp instead of
 * being defeated, and damage cannot reduce them past 1 hp. */
export function defyDeathActive(actor: EncounterActor): boolean {
  return defeatGuards.some((guard) => guard.active(actor));
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
    const conditions = encounterConditionSet(candidate, state);
    if (!conditions.has('fortify') && !conditions.has('rampart')) continue;
    if (Math.max(Math.abs(candidate.position.x - position.x), Math.abs(candidate.position.y - position.y)) <= 1) sources.push(candidate);
  }
  return sources;
}

/** ICON p.104 Rampart: foes cannot enter or exit affected spaces by dashing,
 * flying, or teleporting. Slip and Unstoppable ignore rampart (p.105). */
export function rampartObstructs(state: EncounterState, mover: EncounterActor, position: Position): boolean {
  const conditions = encounterConditionSet(mover, state);
  if (conditions.has('slip') || conditions.has('unstoppable')) return false;
  return rampartSourcesAt(state, position).some((source) => source.side !== mover.side);
}

/** The projected armor bonus for a target from registered sources (the Heavy
 * role baseline's Guard armor 2, content/foes). Projected through the damage
 * kernel so command-time previews and replay derive the same reduced amount. */
function guardArmorBonus(state: EncounterState, target: EncounterActor): number {
  return armorBonusSources.reduce((total, source) => total + source.bonus(state, target), 0);
}

/** ICON p.94 Bloodied: at or below 50% of the wounds-adjusted maximum. The
 * canonical predicate lives in the HP-threshold kernel (`kernels/
 * hp-threshold.ts`), the single reusable authority for bloodied and 25%
 * threshold questions; re-exported here so every existing caller keeps the
 * same name and the engine never defines the boundary twice. */
export { isBloodied } from './hp-threshold.js';

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
  if (!options.ignoreDenial && (vigorDenialSources.some((source) => source.denies(state, actor)) || encounterConditionSet(actor, state).has('shattered'))) return 0;
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
  /** Unerring's direct-damage exception to the Aetherwall halving (p.105). */
  ignoreAetherwall?: boolean;
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
  const sourceConditions = source ? encounterConditionSet(source, state) : new Set<string>();
  const targetConditions = encounterConditionSet(target, state);
  // The shared p.92 footprint metric — the same distance authority targeting
  // and auras use, so distance-gated defense (Aetherwall's "outside range 2")
  // never disagrees with the canonical distance (large-foe footprints
  // included). Size-1 actors collapse to the point-cell Chebyshev distance.
  const sourceDistance = source && source.onBattlefield && target.onBattlefield
    ? footprintDistance(
      { position: source.position, size: source.size },
      { position: target.position, size: target.size },
    )
    : 0;
  return determineDamage({
    amount: intent.amount,
    damageType: intent.damageType,
    delivery: intent.delivery,
    sourceWeakened: sourceConditions.has('weakened'),
    sourcePacified: sourceConditions.has('pacified'),
    sourceHatredDiverts: hatredDivertsDamage(state, source, target),
    targetVulnerable: targetConditions.has('vulnerable'),
    // Armor plus the registered armor-bonus sources (Heavy Guard) plus the
    // continuous aura armor projection (Rook's Implacable Fortress — "as if
    // by armor", p.123): all fold through the same damage authority, so
    // command-time previews and replay derive the same reduced amount.
    targetArmor: target.armor + guardArmorBonus(state, target) + projectedAuraArmorBonus(auraStateView(state), target.id),
    ignoreArmor: intent.ignoreArmor,
    targetResistance: targetConditions.has('resistance'),
    targetAetherwall: targetConditions.has('aetherwall') && sourceDistance > 2,
    ignoreAetherwall: intent.ignoreAetherwall,
    targetCovered: intent.covered ?? target.ruleState.cover === true,
    targetIntangible: targetConditions.has('intangible'),
    targetDodge: targetConditions.has('dodge'),
    ignoreDodge: intent.ignoreDodge,
    targetDamageImmune: target.ruleState['damage-immune'] === true,
    ignoreCover: intent.ignoreCover,
    hostile: Boolean(source && source.side !== target.side),
  });
}

/** Build the full damage intent one damage mutation describes, against the
 * CURRENT state — the single intent-construction authority shared by the
 * command boundary's sequential determination dry-run and the reducer's
 * legacy re-derivation, so both fold through the identical mitigation
 * arithmetic. */
export function damageIntentFromMutation(
  state: EncounterState,
  mutation: Extract<RuleMutation, { kind: 'damage' }> & { damageType: 'normal' | 'piercing' | 'divine' },
): EncounterDamageIntent {
  const target = state.actors[mutation.actorId];
  const source = state.actors[mutation.sourceActorId];
  return {
    targetId: target?.id ?? mutation.actorId,
    sourceActorId: source?.id,
    sourceRuleId: mutation.sourceId,
    amount: mutation.amount,
    damageType: mutation.damageType,
    delivery: mutation.delivery,
    instance: mutation.instance,
    ignoreCover: mutation.ignoreCover,
    ...(mutation.ignoreDodge !== undefined ? { ignoreDodge: mutation.ignoreDodge } : {}),
    ...(mutation.ignoreArmor !== undefined ? { ignoreArmor: mutation.ignoreArmor } : {}),
  };
}

/**
 * The command/window boundary's SINGLE determination pass over one event's
 * mutation list (the T4 determined/recorded handoff):
 *
 *  1. DAMAGE — every damage instance is determined EXACTLY ONCE against the
 *     sequentially-simulated pre-event state (a reducer-faithful dry run that
 *     applies the same mutations in the same order, including defeat,
 *     immunity, Defiance consumption, and damage-window holding), and the
 *     result is stamped onto the mutation (`determined.amount`) so the
 *     reducer consumes the recorded outcome instead of calling the damage
 *     authority again. A mutation that no-ops because an earlier mutation
 *     defeated/immunized its target records amount 0 (and the U10 fact layer
 *     emits no false `damage-applied` fact for it). An instance ALREADY
 *     stamped by an earlier pass of the same resolution is treated as
 *     authoritative: its recorded amount is reused (the damage authority is
 *     NEVER invoked again for it) and the simulation applies that same
 *     recorded amount. `resolveMutationOutcomes` is therefore idempotent in
 *     the strong semantic sense: re-running it over an already-resolved
 *     mutation list performs ZERO new damage determinations and reproduces
 *     the identical stamp/state sequence.
 *
 *  2. EFFECTS — mark/stance/persistent operations get their canonical LIVE
 *     instance id stamped (`instanceId`): creation ids are decided here (the
 *     same deterministic id the reducer mints for legacy mutations), and a
 *     removal resolves the SPECIFIC existing instance it addresses from the
 *     simulation (owner-scoped natural key; left unstamped when zero or
 *     several match, so the legacy broad removal stays honest and no fake id
 *     is minted).
 *
 * Returns the authoritative per-mutation-index damage map for the fact layer.
 * Pure over a clone — the live encounter is never touched and no dice are
 * consumed — and deterministic under replay (the reducer applies the same
 * list in the same order). Idempotent: re-running over already-stamped
 * mutations reproduces the identical stamps.
 */
export function resolveMutationOutcomes(
  state: EncounterState,
  mutations: readonly RuleMutation[],
): ReadonlyMap<number, number> {
  const simulation = structuredClone(state);
  const resolvedDamage = new Map<number, number>();
  const denied = deniedAtomicSpatialLegIndices(state, mutations);
  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index];
    if (denied.has(index)) continue;
    if (mutation.kind === 'damage') {
      const damage = mutation;
      // Idempotent stamping: an ALREADY-determined instance (stamped by an
      // earlier pass of the same resolution — reactive continuation runs
      // `deriveResolutionTriggers` over the same mutation list several times)
      // is authoritative. Its recorded amount is reused — the damage
      // authority is NEVER invoked again for it — and the sequential
      // simulation applies that same recorded amount, so later newly-added
      // mutations still see the correct prior state. A stamp, once written,
      // is immutable for the remainder of the resolution.
      const recorded = damage.determined?.amount;
      if (recorded !== undefined) {
        resolvedDamage.set(index, recorded);
      } else if (damage.damageType === 'sacrifice') {
        // Sacrifice (life-cost) is not armor-determined; the recorded amount
        // is the sacrifice amount itself.
        damage.determined = { amount: damage.amount };
        resolvedDamage.set(index, damage.amount);
      } else {
        // The else branch excludes sacrifice; the cast is the provable
        // exclusion of that union member so the mitigation intent can be
        // built (property narrowing does not chain through the kind narrow).
        const mitigated = damage as Extract<RuleMutation, { kind: 'damage' }> & { damageType: 'normal' | 'piercing' | 'divine' };
        const target = simulation.actors[mitigated.actorId];
        let result = null;
        if (target && !target.defeated) result = determineEncounterDamage(simulation, damageIntentFromMutation(simulation, mitigated));
        const amount = result?.amount ?? 0;
        damage.determined = { amount };
        resolvedDamage.set(index, amount);
      }
    } else if (mutation.kind === 'mark' || mutation.kind === 'persistent' || mutation.kind === 'stance') {
      stampEffectInstance(simulation, mutation, index);
    }
    applyRuleMutation(simulation, mutation, index, mutation.kind === 'move' ? coMovedActorIdsForMove(mutations, mutation) : undefined);
  }
  return resolvedDamage;
}

/** Stamp one effect operation with its canonical LIVE instance id, resolved
 * against the CURRENT simulation state (the mutations before it already
 * applied). Creation (apply/add/refresh/enter) mints the deterministic id
 * once here; removal (remove/exit) resolves the specific instance it
 * addresses by the operation's owner-scoped natural key — exactly one
 * candidate is stamped, an ambiguous zero/multiple-match is left unstamped so
 * the legacy broad removal (and an honest fact without a fake id) applies. */
function stampEffectInstance(
  state: EncounterState,
  mutation: Extract<RuleMutation, { kind: 'mark' | 'persistent' | 'stance' }>,
  mutationIndex: number,
) {
  if (mutation.kind === 'stance') {
    if (mutation.operation === 'exit') {
      if (state.actors[mutation.actorId]?.stance) mutation.instanceId = state.actors[mutation.actorId]!.stance!.id;
      return;
    }
    mutation.instanceId = generatedId(state, mutation.sourceId, mutationIndex, 'stance');
    return;
  }
  const actor = state.actors[mutation.actorId];
  if (!actor) return;
  if (mutation.operation === 'remove') {
    const candidates = mutation.kind === 'mark'
      ? actor.marks.filter((mark) => mark.markId === mutation.markId && mark.ownerId === mutation.ownerId)
      : actor.activeEffects.filter((effect) => effect.effectId === mutation.effectId && effect.ownerId === mutation.ownerId);
    if (candidates.length === 1) mutation.instanceId = candidates[0]!.id;
    return;
  }
  const suffix = mutation.kind === 'mark' ? 'mark' : 'effect';
  mutation.instanceId = generatedId(state, mutation.sourceId, mutationIndex, suffix);
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

/** ICON p.104 Hatred of X: half damage to foes other than X. The hated target
 * is stored as ruleState['hatred-of'] when the status is applied. */
export function hatredDivertsDamage(state: EncounterState, source: EncounterActor | undefined, target: EncounterActor): boolean {
  if (!source || source.side === target.side || !encounterConditionSet(source, state).has('hatred')) return false;
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
 * uses must remain. Exported for the F4 TriggerWindow registry. */
/**
 * Interrupt allowlists are content rows (reviewed interrupt sources keyed by
 * source ID) registered by the content registry root — this kernel never
 * imports content (dependency rule: content → kernels → primitives).
 */
const INTERRUPT_ALLOWLISTS: Record<
  string,
  Readonly<Record<string, { usesPerRound: number; programId?: string; allyRange?: number }>>
> = {};

export function registerInterruptAllowlist(
  trigger: string,
  allowlist: Readonly<Record<string, { usesPerRound: number; programId?: string; allyRange?: number }>>,
): void {
  INTERRUPT_ALLOWLISTS[trigger] = allowlist;
}

export function hasAvailableWhenDamagedInterrupt(actor: EncounterActor): boolean {
  if (actor.interruptUsedThisTurn) return false;
  for (const [interruptId, { usesPerRound }] of Object.entries(INTERRUPT_ALLOWLISTS['when-damaged'] ?? {})) {
    if (actor.abilityIds.includes(interruptId) && (actor.interruptUses[interruptId] ?? 0) < usesPerRound) return true;
  }
  return false;
}

/** ICON p.107/p.138: true when `actor` has an unused `defeated` interrupt
 * (Boiling Blood) — the gate that holds a lethal foe blow so the interrupt can
 * resolve before the character is defeated. Mirrors the USE_ABILITY gates.
 * Exported for the F4 TriggerWindow registry. */
export function hasAvailableDefeatedInterrupt(actor: EncounterActor): boolean {
  if (actor.interruptUsedThisTurn) return false;
  for (const [interruptId, { usesPerRound }] of Object.entries(INTERRUPT_ALLOWLISTS['defeated'] ?? {})) {
    if (actor.abilityIds.includes(interruptId) && (actor.interruptUses[interruptId] ?? 0) < usesPerRound) return true;
  }
  return false;
}

/**
 * ICON p.104/p.138: whether a determined damage amount actually defeats the
 * target — the amount is lethal against HP+vigor, and neither Defiance nor
 * Defy Death's application-time HP floor keeps them fighting on. Shared by the
 * damage pipeline's defeated-window gate and the Masquerade window-priority
 * check so both decide from the same prospective application outcome.
 */
export function prospectiveAppliedDefeat(
  target: EncounterActor,
  amount: number,
  bypassVigor: boolean,
  options: { ignoreDefiance?: boolean; damageType: Exclude<EncounterHeldDamage['damageType'], 'sacrifice'> },
  state?: EncounterState,
): boolean {
  if (amount <= 0) return false;
  const wouldDefeat = bypassVigor ? amount >= target.hp : amount >= target.vigor + target.hp;
  if (!wouldDefeat || defyDeathActive(target)) return false;
  return !(!options.ignoreDefiance && options.damageType !== 'divine' && encounterConditionSet(target, state).has('defiance'));
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
  //    The stance's interrupt rank and aura range are the mastery-fold
  //    authorities: a mastered PERFECT BATTLEMENT (p.122) raises the rank to
  //    2 and removes the maximum range at round 4+, so both the per-round
  //    allowance and the ally-distance bound fold against current state.
  if (source.side === 'foes') {
    const foldView = masteryFoldStateView(state);
    for (const candidate of Object.values(state.actors)) {
      if (candidate.side === source.side || candidate.defeated || !candidate.stance) continue;
      const entry = (INTERRUPT_ALLOWLISTS['uses-ability'] ?? {})[candidate.stance.stanceId];
      if (!entry || !entry.programId) continue;
      const usesPerRound = effectiveInterruptRank(foldView, candidate.id, entry.programId, entry.usesPerRound);
      if (!interruptAvailable(candidate, entry.programId, usesPerRound)) continue;
      const allyId = typeof candidate.stance.state.allyId === 'string' ? candidate.stance.state.allyId : undefined;
      if (!allyId || allyId === candidate.id) continue;
      const ally = state.actors[allyId];
      if (!ally || !ally.position || !candidate.position) continue;
      if (entry.allyRange !== undefined
        && !hasUnlimitedRange(foldView, candidate.id, entry.programId)
        && Math.max(Math.abs(candidate.position.x - ally.position.x), Math.abs(candidate.position.y - ally.position.y)) > entry.allyRange) continue;
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
      if (!interruptAvailable(candidate, 'bastion:perseus', (INTERRUPT_ALLOWLISTS['area-inclusion'] ?? {})['bastion:perseus']!.usesPerRound)) continue;
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
  // The window records which interrupt program armed the redirect
  // (`retargetProgramId`, from the allowlist content row): the held effects
  // are only retargeted when that exact interrupt resolves the window — if
  // it cannot be made (p.151 "If you or your ally can't make a valid
  // teleport, this interrupt can't be made") or the window closes at a
  // boundary, the held ability hits its original target.
  for (const candidate of Object.values(state.actors)) {
    if (candidate.side !== 'heroes' || candidate.id === source.id || candidate.defeated || !candidate.position) continue;
    const masqueradeEntry = (INTERRUPT_ALLOWLISTS['targeted-by-ability'] ?? {})['fool:masquerade'];
    if (!masqueradeEntry || !interruptAvailable(candidate, 'fool:masquerade', masqueradeEntry.usesPerRound)) continue;
    if (!mutations.some((mutation) => (mutation.kind === 'damage' || mutation.kind === 'condition' || mutation.kind === 'mark') && mutation.actorId === candidate.id)) continue;
    // When a foe's damage to this candidate will already be held by the
    // damage pipeline (when-damaged/defeated), that window wins: it is the
    // more specific p.107 mechanism for the same blow, and this interrupt's
    // redirect would otherwise hijack it.
    const foeDamage = mutations.find((mutation) => mutation.kind === 'damage' && mutation.actorId === candidate.id) as Extract<RuleMutation, { kind: 'damage' }> | undefined;
    // A damage window only wins when the damage pipeline will actually open
    // one: when-damaged holds any determined foe damage; defeated opens only
    // when the blow would defeat after mitigation and the Defiance/Defy Death
    // application floors. Judging from the raw mutation amount would suppress
    // Masquerade for blows that armor/resistance absorb or that Defiance
    // prevents from defeating, leaving neither interrupt (p.107 vs p.151).
    if (source.side === 'foes' && foeDamage && foeDamage.damageType !== 'sacrifice') {
      const determined = determineEncounterDamage(state, {
        targetId: candidate.id,
        sourceActorId: source.id,
        sourceRuleId: foeDamage.sourceId,
        amount: foeDamage.amount,
        damageType: foeDamage.damageType,
        delivery: foeDamage.delivery,
        instance: foeDamage.instance,
        ignoreCover: foeDamage.ignoreCover,
        ...(foeDamage.ignoreDodge ? { ignoreDodge: true } : {}),
        ...(foeDamage.ignoreArmor ? { ignoreArmor: true } : {}),
      });
      if (determined.amount <= 0) continue;
      const bypassVigor = foeDamage.bypassVigor ?? foeDamage.damageType === 'divine';
      if (hasAvailableWhenDamagedInterrupt(candidate)) continue;
      if (hasAvailableDefeatedInterrupt(candidate)
        && prospectiveAppliedDefeat(candidate, determined.amount, bypassVigor, { ignoreDefiance: foeDamage.ignoreDefiance, damageType: foeDamage.damageType }, state)) continue;
    }
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
      retargetProgramId: masqueradeEntry.programId ?? 'fool:masquerade',
    };
  }
  return null;
}

/** ICON p.107/p.143: when a foe adjacent to a character with an available
 * save-reroll interrupt (Sucker Punch) rolls a save, the save's branch — the
 * save record plus the outcome effects generated for the rolled result — is
 * held in a `save-rolled` window until the interrupt re-rolls it.
 *
 * Deliberate per-kind scope (p.143 "an enemy adjacent to you rolls a save"):
 * only `effect`-kind saves with a declarative `branch` are held. They are
 * the only saves a foe rolls mid-turn during an ability resolution, where
 * an adjacent hero's interrupt can actually answer within the same turn.
 * `status-clear`/`cure-immediate` saves resolve at turn boundaries (closed
 * by `resolveHeldInterruptWindows` before any interrupt can answer) or are
 * self-rolled (Cure), and `movement` saves are command gates (the Six Hells
 * exit save rejects the move at command time, so no window exists) — their
 * durable records are still retained for replay and future interrupt
 * coverage. Legacy saves without the record fields are never held. */
export function saveRerollWindow(
  state: EncounterState,
  sourceActorId: string,
  mutations: RuleMutation[],
): EncounterPendingInterrupt | null {
  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index];
    if (mutation.kind !== 'save' || mutation.windowKind !== 'effect' || !mutation.branch) continue;
    const saver = state.actors[mutation.actorId];
    if (!saver || saver.side !== 'foes' || !saver.position) continue;
    for (const candidate of Object.values(state.actors)) {
      if (candidate.side !== 'heroes' || candidate.defeated || !candidate.position) continue;
      if (!interruptAvailable(candidate, 'knave:sucker-punch', (INTERRUPT_ALLOWLISTS['save-reroll'] ?? {})['knave:sucker-punch']!.usesPerRound)) continue;
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
          // The evaluated modifier (branch.boon), so the command layer
          // re-rolls the save with the same boon/curse, not the previous
          // rolled value.
          boon: mutation.branch.boon,
          sourceId: mutation.sourceId,
          sourceActorId,
          windowKind: mutation.windowKind,
          ...(mutation.windowId ? { windowId: mutation.windowId } : {}),
          ...(mutation.statusId ? { statusId: mutation.statusId } : {}),
          ...(mutation.modifiers ? { modifiers: mutation.modifiers } : {}),
          threshold: mutation.branch.threshold,
          onSuccess: mutation.branch.onSuccess,
          onFailure: mutation.branch.onFailure,
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
  const targetConditions = encounterConditionSet(target, state);
  const wouldDefeatWithoutDefiance = bypassVigor
    ? amount >= target.hp
    : amount >= target.vigor + target.hp;
  // A durable `defianceTriggered` result is the only replay-safe way to know a
  // legacy event already applied Defiance's floor: those events persist the
  // reduced applied amount, which is no longer lethal on its own. Fresh held
  // damage never carries the flag and still re-infers from the full amount.
  const defiance = !damage.ignoreDefiance && targetConditions.has('defiance') && damageType !== 'divine'
    && (damage.defianceTriggered === true || wouldDefeatWithoutDefiance);
  // ICON p.138 Defy Death and p.104 Defiance both impose an application-time
  // HP floor. They are intentionally not folded into mitigation arithmetic.
  const applied = applyDeterminedDamageToVitals(target, {
    amount,
    bypassVigor,
    minimumHp: defyDeathActive(target) || defiance ? 1 : 0,
  });
  target.hp = applied.hp;
  target.vigor = applied.vigor;
  // Defiance's consumption is independent of how much of the blow the floor
  // absorbed: even a blow fully prevented by the 1-hp floor (the target was
  // already at 1) still ends Defiance and grants damage immunity (p.104).
  // Consume it before the fully-prevented early return so a full-floor blow
  // cannot be re-answered by the same Defiance. The floor keeps hp >= 1, so
  // the defeat branch cannot both run and be skipped incorrectly.
  if (defiance) {
    target.conditions = target.conditions.filter(({ id }) => id !== 'defiance');
    target.ruleState['damage-immune'] = true;
    target.ruleStateOwners['damage-immune'] = source?.id ?? null;
  } else if (target.hp <= 0) defeatActor(state, target);
  if (applied.amountApplied <= 0) return applied;
  if (source && source.side !== target.side) target.statuses = target.statuses.filter((status) => status !== 'pacified');
  if (options.allowCounter !== false && source && source.side !== target.side && targetConditions.has('counter')) retaliate(state, source, target);
  // Content on-damage-dealt hooks (Gentleness reflection, Aria's pending-
  // damage count, Chastise retribution trigger — content/jobs/encounter-
  // hooks.ts). Each honors the caller's reaction gates (e.g. allowGentleness).
  for (const hook of onDamageDealtHooks) hook.apply(state, source, target, applied, options);
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
  const mitigated = mutation as Extract<RuleMutation, { kind: 'damage' }> & { damageType: 'normal' | 'piercing' | 'divine' };
  // T4 determined handoff: the command/window boundary decided this
  // instance's post-mitigation amount ONCE and stamped it on the mutation
  // (`determined.amount`). The reducer CONSUMES that recorded outcome — it
  // never invokes the damage determination authority again for a stamped
  // event, so U10's recorded amount and the reducer-applied amount are the
  // same value and replay applies the recorded result without re-calculating
  // armor/resistance/dodge/etc. Only historical events without the stamp
  // fall back to the (deterministic) re-derivation path.
  const recorded = mutation.determined?.amount;
  const amount = recorded !== undefined
    ? recorded
    : determineEncounterDamage(state, damageIntentFromMutation(state, mitigated)).amount;
  if (amount <= 0) return;
  const bypassVigor = mutation.bypassVigor ?? mutation.damageType === 'divine';
  // ICON p.107: damage from a foe is held while the target has an available
  // when-damaged interrupt — the damage is determined but not applied yet, and
  // the interrupt resolves before it applies (p.128 Righteous Disdain). A
  // lethal blow is also held when the target has an available `defeated`
  // interrupt (Boiling Blood, p.138) so the character can fight on before
  // being defeated. The held damage applies after the interrupt resolves, or
  // at the end of the turn; an interrupt that re-deals the damage consumes it.
  // F4: the decision is the TriggerWindow registry's (single decision point
  // shared with the split-event ledger path), evaluated from durable
  // provenance.
  const window = decideDamageWindow(state, target, {
    targetId: target.id,
    sourceActorId: source?.id ?? null,
    determinedAmount: amount,
    bypassVigor,
    damageType: mutation.damageType,
    ignoreDefiance: mutation.ignoreDefiance,
  });
  if (window && state.pendingInterrupts) {
    openDamageWindow(state, {
      window,
      actorId: target.id,
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
  if (!actor || actor.defeated || encounterConditionSet(actor, state).has('immobile')) return null;
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
  const maximum = encounterConditionSet(actor, state).has('sturdy') && state.actors[mutation.sourceActorId]?.side !== actor.side ? Math.min(1, mutation.distance) : mutation.distance;
  // ICON p.92: a Size-N actor occupies an N×N footprint, so each shove step
  // must keep the WHOLE footprint in bounds, off impassable terrain, and free
  // of every other actor's footprint — the same authority the movement
  // planner and SpatialIntent gateway use (anchor-only checks would shove a
  // large actor off the grid or through another large actor's non-anchor
  // cells). Size 1 degenerates to the anchor-cell checks.
  const size = Math.max(1, actor.size ?? 1);
  let position = { ...actor.position };
  let collided = false;
  for (let step = 0; step < maximum; step += 1) {
    const next = { x: position.x + Math.sign(direction.x), y: position.y + Math.sign(direction.y) };
    const cells = footprintCells(next, size);
    const obstructed = cells.some((cell) => cell.x < 0 || cell.y < 0 || cell.x >= state.grid.width || cell.y >= state.grid.height)
      || Object.values(state.actors).some((candidate) => candidate.id !== actor.id && candidate.onBattlefield && !candidate.defeated && footprintsOverlap({ position: next, size }, { position: candidate.position, size: candidate.size }))
      || cells.some((cell) => state.grid.terrain.some((gridCell) => samePosition(gridCell.position, cell) && gridCell.type === 'impassable'));
    if (obstructed) {
      collided = true;
      break;
    }
    position = next;
  }
  return { position, collided };
}

/** Build the SpatialIntent for an explicit-destination move mutation, or null
 * when the mutation does not route through the gateway (shove, remove). The
 * gateway decides bounds, occupancy, impassable terrain, and Rampart
 * (automation/spatial-intent.ts); this construction is shared by the live
 * application and the swap prevalidation so both decide from one source. */
function movementSpatialIntent(
  state: EncounterState,
  mutation: Extract<RuleMutation, { kind: 'move' }>,
  coMovedActorIds?: readonly string[],
): SpatialIntent | null {
  const destination = mutation.positions.at(-1);
  if (!destination || mutation.movement === 'shove') return null;
  const actor = state.actors[mutation.actorId];
  if (!actor) return null;
  return {
    kind: mutation.movement === 'teleport' ? 'teleport' : mutation.movement === 'place' ? 'place' : 'move',
    actorId: actor.id,
    sourceActorId: mutation.sourceActorId,
    sourceRuleId: mutation.sourceId,
    from: actor.position,
    to: destination,
    coMovedActorIds,
    // p.104 Rampart blocks dashing, flying, and teleporting. Placement is
    // forced movement (a throw, a summon, a return), not a teleport; a
    // teleport is denied when entering or leaving rampart differs; a
    // fly/rush destination is denied when rampart-obstructed for the mover.
    rampartObstructed: mutation.movement === 'teleport'
      ? rampartObstructs(state, actor, actor.position) !== rampartObstructs(state, actor, destination)
      : mutation.movement === 'fly' || mutation.movement === 'rush'
        ? rampartObstructs(state, actor, destination)
        : false,
  };
}

function applyMovement(state: EncounterState, mutation: Extract<RuleMutation, { kind: 'move' }>, coMovedActorIds?: readonly string[]): boolean {
  const actor = state.actors[mutation.actorId];
  if (!actor || actor.defeated || encounterConditionSet(actor, state).has('immobile')) return false;
  const beforePosition = { ...actor.position };
  const beforeBattlefield = actor.onBattlefield;
  const moved = () => beforeBattlefield !== actor.onBattlefield || !samePosition(beforePosition, actor.position);
  if (mutation.movement === 'remove') {
    actor.onBattlefield = false;
    return moved();
  }
  // Every explicit-destination path routes through the shared SpatialIntent
  // gateway: bounds, occupancy, impassable terrain, and rampart are decided
  // once (automation/spatial-intent.ts), never per resolver.
  const intent = movementSpatialIntent(state, mutation, coMovedActorIds);
  if (intent) return applySpatialIntent(state, intent).moved;
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
  if (!actor || !actor.onBattlefield || actor.defeated || actor.slashedTriggeredThisTurn || !encounterConditionSet(actor, state).has('slashed')) return;
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

export function applyRuleMutation(state: EncounterState, mutation: RuleMutation, mutationIndex: number, coMovedActorIds?: readonly string[]) {
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
      if (mutation.operation === 'apply' && source && encounterConditionSet(source, state).has('sealed') && statusIds.has(mutation.conditionId as StatusId)) break;
      if (mutation.operation === 'apply' && source && source.side !== actor.side && encounterConditionSet(actor, state).has('unstoppable') && statusIds.has(mutation.conditionId as StatusId)) break;
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
      const moved = applyMovement(state, mutation, coMovedActorIds);
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
      if (mutation.operation === 'remove') {
        // ICON "Remove any difficult or dangerous terrain of your choice in
        // the area" — removal is scoped to the mutation's positions, never
        // over-broad: a multi-cell terrain record keeps its un-removed cells.
        const next: EncounterTerrainEffect[] = [];
        for (const effect of state.terrainEffects) {
          if (effect.terrain !== mutation.terrain) { next.push(effect); continue; }
          const remaining = effect.positions.filter((position) => !mutation.positions.some((candidate) => samePosition(position, candidate)));
          if (remaining.length > 0) next.push({ ...effect, positions: remaining });
        }
        state.terrainEffects = next;
      } else {
        const effect: EncounterTerrainEffect = { id: generatedId(state, mutation.sourceId, mutationIndex, 'terrain'), sourceId: mutation.sourceId, ownerId: mutation.sourceActorId, terrain: mutation.terrain, positions: clone(mutation.positions), height: mutation.height, duration: mutation.duration ?? null };
        state.terrainEffects.push(effect);
      }
      break;
    }
    case 'entity': {
      if (mutation.operation === 'remove') {
        if (mutation.positions.length > 0) {
          // ICON "Destroy any of your created objects in the area" — scoped
          // removal of the user's objects at the chosen cells only.
          for (const [id, entity] of Object.entries(state.entities)) {
            if (entity.type === mutation.entityType && entity.ownerId === mutation.ownerId && entity.positions.some((cell) => mutation.positions.some((candidate) => samePosition(cell, candidate)))) delete state.entities[id];
          }
        } else {
          for (const [id, entity] of Object.entries(state.entities)) if (entity.type === mutation.entityType && entity.ownerId === mutation.ownerId) delete state.entities[id];
        }
      } else if (mutation.operation === 'update') {
        // Authoritative entity state update (e.g. raising an object's height
        // by +1) at the mutation's target cells. Never a create-into-an-
        // occupied-cell: the existing entity's state is merged in place.
        for (const entity of Object.values(state.entities)) {
          if (entity.type !== mutation.entityType) continue;
          if (!mutation.positions.some((p) => entity.positions.some((cell) => samePosition(cell, p)))) continue;
          entity.state = { ...entity.state, ...clone(mutation.state) };
        }
      } else {
        // F6: the six Job summon suites cap active entities per owner (max six
        // bombs/shadows/beasts/thralls/salt-sprites — summon-recipes.ts). A
        // create beyond the cap is declined deterministically.
        // ICON general rule: creation requires free, unobstructed, and LoS.
        // The origin/range are a source-declared PAIRED creation-spatial
        // contract carried through the mutation; the kernel rejects a range
        // without a valid in-bounds origin (fail-closed — a malformed
        // maxRange-only mutation can never become unlimited creation).
        // Legacy spatial fields (creationOrigin/creationOriginSize /
        // creationMaxRange from the pre-creationSpatial representation) are
        // never emitted by new command construction; the migration boundary
        // rewrites persisted events to creationSpatial. If one still reaches
        // the reducer un-migrated, the creation is DECLINED.
        // A single creation mutation may carry an ORDERED CANDIDATE LIST and a
        // requested `count > 1`: validateEntityCreation is the single legality
        // authority — it skips illegal candidates (bounds, occupied, impassable,
        // LoS, footprint-range, cap) and returns the first `count` legal ones;
        // count>1 produces `count` discrete single-cell objects (e.g. two
        // boulders), while a count===1 creation yields one entity record.
        const legacyEntity = mutation as Extract<RuleMutation, { kind: 'entity' }> & { creationOrigin?: unknown; creationOriginSize?: unknown; creationMaxRange?: unknown };
        if (legacyEntity.creationOrigin !== undefined || legacyEntity.creationOriginSize !== undefined || legacyEntity.creationMaxRange !== undefined) break;
        const category = mutation.category ?? entityKind(mutation.entityType);
        const validated = validateEntityCreation(state, {
          ownerId: mutation.ownerId,
          entityType: mutation.entityType,
          kind: category,
          countMode: mutation.countMode,
          positions: mutation.positions,
          count: mutation.count,
          state: mutation.state,
          duration: mutation.duration ?? null,
          ...(mutation.creationSpatial ? { spatial: mutation.creationSpatial } : {}),
        });
        if (!validated) break;
        if (mutation.count > 1) {
          // A single count>1 creation mutation becomes `count` discrete
          // single-cell objects. generatedId alone is stable within a batch
          // (same revision + mutationIndex), so each discrete object indexes
          // its id or a later one would overwrite the earlier cell's record.
          for (let i = 0; i < validated.positions.length; i += 1) {
            const pos = validated.positions[i];
            const entity: EncounterEntity = { id: generatedId(state, mutation.sourceId, mutationIndex, `entity:${i}`), type: mutation.entityType, ownerId: mutation.ownerId, kind: category, positions: [clone(pos)], state: { ...mutation.state }, duration: mutation.duration ?? null };
            state.entities[entity.id] = entity;
          }
        } else {
          const entity: EncounterEntity = { id: generatedId(state, mutation.sourceId, mutationIndex, 'entity'), type: mutation.entityType, ownerId: mutation.ownerId, kind: category, positions: clone(validated.positions), state: { ...mutation.state }, duration: mutation.duration ?? null };
          state.entities[entity.id] = entity;
        }
      }
      break;
    }
    case 'mark': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'remove') {
        // T4 instance-scoped removal: a removal that names its specific live
        // instance (the id recorded on its U10 fact) removes THAT instance
        // only — coexisting same-named marks stay intact. Legacy removals
        // without the stamp keep the historical markId-scoped removal.
        if (mutation.instanceId !== undefined) actor.marks = actor.marks.filter(({ id }) => id !== mutation.instanceId);
        else actor.marks = actor.marks.filter(({ markId }) => markId !== mutation.markId);
      } else {
        // Replacement rule (ICON: a source places its own mark on a target —
        // the previous instance of THAT owner is replaced, other owners' marks
        // with the same markId are untouched): source-rule-correct and kept.
        actor.marks = actor.marks.filter(({ ownerId }) => ownerId !== mutation.ownerId);
        actor.marks.push({ id: mutation.instanceId ?? generatedId(state, mutation.sourceId, mutationIndex, 'mark'), sourceId: mutation.sourceId, ownerId: mutation.ownerId, markId: mutation.markId, duration: mutation.duration ?? null, state: { ...mutation.state } });
        // Reviewed Rot mark state (noDefiance suppression, REGENERATE ally
        // regeneration) is interpreted by the closed source-ID projection in
        // passive-projection.ts; arbitrary mark state is never mechanical.
      }
      break;
    }
    case 'stance': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'exit') {
        // Stance is single-instance per actor; an exit naming a specific
        // instance only clears when that IS the current stance (always true
        // for a recorded event — the boundary resolved the current id).
        if (mutation.instanceId === undefined || actor.stance?.id === mutation.instanceId) actor.stance = null;
      } else actor.stance = { id: mutation.instanceId ?? generatedId(state, mutation.sourceId, mutationIndex, 'stance'), sourceId: mutation.sourceId, ownerId: mutation.sourceActorId, stanceId: mutation.stanceId, state: { ...mutation.state } };
      break;
    }
    case 'persistent': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'remove') {
        // T4 instance-scoped removal: a removal naming its specific live
        // instance removes THAT instance only — coexisting instances (A vs B)
        // stay intact. Legacy removals without the stamp keep the historical
        // effectId-scoped removal (which is intentionally broad).
        if (mutation.instanceId !== undefined) actor.activeEffects = actor.activeEffects.filter(({ id }) => id !== mutation.instanceId);
        else actor.activeEffects = actor.activeEffects.filter(({ effectId }) => effectId !== mutation.effectId);
      } else actor.activeEffects.push({ id: mutation.instanceId ?? generatedId(state, mutation.sourceId, mutationIndex, 'effect'), sourceId: mutation.sourceId, effectId: mutation.effectId, ownerId: mutation.ownerId, duration: mutation.duration, modifiers: clone(mutation.modifiers), triggers: [...mutation.triggers], state: { ...mutation.state } });
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

/** A move mutation that routes through the SpatialIntent gateway with an
 * explicit destination: place/teleport/rush/fly (and generic moves with a
 * destination). Shoves resolve step-wise and removes leave the battlefield;
 * neither is a destination-permutation leg. */
const isExplicitDestinationMove = (mutation: RuleMutation): mutation is Extract<RuleMutation, { kind: 'move' }> =>
  mutation.kind === 'move' && mutation.movement !== 'shove' && mutation.movement !== 'remove' && mutation.positions.at(-1) !== undefined;

/** The co-moved participants of one move mutation: the actors in the SAME
 * source-declared spatial group (all move legs sharing its `spatialBatchId`,
 * emitted by `swapMutations` in primitives/job-kit.ts). Occupancy exemption
 * is GROUP-SCOPED: an ungrouped move leg receives no exemption at all (its
 * destination must be genuinely free against authoritative current
 * occupancy), and actors in a different spatial batch are never treated as
 * co-moved with this leg — a grouped leg may only ignore the footprints of
 * actors participating in its own declared simultaneous spatial group.
 * Shared by the live application, the atomic-group prevalidation, and every
 * dry run, so simulation and replay decide from one rule. */
function coMovedActorIdsForMove(mutations: readonly RuleMutation[], mutation: Extract<RuleMutation, { kind: 'move' }>): string[] {
  if (mutation.spatialBatchId === undefined) return [];
  return [...new Set(mutations
    .filter((candidate): candidate is Extract<RuleMutation, { kind: 'move' }> => candidate.kind === 'move' && candidate.spatialBatchId === mutation.spatialBatchId)
    .map((candidate) => candidate.actorId))];
}

/**
 * Atomic spatial groups (F1). Atomicity is SOURCE-DECLARED, never inferred
 * from mutation shape: only explicit-destination move legs carrying the same
 * `spatialBatchId` (emitted by `swapMutations` in primitives/job-kit.ts, and
 * by any resolver that declares whole-group semantics — e.g. Pandaemonium's
 * "remove every character in the area and place each back") form one
 * destination permutation. Ordinary multi-target movement/repositioning has
 * no batch id and continues to resolve per-leg, independently.
 *
 * Each declared group is prevalidated against the SAME pre-swap state — the
 * batch is simulated on a clone so interleaved damage/condition/terrain
 * mutations shape the decision exactly as the live application would — and
 * the group then either applies every leg or none: when any leg would be
 * denied, every leg of that group is skipped, never a partial swap. The
 * permutation must also be injective: two legs may not land on overlapping
 * footprints (a co-moved actor is never an obstruction to another leg, so
 * per-leg validation alone would let two actors stack on one destination).
 *
 * Group denial is computed to a FIXPOINT: the denial of one declared group
 * can change another group's legality (its members may not vacate when
 * denied), so the surviving groups are re-simulated against the running
 * denial set until no group flips — the final pass applies and skips
 * exactly what the live per-leg application does.
 *
 * Returns the mutation indices of the grouped explicit-destination legs to
 * skip. Non-destination mutations (damage, conditions, shoves, removes) and
 * ungrouped legs are never part of a group and are applied regardless.
 */
export function deniedAtomicSpatialLegIndices(state: EncounterState, mutations: readonly RuleMutation[]): Set<number> {
  const denied = new Set<number>();
  // Group explicit-destination move legs only by their declared spatial batch.
  const groups = new Map<string, Array<{ index: number; mutation: Extract<RuleMutation, { kind: 'move' }> }>>();
  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index];
    if (!isExplicitDestinationMove(mutation) || mutation.spatialBatchId === undefined) continue;
    const list = groups.get(mutation.spatialBatchId) ?? [];
    list.push({ index, mutation });
    groups.set(mutation.spatialBatchId, list);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const legs of groups.values()) {
      if (legs.length < 2) continue; // a single-leg group has no permutation to protect
      // A destination permutation has each participant exactly once: two legs
      // for the same actor are sequential steps of one movement, not swap legs.
      if (new Set(legs.map(({ mutation }) => mutation.actorId)).size !== legs.length) continue;
      if (legs.some(({ index }) => denied.has(index))) continue;
      if (atomicGroupDenied(state, mutations, legs, denied)) {
        for (const { index } of legs) denied.add(index);
        changed = true;
      }
    }
  }
  return denied;
}

/** Prevalidate one declared atomic spatial group against the pre-swap state.
 * True when any group leg would be denied or the destinations are not
 * injective (see `deniedAtomicSpatialLegIndices`). The simulation mirrors
 * the live application exactly: legs already in `denied` (other denied
 * groups) never apply, group legs simulate with the group's OWN co-moved
 * members, and every other leg simulates with its own group-scoped co-moved
 * set (empty for ungrouped moves), so the prevalidation and the live fold
 * can never disagree. */
function atomicGroupDenied(
  state: EncounterState,
  mutations: readonly RuleMutation[],
  legs: ReadonlyArray<{ index: number; mutation: Extract<RuleMutation, { kind: 'move' }> }>,
  denied: ReadonlySet<number>,
): boolean {
  // The group's own members are co-moved with each other (and only with each
  // other): a leg may land on a member's current cell because that member
  // also leaves it, subject to the injective-permutation check below.
  const coMovedActorIds = coMovedActorIdsForMove(mutations, legs[0].mutation);
  const simulation = structuredClone(state);

  // Effective destination per actor (the last explicit leg wins), used for
  // the injectivity check: two legs may not land on overlapping footprints
  // (a co-moved actor is never an obstruction to another leg, so per-leg
  // validation alone would let two actors stack on one destination).
  const effective = new Map<string, Position>();
  for (const { mutation } of legs) effective.set(mutation.actorId, mutation.positions.at(-1)!);
  const entries = [...effective].map(([actorId, position]) => ({ actorId, position, size: Math.max(1, simulation.actors[actorId]?.size ?? 1) }));
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (footprintsOverlap(entries[i], entries[j])) return true;
    }
  }

  // Simulate the whole batch in mutation order; every group leg must land on
  // its destination (a no-op landing on the actor's own cell counts as
  // applied). Legs of other denied groups are skipped exactly as the live
  // application skips them, so the decision matches the live fold.
  const legByIndex = new Map(legs.map(({ index, mutation }) => [index, mutation]));
  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index];
    if (denied.has(index)) continue;
    const leg = legByIndex.get(index);
    if (leg) {
      const destination = leg.positions.at(-1)!;
      applyRuleMutation(simulation, leg, index, coMovedActorIds);
      const actor = simulation.actors[leg.actorId];
      if (!actor?.position || !samePosition(actor.position, destination)) return true;
    } else {
      applyRuleMutation(simulation, mutation, index, mutation.kind === 'move' ? coMovedActorIdsForMove(mutations, mutation) : undefined);
    }
  }
  return false;
}

export function applyRuleMutations(state: EncounterState, mutations: RuleMutation[]) {
  // Source-declared atomic spatial groups: the `spatialBatchId` legs form a
  // permutation prevalidated against the same pre-swap state; either every
  // leg of the group applies or none does — never a partial swap. Every
  // other leg resolves per-leg, independently, against authoritative current
  // occupancy: a leg's co-moved exemption is scoped to its OWN declared
  // spatial group (empty for ungrouped legs) — never a batch-wide set of
  // "everyone who moves somewhere in this event".
  const denied = deniedAtomicSpatialLegIndices(state, mutations);
  mutations.forEach((mutation, index) => {
    if (denied.has(index)) return;
    applyRuleMutation(state, mutation, index, mutation.kind === 'move' ? coMovedActorIdsForMove(mutations, mutation) : undefined);
  });
}

/**
 * Predict the reactive triggers a mutation list will produce when applied
 * (ICON p.95): `collide` when a shove stops against an obstruction, and
 * `slay` when any character is reduced to 0 HP. The dry run applies to a
 * clone of the state so no live encounter data is touched and no dice are
 * consumed — mutation application is deterministic.
 */
/** The actor ids whose shove mutations collide against an obstruction (ICON
 * p.95 Collide) when the mutation list is applied. Shared by the reactive
 * trigger set and the Bull's Strength collide fold, so both derive the
 * trigger from the same single rules implementation. */
export function collidingShoveTargets(state: EncounterState, mutations: readonly RuleMutation[]): string[] {
  const targets: string[] = [];
  const simulation = structuredClone(state);
  // The dry run must mirror the live batch exactly: atomic-group legs denied
  // by the prevalidation never apply, so they never contribute a collision,
  // and every leg applies with its own group-scoped co-moved set.
  const denied = deniedAtomicSpatialLegIndices(state, mutations);
  for (let index = 0; index < mutations.length; index += 1) {
    const mutation = mutations[index];
    if (denied.has(index)) continue;
    if (mutation.kind === 'move' && mutation.movement === 'shove' && mutation.positions.length === 0 && mutation.distance !== null) {
      if (shoveResolution(simulation, mutation)?.collided) targets.push(mutation.actorId);
    }
    applyRuleMutation(simulation, mutation, index, mutation.kind === 'move' ? coMovedActorIdsForMove(mutations, mutation) : undefined);
  }
  return targets;
}

/** The actor ids reduced to 0 HP (ICON p.95 Slay) when the mutation list is
 * applied — the post-application dry run on a state clone, shared by the
 * reactive trigger set and the slay talent fold. */
export function reactiveSlayTargets(state: EncounterState, mutations: RuleMutation[]): string[] {
  const simulation = structuredClone(state);
  // The dry run must mirror the live batch exactly: atomic-group legs denied
  // by the prevalidation never apply, so they never move anyone into or out
  // of a fatal position, and every leg applies with its own group-scoped
  // co-moved set.
  const denied = deniedAtomicSpatialLegIndices(state, mutations);
  mutations.forEach((mutation, index) => {
    if (denied.has(index)) return;
    applyRuleMutation(simulation, mutation, index, mutation.kind === 'move' ? coMovedActorIdsForMove(mutations, mutation) : undefined);
  });
  const slain: string[] = [];
  for (const [id, actor] of Object.entries(simulation.actors)) {
    const before = state.actors[id];
    if (before && !before.defeated && actor.defeated) slain.push(id);
  }
  return slain;
}

export function reactiveRuleTriggers(state: EncounterState, mutations: RuleMutation[]): Set<'collide' | 'slay'> {
  const reactive = new Set<'collide' | 'slay'>();
  if (collidingShoveTargets(state, mutations).length > 0) reactive.add('collide');
  if (reactiveSlayTargets(state, mutations).length > 0) reactive.add('slay');
  return reactive;
}
