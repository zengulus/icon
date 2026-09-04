import { RuleProgramViolation } from '../../../kernels/runtime.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  sameCell, squareArea, withinGrid, occupied,
  constant,
  distance, sourceActor,
  damageMutation, conditionMutation, stateMutation, vigorMutation, rollDamageDice,
  resourceMutation, stanceMutation, markMutation,
  teleportMutation, entityMutation, summonEntity, terrainMutation,
  action, compilation,
} from '../../../primitives/job-kit.js';
import { evaluatePositions, rushTowardFoes } from '../../../kernels/evaluate-query.js';
import { readCapturedPositionChoice, validateCapturedPositionChoice } from '../../../kernels/choice.js';
import { percentOfMaximum, baseMaximumHp } from '../../../kernels/evaluate-value.js';
import { resolveCapturedSelectedActors, resolveTriggerTargets, resolveAttackTarget, resolveSourceActor } from '../../glue/reference-authoring.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';
import { rollAbilityDamage } from '../../../kernels/bonus-damage.js';
import { chosenTeleportDestination } from '../../../kernels/teleport-choice.js';
import { effectiveScopedRange } from '../../../kernels/range.js';
import { rangeStateView } from '../../../kernels/encounter-adapter.js';

/**
 * Independently reviewed Harvester ability implementations (ICON p.182–188),
 * the second Mendicant job. Every ability below has typed costs, targets,
 * ranges, and tags from the source catalog plus a hand-authored typed
 * RuleProgram and a named deterministic resolver.
 *
 * Thralls and plants are `thrall` / `plant` entities; the undergrowth is
 * `undergrowth` terrain (dangerous for foes); the fairy ring is a `fairy-ring`
 * terrain effect; blessing is the `blessing` resource.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Sow's "after you attack your marked foe, bless yourself or an ally in
 *   range 3" is a mark-trigger reducer hook that the single-pass VM does not
 *   yet express; the mark is applied and the bless resolves as a documented
 *   mark-trigger window.
 * - Growing Season's plant spawn, Rot's cure/vigor denial and +1 save curse,
 *   Crimson Bloom's d6 power-die ticking, and Dark Sliver's soul-space
 *   end-of-turn check are turn-end / damage-trigger reducer hooks documented
 *   below rather than resolved inline.
 * - Gravebirth's refresh-on-slay and the blood grove's turn-end thrall
 *   conditions (slay / sacrifice / bloodied) are the documented summon-trigger
 *   windows.
 */

/** Standard resolver-driven autohit attack mutation (no roll). */
const autohitAttack = (context: RuleExecutionContext): RuleMutation => ({
  kind: 'attack', sourceId: context.sourceId, actorId: context.actorId, targetId: context.attackTargetId ?? '',
  d20: null, boon: 0, total: null, hit: true, critical: false, evasionRoll: null, trueStrike: true, autoHit: true,
});

/** ICON p.185 Sow: auto-hit fray, seal the foe, and mark them. The post-attack
 * bless on the marked foe is a documented mark-trigger window. */
const sowEffects: RuleResolver = (context) => {
  const target = resolveAttackTarget(context);
  if (!target) return [];
  const mutations: RuleMutation[] = [autohitAttack(context)];
  mutations.push(damageMutation(context, target.id, resolveSourceActor(context).fray, 'hit'));
  mutations.push(conditionMutation(context, target.id, 'sealed'));
  mutations.push(markMutation(context, target.id, 'sow', {}));
  return mutations;
};

/** ICON p.185 Sow combo (REAP): attack [D]+fray on hit (fray on miss), summon a
 * Thrall adjacent to the target, and on a Slay trigger repeat the effect. */
const reapEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  mutations.push(...summonEntity(context, source.id, 'thrall', target.position, {
    radius: 1, count: 1, losOrigin: source.position,
  }));
  if (context.triggers?.has('slay')) {
    mutations.push(...summonEntity(context, source.id, 'thrall', target.position, {
      radius: 1, count: 1, losOrigin: source.position,
    }));
    mutations.push(damageMutation(context, target.id, context.dice.die(source.damageDie) + source.fray, 'effect'));
  }

  return mutations;
};

/** ICON p.185 Growing Season: mark a character in range 4. The plant spawns
 * after they end their turn (a documented turn-end window); a bloodied target
 * repeats it and additionally pacifies foes. */
const growingSeasonEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context);
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Growing Season requires a character in range 4.');
  if (distance(source.position, target.position) > 4) throw new RuleProgramViolation('choice.actor-range', 'Growing Season requires a character in range 4.');
  // Growing Season's bloodied variant reads the p.81 BASE bar (adjudication
  // icon-1.5:combat:bloodied-base-max) — never the wounds-adjusted max.
  return [markMutation(context, target.id, 'growing-season', { bloodied: target.hp <= baseMaximumHp(target) / 2 })];
};

/** ICON p.185 Gravebirth: enter the stance and summon a Thrall in a free space
 * in range 2. Refresh-on-slay and the end-of-turn blessing summons are
 * documented stance-trigger windows. */
const gravebirthEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source.position) return [];
  const mutations: RuleMutation[] = [stanceMutation(context, source.id, 'enter', 'gravebirth')];
  mutations.push(...summonEntity(context, source.id, 'thrall', source.position, {
    radius: 2, count: 1, losOrigin: source.position,
  }));
  return mutations;
};

/** ICON p.185 Harvest: 2[D]+fray on hit (fray on miss) to the target, then foes
 * in the small blast around them take fray and allies are blessed. On a Slay
 * trigger, summon a Thrall for each foe in the area and deal 2 piercing damage
 * again to those foes. */
const harvestEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const area = squareArea(target.position, 1);
  const foesInArea = Object.values(context.state.actors).filter((character) => {
    const position = character.position;
    return character.side !== source.side && character.id !== target.id && position && area.some((cell) => sameCell(cell, position));
  });
  const alliesInArea = Object.values(context.state.actors).filter((character) => {
    const position = character.position;
    return character.side === source.side && position && area.some((cell) => sameCell(cell, position));
  });
  for (const foe of foesInArea) mutations.push(damageMutation(context, foe.id, source.fray, 'area'));
  for (const ally of alliesInArea) mutations.push(resourceMutation(context, ally.id, 'blessing', 'gain', 1));
  if (context.triggers?.has('slay')) {
    for (const foe of [...foesInArea, target]) {
      if (!foe.position) continue;
      mutations.push(...summonEntity(context, source.id, 'thrall', foe.position, {
        radius: 1, count: 1, losOrigin: source.position,
      }));
      mutations.push(damageMutation(context, foe.id, 2, 'area', 'piercing'));
    }
  }
  return mutations;
};

/** ICON p.186 Blood Grove: grow a medium blast of undergrowth centered in
 * range 2. The undergrowth is dangerous for foes. The turn-end thrall per
 * fulfilled condition (slay / sacrifice / bloodied) is a documented
 * summon-trigger window. */
const bloodGroveEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const centerActor = resolveCapturedSelectedActors(context, 'target')[0];
  const center = centerActor?.position;
  if (!source.position) return [];
  const centerCell = center ?? source.position;
  if (distance(source.position, centerCell) > 2) throw new RuleProgramViolation('choice.actor-range', 'Blood Grove requires its center in range 2.');
  const cells = squareArea(centerCell, 2).filter((cell) => withinGrid(cell, context));
  return [terrainMutation(context, 'create', 'undergrowth', cells)];
};

/** ICON p.186 Rot: mark a foe — they cannot be cured, cannot gain or benefit
 * from vigor, and take +1 curse on saves (a documented mark-trigger window);
 * a foe at 25% hp or lower when marked also loses defiance while marked. The
 * REGENERATE combo marks an ally whose rot mark projects a literal
 * regeneration condition (and defiance at 25%). Both interpretations live in
 * the closed source-ID projection in passive-projection.ts. */
const rotEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context);
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Rot requires a character in range 4.');
  if (distance(source.position, target.position) > 4) throw new RuleProgramViolation('choice.actor-range', 'Rot requires a character in range 4.');
  // ICON p.186: "If that character is at 25% hp or lower when marked" — the
  // canonical exact quarter read (hp·4 <= base, engine's singular
  // `isAtOrUnderQuarterHp`/`quarter` authority) against the BASE maximum
  // (adjudication icon-1.5:combat:bloodied-base-max: p.81 bloodied is "50%
  // your base maximum hp" and the same base bar governs every percent-of-
  // health read; wounds shrink the live maxHp but never this threshold),
  // computed through the SINGLE U5 percentage-of-BASE-maximum scalar
  // (`percentOfMaximum(…, 25, 'down')` = floor(baseMax/4)). Two repairs
  // from the original resolver: the former Math.ceil(maxHp/4) granted the
  // state at hp == ceil(max/4) for non-divisible maxima (e.g. 8 of 30 =
  // 26.7%, above 25% — one point over the source's "25% or lower"), and
  // the bar was the wounds-adjusted maxHp rather than the base maximum.
  const atQuarter = target.hp <= percentOfMaximum(baseMaximumHp(target), 25, 'down');
  const mutations: RuleMutation[] = [];
  if (target.side === source.side) {
    mutations.push(markMutation(context, target.id, 'rot', { kind: 'ally' }));
    if (atQuarter) mutations.push(conditionMutation(context, target.id, 'defiance'));
  } else {
    mutations.push(markMutation(context, target.id, 'rot', { kind: 'foe', noDefiance: atQuarter }));
  }
  return mutations;
};

/** ICON p.186 Crimson Bloom: mark a character in range 4 with a d6 power die
 * starting at 0. The die ticks when the character is damaged or attacks and
 * detonates at 6 (sacrifice 6, gain 6 vigor, bonus damage, unstoppable) —
 * a documented damage-trigger / turn-end window. */
const crimsonBloomEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveCapturedSelectedActors(context, 'target')[0] ?? resolveAttackTarget(context);
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Crimson Bloom requires a character in range 4.');
  if (distance(source.position, target.position) > 4) throw new RuleProgramViolation('choice.actor-range', 'Crimson Bloom requires a character in range 4.');
  return [markMutation(context, target.id, 'crimson-bloom', { die: 0 })];
};

/** ICON p.187 Fairy Ring: end your turn and create a burst 2 (self) ring of
 * mushrooms that can overlap terrain and sit underneath characters. While the
 * ring is active, the Spirit Away interrupt teleports an entering or exiting
 * foe 2 and seals them without ending their movement. */
const fairyRingEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source.position) return [];
  const cells = squareArea(source.position, 2).filter((cell) => withinGrid(cell, context));
  return [
    terrainMutation(context, 'create', 'fairy-ring', cells),
    stateMutation(context, source.id, 'end-turn-requested', true),
  ];
};

/** ICON p.187 Spirit Away: player-selected Teleport 2 for the foe that entered
 * or exited the ring, and seal them. The movement that triggered the window
 * is not ended. */
const spiritAwayEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const foe = resolveTriggerTargets(context)[0] ?? resolveCapturedSelectedActors(context, 'target')[0];
  if (!source.position || !foe?.position) return [];
  const mutations: RuleMutation[] = [];
  const landing = chosenTeleportDestination(context, foe.id, 'teleport', foe.position, 2, 'Spirit Away');
  if (landing) mutations.push(teleportMutation(context, foe.id, landing));
  mutations.push(conditionMutation(context, foe.id, 'sealed'));
  return mutations;
};

/** The effective radius of one of Dark Sliver's source-declared INTERNAL
 * placement ranges (terrain-placement / slay-placement) through the shared
 * range authority — the same scoped rules the attack range reads, so Dark
 * Sliver talent 1's Comeback "+1 to all ranges" widens the soul-space and
 * Slay plant placement exactly like the attack (3 → 4). The gate logic lives
 * only in range-recipes.ts; the resolver never re-implements Comeback. An
 * isolated VM fixture without encounter state falls back to the source base
 * radius (3). */
const darkSliverPlacementRange = (context: RuleExecutionContext, scope: string): number => {
  if (!context.encounterState) return 3;
  return effectiveScopedRange(
    rangeStateView(context.encounterState),
    context.actorId,
    context.sourceId,
    3,
    scope,
    context.actionId,
  );
};

/** ICON p.187 Dark Sliver: [D]+fray on hit (fray on miss), then cut away part
 * of the target's soul by choosing a free space in range 3 of the foe and
 * marking it. The end-of-next-turn check (2 piercing, pacified, plant) is a
 * documented turn-end window; a Slay trigger creates a plant immediately. */
const darkSliverEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source.position || !target?.position) return [];
  const slay = context.triggers?.has('slay') ?? false;
  const placementRange = darkSliverPlacementRange(context, slay ? 'slay-placement' : 'terrain-placement');
  const placement = {
    origin: target.position,
    originSize: target.size,
    range: placementRange,
    ...(slay ? { lineOfSightFrom: source.position } : {}),
  };
  const candidates = evaluatePositions({
    origin: target.position,
    originSize: target.size,
    radius: placementRange,
    space: { kind: 'unoccupied' },
    ...(slay ? { lineOfSightFrom: source.position } : {}),
  }, context);
  const choiceKey = slay ? 'plant-position' : 'soul-position';
  const choiceLabel = slay ? 'Dark Sliver Slay plant' : 'Dark Sliver soul-space';
  const recordedPosition = readCapturedPositionChoice(context, choiceKey, choiceLabel);
  if (candidates.length > 0 && !recordedPosition) {
    throw new RuleProgramViolation('choice.position-required', `${choiceLabel} requires a recorded position.`);
  }
  const chosenPosition = recordedPosition
    ? validateCapturedPositionChoice(context, recordedPosition, placement, choiceLabel)
    : null;
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  // ICON p.185 Dark Sliver talent 1: "Comeback: Deal bonus damage, and
  // increase all ranges by +1." The bonus die folds at the USE_ABILITY
  // boundary while the user is bloodied (the comeback gate); the range half
  // is the comeback-gated scoped range rule in range-recipes.ts — the attack
  // target range (2 → 3) at the USE_ABILITY gate and the placement ranges
  // (3 → 4) through `darkSliverPlacementRange` below.
  mutations.push(roll.hit
    ? damageMutation(context, target.id, rollAbilityDamage(context.dice, roll.damageDie, 1, target.id, context) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  if (slay) {
    if (chosenPosition) mutations.push(entityMutation(context, source.id, chosenPosition, 'plant', {}));
  } else if (chosenPosition) {
    mutations.push(markMutation(context, target.id, 'dark-sliver', { x: chosenPosition.x, y: chosenPosition.y }));
    mutations.push(entityMutation(context, source.id, chosenPosition, 'soul-space', {}));
  }
  return mutations;
};

export const HARVESTER_RULE_RESOLVERS: RuleResolverRegistry = {
  'harvester:sow:effects': sowEffects,
  'harvester:sow:reap': reapEffects,
  'harvester:growing-season:effects': growingSeasonEffects,
  'harvester:gravebirth:effects': gravebirthEffects,
  'harvester:harvest:effects': harvestEffects,
  'harvester:blood-grove:effects': bloodGroveEffects,
  'harvester:rot:effects': rotEffects,
  'harvester:crimson-bloom:effects': crimsonBloomEffects,
  'harvester:fairy-ring:effects': fairyRingEffects,
  'harvester:fairy-ring:spirit-away': spiritAwayEffects,
  'harvester:dark-sliver:effects': darkSliverEffects,
};

export const HARVESTER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'harvester:sow': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'pierce', 'mark', 'range'],
      range: constant(4),
      resolverId: 'harvester:sow:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'REAP', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['attack', 'pierce', 'summon'],
      range: constant(4),
      resolverId: 'harvester:sow:reap',
      steps: [],
    }),
  ], ['attack', 'on hit', 'effect', 'mark', 'combo', 'slay']),

  'harvester:growing-season': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark', 'range'],
    range: constant(4),
    resolverId: 'harvester:growing-season:effects',
    steps: [],
  })], ['mark', 'effect']),

  'harvester:gravebirth': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['stance', 'summon'],
    resolverId: 'harvester:gravebirth:effects',
    steps: [],
  })], ['stance', 'refresh']),

  'harvester:harvest': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack', 'arc'],
    range: constant(6),
    resolverId: 'harvester:harvest:effects',
    steps: [{ id: 'slay', timing: 'use', trigger: 'slay', effects: [] }],
  })], ['attack', 'on hit', 'miss', 'area effect', 'slay']),

  'harvester:blood-grove': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['summon', 'terrain effect', 'range'],
    range: constant(2),
    resolverId: 'harvester:blood-grove:effects',
    steps: [],
  })], ['terrain effect', 'effect']),

  'harvester:rot': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['mark', 'range'],
      range: constant(4),
      resolverId: 'harvester:rot:effects',
      steps: [],
    }),
    action({
      id: 'combo', name: 'REGENERATE', timing: 'use',
      costs: [{ kind: 'combo', amount: constant(1) }],
      tags: ['mark', 'range'],
      range: constant(4),
      resolverId: 'harvester:rot:effects',
      steps: [],
    }),
  ], ['mark', 'effect', 'combo']),

  'harvester:crimson-bloom': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['mark', 'summon', 'range', 'power die'],
    range: constant(4),
    resolverId: 'harvester:crimson-bloom:effects',
    steps: [],
  })], ['mark', 'effect']),

  'harvester:fairy-ring': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['terrain effect', 'end turn'],
      resolverId: 'harvester:fairy-ring:effects',
      steps: [],
    }),
    action({
      id: 'spirit-away', name: 'Spirit Away', timing: 'interrupt',
      costs: [{ kind: 'interrupt', amount: constant(2) }],
      tags: [],
      resolverId: 'harvester:fairy-ring:spirit-away',
      steps: [],
    }),
  ], ['terrain effect', 'end turn', 'interrupt']),

  'harvester:dark-sliver': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'range'],
    range: constant(2),
    resolverId: 'harvester:dark-sliver:effects',
    steps: [],
  })], ['attack', 'on hit', 'miss', 'terrain effect', 'slay']),
};
