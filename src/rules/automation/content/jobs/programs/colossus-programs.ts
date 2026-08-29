import { RuleProgramViolation } from '../../../kernels/runtime.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { Position } from '../../../../types.js';
import type { RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, orthogonalNeighbors, sameCell, squareArea,
  constant, damageDie, fray, normalDamage, attackTarget,
  distance, withinGrid, sourceActor, walk, firstFreeCell, nearestFoe,
  damageMutation, conditionMutation, stateMutation,
  shoveMutation, flyMutation, rushMutation, removeMutation, placeMutation,
  terrainMutation, entityMutation,
  notHeroic, action, compilation,
} from '../../../primitives/job-kit.js';

/**
 * Independently reviewed Colossus ability implementations (ICON p.133–138).
 *
 * Every ability below has typed costs, targets, ranges, and tags from the
 * source catalog plus a hand-authored typed RuleProgram. Sacrifice is modeled
 * by the shared `sacrifice` damage type (it cannot reduce the user below 1
 * hp); object/terrain effects use the shared area geometry and entity/terrain
 * mutations; and Boiling Blood's defy-death and Massive Overhead's next-attack
 * enhancement resolve through reducer lifecycle hooks so they stay
 * deterministic and replayable.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - "Exceed or Heroic" terrain extras (Valkyrie / Takedown pits, Gigaton Whip
 *   difficult terrain) consume the durable trigger set supplied by the
 *   command boundary. Ordinary attack Exceed is derived before the resolver
 *   runs, so these branches observe the same recorded trigger as the attack.
 * - Raging Wolf's tiered Comeback effects resolve in listed order from the
 *   current hp; the 25%-and-1hp tiers are deterministic (first adjacent foe /
 *   nearest foe).
 * - Massive Overhead's next-attack bonus damage applies to resolver-based
 *   attacks via `bonus-damage` and to basic attacks via an extra damage die;
 *   its pit and small-blast trigger on the ability-attack path.
 */

/** Walk up to `steps` cells in `direction`, stopping at the grid edge,
 * impassable terrain, or occupancy; returns null when no cell is moved.
 * `extraExcludedIds` are treated as not occupying their cells (Great Suplex). */
function plannedFly(context: Parameters<RuleResolver>[0], actorId: string, steps: number, direction: Position, extraExcludedIds: ReadonlySet<string> = new Set()): Position | null {
  const source = sourceActor(context, actorId);
  if (!source.position) return null;
  const destination = walk(context, source.position, direction, steps, false, actorId, { excludeIds: extraExcludedIds });
  return sameCell(destination, source.position) ? null : destination;
}

/** ICON p.133: fly 1, true-strike attack, weakened target, pit on Exceed/Heroic. */
const valkyrieEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source || !source.position || !target || !target.position) return [];
  const mutations: RuleMutation[] = [];
  const direction = axisDirection(source.position, target.position);
  const destination = plannedFly(context, source.id, 1, direction);
  if (destination) mutations.push(flyMutation(context, source.id, destination));
  mutations.push(conditionMutation(context, target.id, 'weakened'));
  if (context.triggers?.has('exceed') || context.triggers?.has('heroic')) {
    mutations.push(terrainMutation(context, 'create', 'pit', [target.position]));
  }
  return mutations;
};

/** ICON p.133: create a height-1 boulder object and shove adjacent characters away. */
const upheavalEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source || !source.position) return [];
  const defaultCells: Position[] = [];
  for (let radius = 1; radius <= 3; radius += 1) {
    for (const cell of squareArea(source.position, radius)) {
      if (distance(source.position, cell) === radius) defaultCells.push(cell);
    }
  }
  const center = context.input.positions?.['terrain-position']?.[0] ?? firstFreeCell(context, defaultCells, source.id) ?? source.position;
  const mutations: RuleMutation[] = [entityMutation(context, source.id, center, 'object', { height: 1 })];
  const shoved: Position[] = [];
  for (const character of Object.values(context.state.actors)) {
    if (!character.position || distance(character.position, center) > 1) continue;
    const direction = axisDirection(center, character.position);
    mutations.push(shoveMutation(context, character.id, 1, direction));
    shoved.push(character.position);
  }
  if (context.triggers?.has('comeback') || context.triggers?.has('heroic')) {
    for (const position of shoved) mutations.push(terrainMutation(context, 'create', 'difficult', [position]));
  }
  return mutations;
};

/** ICON p.133: fly 1, sacrifice 6, and damage an adjacent foe; Heroic rushes 2. */
const dropkickEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source || !source.position || !target || !target.position) {
    throw new RuleProgramViolation('choice.actor-count', 'Dropkick requires an adjacent foe.');
  }
  if (target.side === source.side || distance(source.position, target.position) > 1) {
    throw new RuleProgramViolation('choice.actor-range', 'Dropkick requires an adjacent foe.');
  }
  const mutations: RuleMutation[] = [];
  const direction = axisDirection(source.position, target.position);
  const destination = plannedFly(context, source.id, 1, direction);
  if (destination) mutations.push(flyMutation(context, source.id, destination));
  mutations.push(damageMutation(context, source.id, 6, 'effect', 'sacrifice'));
  const damage = context.dice.die(source.damageDie) + source.fray;
  mutations.push(damageMutation(context, target.id, damage, 'effect'));
  if (context.triggers?.has('heroic')) {
    const rush = plannedFly(context, source.id, 2, axisDirection(source.position, target.position));
    if (rush) mutations.push(rushMutation(context, source.id, rush));
  }
  return mutations;
};

/** ICON p.134: end the turn and arm the next attack with bonus damage, a pit, and a Heroic blast. */
const massiveOverheadEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source) return [];
  const mutations: RuleMutation[] = [
    stateMutation(context, source.id, 'massive-overhead', true),
  ];
  if (context.triggers?.has('comeback') || context.triggers?.has('heroic')) {
    mutations.push(stateMutation(context, source.id, 'massive-overhead:heroic', true));
  }
  return mutations;
};

/** ICON p.134: attack, stun both characters, optional sacrifice 4 to avoid the self-stun, pit on Exceed/Heroic. */
const takedownEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source || !target) return [];
  const mutations: RuleMutation[] = [];
  const avoidStun = (context.input.numbers?.sacrifice ?? 0) >= 4;
  if (avoidStun) {
    mutations.push(damageMutation(context, source.id, 4, 'effect', 'sacrifice'));
  } else {
    mutations.push(conditionMutation(context, source.id, 'stunned'));
  }
  mutations.push(conditionMutation(context, target.id, 'stunned'));
  if (target.position && (context.triggers?.has('exceed') || context.triggers?.has('heroic'))) {
    mutations.push(terrainMutation(context, 'create', 'pit', [target.position]));
  }
  return mutations;
};

/** ICON p.134: pick up an adjacent foe, sacrifice up to 6, fly half that, then drop the foe with damage. */
const greatSuplexEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source || !source.position || !target || !target.position) {
    throw new RuleProgramViolation('choice.actor-count', 'Great Suplex requires an adjacent foe.');
  }
  if (target.side === source.side || distance(source.position, target.position) > 1) {
    throw new RuleProgramViolation('choice.actor-range', 'Great Suplex requires an adjacent foe.');
  }
  const heroic = context.triggers?.has('heroic') === true;
  const sacrifice = heroic ? 6 : Math.max(0, Math.min(6, Math.floor(context.input.numbers?.sacrifice ?? 6)));
  const flySpaces = Math.floor(sacrifice / 2);
  const mutations: RuleMutation[] = [removeMutation(context, target.id)];
  if (!heroic && sacrifice > 0) mutations.push(damageMutation(context, source.id, sacrifice, 'effect', 'sacrifice'));
  const direction = axisDirection(source.position, target.position);
  const landing = plannedFly(context, source.id, flySpaces, direction, new Set([target.id])) ?? source.position;
  if (!sameCell(landing, source.position)) mutations.push(flyMutation(context, source.id, landing));
  const dropCell = firstFreeCell(context, orthogonalNeighbors(landing), source.id);
  if (!dropCell) {
    throw new RuleProgramViolation('choice.position-unavailable', 'Great Suplex cannot place the foe in a valid adjacent space.');
  }
  mutations.push(placeMutation(context, target.id, dropCell));
  const damage = context.dice.die(source.damageDie) + source.fray;
  mutations.push(damageMutation(context, target.id, damage, 'effect'));
  mutations.push(conditionMutation(context, target.id, 'slashed'));
  mutations.push(conditionMutation(context, target.id, 'stunned'));
  return mutations;
};

/** ICON p.135: attack, shove 2; Collide removes/flies/replaces the foe; Exceed/Heroic smashes difficult terrain. */
const gigatonWhipEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source || !source.position || !target || !target.position) return [];
  const mutations: RuleMutation[] = [];
  const direction = axisDirection(source.position, target.position);
  // ICON p.135 Gigaton Whip talent 2: "Fly 2 instead. Charge: Shove 3 and
  // fly 3." The base shove 2 is emitted here. The shove-3 Charge variant
  // is a compound blocker (the resolver emits shove-2 unconditionally;
  // retracting it from the program step is not possible). The fly distance
  // IS resolver-controlled and gated below.
  mutations.push(shoveMutation(context, target.id, 2, direction));
  const hasTalentII = (source.talents?.['colossus:gigaton-whip'] ?? 0) >= 2;
  if (context.triggers?.has('collide')) {
    // ICON p.135 base: "fly 1". TII: "Fly 2 instead." Charge variant
    // (with TII): "fly 3".
    const flyDistance = hasTalentII && context.triggers?.has('charge') ? 3
      : hasTalentII ? 2 : 1;
    const landing = plannedFly(context, source.id, flyDistance, direction) ?? source.position;
    const dropCell = firstFreeCell(context, orthogonalNeighbors(landing), source.id);
    if (dropCell) {
      mutations.push(removeMutation(context, target.id));
      if (!sameCell(landing, source.position)) mutations.push(flyMutation(context, source.id, landing));
      mutations.push(placeMutation(context, target.id, dropCell));
      mutations.push(damageMutation(context, target.id, source.fray, 'effect'));
    }
  }
  if (context.triggers?.has('exceed') || context.triggers?.has('heroic')) {
    const cells = [target.position, ...orthogonalNeighbors(target.position).slice(0, 2)];
    for (const cell of cells) if (withinGrid(cell, context)) mutations.push(terrainMutation(context, 'create', 'difficult', [cell]));
  }
  return mutations;
};

/** ICON p.135: bloodied-gated tiered rush/fly/shove chain; Heroic grants unstoppable and damage immunity. */
const ragingWolfEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source || !source.position) return [];
  const position = source.position;
  const maxHp = Math.max(1, source.maxHp);
  if (source.hp > maxHp / 2) {
    throw new RuleProgramViolation('raging-wolf.bloodied', 'Raging Wolf has no effect unless you are bloodied.');
  }
  // ICON p.135 Raging Wolf talent 2: "While you're at 1 hp, increase flight
  // to 3." The equipped talent (rank ≥ 2) widens the quarter-hp FLIGHT (not
  // the rush) from 1 to 3 exactly while the user is at 1 hp.
  const flyDistanceTalent = (source.talents?.['colossus:raging-wolf'] ?? 0) >= 2;
  const mutations: RuleMutation[] = [];
  if (context.triggers?.has('heroic')) {
    mutations.push(conditionMutation(context, source.id, 'unstoppable'));
    mutations.push(stateMutation(context, source.id, 'damage-immune', true));
  }
  const bloodiedChain = () => {
    const foe = nearestFoe(context, position, source.id);
    if (foe?.position) {
      const direction = axisDirection(position, foe.position);
      const rush = plannedFly(context, source.id, 1, direction);
      if (rush) mutations.push(rushMutation(context, source.id, rush));
      const landed = rush ?? position;
      const adjacent = Object.values(context.state.actors)
        .filter((actor) => actor.id !== source.id && actor.side !== source.side && actor.position && distance(actor.position, landed) <= 1)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (adjacent) {
        mutations.push(damageMutation(context, adjacent.id, source.fray, 'effect'));
        mutations.push(conditionMutation(context, adjacent.id, 'slashed'));
      }
    }
  };
  const quarterChain = () => {
    const foe = nearestFoe(context, position, source.id);
    const direction = foe?.position ? axisDirection(position, foe.position) : { x: 1, y: 0 };
    // Talent 2: while at exactly 1 hp the flight becomes 3 spaces (ICON p.135).
    const flySteps = source.hp <= 1 && flyDistanceTalent ? 3 : 1;
    const fly = plannedFly(context, source.id, flySteps, direction);
    if (fly) mutations.push(flyMutation(context, source.id, fly));
    const landed = fly ?? position;
    for (const adjacent of Object.values(context.state.actors)) {
      if (adjacent.id === source.id || adjacent.side === source.side || !adjacent.position || distance(adjacent.position, landed) > 1) continue;
      mutations.push(shoveMutation(context, adjacent.id, 1, axisDirection(landed, adjacent.position)));
    }
  };
  bloodiedChain();
  if (source.hp <= maxHp / 4) quarterChain();
  if (source.hp <= 1) {
    bloodiedChain();
    quarterChain();
  }
  return mutations;
};

/** ICON p.138: Defy Death — remain standing at 1 hp until the end of your next turn and deal bonus damage. */
const boilingBloodEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source) return [];
  const mutations: RuleMutation[] = [
    { kind: 'persistent', sourceId: context.sourceId, ownerId: source.id, operation: 'add', actorId: source.id, effectId: 'defy-death', duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: 2 }, modifiers: [], triggers: ['defeated'], state: {} },
    { kind: 'resource', sourceId: context.sourceId, actorId: source.id, resourceId: 'bonus-damage', operation: 'gain', amount: 1, minimum: 0, maximum: null },
  ];
  if (context.triggers?.has('heroic')) {
    for (const foe of Object.values(context.state.actors)) {
      if (foe.side === source.side || !foe.position || distance(foe.position, source.position!) > 1) continue;
      mutations.push(damageMutation(context, foe.id, source.fray, 'effect'));
      mutations.push(damageMutation(context, foe.id, source.fray, 'effect'));
    }
  }
  return mutations;
};

export const COLOSSUS_RULE_RESOLVERS: RuleResolverRegistry = {
  'colossus:valkyrie:effects': valkyrieEffects,
  'colossus:upheaval': upheavalEffects,
  'colossus:dropkick': dropkickEffects,
  'colossus:massive-overhead': massiveOverheadEffects,
  'colossus:takedown:effects': takedownEffects,
  'colossus:great-suplex': greatSuplexEffects,
  'colossus:gigaton-whip:effects': gigatonWhipEffects,
  'colossus:raging-wolf': ragingWolfEffects,
  'colossus:boiling-blood': boilingBloodEffects,
};

export const COLOSSUS_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'colossus:valkyrie': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'true strike'],
    range: constant(1),
    resolverId: 'colossus:valkyrie:effects',
    steps: [{
      id: 'attack', timing: 'use', effects: [{
        kind: 'attack', target: attackTarget, trueStrike: true,
        onHit: [normalDamage({ kind: 'add', values: [damageDie(1), fray()] })],
        onMiss: [normalDamage(fray(), 'miss')],
        onCritical: [normalDamage(damageDie(1))],
      }],
    }],
  })], ['effect', 'on hit', 'miss', 'effect', 'exceed or heroic']),

  'colossus:upheaval': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['range'],
    range: constant(3),
    resolverId: 'colossus:upheaval',
    steps: [],
  })], ['terrain effect', 'effect', 'comeback or heroic']),

  'colossus:dropkick': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['sacrifice'],
    resolverId: 'colossus:dropkick',
    steps: [],
  })], ['effect', 'effect', 'heroic']),

  'colossus:massive-overhead': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['end turn'],
    resolverId: 'colossus:massive-overhead',
    steps: [],
  })], ['effect', 'special effect', 'comeback or heroic']),

  'colossus:takedown': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack'],
    range: constant(1),
    resolverId: 'colossus:takedown:effects',
    steps: [
      {
        id: 'attack', timing: 'use', condition: notHeroic, effects: [{
          kind: 'attack', target: attackTarget,
          onHit: [normalDamage({ kind: 'add', values: [damageDie(1), fray()] })],
          onMiss: [normalDamage(fray(), 'miss')],
          onCritical: [normalDamage(damageDie(1))],
        }],
      },
      {
        id: 'attack-heroic', timing: 'use', trigger: 'heroic', effects: [{
          kind: 'attack', target: attackTarget, trueStrike: true,
          onHit: [normalDamage({ kind: 'add', values: [damageDie(1), fray()] })],
          onMiss: [normalDamage(fray(), 'miss')],
          onCritical: [normalDamage(damageDie(1))],
        }],
      },
    ],
  })], ['on hit', 'miss', 'effect', 'effect', 'exceed or heroic']),

  'colossus:great-suplex': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: [],
    resolverId: 'colossus:great-suplex',
    steps: [],
  })], ['effect', 'effect', 'heroic']),

  'colossus:gigaton-whip': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'true strike'],
    range: constant(1),
    resolverId: 'colossus:gigaton-whip:effects',
    steps: [{
      id: 'attack', timing: 'use', effects: [{
        kind: 'attack', target: attackTarget, trueStrike: true,
        onHit: [normalDamage(damageDie(1))],
        onMiss: [normalDamage(constant(1), 'miss')],
        onCritical: [normalDamage(damageDie(1))],
      }],
    }],
  })], ['on hit', 'miss', 'effect', 'collide', 'exceed or heroic']),

  'colossus:raging-wolf': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['true strike'],
    resolverId: 'colossus:raging-wolf',
    steps: [],
  })], ['special', 'comeback', 'heroic', 'special']),

  'colossus:boiling-blood': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: [],
    resolverId: 'colossus:boiling-blood',
    steps: [],
  })], ['trigger', 'effect', 'heroic']),
};
