import { squareArea } from '../../area-geometry.js';
import type { RuleSourceUnit } from '../../source-units.js';
import type { EncounterState, Position } from '../../types.js';
import { footprintDistance } from '../primitives/spatial-intent.js';
import { hasMastery } from './mastery.js';
import type { RuleAction, RuleClauseCompilation, RuleEffect, RuleProgramCompilation, RuleRuntimeState, RuleSelector } from '../primitives/types.js';

/**
 * Aura kernel (docs/rules-foundations.md §Aura).
 *
 * ICON defines an aura as a continuous ongoing effect affecting specified
 * characters within range X of an origin. This module is the single reusable,
 * source-ID-free mechanism that answers the two generic questions:
 *
 *   - Which characters are currently inside this aura?   (`membersOfAura`)
 *   - What effects does aura membership project onto them? (`projectAuraEffects`)
 *
 * A content module registers a reviewed `AuraDefinition` per source aura
 * (`content/foes/aura-recipes.ts`, `content/jobs/aura-recipes.ts`): the
 * definition declares how the aura's origin(s) are found in current state,
 * the aura's radius, which relations count as members, and the ephemeral
 * conditions/modifiers membership projects. The kernel never branches on a
 * source ID: `sourceId` is provenance only, used to pair a durable runtime
 * aura record with the definition that interprets it.
 *
 * Membership is always recomputed from current encounter state — an actor is
 * affected only while inside the aura, leaving removes the projection
 * immediately, and moving the origin changes membership immediately. Aura
 * lifetime (a durable stance/state/effect bound) and aura membership (derived
 * geometry) are separate concepts: a temporary aura may persist until a
 * lifecycle boundary, but its membership is still derived on every read.
 *
 * Range uses the engine's canonical p.92 spatial authority
 * (`footprintDistance`, L∞ from the edge of the origin space), so a large
 * character counts as inside when at least one occupied space is within the
 * aura (p.290), exactly as it counts as inside an area. Projection feeds the
 * existing condition and attack-modifier consumers; this kernel never
 * resolves attacks, saves, damage, or statuses itself.
 */

export type AuraRelation = 'allies' | 'foes' | 'characters';

/**
 * How the aura's origin(s) are found in current state.
 *
 * - `actor-trait`: every living on-battlefield actor owning the trait
 *   (permanent trait auras: Shieldmaster, Commander's Aura, Aura of
 *   Shielding).
 * - `actor-state`: every living on-battlefield actor whose durable rule
 *   state key is truthy (a temporary aura carried by a state key the ability
 *   program sets and a lifecycle recipe clears).
 * - `stance`: every actor currently holding the stance (Gentleness).
 * - `aura-effect`: every actor carrying a durable `aura` active effect whose
 *   provenance (`effect.sourceId`) matches this definition — or the
 *   definition's declared `sourceId` override (a mastery row can interpret
 *   the aura the parent ability carries under its own provenance). The
 *   effect is the aura's lifetime record (Rook, Dervish, Endless Battlement)
 *   and its radius is read from the effect's `aura`-grant modifier, so
 *   heroic size increases and lifetime expiry need no parallel state.
 * - `entity-type`: entities of the named type (Spirit Shrine's aura, Rampant
 *   Nail's lightning-spike aura).
 */
export type AuraOrigin =
  | { kind: 'actor-trait'; traitId: string }
  | { kind: 'actor-state'; stateKey: string }
  | { kind: 'stance'; stanceId: string }
  | { kind: 'aura-effect'; sourceId?: string }
  | { kind: 'entity-type'; entityType: string };

/** Projected attack-path modifiers. Positive numbers are boons; the consumer
 * folds curses as negative boons through the existing attack-modifier
 * authority (attack-resolution's netBoon), so stacking follows the same rule
 * as every other source boon/curse. */
export interface AuraAttackModifiers {
  /** Boons on the member's own attack rolls (Commander's Aura). */
  boons?: number;
  /** Curses on the member's own attack rolls (Gentleness). */
  curses?: number;
  /** Curses on attack rolls *against* the member (defensive projections). */
  targetCurses?: number;
}

export interface AuraDefinition {
  /** Provenance for audit/replay — the kernel never branches on it. For
   * `aura-effect` origins it must equal the durable effect's `sourceId`. */
  sourceId: string;
  origin: AuraOrigin;
  /** Static radius for trait/state/stance/entity origins. Ignored for
   * `aura-effect` origins, whose radius is read from the effect. */
  radius: number;
  /** Eligible relations. The origin itself is only affected when
   * `includesOrigin` is true (\"The abjurer and allies\", \"you and allies\"):
   * a character is never its own ally, and `allies`/`foes` exclude the
   * origin by construction. */
  relations: readonly AuraRelation[];
  includesOrigin: boolean;
  /** Optional talent gate: the aura's projections apply only while the
   * origin actor has the named ability's talent equipped (Rook talent 1's
   * counter on the Rook aura, Gentleness talent 1's counter in the stance,
   * p.123/p.179). Declarative content data — the kernel never branches on
   * the ids. */
  talentGate?: { abilityId: string; talent: 1 | 2 };
  /** Optional mastery gate: the aura's projections apply only while the
   * origin actor has mastered the named ability (Rook's Implacable Fortress,
   * Dark Knight's Infectious Hatred, Gentleness' Gentle Prayer, Rampant
   * Nail's Voracious Nail). Checked per-origin-actor exactly like
   * `talentGate`, through the shared mastery kernel gate — the kernel never
   * branches on the id. */
  masteryGate?: { abilityId: string };
  /** For stance/state origins: the origin actor's durable rule-state key
   * that holds the aura's *current* radius when present (Gentleness' aura
   * resize, p.179). The static `radius` stays the default. Declarative data. */
  radiusStateKey?: string;
  /** Conditions projected onto current members (dodge, counter, …). */
  conditions?: readonly string[];
  /** Per-condition potency overrides projected onto current members while
   * inside the aura (Rampant Nail: vulnerable characters are vulnerable+
   * instead while inside the nail's aura, p.227). The condition must also be
   * in `conditions` for the projection to exist; the override only changes
   * its potency (ordinary → ongoing, p.94). */
  conditionPotencies?: Readonly<Record<string, 'normal' | 'plus'>>;
  /** Upgrade-only projection (Rampant Nail, p.227): the aura does NOT grant
   * the `conditions` — it only upgrades the potency of a condition the
   * member already has ("vulnerable characters are vulnerable+ instead while
   * inside the nail's aura"). Without this flag, membership would grant the
   * condition to characters who never earned it. The grant is skipped and
   * only `conditionPotencies` entries with `plus` potency project. */
  upgradeOnly?: boolean;
  /** Attack-path modifiers projected onto current members. */
  attackModifiers?: AuraAttackModifiers;
  /** Flat damage reduction projected onto current members, applied exactly
   * like armor in the shared damage kernel (Rook's Implacable Fortress:
   * "reduce all damage by 2, as if by armor", p.123). */
  armorBonus?: number;
}

/** The minimal spatial read surface both the reducer state (`EncounterState`)
 * and the rule runtime view (`RuleRuntimeState`) satisfy. */
export interface AuraActorView {
  id: string;
  side: string;
  position: Position | null;
  size?: number;
  onBattlefield?: boolean;
  defeated: boolean;
  traitIds?: readonly string[];
  /** The equipped talent choice per ability (1 or 2) — the talent-gate read. */
  talents?: Readonly<Record<string, 1 | 2>>;
  /** Durable rule-state (ruleState on the reducer actor; the view's `state`). */
  state?: Readonly<Record<string, unknown>>;
  stance?: { stanceId: string } | null;
  /** Equipped ability ids (the mastery-gate ownership read). */
  abilityIds?: readonly string[];
  /** Mastered ability ids — the continuous-projection mastery gate. */
  masteredAbilityIds?: readonly string[];
  /** Durable aura-effect records (`aura`-grant modifiers). The reducer view
   * carries the raw `modifiers`; the runtime view carries the resolved
   * `radius` (computed by the adapter so resolvers and the reducer derive
   * the same aura size). */
  activeEffects?: ReadonlyArray<{
    sourceId: string;
    radius?: number;
    modifiers?: ReadonlyArray<{ stat: string; operation: string; value?: unknown }>;
  }>;
}

export interface AuraStateView {
  actors: Record<string, AuraActorView>;
  entities?: Record<string, { id: string; type: string; ownerId: string | null; position: Position | null }>;
}

const auraDefinitions: AuraDefinition[] = [];

/** Register a reviewed aura definition (content/). Registration order is the
 * projection order; overlapping auras union through the shared set. */
export function registerAuraDefinition(definition: AuraDefinition): void {
  auraDefinitions.push(definition);
}

/** The registered definition for a source aura, or null when none exists. */
export function auraDefinitionFor(sourceId: string): AuraDefinition | null {
  return auraDefinitions.find((definition) => definition.sourceId === sourceId) ?? null;
}

/** The closed registry (registration order = projection order). */
export function registeredAuraDefinitions(): readonly AuraDefinition[] {
  return auraDefinitions;
}

/** The durable `aura`-grant radius of an active effect, or null when the
 * effect carries none. Supports the numeric `RuleNumber` constant form the
 * ability programs emit. Exported so the rule-runtime adapter can project
 * the resolved radius onto the view for resolver reads. */
export function auraEffectRadius(effect: NonNullable<AuraActorView['activeEffects']>[number]): number | null {
  if (effect.radius !== undefined) return Math.max(0, effect.radius);
  for (const modifier of effect.modifiers ?? []) {
    if (modifier.stat !== 'aura' || modifier.operation !== 'grant') continue;
    const value = modifier.value;
    if (typeof value === 'number') return Math.max(0, value);
    if (value !== null && typeof value === 'object' && 'kind' in value && (value as { kind?: string }).kind === 'constant' && 'value' in value && typeof (value as { value?: unknown }).value === 'number') {
      return Math.max(0, (value as { value: number }).value);
    }
    return null;
  }
  return null;
}

/** One concrete origin of an aura in current state, with its effective
 * radius and the side used for relation checks. */
export interface AuraOriginRef {
  actorId: string | null;
  entityId: string | null;
  position: Position;
  size: number;
  radius: number;
  side: string | null;
}

/** Resolve every concrete origin of the aura in current state. Pure — no
 * state is mutated. A defeated, off-battlefield, or positionless origin is
 * not an origin: the aura ceases when its source is gone (p.94: owned
 * effects end for an incapacitated character). */
export function auraOriginRefs(state: AuraStateView, definition: AuraDefinition): AuraOriginRef[] {
  const origins: AuraOriginRef[] = [];
  const { origin } = definition;
  for (const actor of Object.values(state.actors)) {
    if (actor.defeated || actor.onBattlefield === false || !actor.position) continue;
    if (definition.talentGate && actor.talents?.[definition.talentGate.abilityId] !== definition.talentGate.talent) continue;
    if (definition.masteryGate && !hasMastery(actor, definition.masteryGate.abilityId)) continue;
    // A stance/state origin's current radius may be carried by the origin
    // actor's durable state (Gentleness' aura resize); the static radius is
    // the default when the key is absent.
    const radiusOverride = definition.radiusStateKey
      ? Number(actor.state?.[definition.radiusStateKey])
      : Number.NaN;
    const radius = Number.isFinite(radiusOverride) && radiusOverride > 0 ? radiusOverride : definition.radius;
    if (origin.kind === 'actor-trait' && (actor.traitIds?.includes(origin.traitId) ?? false)) {
      origins.push({ actorId: actor.id, entityId: null, position: actor.position, size: actor.size ?? 1, radius, side: actor.side });
    } else if (origin.kind === 'actor-state' && actor.state?.[origin.stateKey]) {
      origins.push({ actorId: actor.id, entityId: null, position: actor.position, size: actor.size ?? 1, radius, side: actor.side });
    } else if (origin.kind === 'stance' && actor.stance?.stanceId === origin.stanceId) {
      origins.push({ actorId: actor.id, entityId: null, position: actor.position, size: actor.size ?? 1, radius, side: actor.side });
    } else if (origin.kind === 'aura-effect') {
      for (const effect of actor.activeEffects ?? []) {
        // The durable aura effect is the lifetime record; provenance pairs it
        // with the definition that interprets its projections. A definition
        // may declare an explicit effect source (a mastery row interpreting
        // the aura the parent ability carries under its own provenance).
        if (effect.sourceId !== (origin.sourceId ?? definition.sourceId)) continue;
        const effectRadius = auraEffectRadius(effect);
        if (effectRadius === null) continue;
        origins.push({ actorId: actor.id, entityId: null, position: actor.position, size: actor.size ?? 1, radius: effectRadius, side: actor.side });
      }
    }
  }
  if (origin.kind === 'entity-type') {
    for (const entity of Object.values(state.entities ?? {})) {
      if (entity.type !== origin.entityType || !entity.position) continue;
      const owner = entity.ownerId ? state.actors[entity.ownerId] : undefined;
      origins.push({ actorId: null, entityId: entity.id, position: entity.position, size: 1, radius: definition.radius, side: owner?.side ?? null });
    }
  }
  return origins;
}

/** ICON p.92/p.290: a character is inside the aura when at least one space
 * of its footprint is within the aura's radius of the origin's footprint
 * edge (`footprintDistance` is the canonical range authority; a Size-1
 * character degenerates to the point-cell Chebyshev distance). */
export function isAuraMember(
  state: AuraStateView,
  definition: AuraDefinition,
  origin: AuraOriginRef,
  actorId: string,
): boolean {
  const actor = state.actors[actorId];
  if (!actor || actor.defeated || actor.onBattlefield === false || !actor.position) return false;
  if (origin.actorId !== null && actor.id === origin.actorId) return definition.includesOrigin;
  if (footprintDistance({ position: origin.position, size: origin.size }, { position: actor.position, size: actor.size ?? 1 }) > origin.radius) return false;
  if (definition.relations.length === 0) return false;
  // The origin is never its own ally/foe (covered by includesOrigin above).
  if (origin.side === null) return definition.relations.includes('characters');
  return definition.relations.some((relation) => relation === 'characters'
    ? true
    : relation === 'allies'
      ? actor.side === origin.side
      : actor.side !== origin.side);
}

/** The member actor ids of one aura definition, deterministic by id. */
export function membersOfAura(state: AuraStateView, definition: AuraDefinition): string[] {
  const members = new Set<string>();
  for (const origin of auraOriginRefs(state, definition)) {
    for (const actor of Object.values(state.actors)) {
      if (isAuraMember(state, definition, origin, actor.id)) members.add(actor.id);
    }
  }
  return [...members].sort();
}

/** True when the actor is currently inside any origin of the aura. The
 * reusable question lifecycle recipes ask at boundaries: \"at turn end, for
 * characters in aura…\". */
export function isInAura(state: AuraStateView, definition: AuraDefinition, actorId: string): boolean {
  for (const origin of auraOriginRefs(state, definition)) {
    if (isAuraMember(state, definition, origin, actorId)) return true;
  }
  return false;
}

/** The aura's cells around one origin (placement queries such as Gravebirth's
 * \"free space in your aura\" use these with the shared free-cell search). */
export function auraCells(origin: AuraOriginRef): Position[] {
  return squareArea(origin.position, origin.radius);
}

/** Conditions projected onto the actor by every aura it is currently inside.
 * Ephemeral by construction: nothing here is written into the durable
 * condition list, so leaving the aura removes the projection immediately. */
export function projectedAuraConditions(state: AuraStateView, actorId: string): ReadonlySet<string> {
  const conditions = new Set<string>();
  for (const definition of auraDefinitions) {
    if (!definition.conditions || definition.conditions.length === 0) continue;
    if (!isInAura(state, definition, actorId)) continue;
    // Upgrade-only rows (Rampant Nail) never grant the condition — they only
    // upgrade the potency of one the member already has.
    if (definition.upgradeOnly) continue;
    for (const condition of definition.conditions) conditions.add(condition);
  }
  return conditions;
}

/** Attack-path modifiers projected onto the actor by every aura it is
 * currently inside. `boons`/`curses` apply to the member's own attack rolls;
 * `targetCurses` applies to attack rolls *against* the member. Multiple
 * auras stack additively through the existing netBoon authority. */
export function projectedAuraAttackModifiers(state: AuraStateView, actorId: string): AuraAttackModifiers {
  const modifiers: AuraAttackModifiers = {};
  for (const definition of auraDefinitions) {
    const projected = definition.attackModifiers;
    if (!projected || (!projected.boons && !projected.curses && !projected.targetCurses)) continue;
    if (!isInAura(state, definition, actorId)) continue;
    if (projected.boons) modifiers.boons = (modifiers.boons ?? 0) + projected.boons;
    if (projected.curses) modifiers.curses = (modifiers.curses ?? 0) + projected.curses;
    if (projected.targetCurses) modifiers.targetCurses = (modifiers.targetCurses ?? 0) + projected.targetCurses;
  }
  return modifiers;
}

/** The per-condition potency an aura projects onto the actor, or null when
 * no aura projects the condition. Ordinary projections default to `normal`;
 * a definition's `conditionPotencies` override (vulnerable+ inside the
 * Rampant Nail aura, p.227) upgrades the potency while membership lasts. */
export function projectedAuraConditionPotencies(
  state: AuraStateView,
  actorId: string,
): ReadonlyMap<string, 'normal' | 'plus'> {
  const potencies = new Map<string, 'normal' | 'plus'>();
  for (const definition of auraDefinitions) {
    if (!definition.conditions || definition.conditions.length === 0) continue;
    if (!isInAura(state, definition, actorId)) continue;
    for (const condition of definition.conditions) {
      const potency = definition.conditionPotencies?.[condition] ?? 'normal';
      // Upgrade-only rows project only their `plus` override: a normal entry
      // would otherwise grant the status to non-members (projectedStatuses
      // adds a normal-potency entry to the status set).
      if (definition.upgradeOnly && potency !== 'plus') continue;
      // The highest projected potency wins; an override never downgrades a
      // durable plus condition (projectedStatuses handles the union).
      if (potency === 'plus') potencies.set(condition, 'plus');
      else if (!potencies.has(condition)) potencies.set(condition, 'normal');
    }
  }
  return potencies;
}

/** Flat damage reduction projected onto the actor by every aura it is
 * currently inside, applied exactly like armor in the shared damage kernel
 * (Rook's Implacable Fortress, p.123). Ephemeral by construction: leaving
 * the aura removes the reduction immediately. */
export function projectedAuraArmorBonus(state: AuraStateView, actorId: string): number {
  let bonus = 0;
  for (const definition of auraDefinitions) {
    if (!definition.armorBonus) continue;
    if (!isInAura(state, definition, actorId)) continue;
    bonus += definition.armorBonus;
  }
  return bonus;
}

/** The combined projection (conditions + potencies + attack modifiers +
 * armor bonus) onto one actor. */
export function projectAuraEffects(state: AuraStateView, actorId: string): {
  conditions: ReadonlySet<string>;
  conditionPotencies: ReadonlyMap<string, 'normal' | 'plus'>;
  attackModifiers: AuraAttackModifiers;
  armorBonus: number;
} {
  return {
    conditions: projectedAuraConditions(state, actorId),
    conditionPotencies: projectedAuraConditionPotencies(state, actorId),
    attackModifiers: projectedAuraAttackModifiers(state, actorId),
    armorBonus: projectedAuraArmorBonus(state, actorId),
  };
}

// ── State view adapters ──────────────────────────────────────────────────────

/** Adapt the reducer state to the aura kernel's read surface. */
export function auraStateView(state: EncounterState): AuraStateView {
  const actors: AuraStateView['actors'] = {};
  for (const actor of Object.values(state.actors)) {
    actors[actor.id] = {
      id: actor.id,
      side: actor.side,
      position: actor.position,
      size: actor.size,
      onBattlefield: actor.onBattlefield,
      defeated: actor.defeated,
      traitIds: actor.traitIds,
      talents: actor.talents,
      abilityIds: actor.abilityIds,
      masteredAbilityIds: actor.masteredAbilityIds,
      state: actor.ruleState,
      stance: actor.stance ? { stanceId: actor.stance.stanceId } : null,
      activeEffects: actor.activeEffects.map((effect) => ({
        sourceId: effect.sourceId,
        modifiers: effect.modifiers,
      })),
    };
  }
  return {
    actors,
    entities: Object.fromEntries(Object.values(state.entities).map((entity) => [entity.id, {
      id: entity.id,
      type: entity.type,
      ownerId: entity.ownerId,
      position: entity.positions[0] ?? null,
    }])),
  };
}

/** Adapt the rule runtime view to the aura kernel's read surface. */
export function auraRuntimeView(state: RuleRuntimeState): AuraStateView {
  const actors: AuraStateView['actors'] = {};
  for (const actor of Object.values(state.actors)) {
    actors[actor.id] = {
      id: actor.id,
      side: actor.side,
      position: actor.position,
      size: actor.size,
      defeated: actor.defeated,
      traitIds: actor.traitIds,
      talents: actor.talents,
      abilityIds: actor.abilityIds,
      masteredAbilityIds: actor.masteredAbilityIds,
      state: actor.state,
      stance: actor.stance ? { stanceId: actor.stance.stanceId } : null,
      activeEffects: actor.activeEffects,
    };
  }
  return {
    actors,
    entities: Object.fromEntries(Object.values(state.entities).map((entity) => [entity.id, {
      id: entity.id,
      type: entity.type,
      ownerId: entity.ownerId,
      position: entity.position,
    }])),
  };
}

// ── Foe-trait audit compilation ──────────────────────────────────────────────

const self: RuleSelector = { kind: 'self' };

/** Compile a reviewed aura foe trait (Commander's Aura, Aura of Shielding)
 * into the same typed passive vocabulary the keyword manifest uses. The
 * conditions are already projected whenever the foe owns the source trait, so
 * the program is audit-complete without adding EXECUTE_RULE authority. */
export function compileAuraFoeTraitRecipe(unit: RuleSourceUnit): RuleProgramCompilation | null {
  const definition = auraDefinitionFor(unit.id);
  if (!definition) return null;
  const conditions = definition.conditions ?? [];
  const effects: RuleEffect[] = [...conditions].map((conditionId) => ({
    kind: 'condition',
    target: self,
    conditionId,
    operation: 'apply',
    potency: 'normal',
  } as const));
  const clause: RuleClauseCompilation = {
    id: `${unit.id}:clause:1`,
    label: 'passive',
    text: unit.rulesText,
    effects,
    complete: true,
    unsupportedText: '',
  };
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing: 'passive',
    costs: [],
    tags: [...conditions],
    range: null,
    area: null,
    choices: [],
    steps: [{ id: `${unit.id}:projection`, timing: 'passive', effects }],
  };
  return {
    program: {
      schemaVersion: 1,
      rulesVersion: '1.5',
      id: `program:${unit.id}`,
      sourceId: unit.id,
      source: unit.source,
      name: unit.name,
      actions: [action],
      dependencies: unit.parentId ? [unit.parentId] : [],
      classification: 'encounter',
    },
    clauses: [clause],
    unsupportedClauses: [],
  };
}
