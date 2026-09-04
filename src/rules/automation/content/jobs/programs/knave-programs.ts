import { resolveChoice } from '../../../kernels/choice.js';
import { resolveCapturedPositionListChoice } from '../../../kernels/choice.js';
import { contextAfterMutations } from '../../../kernels/execute-flow.js';
import { RuleProgramViolation } from '../../../kernels/runtime.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';
import { auraDefinitionFor, auraRuntimeView, isInAura } from '../../../kernels/aura.js';
import { hasMastery } from '../../../kernels/mastery.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { Position } from '../../../../types.js';
import type { RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, sameCell,
  constant, attackStep, comboCost,
  distance, sourceActor, impassable, walk, ringAround,
  damageMutation, conditionMutation, stateMutation, vigorMutation, cureMutations,
  resourceMutation, stanceMutation, markMutation,
  shoveMutation, rushMutation, placeMutation, removeMutation,
  gambleD6,
  untilNextTurnEnd, action, compilation,
} from '../../../primitives/job-kit.js';
import { evaluateActorQuery, evaluatePositions, nearestCandidates } from '../../../kernels/evaluate-query.js';
import { anchorFromPosition } from '../../../primitives/anchor.js';
import { resolveCapturedSelectedActors, resolveTriggerSource, resolveAttackTarget, resolveSourceActor } from '../../glue/reference-authoring.js';

/**
 * Independently reviewed Knave ability implementations (ICON p.139–144).
 *
 * Every ability below has typed costs, targets, ranges, and tags from the
 * source catalog plus a hand-authored typed RuleProgram. Combat stances
 * (Riposte, Dark Knight), marks with delayed/reactive triggers (Intimidate),
 * gamble rolls, and status-count gating (Bleak Mercy) resolve through named
 * deterministic resolvers and reducer lifecycle hooks so they stay replayable.
 *
 * The Combo upgrades are modeled as separate actions with a `combo` resource
 * cost, executable through EXECUTE_RULE (action id `combo`) the same way
 * stance-refresh and interrupt sub-actions are; USE_ABILITY resolves the base
 * ability. Fidelity notes (the full source text is preserved on every event):
 * - Sucker Punch is fully wired: a foe's save-rolled window holds the save
 *   record and branch, the interrupt re-rolls it through the command layer,
 *   and the regenerated branch keeps the second result. Heroic's +1 curse is
 *   recorded on the target and consumed by the re-roll itself (see
 *   `attachSaveReroll`), so the second save is rolled with the curse.
 * - Riposte's "refresh when a foe damages you or an adjacent ally" and
 *   Revenge's "rush once per turn when damaged" are wired as reducer hooks keyed
 *   on damage events; Dark Knight's turn-start hatred and turn-end vigilance
 *   are the equivalent stance lifecycle hooks.
 * - Strongarm's circular shove traverses the eight surrounding spaces in the
 *   caller's chosen direction (clockwise by default), phasing through
 *   characters and stopping at impassable terrain or the grid edge.
 */

/** Walk up to `steps` cells in `direction`, stopping at the grid edge,
 * impassable terrain, or occupancy; returns null when no cell is moved. */
function plannedRush(context: Parameters<RuleResolver>[0], actorId: string, steps: number, direction: Position, extraExcludedIds: ReadonlySet<string> = new Set()): Position | null {
  const source = sourceActor(context, actorId);
  if (!source.position) return null;
  const destination = walk(context, source.position, direction, steps, false, actorId, { excludeIds: extraExcludedIds });
  return sameCell(destination, source.position) ? null : destination;
}

/** ICON p.139: rush 1, true-strike attack, slash; a target already slashed gains hatred. */
const lowBlowEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position) return [];
  const mutations: RuleMutation[] = [];
  if (target?.position && distance(source.position, target.position) > 1) {
    const rush = plannedRush(context, source.id, 1, axisDirection(source.position, target.position));
    if (rush) mutations.push(rushMutation(context, source.id, rush));
  }
  if (target) {
    const alreadySlashed = target.conditions.has('slashed');
    mutations.push(conditionMutation(context, target.id, 'slashed'));
    if (alreadySlashed) mutations.push(conditionMutation(context, target.id, 'hatred'));
  }
  if (context.triggers?.has('slay') || context.triggers?.has('heroic')) {
    mutations.push(...cureMutations(context, source.id));
  }
  return mutations;
};

/** ICON p.139 Combo (The Hook): range 2 and shove the target 1 toward the user. */
const lowBlowComboEffects: RuleResolver = (context, action) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position || !target || !target.position) return [];
  const mutations: RuleMutation[] = [...lowBlowEffects(context, action)];
  mutations.push(shoveMutation(context, target.id, 1, axisDirection(target.position, source.position)));
  return mutations;
};

/** ICON p.139: adjacent foes deal 1 piercing damage back, then 2 damage to all adjacent foes (up to three times). */
const provokeEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const range = context.triggers?.has('heroic') ? 2 : 1;
  const direction = context.input.directions?.['rush-direction'] ?? { x: 1, y: 0 };
  const mutations: RuleMutation[] = [];
  const rush = plannedRush(context, source.id, 1, direction);
  if (rush) mutations.push(rushMutation(context, source.id, rush));
  const position = rush ?? source.position;
  // The eligible set comes from the ONE U3 candidate authority: living,
  // on-battlefield foes within p.92 footprint `range` of the (post-rush)
  // cell. The query excludes defeated actors by default — a raw scan would
  // silently include them (defeat leaves actors on-field for rescue).
  const adjacentFoes = evaluateActorQuery({ relation: 'foe', range, rangeOrigin: anchorFromPosition(position) }, context)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const foe of adjacentFoes) {
    mutations.push(damageMutation(context, source.id, 1, 'effect', 'piercing'));
  }
  const hits = Math.min(3, adjacentFoes.length);
  for (let index = 0; index < hits; index += 1) {
    for (const foe of adjacentFoes) {
      mutations.push(damageMutation(context, foe.id, 2, 'effect'));
    }
  }
  if (context.triggers?.has('slay')) {
    for (const foe of adjacentFoes) {
      mutations.push(shoveMutation(context, foe.id, 1, axisDirection(position, foe.position!)));
    }
  }
  return mutations;
};

/** ICON p.139: attack, gain unstoppable + counter until the end of your next turn. */
const revengeEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source) return [];
  const mutations: RuleMutation[] = [
    conditionMutation(context, source.id, 'unstoppable', 'normal', untilNextTurnEnd),
    conditionMutation(context, source.id, 'counter', 'normal', untilNextTurnEnd),
  ];
  if (context.triggers?.has('slay') || context.triggers?.has('heroic')) {
    mutations.push(stateMutation(context, source.id, 'revenge:active', true));
  }
  return mutations;
};

/** ICON p.139 Combo (Indignation): true strike, vigilance per foe status (max 3), counter. */
const revengeComboEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source) return [];
  const statuses = target ? target.conditions.size : 0;
  const vigilance = Math.min(3, statuses);
  const mutations: RuleMutation[] = [];
  if (vigilance > 0) mutations.push(resourceMutation(context, source.id, 'vigilance', 'gain', vigilance));
  mutations.push(conditionMutation(context, source.id, 'counter', 'normal', untilNextTurnEnd));
  return mutations;
};

/** ICON p.140: enter the Riposte stance and arm the Dire Parry interrupt. */
const riposteEnter: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source) return [];
  const mutations: RuleMutation[] = [
    stanceMutation(context, source.id, 'enter', 'riposte'),
    stateMutation(context, source.id, 'riposte:armed', true),
  ];
  if (context.triggers?.has('heroic')) {
    const { roll: gamble } = gambleD6(context.dice);
    mutations.push(vigorMutation(context, source.id, gamble));
    mutations.push(stateMutation(context, source.id, 'riposte:last-gamble', gamble));
  }
  return mutations;
};

/** ICON p.140 Dire Parry: gamble, deal that much damage to the triggering foe; a 6 slashes and shoves 1. */
const direParry: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const foe = resolveTriggerSource(context) ?? resolveCapturedSelectedActors(context, 'target')[0];
  if (!source || !foe) throw new RuleProgramViolation('choice.actor-count', 'Dire Parry requires a triggering foe.');
  if (!foe || foe.side === source.side) throw new RuleProgramViolation('choice.actor-range', 'Dire Parry requires a foe.');
  const extraDice = Math.max(0, Math.floor(context.input.numbers?.vigilance ?? 0));
  const spendVigilance = extraDice > 0;
  const firstRoll = gambleD6(context.dice);
  const rolls = [firstRoll.roll, ...Array.from({ length: extraDice }, () => gambleD6(context.dice).roll)];
  const gamble = Math.max(...rolls);
  const mutations: RuleMutation[] = [];
  if (spendVigilance) mutations.push(resourceMutation(context, source.id, 'vigilance', 'spend', extraDice));
  mutations.push(damageMutation(context, foe.id, gamble, 'effect'));
  if (gamble === 6 && source.position && foe.position) {
    mutations.push(conditionMutation(context, foe.id, 'slashed'));
    mutations.push(shoveMutation(context, foe.id, 1, axisDirection(source.position, foe.position)));
  }
  mutations.push(stateMutation(context, source.id, 'riposte:last-gamble', gamble));
  return mutations;
};

/** ICON p.141: enter the Dark Knight stance, hatred+ of the closest foe, and sturdy.
 * RETRACTED from executable (see manual-programs.ts DOCUMENTED_NON_EXECUTABLE):
 * ICON p.143 grants the player a choice when multiple foes are equidistant
 * ("If multiple foes are equidistant, you may choose"), and no player-choice
 * seam exists at this timing yet. A UNIQUE closest foe applies hatred exactly;
 * equidistant closest foes fail closed (the unit is unresolved) rather than
 * inventing an id tie-break. Defeated foes are never candidates ("closest foe
 * to you" — a defeated character is removed from the battlefield). */
const darkKnightEnter: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const mutations: RuleMutation[] = [
    stanceMutation(context, source.id, 'enter', 'dark-knight'),
    conditionMutation(context, source.id, 'sturdy'),
  ];
  const closest = nearestCandidates(evaluateActorQuery({ relation: 'foe' }, context), source.position);
  if (closest.length > 1) {
    throw new RuleProgramViolation('choice.direction-ambiguous', 'Several foes are equidistant; Dark Knight requires a choice of whom to hate.');
  }
  if (closest.length === 1) {
    mutations.push(conditionMutation(context, source.id, 'hatred', 'plus'));
    mutations.push(stateMutation(context, source.id, 'hatred-of', closest[0].id));
  }
  if (context.triggers?.has('heroic')) {
    mutations.push(vigorMutation(context, source.id, 2 * source.conditions.size));
  }
  return mutations;
};

/** ICON p.141: circular shove with pass-through damage and a final shove. */
const strongarmEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0];
  // ICON p.143 Strongarm talent 1: "Comeback: this ability gains range 2.
  // Remove your target and place them into adjacency before activating this
  // effect." Comeback is active only while the user is bloodied, so the
  // ENTIRE talent effect — the range-2 extension AND the remove/place
  // reposition — is gated on the `comeback` trigger (the same flag
  // deriveTriggers turns into the `comeback` trigger while bloodied), never
  // on talent ownership alone. The shared range kernel widens target
  // legality to range 2 while the user is bloodied; the program mirrors that
  // gate so the hold starts from adjacency, and only under active Comeback
  // does it emit the remove/place reposition — into the recorded legal
  // adjacent cell — BEFORE the spin mutations, so the spin starts from the
  // placed cell. With the talent equipped but the user NOT bloodied, the
  // ability behaves exactly like base Strongarm (adjacent hold, no
  // reposition, no range-2 extension).
  const strongarmHold = source.talents?.['knave:strongarm'] === 1;
  const comeback = strongarmHold && context.triggers?.has('comeback');
  if (!source || !source.position || !target || !target.position || distance(source.position, target.position) > (comeback ? 2 : 1)) {
    throw new RuleProgramViolation('choice.actor-range', 'Strongarm requires an adjacent foe.');
  }
  if (target.side === source.side) throw new RuleProgramViolation('choice.actor-range', 'Strongarm requires an adjacent foe.');
  const sourcePosition = source.position;
  const mutations: RuleMutation[] = [];
  let targetPosition = target.position;
  if (comeback) {
    mutations.push(removeMutation(context, target.id));
    const placement = contextAfterMutations(context, mutations);
    const [adjacency] = resolveCapturedPositionListChoice({ key: 'strongarm-adjacency', label: 'Strongarm adjacency',
      required: true, minimum: 1, maximum: 1,
    }, evaluatePositions({ origin: sourcePosition, originSize: source.size, radius: 1, includeOrigin: true,
      space: { kind: 'unoccupied', excludeActorId: target.id }, placementActorId: target.id }, placement), placement);
    mutations.push(placeMutation(context, target.id, adjacency));
    targetPosition = adjacency;
  }
  const direction = resolveChoice({ key: 'direction', label: 'Strongarm rotation', kind: 'option', required: true, options: ['clockwise', 'counter-clockwise'] }, context);
  const clockwise = direction.kind === 'option' && direction.value === 'clockwise';
  const ring = ringAround(sourcePosition);
  const startIndex = ring.findIndex((cell) => sameCell(cell, targetPosition));
  if (startIndex < 0) throw new RuleProgramViolation('choice.actor-range', 'Strongarm requires an adjacent foe.');
  const passed = new Set<string>();
  let position = { ...targetPosition };
  let collided = false;
  let steps = 0;
  for (let step = 1; step <= 8; step += 1) {
    const index = (startIndex + (clockwise ? step : -step) + 16) % 8;
    const next = ring[index];
    if (impassable(next, context)) {
      collided = true;
      break;
    }
    position = next;
    steps += 1;
    const occupant = Object.values(context.state.actors)
      .find((candidate) => candidate.id !== source.id && candidate.id !== target.id && candidate.position && sameCell(candidate.position, next));
    if (occupant && !passed.has(occupant.id) && passed.size < 3) passed.add(occupant.id);
  }
  if (steps > 0) mutations.push(placeMutation(context, target.id, position));
  for (const passedId of passed) {
    const passedActor = sourceActor(context, passedId);
    mutations.push(damageMutation(context, passedId, 2, 'effect'));
    if (passedActor?.position) mutations.push(shoveMutation(context, passedId, 1, axisDirection(position, passedActor.position)));
  }
  const heroicExtra = context.triggers?.has('heroic') ? Math.min(4, passed.size) : 0;
  mutations.push(shoveMutation(context, target.id, 1 + heroicExtra, axisDirection(source.position, position)));
  if (collided) {
    for (const foe of Object.values(context.state.actors)) {
      if (foe.side === source.side || foe.id === source.id) continue;
      mutations.push(conditionMutation(context, foe.id, 'weakened'));
    }
  }
  return mutations;
};

/** ICON p.142: mark a distant foe and end the turn. */
const intimidateEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0];
  if (!source || !source.position || !target || !target.position) {
    throw new RuleProgramViolation('choice.actor-count', 'Intimidate requires a foe.');
  }
  if (target.side === source.side) throw new RuleProgramViolation('choice.actor-range', 'Intimidate requires a foe.');
  const minimumRange = context.triggers?.has('heroic') ? 2 : 4;
  if (distance(source.position, target.position) < minimumRange) {
    throw new RuleProgramViolation('choice.actor-range', `Intimidate requires a foe at or beyond range ${minimumRange}.`);
  }
  return [
    markMutation(context, target.id, 'intimidate', { ownerId: source.id }),
    stateMutation(context, source.id, 'end-turn-requested', true),
  ];
};

/** ICON p.143: re-roll an adjacent foe's save, keeping the second result. The
 * re-roll itself happens at the command layer (see `attachSaveReroll`); this
 * resolver records the usage and, on Heroic, marks the target so the re-roll
 * is rolled with +1 curse. */
const suckerPunchEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0];
  if (!source || !source.position || !target || !target.position || target.side === source.side) {
    throw new RuleProgramViolation('choice.actor-range', 'Sucker Punch requires an adjacent foe.');
  }
  if (distance(source.position, target.position) > 1) throw new RuleProgramViolation('choice.actor-range', 'Sucker Punch requires an adjacent foe.');
  const mutations: RuleMutation[] = [stateMutation(context, source.id, 'sucker-punch:used', true)];
  if (context.triggers?.has('heroic')) {
    // Heroic: the re-rolled save is made with +1 curse (consumed by the re-roll).
    mutations.push(stateMutation(context, target.id, 'sucker-punch:curse', true));
  }
  return mutations;
};

/** ICON p.144: 2[D]+fray attack that becomes true strike and ignores defenses at 3+ statuses. */
const bleakMercyEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !target || !target.position) return [];
  // ICON p.144: Bleak Mercy escalates against three or more *statuses* on the
  // target. Counting the broad projected condition set would let passive
  // positive conditions (Counter, Defiance, Resistance) grant the true-strike
  // and defense-bypass package without any actual statuses. The status-only
  // projection is the authoritative count.
  const empowered = target.statuses.length >= 3;
  // Ordinary attack through the shared authority (it still receives the
  // universal F6/aura/F10 fold); Bleak Mercy's own damage exceptions ride the
  // explicit provenance package below, exactly as p.144 names them.
  const attack = resolveAuthoritativeAttack(context, source, target, { trueStrike: empowered });
  const { d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit } = attack;
  const damageProvenance = {
    ...attack.damageProvenance,
    // p.144 names only these three exceptions. In particular this must not
    // use Divine as a shortcut: Divine also ignores Resistance, Cover,
    // Aetherwall, Pacified, and Hatred, none of which Bleak Mercy names.
    ...(empowered ? { bypassVigor: true, ignoreArmor: true, ignoreDefiance: true } : {}),
  };
  const mutations: RuleMutation[] = [{
    kind: 'attack', sourceId: context.sourceId, actorId: source.id, targetId: target.id, d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit,
  }];
  if (hit) {
    const dice = context.dice.die(attack.damageDie) + context.dice.die(attack.damageDie);
    mutations.push(damageMutation(context, target.id, dice + source.fray, 'hit', 'normal', damageProvenance));
  } else {
    mutations.push(damageMutation(context, target.id, source.fray, 'miss', 'normal', damageProvenance));
  }
  if (critical) mutations.push(damageMutation(context, target.id, context.dice.die(attack.damageDie), 'hit', 'normal', damageProvenance));
  if (context.triggers?.has('slay') || context.triggers?.has('heroic')) {
    mutations.push(...cureMutations(context, source.id));
    if (source.position) {
      for (const foe of Object.values(context.state.actors)) {
        if (foe.side === source.side || !foe.position || distance(foe.position, source.position) > 2) continue;
        mutations.push(shoveMutation(context, foe.id, 1, axisDirection(source.position, foe.position)));
      }
    }
  }
  return mutations;
};

/** ICON p.144 Combo (Sweet Torment): aura 1 that stops cures and save clearing.
 * Mastery (Painkiller): "Once gained, Sweet Torment's aura lasts indefinitely.
 * If you use Sweet Torment again while the aura is active, deal 2 damage,
 * once, to all foes in the aura within for every status they are suffering
 * from, to a maximum of three times." The mastered branch keeps the aura
 * (combat duration, the engine's indefinite boundary) and, on a re-use while
 * it is active, deals the status-counted damage instead of re-gaining it. */
const bleakMercyComboEffects: RuleResolver = (context, action) => {
  const source = resolveSourceActor(context);
  if (!source) return [];
  const mastered = hasMastery(source, 'knave:bleak-mercy');
  const auraActive = (source.activeEffects ?? []).some((effect) => effect.effectId === 'sweet-torment');
  const mutations: RuleMutation[] = [];
  if (mastered && auraActive) {
    // Painkiller re-use: the aura is already active, so instead of re-gaining
    // it, every foe inside takes 2 damage per status they suffer (max 3).
    // Membership is the shared aura kernel's — the same authority the
    // status-save policy hook uses.
    const definition = auraDefinitionFor('knave:bleak-mercy');
    if (definition) {
      const view = auraRuntimeView(context.state);
      for (const foe of Object.values(context.state.actors)) {
        if (foe.side === source.side || foe.defeated) continue;
        if (!isInAura(view, definition, foe.id)) continue;
        const statuses = Math.min(3, foe.statuses.length);
        if (statuses > 0) mutations.push(damageMutation(context, foe.id, 2 * statuses, 'effect'));
      }
    }
  } else {
    mutations.push({
      kind: 'persistent', sourceId: context.sourceId, ownerId: source.id, operation: 'add', actorId: source.id,
      effectId: 'sweet-torment', duration: mastered ? { kind: 'combat' } : untilNextTurnEnd,
      modifiers: [{ operation: 'grant', stat: 'aura', value: { kind: 'constant', value: 1 } }], triggers: [], state: {},
    });
  }
  mutations.push(...bleakMercyEffects(context, action));
  return mutations;
};

export const KNAVE_RULE_RESOLVERS: RuleResolverRegistry = {
  'knave:low-blow:effects': lowBlowEffects,
  'knave:low-blow:combo': lowBlowComboEffects,
  'knave:provoke': provokeEffects,
  'knave:revenge:effects': revengeEffects,
  'knave:revenge:combo': revengeComboEffects,
  'knave:riposte:enter': riposteEnter,
  'knave:riposte:dire-parry': direParry,
  'knave:dark-knight:enter': darkKnightEnter,
  'knave:strongarm': strongarmEffects,
  'knave:intimidate': intimidateEffects,
  'knave:sucker-punch': suckerPunchEffects,
  'knave:bleak-mercy:effects': bleakMercyEffects,
  'knave:bleak-mercy:combo': bleakMercyComboEffects,
};

export const KNAVE_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'knave:low-blow': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'true strike'],
      range: constant(1),
      resolverId: 'knave:low-blow:effects',
      steps: [{ id: 'attack', timing: 'use', effects: [attackStep({ trueStrike: true })] }],
    }),
    action({
      id: 'combo', name: 'The Hook', timing: 'use',
      costs: [comboCost()],
      tags: ['attack', 'true strike'],
      range: constant(2),
      resolverId: 'knave:low-blow:combo',
      steps: [{ id: 'attack', timing: 'use', effects: [attackStep({ trueStrike: true })] }],
    }),
  ], ['effect', 'attack', 'on hit', 'miss', 'effect', 'slay or heroic', 'combo']),

  'knave:provoke': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: [],
    resolverId: 'knave:provoke',
    steps: [],
  })], ['effect', 'effect', 'effect', 'heroic', 'slay']),

  'knave:revenge': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack'],
      range: constant(1),
      resolverId: 'knave:revenge:effects',
      steps: [{ id: 'attack', timing: 'use', effects: [attackStep()] }],
    }),
    action({
      id: 'combo', name: 'Indignation', timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }, comboCost()],
      tags: ['attack', 'true strike'],
      range: constant(1),
      resolverId: 'knave:revenge:combo',
      steps: [{ id: 'attack', timing: 'use', effects: [attackStep({ trueStrike: true })] }],
    }),
  ], ['attack', 'on hit', 'miss', 'effect', 'slay or heroic', 'combo']),

  'knave:riposte': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['stance'],
      resolverId: 'knave:riposte:enter',
      steps: [],
    }),
    action({
      id: 'dire-parry', name: 'Dire Parry', timing: 'interrupt',
      costs: [{ kind: 'interrupt', amount: constant(1) }],
      tags: ['interrupt'],
      resolverId: 'knave:riposte:dire-parry',
      steps: [],
    }),
  ], ['stance', 'trigger', 'effect', 'refresh', 'heroic']),

  'knave:dark-knight': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['stance'],
    resolverId: 'knave:dark-knight:enter',
    steps: [],
  })], ['stance', 'effect', 'effect', 'effect', 'heroic', 'refresh']),

  'knave:strongarm': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: [],
    resolverId: 'knave:strongarm',
    steps: [],
  })], ['effect', 'effect', 'collide', 'heroic']),

  'knave:intimidate': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark', 'end turn'],
    resolverId: 'knave:intimidate',
    steps: [],
  })], ['end your turn and mark', 'effect', 'heroic']),

  'knave:sucker-punch': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: ['interrupt'],
    resolverId: 'knave:sucker-punch',
    steps: [],
  })], ['trigger', 'effect', 'heroic']),

  'knave:bleak-mercy': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack'],
      range: constant(1),
      resolverId: 'knave:bleak-mercy:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'Sweet Torment', timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }, comboCost()],
      tags: ['attack'],
      range: constant(1),
      resolverId: 'knave:bleak-mercy:combo',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'effect', 'slay or heroic', 'combo']),
};
