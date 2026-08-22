import { RuleProgramViolation } from './runtime.js';
import type { RuleSourceUnit } from '../source-units.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from './types.js';
import {
  axisDirection, sameCell, squareArea, withinGrid,
  constant,
  distance, sourceActor, walk, freeCellsInRange, resolveAttack, nearestFoe,
  damageMutation, conditionMutation, stateMutation, vigorMutation, cureMutation,
  stanceMutation, markMutation,
  shoveMutation, flyMutation, placeMutation, removeMutation, entityMutation, terrainMutation,
  action, compilation,
} from './job-kit.js';

/**
 * Independently reviewed Geomancer ability implementations (ICON p.215–221),
 * the second Wright job. Every ability below has typed costs, targets, ranges,
 * and tags from the source catalog plus a hand-authored typed RuleProgram and
 * a named deterministic resolver. Aether is the `aether` resource.
 *
 * Boulders, statues, and spires are `boulder` / `statue` / `magma-spire`
 * entities; pits and difficult terrain are `pit` / `difficult` terrain.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Dragon Dive's start-of-slow-turn dive-and-erupt, Obsidian Flesh's
 *   damage-triggered die ticks and resistance, Quaking Palm's end-of-next-turn
 *   vibrations, and Terraforming's object height raises are reducer hooks
 *   documented below.
 * - Midas's statue swap is modeled at the interrupt boundary: the interrupt
 *   records the transmutation and the statue replacement, and the
 *   start-of-next-turn return is a documented turn-start window.
 * - Realignment's purge count drives the burst damage inline; the MEDICINE
 *   PALM vigor-surge and the Aftershock class trait are documented.
 */

/** Standard resolver-driven autohit attack mutation (no roll). */
const autohitAttack = (context: RuleExecutionContext): RuleMutation => ({
  kind: 'attack', sourceId: context.sourceId, actorId: context.actorId, targetId: context.attackTargetId ?? '',
  d20: null, boon: 0, total: null, hit: true, critical: false, evasionRoll: null, trueStrike: true, autoHit: true,
});

/** ICON p.218 Bio: shatter the attack target, [D]+fray on hit (fray on miss),
 * fray to the other characters in the small blast. Charge: dangerous terrain
 * in the center space and under every foe in the area. */
const bioEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [autohitAttack(context)];
  mutations.push(conditionMutation(context, target.id, 'shattered'));
  const roll = resolveAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const area = squareArea(target.position, 1);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || !position || !area.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  if (context.triggers?.has('charge')) {
    const cells = [target.position];
    for (const character of Object.values(context.state.actors)) {
      const position = character.position;
      if (position && character.side !== source.side && area.some((cell) => sameCell(cell, position))) cells.push(position);
    }
    mutations.push(terrainMutation(context, 'create', 'dangerous', cells));
  }
  return mutations;
};

/** ICON p.218 Bio infuse (BIOTIC): the blast grows to a medium blast and every
 * character inside is shattered. */
const bioticEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [autohitAttack(context)];
  mutations.push(conditionMutation(context, target.id, 'shattered'));
  const roll = resolveAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const area = squareArea(target.position, 2);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !area.some((cell) => sameCell(cell, position))) continue;
    if (character.id !== target.id) {
      mutations.push(conditionMutation(context, character.id, 'shattered'));
      mutations.push(damageMutation(context, character.id, source.fray, 'area'));
    }
  }
  return mutations;
};

/** ICON p.218 Dragon Dive: choose a character in range 6, end your turn, and
 * gain delay — your next turn must be slow. At the start of that turn you dive
 * into the earth and place yourself within range 3 of the character, then
 * release a burst 1 area effect (shove 1, 2 piercing). The dive is a
 * documented delay window. */
const dragonDiveEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  if (target && target.position && distance(source.position, target.position) > 6) throw new RuleProgramViolation('choice.actor-range', 'Dragon Dive requires a character in range 6.');
  return [
    stateMutation(context, source.id, 'dragon-dive:target', target?.id ?? ''),
    stateMutation(context, source.id, 'end-turn-requested', true),
  ];
};

/** ICON p.218 Geo: 2[D]+fray on hit (fray on miss), fray to the other
 * characters in the small blast, and a height 1 boulder object in a free space
 * in the area. Charge: the target explodes in a medium blast — 2 piercing again
 * to all characters and a pit under them. */
const geoEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie) + context.dice.die(source.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const area = squareArea(target.position, 1);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || !position || !area.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  const boulderCell = freeCellsInRange(context, target.position, 1)[0];
  if (boulderCell) mutations.push(entityMutation(context, source.id, boulderCell, 'boulder', { height: 1 }));
  if (context.triggers?.has('charge')) {
    const blast = squareArea(target.position, 2);
    for (const character of Object.values(context.state.actors)) {
      const position = character.position;
      if (!position || !blast.some((cell) => sameCell(cell, position))) continue;
      mutations.push(damageMutation(context, character.id, 2, 'area', 'piercing'));
    }
    mutations.push(terrainMutation(context, 'create', 'pit', [target.position]));
  }
  return mutations;
};

/** ICON p.219 Helix Heel: a shockwave in a line 3 dealing 2 piercing to all
 * foes. An object at the end space extends the line by 3 (once per object),
 * and every object passed through resonates with a burst 1 area effect of 2
 * piercing. Charge: shatter any foe damaged by the ability. */
const helixHeelEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const mutations: RuleMutation[] = [];
  const direction = context.input.directions?.line ?? { x: 1, y: 0 };
  const damaged = new Set<string>();
  const lines: { x: number; y: number }[][] = [];
  let cursor = source.position;
  let directionNow = direction;
  for (let segment = 0; segment < 8; segment += 1) {
    const cells: { x: number; y: number }[] = [];
    for (let step = 1; step <= 3; step += 1) {
      const cell = { x: cursor.x + directionNow.x * step, y: cursor.y + directionNow.y * step };
      if (!withinGrid(cell, context)) break;
      cells.push(cell);
    }
    if (cells.length === 0) break;
    lines.push(cells);
    const end = cells.at(-1)!;
    const object = Object.values(context.state.entities).find((entity) => entity.position && sameCell(entity.position, end));
    if (!object) break;
    cursor = end;
    directionNow = context.input.directions?.extend ?? directionNow;
  }
  const allCells = lines.flat();
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !allCells.some((cell) => sameCell(cell, position))) continue;
    if (character.side !== source.side) {
      mutations.push(damageMutation(context, character.id, 2, 'area', 'piercing'));
      damaged.add(character.id);
    }
  }
  for (const entity of Object.values(context.state.entities)) {
    const position = entity.position;
    if (!position || !allCells.some((cell) => sameCell(cell, position))) continue;
    const burst = squareArea(position, 1);
    for (const character of Object.values(context.state.actors)) {
      const charPosition = character.position;
      if (!charPosition || !burst.some((cell) => sameCell(cell, charPosition))) continue;
      if (character.side !== source.side) {
        mutations.push(damageMutation(context, character.id, 2, 'area', 'piercing'));
        damaged.add(character.id);
      }
    }
  }
  if (context.triggers?.has('charge')) {
    for (const id of damaged) mutations.push(conditionMutation(context, id, 'shattered'));
  }
  return mutations;
};

/** ICON p.219 Terraforming: target a burst 2 (target) area in range 6 and
 * choose two terrain effects to create there (four on a Charge): two boulder
 * objects, two pits, raise an existing object's height by +1, a line 3 of
 * difficult terrain, or remove difficult/dangerous terrain. The choice is
 * passed as `effects` (an ordered list of effect names). */
const terraformingEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  const center = target?.position ?? source.position;
  if (distance(source.position, center) > 6) throw new RuleProgramViolation('choice.actor-range', 'Terraforming requires its center in range 6.');
  const area = squareArea(center, 2).filter((cell) => withinGrid(cell, context));
  const chosen = context.input.options?.effects ?? 'boulders,pits';
  const effects = chosen.split(',');
  const count = context.triggers?.has('charge') ? 4 : 2;
  const mutations: RuleMutation[] = [];
  const freeCells = area.filter((cell) => !Object.values(context.state.actors).some((character) => character.position && sameCell(character.position, cell)));
  let used = 0;
  for (const name of [...effects, 'boulders', 'pits', 'difficult', 'remove'].slice(0, 8)) {
    if (used >= count) break;
    if (name === 'boulders') {
      const cells = freeCells.filter((cell) => !Object.values(context.state.entities).some((entity) => entity.position && sameCell(entity.position, cell))).slice(0, 2);
      for (const cell of cells) {
        if (used >= count) break;
        mutations.push(entityMutation(context, source.id, cell, 'boulder', { height: 1 }));
        used += 1;
      }
    } else if (name === 'pits') {
      const cells = freeCells.slice(0, 2);
      for (const cell of cells) {
        if (used >= count) break;
        mutations.push(terrainMutation(context, 'create', 'pit', [cell]));
        used += 1;
      }
    } else if (name === 'raise') {
      const owned = Object.values(context.state.entities).filter((entity) => entity.ownerId === source.id && entity.position && area.some((cell) => sameCell(cell, entity.position!)));
      for (const entity of owned) {
        if (used >= count) break;
        mutations.push({ kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: entity.type, ownerId: source.id, positions: [entity.position!], count: 1, state: { height: Math.min(3, Number(entity.state.height ?? 1) + 1) } });
        used += 1;
      }
    } else if (name === 'difficult') {
      const cells = area.filter((cell) => !context.state.terrainAt(cell).has('difficult') && !context.state.terrainAt(cell).has('dangerous')).slice(0, 3);
      if (cells.length > 0) {
        mutations.push(terrainMutation(context, 'create', 'difficult', cells));
        used += 1;
      }
    } else if (name === 'remove') {
      const removals = context.state.terrainEffects.filter((effect) => (effect.terrain === 'difficult' || effect.terrain === 'dangerous') && effect.positions.some((position) => area.some((cell) => sameCell(cell, position))));
      for (const effect of removals.slice(0, 3)) {
        if (used >= count) break;
        mutations.push(terrainMutation(context, 'remove', effect.terrain, effect.positions.slice()));
        used += 1;
      }
    }
  }
  return mutations;
};

/** ICON p.219 Obsidian Flesh: enter the stance with a d6 power die at 1. The
 * damage-triggered ticks, resistance at 4+, and the stunned collapse are
 * documented stance windows. */
const obsidianFleshEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [
    stanceMutation(context, source.id, 'enter', 'obsidian-flesh'),
    stateMutation(context, source.id, 'obsidian-flesh:die', 1),
  ];
};

/** ICON p.220 Realignment: end all statuses on an adjacent character and
 * create a burst 1 area effect from them — characters inside take piercing fray
 * once for each effect purged (max 4). A foe target may also be shattered.
 * Charge: also end any marks of your choice, counting as purging an effect. */
const realignmentEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Realignment requires an adjacent character with a status.');
  if (distance(source.position, target.position) > 1) throw new RuleProgramViolation('choice.actor-range', 'Realignment requires an adjacent character.');
  const purged = target.conditions.size + (context.triggers?.has('charge') ? target.marks.length : 0);
  if (purged === 0) throw new RuleProgramViolation('choice.actor-count', 'Realignment requires a character affected by at least one status.');
  const mutations: RuleMutation[] = [];
  for (const condition of target.conditions) {
    mutations.push({ kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, conditionId: condition, operation: 'remove', potency: 'normal' });
  }
  if (context.triggers?.has('charge')) {
    for (const mark of target.marks) mutations.push({ kind: 'mark', sourceId: context.sourceId, ownerId: source.id, operation: 'remove', actorId: target.id, markId: mark.markId, state: {} });
  }
  if (target.side !== source.side) mutations.push(conditionMutation(context, target.id, 'shattered'));
  const burst = squareArea(target.position, 1);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || !position || !burst.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, source.fray * Math.min(4, purged), 'area', 'piercing'));
  }
  return mutations;
};

/** ICON p.220 Midas (interrupt): after the triggering ability resolves, remove
 * the character (you or a willing ally in range 5) and replace them with a
 * height 1 statue object. The start-of-next-turn return and the twice-per-
 * combat permanence are documented turn-start windows. */
const midasEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.triggerTargetIds?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Midas requires a character in range 5.');
  if (distance(source.position, target.position) > 5) throw new RuleProgramViolation('choice.actor-range', 'Midas requires a character in range 5.');
  const mutations: RuleMutation[] = [
    removeMutation(context, target.id),
    { kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: 'statue', ownerId: source.id, positions: [target.position], count: 1, state: { held: target.id } },
    stateMutation(context, source.id, 'midas:used', Number(source.state['midas:used'] ?? 0) + 1),
  ];
  return mutations;
};

/** ICON p.221 Quaking Palm: [D]+1 on hit (1 on miss), the foe is vulnerable,
 * and lethal vibrations are set up in their body — when they end their next
 * turn they take 1 piercing damage for every object adjacent to them (max 4).
 * The vibration damage is a documented turn-end window. */
const quakingPalmEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie) + 1, 'hit')
    : damageMutation(context, target.id, 1, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'vulnerable'));
  mutations.push(markMutation(context, target.id, 'quaking-palm', {}));
  return mutations;
};

export const GEOMANCER_RULE_RESOLVERS: RuleResolverRegistry = {
  'geomancer:bio:effects': bioEffects,
  'geomancer:bio:biotic': bioticEffects,
  'geomancer:dragon-dive:effects': dragonDiveEffects,
  'geomancer:geo:effects': geoEffects,
  'geomancer:helix-heel:effects': helixHeelEffects,
  'geomancer:terraforming:effects': terraformingEffects,
  'geomancer:obsidian-flesh:effects': obsidianFleshEffects,
  'geomancer:realignment:effects': realignmentEffects,
  'geomancer:midas:effects': midasEffects,
  'geomancer:quaking-palm:effects': quakingPalmEffects,
};

export const GEOMANCER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'geomancer:bio': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'pierce', 'small blast', 'range'],
      range: constant(8),
      resolverId: 'geomancer:bio:effects',
      steps: [],
    }),
    action({
      id: 'infuse', name: 'BIOTIC', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(3) }],
      tags: ['attack', 'pierce', 'medium blast', 'range'],
      range: constant(8),
      resolverId: 'geomancer:bio:biotic',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'charge']),

  'geomancer:dragon-dive': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['end turn', 'delay', 'range'],
    range: constant(6),
    resolverId: 'geomancer:dragon-dive:effects',
    steps: [],
  })], ['effect', 'end turn', 'delay', 'area effect']),

  'geomancer:geo': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'arc'],
      range: constant(6),
      resolverId: 'geomancer:geo:effects',
      steps: [],
    }),
    action({
      id: 'infuse', name: 'GEOTIC', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(4) }],
      tags: ['attack', 'arc'],
      resolverId: 'geomancer:geo:effects',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'terrain effect', 'charge']),

  'geomancer:helix-heel': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['line'],
    resolverId: 'geomancer:helix-heel:effects',
    steps: [],
  })], ['area effect', 'effect', 'charge']),

  'geomancer:terraforming': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['range'],
    range: constant(6),
    resolverId: 'geomancer:terraforming:effects',
    steps: [],
  })], ['terrain effect', 'charge']),

  'geomancer:obsidian-flesh': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['stance', 'power die'],
    resolverId: 'geomancer:obsidian-flesh:effects',
    steps: [],
  })], ['stance', 'refresh']),

  'geomancer:realignment': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: [],
    resolverId: 'geomancer:realignment:effects',
    steps: [],
  })], ['effect', 'area effect', 'charge']),

  'geomancer:midas': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: ['range'],
    range: constant(5),
    resolverId: 'geomancer:midas:effects',
    steps: [],
  })], ['interrupt', 'effect']),

  'geomancer:quaking-palm': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'pierce', 'range'],
    range: constant(3),
    resolverId: 'geomancer:quaking-palm:effects',
    steps: [],
  })], ['attack', 'on hit', 'miss', 'effect', 'charge']),
};
