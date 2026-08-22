import { RuleProgramViolation } from './runtime.js';
import type { RuleSourceUnit } from '../source-units.js';
import type { RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from './types.js';
import {
  axisDirection, ringAround, sameCell, squareArea,
  constant,
  distance, sourceActor, walk, freeCellsInRange, resolveAttack,
  damageMutation, conditionMutation, stateMutation, markMutation, stanceMutation,
  shoveMutation, rushMutation, entityMutation, terrainMutation,
  action, compilation,
} from './job-kit.js';

/**
 * Independently reviewed Warden ability implementations (ICON p.165–171), the
 * fourth Vagabond job. Every ability below has typed costs, targets, ranges,
 * and tags from the source catalog plus a hand-authored typed RuleProgram and
 * a named deterministic resolver.
 *
 * Beasts are `beast` entities; portals are `underway` entities; mist clouds are
 * `mist-cloud` terrain effects. Cross-command lifecycles resolve through
 * reducer hooks in encounter.ts:
 * - Sidhe's toxin detonates at the end of the marked foe's next turn (6 damage,
 *   or 3 adjacent to an ally).
 * - Stampede's spirit beast charges at the end of the marked foe's turn (2
 *   damage, shove 1, then coalesces into a beast summon), once per round.
 * - Morrigan's delay resolves the flock at the start of the user's (slow) next
 *   turn.
 * - Strength of the Pack refreshes at the start of the user's turn.
 * - Underway grows a second portal at the end of the user's turn.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Gwynt and Circle the Oak's optional ally dashes take a deterministic
 *   toward-the-foe direction; the circular traversal counts adjacent allies
 *   clockwise and stops at the first foe/obstruction.
 * - Stampede's line-from-the-edge shove is reduced to its damage/shove/summon
 *   core; the exact line geometry and side shoves are table-facing.
 * - Mist Strider's consume-a-cloud-at-turn-start is a free-action choice and is
 *   documented; Underway's portal teleport is a free-action table-facing effect.
 */

const summonBeastNear = (context: Parameters<RuleResolver>[0], ownerId: string, center: { x: number; y: number }): RuleMutation | null => {
  const cell = freeCellsInRange(context, center, 1)[0];
  return cell ? entityMutation(context, ownerId, cell, 'beast', {}) : null;
};

/** ICON p.169: range-3 +1-boon attack, daze, summon a beast adjacent to the
 * target; Finishing Blow/Charge summons one more beast and grants stealth. */
const apexEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  const targetPosition = target?.position;
  const mutations: RuleMutation[] = [];
  if (!target || !targetPosition) return mutations;
  const roll = resolveAttack(context, source, target, { boons: 1 });
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'dazed'));
  const beast = summonBeastNear(context, source.id, targetPosition);
  if (beast) mutations.push(beast);
  if (context.triggers?.has('finishing-blow') || context.triggers?.has('charge')) {
    const second = freeCellsInRange(context, targetPosition, 1)[1];
    if (second) mutations.push(entityMutation(context, source.id, second, 'beast', {}));
    mutations.push(conditionMutation(context, source.id, 'stealth'));
  }
  return mutations;
};

/** ICON p.169: dash up to 2, deal 2 to an adjacent foe, an ally dashes 2 and
 * deals 2 if adjacent; Finishing Blow/Charge grants both stealth. */
const gwyntEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  const foeId = context.input.actorIds?.target?.[0];
  const allyId = context.input.actorIds?.target?.[1];
  const foe = foeId ? sourceActor(context, foeId) : undefined;
  const ally = allyId ? sourceActor(context, allyId) : undefined;
  const foePosition = foe?.position;
  const mutations: RuleMutation[] = [];
  if (!sourcePosition || !foe || !foePosition) return mutations;
  const dash = walk(context, sourcePosition, axisDirection(sourcePosition, foePosition), 2, false, source.id);
  if (!sameCell(dash, sourcePosition)) mutations.push(rushMutation(context, source.id, dash));
  if (distance(dash, foePosition) <= 1) mutations.push(damageMutation(context, foe.id, 2, 'effect'));
  if (ally?.position && distance(foePosition, ally.position) <= 3) {
    const allyDash = walk(context, ally.position, axisDirection(ally.position, foePosition), 2, false, ally.id);
    if (!sameCell(allyDash, ally.position)) mutations.push(rushMutation(context, ally.id, allyDash));
    if (distance(allyDash, foePosition) <= 1) mutations.push(damageMutation(context, foe.id, 2, 'effect'));
  }
  if (context.triggers?.has('finishing-blow') || context.triggers?.has('charge')) {
    mutations.push(conditionMutation(context, source.id, 'stealth'));
    if (ally) mutations.push(conditionMutation(context, ally.id, 'stealth'));
  }
  return mutations;
};

/** ICON p.169: dash 2, attack for 2[D] (or 1 on a miss), then circle the foe
 * clockwise dealing fray per ally passed (max 4); Finishing Blow/Charge dashes 5
 * and shoves the foe 2. */
const circleTheOakEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  const sourcePosition = source.position;
  const targetPosition = target?.position;
  const mutations: RuleMutation[] = [];
  if (!sourcePosition || !target || !targetPosition) return mutations;
  const initial = context.triggers?.has('finishing-blow') || context.triggers?.has('charge') ? 5 : 2;
  const dash = walk(context, sourcePosition, axisDirection(sourcePosition, targetPosition), initial, false, source.id);
  if (!sameCell(dash, sourcePosition)) mutations.push(rushMutation(context, source.id, dash));
  const roll = resolveAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie) + context.dice.die(source.damageDie), 'hit')
    : damageMutation(context, target.id, 1, 'miss'));
  if (distance(dash, targetPosition) <= 1) {
    const ring = ringAround(targetPosition);
    let passed = 0;
    for (const cell of ring) {
      const allyThere = Object.values(context.state.actors).some((actor) => actor.id !== source.id && actor.side === source.side && actor.position && sameCell(actor.position, cell));
      if (allyThere && passed < 4) {
        mutations.push(damageMutation(context, target.id, source.fray, 'effect'));
        passed += 1;
      }
    }
  }
  if (context.triggers?.has('finishing-blow') || context.triggers?.has('charge')) {
    mutations.push(shoveMutation(context, target.id, 2, axisDirection(sourcePosition, targetPosition)));
  }
  return mutations;
};

/** ICON p.169: create a small-blast mist cloud in range 3 (replacing the prior
 * one); Charge creates a second cloud. */
const mistStriderEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  if (!sourcePosition) return [];
  const center = context.input.positions?.['area-center']?.[0] ?? sourcePosition;
  if (distance(sourcePosition, center) > 3) throw new RuleProgramViolation('choice.position-range', 'Mist Strider places a cloud in range 3.');
  const mutations: RuleMutation[] = [];
  for (const effect of context.state.terrainEffects) {
    if (effect.terrain === 'mist-cloud' && effect.ownerId === source.id) {
      mutations.push(terrainMutation(context, 'remove', 'mist-cloud', [...effect.positions]));
    }
  }
  mutations.push(terrainMutation(context, 'create', 'mist-cloud', squareArea(center, 1)));
  if (context.triggers?.has('charge')) {
    const second = freeCellsInRange(context, center, 3)[0];
    if (second) mutations.push(terrainMutation(context, 'create', 'mist-cloud', squareArea(second, 1)));
  }
  return mutations;
};

/** ICON p.170: mark a foe in range 4; the spirit beast charges at the end of the
 * foe's turn (2 damage, shove 1, coalescing into a beast summon) via the reducer. */
const stampedeEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  const targetId = context.input.actorIds?.target?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!sourcePosition || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Stampede requires a foe in range 4.');
  if (target.side === source.side || distance(sourcePosition, target.position) > 4) throw new RuleProgramViolation('choice.actor-range', 'Stampede requires a foe in range 4.');
  return [markMutation(context, target.id, 'stampede', {})];
};

/** ICON p.170: enter the stance, summon a beast in the aura, and dash yourself
 * and allies 1; the stance refreshes at the start of your turn in the reducer. */
const strengthOfThePackEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  const mutations: RuleMutation[] = [stanceMutation(context, source.id, 'enter', 'strength-of-the-pack')];
  if (sourcePosition) {
    const beastCell = freeCellsInRange(context, sourcePosition, 2)[0];
    if (beastCell) mutations.push(entityMutation(context, source.id, beastCell, 'beast', {}));
    for (const character of Object.values(context.state.actors)) {
      const characterPosition = character.position;
      if (character.side !== source.side || !characterPosition) continue;
      const dash = walk(context, characterPosition, { x: 1, y: 0 }, 1, false, character.id);
      if (!sameCell(dash, characterPosition)) mutations.push(rushMutation(context, character.id, dash));
    }
  }
  return mutations;
};

/** ICON p.170: create a leafy portal in a free adjacent space; a second portal
 * grows at the end of your turn via the reducer. Charge summons a beast. */
const underwayEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  if (!sourcePosition) return [];
  const mutations: RuleMutation[] = [];
  for (const [id, entity] of Object.entries(context.state.entities)) {
    if (entity.type === 'underway' && entity.ownerId === source.id) {
      mutations.push({ kind: 'entity', sourceId: context.sourceId, operation: 'remove', entityType: 'underway', ownerId: source.id, positions: [], count: 0, state: {} });
      break;
    }
  }
  const portalCell = freeCellsInRange(context, sourcePosition, 1)[0];
  if (!portalCell) throw new RuleProgramViolation('choice.position-range', 'Underway requires a free adjacent space.');
  mutations.push(entityMutation(context, source.id, portalCell, 'underway', {}));
  if (context.triggers?.has('charge')) {
    const beastCell = freeCellsInRange(context, sourcePosition, 2)[0];
    if (beastCell) mutations.push(entityMutation(context, source.id, beastCell, 'beast', {}));
  }
  return mutations;
};

/** ICON p.171: end the turn and gain Delay; at the start of your (slow) next
 * turn the flock lashes out — allies gain stealth, foes are shoved 2 and
 * blinded. */
const morriganEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [
    stateMutation(context, source.id, 'morrigan:pending', true),
    stateMutation(context, source.id, 'end-turn-requested', true),
  ];
};

/** ICON p.171: melee +1-boon attack, blind, and inject the toxin; the toxin
 * deals 6 damage (3 adjacent to an ally) at the end of the foe's next turn.
 * Finishing Blow/Charge shoves the target 2. */
const sidheEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  const mutations: RuleMutation[] = [];
  if (!target) return mutations;
  const roll = resolveAttack(context, source, target, { boons: 1 });
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie), 'hit')
    : damageMutation(context, target.id, 1, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'blind'));
  mutations.push(markMutation(context, target.id, 'sidhe-toxin', {}));
  if ((context.triggers?.has('finishing-blow') || context.triggers?.has('charge')) && source.position && target.position) {
    mutations.push(shoveMutation(context, target.id, 2, axisDirection(source.position, target.position)));
  }
  return mutations;
};

export const WARDEN_RULE_RESOLVERS: RuleResolverRegistry = {
  'warden:apex:effects': apexEffects,
  'warden:gwynt:effects': gwyntEffects,
  'warden:circle-the-oak:effects': circleTheOakEffects,
  'warden:mist-strider:effects': mistStriderEffects,
  'warden:stampede:effects': stampedeEffects,
  'warden:strength-of-the-pack:effects': strengthOfThePackEffects,
  'warden:underway:effects': underwayEffects,
  'warden:morrigan:effects': morriganEffects,
  'warden:sidhe:effects': sidheEffects,
};

export const WARDEN_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'warden:apex': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'range'],
    range: constant(3),
    resolverId: 'warden:apex:effects',
    steps: [],
  })], ['attack', 'on hit', 'miss', 'effect', 'effect', 'finishing blow or charge']),

  'warden:gwynt': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: [],
    resolverId: 'warden:gwynt:effects',
    steps: [],
  })], ['effect', 'effect', 'finishing blow or charge']),

  'warden:circle-the-oak': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack'],
    resolverId: 'warden:circle-the-oak:effects',
    steps: [],
  })], ['effect', 'attack', 'on hit', 'miss', 'effect', 'finishing blow or charge']),

  'warden:mist-strider': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['summon', 'terrain effect', 'range'],
    range: constant(3),
    resolverId: 'warden:mist-strider:effects',
    steps: [],
  })], ['terrain effect', 'charge', 'summon']),

  'warden:stampede': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark', 'summon', 'range'],
    range: constant(4),
    resolverId: 'warden:stampede:effects',
    steps: [],
  })], ['mark', 'summon', 'collide or charge']),

  'warden:strength-of-the-pack': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['stance', 'aura'],
    resolverId: 'warden:strength-of-the-pack:effects',
    steps: [],
  })], ['stance', 'effect', 'refresh']),

  'warden:underway': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['terrain effect'],
    resolverId: 'warden:underway:effects',
    steps: [],
  })], ['terrain effect', 'object effect', 'charge']),

  'warden:morrigan': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['delay', 'end turn'],
    resolverId: 'warden:morrigan:effects',
    steps: [],
  })], ['effect', 'effect']),

  'warden:sidhe': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack'],
    resolverId: 'warden:sidhe:effects',
    steps: [],
  })], ['attack', 'on hit', 'miss', 'effect', 'effect', 'finishing blow or charge']),
};
