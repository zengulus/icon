import { RuleProgramViolation } from '../../../kernels/runtime.js';
import { registerMovementEntryTrigger } from '../../../kernels/movement-triggers.js';
import { isBloodied } from '../../../kernels/encounter-adapter.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { Position } from '../../../../types.js';
import type { RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, orthogonalNeighbors, sameCell, squareArea,
  constant, attackStep,
  distance, sourceActor, occupied, impassable, walk, freeCellsInRange,
  damageMutation, conditionMutation, stateMutation, resourceMutation, stanceMutation, markMutation,
  rushMutation, flyMutation, placeMutation, entityMutation, terrainMutation, swapMutations,
  gambleD6,
  untilNextTurnStart, action, compilation,
} from '../../../primitives/job-kit.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';

/**
 * Independently reviewed Fool ability implementations (ICON p.150–152), the
 * first Vagabond job. Every ability below has typed costs, targets, ranges,
 * and tags from the source catalog plus a hand-authored typed RuleProgram and
 * a named deterministic resolver. Bombs are `bomb` entities; their detonation
 * (Carnevale, p.150) resolves through a reducer turn-end hook so the gamble is
 * pre-rolled at the command boundary and stays replayable. Gallows Humor's
 * power-die refresh (turn start + any miss) is likewise a reducer hook.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Carnevale's optional "dash 1 after each bomb" is not auto-applied; the
 *   caller can dash through the normal movement command. Its "end your turn
 *   without attacking" detonation is auto-resolved at turn end (the optional
 *   gamble is taken deterministically).
 * - Party Favor's "when any character enters the space" explosion auto-fires
 *   through the movement-entry trigger fold (kernels/movement-triggers.ts): a
 *   voluntary MOVE/DASH into the mine's space detonates it with the gamble
 *   rolled at the command boundary and recorded on the event. The source text
 *   uses unqualified "enters" — forced-movement entry is an incomplete
 *   semantic boundary. The `detonate` sub-action through EXECUTE_RULE remains
 *   for manual resolution.
 * - Masquerade is fully wired: a `targeted-by-ability` window holds an ability
 *   aimed at the user, the interrupt swaps places with a willing ally in range
 *   3, and the window's `retarget` redirects the held effects to that ally.
 * - Gallows Humor's empowerment resets the die and grants bonus damage; the
 *   "triggers any slay effects" clause is asserted by the caller passing the
 *   `slay` trigger on the empowered ability.
 * - Chronotemper's Cheat Time is executable by any actor that owns the
 *   ability; the mark itself is the provenance that grants it to the marked
 *   ally (the VM does not gate interrupt ownership on marks yet).
 */

/** ICON p.150: dash 3 (phasing), dash 1 to the side, then a +1-boon attack
 * that dazes the target; a Finishing Blow or Slay summons a bomb. */
const cavaliereEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source?.position) return [];
  const mutations: RuleMutation[] = [];
  const direction = context.input.directions?.['direction'] ?? (target?.position ? axisDirection(source.position, target.position) : { x: 1, y: 0 });
  const landed = walk(context, source.position, direction, 3, true, source.id);
  const side = { x: -direction.y, y: direction.x };
  const sideStep = walk(context, landed, side, 1, true, source.id);
  const final = sameCell(sideStep, landed) ? landed : sideStep;
  if (!sameCell(final, source.position)) mutations.push(rushMutation(context, source.id, final));
  if (target) {
    mutations.push(conditionMutation(context, target.id, 'dazed'));
    if (context.triggers?.has('finishing-blow') || context.triggers?.has('slay')) {
      const bombCell = freeCellsInRange(context, final, 2)[0];
      if (bombCell) mutations.push(entityMutation(context, source.id, bombCell, 'bomb', {}));
    }
  }
  return mutations;
};

/** ICON p.150: summon two bombs in range 2, then arm the turn-end detonation. */
const carnevaleEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source?.position) return [];
  const mutations: RuleMutation[] = [];
  const chosen = context.input.positions?.['bomb-positions'] ?? [];
  const cells = [...chosen, ...freeCellsInRange(context, source.position, 2)].slice(0, 2);
  for (const cell of cells) {
    if (distance(cell, source.position) > 2) throw new RuleProgramViolation('choice.position-range', 'Carnevale summons its bombs in range 2.');
  }
  if (cells.length < 2) throw new RuleProgramViolation('choice.position-count', 'Carnevale requires two free spaces in range 2 for its bombs.');
  for (const cell of cells) mutations.push(entityMutation(context, source.id, cell, 'bomb', {}));
  mutations.push(stateMutation(context, source.id, 'carnevale:armed', true));
  return mutations;
};

/** ICON p.150: gamble, dash that many +2 spaces in one direction; moving the
 * full distance grants evasion until the start of the next turn. */
const spinningTopEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source?.position) return [];
  const { roll: gamble } = gambleD6(context.dice);
  const spaces = gamble + 2;
  const direction = context.input.directions?.['direction'] ?? { x: 1, y: 0 };
  const landed = walk(context, source.position, direction, spaces, false, source.id);
  const steps = Math.abs(landed.x - source.position.x) + Math.abs(landed.y - source.position.y);
  const mutations: RuleMutation[] = [];
  if (steps > 0) mutations.push(rushMutation(context, source.id, landed));
  if (steps === spaces) mutations.push(conditionMutation(context, source.id, 'evasion', 'normal', untilNextTurnStart));
  return mutations;
};

/** ICON p.150: a line-6 unerring blast — gamble to choose the attack space,
 * autohit 2[D]+fray there, fray along the line, and a large blast on a
 * Finishing Blow or Slay. A target at 8 hp or less takes 999 divine instead. */
const deathEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source?.position || !target?.position) return [];
  const { roll: gamble } = gambleD6(context.dice);
  const direction = axisDirection(source.position, target.position);
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target, { autoHit: true });
  mutations.push(roll.attackMutation);
  if (target.hp <= 8) {
    mutations.push(damageMutation(context, target.id, 999, 'hit', 'divine'));
  } else {
    const dice = context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie);
    mutations.push(damageMutation(context, target.id, dice + source.fray, 'hit'));
  }
  const line = Array.from({ length: gamble }, (_, index) => ({
    x: source.position!.x + direction.x * (index + 1),
    y: source.position!.y + direction.y * (index + 1),
  }));
  for (const foe of Object.values(context.state.actors)) {
    if (foe.id === target.id || foe.side === source.side || !foe.position) continue;
    if (line.some((cell) => sameCell(cell, foe.position!))) mutations.push(damageMutation(context, foe.id, source.fray, 'area'));
  }
  if (context.triggers?.has('finishing-blow') || context.triggers?.has('slay')) {
    for (const character of Object.values(context.state.actors)) {
      if (character.side === source.side || !character.position || distance(character.position, target.position) > 2) continue;
      mutations.push(damageMutation(context, character.id, source.fray, 'area'));
    }
  }
  return mutations;
};

/** ICON p.151: enter the Gallows Humor stance with a d6 power die starting at
 * 1. The die lives in ruleState so the empower resolver can read it through
 * the generic VM actor view; the reducer's stance-refresh hook ticks it up. */
const gallowsHumorEnter: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [
    stanceMutation(context, source.id, 'enter', 'gallows-humor'),
    stateMutation(context, source.id, 'gallows-humor:die', 1),
  ];
};

/** ICON p.151: at maximum, reset the die to 1 to empower the next ability with
 * bonus damage (the slay effect is asserted by the empowered ability's caller). */
const gallowsHumorEmpower: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const die = Number(source.state['gallows-humor:die'] ?? 0);
  if (die < 1) throw new RuleProgramViolation('stance.required', 'Gallows Humor empowerment requires the Gallows Humor stance.');
  if (die < 6) throw new RuleProgramViolation('stance.die-not-max', 'Gallows Humor can only empower an ability when its power die is at maximum.');
  return [
    stateMutation(context, source.id, 'gallows-humor:die', 1),
    resourceMutation(context, source.id, 'bonus-damage', 'gain', 1),
  ];
};

/** ICON p.151: throw an explosive mine into a free space in range 3. */
const partyFavorEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source?.position) return [];
  const chosen = context.input.positions?.['mine-position']?.[0];
  const cell = chosen ?? freeCellsInRange(context, source.position, 3)[0];
  if (!cell) throw new RuleProgramViolation('choice.position-count', 'Party Favor requires a free space in range 3.');
  if (distance(cell, source.position) > 3) throw new RuleProgramViolation('choice.position-range', 'Party Favor mines are placed in range 3.');
  return [terrainMutation(context, 'create', 'party-favor', [cell])];
};

/** ICON p.151: the deterministic mutations of a Party Favor mine detonation
 * — shared by the manual detonate sub-action (EXECUTE_RULE) and the
 * movement-entry trigger below, so the two paths cannot diverge. Allies of
 * the owner in the medium blast fly 1 away from the mine center (the
 * reducer's F1 gateway validates the destination); foes take 2 area damage
 * plus the Finishing Blow clause when active; a 4+ gamble blinds foes and a
 * 6 gives allies stealth. The mine terrain effect is removed last. */
function partyFavorDetonationMutations(
  ownerId: string,
  ownerSide: string,
  mineCell: Position,
  gamble: number,
  finishingBlow: boolean,
  actors: Readonly<Record<string, { id: string; side: string; position: Position | null }>>,
): RuleMutation[] {
  const area = squareArea(mineCell, 2);
  const mutations: RuleMutation[] = [];
  for (const character of Object.values(actors)) {
    const characterPosition = character.position;
    if (!characterPosition || !area.some((cell) => sameCell(cell, characterPosition))) continue;
    if (character.side === ownerSide) {
      // UNRESOLVED: source says "fly 1" but does not specify direction.
      // The engine has no player-choice seam for movement direction at
      // detonation time. The fly mutation is omitted rather than forcing
      // an arbitrary direction. A movement-choice primitive would resolve this.
    } else {
      mutations.push({
        kind: 'damage', sourceId: 'fool:party-favor', sourceActorId: ownerId, actorId: character.id,
        amount: 2, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false,
      });
      if (finishingBlow) {
        mutations.push(
          { kind: 'damage', sourceId: 'fool:party-favor', sourceActorId: ownerId, actorId: character.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false },
          { kind: 'damage', sourceId: 'fool:party-favor', sourceActorId: ownerId, actorId: character.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false },
        );
      }
      if (gamble >= 4) mutations.push({ kind: 'condition', sourceId: 'fool:party-favor', sourceActorId: ownerId, actorId: character.id, conditionId: 'blind', operation: 'apply', potency: 'normal' });
    }
    if (gamble >= 6 && character.side === ownerSide) mutations.push({ kind: 'condition', sourceId: 'fool:party-favor', sourceActorId: ownerId, actorId: character.id, conditionId: 'stealth', operation: 'apply', potency: 'normal' });
  }
  mutations.push({ kind: 'terrain', sourceId: 'fool:party-favor', sourceActorId: ownerId, operation: 'remove', terrain: 'party-favor', positions: [mineCell], height: null });
  return mutations;
}

/** ICON p.151: detonate a Party Favor mine — gamble, then a medium blast whose
 * effects stack (allies fly 1 and foes take 2 damage; 4+ blinds foes; 6 gives
 * allies stealth; a Finishing Blow doubles the foe damage). */
const partyFavorDetonate: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source?.position) return [];
  const mine = context.input.positions?.['mine-position']?.[0] ?? null;
  const positions = mine ? [mine] : context.state.terrainEffects
    .filter((effect) => effect.terrain === 'party-favor' && effect.ownerId === source.id)
    .flatMap((effect) => effect.positions);
  if (positions.length === 0) throw new RuleProgramViolation('choice.position-count', 'Party Favor detonation requires a placed mine.');
  return partyFavorDetonationMutations(
    source.id,
    source.side,
    positions[0],
    gambleD6(context.dice).roll,
    Boolean(context.triggers?.has('finishing-blow')),
    context.state.actors,
  );
};

// ICON p.151: "When any character enters the space, the mine explodes" — the
// movement-entry trigger the manual detonate sub-action used to stand in for
// (the former "no movement-entry hook" core ruling). The gamble is pre-rolled
// at the MOVE command boundary (recorded in the event's mutations), and the
// Finishing Blow clause auto-fires on a bloodied foe in the blast — or, with
// talent 2 equipped, on a dazed or blinded foe — matching the ability's own
// clause without a caller flag.
registerMovementEntryTrigger({
  sourceId: 'fool:party-favor',
  matchesCell: (state, cell) => state.terrainEffects.some((effect) =>
    effect.terrain === 'party-favor' && effect.positions.some((position) => sameCell(position, cell))),
  mutations: (state, mover, cell, context) => {
    const mine = state.terrainEffects.find((effect) =>
      effect.terrain === 'party-favor' && effect.positions.some((position) => sameCell(position, cell)));
    if (!mine) return [];
    const owner = mine.ownerId ? state.actors[mine.ownerId] : undefined;
    const ownerSide = owner?.side ?? mover.side;
    const area = squareArea(cell, 2);
    const areaFoes = Object.values(state.actors).filter((actor) => {
      const position = actor.position;
      return Boolean(actor.side !== ownerSide && position && area.some((c) => sameCell(c, position)));
    });
    const bloodiedFoe = areaFoes.some((foe) => isBloodied(foe));
    const talentTwo = owner?.talents?.['fool:party-favor'] === 2;
    const extendedFoe = talentTwo && areaFoes.some((foe) =>
      foe.conditions.some((condition) => condition.id === 'dazed' || condition.id === 'blind'));
    const { roll: gamble } = gambleD6(context.dice);
    return partyFavorDetonationMutations(owner?.id ?? mover.id, ownerSide, cell, gamble, bloodiedFoe || extendedFoe, state.actors);
  },
});

/** ICON p.151: swap places with a willing ally in range 3, TELEPORTING both.
 * The shared Swap primitive emits each leg as a real teleport (movement
 * 'teleport'): Rampart (p.104) can deny the swap and any "when you teleport"
 * semantics see it — this is NOT a remove/place swap. */
const masqueradeEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  const allyId = context.input.actorIds?.target?.[0];
  const ally = allyId ? sourceActor(context, allyId) : undefined;
  const allyPosition = ally?.position;
  if (!sourcePosition || !ally || !allyPosition) throw new RuleProgramViolation('choice.actor-count', 'Masquerade requires a willing ally.');
  if (ally.side !== source.side || ally.id === source.id) throw new RuleProgramViolation('choice.actor-range', 'Masquerade requires a different ally.');
  if (distance(sourcePosition, allyPosition) > 3) throw new RuleProgramViolation('choice.actor-range', 'Masquerade requires an ally in range 3.');
  return swapMutations(context, 'teleport', [
    { actorId: source.id, destination: allyPosition },
    { actorId: ally.id, destination: sourcePosition },
  ]);
};

/** ICON p.151: range-3 small-blast unerring attack whose attack space is an
 * edge of the cross; the area deals 2 damage per character in the cross's end
 * spaces to every foe in the cross. */
const diabloEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  const targetPosition = target?.position;
  if (!sourcePosition || !target || !targetPosition) return [];
  const direction = axisDirection(sourcePosition, targetPosition);
  const center = { x: targetPosition.x + direction.x, y: targetPosition.y + direction.y };
  const arms = orthogonalNeighbors(center);
  const cross = [center, ...arms];
  const roll = resolveAuthoritativeAttack(context, source, target, { boons: 1 });
  const mutations: RuleMutation[] = [roll.attackMutation];
  mutations.push(roll.hit ? damageMutation(context, target.id, context.dice.die(roll.damageDie), 'hit') : damageMutation(context, target.id, 1, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'blind'));
  let endSpaceOccupants = 0;
  for (const character of Object.values(context.state.actors)) {
    const characterPosition = character.position;
    if (characterPosition && arms.some((cell) => sameCell(cell, characterPosition))) endSpaceOccupants += 1;
  }
  if (context.triggers?.has('finishing-blow') || context.triggers?.has('slay')) endSpaceOccupants += 1;
  for (const foe of Object.values(context.state.actors)) {
    const foePosition = foe.position;
    if (foe.side === source.side || !foePosition || !cross.some((cell) => sameCell(cell, foePosition))) continue;
    mutations.push(damageMutation(context, foe.id, 2 * endSpaceOccupants, 'area'));
  }
  return mutations;
};

/** ICON p.152: mark yourself or an ally in range 2 with Cheat Time. */
const chronotemperEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  const targetId = context.input.actorIds?.target?.[0] ?? source.id;
  const target = sourceActor(context, targetId);
  if (!sourcePosition || (target.side !== source.side && target.id !== source.id)) {
    throw new RuleProgramViolation('choice.actor-range', 'Chronotemper marks yourself or an ally in range 2.');
  }
  if (target.id !== source.id) {
    const targetPosition = target.position;
    if (!targetPosition || distance(sourcePosition, targetPosition) > 2) {
      throw new RuleProgramViolation('choice.actor-range', 'Chronotemper marks an ally in range 2.');
    }
  }
  return [markMutation(context, target.id, 'cheat-time', { granterId: source.id })];
};

/** ICON p.152 Cheat Time: gamble, dash 1 space at a time, dealing 2 damage to
 * each adjacent foe at most once per turn. */
const cheatTimeEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source?.position) return [];
  const { roll: gamble } = gambleD6(context.dice);
  const direction = context.input.directions?.['direction'] ?? { x: 1, y: 0 };
  const mutations: RuleMutation[] = [];
  const damaged = new Set<string>();
  let position = { ...source.position };
  for (let step = 0; step < gamble; step += 1) {
    const next = { x: position.x + Math.sign(direction.x), y: position.y + Math.sign(direction.y) };
    if (impassable(next, context) || occupied(next, context, source.id)) break;
    position = next;
    for (const foe of Object.values(context.state.actors)) {
      if (foe.side === source.side || !foe.position || damaged.has(foe.id) || distance(foe.position, position) > 1) continue;
      damaged.add(foe.id);
      mutations.push(damageMutation(context, foe.id, 2, 'effect'));
    }
  }
  if (!sameCell(position, source.position)) mutations.push(rushMutation(context, source.id, position));
  return mutations;
};

export const FOOL_RULE_RESOLVERS: RuleResolverRegistry = {
  'fool:cavaliere:effects': cavaliereEffects,
  'fool:carnevale': carnevaleEffects,
  'fool:spinning-top': spinningTopEffects,
  'fool:death': deathEffects,
  'fool:gallows-humor:enter': gallowsHumorEnter,
  'fool:gallows-humor:empower': gallowsHumorEmpower,
  'fool:party-favor:effects': partyFavorEffects,
  'fool:party-favor:detonate': partyFavorDetonate,
  'fool:masquerade': masqueradeEffects,
  'fool:diablo': diabloEffects,
  'fool:chronotemper:effects': chronotemperEffects,
  'fool:chronotemper:cheat-time': cheatTimeEffects,
};

export const FOOL_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'fool:cavaliere': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack'],
    range: constant(1),
    resolverId: 'fool:cavaliere:effects',
    steps: [{ id: 'attack', timing: 'use', effects: [attackStep({ boons: 1 })] }],
  })], ['effect', 'attack', 'on hit', 'miss', 'effect', 'finishing blow or slay']),

  'fool:carnevale': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['summon'],
    range: constant(2),
    resolverId: 'fool:carnevale',
    steps: [],
  })], ['summon', 'effect']),

  'fool:spinning-top': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['gamble'],
    resolverId: 'fool:spinning-top',
    steps: [],
  })], ['effect', 'effect']),

  'fool:death': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack', 'unerring'],
    range: constant(6),
    resolverId: 'fool:death',
    steps: [],
  })], ['area effect', 'attack', 'autohit', 'area effect', 'finishing blow or slay', 'special effect']),

  'fool:gallows-humor': (unit) => compilation(unit, [
    action({
      name: unit.name,
      timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['stance', 'power die'],
      resolverId: 'fool:gallows-humor:enter',
      steps: [],
    }),
    action({
      id: 'empower',
      name: 'Gallows Humor empower',
      timing: 'use',
      costs: [],
      tags: ['power die'],
      resolverId: 'fool:gallows-humor:empower',
      steps: [],
    }),
  ], ['stance', 'effect', 'refresh']),

  'fool:party-favor': (unit) => compilation(unit, [
    action({
      name: unit.name,
      timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['terrain effect'],
      range: constant(3),
      resolverId: 'fool:party-favor:effects',
      steps: [],
    }),
    action({
      id: 'detonate',
      name: 'Party Favor detonation',
      timing: 'movement-end',
      costs: [],
      tags: [],
      resolverId: 'fool:party-favor:detonate',
      steps: [],
    }),
  ], ['terrain effect', 'effect']),

  'fool:masquerade': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: [],
    resolverId: 'fool:masquerade',
    // ICON p.151: "If you or your ally can't make a valid teleport, this
    // interrupt can't be made" — the swap legs are an atomic spatial batch
    // and the command is rejected when any leg would be denied.
    requiresLegalSpatialBatch: true,
    steps: [],
  })], ['trigger', 'effect']),

  'fool:diablo': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'unerring'],
    range: constant(3),
    resolverId: 'fool:diablo',
    steps: [],
  })], ['special', 'attack', 'on hit', 'miss', 'effect', 'area effect', 'finishing blow or slay']),

  'fool:chronotemper': (unit) => compilation(unit, [
    action({
      name: unit.name,
      timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['mark', 'power die'],
      range: constant(2),
      resolverId: 'fool:chronotemper:effects',
      steps: [],
    }),
    action({
      id: 'cheat-time',
      name: 'Cheat Time',
      timing: 'interrupt',
      costs: [{ kind: 'interrupt', amount: constant(1) }],
      tags: [],
      resolverId: 'fool:chronotemper:cheat-time',
      steps: [],
    }),
  ], ['mark', 'effect', 'trigger', 'effect']),
};
