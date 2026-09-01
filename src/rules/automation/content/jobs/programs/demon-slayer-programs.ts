import { RuleProgramViolation } from '../../../kernels/runtime.js';
import { hasMastery } from '../../../kernels/mastery.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { Position } from '../../../../types.js';
import type { RuleDuration, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, lineCells, orthogonalNeighbors, sameCell, squareArea,
  self, attackTarget, constant, damageDie, fray, normalDamage,
  distance, withinGrid, sourceActor,
  damageMutation, conditionMutation, rushMutation, shoveMutation, stateMutation,
  notHeroic, action, compilation,
} from '../../../primitives/job-kit.js';
import { rushTowardFoes } from '../../../kernels/evaluate-query.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';
import { resolveAttackTarget, resolveSourceActor } from '../../glue/reference-authoring.js';
import { vigilanceRushOncePerTurnKey } from '../../../kernels/use-ledger.js';
import { consumeUsageMutation, ledgerAvailable } from '../../../primitives/usage.js';

/**
 * Independently reviewed Demon Slayer ability implementations (ICON p.128–130).
 *
 * Every ability below has typed costs, targets, ranges, and tags from the
 * source catalog plus a hand-authored typed RuleProgram. Lines and blasts use
 * the shared deterministic area geometry (area-geometry.ts); stance refresh,
 * the Soul Blade aether slash, and the Gates of Hell vigilance rush are
 * caller-asserted actions; Six Hells Trigram, Comet's thrown weapon, and
 * Wicked Sheath's power die resolve through reducer lifecycle hooks so the
 * delayed and round-start behaviors stay deterministic and replayable.
 *
 * Fidelity notes that stay visible on the resolved event (the full source
 * text is preserved on every RULE_MUTATIONS_APPLIED event):
 * - Area effects apply to every character in the area including the attack
 *   space, matching the source's "Area effect" wording (as in Land Waster).
 * - The second area of Demon Cutter / Draken Cross is placed at a
 *   deterministic non-overlapping center when the caller does not supply one.
 * - Slow-turn restrictions from delay effects are recorded on rule state but
 *   not yet enforced by the reducer's action gates.
 * - Counter retaliation and vigilance charge spends are represented as typed
 *   conditions/resources; their consumption hooks are not yet wired into the
 *   damage/movement pipeline.
 */

/** Actors-only occupancy check: Demon Slayer rushes ignore entities, so the
 * thrown Comet weapon does not block its follow-up rush. */
const occupied = (position: Position, context: Parameters<RuleResolver>[0], excludeId: string) =>
  Object.values(context.state.actors).some((actor) => actor.id !== excludeId && actor.position && sameCell(actor.position, position));

/** Rush `steps` cells in `direction`, stopping at the grid edge or occupancy.
 * `from` lets ordered-effect callers plan from the CURRENT point of the
 * sequence (e.g. the position after an earlier rush) instead of the live
 * pre-command position — without one, every call starts at the recorded
 * encounter position, exactly as the shared ability-move authority would. */
function plannedRush(context: Parameters<RuleResolver>[0], actorId: string, steps: number, direction: Position, from?: Position): Position[] {
  const source = sourceActor(context, actorId);
  if (!source?.position) return [];
  const path: Position[] = [];
  let position = from ? { ...from } : { ...source.position };
  for (let step = 0; step < steps; step += 1) {
    const next = { x: position.x + direction.x, y: position.y + direction.y };
    if (!withinGrid(next, context) || occupied(next, context, actorId)) break;
    path.push(next);
    position = next;
  }
  return path;
}

/** ICON p.128: line-3 true-strike attack; target slashed; line-area fray; Charge/Heroic repeats a second non-overlapping line. */
const demonCutterEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position || !target || !target.position) return [];
  const mutations: RuleMutation[] = [];
  let sourcePosition = source.position;
  // Talent 2 (p.128): "Your can rush 1 before using Demon Cutter. Charge:
  // Rush 3 instead." The first program-level talent variant (F7): a
  // pre-ability movement that changes the line attack's origin, so it cannot
  // be a post-mutation fold effect — the program reads the equipped choice
  // through the projected `talents` surface and emits the rush itself, gated
  // on the talent (never on the charge trigger alone). The direction is a
  // caller choice, defaulting to the deterministic rush toward the nearest
  // foe.
  if (source.talents?.['demon-slayer:demon-cutter'] === 2) {
    const rushDistance = context.triggers?.has('charge') ? 3 : 1;
    const direction = context.input.directions?.['rush-before'] ?? rushTowardFoes(context, source.position);
    const path = plannedRush(context, source.id, rushDistance, direction);
    if (path.length > 0) {
      mutations.push(rushMutation(context, source.id, path));
      sourcePosition = { ...path[path.length - 1]! };
    }
  }
  const targetPosition = target.position;
  const primaryDirection = context.input.directions?.['line-direction'] ?? axisDirection(sourcePosition, targetPosition);
  const line = lineCells(sourcePosition, primaryDirection, 3);
  if (!line.some((cell) => sameCell(cell, targetPosition))) {
    throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s Line 3 must include the attack target; attack along an axis toward it.');
  }
  mutations.push(conditionMutation(context, target.id, 'slashed'));
  const areaFray = (cells: Position[]) => {
    for (const foe of Object.values(context.state.actors)) {
      if (foe.side === source.side || !foe.position || !cells.some((cell) => sameCell(cell, foe.position!))) continue;
      mutations.push(damageMutation(context, foe.id, source.fray, 'area'));
    }
  };
  areaFray(line);
  if (context.triggers?.has('charge') || context.triggers?.has('heroic')) {
    const perpendicular: Position = primaryDirection.x !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const secondDirection = context.input.directions?.['second-line'] ?? perpendicular;
    const secondLine = lineCells(sourcePosition, secondDirection, 3);
    const overlaps = secondLine.some((cell) => line.some((first) => sameCell(cell, first)));
    if (!overlaps) areaFray(secondLine);
  }
  return mutations;
};

/** ICON p.128: medium blast area damage, thrown-weapon object with rampart, and a Charge/Heroic rush. */
const cometEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const direction = context.input.directions?.['throw-direction'] ?? rushTowardFoes(context, source.position);
  const defaultCenter = { x: source.position.x + direction.x * 3, y: source.position.y + direction.y * 3 };
  const center = context.input.positions?.['area-center']?.[0] ?? defaultCenter;
  if (!withinGrid(center, context)) throw new RuleProgramViolation('choice.position-range', 'Comet needs an area center inside the battlefield.');
  if (distance(source.position, center) > 3) throw new RuleProgramViolation('choice.position-range', 'Comet needs an area center within range 3.');
  const blast = squareArea(center, 2);
  const mutations: RuleMutation[] = [];
  for (const character of Object.values(context.state.actors)) {
    if (character.id === source.id || !character.position || !blast.some((cell) => sameCell(cell, character.position!))) continue;
    mutations.push(damageMutation(context, character.id, 2, 'area'));
  }
  const blocked = (position: Position) => occupied(position, context, source.id)
    || Object.values(context.state.entities).some((entity) => entity.position && sameCell(entity.position, position));
  const freeCells = [center, ...orthogonalNeighbors(center), ...squareArea(center, 1).filter((cell) => !sameCell(cell, center))];
  const placement = freeCells.find((cell) => withinGrid(cell, context) && !blocked(cell)) ?? center;
  mutations.push({ kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: 'object', ownerId: source.id, positions: [placement], count: 1, state: { thrownWeapon: true } });
  for (const neighbor of orthogonalNeighbors(placement)) {
    if (withinGrid(neighbor, context)) {
      mutations.push({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: source.id, operation: 'create', terrain: 'rampart', positions: [neighbor], height: null });
    }
  }
  mutations.push(stateMutation(context, source.id, 'weapon-deployed', true));
  if (context.triggers?.has('charge') || context.triggers?.has('heroic')) {
    const path = plannedRush(context, source.id, 3, direction);
    if (path.length > 0) mutations.push(rushMutation(context, source.id, path));
  }
  return mutations;
};

/** Deterministic non-overlapping blast center within `blastRange` of the
 * POST-RUSH `origin`, sized `radius`, avoiding EVERY area already created by
 * this use (the source "The areas cannot overlap" constraint). Nearest legal
 * cell wins; grid bounds are enforced by construction. A caller-supplied
 * center is NOT routed through here — it is validated by the resolver's
 * authoritative geometry checks (battlefield, range from the post-rush
 * origin, non-overlap). */
function secondBlastCenter(context: Parameters<RuleResolver>[0], origin: Position, areas: Position[][], radius: number, blastRange: number): Position | null {
  const candidates: Position[] = [];
  for (let dy = -blastRange; dy <= blastRange; dy += 1) {
    for (let dx = -blastRange; dx <= blastRange; dx += 1) {
      const cell = { x: origin.x + dx, y: origin.y + dy };
      if (withinGrid(cell, context) && distance(origin, cell) <= blastRange) candidates.push(cell);
    }
  }
  candidates.sort((a, b) => distance(a, origin) - distance(b, origin) || a.x - b.x || a.y - b.y);
  for (const cell of candidates) {
    const blast = squareArea(cell, radius);
    if (areas.some((prior) => blast.some((candidate) => prior.some((first) => sameCell(candidate, first))))) continue;
    return cell;
  }
  return null;
}

/** ICON p.128: small-blast attack (hit 2[D]+fray / miss fray / crit +[D])
 * with an OPTIONAL Effect and a Charge/Heroic repeat.
 *
 * Re-read fidelity semantics:
 * - The Effect is ONE optional operation: "You may rush 1, then target
 *   another small blast area in range 3 with area effect: fray damage. The
 *   areas cannot overlap." Invoking it rushes 1, then selects another blast
 *   center from the POSITION AFTER that rush. The center's legality
 *   (battlefield, effective blast range, non-overlap with every prior area
 *   of this use) is enforced for BOTH supplied centers and the deterministic
 *   nearest fallback — a malformed supplied center fails closed.
 * - "Charge or Heroic: Gains true strike, and may repeat the effect." The
 *   true strike folds into the attack roll below (authoritative Charge =
 *   durable slow-turn fact; Heroic = caller declaration). The repeat is the
 *   WHOLE Effect performed again (its own rush 1 + its own area) — never a
 *   re-damage of an existing blast — and is itself optional.
 * - Talent II (p.128): "Charge: Increase range to 5, and all areas may be
 *   increased to medium blasts instead." "May … instead" is a REAL player
 *   choice (larger areas can include unintended characters/terrain), so the
 *   medium upgrade is a recorded durable decision
 *   (`booleans['medium-areas']`) — ONE decision applying to every area this
 *   use creates ("all areas"), and the player may decline. The range half
 *   folds through the generic charge-gated range rule at the command gates;
 *   `blastRange` here is the same widened authority used by the Effect
 *   center validation.
 * - Talent I: "Exceed: Deal fray damage again to all characters in any area
 *   created by this ability." The exceed fact is this ability's OWN attack
 *   roll at 15+ (p.93) — derived from the authoritative roll, never a caller
 *   assertion.
 */
const drakenCrossEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position || !target || !target.position) return [];
  const mutations: RuleMutation[] = [];
  const charged = source.talents?.['demon-slayer:draken-cross'] === 2
    && context.triggers?.has('charge');
  const medium = charged === true && context.input.booleans?.['medium-areas'] === true;
  const radius = medium ? 2 : 1;
  const blastRange = charged ? 5 : 3;
  const areas: Position[][] = [];
  const blastFray = (cells: Position[]) => {
    for (const foe of Object.values(context.state.actors)) {
      if (foe.side === source.side || !foe.position || !cells.some((cell) => sameCell(cell, foe.position!))) continue;
      mutations.push(damageMutation(context, foe.id, source.fray, 'area'));
    }
  };
  // Primary blast (the header's attack space); the area effect includes the
  // attack space (reviewed as in Land Waster).
  const primary = squareArea(target.position, radius);
  areas.push(primary);
  blastFray(primary);
  // One invocation of the optional Effect: rush 1, then one more area whose
  // legality is judged from the POST-RUSH origin.
  let origin = source.position;
  const invocation = (index: number) => {
    const direction = context.input.directions?.[`effect-rush-${index}`] ?? rushTowardFoes(context, origin);
    const path = plannedRush(context, source.id, 1, direction, origin);
    if (path.length > 0) {
      mutations.push(rushMutation(context, source.id, path));
      origin = { ...path[path.length - 1]! };
    }
    const supplied = context.input.positions?.[`effect-area-${index}`]?.[0];
    const center = supplied ?? secondBlastCenter(context, origin, areas, radius, blastRange);
    // No legal placement (the deterministic search found none without
    // overlapping): the Effect cannot resolve here — decline the invocation.
    if (center === null) return;
    const blast = squareArea(center, radius);
    if (!blast.every((cell) => withinGrid(cell, context))) {
      throw new RuleProgramViolation('choice.position-range', `Draken Cross effect area ${index} must be fully inside the battlefield.`);
    }
    if (distance(origin, center) > blastRange) {
      throw new RuleProgramViolation('choice.position-range', `Draken Cross effect area ${index} must be within range ${blastRange} of the position after its rush.`);
    }
    if (blast.some((cell) => areas.some((prior) => prior.some((first) => sameCell(cell, first))))) {
      throw new RuleProgramViolation('choice.area-overlap', `Draken Cross effect area ${index} cannot overlap an area already created by this use.`);
    }
    areas.push(blast);
    blastFray(blast);
  };
  // The Effect is entirely optional — a legal use must resolve without it.
  if (context.input.booleans?.['effect'] === true) invocation(1);
  // "Charge or Heroic: … may repeat the effect" — a SECOND independent
  // invocation with its own recorded rush/center, gated on the authoritative
  // Charge fact / declared Heroic AND a recorded repeat decision.
  if ((context.triggers?.has('charge') || context.triggers?.has('heroic')) && context.input.booleans?.['repeat'] === true) invocation(2);
  // Attack (p.128): hit 2[D]+fray, miss fray, crit +1[D]. "Charge or
  // Heroic: Gains true strike" folds into the roll below. The roll is
  // resolved AFTER the optional areas so the exceed fact (Talent I) covers
  // every area this use created; the attack itself precedes any rush in
  // source order, so the pre-flow view is the correct observation point.
  const trueStrike = (context.triggers?.has('charge') || context.triggers?.has('heroic')) === true;
  const roll = resolveAuthoritativeAttack(context, source, target, { trueStrike });
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  if (roll.critical) mutations.push(damageMutation(context, target.id, context.dice.die(roll.damageDie), 'hit'));
  // Talent I (p.128): "Exceed: Deal fray damage again to all characters in
  // any area created by this ability."
  const attackMutation = roll.attackMutation as Extract<RuleMutation, { kind: 'attack' }>;
  if (attackMutation.exceed === true && (source.talents?.['demon-slayer:draken-cross'] ?? 0) >= 1) {
    for (const area of areas) blastFray(area);
  }
  return mutations;
};

/** ICON p.128: interrupt that splits determined damage with resistance and grants sturdy. */
const righteousDisdain: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const allyId = context.input.actorIds?.target?.[0];
  if (!source || !source.position || !allyId) throw new RuleProgramViolation('choice.actor-count', 'Righteous Disdain requires an ally target.');
  const ally = sourceActor(context, allyId);
  if (!ally || ally.side !== source.side || !ally.position) throw new RuleProgramViolation('choice.actor-range', 'Righteous Disdain requires an ally in range 2.');
  if (distance(source.position, ally.position) > 2) throw new RuleProgramViolation('choice.actor-range', 'Righteous Disdain requires an ally in range 2.');
  const incoming = Math.max(0, Math.floor(context.input.numbers?.damage ?? 0));
  const shared = Math.ceil(incoming / 2);
  const sturdy: RuleDuration = { kind: 'turn-end', actor: self, turns: 1 };
  const mutations: RuleMutation[] = [
    damageMutation(context, source.id, shared, 'effect'),
    damageMutation(context, ally.id, shared, 'effect'),
    conditionMutation(context, source.id, 'sturdy', 'normal', sturdy),
    conditionMutation(context, ally.id, 'sturdy', 'normal', sturdy),
  ];
  if (context.triggers?.has('heroic')) mutations.push({ kind: 'vigor', sourceId: context.sourceId, actorId: source.id, amount: 4, uncapped: false });
  return mutations;
};

/** ICON p.129: rush 1 twice, dealing 2 damage to adjacent foes (all of them when the user has not attacked this turn). */
const demonClaw: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const direction = context.input.directions?.['rush1'] ?? rushTowardFoes(context, source.position);
  const special = !source.attacked;
  // ICON p.129 Demon Claw mastery (RAGING DEMON): "Demon Claw's damage
  // increases by 1 for every 25% of your maximum hp you are missing, up to a
  // maximum of +3 damage." The missing-HP percentage is a % HEALTH
  // calculation, so p.107's rule applies: "Any ability that costs or damages
  // a certain percent of health always considers maximum BASE hp, and not
  // max hp based on wounds". The denominator (and the missing amount) is
  // therefore the BASE class maximum — never the wounds-adjusted maximum the
  // bloodied/quarter STATE thresholds use (hp-threshold kernel) — so a
  // wound's temporary max reduction counts as missing hp for the bonus. The
  // flat bonus reads the mastered gate (parent equipped AND mastered through
  // the shared hasMastery surface) and applies to every 2-damage instance
  // this ability emits.
  const baseMaximum = context.encounterState ? context.encounterState.actors[source.id]?.baseMaxHp ?? source.maxHp : source.maxHp;
  const ragingBonus = hasMastery(source, 'demon-slayer:demon-claw')
    ? Math.min(3, Math.floor((baseMaximum - source.hp) / (baseMaximum / 4)))
    : 0;
  const mutations: RuleMutation[] = [];
  const damaged = new Set<string>();
  const weakened = new Set<string>();
  let position = { ...source.position };
  for (let index = 0; index < 2; index += 1) {
    const next = { x: position.x + direction.x, y: position.y + direction.y };
    if (!withinGrid(next, context) || occupied(next, context, source.id)) break;
    mutations.push(rushMutation(context, source.id, [next]));
    position = next;
    const adjacentFoes = Object.values(context.state.actors)
      .filter((candidate) => candidate.id !== source.id && candidate.side !== source.side && candidate.position && distance(candidate.position, position) <= 1 && !damaged.has(candidate.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const targets = special ? adjacentFoes : adjacentFoes.slice(0, 1);
    for (const foe of targets) {
      mutations.push(damageMutation(context, foe.id, 2 + ragingBonus, 'effect'));
      damaged.add(foe.id);
    }
    if (index === 0 && (context.triggers?.has('charge') || context.triggers?.has('heroic'))) {
      for (const adjacent of Object.values(context.state.actors)) {
        if (adjacent.id === source.id || !adjacent.position || distance(adjacent.position, position) > 1 || weakened.has(adjacent.id)) continue;
        mutations.push(conditionMutation(context, adjacent.id, 'weakened'));
        weakened.add(adjacent.id);
      }
    }
  }
  return mutations;
};

/** ICON p.129: rush 2, gain vigilance, and counter until the start of the user's next turn. */
const gatesOfHell: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const direction = context.input.directions?.['rush-direction'] ?? { x: 1, y: 0 };
  const path = plannedRush(context, source.id, 2, direction);
  const mutations: RuleMutation[] = [];
  if (path.length > 0) mutations.push(rushMutation(context, source.id, path));
  const vigilance = context.triggers?.has('heroic') ? 2 : 1;
  mutations.push({ kind: 'resource', sourceId: context.sourceId, actorId: source.id, resourceId: 'vigilance', operation: 'gain', amount: vigilance, minimum: 0, maximum: null });
  mutations.push(conditionMutation(context, source.id, 'counter', 'normal', { kind: 'turn-start', actor: self, turns: 1 }));
  return mutations;
};

/** ICON p.129: may rush 2 after activating vigilance, once per turn. */
const gatesOfHellVigilanceRush: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  // The once-per-turn gate routes through the U16 `any-turn` ledger
  // (vigilanceRushOncePerTurnKey): availability via the U16 ledger read over the
  // projected state bag (ledgerAvailable), consume via the U16 consume mutation
  // riding this event. The mark reopens at every turn start via
  // refreshAnyTurnLedgersForAll — never a raw ruleState boolean.
  if (!ledgerAvailable({ ruleState: source.state }, vigilanceRushOncePerTurnKey())) throw new RuleProgramViolation('rule.turn-limit', 'The vigilance rush can only be used once a turn.');
  const direction = context.input.directions?.['rush-direction'] ?? { x: 1, y: 0 };
  const path = plannedRush(context, source.id, 2, direction);
  const mutations: RuleMutation[] = [];
  if (path.length > 0) mutations.push(rushMutation(context, source.id, path));
  mutations.push(consumeUsageMutation(context.sourceId, source.id, vigilanceRushOncePerTurnKey()));
  return mutations;
};

/** ICON p.129: enter the Soul Blade stance with a d6 power die at 2. */
const soulBladeEnter: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const adjacentFoes = Object.values(context.state.actors)
    .filter((candidate) => candidate.id !== source.id && candidate.side !== source.side && candidate.position && distance(candidate.position!, source.position!) <= 1).length;
  const bonus = context.triggers?.has('heroic') ? adjacentFoes : 0;
  const die = Math.min(6, 2 + bonus);
  return [
    { kind: 'stance', sourceId: context.sourceId, sourceActorId: source.id, operation: 'enter', actorId: source.id, stanceId: 'soul-blade', state: {} },
    stateMutation(context, source.id, 'soul-blade:die', die),
  ];
};

/** ICON p.129: refresh ticks the power die up by 1. */
const soulBladeRefresh: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source) return [];
  const die = Number(source.state['soul-blade:die'] ?? 2);
  return [
    { kind: 'stance', sourceId: context.sourceId, sourceActorId: source.id, operation: 'refresh', actorId: source.id, stanceId: 'soul-blade', state: {} },
    stateMutation(context, source.id, 'soul-blade:die', Math.min(6, die + 1)),
  ];
};

/** ICON p.129: the aether slash — a line-3 true-strike area that must include the target. */
const soulBladeSlash: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position || !target || !target.position) return [];
  const tick = Math.max(1, Math.floor(context.input.numbers?.tick ?? 0));
  const die = Number(source.state['soul-blade:die'] ?? 0);
  if (tick > die) throw new RuleProgramViolation('choice.number-maximum', `Soul Blade can only tick the die down by ${die}.`);
  const sourcePosition = source.position;
  const targetPosition = target.position;
  const direction = context.input.directions?.['slash-direction'] ?? axisDirection(sourcePosition, targetPosition);
  const line = lineCells(sourcePosition, direction, 3);
  if (!line.some((cell) => sameCell(cell, targetPosition))) {
    throw new RuleProgramViolation('choice.position-range', 'The aether slash Line 3 must include your target.');
  }
  const remaining = die - tick;
  const damage = tick === 6 ? tick + 3 : tick;
  const mutations: RuleMutation[] = [];
  for (const foe of Object.values(context.state.actors)) {
    if (foe.side === source.side || !foe.position || !line.some((cell) => sameCell(cell, foe.position!))) continue;
    mutations.push(damageMutation(context, foe.id, damage, 'area'));
  }
  if (tick >= 3) mutations.push({ kind: 'vigor', sourceId: context.sourceId, actorId: source.id, amount: remaining + (tick === 6 ? 3 : 0), uncapped: false });
  if (remaining === 0) {
    mutations.push({ kind: 'stance', sourceId: context.sourceId, sourceActorId: source.id, operation: 'exit', actorId: source.id, stanceId: 'soul-blade', state: {} });
  }
  mutations.push(stateMutation(context, source.id, 'soul-blade:die', remaining));
  return mutations;
};

/** ICON p.129: burst-2 (self) terrain effect that ends the turn and activates at the start of the user's next turn. */
const sixHellsTrigram: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const mutations: RuleMutation[] = [];
  // The area lasts until this ability is used again: remove any previous
  // trigram (and its heroic rampart) before placing the new one.
  for (const effect of context.state.terrainEffects) {
    if (effect.terrain === 'six-hells-trigram' && effect.ownerId === source.id) {
      mutations.push({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: source.id, operation: 'remove', terrain: 'six-hells-trigram', positions: [...effect.positions], height: null });
      mutations.push({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: source.id, operation: 'remove', terrain: 'rampart', positions: [...effect.positions], height: null });
    }
  }
  const area = squareArea(source.position, 2);
  mutations.push({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: source.id, operation: 'create', terrain: 'six-hells-trigram', positions: area, height: null });
  mutations.push(stateMutation(context, source.id, 'six-hells:stage', 'pending'));
  mutations.push(stateMutation(context, source.id, 'six-hells:heroic', context.triggers?.has('heroic') ? true : false));
  mutations.push(stateMutation(context, source.id, 'six-hells:slow-turn', true));
  return mutations;
};

/** ICON p.130: Wicked Sheath — rush per charge (Charge/Heroic), attack-boosting shove, and the charged-weapon state. */
const wickedSheath: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position) return [];
  const die = Number(source.resources['wicked-sheath-die'] ?? 0);
  const mutations: RuleMutation[] = [];
  if ((context.triggers?.has('charge') || context.triggers?.has('heroic')) && die > 0) {
    const direction = context.input.directions?.['rush-direction'] ?? { x: 1, y: 0 };
    const path = plannedRush(context, source.id, die, direction);
    if (path.length > 0) mutations.push(rushMutation(context, source.id, path));
  }
  // The shove is part of the attack step's on-hit effects ("On hit: fray
  // and shove 1"); the resolver handles the charge/heroic rush, the
  // post-attack charged-weapon state, and Talent I's extra shove.
  mutations.push(stateMutation(context, source.id, 'wicked-sheath:charged', true));
  // ICON p.130 Wicked Sheath talent 1: "Also shove your foe 1 for every
  // charge on the die." An additional shove gated on TI being equipped.
  if ((source.talents?.['demon-slayer:wicked-sheath'] ?? 0) >= 1 && die > 0 && target?.position) {
    const direction = axisDirection(source.position, target.position);
    mutations.push(shoveMutation(context, target.id, die, direction));
  }
  return mutations;
};

export const DEMON_SLAYER_RULE_RESOLVERS: RuleResolverRegistry = {
  'demon-slayer:demon-cutter:effects': demonCutterEffects,
  'demon-slayer:comet': cometEffects,
  'demon-slayer:draken-cross:effects': drakenCrossEffects,
  'demon-slayer:righteous-disdain': righteousDisdain,
  'demon-slayer:demon-claw': demonClaw,
  'demon-slayer:gates-of-hell': gatesOfHell,
  'demon-slayer:gates-of-hell:vigilance-rush': gatesOfHellVigilanceRush,
  'demon-slayer:soul-blade:enter': soulBladeEnter,
  'demon-slayer:soul-blade:refresh': soulBladeRefresh,
  'demon-slayer:soul-blade:slash': soulBladeSlash,
  'demon-slayer:six-hells-trigram': sixHellsTrigram,
  'demon-slayer:wicked-sheath': wickedSheath,
};

export const DEMON_SLAYER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'demon-slayer:demon-cutter': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'true strike', 'line'],
    range: constant(3),
    resolverId: 'demon-slayer:demon-cutter:effects',
    steps: [{
      id: 'attack', timing: 'use', effects: [{
        kind: 'attack', target: attackTarget, trueStrike: true,
        onHit: [normalDamage({ kind: 'add', values: [damageDie(1), fray()] })],
        onMiss: [normalDamage(fray(), 'miss')],
        onCritical: [normalDamage(damageDie(1))],
      }],
    }],
  })], ['effect', 'on hit', 'miss', 'effect', 'area effect', 'charge or heroic']),

  'demon-slayer:comet': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['medium blast', 'object', 'range'],
    range: constant(3),
    resolverId: 'demon-slayer:comet',
    steps: [],
  })], ['area effect', 'effect', 'object effect', 'charge or heroic']),

  'demon-slayer:draken-cross': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack', 'small blast', 'range'],
    range: constant(3),
    resolverId: 'demon-slayer:draken-cross:effects',
    // The attack roll lives in the resolver: the base attack, the
    // Charge/Heroic true strike, the crit die, and the Exceed fact (Talent I
    // re-frays every created area on the ability's own 15+ roll) all read the
    // SAME authoritative roll — the VM could never share one exceed fact
    // across the resolver's area bookkeeping.
    steps: [],
  })], ['effect', 'on hit', 'miss', 'area effect', 'effect', 'charge or heroic']),

  'demon-slayer:righteous-disdain': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: ['interrupt', 'range'],
    range: constant(2),
    resolverId: 'demon-slayer:righteous-disdain',
    steps: [],
  })], ['effect', 'trigger', 'effect', 'heroic']),

  'demon-slayer:demon-claw': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['true strike'],
    resolverId: 'demon-slayer:demon-claw',
    steps: [],
  })], ['effect', 'effect', 'special', 'charge or heroic']),

  'demon-slayer:gates-of-hell': (unit) => compilation(unit, [
    action({
      name: unit.name,
      timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: [],
      resolverId: 'demon-slayer:gates-of-hell',
      steps: [],
    }),
    action({
      id: 'vigilance-rush',
      name: 'Vigilance Rush',
      timing: 'targeted',
      costs: [],
      tags: ['movement'],
      resolverId: 'demon-slayer:gates-of-hell:vigilance-rush',
      steps: [],
    }),
  ], ['effect', 'effect', 'effect', 'heroic']),

  'demon-slayer:soul-blade': (unit) => compilation(unit, [
    action({
      name: unit.name,
      timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['stance'],
      resolverId: 'demon-slayer:soul-blade:enter',
      steps: [],
    }),
    action({
      id: 'stance-refresh',
      name: 'Refresh',
      timing: 'stance-refresh',
      costs: [],
      tags: ['stance'],
      resolverId: 'demon-slayer:soul-blade:refresh',
      steps: [],
    }),
    action({
      id: 'aether-slash',
      name: 'Aether Slash',
      timing: 'targeted',
      costs: [],
      tags: ['area'],
      range: constant(3),
      resolverId: 'demon-slayer:soul-blade:slash',
      steps: [],
    }),
  ], ['stance', 'effect', 'refresh', 'effect', 'heroic']),

  'demon-slayer:six-hells-trigram': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['end turn', 'terrain effect', 'delay'],
    resolverId: 'demon-slayer:six-hells-trigram',
    steps: [],
  })], ['effect', 'terrain effect', 'delay', 'effect', 'heroic']),

  'demon-slayer:wicked-sheath': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'true strike', 'power die'],
    resolverId: 'demon-slayer:wicked-sheath',
    steps: [{
      id: 'attack', timing: 'use', effects: [{
        kind: 'attack', target: attackTarget, trueStrike: true,
        boons: { kind: 'resource', actor: self, resourceId: 'wicked-sheath-die' },
        onHit: [
          normalDamage({ kind: 'add', values: [fray(), { kind: 'multiply', values: [damageDie(1), { kind: 'resource', actor: self, resourceId: 'wicked-sheath-die' }] }] }),
          { kind: 'move', target: attackTarget, movement: 'shove', distance: { kind: 'add', values: [constant(1), { kind: 'resource', actor: self, resourceId: 'wicked-sheath-die' }] } },
        ],
        onMiss: [normalDamage(fray(), 'miss')],
        onCritical: [normalDamage(damageDie(1))],
      }],
    }],
  })], ['effect', 'on hit', 'miss', 'effect', 'effect', 'charge or heroic']),
};

