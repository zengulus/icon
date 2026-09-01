import { RuleProgramViolation } from '../../../kernels/runtime.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, sameCell, squareArea, withinGrid,
  constant,
  distance, sourceActor, walk,
  damageMutation, conditionMutation, stateMutation, vigorMutation,
  resourceMutation, markMutation,
  shoveMutation, teleportMutation, entityMutation, summonEntity, terrainMutation,
  action, compilation,
} from '../../../primitives/job-kit.js';
import { evaluatePositions, rushTowardFoes } from '../../../kernels/evaluate-query.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';

/**
 * Independently reviewed Stormbender ability implementations (ICON p.230–236),
 * the fourth Wright job. Every ability below has typed costs, targets, ranges,
 * and tags from the source catalog plus a hand-authored typed RuleProgram and
 * a named deterministic resolver. Aether is the `aether` resource.
 *
 * Salt sprites are `salt-sprite` entities; geysers, waterspouts, and tsunamis
 * are `geyser` / `waterspout` / `tsunami` entities and terrain; pits are `pit`
 * terrain.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Tsunami's movement and drag, Geyser's eruption on start/end of turn,
 *   Gust's movement-entry effects, Waterspout's suck-in/spit-out, and
 *   Deepwrath's start-of-turn pit and pit-to-pit drag are movement-boundary /
 *   turn-boundary reducer hooks documented below; the Selkie class trait is
 *   outside the ability set.
 * - Heave-Ho's trigger (a foe damages you or an adjacent ally or summon) is a
 *   post-resolution interrupt window; the crash wave resolves at `interrupt`
 *   timing.
 * - The Collide summons (salt sprites on collisions) are documented as reducer
 *   collision checks.
 */

/** Standard resolver-driven autohit attack mutation (no roll). */
const autohitAttack = (context: RuleExecutionContext): RuleMutation => ({
  kind: 'attack', sourceId: context.sourceId, actorId: context.actorId, targetId: context.attackTargetId ?? '',
  d20: null, boon: 0, total: null, hit: true, critical: false, evasionRoll: null, trueStrike: true, autoHit: true,
});

/** ICON p.233 Rime: 2[D]+fray on hit (fray on miss), fray to the other
 * characters in the line, shove every character in the line 1 to either side,
 * shove the attack target 1, and summon a salt sprite in range 2 of them.
 * Infuse 3 (DAGON) creates a watery pit under the target on a Collide. */
const rimeEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const direction = axisDirection(source.position, target.position);
  const cells: { x: number; y: number }[] = [];
  for (let step = 1; step <= 6; step += 1) {
    const cell = { x: source.position.x + direction.x * step, y: source.position.y + direction.y * step };
    if (!withinGrid(cell, context)) break;
    cells.push(cell);
  }
  const perpendicular = direction.x !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !cells.some((cell) => sameCell(cell, position))) continue;
    if (character.id !== target.id) {
      mutations.push(damageMutation(context, character.id, source.fray, 'area'));
      const side = (position.y % 2 === 0 ? 1 : -1);
      const sideDirection = direction.x !== 0 ? { x: 0, y: side } : { x: side, y: 0 };
      mutations.push(shoveMutation(context, character.id, 1, sideDirection));
    }
  }
  mutations.push(shoveMutation(context, target.id, 1, axisDirection(target.position, source.position)));
  mutations.push(...summonEntity(context, source.id, 'salt-sprite', target.position, {
    radius: 2, count: 1, losOrigin: source.position,
  }));
  if (context.actionTags?.has('infuse') && context.triggers?.has('collide')) {
    mutations.push(terrainMutation(context, 'create', 'pit', [target.position]));
  }
  return mutations;
};

/** ICON p.233 Tsunami: create a huge swell of elemental water — a medium blast
 * terrain effect that is difficult and dangerous terrain, placed with its edge
 * adjacent to an edge of the map, moving 4 spaces per turn toward the chosen
 * opposite edge. The movement, drag, and collision effects are documented
 * terrain windows. */
const tsunamiEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const origin = context.input.positions?.origin?.[0] ?? { x: 3, y: 1 };
  const cells = squareArea(origin, 2).filter((cell) => withinGrid(cell, context));
  const mutations: RuleMutation[] = [
    terrainMutation(context, 'create', 'tsunami', cells),
    stateMutation(context, source.id, 'stormbender:tsunami:origin', JSON.stringify({ x: origin.x, y: origin.y })),
  ];
  return mutations;
};

/** ICON p.233 Cryo: the foe is shattered and shoved 1 toward you, then an
 * auto-hit 1 damage attack with 1 damage to the other characters in the line,
 * gaining 1 aether. If any character is already shattered, a pit opens under
 * them. */
const cryoEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  mutations.push(conditionMutation(context, target.id, 'shattered'));
  mutations.push(shoveMutation(context, target.id, 1, axisDirection(target.position, source.position)));
  mutations.push(autohitAttack(context));
  mutations.push(damageMutation(context, target.id, 1, 'hit'));
  const direction = axisDirection(source.position, target.position);
  const cells: { x: number; y: number }[] = [];
  for (let step = 1; step <= 8; step += 1) {
    const cell = { x: source.position.x + direction.x * step, y: source.position.y + direction.y * step };
    if (!withinGrid(cell, context)) break;
    cells.push(cell);
  }
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || !position || !cells.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, 1, 'area'));
  }
  mutations.push(resourceMutation(context, source.id, 'aether', 'gain', 1));
  const shattered = Object.values(context.state.actors).find((character) => character.conditions.has('shattered'));
  if (shattered?.position) mutations.push(terrainMutation(context, 'create', 'pit', [shattered.position]));
  return mutations;
};

/** ICON p.234 Geyser: summon a height 1 geyser object in a free space in range
 * 4. The eruption on a character starting or ending their turn on it, and the
 * salt sprite that replaces it, are documented object windows. */
const geyserEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  const cell = target?.position ?? source.position;
  if (distance(source.position, cell) > 4) throw new RuleProgramViolation('choice.actor-range', 'Geyser requires a space in range 4.');
  const freeCell = evaluatePositions({ origin: source.position, radius: 4, space: { kind: 'unoccupied' }, ordering: { kind: 'distance-from-origin' } }, context).find((candidate) => !Object.values(context.state.entities).some((entity) => entity.positions.some((position) => sameCell(position, candidate)))) ?? cell;
  return [{
    kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: 'geyser', ownerId: source.id,
    positions: [freeCell], count: 1, state: { height: 1 },
  }];
};

/** ICON p.234 Gust: create a line 3 terrain effect. Characters that enter an
 * end space gain phasing and are shoved to the other end space, then flung out
 * and shoved 1 outside the area; characters entering a middle space are shoved
 * in a direction of your choice. The movement-entry effects are documented
 * terrain windows. */
const gustEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const direction = context.input.directions?.line ?? rushTowardFoes(context, source.position);
  const cells: { x: number; y: number }[] = [];
  for (let step = 1; step <= 3; step += 1) {
    const cell = { x: source.position.x + direction.x * step, y: source.position.y + direction.y * step };
    if (!withinGrid(cell, context)) break;
    cells.push(cell);
  }
  const mutations: RuleMutation[] = [];
  if (cells.length > 0) mutations.push(terrainMutation(context, 'create', 'gust', cells));
  return mutations;
};

/** ICON p.234 Heave-Ho (interrupt): after the triggering ability resolves,
 * create a crashing wave in a medium blast adjacent to you or a summon you
 * control — characters caught are shoved 1 and foes become vulnerable.
 * Collide: summon a salt sprite (documented). */
const heaveHoEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const origin = context.input.positions?.origin?.[0] ?? source.position;
  const cells = squareArea(origin, 2).filter((cell) => withinGrid(cell, context));
  const mutations: RuleMutation[] = [];
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !cells.some((cell) => sameCell(cell, position))) continue;
    if (character.id === source.id) continue;
    const away = axisDirection(origin, position);
    mutations.push(shoveMutation(context, character.id, 1, away));
    if (character.side !== source.side) mutations.push(conditionMutation(context, character.id, 'vulnerable'));
  }
  mutations.push(...summonEntity(context, source.id, 'salt-sprite', origin, {
    radius: 2, count: 1, losOrigin: source.position,
  }));
  return mutations;
};

/** ICON p.235 Deepwrath: mark a character in range 6. The watery pit under
 * them at the start of their turn and the pit-to-pit drag when they end their
 * turn inside a pit are documented mark-trigger windows. */
const deepwrathEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Deepwrath requires a character in range 6.');
  if (distance(source.position, target.position) > 6) throw new RuleProgramViolation('choice.actor-range', 'Deepwrath requires a character in range 6.');
  return [markMutation(context, target.id, 'deepwrath', {})];
};

/** ICON p.235 Waterspout: summon a waterspout in a space in range that is
 * difficult terrain. The suck-in (at summon or at the start of your turn) and
 * the end-of-turn spit-out are documented terrain windows. */
const waterspoutEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  const cell = target?.position ?? source.position;
  const freeCell = evaluatePositions({ origin: source.position, radius: Math.max(1, distance(source.position, cell)), space: { kind: 'unoccupied' }, ordering: { kind: 'distance-from-origin' } }, context)[0] ?? cell;
  const mutations: RuleMutation[] = [
    { kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: 'waterspout', ownerId: source.id, positions: [freeCell], count: 1, state: {} },
    terrainMutation(context, 'create', 'difficult', [freeCell]),
  ];
  return mutations;
};

/** ICON p.236 Eye Of The Storm: the attack space is clear and exempt from the
 * area; the medium blast deals [D] to every other character in it; if an
 * enemy is in the center space they become vulnerable.
 * RETRACTED from executable (see manual-programs.ts DOCUMENTED_NON_EXECUTABLE):
 * ICON p.236 "If an ally is in the center space, they may fly 4 after the
 * ability resolves" is a free player-chosen flight — the source never names
 * a direction, so the old "away from the nearest foe" resolution was an
 * invented deterministic rule. The clause fails closed (the unit is
 * unresolved) rather than guessing a flight path; the area-damage and
 * enemy-center halves above remain exact. Talent 2 (piercing per area
 * character) was retracted with the ability — its only execution path was
 * this resolver. */
const eyeOfTheStormEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const centerId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const centerActor = centerId ? sourceActor(context, centerId) : undefined;
  if (!source.position) return [];
  const center = centerActor?.position ?? source.position;
  if (distance(source.position, center) > 8) throw new RuleProgramViolation('choice.actor-range', 'Eye Of The Storm requires its center in range 8.');
  const mutations: RuleMutation[] = [];
  const blast = squareArea(center, 2);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || sameCell(position, center)) continue;
    if (!blast.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, context.dice.die(source.damageDie), 'area'));
  }
  if (centerActor) {
    if (centerActor.side === source.side) {
      throw new RuleProgramViolation('choice.movement-unresolved', 'An ally is in the center; the fly-4 direction is a player choice the engine cannot resolve yet.');
    }
    mutations.push(conditionMutation(context, centerActor.id, 'vulnerable'));
  }
  return mutations;
};

export const STORMBENDER_RULE_RESOLVERS: RuleResolverRegistry = {
  'stormbender:rime:effects': rimeEffects,
  'stormbender:tsunami:effects': tsunamiEffects,
  'stormbender:cryo:effects': cryoEffects,
  'stormbender:geyser:effects': geyserEffects,
  'stormbender:gust:effects': gustEffects,
  'stormbender:heave-ho:effects': heaveHoEffects,
  'stormbender:deepwrath:effects': deepwrathEffects,
  'stormbender:waterspout:effects': waterspoutEffects,
  'stormbender:eye-of-the-storm:effects': eyeOfTheStormEffects,
};

export const STORMBENDER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'stormbender:rime': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'summon', 'line'],
      range: constant(6),
      resolverId: 'stormbender:rime:effects',
      steps: [],
    }),
    action({
      id: 'infuse', name: 'DAGON', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(3) }],
      tags: ['attack', 'summon', 'line'],
      range: constant(6),
      resolverId: 'stormbender:rime:effects',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'effect', 'collide']),

  'stormbender:tsunami': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['terrain effect'],
    resolverId: 'stormbender:tsunami:effects',
    steps: [],
  })], ['terrain effect', 'effect']),

  'stormbender:cryo': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'pierce', 'line'],
    range: constant(8),
    resolverId: 'stormbender:cryo:effects',
    steps: [],
  })], ['attack', 'on hit', 'area effect', 'effect']),

  'stormbender:geyser': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['summon', 'object'],
    range: constant(4),
    resolverId: 'stormbender:geyser:effects',
    steps: [],
  })], ['object', 'effect']),

  'stormbender:gust': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['terrain effect'],
    resolverId: 'stormbender:gust:effects',
    steps: [],
  })], ['terrain effect', 'effect']),

  'stormbender:heave-ho': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: [],
    resolverId: 'stormbender:heave-ho:effects',
    steps: [],
  })], ['interrupt', 'area effect', 'collide']),

  'stormbender:deepwrath': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark'],
    range: constant(6),
    resolverId: 'stormbender:deepwrath:effects',
    steps: [],
  })], ['mark', 'effect']),

  'stormbender:waterspout': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: [],
    resolverId: 'stormbender:waterspout:effects',
    steps: [],
  })], ['terrain effect', 'effect']),

  'stormbender:eye-of-the-storm': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'pierce', 'medium blast', 'range'],
    range: constant(8),
    resolverId: 'stormbender:eye-of-the-storm:effects',
    steps: [],
  })], ['area effect', 'effect']),
};
