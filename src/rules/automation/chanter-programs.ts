import { RuleProgramViolation } from './runtime.js';
import type { RuleSourceUnit } from '../source-units.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from './types.js';
import {
  axisDirection, lineCells, sameCell, squareArea, withinGrid, occupied,
  constant, untilNextTurnEnd,
  distance, sourceActor, walk, freeCellsInRange, resolveAttack, rushTowardFoes,
  damageMutation, conditionMutation, stateMutation, vigorMutation, cureMutation,
  resourceMutation, stanceMutation, markMutation,
  flyMutation, removeMutation, placeMutation, terrainMutation,
  action, compilation,
} from './job-kit.js';

/**
 * Independently reviewed Chanter ability implementations (ICON p.174–181), the
 * first Mendicant job. Every ability below has typed costs, targets, ranges,
 * and tags from the source catalog plus a hand-authored typed RuleProgram and
 * a named deterministic resolver.
 *
 * Blessings are the `blessing` resource; motes are `symphony-mote` terrain
 * effects; pits are `pit` terrain effects. Cross-command lifecycles resolve
 * through reducer hooks in encounter.ts:
 * - Aria's delay detonates at the start of the user's (slow) next turn: foes
 *   take fray twice and are sealed (sealed/pacified foes shoved 1), allies are
 *   cured, and the blast grows from small to medium to large per foe-ability
 *   damage taken while pending.
 * - Symphony's motes detonate when a character enters or starts a turn on them
 *   (foes fray, allies 2 vigor; the triggering hero is blessed and flies 1, a
 *   triggering foe gets a pit under them).
 * - Monogatari's song is rolled at the turn end (pre-rolled at the command
 *   boundary), and hero characters that complete the tale's action are blessed
 *   and may fly 2 at the end of their turn, once per song.
 * - Chastise's retribution strikes the marked foe at the end of its next turn
 *   (1 divine three times) if it damaged a chosen character with an ability,
 *   and the Charism combo resolves the cure/bless small blast then.
 * - Gentleness reflects 1 divine damage onto any character that deals damage
 *   while in the stance's aura.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Felicity's \"spend a combo token to fly the marked ally\" and the Dervish
 *   Dawn aura's +1 boon on saves are documented free-action/save windows.
 * - Pandaemonium's battlefield rearrangement is a deterministic rotation of
 *   the characters inside the area (each ends in a different space).
 * - Aria's special \"damaged by a foe ability\" growth is a reducer counter;
 *   Monogatari tales 1 (Fury) and 6 (Triumph) and the \"roll an extra d6 and
 *   choose\" are documented — the Charge gamble takes the higher of two rolls.
 * - Symphony's motes detonate on movement-end and turn-start (the single-pass
 *   VM has no movement-entry interrupt), and the mote creation consumes up to
 *   four blessings deterministically.
 */

/** Resolver-driven autohit attack: the standard attack mutation with no roll. */
const autohitAttack = (context: RuleExecutionContext): RuleMutation => ({
  kind: 'attack', sourceId: context.sourceId, actorId: context.actorId, targetId: context.attackTargetId ?? '',
  d20: null, boon: 0, total: null, hit: true, critical: false, evasionRoll: null, trueStrike: true, autoHit: true,
});

/** ICON p.177 Holy: pacify the foe, cure a character in range 2 of them, and on
 * a Charge grant 3 vigor to other characters in range 2 of the foe. */
const holyEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  const mutations: RuleMutation[] = [];
  if (!target) return mutations;
  mutations.push(conditionMutation(context, target.id, 'pacified'));
  if (target.position) {
    const targetPosition = target.position;
    const cureTarget = Object.values(context.state.actors)
      .filter((character) => character.side === source.side && character.position && distance(character.position, targetPosition) <= 2)
      .sort((a, b) => distance(a.position!, targetPosition) - distance(b.position!, targetPosition) || a.id.localeCompare(b.id))[0];
    if (cureTarget) mutations.push(cureMutation(context, cureTarget.id));
  }
  if (context.triggers?.has('charge')) {
    const targetPosition = target.position;
    for (const character of Object.values(context.state.actors)) {
      const position = character.position;
      if (character.side !== source.side || character.id === source.id || !position) continue;
      if (targetPosition && distance(position, targetPosition) <= 2) mutations.push(vigorMutation(context, character.id, 3));
    }
  }
  return mutations;
};

/** ICON p.177 Holy combo (HADES): a medium blast that autohits fray on the
 * target, deals fray to the other characters in the blast, and opens a pit
 * under the target. */
const holyComboEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!target?.position || !source.position) return [];
  const targetPosition = target.position;
  const mutations: RuleMutation[] = [autohitAttack(context)];
  mutations.push(damageMutation(context, target.id, source.fray, 'hit'));
  const area = squareArea(targetPosition, 2); // medium blast
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === source.id || character.id === target.id || !position) continue;
    if (area.some((cell) => sameCell(cell, position))) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  mutations.push(terrainMutation(context, 'create', 'pit', [targetPosition]));
  return mutations;
};

/** ICON p.177 Felicity: mark an ally in range and bless them (two blessings on
 * a Charge). The \"can fly 2\" and combo-spend flight are free-action windows. */
const felicityEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const allyId = context.input.actorIds?.target?.[0] ?? source.id;
  const ally = sourceActor(context, allyId);
  if (!source.position || !ally.position) throw new RuleProgramViolation('choice.actor-count', 'Felicity requires an ally in range 5.');
  if (ally.side !== source.side || distance(source.position, ally.position) > 5) throw new RuleProgramViolation('choice.actor-range', 'Felicity requires an ally in range 5.');
  return [
    markMutation(context, ally.id, 'felicity', {}),
    resourceMutation(context, ally.id, 'blessing', 'gain', context.triggers?.has('charge') ? 2 : 1),
  ];
};

/** ICON p.177 Felicity combo (FLEET): an ally in range 5 is blessed, may fly 4
 * (deterministic: along the dominant axis toward the nearest foe), and gains
 * 2 vigor per character passed over. */
const felicityComboEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const allyId = context.input.actorIds?.target?.[0] ?? source.id;
  const ally = sourceActor(context, allyId);
  if (!source.position || !ally.position) throw new RuleProgramViolation('choice.actor-count', 'FLEET requires an ally in range 5.');
  if (ally.side !== source.side || distance(source.position, ally.position) > 5) throw new RuleProgramViolation('choice.actor-range', 'FLEET requires an ally in range 5.');
  const mutations: RuleMutation[] = [resourceMutation(context, ally.id, 'blessing', 'gain', 1)];
  const direction = rushTowardFoes(context, ally.position);
  const path: { x: number; y: number }[] = [];
  for (const cell of lineCells(ally.position, direction, 4)) {
    if (!withinGrid(cell, context)) break;
    path.push(cell);
  }
  if (path.length > 0) mutations.push(flyMutation(context, ally.id, path.at(-1)!));
  let passed = 0;
  for (const cell of path) {
    const occupiedByCharacter = Object.values(context.state.actors).some((character) => character.id !== ally.id && character.position && sameCell(character.position, cell));
    if (occupiedByCharacter) passed += 1;
  }
  if (passed > 0) mutations.push(vigorMutation(context, ally.id, 2 * passed));
  return mutations;
};

/** ICON p.177 Pandaemonium: autohit [D]+fray on the target, then remove every
 * character in the medium blast and place each back in a different space of
 * the area (a deterministic rotation). Charge widens to a large blast and
 * grants allies in the area 4 vigor. */
const pandaemoniumEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!target?.position || !source.position) return [];
  const targetPosition = target.position;
  const radius = context.triggers?.has('charge') ? 3 : 2;
  const area = squareArea(targetPosition, radius);
  const mutations: RuleMutation[] = [];
  mutations.push(autohitAttack(context));
  mutations.push(damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'hit'));
  const inArea = Object.values(context.state.actors)
    .filter((character) => {
      const position = character.position;
      return !character.defeated && position && area.some((cell) => sameCell(cell, position));
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (inArea.length >= 2) {
    for (let i = 0; i < inArea.length; i += 1) {
      const next = inArea[(i + 1) % inArea.length];
      const nextPosition = next.position;
      if (nextPosition) mutations.push(placeMutation(context, inArea[i].id, nextPosition));
    }
  }
  if (context.triggers?.has('charge')) {
    for (const character of Object.values(context.state.actors)) {
      const position = character.position;
      if (character.side !== source.side || !position) continue;
      if (area.some((cell) => sameCell(cell, position))) mutations.push(vigorMutation(context, character.id, 4));
    }
  }
  return mutations;
};

/** ICON p.177 Pandaemonium combo (PURGATORIO): autohit [D]+fray, fray to every
 * other character in the medium blast, every pit in the area explodes for a
 * medium blast fray, and a pit opens under the attack target. */
const pandaemoniumComboEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!target?.position || !source.position) return [];
  const targetPosition = target.position;
  const mutations: RuleMutation[] = [];
  mutations.push(autohitAttack(context));
  mutations.push(damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'hit'));
  const area = squareArea(targetPosition, 2);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === source.id || character.id === target.id || !position) continue;
    if (area.some((cell) => sameCell(cell, position))) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  for (const effect of context.state.terrainEffects) {
    if (effect.terrain !== 'pit') continue;
    const center = effect.positions[0];
    if (!center || !area.some((cell) => sameCell(cell, center))) continue;
    const blast = squareArea(center, 2);
    for (const character of Object.values(context.state.actors)) {
      const position = character.position;
      if (character.id === source.id || !position) continue;
      if (blast.some((cell) => sameCell(cell, position))) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
    }
  }
  mutations.push(terrainMutation(context, 'create', 'pit', [targetPosition]));
  return mutations;
};

/** ICON p.178 Aria: end the turn and gain Delay; the stunning performance
 * resolves at the start of the user's (slow) next turn in the reducer. */
const ariaEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [
    stateMutation(context, source.id, 'aria:pending', true),
    stateMutation(context, source.id, 'end-turn-requested', true),
  ];
};

/** ICON p.178 Dervish: fly 1, then whisk an ally in range away and place them
 * in a free space adjacent to where you land. Charge chooses a second ally. */
const dervishEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  if (!sourcePosition) return [];
  const mutations: RuleMutation[] = [];
  const flyDest = walk(context, sourcePosition, rushTowardFoes(context, sourcePosition), 1, true, source.id);
  if (!sameCell(flyDest, sourcePosition)) mutations.push(flyMutation(context, source.id, flyDest));
  const allyIds = context.input.actorIds?.target ?? [];
  const count = context.triggers?.has('charge') ? 2 : 1;
  for (let i = 0; i < Math.min(count, allyIds.length); i += 1) {
    const ally = sourceActor(context, allyIds[i]);
    if (!ally?.position) throw new RuleProgramViolation('choice.actor-count', 'Dervish requires an ally in range 4.');
    if (ally.side !== source.side || distance(sourcePosition, ally.position) > 4) throw new RuleProgramViolation('choice.actor-range', 'Dervish requires an ally in range 4.');
    mutations.push(removeMutation(context, ally.id));
    const adjacentCell = freeCellsInRange(context, flyDest, 1)[0];
    if (adjacentCell) mutations.push(placeMutation(context, ally.id, adjacentCell));
  }
  return mutations;
};

/** ICON p.178 Dervish combo (DAWN): gain aura 1 until the end of your next
 * turn. The +1 boon on saves and the start-of-turn saves are documented
 * save-window effects. */
const dervishComboEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [conditionMutation(context, source.id, 'dervish:dawn-aura', 'normal', untilNextTurnEnd)];
};

/** The first free space for a Symphony mote: scans outward from `start`,
 * skipping occupied cells and cells adjacent to or overlapping placed motes. */
const firstMoteCell = (context: Parameters<RuleResolver>[0], start: { x: number; y: number }, placed: { x: number; y: number }[]): { x: number; y: number } | null => {
  for (let radius = 0; radius <= Math.max(context.state.grid.width, context.state.grid.height); radius += 1) {
    const candidates = squareArea(start, radius)
      .filter((cell) => withinGrid(cell, context))
      .sort((a, b) => distance(start, a) - distance(start, b) || a.x - b.x || a.y - b.y);
    for (const cell of candidates) {
      if (occupied(cell, context)) continue;
      if (placed.some((candidate) => sameCell(candidate, cell) || distance(candidate, cell) <= 1)) continue;
      return cell;
    }
  }
  return null;
};

/** ICON p.178 Symphony: remove up to four blessings from characters anywhere
 * to create pulsing mote terrain spaces (none adjacent or overlapping). Charge
 * creates two more spaces. Detonation resolves through the reducer's
 * movement-end / turn-start hooks. */
const symphonyEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const mutations: RuleMutation[] = [];
  let remaining = 4;
  const holders = Object.values(context.state.actors)
    .filter((character) => (character.resources.blessing ?? 0) > 0)
    .sort((a, b) => (b.resources.blessing ?? 0) - (a.resources.blessing ?? 0) || a.id.localeCompare(b.id));
  for (const holder of holders) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, holder.resources.blessing ?? 0);
    mutations.push(resourceMutation(context, holder.id, 'blessing', 'spend', take));
    remaining -= take;
  }
  const count = 4 + (context.triggers?.has('charge') ? 2 : 0);
  const placed: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const cell = firstMoteCell(context, source.position, placed);
    if (!cell) break;
    placed.push(cell);
    mutations.push(terrainMutation(context, 'create', 'symphony-mote', [cell]));
  }
  return mutations;
};

/** ICON p.179 Gentleness: enter the stance with aura 1. The reflection of 1
 * divine damage on characters that deal damage in the aura resolves in the
 * damage pipeline; the +1 curse on attacks in the aura is documented. */
const gentlenessEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [stanceMutation(context, source.id, 'enter', 'gentleness')];
};

/** ICON p.179 Monogatari: the song resonates until this ability is used again.
 * The tale is gambled at the end of the user's turn (pre-rolled at the command
 * boundary); allies that complete the tale's action are blessed and may fly 2
 * at the end of their turn, once per song. */
const monogatariEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const mutations: RuleMutation[] = [
    stateMutation(context, source.id, 'monogatari:active', true),
    stateMutation(context, source.id, 'monogatari:tale', null),
    stateMutation(context, source.id, 'monogatari:charge', context.triggers?.has('charge') ?? false),
  ];
  return mutations;
};

/** ICON p.179 Chastise: autohit fray, seal the foe, then mark them with the
 * retribution — if they damage any chosen character with an ability before the
 * end of their next turn, they take 1 divine damage three times then. Charge
 * protects both yourself and an ally. */
const chastiseEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!target || !source.position || !target.position) return [];
  const mutations: RuleMutation[] = [];
  mutations.push(autohitAttack(context));
  mutations.push(damageMutation(context, target.id, source.fray, 'hit'));
  mutations.push(conditionMutation(context, target.id, 'sealed'));
  const chosenIds = context.input.actorIds?.target?.slice(1) ?? [];
  const protectedIds = context.triggers?.has('charge')
    ? [...new Set([...chosenIds, source.id])]
    : chosenIds.length > 0 ? chosenIds : [source.id];
  mutations.push(markMutation(context, target.id, 'chastise-retribution', { chosen: JSON.stringify(protectedIds) }));
  return mutations;
};

/** ICON p.179 Chastise combo (CHARISM): mark a foe in range; at the end of its
 * next turn, cure or bless allies in a small blast centered on it (defaulting
 * to cure), and open a pit under it if two or more allies were in the area. */
const chastiseComboEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const foeId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const foe = foeId ? sourceActor(context, foeId) : undefined;
  if (!foe?.position || !source.position) throw new RuleProgramViolation('choice.actor-count', 'CHARISM requires a foe in range 5.');
  if (foe.side === source.side || distance(source.position, foe.position) > 5) throw new RuleProgramViolation('choice.actor-range', 'CHARISM requires a foe in range 5.');
  const choice = context.input.options?.choice ?? 'cure';
  return [markMutation(context, foe.id, 'chastise-charism', { choice })];
};

export const CHANTER_RULE_RESOLVERS: RuleResolverRegistry = {
  'chanter:holy:effects': holyEffects,
  'chanter:holy:combo': holyComboEffects,
  'chanter:felicity:effects': felicityEffects,
  'chanter:felicity:combo': felicityComboEffects,
  'chanter:pandaemonium:effects': pandaemoniumEffects,
  'chanter:pandaemonium:combo': pandaemoniumComboEffects,
  'chanter:aria:effects': ariaEffects,
  'chanter:dervish:effects': dervishEffects,
  'chanter:dervish:combo': dervishComboEffects,
  'chanter:symphony:effects': symphonyEffects,
  'chanter:gentleness:effects': gentlenessEffects,
  'chanter:monogatari:effects': monogatariEffects,
  'chanter:chastise:effects': chastiseEffects,
  'chanter:chastise:combo': chastiseComboEffects,
};

export const CHANTER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'chanter:holy': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'range'],
      range: constant(5),
      resolverId: 'chanter:holy:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'HADES', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['attack', 'medium blast', 'true strike'],
      range: constant(5),
      resolverId: 'chanter:holy:combo',
      steps: [],
    }),
  ], ['effect', 'effect', 'charge', 'combo']),

  'chanter:felicity': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['mark', 'range'],
      range: constant(5),
      resolverId: 'chanter:felicity:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'FLEET', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['range'],
      range: constant(5),
      resolverId: 'chanter:felicity:combo',
      steps: [],
    }),
  ], ['mark', 'charge', 'combo']),

  'chanter:pandaemonium': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'medium blast', 'range'],
      range: constant(5),
      resolverId: 'chanter:pandaemonium:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'PURGATORIO', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['attack', 'medium blast', 'range'],
      range: constant(5),
      resolverId: 'chanter:pandaemonium:combo',
      steps: [],
    }),
  ], ['attack', 'on hit', 'area effect', 'charge', 'combo']),

  'chanter:aria': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['delay', 'end turn', 'true strike'],
    resolverId: 'chanter:aria:effects',
    steps: [],
  })], ['effect', 'effect', 'special']),

  'chanter:dervish': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['range'],
      range: constant(4),
      resolverId: 'chanter:dervish:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'DAWN', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['aura'],
      resolverId: 'chanter:dervish:combo',
      steps: [],
    }),
  ], ['effect', 'charge', 'combo']),

  'chanter:symphony': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['terrain effect', 'true strike'],
    resolverId: 'chanter:symphony:effects',
    steps: [],
  })], ['terrain effect', 'effect', 'charge']),

  'chanter:gentleness': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['stance', 'aura'],
    resolverId: 'chanter:gentleness:effects',
    steps: [],
  })], ['stance', 'refresh']),

  'chanter:monogatari': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['gamble'],
    resolverId: 'chanter:monogatari:effects',
    steps: [],
  })], ['effect', 'charge']),

  'chanter:chastise': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'range'],
      range: constant(5),
      resolverId: 'chanter:chastise:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'CHARISM', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['range'],
      range: constant(5),
      resolverId: 'chanter:chastise:combo',
      steps: [],
    }),
  ], ['attack', 'effect', 'effect', 'charge', 'combo']),
};
