import { RuleProgramViolation } from '../../../kernels/runtime.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, sameCell, squareArea, withinGrid,
  constant,
  distance, sourceActor, walk, freeCellsInRange, resolveAttack, nearestFoe,
  damageMutation, conditionMutation, stateMutation, vigorMutation, cureMutations,
  resourceMutation, stanceMutation, markMutation,
  teleportMutation, entityMutation, terrainMutation,
  gambleD6,
  action, compilation,
} from '../../../primitives/job-kit.js';

/**
 * Independently reviewed Seer ability implementations (ICON p.197–203),
 * the fourth Mendicant job. Every ability below has typed costs, targets,
 * ranges, and tags from the source catalog plus a hand-authored typed
 * RuleProgram and a named deterministic resolver.
 *
 * Wild cards are `wild-card` entities; Polaris spaces and star fire are
 * `polaris-space` / `star-fire` terrain effects; blessings are the `blessing`
 * resource; the Gran Reversa stance carries a d4 power die in its state.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - The wheel-of-fate deck, Skein draws, Foretell, Bend Fate, and Karma are
 *   class traits outside the ability set; card draws are not modeled.
 * - Polaris's end-of-turn meteor gamble, Sisyphus's end-of-turn return,
 *   Eclipse's start-of-slow-turn detonation, Gran Reversa's end-of-turn vigor
 *   loss and stance refresh, and The Tower's end-of-foe-turn meteor are
 *   turn-boundary reducer hooks documented below.
 * - Wish's trigger (an ally takes 25%+ max HP damage from a foe) is a
 *   held-damage window; the interrupt itself sacrifices 25% of the user's max
 *   HP and cures the ally, with the damage cap modeled as a state flag.
 */

/** Standard resolver-driven autohit attack mutation (no roll). */
const autohitAttack = (context: RuleExecutionContext): RuleMutation => ({
  kind: 'attack', sourceId: context.sourceId, actorId: context.actorId, targetId: context.attackTargetId ?? '',
  d20: null, boon: 0, total: null, hit: true, critical: false, evasionRoll: null, trueStrike: true, autoHit: true,
});

/** ICON p.201 Sleight Of Hand: auto-hit fray, pacify the foe, fray to the other
 * characters in the small blast, and summon a wild card in range 2 of the foe. */
const sleightOfHandEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [autohitAttack(context)];
  mutations.push(damageMutation(context, target.id, source.fray, 'hit'));
  mutations.push(conditionMutation(context, target.id, 'pacified'));
  const area = squareArea(target.position, 1);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || !position) continue;
    if (area.some((cell) => sameCell(cell, position))) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  const cardCell = freeCellsInRange(context, target.position, 2)[0];
  if (cardCell) mutations.push(entityMutation(context, source.id, cardCell, 'wild-card', {}));
  return mutations;
};

/** ICON p.201 Chaos Tarot: gamble, then apply the listed effect in the small
 * blast — 1: fray damage; 2: teleport all characters in the area 2; 3: two
 * spaces of difficult terrain; 4: bless up to two characters; 5: seal up to
 * two; 6: choose two (deterministic: damage + difficult terrain). A wild card
 * is summoned in the area. */
const chaosTarotEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  const center = target?.position ?? source.position;
  if (distance(source.position, center) > 5) throw new RuleProgramViolation('choice.actor-range', 'Chaos Tarot requires its center in range 5.');
  const area = squareArea(center, 1);
  const mutations: RuleMutation[] = [];
  const { roll } = gambleD6(context);
  const inArea = Object.values(context.state.actors).filter((character) => {
    const position = character.position;
    return position && area.some((cell) => sameCell(cell, position));
  });
  const apply = (effect: number) => {
    if (effect === 1) {
      for (const character of inArea) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
    } else if (effect === 2) {
      for (const character of inArea) {
        const position = character.position!;
        const away = axisDirection(center, position);
        const landing = walk(context, position, away, 2, false, character.id);
        if (!sameCell(landing, position)) mutations.push(teleportMutation(context, character.id, landing));
      }
    } else if (effect === 3) {
      const cells = freeCellsInRange(context, center, 1).slice(0, 2);
      if (cells.length > 0) mutations.push(terrainMutation(context, 'create', 'difficult', cells));
    } else if (effect === 4) {
      const allies = inArea.filter((character) => character.side === source.side).slice(0, 2);
      for (const ally of allies) mutations.push(resourceMutation(context, ally.id, 'blessing', 'gain', 1));
    } else if (effect === 5) {
      const foes = inArea.filter((character) => character.side !== source.side).slice(0, 2);
      for (const foe of foes) mutations.push(conditionMutation(context, foe.id, 'sealed'));
    }
  };
  if (roll === 6) {
    apply(1);
    apply(3);
  } else {
    apply(roll);
  }
  const cardCell = freeCellsInRange(context, center, 1)[0];
  if (cardCell) mutations.push(entityMutation(context, source.id, cardCell, 'wild-card', {}));
  return mutations;
};

/** ICON p.201 Astra: [D]+fray on hit (fray on miss), fray to the other
 * characters in the line, then the foe explodes in a medium blast — gamble and
 * deal that much damage again to every character in the area. On a 4+, create
 * two spaces of difficult terrain; on a 6, a height 1 meteor object also lands
 * (dealing 2 damage to adjacent characters). Blessings removed from allies in
 * the area add one extra d6 each to the gamble (passed as `blessings`). */
const astraEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const direction = axisDirection(source.position, target.position);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || character.id === source.id || !position) continue;
    if (sameCell(position, { x: source.position.x, y: source.position.y })) continue;
    const dx = position.x - source.position.x;
    const dy = position.y - source.position.y;
    const along = (dx === 0 || Math.sign(dx) === direction.x) && (dy === 0 || Math.sign(dy) === direction.y);
    if (along && Math.max(Math.abs(dx), Math.abs(dy)) <= 5) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  const blast = squareArea(target.position, 2);
  const extra = Math.max(0, Math.trunc(context.input.numbers?.blessings ?? 0));
  const gamble = (() => {
    let total = 0;
    for (let i = 0; i <= extra; i += 1) total += gambleD6(context).roll;
    return total;
  })();
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !blast.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, gamble, 'effect'));
  }
  if (gamble >= 4) {
    const cells = freeCellsInRange(context, target.position, 2).slice(0, 2);
    if (cells.length > 0) mutations.push(terrainMutation(context, 'create', 'difficult', cells));
  }
  if (gamble === 6) {
    const meteorCell = freeCellsInRange(context, target.position, 2)[0];
    if (meteorCell) {
      mutations.push({ kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: 'meteor', ownerId: source.id, positions: [meteorCell], count: 1, state: { height: 1 } });
      for (const character of Object.values(context.state.actors)) {
        const position = character.position;
        if (!position || distance(position, meteorCell) > 1 || sameCell(position, meteorCell)) continue;
        mutations.push(damageMutation(context, character.id, 2, 'area'));
      }
    }
  }
  return mutations;
};

/** ICON p.201 Astra combo (FORTUNA): auto-hit [D]+fray, foes in the medium blast
 * take fray, allies gain 3 vigor and are blessed, and a wild card is summoned
 * in the area. */
const fortunaEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'FORTUNA requires a target in range 5.');
  if (distance(source.position, target.position) > 5) throw new RuleProgramViolation('choice.actor-range', 'FORTUNA requires a target in range 5.');
  const mutations: RuleMutation[] = [autohitAttack(context)];
  mutations.push(damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'hit'));
  const blast = squareArea(target.position, 2);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || !position || !blast.some((cell) => sameCell(cell, position))) continue;
    if (character.side === source.side) {
      mutations.push(vigorMutation(context, character.id, 3));
      mutations.push(resourceMutation(context, character.id, 'blessing', 'gain', 1));
    } else {
      mutations.push(damageMutation(context, character.id, source.fray, 'area'));
    }
  }
  const cardCell = freeCellsInRange(context, target.position, 2)[0];
  if (cardCell) mutations.push(entityMutation(context, source.id, cardCell, 'wild-card', {}));
  return mutations;
};

/** ICON p.202 Polaris: choose a space in range 5 and mark it with a Polaris
 * space. The end-of-turn meteor gamble (one blast per active space, scaling
 * with the count) is a documented turn-boundary window. */
const polarisEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) throw new RuleProgramViolation('choice.actor-count', 'Polaris requires a space in range 5.');
  const cell = target?.position ?? source.position;
  if (distance(source.position, cell) > 5) throw new RuleProgramViolation('choice.actor-range', 'Polaris requires a space in range 5.');
  return [terrainMutation(context, 'create', 'polaris-space', [cell])];
};

/** ICON p.202 Sisyphus: mark a character in range 5, noting their starting
 * position. The end-of-turn return (if still in range 3 of the start) and the
 * foe's end-of-turn save are documented mark-trigger windows. */
const sisyphusEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Sisyphus requires a character in range 5.');
  if (distance(source.position, target.position) > 5) throw new RuleProgramViolation('choice.actor-range', 'Sisyphus requires a character in range 5.');
  return [markMutation(context, target.id, 'sisyphus', { x: target.position.x, y: target.position.y })];
};

/** ICON p.202 Gran Reversa: enter the stance with aura 2 and a d4 power die at
 * 4. The Reverse Fate interrupt ticks the die down by any amount and gambles
 * with that many d6s, granting the ally vigor equal to double the result; the
 * end-of-turn vigor loss and the start-of-turn refresh (tick up by 1) are
 * documented stance windows. */
const granReversaEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [
    stanceMutation(context, source.id, 'enter', 'gran-reversa', {}),
    stateMutation(context, source.id, 'gran-reversa:die', 4),
  ];
};

/** ICON p.202 Reverse Fate: tick down the power die by any amount (input
 * `ticks`), gamble with that many d6s, and grant the ally vigor equal to
 * double the result. */
const reverseFateEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const allyId = context.input.actorIds?.target?.[0] ?? context.triggerTargetIds?.[0];
  const ally = allyId ? sourceActor(context, allyId) : undefined;
  if (!ally) throw new RuleProgramViolation('choice.actor-count', 'Reverse Fate requires an ally in the aura.');
  const ticks = Math.max(0, Math.trunc(context.input.numbers?.ticks ?? 1));
  const mutations: RuleMutation[] = [];
  const current = Number(source.state['gran-reversa:die'] ?? 4);
  mutations.push(stateMutation(context, source.id, 'gran-reversa:die', Math.max(0, current - ticks)));
  let total = 0;
  for (let i = 0; i < ticks; i += 1) total += gambleD6(context).roll;
  mutations.push(vigorMutation(context, ally.id, total * 2));
  return mutations;
};

/** ICON p.203 Eclipse: end your turn, create a burning brand of star fire in
 * range (dangerous terrain), and gain delay — your next turn must be slow. The
 * start-of-slow-turn detonation (2 divine + sealed, or a large blast with
 * dangerous terrain under every foe) is a documented turn-boundary window. */
const eclipseEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  const cell = target?.position ?? source.position;
  if (distance(source.position, cell) > 6) throw new RuleProgramViolation('choice.actor-range', 'Eclipse requires a space in range 6.');
  return [
    terrainMutation(context, 'create', 'star-fire', [cell]),
    stateMutation(context, source.id, 'eclipse:pending', JSON.stringify({ x: cell.x, y: cell.y })),
    stateMutation(context, source.id, 'end-turn-requested', true),
  ];
};

/** ICON p.203 Wish (interrupt): sacrifice 25% of your maximum HP, cure the
 * ally, and flag them so the triggering damage cannot reduce them past 1 hp.
 * The trigger (an ally takes 25%+ max HP damage from a foe) is a held-damage
 * window. */
const wishEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const allyId = context.input.actorIds?.target?.[0] ?? context.triggerTargetIds?.[0];
  const ally = allyId ? sourceActor(context, allyId) : undefined;
  if (!ally) throw new RuleProgramViolation('choice.actor-count', 'Wish requires an ally on the battlefield.');
  const mutations: RuleMutation[] = [
    damageMutation(context, source.id, Math.ceil(source.maxHp / 4), 'effect', 'sacrifice'),
    ...cureMutations(context, ally.id),
    stateMutation(context, ally.id, 'wish:shield', true),
  ];
  return mutations;
};

/** ICON p.203 The Tower: autohit 1 damage and seal the foe, then mark them so
 * the end-of-foe-turn meteor gamble (large blast, damage equal to the gamble
 * die + 2) can resolve at the turn boundary, with a height 1 meteor object
 * created in the area. */
const theTowerEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [autohitAttack(context)];
  mutations.push(damageMutation(context, target.id, 1, 'hit'));
  mutations.push(conditionMutation(context, target.id, 'sealed'));
  mutations.push(markMutation(context, target.id, 'the-tower', {}));
  return mutations;
};

export const SEER_RULE_RESOLVERS: RuleResolverRegistry = {
  'seer:sleight-of-hand:effects': sleightOfHandEffects,
  'seer:chaos-tarot:effects': chaosTarotEffects,
  'seer:astra:effects': astraEffects,
  'seer:astra:fortuna': fortunaEffects,
  'seer:polaris:effects': polarisEffects,
  'seer:sisyphus:effects': sisyphusEffects,
  'seer:gran-reversa:effects': granReversaEffects,
  'seer:gran-reversa:reverse-fate': reverseFateEffects,
  'seer:eclipse:effects': eclipseEffects,
  'seer:wish:effects': wishEffects,
  'seer:the-tower:effects': theTowerEffects,
};

export const SEER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'seer:sleight-of-hand': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'summon', 'small blast', 'range'],
    range: constant(5),
    resolverId: 'seer:sleight-of-hand:effects',
    steps: [],
  })], ['attack', 'on hit', 'effect', 'area effect', 'summon']),

  'seer:chaos-tarot': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['summon', 'small blast', 'range'],
    range: constant(5),
    resolverId: 'seer:chaos-tarot:effects',
    steps: [],
  })], ['area effect', 'gamble', 'summon']),

  'seer:astra': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'combo', 'line'],
      range: constant(5),
      resolverId: 'seer:astra:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'FORTUNA', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['attack', 'medium blast', 'range'],
      range: constant(5),
      resolverId: 'seer:astra:fortuna',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'effect', 'gamble', 'combo']),

  'seer:polaris': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['terrain effect', 'range'],
    range: constant(5),
    resolverId: 'seer:polaris:effects',
    steps: [],
  })], ['terrain effect', 'gamble']),

  'seer:sisyphus': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark', 'range'],
    range: constant(5),
    resolverId: 'seer:sisyphus:effects',
    steps: [],
  })], ['mark', 'effect']),

  'seer:gran-reversa': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['stance', 'power die'],
      resolverId: 'seer:gran-reversa:effects',
      steps: [],
    }),
    action({
      id: 'reverse-fate', name: 'Reverse Fate', timing: 'interrupt',
      costs: [{ kind: 'interrupt', amount: constant(1) }],
      tags: ['gamble'],
      resolverId: 'seer:gran-reversa:reverse-fate',
      steps: [],
    }),
  ], ['stance', 'aura', 'interrupt', 'refresh']),

  'seer:eclipse': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['terrain effect', 'end turn', 'delay', 'range'],
    range: constant(6),
    resolverId: 'seer:eclipse:effects',
    steps: [],
  })], ['terrain effect', 'delay', 'end turn']),

  'seer:wish': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: [],
    resolverId: 'seer:wish:effects',
    steps: [],
  })], ['interrupt', 'effect']),

  'seer:the-tower': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'range', 'gamble'],
    range: constant(5),
    resolverId: 'seer:the-tower:effects',
    steps: [],
  })], ['attack', 'on hit', 'area effect', 'gamble', 'terrain effect']),
};
