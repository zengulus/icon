import { RuleProgramViolation } from '../../../kernels/runtime.js';
import { auraDefinitionFor, auraRuntimeView, isInAura } from '../../../kernels/aura.js';
import { hasMastery } from '../../../kernels/mastery.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, lineCells, sameCell, squareArea,
  constant, damageDie, fray, self,
  distance, sourceActor, walk, resolveAttack,
  damageMutation, conditionMutation, stateMutation, markMutation, stanceMutation,
  rushMutation, flyMutation, placeMutation, terrainMutation,
  action, compilation,
} from '../../../primitives/job-kit.js';

/**
 * Independently reviewed Freelancer ability implementations (ICON p.153–158),
 * the second Vagabond job. Every ability below has typed costs, targets,
 * ranges, and tags from the source catalog plus a hand-authored typed
 * RuleProgram and a named deterministic resolver.
 *
 * Lifecycle effects that cross command boundaries are reducer hooks in
 * encounter.ts, matching the established convention:
 * - Exorcism's power-die tick and projectile volley resolve at turn end.
 * - Astral Chain's celestial lightning resolves at the start of the user's turn.
 * - Showdown's delayed shot resolves at the end of the marked foe's next turn.
 * - Warding Bolts' hover-zone strike resolves for foes that leave the zone.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Trick Shot arms `trick-shot:armed` (unerring, +1 boon, and rebound on the
 *   next ranged ability) and grants stealth on a Finishing Blow. The unerring
 *   (ignore-cover) part is applied by the reducer when the attack lands, the
 *   +1 boon is added by the freelancer attack resolvers, and the flag is
 *   consumed — only the rebound bounce to a second target stays table-facing
 *   (the single-pass VM has no post-roll bounce window).
 * - Ace arms `ace:armed` (next attack triggers every Exceed effect, dazes, and
 *   gains unerring); its dash 1 resolves immediately and the stance refreshes
 *   through a `stance-refresh` sub-action after a Finishing Blow.
 * - Deus Ex Machina's Divine Intervention is executable through EXECUTE_RULE;
 *   the choice of teleport direction is deterministic (the marked character
 *   moves 1 toward the user).
 */

const unerringDamage = (context: Parameters<RuleResolver>[0], actorId: string, amount: number): RuleMutation =>
  damageMutation(context, actorId, amount, 'effect');

/** ICON p.156 Trick Shot: the next ability with a listed range gains +1 boon
 * (the armed flag is consumed by the reducer when the attack lands; the
 * unerring part applies as ignore-cover there too, so the resolver only adds
 * the extra boon here). */
const armedBoon = (context: Parameters<RuleResolver>[0], source: ReturnType<typeof sourceActor>): number =>
  source?.state['trick-shot:armed'] === true ? 1 : 0;

/** ICON p.156: dash 1, a +1-boon attack, blind the foe, dash 1 again, and a
 * Finishing Blow/Exceed flurry against every foe at exactly range 3. */
const strafeShot: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position) return [];
  const mutations: RuleMutation[] = [];
  const direction = target?.position ? axisDirection(source.position, target.position) : context.input.directions?.direction ?? { x: 1, y: 0 };
  if (target?.position && distance(source.position, target.position) > 3) {
    const before = walk(context, source.position, direction, 1, false, source.id);
    if (!sameCell(before, source.position)) mutations.push(rushMutation(context, source.id, before));
  }
  if (target) {
    const roll = resolveAttack(context, source, target, { boons: 1 + armedBoon(context, source) });
    mutations.push(roll.attackMutation);
    mutations.push(roll.hit
      ? damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'hit')
      : damageMutation(context, target.id, source.fray, 'miss'));
    mutations.push(conditionMutation(context, target.id, 'blind'));
  }
  if (target?.position) {
    const after = walk(context, source.position, direction, 1, false, source.id);
    if (!sameCell(after, source.position)) mutations.push(rushMutation(context, source.id, after));
  }
  if (context.triggers?.has('finishing-blow') || context.triggers?.has('exceed')) {
    for (const foe of Object.values(context.state.actors)) {
      if (foe.side === source.side || !foe.position || distance(foe.position, source.position) !== 3) continue;
      mutations.push(unerringDamage(context, foe.id, 2));
    }
  }
  return mutations;
};

/** ICON p.156: mark a foe in range 3 with a d4 power die that ticks and shoots
 * at turn end; a Finishing Blow sets the die immediately. */
const exorcism: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Exorcism requires a foe in range 3.');
  if (target.side === source.side) throw new RuleProgramViolation('choice.actor-range', 'Exorcism requires a foe.');
  if (distance(source.position, target.position) > 3) throw new RuleProgramViolation('choice.actor-range', 'Exorcism requires a foe in range 3.');
  const finishing = context.triggers?.has('finishing-blow') === true;
  const mutations: RuleMutation[] = [markMutation(context, target.id, 'exorcism', { die: finishing ? 1 : 0, charges: finishing ? 1 : 0 })];
  if (finishing) mutations.push(unerringDamage(context, target.id, 2));
  return mutations;
};

/** ICON p.156: arm the next ranged ability with unerring, +1 boon, and rebound;
 * a Finishing Blow grants stealth after it resolves. */
const trickShot: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const mutations: RuleMutation[] = [stateMutation(context, source.id, 'trick-shot:armed', true)];
  if (context.triggers?.has('finishing-blow')) mutations.push(conditionMutation(context, source.id, 'stealth'));
  return mutations;
};

/** ICON p.156: 2[D]+fray attack, mark the foe, and celestial lightning at the
 * start of your turn (doubled at exactly range 3); Finishing Blow/Exceed fly 4. */
const astralChain: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const roll = resolveAttack(context, source, target, { boons: armedBoon(context, source) });
  const mutations: RuleMutation[] = [roll.attackMutation];
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie) + context.dice.die(source.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(markMutation(context, target.id, 'astral-chain', {}));
  if (context.triggers?.has('finishing-blow') || context.triggers?.has('exceed')) {
    const direction = axisDirection(source.position, target.position);
    const landing = walk(context, source.position, direction, 4, true, source.id);
    if (!sameCell(landing, source.position)) mutations.push(flyMutation(context, source.id, landing));
  }
  return mutations;
};

/** ICON p.157: mark a character in range 3 and gain the Divine Intervention
 * interrupt (teleport both closer together at the end of any turn). */
const deusExMachina: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Deus Ex Machina requires a character in range 3.');
  if (distance(source.position, target.position) > 3) throw new RuleProgramViolation('choice.actor-range', 'Deus Ex Machina requires a character in range 3.');
  return [markMutation(context, target.id, 'deus-ex-machina', {})];
};

/** ICON p.157 Divine Intervention: the marked character teleports 1 toward the
 * user (deterministic; allies may decline at the table). */
const divineIntervention: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Divine Intervention requires the marked character.');
  const toward = axisDirection(target.position, source.position);
  const next = { x: target.position.x + toward.x, y: target.position.y + toward.y };
  if (distance(next, source.position) >= distance(target.position, source.position)) return [];
  return [placeMutation(context, target.id, next)];
};

/** ICON p.157: end the turn, dash 1, and arm the next attack with every Exceed
 * effect, daze, and unerring. */
const ace: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const mutations: RuleMutation[] = [
    stanceMutation(context, source.id, 'enter', 'ace'),
    stateMutation(context, source.id, 'ace:armed', true),
    stateMutation(context, source.id, 'end-turn-requested', true),
  ];
  if (source.position) {
    const direction = context.input.directions?.direction ?? { x: 1, y: 0 };
    const landing = walk(context, source.position, direction, 1, false, source.id);
    if (!sameCell(landing, source.position)) mutations.push(rushMutation(context, source.id, landing));
  }
  return mutations;
};

/** ICON p.157 Ace refresh: re-arm the stance after a Finishing Blow. */
const aceRefresh: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [stanceMutation(context, source.id, 'refresh', 'ace'), stateMutation(context, source.id, 'ace:armed', true)];
};

/** ICON p.157: zero in on a foe in range 3, become immobile, and strike them
 * when their next turn ends (2 unerring twice if they flee to range 4+, or a
 * dash 2 to stay on them). A Finishing Blow deals 2 damage four times. */
const showdown: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Showdown requires a foe in range 3.');
  if (target.side === source.side || distance(source.position, target.position) > 3) throw new RuleProgramViolation('choice.actor-range', 'Showdown requires a foe in range 3.');
  const mutations: RuleMutation[] = [
    markMutation(context, target.id, 'showdown', { finishing: context.triggers?.has('finishing-blow') === true }),
    conditionMutation(context, source.id, 'immobile', 'normal', { kind: 'turn-end', actor: self, turns: 1 }),
  ];
  return mutations;
};

/** ICON p.158: a small-blast hover zone of projectiles; foes that start their
 * turn inside and end outside are struck for 2 unerring and dazed.
 *
 * Mastery (Phantom Bolts): "You can cause the area to hover around you as an
 * Aura 2 instead, which lasts for the rest of combat, with the same effect as
 * the default area. When this ability triggers again, you may deal 2 unerring
 * damage to all foes in this aura instead of replacing the aura." The
 * mastered branch emits the durable `phantom-bolts` aura effect (combat
 * duration) in place of the terrain; a re-use while the aura is active deals
 * the retrigger damage through the shared aura kernel instead of replacing
 * it. (The "you can" choice is the deterministic mastered branch.) */
const wardingBolts: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const mastered = hasMastery(source, 'freelancer:warding-bolts');
  if (mastered) {
    const auraActive = (source.activeEffects ?? []).some((effect) => effect.effectId === 'phantom-bolts');
    if (auraActive) {
      // Retrigger: 2 unerring damage to all foes in the aura instead of
      // replacing it. Unerring = ignore cover, through the shared damage
      // authority's direct-damage provenance.
      const definition = auraDefinitionFor('freelancer:warding-bolts:mastery');
      const mutations: RuleMutation[] = [];
      if (definition) {
        const view = auraRuntimeView(context.state);
        for (const foe of Object.values(context.state.actors)) {
          if (foe.side === source.side || foe.defeated) continue;
          if (isInAura(view, definition, foe.id)) mutations.push(damageMutation(context, foe.id, 2, 'effect', 'normal', { ignoreCover: true }));
        }
      }
      return mutations;
    }
    return [{
      kind: 'persistent', sourceId: context.sourceId, ownerId: source.id, operation: 'add', actorId: source.id,
      effectId: 'phantom-bolts', duration: { kind: 'combat' }, modifiers: [{ operation: 'grant', stat: 'aura', value: { kind: 'constant', value: 2 } }], triggers: [], state: {},
    }];
  }
  const center = context.input.positions?.['area-center']?.[0] ?? source.position;
  if (distance(source.position, center) > 3) throw new RuleProgramViolation('choice.position-range', 'Warding Bolts places a small blast in range 3.');
  const mutations: RuleMutation[] = [];
  for (const effect of context.state.terrainEffects) {
    if (effect.terrain === 'warding-bolts' && effect.ownerId === source.id) {
      mutations.push(terrainMutation(context, 'remove', 'warding-bolts', [...effect.positions]));
    }
  }
  mutations.push(terrainMutation(context, 'create', 'warding-bolts', squareArea(center, 1)));
  return mutations;
};

/** ICON p.158: a line-3 +1-boon attack that blinds, splashes fray along the
 * line, ignores allies, and detonates a large blast on Finishing Blow/Exceed. */
const soulShot: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  const sourcePosition = source.position;
  const targetPosition = target?.position;
  if (!sourcePosition || !targetPosition) return [];
  const direction = context.input.directions?.['line-direction'] ?? axisDirection(sourcePosition, targetPosition);
  const line = lineCells(sourcePosition, direction, 3);
  if (!line.some((cell) => sameCell(cell, targetPosition))) {
    throw new RuleProgramViolation('choice.position-range', 'Soul Shot Line 3 must include the attack target.');
  }
  const roll = resolveAttack(context, source, target, { boons: 1 + armedBoon(context, source) });
  const mutations: RuleMutation[] = [roll.attackMutation];
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'blind'));
  let passedAllies = 0;
  for (const character of Object.values(context.state.actors)) {
    const characterPosition = character.position;
    if (!characterPosition || !line.some((cell) => sameCell(cell, characterPosition))) continue;
    if (character.side === source.side) { passedAllies += 1; continue; }
    if (character.id !== target.id) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  if (context.triggers?.has('finishing-blow') || context.triggers?.has('exceed') || passedAllies >= 2) {
    const blast = squareArea(targetPosition, 3);
    for (const character of Object.values(context.state.actors)) {
      const characterPosition = character.position;
      if (character.side === source.side || !characterPosition || !blast.some((cell) => sameCell(cell, characterPosition))) continue;
      const blinded = character.conditions.has('blind');
      mutations.push(unerringDamage(context, character.id, blinded ? 4 : 2));
      mutations.push(conditionMutation(context, character.id, 'blind'));
    }
  }
  return mutations;
};

export const FREELANCER_RULE_RESOLVERS: RuleResolverRegistry = {
  'freelancer:strafe-shot': strafeShot,
  'freelancer:exorcism': exorcism,
  'freelancer:trick-shot': trickShot,
  'freelancer:astral-chain': astralChain,
  'freelancer:deus-ex-machina': deusExMachina,
  'freelancer:deus-ex-machina:intervention': divineIntervention,
  'freelancer:ace': ace,
  'freelancer:ace:refresh': aceRefresh,
  'freelancer:showdown': showdown,
  'freelancer:warding-bolts': wardingBolts,
  'freelancer:soul-shot': soulShot,
};

export const FREELANCER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'freelancer:strafe-shot': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'range'],
    range: constant(3),
    resolverId: 'freelancer:strafe-shot',
    steps: [],
  })], ['effect', 'attack', 'on hit', 'miss', 'effect', 'effect', 'finishing blow or exceed']),

  'freelancer:exorcism': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['unerring', 'mark', 'range', 'power die'],
    range: constant(3),
    resolverId: 'freelancer:exorcism',
    steps: [],
  })], ['mark', 'effect', 'effect', 'effect', 'finishing blow']),

  'freelancer:trick-shot': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: [],
    resolverId: 'freelancer:trick-shot',
    steps: [],
  })], ['effect', 'finishing blow']),

  'freelancer:astral-chain': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack', 'mark', 'range'],
    range: constant(3),
    resolverId: 'freelancer:astral-chain',
    steps: [],
  })], ['attack', 'on hit', 'miss', 'mark', 'effect', 'finishing blow or exceed']),

  'freelancer:deus-ex-machina': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['mark', 'range'],
      range: constant(3),
      resolverId: 'freelancer:deus-ex-machina',
      steps: [],
    }),
    action({
      id: 'intervention', name: 'Divine Intervention', timing: 'interrupt',
      costs: [{ kind: 'interrupt', amount: constant(1) }],
      tags: ['interrupt'],
      resolverId: 'freelancer:deus-ex-machina:intervention',
      steps: [],
    }),
  ], ['mark', 'trigger', 'effect']),

  'freelancer:ace': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['stance', 'end turn'],
      resolverId: 'freelancer:ace',
      steps: [],
    }),
    action({
      id: 'stance-refresh', name: 'Refresh', timing: 'stance-refresh',
      costs: [],
      tags: ['stance'],
      resolverId: 'freelancer:ace:refresh',
      steps: [],
    }),
  ], ['stance', 'effect', 'refresh']),

  'freelancer:showdown': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['range'],
    range: constant(3),
    resolverId: 'freelancer:showdown',
    steps: [],
  })], ['effect', 'finishing blow']),

  'freelancer:warding-bolts': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: ['range'],
    range: constant(3),
    resolverId: 'freelancer:warding-bolts',
    steps: [],
  })], ['trigger', 'terrain effect', 'effect']),

  'freelancer:soul-shot': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'line'],
    range: constant(3),
    resolverId: 'freelancer:soul-shot',
    steps: [],
  })], ['attack', 'on hit', 'miss', 'effect', 'area effect', 'effect', 'finishing blow or exceed']),
};
