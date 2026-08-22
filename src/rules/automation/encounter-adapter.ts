import type { EncounterActor, EncounterEntity, EncounterHeldDamage, EncounterPendingInterrupt, EncounterState, EncounterTerrainEffect, Position, StatusId } from '../types.js';
import { resourceMaximum } from '../core.js';
import { AREA_INCLUSION_INTERRUPT_IDS, DEFEATED_INTERRUPT_IDS, SAVE_REROLL_INTERRUPT_IDS, TARGETED_BY_ABILITY_INTERRUPT_IDS, USES_ABILITY_INTERRUPT_IDS, WHEN_DAMAGED_INTERRUPT_IDS } from './manual-programs.js';
import type { RuleActorView, RuleMutation, RuleRuntimeState } from './types.js';

const statusIds = new Set<StatusId>(['slashed', 'blind', 'dazed', 'hatred', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable']);
const samePosition = (first: Position, second: Position) => first.x === second.x && first.y === second.y;
const clone = <T>(value: T): T => structuredClone(value);

const traitConditions: Readonly<Record<string, string>> = {
  'stalwart:trait:fortify': 'fortify',
  'vagabond:trait:skirmisher': 'skirmisher',
  'vagabond:trait:dodge': 'dodge',
  'vagabond:trait:finesse': 'finesse',
  'wright:trait:slip': 'slip',
  'wright:trait:aetherwall': 'aetherwall',
  'wright:trait:chain-reaction': 'chain-reaction',
  'wright:trait:aether': 'aether-user',
};

export function encounterConditionSet(actor: EncounterActor) {
  const conditions = new Set<string>(actor.statuses);
  for (const condition of actor.conditions) conditions.add(condition.id);
  for (const effect of actor.activeEffects) {
    for (const modifier of effect.modifiers) if (modifier.operation === 'grant' && typeof modifier.value === 'string') conditions.add(modifier.value);
  }
  for (const traitId of actor.traitIds) if (traitConditions[traitId]) conditions.add(traitConditions[traitId]);
  return conditions;
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

function defeatActor(state: EncounterState, actor: EncounterActor) {
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
  if (actor.side === 'heroes') actor.wounds = Math.min(4, actor.wounds + 1);
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

/** ICON p.104 Counter: 2 damage back for each applied damage instance. The
 * retaliation does not itself trigger counter, so chains cannot recurse. */
export function retaliate(state: EncounterState, attacker: EncounterActor) {
  if (!attacker || attacker.defeated || attacker.ruleState['damage-immune'] === true) return;
  const vigorDamage = Math.min(attacker.vigor, 2);
  attacker.vigor -= vigorDamage;
  attacker.hp = Math.max(0, attacker.hp - (2 - vigorDamage));
  if (attacker.hp <= 0) defeatActor(state, attacker);
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
 * aura takes 1 divine damage (applied directly, so it cannot reflect again). */
export function gentlenessReflection(state: EncounterState, attacker: EncounterActor) {
  if (attacker.defeated || !attacker.onBattlefield || attacker.ruleState['damage-immune'] === true) return;
  if (!inGentlenessAura(state, attacker)) return;
  attacker.hp = Math.max(0, attacker.hp - 1);
  if (attacker.hp <= 0) defeatActor(state, attacker);
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
 * target, including defeat, defiance, counter, and the damage-window hooks.
 * Shared by the immediate path and the held-damage re-application, so a held
 * blow produces exactly the effects it would have produced immediately. */
function applyDeterminedDamage(
  state: EncounterState,
  target: EncounterActor,
  source: EncounterActor | undefined,
  damage: EncounterHeldDamage,
) {
  let { amount, damageType } = damage;
  if (amount <= 0) return;
  const targetConditions = encounterConditionSet(target);
  // ICON p.138: while the user defies death (Boiling Blood), damage cannot
  // reduce the actor past 1 hp. Clamped at application time so a held lethal
  // blow that lands after the interrupt arms the effect behaves exactly like
  // an immediate one.
  if (defyDeathActive(target)) {
    const ceiling = (damageType === 'divine' ? target.hp : target.vigor + target.hp) - 1;
    amount = Math.min(amount, Math.max(0, ceiling));
  }
  if (damageType === 'divine') target.hp = Math.max(0, target.hp - amount);
  else {
    const vigorDamage = Math.min(target.vigor, amount);
    target.vigor -= vigorDamage;
    target.hp = Math.max(0, target.hp - (amount - vigorDamage));
  }
  if (source && source.side !== target.side) target.statuses = target.statuses.filter((status) => status !== 'pacified');
  if (target.hp <= 0 && targetConditions.has('defiance') && damageType !== 'divine') {
    target.hp = 1;
    target.conditions = target.conditions.filter(({ id }) => id !== 'defiance');
    target.ruleState['damage-immune'] = true;
    target.ruleStateOwners['damage-immune'] = damage.sourceActorId;
  } else if (target.hp <= 0) defeatActor(state, target);
  if (source && source.side !== target.side && targetConditions.has('counter')) retaliate(state, source);
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
  if (source && source.id !== target.id) gentlenessReflection(state, source);
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
  applyDeterminedDamage(state, target, source, held);
}

function applyDamage(state: EncounterState, mutation: Extract<RuleMutation, { kind: 'damage' }>) {
  const target = state.actors[mutation.actorId];
  const source = state.actors[mutation.sourceActorId];
  if (!target || target.defeated || target.ruleState['damage-immune'] === true) return;
  if (mutation.damageType === 'sacrifice') {
    target.hp = Math.max(1, target.hp - mutation.amount);
    return;
  }
  let amount = mutation.amount;
  const sourceConditions = source ? encounterConditionSet(source) : new Set<string>();
  const targetConditions = encounterConditionSet(target);
  if (targetConditions.has('intangible') && source && source.side !== target.side) return;
  if (targetConditions.has('dodge') && (mutation.delivery === 'miss' || mutation.delivery === 'area' || mutation.delivery === 'save-success')) return;
  if (mutation.damageType !== 'divine' && mutation.damageType !== 'piercing' && sourceConditions.has('weakened')) amount = Math.max(0, amount - 2);
  if (mutation.damageType !== 'divine' && sourceConditions.has('pacified')) amount = Math.ceil(amount / 2);
  if (mutation.damageType !== 'divine' && hatredDivertsDamage(state, source, target)) amount = Math.ceil(amount / 2);
  if (amount > 0 && targetConditions.has('vulnerable')) amount += 1;
  if (mutation.damageType === 'normal') amount = Math.max(0, amount - target.armor);
  const sourceDistance = source && source.onBattlefield && target.onBattlefield ? Math.max(Math.abs(source.position.x - target.position.x), Math.abs(source.position.y - target.position.y)) : 0;
  const aetherwall = targetConditions.has('aetherwall') && sourceDistance > 2;
  if (mutation.damageType !== 'divine' && (targetConditions.has('resistance') || aetherwall || (!mutation.ignoreCover && target.ruleState.cover === true))) amount = Math.ceil(amount / 2);
  // ICON p.107: damage from a foe is held while the target has an available
  // when-damaged interrupt — the damage is determined but not applied yet, and
  // the interrupt resolves before it applies (p.128 Righteous Disdain). A
  // lethal blow is also held when the target has an available `defeated`
  // interrupt (Boiling Blood, p.138) so the character can fight on before
  // being defeated. The held damage applies after the interrupt resolves, or
  // at the end of the turn; an interrupt that re-deals the damage consumes it.
  const whenDamagedAvailable = hasAvailableWhenDamagedInterrupt(target);
  const defeatedAvailable = hasAvailableDefeatedInterrupt(target) && (mutation.damageType === 'divine' ? amount >= target.hp : amount >= target.vigor + target.hp);
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
        sourceActorId: mutation.sourceActorId,
        sourceId: mutation.sourceId,
        instance: mutation.instance,
        delivery: mutation.delivery,
        ignoreCover: mutation.ignoreCover,
      },
    });
    return;
  }
  applyDeterminedDamage(state, target, source, {
    amount,
    damageType: mutation.damageType,
    sourceActorId: mutation.sourceActorId,
    sourceId: mutation.sourceId,
    instance: mutation.instance,
    delivery: mutation.delivery,
    ignoreCover: mutation.ignoreCover,
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

function applyMovement(state: EncounterState, mutation: Extract<RuleMutation, { kind: 'move' }>) {
  const actor = state.actors[mutation.actorId];
  if (!actor || actor.defeated || encounterConditionSet(actor).has('immobile')) return;
  if (mutation.movement === 'remove') {
    actor.onBattlefield = false;
    return;
  }
  if (mutation.movement === 'place') {
    // Placement is forced movement (a throw, a summon), not a teleport, so
    // Rampart (p.104, which blocks dashing, flying, and teleporting only)
    // does not apply.
    const destination = mutation.positions.at(-1);
    if (destination) {
      actor.position = { ...destination };
      actor.onBattlefield = true;
    }
    return;
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
    return;
  }
  if (mutation.positions.length > 0) {
    actor.position = { ...mutation.positions.at(-1)! };
    actor.onBattlefield = true;
    return;
  }
  const resolved = shoveResolution(state, mutation);
  if (resolved) actor.position = resolved.position;
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
      if (actor && !actor.defeated && !encounterConditionSet(actor).has('shattered')) actor.vigor = Math.min(mutation.uncapped ? Number.MAX_SAFE_INTEGER : actor.vitality, actor.vigor + mutation.amount);
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
      if (actor && !actor.defeated) actor.vigor = Math.min(actor.vitality, actor.vigor + (actor.hp <= actor.baseMaxHp / 2 ? actor.vitality : 4));
      break;
    }
    case 'move': applyMovement(state, mutation); break;
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
