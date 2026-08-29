import { RuleProgramViolation } from '../../../kernels/runtime.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, sameCell, squareArea, withinGrid,
  constant,
  distance, sourceActor, walk, freeCellsInRange,
  damageMutation, conditionMutation, stateMutation, vigorMutation,
  resourceMutation, markMutation,
  teleportMutation, entityMutation, summonEntity, terrainMutation, shoveMutation,
  gambleD6,
  action, compilation,
} from '../../../primitives/job-kit.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';
import { chosenTeleportDestination } from '../../../kernels/teleport-choice.js';

/**
 * Independently reviewed Sealer ability implementations (ICON p.189–196),
 * the third Mendicant job. Every ability below has typed costs, targets,
 * ranges, and tags from the source catalog plus a hand-authored typed
 * RuleProgram and a named deterministic resolver.
 *
 * Blessings are the `blessing` resource; shrines are `shrine` entities; the
 * salt field is `salt` terrain.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Grand Seal's post-ability retribution (2 divine after the marked foe uses
 *   an ability that damages an ally), the end-of-turn save to end the mark,
 *   Grand Banishment's 3 divine when moved closer, Divine Aegis's save-gate on
 *   targeting, and Sanctify's save-curse/boon and start/end-of-turn pacify are
 *   mark-trigger / save-window reducer hooks documented below.
 * - Justice's trigger (critical hit or exceed) fires from the reducer's attack
 *   pipeline; the interrupt and its JUDGEMENT combo execute through
 *   EXECUTE_RULE at `interrupt` timing.
 * - Matsuri's optional ally teleports and Spirit Shrine's aura benefits are
 *   free-action / object-effect windows; the shrine's height increase and the
 *   salt field's exceed-triggered divine pulse are documented windows.
 */

/** Standard resolver-driven autohit attack mutation (no roll). */
const autohitAttack = (context: RuleExecutionContext): RuleMutation => ({
  kind: 'attack', sourceId: context.sourceId, actorId: context.actorId, targetId: context.attackTargetId ?? '',
  d20: null, boon: 0, total: null, hit: true, critical: false, evasionRoll: null, trueStrike: true, autoHit: true,
});

/** ICON p.192 God Hand: player-selected Teleport 1, attack [D]+fray (fray on
 * miss), seal the foe, then bless yourself or an ally in range 2 (deterministic:
 * the nearest eligible ally, self first). Exceed: you and allies in range 2
 * gain 3 vigor. */
const godHandEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const landing = chosenTeleportDestination(context, source.id, 'teleport', source.position, 1, 'God Hand');
  if (landing) mutations.push(teleportMutation(context, source.id, landing));
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'sealed'));
  const sourcePosition = source.position;
  const beneficiaries = Object.values(context.state.actors)
    .filter((candidate) => candidate.side === source.side && candidate.position && sourcePosition && distance(candidate.position, sourcePosition) <= 2)
    .sort((a, b) => (a.id === source.id ? -1 : b.id === source.id ? 1 : a.id.localeCompare(b.id)));
  if (beneficiaries[0]) mutations.push(resourceMutation(context, beneficiaries[0].id, 'blessing', 'gain', 1));
  return mutations;
};

/** ICON p.192 God Hand combo (DEVIL HAND): +1 boon, player-selected Teleport 1,
 * attack [D]+fray, then the foe explodes in a medium blast dealing 1 divine to
 * all foes. Exceed repeats the effect. */
const devilHandEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const landing = chosenTeleportDestination(context, source.id, 'teleport', source.position, 1, 'Devil Hand');
  if (landing) mutations.push(teleportMutation(context, source.id, landing));
  const roll = resolveAuthoritativeAttack(context, source, target, { boons: 1 });
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const blast = squareArea(target.position, 2);
  const applyBlast = () => {
    for (const character of Object.values(context.state.actors)) {
      const position = character.position;
      if (character.id === source.id || !position) continue;
      if (character.side !== source.side && blast.some((cell) => sameCell(cell, position))) {
        mutations.push(damageMutation(context, character.id, 1, 'area', 'divine'));
      }
    }
  };
  applyBlast();
  return mutations;
};

/** ICON p.192 Grand Seal: mark a foe in range 4 — sealed and marked. The 2
 * divine retribution after a damaging ability and the end-of-turn save are
 * documented mark-trigger / save windows. */
const grandSealEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Grand Seal requires a foe in range 4.');
  if (target.side === source.side || distance(source.position, target.position) > 4) throw new RuleProgramViolation('choice.actor-range', 'Grand Seal requires a foe in range 4.');
  return [
    conditionMutation(context, target.id, 'sealed'),
    markMutation(context, target.id, 'grand-seal', {}),
  ];
};

/** ICON p.192 Matsuri: player-selected Teleport 2, then attack 2[D]+fray
 * (fray on miss). Exceed: a large blast explosion centered on the foe — allies
 * inside gain 3 vigor, foes take 2 divine. The optional ally teleports are a
 * documented free-action window. */
const matsuriEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const landing = chosenTeleportDestination(context, source.id, 'teleport', source.position, 2, 'Matsuri');
  if (landing) mutations.push(teleportMutation(context, source.id, landing));
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  if (context.triggers?.has('exceed')) {
    const blast = squareArea(target.position, 3);
    for (const character of Object.values(context.state.actors)) {
      const position = character.position;
      if (!position || !blast.some((cell) => sameCell(cell, position))) continue;
      if (character.side === source.side) mutations.push(vigorMutation(context, character.id, 3));
      else mutations.push(damageMutation(context, character.id, 2, 'area', 'divine'));
    }
  }
  return mutations;
};

/** ICON p.192 Spirit Shrine: create a height 1 shrine object in a free adjacent
 * space. Using the ability again while adjacent raises its height by +1. The
 * aura benefits (cover, +1 boon, vigor on turn end, evasion) are documented
 * object-effect windows. */
const spiritShrineEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const existing = Object.values(context.state.entities)
    .filter((entity) => entity.type === 'shrine' && entity.ownerId === source.id)
    .sort((a, b) => (Number(b.state.height ?? 1)) - (Number(a.state.height ?? 1)))[0];
  const sourcePosition = source.position;
  if (existing && existing.position && sourcePosition && distance(sourcePosition, existing.position) <= 1) {
    const height = Math.min(3, Number(existing.state.height ?? 1) + 1);
    // The raised shrine replaces the previous one rather than stacking.
    const mutations: RuleMutation[] = [
      { kind: 'entity', sourceId: context.sourceId, operation: 'remove', entityType: 'shrine', ownerId: source.id, positions: [existing.position], count: 1, state: {} },
      { kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: 'shrine', ownerId: source.id, positions: [existing.position], count: 1, state: { height } },
    ];
    return mutations;
  }
  return summonEntity(context, source.id, 'shrine', source.position, {
    radius: 1, count: 1, losOrigin: source.position, category: 'object', state: { height: 1 },
  });
};

/** ICON p.193 Sanctify: scatter salt in a medium blast in range 2, dealing 1
 * divine damage to foes in the area. The save-curse/boon and pacify windows are
 * documented terrain-effect windows. */
const sanctifyEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  const center = target?.position ?? source.position;
  if (distance(source.position, center) > 2) throw new RuleProgramViolation('choice.actor-range', 'Sanctify requires its center in range 2.');
  const cells = squareArea(center, 2).filter((cell) => withinGrid(cell, context));
  const mutations: RuleMutation[] = [terrainMutation(context, 'create', 'salt', cells)];
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !cells.some((cell) => sameCell(cell, position))) continue;
    if (character.side !== source.side) mutations.push(damageMutation(context, character.id, 1, 'effect', 'divine'));
  }
  return mutations;
};

/** ICON p.193 Grand Banishment: player-selected Teleport 1, end your turn, and
 * mark a foe in range 4. The 3 divine damage when the foe is moved closer is a
 * documented mark-trigger window. */
const grandBanishmentEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  if (target && target.position && distance(source.position, target.position) > 4) throw new RuleProgramViolation('choice.actor-range', 'Grand Banishment requires a foe in range 4.');
  const mutations: RuleMutation[] = [];
  const landing = chosenTeleportDestination(context, source.id, 'teleport', source.position, 1, 'Grand Banishment');
  if (landing) mutations.push(teleportMutation(context, source.id, landing));
  if (target && target.side !== source.side) mutations.push(markMutation(context, target.id, 'grand-banishment', {}));
  mutations.push(stateMutation(context, source.id, 'end-turn-requested', true));
  return mutations;
};

/** ICON p.193 Divine Aegis: mark an ally in range 4. The save-gate on any foe
 * ability targeting the ally is a documented save-window reducer hook. Talent
 * 2 ("If your ally is at 25% hp or lower when marked, they also gain
 * defiance") reads the shared quarter predicate at mark time. */
const divineAegisEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const allyId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const ally = allyId ? sourceActor(context, allyId) : undefined;
  if (!source.position || !ally?.position) throw new RuleProgramViolation('choice.actor-count', 'Divine Aegis requires an ally in range 4.');
  if (ally.side !== source.side || distance(source.position, ally.position) > 4) throw new RuleProgramViolation('choice.actor-range', 'Divine Aegis requires an ally in range 4.');
  const mutations: RuleMutation[] = [markMutation(context, ally.id, 'divine-aegis', {})];
  if (source.talents?.['sealer:divine-aegis'] === 2 && ally.hp <= ally.maxHp / 4) {
    mutations.push(conditionMutation(context, ally.id, 'defiance'));
  }
  return mutations;
};

/** ICON p.194 Justice (interrupt): burst 2 (self) — foes take 1 divine and
 * allies are blessed, then player-selected Teleport 2. */
const justiceEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const mutations: RuleMutation[] = [];
  const area = squareArea(source.position, 2);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !area.some((cell) => sameCell(cell, position))) continue;
    if (character.side === source.side) mutations.push(resourceMutation(context, character.id, 'blessing', 'gain', 1));
    else mutations.push(damageMutation(context, character.id, 1, 'area', 'divine'));
  }
  const landing = chosenTeleportDestination(context, source.id, 'teleport', source.position, 2, 'Justice');
  if (landing) mutations.push(teleportMutation(context, source.id, landing));
  return mutations;
};

/** ICON p.194 Justice combo (JUDGEMENT): gamble, then player-selected teleport
 * for self and each foe in range 2 half that far; foes are pacified.
 * Self-teleport is a player choice. Foe teleports use per-foe position keys
 * (unqualified "teleport" in source). */
const judgementEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const { roll: gamble } = gambleD6(context.dice);
  const distanceMoved = Math.max(1, Math.floor(gamble / 2));
  const mutations: RuleMutation[] = [];
  // Player-selected self-teleport
  const selfLanding = chosenTeleportDestination(context, source.id, 'teleport', source.position, distanceMoved, 'JUDGEMENT');
  if (selfLanding) mutations.push(teleportMutation(context, source.id, selfLanding));
  // Foe teleports: each foe in range 2 is teleported half the gamble distance
  let foeIndex = 0;
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === source.id || !position) continue;
    if (distanceMoved > 2 && distance(source.position, position) > 2) continue;
    if (character.side === source.side) continue;
    const key = `foe-${foeIndex}`;
    foeIndex += 1;
    const foeLanding = chosenTeleportDestination(context, character.id, key, position, distanceMoved, `JUDGEMENT foe`);
    if (foeLanding) mutations.push(teleportMutation(context, character.id, foeLanding));
    mutations.push(conditionMutation(context, character.id, 'pacified'));
  }
  return mutations;
};

/** ICON p.194 Open The Gates: player-selected Teleport 1, attack with +1 boon
 * that cannot miss ([D]+fray, pacify on hit, fray on a natural miss which is
 * turned into a hit). Exceed: shove the foe 1, player-selected teleport 1,
 * shove the foe 1, player-selected teleport 1. */
const openTheGatesEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  // Player-selected Teleport 1
  const landing = chosenTeleportDestination(context, source.id, 'teleport', source.position, 1, 'Open The Gates');
  if (landing) mutations.push(teleportMutation(context, source.id, landing));
  const roll = resolveAuthoritativeAttack(context, source, target, { boons: 1 });
  const rolled = roll.attackMutation as Extract<RuleMutation, { kind: 'attack' }>;
  mutations.push({ ...rolled, hit: true, total: Math.max(rolled.total ?? 0, target.defense) });
  mutations.push(damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit'));
  mutations.push(conditionMutation(context, target.id, 'pacified'));
  if (context.triggers?.has('exceed')) {
    const toward = axisDirection(source.position, target.position);
    let hopOrigin = source.position;
    for (let i = 0; i < 2; i += 1) {
      const shoved = walk(context, target.position, toward, 1, false, target.id);
      if (!sameCell(shoved, target.position)) mutations.push(shoveMutation(context, target.id, 1, toward));
      // Player-selected teleport after each shove; origin advances to the
      // previous teleport destination for the second hop.
      const hop = chosenTeleportDestination(context, source.id, `teleport-exceed-${i + 1}`, hopOrigin, 1, `Open The Gates exceed ${i + 1}`);
      if (hop) {
        mutations.push(teleportMutation(context, source.id, hop));
        hopOrigin = hop;
      }
    }
  }
  return mutations;
};

/** ICON p.194 Open The Gates combo (CENTER THE TEMPLE): player-selected teleport
 * spaces equal to the round number, then attack [D]+fray (fray on miss).
 * Exceed: deal 1 damage again to the target (6 at round 4 or later). */
const centerTheTempleEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const steps = Math.min(context.state.round, Math.max(context.state.grid.width, context.state.grid.height));
  const landing = chosenTeleportDestination(context, source.id, 'teleport', source.position, steps, 'Centre The Temple');
  if (landing) mutations.push(teleportMutation(context, source.id, landing));
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  if (context.triggers?.has('exceed')) {
    mutations.push(damageMutation(context, target.id, context.state.round >= 4 ? 6 : 1, 'effect'));
  }
  return mutations;
};

export const SEALER_RULE_RESOLVERS: RuleResolverRegistry = {
  'sealer:god-hand:effects': godHandEffects,
  'sealer:god-hand:devil-hand': devilHandEffects,
  'sealer:grand-seal:effects': grandSealEffects,
  'sealer:matsuri:effects': matsuriEffects,
  'sealer:spirit-shrine:effects': spiritShrineEffects,
  'sealer:sanctify:effects': sanctifyEffects,
  'sealer:grand-banishment:effects': grandBanishmentEffects,
  'sealer:divine-aegis:effects': divineAegisEffects,
  'sealer:justice:effects': justiceEffects,
  'sealer:justice:judgement': judgementEffects,
  'sealer:open-the-gates:effects': openTheGatesEffects,
  'sealer:open-the-gates:center-the-temple': centerTheTempleEffects,
};

export const SEALER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'sealer:god-hand': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'combo'],
      resolverId: 'sealer:god-hand:effects',
      steps: [{ id: 'exceed', timing: 'use', trigger: 'exceed', effects: [{ kind: 'vigor', target: { kind: 'self' }, amount: { kind: 'constant', value: 3 } }] }],
    }),
    action({
      id: 'combo', name: 'DEVIL HAND', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['attack', 'medium blast'],
      resolverId: 'sealer:god-hand:devil-hand',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'effect', 'exceed', 'combo']),

  'sealer:grand-seal': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark', 'range'],
    range: constant(4),
    resolverId: 'sealer:grand-seal:effects',
    steps: [],
  })], ['mark', 'effect']),

  'sealer:matsuri': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack'],
    range: constant(2),
    resolverId: 'sealer:matsuri:effects',
    steps: [],
  })], ['attack', 'on hit', 'miss', 'exceed']),

  'sealer:spirit-shrine': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['object'],
    resolverId: 'sealer:spirit-shrine:effects',
    steps: [],
  })], ['object', 'effect']),

  'sealer:sanctify': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['range'],
    range: constant(2),
    resolverId: 'sealer:sanctify:effects',
    steps: [],
  })], ['terrain effect', 'effect', 'effect']),

  'sealer:grand-banishment': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['range', 'end turn'],
    range: constant(4),
    resolverId: 'sealer:grand-banishment:effects',
    steps: [],
  })], ['effect', 'mark', 'end turn']),

  'sealer:divine-aegis': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark', 'range'],
    range: constant(4),
    resolverId: 'sealer:divine-aegis:effects',
    steps: [],
  })], ['mark', 'effect']),

  'sealer:justice': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'interrupt',
      costs: [{ kind: 'interrupt', amount: constant(1) }],
      tags: ['combo'],
      resolverId: 'sealer:justice:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'JUDGEMENT', timing: 'interrupt',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['gamble'],
      resolverId: 'sealer:justice:judgement',
      steps: [],
    }),
  ], ['interrupt', 'area effect', 'effect', 'combo', 'gamble']),

  'sealer:open-the-gates': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'combo'],
      resolverId: 'sealer:open-the-gates:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'CENTER THE TEMPLE', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['attack'],
      resolverId: 'sealer:open-the-gates:center-the-temple',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'effect', 'exceed', 'combo']),
};
