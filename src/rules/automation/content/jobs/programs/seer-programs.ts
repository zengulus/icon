import { contextAfterMutations } from '../../../kernels/execute-flow.js';
import { blastTemplateCells } from '../../../../area-geometry.js';
import { chooseEntityCreation } from '../../../kernels/creation-choice.js';
import { resolveCapturedPositionListChoice } from '../../../kernels/choice.js';
import { RuleProgramViolation } from '../../../kernels/runtime.js';
import { baseMaximumHp } from '../../../kernels/evaluate-value.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, sameCell, squareArea, constant,
  distance, walk,
  damageMutation, conditionMutation, stateMutation, vigorMutation, cureMutations,
  resourceMutation, stanceMutation, markMutation,
  teleportMutation, terrainMutation,
  summonEntity,
  gambleD6,
  action, compilation
} from '../../../primitives/job-kit.js';
import { evaluatePositions } from '../../../kernels/evaluate-query.js';
import { evaluateActorQuery } from '../../../kernels/evaluate-query.js';
import { resolveCapturedActorChoice, resolveCapturedOptionListChoice } from '../../../kernels/choice.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';
import { resolveCapturedSelectedActors, resolveTriggerTargets, resolveAttackTarget, resolveSourceActor } from '../../glue/reference-authoring.js';

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
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
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
  const card = source.position ? summonEntity(context, source.id, 'wild-card', target.position, { radius: 2, count: 1, losOrigin: source.position, originSize: source.size })[0] : undefined;
  if (card) mutations.push(card);
  return mutations;
};

/** ICON p.201 Chaos Tarot: gamble, then apply the listed effect in the small
 * blast — 1: fray damage; 2: teleport all characters in the area 2; 3: two
 * spaces of difficult terrain; 4: bless up to two characters; 5: seal up to
 * two; 6: choose two. Effects 4/5 read optional recorded actor subsets; effect
 * 6 reads exactly two recorded effect numbers and resolves them in the listed
 * numeric order required by p.108. A wild card is summoned in the area. */
const chaosTarotEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context);
  if (!source.position) return [];
  const initialCenter = target?.position ?? source.position;
  if (distance(source.position, initialCenter) > 5) throw new RuleProgramViolation('choice.actor-range', 'Chaos Tarot requires its center in range 5.');
  // ICON p.201 Chaos Tarot talent 2: "You can move Chaos Tarot's area up to
  // 2 spaces in any direction before applying the gamble effect. Charge: 4
  // spaces." Both the base 2-space movement and the charged 4-space variant
  // are TII-gated — the base ability has no area movement at all.
  const hasTalentII = (source.talents?.['seer:chaos-tarot'] ?? 0) >= 2;
  const movementAllowance = !hasTalentII ? 0
    : context.triggers?.has('charge') ? 4 : 2;
  const rawCenter = context.input.positions?.['area-center'];
  const chosenCenter = Array.isArray(rawCenter) ? rawCenter[0] ?? initialCenter : rawCenter ?? initialCenter;
  if (distance(initialCenter, chosenCenter) > movementAllowance) {
    throw new RuleProgramViolation('choice.area-movement', `Chaos Tarot area can only move up to ${movementAllowance} spaces.`);
  }
  const center = chosenCenter;
  const area = squareArea(center, 1);
  const mutations: RuleMutation[] = [];
  const { roll } = gambleD6(context.dice);
  const inArea = Object.values(context.state.actors).filter((character) => {
    const position = character.position;
    return position && area.some((cell) => sameCell(cell, position));
  });
  // U3 owns the p.92 character CandidateSet for effects 4/5, including
  // defeated/off-board exclusion and full-footprint area intersection. U4
  // below only validates the player's recorded subsets against this set.
  // Effects 1/2 deliberately retain their pre-repair `inArea` behavior.
  const eligibleCharacters = evaluateActorQuery({ relation: 'any', insideArea: { cells: area } }, context);
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
      const cells = resolveCapturedPositionListChoice({ key: 'chaos-tarot-terrain', label: 'Chaos Tarot effect 3', required: true, minimum: 2, maximum: 2 }, evaluatePositions({ origin: center, radius: 1, includeOrigin: true, insideCells: blastTemplateCells('small', center), space: { kind: 'any' } }, context), context);
      if (cells.length > 0) mutations.push(terrainMutation(context, 'create', 'difficult', cells));
    } else if (effect === 4) {
      const chosen = resolveCapturedActorChoice({
        key: 'chaos-tarot-bless', label: 'Chaos Tarot effect 4', required: false, minimum: 0, maximum: 2, repetition: 'collapse',
      }, eligibleCharacters, context);
      for (const actorId of chosen) mutations.push(resourceMutation(context, actorId, 'blessing', 'gain', 1));
    } else if (effect === 5) {
      const chosen = resolveCapturedActorChoice({
        key: 'chaos-tarot-seal', label: 'Chaos Tarot effect 5', required: false, minimum: 0, maximum: 2, repetition: 'collapse',
      }, eligibleCharacters, context);
      for (const actorId of chosen) mutations.push(conditionMutation(context, actorId, 'sealed'));
    }
  };
  if (roll === 6) {
    const selected = resolveCapturedOptionListChoice({
      key: 'chaos-tarot-effects',
      label: 'Chaos Tarot effect 6',
      required: true,
      minimum: 2,
      maximum: 2,
      options: ['1', '2', '3', '4', '5'],
    }, context).map(Number).sort((a, b) => a - b);
    // ICON p.108 supplies the otherwise-ambiguous ordering: ability effects
    // resolve in the order listed. The recorded set is therefore applied in
    // the numbered list order, never input order or an engine-selected pair.
    for (const effect of selected) apply(effect);
  } else {
    apply(roll);
  }
  const card = summonEntity(context, source.id, 'wild-card', center, { radius: 1, count: 1, losOrigin: source.position, originSize: source.size })[0];
  if (card) mutations.push(card);
  return mutations;
};

/** ICON p.201 Astra: [D]+fray on hit (fray on miss), fray to the other
 * characters in the line, then the foe explodes in a medium blast — gamble and
 * deal that much damage again to every character in the area. On a 4+, create
 * two spaces of difficult terrain; on a 6, a height 1 meteor object also lands
 * (dealing 2 damage to adjacent characters). Blessings removed from allies in
 * the area add one extra d6 each to the gamble (passed as `blessings`). */
const astraEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit')
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
    for (let i = 0; i <= extra; i += 1) total += gambleD6(context.dice).roll;
    return total;
  })();
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !blast.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, gamble, 'effect'));
  }
  if (gamble >= 4) {
    const cells = resolveCapturedPositionListChoice({ key: 'astra-terrain', label: 'Astra terrain', required: true, minimum: 2, maximum: 2 }, evaluatePositions({ origin: target.position, radius: 2, includeOrigin: true, insideCells: blastTemplateCells('medium', target.position), space: { kind: 'any' } }, context), context);
    if (cells.length > 0) mutations.push(terrainMutation(context, 'create', 'difficult', cells));
  }
  if (gamble === 6) {
    const placement = contextAfterMutations(context, mutations);
    const meteor = chooseEntityCreation(placement, 'meteor-position', 'Astra meteor', {
      origin: target.position, radius: 2, includeOrigin: true, insideCells: blastTemplateCells('medium', target.position), space: { kind: 'any' },
    }, { ownerId: source.id, entityType: 'meteor', count: 1, state: { height: 1 },
      spatial: { origin: source.position, originSize: source.size } });
    const meteorCell = meteor.positions[0];
    {
      mutations.push(meteor);
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
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'FORTUNA requires a target in range 5.');
  if (distance(source.position, target.position) > 5) throw new RuleProgramViolation('choice.actor-range', 'FORTUNA requires a target in range 5.');
  const mutations: RuleMutation[] = [];
  // Auto-hit through the shared authority so an armed damage-die override
  // upgrades the attack's [D]; the recorded mutation keeps the same shape.
  const roll = resolveAuthoritativeAttack(context, source, target, { autoHit: true, trueStrike: true });
  mutations.push(roll.attackMutation);
  mutations.push(damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit'));
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
  const card = source.position ? summonEntity(context, source.id, 'wild-card', target.position, { radius: 2, count: 1, losOrigin: source.position, originSize: source.size })[0] : undefined;
  if (card) mutations.push(card);
  return mutations;
};

/** ICON p.202 Polaris: choose a space in range 5 and mark it with a Polaris
 * space. The end-of-turn meteor gamble (one blast per active space, scaling
 * with the count) is a documented turn-boundary window. */
const polarisEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context);
  if (!source.position) throw new RuleProgramViolation('choice.actor-count', 'Polaris requires a space in range 5.');
  const cell = target?.position ?? source.position;
  if (distance(source.position, cell) > 5) throw new RuleProgramViolation('choice.actor-range', 'Polaris requires a space in range 5.');
  return [terrainMutation(context, 'create', 'polaris-space', [cell])];
};

/** ICON p.202 Sisyphus: mark a character in range 5, noting their starting
 * position. The end-of-turn return (if still in range 3 of the start) and the
 * foe's end-of-turn save are documented mark-trigger windows. */
const sisyphusEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context);
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
  const source = resolveSourceActor(context);
  // ICON p.202 Gran Reversa talent 1: "Your power die from this ability
  // starts at d6, with 6 charges." Grants a d6 at 6 instead of the base d4
  // at 4 (the durable die is still the recorded ruling below).
  const talent = (source.talents?.['seer:gran-reversa'] ?? 0) >= 1;
  return [
    stanceMutation(context, source.id, 'enter', 'gran-reversa', {}),
    stateMutation(context, source.id, 'gran-reversa:die', talent ? 6 : 4),
  ];
};

/** ICON p.202 Reverse Fate: tick down the power die by any amount (input
 * `ticks`), gamble with that many d6s, and grant the ally vigor equal to
 * double the result. */
const reverseFateEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const ally = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveTriggerTargets(context)[0];
  if (!ally) throw new RuleProgramViolation('choice.actor-count', 'Reverse Fate requires an ally in the aura.');
  const ticks = Math.max(0, Math.trunc(context.input.numbers?.ticks ?? 1));
  const mutations: RuleMutation[] = [];
  const current = Number(source.state['gran-reversa:die'] ?? 4);
  mutations.push(stateMutation(context, source.id, 'gran-reversa:die', Math.max(0, current - ticks)));
  let total = 0;
  for (let i = 0; i < ticks; i += 1) total += gambleD6(context.dice).roll;
  mutations.push(vigorMutation(context, ally.id, total * 2));
  return mutations;
};

/** ICON p.203 Eclipse: end your turn, create a burning brand of star fire in
 * range (dangerous terrain), and gain delay — your next turn must be slow. The
 * start-of-slow-turn detonation (2 divine + sealed, or a large blast with
 * dangerous terrain under every foe) is a documented turn-boundary window. */
const eclipseEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context);
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
  const source = resolveSourceActor(context);
  const ally = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveTriggerTargets(context)[0];
  if (!ally) throw new RuleProgramViolation('choice.actor-count', 'Wish requires an ally on the battlefield.');
  const mutations: RuleMutation[] = [
    // Wish's quarter-max sacrifice is a percent-of-health cost — p.107 "%
    // HEALTH" uses the BASE maximum (adjudication
    // icon-1.5:combat:bloodied-base-max).
    damageMutation(context, source.id, Math.ceil(baseMaximumHp(source) / 4), 'effect', 'sacrifice'),
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
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
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
