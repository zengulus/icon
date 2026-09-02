import { RuleProgramViolation } from '../../../kernels/runtime.js';
import { baseMaximumHp } from '../../../kernels/evaluate-value.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, sameCell, squareArea, withinGrid,
  constant,
  distance, sourceActor, walk,
  damageMutation, conditionMutation, stateMutation,
  resourceMutation, stanceMutation, markMutation,
  shoveMutation, entityMutation, summonEntity, terrainMutation,
  action, compilation,
} from '../../../primitives/job-kit.js';
import { evaluatePositions } from '../../../kernels/evaluate-query.js';
import { entityAnchorPosition } from '../../../primitives/anchor.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';
import { resolveCapturedSelectedActors, resolveTriggerTargets, resolveAttackTarget, resolveSourceActor } from '../../glue/reference-authoring.js';

/**
 * Independently reviewed Enochian ability implementations (ICON p.206–214),
 * the first Wright job. Every ability below has typed costs, targets, ranges,
 * and tags from the source catalog plus a hand-authored typed RuleProgram and
 * a named deterministic resolver. Aether is the `aether` resource; Infuse
 * actions spend it through their program cost.
 *
 * Elden Runes are `elden-rune` terrain; shards, spires, and meteors are
 * `aethershard` / `magma-spire` / `meteor` entities; pits are `pit` terrain.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Soul Burn's end-of-turn sacrifice and automatic comeback triggers, the
 *   soul ember spark, and the stance refresh are documented stance windows;
 *   the INCANDIUS collide is resolved inline (adjacent characters become
 *   vulnerable when shoved into a character or obstacle is a reducer check,
 *   documented below).
 * - Blazing Bond's Heartfire reduction (damage or sacrifice cost −3 with the
 *   partner sacrificing 3) is a held-damage window; the interrupt records the
 *   armoring flag and the partner sacrifice.
 * - Aethershard resonance (2 piercing area damage per shard caught, then
 *   destroy and gain 1 aether), Implode's start-of-slow-turn shove/stun, and
 *   Pyroclast's end-of-next-turn magma eruption are reducer hooks documented
 *   below.
 * - Elden Rune's free-action sacrifice version and its scrub-out rule are
 *   documented free-action / terrain windows.
 */

/** Standard resolver-driven autohit attack mutation (no roll). */
const autohitAttack = (context: RuleExecutionContext): RuleMutation => ({
  kind: 'attack', sourceId: context.sourceId, actorId: context.actorId, targetId: context.attackTargetId ?? '',
  d20: null, boon: 0, total: null, hit: true, critical: false, evasionRoll: null, trueStrike: true, autoHit: true,
});

/** The characters (other than `excludeId`) standing in `cells`. */
const charactersIn = (context: RuleExecutionContext, cells: { x: number; y: number }[], excludeId: string) =>
  Object.values(context.state.actors).filter((character) => {
    const position = character.position;
    return character.id !== excludeId && position && cells.some((cell) => sameCell(cell, position));
  });

/** ICON p.209 Pyre: 2[D]+fray on hit (fray on miss), fray to the other
 * characters in the medium blast. Comeback or Exceed: the area explodes again
 * for 2 piercing to all characters. Talent 1 gates the comeback ally-immunity
 * clause (below). */
const pyreEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  // Talent 1 (p.209): "Comeback: Allies are immune to damage from this
  // ability." The first program-level comeback clause (F7): a modifier on
  // the ability's own resolution, gated on the equipped choice through the
  // projected `talents` surface AND the bloodied trigger (the same check
  // `deriveTriggers` turns into `comeback`). While it holds, the ability's
  // area damage — the blast fray and the comeback/exceed re-explosion —
  // skips allies; the attack target itself is always a foe.
  const alliesImmune = source.talents?.['enochian:pyre'] === 1 && context.triggers?.has('comeback');
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const blast = squareArea(target.position, 2);
  for (const character of charactersIn(context, blast, source.id)) {
    if (character.id !== target.id && !(alliesImmune && character.side === source.side)) {
      mutations.push(damageMutation(context, character.id, source.fray, 'area'));
    }
  }
  // The exceed fact is the ABILITY'S OWN attack roll at 15+ (ICON p.93) —
  // derived here from the authoritative roll, never a caller assertion.
  const exceeded = (roll.attackMutation as Extract<RuleMutation, { kind: 'attack' }>).exceed === true;
  if (context.triggers?.has('comeback') || exceeded) {
    for (const character of charactersIn(context, blast, source.id)) {
      if (alliesImmune && character.side === source.side) continue;
      mutations.push(damageMutation(context, character.id, 2, 'area', 'piercing'));
    }
  }
  return mutations;
};

/** ICON p.209 Pyre infuse (PYROTIC): the blast grows to a large blast and a pit
 * opens under the attack target. */
const pyroticEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const blast = squareArea(target.position, 3);
  for (const character of charactersIn(context, blast, source.id)) {
    if (character.id !== target.id) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  mutations.push(terrainMutation(context, 'create', 'pit', [target.position]));
  return mutations;
};

/** ICON p.209 Elden Rune: inscribe a rune on the space underneath you. Standing
 * on it adds +3 range to abilities with a listed range. The free-action
 * sacrifice version and the foe scrub-out rule are documented windows. */
const eldenRuneEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source.position) return [];
  return [terrainMutation(context, 'create', 'elden-rune', [source.position])];
};

/** ICON p.209 Lance: [D]+fray on hit (fray on miss) in a line 8, the foe is
 * vulnerable, and the other characters in the line take fray. Comeback or
 * Exceed: bonus damage for every unique object the line passed through. */
const lanceEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'vulnerable'));
  const direction = axisDirection(source.position, target.position);
  const line = new Set<string>();
  for (let step = 1; step <= 8; step += 1) {
    const cell = { x: source.position.x + direction.x * step, y: source.position.y + direction.y * step };
    if (!withinGrid(cell, context)) break;
    line.add(`${cell.x},${cell.y}`);
  }
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !line.has(`${position.x},${position.y}`)) continue;
    if (character.id !== target.id) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  if (context.triggers?.has('comeback') || (roll.attackMutation as Extract<RuleMutation, { kind: 'attack' }>).exceed === true) {
    const objects = Object.values(context.state.entities).filter((entity) => {
      return entity.positions.some((position) => line.has(`${position.x},${position.y}`));
    });
    if (objects.length > 0) mutations.push(damageMutation(context, target.id, objects.length, 'effect'));
  }
  return mutations;
};

/** ICON p.209 Lance infuse (VOLVAGA): the line gains width +1 (adjacent cells
 * take fray as area damage) and melts any objects of your choice in its path. */
const volvagaEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'vulnerable'));
  const direction = axisDirection(source.position, target.position);
  const width: { x: number; y: number }[] = [];
  for (let step = 1; step <= 8; step += 1) {
    const cell = { x: source.position.x + direction.x * step, y: source.position.y + direction.y * step };
    if (!withinGrid(cell, context)) break;
    width.push(cell);
    const perpendicular = direction.x !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
    for (const side of [perpendicular, { x: -perpendicular.x, y: -perpendicular.y }]) {
      const sideCell = { x: cell.x + side.x, y: cell.y + side.y };
      if (withinGrid(sideCell, context)) width.push(sideCell);
    }
  }
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !width.some((cell) => sameCell(cell, position))) continue;
    if (character.id !== target.id) mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  for (const entity of Object.values(context.state.entities)) {
    const position = entity.positions.find((candidate) => width.some((cell) => sameCell(cell, candidate)))
      ?? entityAnchorPosition(entity);
    if (position && width.some((cell) => sameCell(cell, position))) {
      mutations.push({ kind: 'entity', sourceId: context.sourceId, operation: 'remove', entityType: entity.type, ownerId: entity.ownerId ?? '', positions: [position], count: 1, state: {} });
    }
  }
  return mutations;
};

/** ICON p.210 Soul Burn: enter the stance. The end-of-turn sacrifice (2), the
 * automatic comeback triggers, the soul ember spark, and the start-of-turn
 * refresh are documented stance windows. */
const soulBurnEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  return [stanceMutation(context, source.id, 'enter', 'soul-burn')];
};

/** ICON p.210 Soul Burn infuse (INCANDIUS): shove all adjacent characters 3
 * and spark a soul ember at them (1 piercing). Collide (vulnerable on impact)
 * is documented as a reducer collision check. */
const incandiusEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source.position) return [];
  const mutations: RuleMutation[] = [];
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === source.id || !position || distance(position, source.position) > 1) continue;
    const away = axisDirection(source.position, position);
    mutations.push(shoveMutation(context, character.id, 3, away));
    mutations.push(damageMutation(context, character.id, 1, 'effect', 'piercing'));
  }
  return mutations;
};

/** ICON p.210 Blazing Bond: mark an ally in range 4. The Heartfire interrupt
 * (reduce damage or sacrifice cost by 3; the partner sacrifices 3, 1 on a
 * Comeback) is a held-damage window — the interrupt records the armoring flag
 * and the partner sacrifice. */
const blazingBondEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const ally = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context);
  if (!source.position || !ally?.position) throw new RuleProgramViolation('choice.actor-count', 'Blazing Bond requires an ally in range 4.');
  if (ally.side !== source.side || distance(source.position, ally.position) > 4) throw new RuleProgramViolation('choice.actor-range', 'Blazing Bond requires an ally in range 4.');
  return [markMutation(context, ally.id, 'blazing-bond', { partner: source.id })];
};

/** ICON p.210 Heartfire: reduce an incoming damage or sacrifice cost by 3
 * (recorded as `heartfire:armor` on the partner), and the other partner
 * sacrifices 3 (1 on a Comeback). */
const heartfireEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const partner = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveTriggerTargets(context)[0];
  if (!partner) throw new RuleProgramViolation('choice.actor-count', 'Heartfire requires the bonded partner.');
  const mutations: RuleMutation[] = [
    stateMutation(context, partner.id, 'heartfire:armor', true),
    damageMutation(context, partner.id, context.triggers?.has('comeback') ? 1 : 3, 'effect', 'sacrifice'),
  ];
  return mutations;
};

/** ICON p.210 Aethershard: sacrifice 3 (1 on a Comeback) and summon an
 * Aethershard in a free space in range 6. The resonance (2 piercing area
 * damage per shard caught in an ability, then destroy and gain 1 aether) is a
 * documented summon-trigger window. */
const aethershardEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source.position) return [];
  const mutations: RuleMutation[] = [
    damageMutation(context, source.id, context.triggers?.has('comeback') ? 1 : 3, 'effect', 'sacrifice'),
  ];
  mutations.push(...summonEntity(context, source.id, 'aethershard', source.position, {
    radius: 6, count: 1, losOrigin: source.position, state: { height: 1 },
  }));
  return mutations;
};

/** ICON p.211 Implode: end your turn and delay — choose a space in range 6;
 * your next turn must be slow, and at the start of that turn the space
 * explodes, shoving every character in the large blast as close as possible
 * toward it (characters in the center must save or be stunned). The
 * detonation is a documented delay window. */
const implodeEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context);
  if (!source.position) return [];
  const cell = target?.position ?? source.position;
  if (distance(source.position, cell) > 6) throw new RuleProgramViolation('choice.actor-range', 'Implode requires a space in range 6.');
  return [
    stateMutation(context, source.id, 'implode:pending', JSON.stringify({ x: cell.x, y: cell.y })),
    stateMutation(context, source.id, 'end-turn-requested', true),
  ];
};

/** ICON p.211 Pyroclast: choose yourself or a character in range 6 and mark
 * them. At the end of their next turn the ground erupts — a height 1 magma
 * spire pushes them up, and every character adjacent to the spire (not the
 * original character) is shoved 1 and takes 2 piercing. The eruption is a
 * documented turn-end window. */
const pyroclastEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context) ?? source;
  if (!source.position || !target.position) return [];
  if (distance(source.position, target.position) > 6) throw new RuleProgramViolation('choice.actor-range', 'Pyroclast requires a character in range 6.');
  return [markMutation(context, target.id, 'pyroclast', {})];
};

/** ICON p.211 Blackstar: 2[D]+fray on hit, [D]+fray on miss, [D]+fray to the
 * other characters in the large blast, and the attack target is shattered.
 * The user sacrifices 50% of max HP unless the round number is 6 or higher.
 * Comeback or Exceed: bonus damage, a pit under the center, and up to three
 * spaces of difficult terrain. */
const blackstarEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'miss'));
  const blast = squareArea(target.position, 3);
  for (const character of charactersIn(context, blast, source.id)) {
    // Collateral area damage keeps the ordinary die (the armed override is
    // consumed by the attack roll; provenance never leaks either).
    if (character.id !== target.id) mutations.push(damageMutation(context, character.id, context.dice.die(source.damageDie) + source.fray, 'area'));
  }
  mutations.push(conditionMutation(context, target.id, 'shattered'));
  if (context.state.round < 6) {
    // The half-max sacrifice is a percent-of-health cost — p.107 "% HEALTH"
    // uses the BASE maximum (adjudication icon-1.5:combat:bloodied-base-max).
    mutations.push(damageMutation(context, source.id, Math.ceil(baseMaximumHp(source) / 2), 'effect', 'sacrifice'));
  }
  if (context.triggers?.has('comeback') || (roll.attackMutation as Extract<RuleMutation, { kind: 'attack' }>).exceed === true) {
    mutations.push(damageMutation(context, target.id, context.dice.die(source.damageDie), 'effect'));
    mutations.push(terrainMutation(context, 'create', 'pit', [target.position]));
    const difficultCells = evaluatePositions({ origin: target.position, radius: 3, space: { kind: 'unoccupied' }, ordering: { kind: 'distance-from-origin' } }, context).slice(0, 3);
    if (difficultCells.length > 0) mutations.push(terrainMutation(context, 'create', 'difficult', difficultCells));
  }
  return mutations;
};

export const ENOCHIAN_RULE_RESOLVERS: RuleResolverRegistry = {
  'enochian:pyre:effects': pyreEffects,
  'enochian:pyre:pyrotic': pyroticEffects,
  'enochian:elden-rune:effects': eldenRuneEffects,
  'enochian:lance:effects': lanceEffects,
  'enochian:lance:volvaga': volvagaEffects,
  'enochian:soul-burn:effects': soulBurnEffects,
  'enochian:soul-burn:incandius': incandiusEffects,
  'enochian:blazing-bond:effects': blazingBondEffects,
  'enochian:blazing-bond:heartfire': heartfireEffects,
  'enochian:aethershard:effects': aethershardEffects,
  'enochian:implode:effects': implodeEffects,
  'enochian:pyroclast:effects': pyroclastEffects,
  'enochian:blackstar:effects': blackstarEffects,
};

export const ENOCHIAN_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'enochian:pyre': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'medium blast', 'range'],
      range: constant(6),
      resolverId: 'enochian:pyre:effects',
      steps: [],
    }),
    action({
      id: 'infuse', name: 'PYROTIC', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(3) }],
      tags: ['attack', 'large blast', 'range'],
      range: constant(6),
      resolverId: 'enochian:pyre:pyrotic',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'comeback', 'exceed']),

  'enochian:elden-rune': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['terrain effect'],
    resolverId: 'enochian:elden-rune:effects',
    steps: [],
  })], ['terrain effect', 'effect']),

  'enochian:lance': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'pierce', 'line'],
      range: constant(8),
      resolverId: 'enochian:lance:effects',
      steps: [],
    }),
    action({
      id: 'infuse', name: 'VOLVAGA', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(3) }],
      tags: ['attack', 'pierce', 'line'],
      range: constant(8),
      resolverId: 'enochian:lance:volvaga',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'effect', 'area effect', 'comeback', 'exceed']),

  'enochian:soul-burn': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['stance'],
      resolverId: 'enochian:soul-burn:effects',
      steps: [],
    }),
    action({
      id: 'infuse', name: 'INCANDIUS', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(4) }],
      tags: [],
      resolverId: 'enochian:soul-burn:incandius',
      steps: [],
    }),
  ], ['stance', 'refresh']),

  'enochian:blazing-bond': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['mark', 'range'],
      range: constant(4),
      resolverId: 'enochian:blazing-bond:effects',
      steps: [],
    }),
    action({
      id: 'heartfire', name: 'Heartfire', timing: 'interrupt',
      costs: [{ kind: 'interrupt', amount: constant(2) }],
      tags: [],
      resolverId: 'enochian:blazing-bond:heartfire',
      steps: [],
    }),
  ], ['mark', 'interrupt']),

  'enochian:aethershard': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['object', 'range'],
    range: constant(6),
    resolverId: 'enochian:aethershard:effects',
    steps: [],
  })], ['object', 'effect', 'comeback']),

  'enochian:implode': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['end turn', 'delay', 'range'],
    range: constant(6),
    resolverId: 'enochian:implode:effects',
    steps: [],
  })], ['effect', 'end turn', 'delay']),

  'enochian:pyroclast': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['range'],
    range: constant(6),
    resolverId: 'enochian:pyroclast:effects',
    steps: [],
  })], ['effect', 'comeback']),

  'enochian:blackstar': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'pierce', 'large blast', 'range'],
      range: constant(8),
      resolverId: 'enochian:blackstar:effects',
      steps: [],
    }),
    action({
      id: 'infuse', name: 'ASTRAL BLACKSTAR', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(5) }],
      tags: ['attack', 'pierce', 'large blast', 'range'],
      range: constant(8),
      resolverId: 'enochian:blackstar:effects',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'effect', 'comeback', 'exceed']),
};
