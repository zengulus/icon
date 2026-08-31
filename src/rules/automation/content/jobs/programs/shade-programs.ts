import { RuleProgramViolation } from '../../../kernels/runtime.js';
import { resolveSaveWindow } from '../../../primitives/save-window.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, orthogonalNeighbors, sameCell, squareArea,
  constant, comboCost,
  distance, sourceActor, walk,
  damageMutation, conditionMutation, stateMutation, markMutation, stanceMutation, rollDamageDice,
  placeMutation, teleportMutation, entityMutation, summonEntity, terrainMutation, swapMutations,
  action, compilation,
} from '../../../primitives/job-kit.js';
import { resolveAttackTarget, resolveSourceActor, resolveTriggerSource } from '../../glue/reference-authoring.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';
import { rollAbilityDamage } from '../../../kernels/bonus-damage.js';
import { chosenTeleportDestination } from '../../../kernels/teleport-choice.js';

/**
 * Independently reviewed Shade ability implementations (ICON p.159–164), the
 * third Vagabond job. Every ability below has typed costs, targets, ranges,
 * and tags from the source catalog plus a hand-authored typed RuleProgram and
 * a named deterministic resolver.
 *
 * Shadows are `shadow` entities. Cross-command lifecycles that cannot resolve
 * inside a single command are reducer hooks in encounter.ts:
 * - Assassinate's delayed shot resolves at the end of the marked foe's turn.
 * - Incubus's mark detonates when a foe ends its turn adjacent to the marked
 *   foe (once per round).
 * - Umbral Echo's stance refreshes at the end of the user's turn when no foe
 *   is adjacent, ticking its power die up by 1.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Harrow's "once a round when you teleport, also teleport the marked
 *   character 1 and deal 2" is a player-chosen reactive window, so the
 *   Finishing Blow immediate trigger is the only deterministic resolution.
 * - Nightmare's "consume a shadow to grant evasion when targeted" and Umbral
 *   Echo's "trigger finishing blow effects then tick the die down" are
 *   reactive/optional windows modeled as documented gaps (the single-pass VM
 *   has no targeting interrupt and no per-ability stance rewrite).
 * - Penumbra and Succubus are combo sub-actions (action id `combo`) that spend
 *   the `combo` resource, matching the Knave convention.
 * - Death Blossom's area fray splashes every foe in the burst except the
 *   attack target (the target's damage is fully specified by the Attack
 *   clause); its Finishing Blow pit is a `pit` terrain effect (the shadow-cloud
 *   aspect is a tag for Underworld synergies).
 *//** ICON p.162: player-selected Teleport 3, +1-boon attack, blind, and
 * summon a shadow adjacent to the target on a Finishing Blow. */
const umbraEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  const sourcePosition = source.position;

  const mutations: RuleMutation[] = [];
  if (sourcePosition) {
    const destination = chosenTeleportDestination(context, source.id, 'teleport', sourcePosition, 3, 'Umbra', { optional: true });
    if (destination) mutations.push(teleportMutation(context, source.id, destination));
  }
  if (target) {
    // ICON p.162 Umbra mastery (DEVIL FROG TECHNIQUE): "Increase Umbra and
    // Penumbra's range to 6 and it gains unerring." The unerring grant is
    // derived from mastery ownership, not from any cross-ability attachment.
    const umbraUnerring = source.masteredAbilityIds.includes('shade:umbra');
    const roll = resolveAuthoritativeAttack(context, source, target, { boons: 1, unerring: umbraUnerring });
    mutations.push(roll.attackMutation);
    mutations.push(roll.hit
      ? damageMutation(context, target.id, rollAbilityDamage(context.dice, roll.damageDie, 1, target.id, context) + source.fray, 'hit')
      : damageMutation(context, target.id, source.fray, 'miss'));
    mutations.push(conditionMutation(context, target.id, 'blind'));
  }
  if (context.triggers?.has('finishing-blow') && target?.position && source.position) {
    mutations.push(...summonEntity(context, source.id, 'shadow', target.position, {
      radius: 1, count: 1, losOrigin: source.position,
    }));
  }
  return mutations;
};

/** ICON p.162 Combo (Penumbra): teleport the foe up to 3 toward you instead of
 * moving yourself. The foe can save to avoid the effect; blinded foes fail the
 * save automatically (the save mutation is recorded for the replay). */
const umbraComboEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  const sourcePosition = source.position;
  const targetPosition = target?.position;
  const mutations: RuleMutation[] = [];
  if (!sourcePosition || !target || !targetPosition) return mutations;
  const blinded = target.conditions.has('blind');
  const save = resolveSaveWindow(context, target, {
    id: `${context.sourceId}:${context.actionId}:penumbra:${target.id}`,
    kind: 'effect',
    sourceId: context.sourceId,
    actorId: context.actorId,
    forceFailure: blinded,
  }).mutation;
  mutations.push(save);
  if (!save.success) {
    const destination = walk(context, targetPosition, axisDirection(targetPosition, sourcePosition), 3, false, target.id);
    if (!sameCell(destination, targetPosition)) mutations.push(teleportMutation(context, target.id, destination));
  }
  // ICON p.162 Umbra mastery (DEVIL FROG TECHNIQUE): Penumbra also gains
  // unerring when Umbra is mastered.
  const umbraUnerring = source.masteredAbilityIds.includes('shade:umbra');
  const attack = resolveAuthoritativeAttack(context, source, target, { boons: 1, unerring: umbraUnerring });
  mutations.push(attack.attackMutation);
  mutations.push(attack.hit
    ? damageMutation(context, target.id, rollAbilityDamage(context.dice, attack.damageDie, 1, target.id, context) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'blind'));
  return mutations;
};

/** ICON p.162: mark a character in range 3; a Finishing Blow immediately
 * teleports the marked character 1 toward the user and deals 2 if they are a
 * foe. The once-a-round teleport trigger is a documented reactive window. */
const harrowEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  const targetId = context.input.actorIds?.target?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!sourcePosition || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Harrow requires a character in range 3.');
  if (distance(sourcePosition, target.position) > 3) throw new RuleProgramViolation('choice.actor-range', 'Harrow requires a character in range 3.');
  const mutations: RuleMutation[] = [markMutation(context, target.id, 'harrow', {})];
  if (context.triggers?.has('finishing-blow')) {
    const toward = axisDirection(target.position, sourcePosition);
    const next = { x: target.position.x + toward.x, y: target.position.y + toward.y };
    if (!sameCell(next, target.position)) mutations.push(teleportMutation(context, target.id, next));
    if (target.side !== source.side) mutations.push(damageMutation(context, target.id, 2, 'effect'));
  }
  return mutations;
};

/** ICON p.162: 2-action unerring burst-1 attack (2[D]+fray / fray) that
 * splashes fray to every other foe in the burst; a Finishing Blow drops a pit
 * under the target. */
const deathBlossomEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  const targetPosition = target?.position;
  if (!target || !targetPosition) return [];
  // ICON p.162 Death Blossom is INHERENTLY unerring ("2 actions, Attack,
  // Range 2, Burst 1, Unerring" — the base ability header). Not gated on
  // any mastery or cross-ability attachment.
  const roll = resolveAuthoritativeAttack(context, source, target, {
    unerring: true,
  });
  const mutations: RuleMutation[] = [roll.attackMutation];
  mutations.push(roll.hit
    ? damageMutation(context, target.id, rollAbilityDamage(context.dice, roll.damageDie, 2, target.id, context) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  for (const foe of Object.values(context.state.actors)) {
    const foePosition = foe.position;
    if (foe.side === source.side || !foePosition || foe.id === target.id) continue;
    if (distance(foePosition, targetPosition) <= 1) mutations.push(damageMutation(context, foe.id, source.fray, 'area'));
  }
  if (context.triggers?.has('finishing-blow')) {
    mutations.push(terrainMutation(context, 'create', 'pit', [targetPosition]));
  }
  return mutations;
};

/** ICON p.162 Combo (Flying Sleeves): the area becomes Arc 4 — every foe within
 * 4 of the attack target takes the splash fray. */
const deathBlossomComboEffects: RuleResolver = (context, action) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  const targetPosition = target?.position;
  const mutations: RuleMutation[] = deathBlossomEffects(context, action);
  if (!target || !targetPosition) return mutations;
  for (const foe of Object.values(context.state.actors)) {
    const foePosition = foe.position;
    if (foe.side === source.side || !foePosition || foe.id === target.id) continue;
    if (distance(foePosition, targetPosition) <= 4) mutations.push(damageMutation(context, foe.id, source.fray, 'area'));
  }
  return mutations;
};

/** ICON p.162: summon 2 shadows in range 2 and raise the Nightmare aura (the
 * consume-a-shadow evasion interrupt is a documented reactive window). */
const nightmareEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const sourcePosition = source.position;
  if (!sourcePosition) return [];
  const mutations: RuleMutation[] = [
    stateMutation(context, source.id, 'nightmare:aura', true),
  ];
  mutations.push(...summonEntity(context, source.id, 'shadow', sourcePosition, {
    radius: 2, count: 2, losOrigin: sourcePosition,
  }));
  return mutations;
};

/** ICON p.163: swap two other characters (first in range 2, second in range 3
 * of the first); allies gain stealth, foes are dazed. The source has no
 * movement word — this is a REMOVE/PLACE swap (movement 'place'), not a
 * teleport: no rampart boundary check and no teleport trigger surface.
 * Finishing Blow's "repeat" is a table-facing second choice. */
const shadowPlayEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  const firstId = context.input.actorIds?.target?.[0];
  const secondId = context.input.actorIds?.target?.[1];
  const first = firstId ? sourceActor(context, firstId) : undefined;
  const second = secondId ? sourceActor(context, secondId) : undefined;
  if (!sourcePosition || !first?.position || !second?.position) throw new RuleProgramViolation('choice.actor-count', 'Shadow Play requires two other characters.');
  if (first.id === source.id || second.id === source.id || first.id === second.id) throw new RuleProgramViolation('choice.actor-range', 'Shadow Play requires two different characters other than yourself.');
  if (distance(sourcePosition, first.position) > 2) throw new RuleProgramViolation('choice.actor-range', 'The first character must be in range 2.');
  if (distance(first.position, second.position) > 3) throw new RuleProgramViolation('choice.actor-range', 'The second character must be in range 3 of the first.');
  const mutations: RuleMutation[] = swapMutations(context, 'place', [
    { actorId: first.id, destination: second.position },
    { actorId: second.id, destination: first.position },
  ]);
  for (const character of [first, second]) {
    if (character.side === source.side) mutations.push(conditionMutation(context, character.id, 'stealth'));
    else mutations.push(conditionMutation(context, character.id, 'dazed'));
  }
  return mutations;
};

/** ICON p.163: enter the Umbral Echo stance with a d4 power die starting at 2.
 * The turn-end refresh (no adjacent foes) ticks the die up in the reducer; the
 * "trigger finishing blow effects then tick down" stance rewrite is documented. */
const umbralEchoEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  return [
    stanceMutation(context, source.id, 'enter', 'umbral-echo'),
    stateMutation(context, source.id, 'umbral-echo:die', 2),
  ];
};

/** ICON p.163: end the turn and mark a foe in range 3; the delayed shot (teleport
 * adjacent, deal 2 three times or 2, blind, fly 2) resolves at the end of the
 * marked foe's turn in the reducer. */
const assassinateEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const sourcePosition = source.position;
  const targetId = context.input.actorIds?.target?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!sourcePosition || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Assassinate requires a foe in range 3.');
  if (target.side === source.side || distance(sourcePosition, target.position) > 3) throw new RuleProgramViolation('choice.actor-range', 'Assassinate requires a foe in range 3.');
  return [markMutation(context, target.id, 'assassinate', {})];
};

/** ICON p.163: an interrupt that marks a small blast centered on the finishing
 * blow target as a shadow-cloud terrain effect, lasting until used again. */
const nocturneEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const triggerPosition = resolveTriggerSource(context)?.position;
  const center = context.input.positions?.['area-center']?.[0] ?? triggerPosition ?? source.position;
  if (!center) throw new RuleProgramViolation('choice.position-range', 'Nocturne requires a finishing blow character to center on.');
  const mutations: RuleMutation[] = [];
  for (const effect of context.state.terrainEffects) {
    if (effect.terrain === 'shadow-cloud' && effect.ownerId === context.actorId) {
      mutations.push(terrainMutation(context, 'remove', 'shadow-cloud', [...effect.positions]));
    }
  }
  mutations.push(terrainMutation(context, 'create', 'shadow-cloud', squareArea(center, 1)));
  return mutations;
};

/** ICON p.164: +1-boon attack that marks the foe; a Finishing Blow immediately
 * detonates the mark (2 damage + dazed to the marked foe and adjacent foes). */
const incubusEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  const targetPosition = target?.position;
  if (!target) return [];
  const roll = resolveAuthoritativeAttack(context, source, target, { boons: 1 });
  const mutations: RuleMutation[] = [roll.attackMutation];
  // ICON p.164 Incubus talent 2: "Incubus deals bonus damage for every ally
  // of your target adjacent to your target" — the bonus-damage rule folds
  // the per-ally dice at the USE_ABILITY boundary; the shared keep-highest
  // roll applies them.
  mutations.push(roll.hit
    ? damageMutation(context, target.id, rollAbilityDamage(context.dice, roll.damageDie, 1, target.id, context) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(markMutation(context, target.id, 'incubus', {}));
  if (context.triggers?.has('finishing-blow') && targetPosition) {
    mutations.push(damageMutation(context, target.id, 2, 'effect'));
    mutations.push(conditionMutation(context, target.id, 'dazed'));
    for (const foe of Object.values(context.state.actors)) {
      const foePosition = foe.position;
      if (foe.side === source.side || !foePosition || foe.id === target.id) continue;
      if (distance(foePosition, targetPosition) <= 1) {
        mutations.push(damageMutation(context, foe.id, 2, 'effect'));
        mutations.push(conditionMutation(context, foe.id, 'dazed'));
      }
    }
  }
  return mutations;
};

/** ICON p.164 Combo (Succubus): deal 3 damage to every character marked by
 * Incubus and player-selected Teleport 2 for each. */
const incubusComboEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const sourcePosition = source.position;
  const mutations: RuleMutation[] = [];
  let markedIndex = 0;
  for (const character of Object.values(context.state.actors)) {
    if (!character.marks.some(({ markId }) => markId === 'incubus')) continue;
    const characterPosition = character.position;
    mutations.push(damageMutation(context, character.id, 3, 'effect'));
    if (characterPosition && sourcePosition) {
      const key = `teleport-${markedIndex}`;
      markedIndex += 1;
      const destination = chosenTeleportDestination(context, character.id, key, characterPosition, 2, 'Succubus', { optional: true });
      if (destination) mutations.push(teleportMutation(context, character.id, destination));
    }
  }
  return mutations;
};

export const SHADE_RULE_RESOLVERS: RuleResolverRegistry = {
  'shade:umbra:effects': umbraEffects,
  'shade:umbra:combo': umbraComboEffects,
  'shade:harrow:effects': harrowEffects,
  'shade:death-blossom:effects': deathBlossomEffects,
  'shade:death-blossom:combo': deathBlossomComboEffects,
  'shade:nightmare:effects': nightmareEffects,
  'shade:shadow-play:effects': shadowPlayEffects,
  'shade:umbral-echo:effects': umbralEchoEffects,
  'shade:assassinate:effects': assassinateEffects,
  'shade:nocturne:effects': nocturneEffects,
  'shade:incubus:effects': incubusEffects,
  'shade:incubus:combo': incubusComboEffects,
};

export const SHADE_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'shade:umbra': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'combo', 'range'],
      range: constant(3),
      resolverId: 'shade:umbra:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'Penumbra', timing: 'use',
      costs: [comboCost()],
      tags: ['attack', 'range'],
      range: constant(3),
      resolverId: 'shade:umbra:combo',
      steps: [],
    }),
  ], ['effect', 'attack', 'on hit', 'miss', 'effect', 'finishing blow', 'combo']),

  'shade:harrow': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark', 'range'],
    range: constant(3),
    resolverId: 'shade:harrow:effects',
    steps: [],
  })], ['mark', 'finishing blow']),

  'shade:death-blossom': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'unerring', 'burst', 'range'],
      range: constant(2),
      resolverId: 'shade:death-blossom:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'Flying Sleeves', timing: 'use',
      costs: [comboCost()],
      tags: ['attack', 'range'],
      range: constant(2),
      resolverId: 'shade:death-blossom:combo',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'finishing blow', 'combo']),

  'shade:nightmare': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['aura', 'summon', 'range'],
    range: constant(2),
    resolverId: 'shade:nightmare:effects',
    steps: [],
  })], ['summon', 'effect']),

  'shade:shadow-play': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['range'],
    range: constant(2),
    resolverId: 'shade:shadow-play:effects',
    steps: [],
  })], ['effect', 'finishing blow']),

  'shade:umbral-echo': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['stance', 'power die'],
    resolverId: 'shade:umbral-echo:effects',
    steps: [],
  })], ['stance', 'effect', 'refresh']),

  'shade:assassinate': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['end turn', 'range'],
    range: constant(3),
    resolverId: 'shade:assassinate:effects',
    steps: [],
  })], ['effect', 'effect']),

  'shade:nocturne': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: [],
    resolverId: 'shade:nocturne:effects',
    steps: [],
  })], ['trigger', 'terrain effect']),

  'shade:incubus': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'combo', 'mark'],
      range: constant(1),
      resolverId: 'shade:incubus:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'Succubus', timing: 'use',
      costs: [comboCost()],
      tags: ['attack'],
      resolverId: 'shade:incubus:combo',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'mark', 'finishing blow', 'combo']),
};
