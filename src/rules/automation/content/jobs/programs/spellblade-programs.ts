import { RuleProgramViolation } from '../../../kernels/runtime.js';
import { effectiveAreaFor } from '../../../kernels/area.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { Position } from '../../../../types.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, arcCells, sameCell, squareArea, withinGrid,
  constant,
  distance, sourceActor, freeCellsInRange, rushTowardFoes, occupied,
  damageMutation, conditionMutation, stateMutation, rollDamageDice,
  resourceMutation, stanceMutation, markMutation,
  teleportMutation, shoveMutation, terrainMutation,
  action, compilation,
} from '../../../primitives/job-kit.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';
import { convertedDamageType, masteryFoldRuleRuntimeView } from '../../../kernels/mastery-fold.js';
import { chosenTeleportDestination as chooseTeleport } from '../../../kernels/teleport-choice.js';

/**
 * Independently reviewed Spellblade ability implementations (ICON p.222–229),
 * the third Wright job. Every ability below has typed costs, targets, ranges,
 * and tags from the source catalog plus a hand-authored typed RuleProgram and
 * a named deterministic resolver. Aether is the `aether` resource.
 *
 * The lightning wall and wind wall are `bifrost-arch` / `atherwand` terrain
 * effects; lightning spikes are `lightning-spike` entities.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Odinforce's bolts (called on entering the stance or any teleport, ticking
 *   the die down) and the slay-triggered +2 bolts are modeled on the stance
 *   with a `spellblade:odinforce:die` state counter; the automatic
 *   start-of-turn refresh is a documented stance window.
 * - Ätherwand's end-of-turn shatter, cover, and the once-a-round infuse
 *   teleport; Fulminate's start-of-turn aura teleports; Bifröst's grab-on
 *   free action; and Rampant Nail's damage-triggered die ticks, charged
 *   detonation, and free-action explosion are documented terrain/summon
 *   windows.
 * - Sturmreiten's trigger (you are damaged by a foe ability after it
 *   resolves) is a post-resolution interrupt window; Drifting Leaf's Leaf on
 *   the Wind interrupt (a foe enters a space adjacent to you) is a
 *   movement-entry window — both execute through EXECUTE_RULE at `interrupt`
 *   timing.
 */

/** Standard resolver-driven autohit attack mutation (no roll). */
const autohitAttack = (context: RuleExecutionContext): RuleMutation => ({
  kind: 'attack', sourceId: context.sourceId, actorId: context.actorId, targetId: context.attackTargetId ?? '',
  d20: null, boon: 0, total: null, hit: true, critical: false, evasionRoll: null, trueStrike: true, autoHit: true,
});

/** ICON p.225 Blitz: [D] on hit (1 on miss), the foe is vulnerable, then
 * player-selected Teleport 1 and deal 1 piercing to a foe in range 3, twice.
 * Slay or Infuse 3 (GRAN BLITZ) repeats the teleport-and-pierce effect. */
const blitzEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie), 'hit')
    : damageMutation(context, target.id, 1, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'vulnerable'));
  const repeats = context.triggers?.has('slay') || context.actionTags?.has('infuse') ? 2 : 1;
  for (let i = 0; i < repeats; i += 1) {
    const hop = chosenTeleportDestination(context, source.id, `teleport-${i}`, source.position, 1, `Blitz ${i + 1}`);
    if (hop) mutations.push(teleportMutation(context, source.id, hop));
    mutations.push(damageMutation(context, target.id, 1, 'effect', 'piercing'));
  }
  return mutations;
};

/** ICON p.225 Odinforce: enter the stance with a d6 power die starting at 3.
 * Calling a bolt down (1 piercing to a foe in range 3, die −1) and the
 * slay-triggered +2 bolts are modeled on the stance's die counter; the
 * automatic start-of-turn refresh is a documented stance window. */
const odinforceEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [
    stanceMutation(context, source.id, 'enter', 'odinforce'),
    stateMutation(context, source.id, 'spellblade:odinforce:die', 3),
  ];
};

/** ICON p.225 Odinforce bolt: deal 1 piercing to a foe in range 3 (as an area
 * effect) and reduce the power die by 1; with no bolts left the stance ends. */
const odinforceBoltEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position) return [];
  const mutations: RuleMutation[] = [];
  const current = Number(source.state['spellblade:odinforce:die'] ?? 3);
  if (current <= 0) return mutations;
  mutations.push(stateMutation(context, source.id, 'spellblade:odinforce:die', current - 1));
  if (current - 1 <= 0) mutations.push({ kind: 'stance', sourceId: context.sourceId, sourceActorId: context.actorId, operation: 'exit', actorId: source.id, stanceId: 'odinforce', state: {} });
  if (target?.position && distance(source.position, target.position) <= 3) {
    mutations.push(damageMutation(context, target.id, 1, 'area', 'piercing'));
  }
  return mutations;
};

/** ICON p.225 Nothung: teleport 1, 2[D]+fray on hit (fray on miss), fray to
 * the other characters in the arc, teleport 1, then deal 1 piercing to the
 * target for every foe or ally adjacent to them (max 4). Both teleports are
 * PLAYER-SELECTED: ICON's Teleport X is "move instantly to an unoccupied
 * space within range X" (p.88), and the source lists "Effect: Teleport 1"
 * twice with no direction — so each destination is a durable position choice
 * (`context.input.positions`), validated here (in-grid, within range of the
 * actor's position at that point, unoccupied) and re-validated by the F1
 * spatial gateway (bounds/occupancy/rampart) on application. The second
 * teleport's range and legality are measured from the position reached by
 * the FIRST teleport, never from the ability's starting position. Talent 2
 * ("Comeback: Increase teleport to 4") widens both distances while the user
 * is bloodied. EXCALIBUR (p.225): every 1-piercing instance this ability
 * lists delivers as the mastery-fold's converted type (divine) when Nothung
 * is mastered. */
const nothungEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const strikeType = convertedDamageType(masteryFoldRuleRuntimeView(context), source.id, 'spellblade:nothung', 'piercing');
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  // ICON p.225 Nothung talent 2: "Comeback: Increase teleport to 4." A
  // program-level comeback clause (the same flag deriveTriggers turns into
  // the `comeback` trigger): while the user is bloodied and the talent is
  // equipped, both teleport distances widen from 1 to 4. The destinations
  // themselves stay independently player-selected.
  const teleportRange = source.talents?.['spellblade:nothung'] === 2 && context.triggers?.has('comeback') ? 4 : 1;
  const firstDestination = chosenTeleportDestination(context, source.id, 'teleport-1', source.position, teleportRange, 'first');
  const mutations: RuleMutation[] = [];
  if (!sameCell(firstDestination, source.position)) mutations.push(teleportMutation(context, source.id, firstDestination));
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  // ICON p.225 Nothung talent 1: "When used against a bloodied foe, Nothung
  // deals bonus damage, and deals 1 piercing damage again to its target on
  // hit." The bonus die folds at the USE_ABILITY boundary (the registered
  // bonus-damage rule rides abilityUseModifiers) and resolves through the
  // shared keep-highest bonus-die roll; the extra 1-piercing instance is a
  // separate on-hit effect gated on the same source condition.
  const nothungHoldBonus = source.talents?.['spellblade:nothung'] === 1 && target.hp <= target.maxHp / 2;
  mutations.push(roll.hit
    ? damageMutation(context, target.id, rollDamageDice(context.dice, roll.damageDie, 2, context.abilityUseModifiers?.bonusDamageDice ?? 0) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  if (roll.hit && nothungHoldBonus) mutations.push(damageMutation(context, target.id, 1, 'hit', strikeType));
  const arc = squareArea(target.position, 1);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || character.id === source.id || !position || !arc.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  // The second teleport is validated from the actor's position AFTER the
  // first teleport: its destination must be within range of the first
  // destination (the reducer applies mutations in order, so the F1 gateway
  // sees the post-first position when the second leg resolves).
  const secondDestination = chosenTeleportDestination(context, source.id, 'teleport-2', firstDestination, teleportRange, 'second');
  if (!sameCell(secondDestination, firstDestination)) mutations.push(teleportMutation(context, source.id, secondDestination));
  const targetPosition = target.position;
  const adjacent = Object.values(context.state.actors).filter((character) => {
    const position = character.position;
    return position && character.id !== source.id && character.id !== target.id && distance(position, targetPosition) <= 1;
  });
  const strikes = Math.min(4, adjacent.length);
  if (strikes > 0) mutations.push(damageMutation(context, target.id, strikes, 'effect', strikeType));
  return mutations;
};

/** One player-selected Teleport destination for an ability whose source text
 * says "Teleport X" without a direction (ICON p.88: "move instantly to an
 * unoccupied space within range X"). The choice rides the generic durable
 * position input (`RuleExecutionInput.positions`, the same mechanism
 * Klingenkunst's `destination` key uses); a missing, out-of-grid,
 * out-of-range, or occupied destination rejects the command (nothing
 * consumed). The F1 spatial gateway re-validates bounds/occupancy/rampart on
 * application. `origin` is the position the teleport is measured from — the
 * actor's current position for the first teleport, the post-first position
 * for the second. Shared implementation: kernels/teleport-choice.ts
 * (required mode: an absent choice rejects the command). */
const chosenTeleportDestination = (
  context: RuleExecutionContext,
  actorId: string,
  key: string,
  origin: Position,
  range: number,
  label: string,
): Position => {
  const destination = chooseTeleport(context, actorId, key, origin, range, label);
  if (!destination) throw new RuleProgramViolation('choice.position-required', `${label} requires a chosen teleport destination.`);
  return destination;
};

/** ICON p.225 Nothung slay/infuse (GRAM): after the ability resolves, release a
 * flurry of slashes in a burst 2 (self) area — 1 piercing twice to all foes.
 * The flurry instances are listed by Nothung itself, so they ride the same
 * EXCALIBUR conversion as the main ability. */
const gramEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const mutations: RuleMutation[] = [];
  const area = squareArea(source.position, 2);
  const flurryType = convertedDamageType(masteryFoldRuleRuntimeView(context), source.id, 'spellblade:nothung', 'piercing');
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || character.side === source.side || !area.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, 1, 'area', flurryType));
    mutations.push(damageMutation(context, character.id, 1, 'area', flurryType));
  }
  return mutations;
};

/** ICON p.225 Ätherwand: create a line 3 of crackling winds in range 4 —
 * difficult terrain that allies may use for cover as height 1 terrain and that
 * shatters foes ending their turn in it. The cover, the end-of-turn shatter,
 * and the once-a-round infuse teleport are documented terrain windows. */
const atherwandEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  const center = target?.position ?? source.position;
  if (distance(source.position, center) > 4) throw new RuleProgramViolation('choice.actor-range', 'Ätherwand requires its center in range 4.');
  const direction = context.input.directions?.line ?? axisDirection(source.position, center);
  const cells: { x: number; y: number }[] = [];
  for (let step = 1; step <= 3; step += 1) {
    const cell = { x: center.x + direction.x * step, y: center.y + direction.y * step };
    if (!withinGrid(cell, context)) break;
    cells.push(cell);
  }
  const mutations: RuleMutation[] = [];
  if (cells.length > 0) mutations.push(terrainMutation(context, 'create', 'atherwand', cells));
  const extend = Math.max(0, Math.trunc(context.input.numbers?.aether ?? 0));
  for (let step = 4; step <= 3 + Math.min(3, extend); step += 1) {
    const cell = { x: center.x + direction.x * step, y: center.y + direction.y * step };
    if (!withinGrid(cell, context)) break;
    mutations.push(terrainMutation(context, 'create', 'atherwand', [cell]));
  }
  return mutations;
};

/** ICON p.226 Fulminate: mark a character in range 6 — they gain aura 2 while
 * marked. The start-of-turn aura teleport is a documented stance/turn window. */
const fulminateEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Fulminate requires a character in range 6.');
  if (distance(source.position, target.position) > 6) throw new RuleProgramViolation('choice.actor-range', 'Fulminate requires a character in range 6.');
  return [markMutation(context, target.id, 'fulminate', {})];
};

/** ICON p.226 Bifröst: sweep a line 3 crackling lightning arch dealing 2
 * piercing to all characters in the area. The arch remains as terrain that
 * allies can grab as a free action to teleport between its spaces (a
 * documented free-action window). */
const bifrostEffects: RuleResolver = (context) => {
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
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === source.id || !position || !cells.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, 2, 'area', 'piercing'));
  }
  if (cells.length > 0) mutations.push(terrainMutation(context, 'create', 'bifrost-arch', cells));
  return mutations;
};

/** ICON p.227 Rampant Nail: impale a lightning spike in a space in range 3 with
 * aura 2. The damage-triggered die ticks, the charged detonation, and the
 * free-action explosion are documented summon windows. */
const rampantNailEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  const cell = target?.position ?? source.position;
  if (distance(source.position, cell) > 3) throw new RuleProgramViolation('choice.actor-range', 'Rampant Nail requires a space in range 3.');
  const mutations: RuleMutation[] = [
    { kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: 'lightning-spike', ownerId: source.id, positions: [cell], count: 1, state: { charged: false } },
    stateMutation(context, source.id, 'spellblade:rampant-nail:die', 0),
  ];
  return mutations;
};

/** ICON p.227 Sturmreiten (interrupt): draw a line 3 area effect, teleport to
 * the end space, and deal 2 piercing to every other character in the area.
 * The MJÖLLNIR mastery (p.227) replaces the area with an arc 5: the player
 * chooses the arc's orthogonal path (`input.positions['arc-path']`), the
 * shared arc geometry validates it, and the teleport goes to the arc's end. */
const sturmreitenEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const { shape, length } = effectiveAreaFor(
    { round: context.state.round, actor: { ...source, maximumHp: source.maxHp } },
    source.id,
    'spellblade:sturmreiten',
    'line',
    3,
  );
  let cells: { x: number; y: number }[];
  if (shape === 'arc') {
    const path = context.input.positions?.['arc-path'] ?? [];
    if (path.length !== length) {
      throw new RuleProgramViolation('choice.position-count', `Sturmreiten's arc requires exactly ${length} chosen spaces.`);
    }
    const arc = arcCells(source.position, path);
    if (!arc || arc.some((cell) => sameCell(cell, source.position!))) {
      throw new RuleProgramViolation('choice.position-range', 'Sturmreiten\'s arc must be an orthogonal, non-overlapping path that never enters your space.');
    }
    cells = arc;
  } else {
    const direction = context.input.directions?.line ?? rushTowardFoes(context, source.position);
    cells = [];
    for (let step = 1; step <= length; step += 1) {
      const cell = { x: source.position.x + direction.x * step, y: source.position.y + direction.y * step };
      if (!withinGrid(cell, context)) break;
      cells.push(cell);
    }
  }
  const end = cells.at(-1);
  if (!end) return [];
  const mutations: RuleMutation[] = [teleportMutation(context, source.id, end)];
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === source.id || !position || !cells.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, 2, 'area', 'piercing'));
  }
  return mutations;
};

/** ICON p.227 Drifting Leaf: 2[D]+fray on hit (fray on miss), shatter the foe,
 * fray to the other characters in the line, then teleport 1 and gain the Leaf
 * on the Wind interrupt (a foe enters a space adjacent to you — teleport 2 and
 * 1 piercing) until the start of your next turn. */
const driftingLeafEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'shattered'));
  const direction = axisDirection(source.position, target.position);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || character.id === source.id || !position) continue;
    const dx = position.x - source.position.x;
    const dy = position.y - source.position.y;
    const along = (dx === 0 || Math.sign(dx) === direction.x) && (dy === 0 || Math.sign(dy) === direction.y);
    if (along && Math.max(Math.abs(dx), Math.abs(dy)) <= 6) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  const hop = chosenTeleportDestination(context, source.id, 'teleport', source.position, 1, 'Drifting Leaf');
  if (hop) mutations.push(teleportMutation(context, source.id, hop));
  mutations.push(stateMutation(context, source.id, 'spellblade:leaf-on-the-wind', true));
  return mutations;
};

/** ICON p.227 Leaf on the Wind: player-selected Teleport 2 and deal 1 piercing
 * to the foe that entered a space adjacent to you. */
const leafOnTheWindEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const foeId = context.triggerTargetIds?.[0] ?? context.input.actorIds?.target?.[0];
  const foe = foeId ? sourceActor(context, foeId) : undefined;
  if (!source.position || !foe?.position) return [];
  const mutations: RuleMutation[] = [];
  const landing = chosenTeleportDestination(context, source.id, 'teleport', source.position, 2, 'Leaf on the Wind');
  if (landing) mutations.push(teleportMutation(context, source.id, landing));
  mutations.push(damageMutation(context, foe.id, 1, 'effect', 'piercing'));
  return mutations;
};

export const SPELLBLADE_RULE_RESOLVERS: RuleResolverRegistry = {
  'spellblade:blitz:effects': blitzEffects,
  'spellblade:odinforce:effects': odinforceEffects,
  'spellblade:odinforce:bolt': odinforceBoltEffects,
  'spellblade:nothung:effects': nothungEffects,
  'spellblade:nothung:gram': gramEffects,
  'spellblade:atherwand:effects': atherwandEffects,
  'spellblade:fulminate:effects': fulminateEffects,
  'spellblade:bifrost:effects': bifrostEffects,
  'spellblade:rampant-nail:effects': rampantNailEffects,
  'spellblade:sturmreiten:effects': sturmreitenEffects,
  'spellblade:drifting-leaf:effects': driftingLeafEffects,
  'spellblade:drifting-leaf:leaf-on-the-wind': leafOnTheWindEffects,
};

export const SPELLBLADE_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'spellblade:blitz': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'pierce', 'range'],
    range: constant(3),
    resolverId: 'spellblade:blitz:effects',
    steps: [],
  })], ['attack', 'on hit', 'miss', 'effect', 'slay']),

  'spellblade:odinforce': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['stance', 'power die'],
      resolverId: 'spellblade:odinforce:effects',
      steps: [],
    }),
    action({
      id: 'bolt', name: 'Lightning Bolt', timing: 'use',
      costs: [],
      tags: ['attack'],
      range: constant(3),
      resolverId: 'spellblade:odinforce:bolt',
      steps: [],
    }),
  ], ['stance', 'power die', 'refresh']),

  'spellblade:nothung': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'arc', 'range'],
      range: constant(2),
      resolverId: 'spellblade:nothung:effects',
      steps: [],
    }),
    action({
      id: 'gram', name: 'GRAM', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(3) }],
      tags: [],
      resolverId: 'spellblade:nothung:gram',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'slay']),

  'spellblade:atherwand': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['terrain effect', 'range'],
    range: constant(4),
    resolverId: 'spellblade:atherwand:effects',
    steps: [],
  })], ['terrain effect', 'effect']),

  'spellblade:fulminate': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark'],
    range: constant(6),
    resolverId: 'spellblade:fulminate:effects',
    steps: [],
  })], ['mark', 'effect']),

  'spellblade:bifrost': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: [],
    resolverId: 'spellblade:bifrost:effects',
    steps: [],
  })], ['area effect', 'terrain effect']),

  'spellblade:rampant-nail': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['range', 'power die'],
    range: constant(3),
    resolverId: 'spellblade:rampant-nail:effects',
    steps: [],
  })], ['terrain effect', 'effect']),

  'spellblade:sturmreiten': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: [],
    resolverId: 'spellblade:sturmreiten:effects',
    steps: [],
  })], ['interrupt', 'area effect']),

  'spellblade:drifting-leaf': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'line'],
      range: constant(6),
      resolverId: 'spellblade:drifting-leaf:effects',
      steps: [],
    }),
    action({
      id: 'leaf-on-the-wind', name: 'Leaf on the Wind', timing: 'interrupt',
      costs: [{ kind: 'interrupt', amount: constant(2) }],
      tags: [],
      resolverId: 'spellblade:drifting-leaf:leaf-on-the-wind',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'effect', 'area effect', 'interrupt']),
};
