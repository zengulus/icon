import { RuleProgramViolation } from '../../../kernels/runtime.js';
import { hasMastery } from '../../../kernels/mastery.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { Position } from '../../../../types.js';
import type { RuleDuration, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import {
  axisDirection, lineCells, orthogonalNeighbors, sameCell, squareArea, walk,
  self, attackTarget, constant, damageDie, fray, normalDamage,
  distance, withinGrid, sourceActor,
  damageMutation, conditionMutation, rushMutation, shoveMutation, stateMutation,
  notHeroic, action, compilation,
} from '../../../primitives/job-kit.js';
import { areaHasCellWithinRange, blastTemplateCells, validateLine } from '../../../../area-geometry.js';
import { recipientBranchEligibility, resolveRecipientBranch } from '../../../primitives/area-resolution.js';
import { footprintIntersectsCells, validateSpatialIntent } from '../../../primitives/spatial-intent.js';
import { rampartObstructs } from '../../../kernels/encounter-adapter.js';
import { rushTowardFoes } from '../../../kernels/evaluate-query.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';
import { resolveAttackTarget, resolveSourceActor } from '../../glue/reference-authoring.js';
import { vigilanceRushOncePerTurnKey } from '../../../kernels/use-ledger.js';
import { consumeUsageMutation, ledgerAvailable } from '../../../primitives/usage.js';

/**
 * Independently reviewed Demon Slayer ability implementations (ICON p.128–130).
 *
 * Every ability below has typed costs, targets, ranges, and tags from the
 * source catalog plus a hand-authored typed RuleProgram. Lines and blasts use
 * the shared deterministic area geometry (area-geometry.ts); stance refresh,
 * the Soul Blade aether slash, and the Gates of Hell vigilance rush are
 * caller-asserted actions; Six Hells Trigram, Comet's thrown weapon, and
 * Wicked Sheath's power die resolve through reducer lifecycle hooks so the
 * delayed and round-start behaviors stay deterministic and replayable.
 *
 * Fidelity notes that stay visible on the resolved event (the full source
 * text is preserved on every RULE_MUTATIONS_APPLIED event):
 * - ICON's AoE attack rule: the character in the attack space takes the
 *   ATTACK component instead of the area effect; every OTHER character in
 *   the area — allies and foes alike — takes the unrestricted "Area
 *   effect: Fray" (the sources name no foe restriction).
 * - Draken Cross's required second/repeated blast areas need the player's
 *   RECORDED centers, and elected rushes need RECORDED directions — never
 *   an auto-selected or nearest-foe placement. The areas cannot overlap
 *   (p.128), and a selected area is legal when at least one of its cells is
 *   within the effective blast range of the post-rush origin (p.97).
 * - Demon Cutter's Charge/Heroic repeat is a RECORDED player-selected
 *   Line 3 (validated through the single canonical Line authority + the
 *   shared at-least-one-cell-in-range placement rule + non-overlap) — never
 *   a ray invented from the user's position and never a deterministic
 *   perpendicular fallback. The repeat itself is mandatory once the source
 *   fires; only the area is a choice.
 * - The Dark Wind Devil Blade mastery's optional teleport and divine
 *   splash remain UNRESOLVED: they need exact source Blast geometry and a
 *   recorded destination, neither of which this tranche approximates.
 * - Slow-turn restrictions from delay effects are recorded on rule state but
 *   not yet enforced by the reducer's action gates.
 * - Counter retaliation and vigilance charge spends are represented as typed
 *   conditions/resources; their consumption hooks are not yet wired into the
 *   damage/movement pipeline.
 */

/** Actors-only occupancy check for a single placement/creation request (the
 * thrown Comet weapon's placement, Draken Cross area centers). NOT a
 * movement authority — movement paths route through `plannedRush`/`walk`. */
const occupied = (position: Position, context: Parameters<RuleResolver>[0], excludeId: string) =>
  Object.values(context.state.actors).some((actor) => actor.id !== excludeId && actor.position && sameCell(actor.position, position));

/** Rush `steps` cells in `direction`, stopping at the grid edge, impassable
 * terrain, a character footprint, or an object. This is a thin accumulation
 * over the SHARED ability-move authority (`walk`, primitives/job-kit.ts) —
 * every legality decision (bounds, impassable, size-aware footprint
 * occupancy, objects) comes from `walk`, never from a duplicate grid-steady
 * loop. `from` lets ordered-effect callers plan from the CURRENT point of
 * the sequence (e.g. the position after an earlier rush) instead of the
 * live pre-command position. */
function plannedRush(context: Parameters<RuleResolver>[0], actorId: string, steps: number, direction: Position, from?: Position): Position[] {
  const source = sourceActor(context, actorId);
  if (!source?.position) return [];
  const path: Position[] = [];
  let position = from ? { ...from } : { ...source.position };
  for (let step = 0; step < steps; step += 1) {
    const next = walk(context, position, direction, 1, false, actorId);
    if (sameCell(next, position)) break; // the shared authority could not advance (edge/impassable/occupancy/object)
    path.push({ ...next });
    position = next;
  }
  return path;
}

/** ICON p.128: line-3 true-strike attack; target slashed; line-area fray; Charge/Heroic repeats a second non-overlapping line. */
const demonCutterEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position || !target || !target.position) return [];
  const mutations: RuleMutation[] = [];
  let sourcePosition = source.position;
  // Talent II (p.128): "You can rush 1 before using Demon Cutter. Charge:
  // Rush 3 instead." This is OPTIONAL player movement: a recorded
  // invoke/decline choice (`booleans['rush-before']`); when elected, the
  // RUSH PATH is a REQUIRED recorded movement decision (never an auto-rush
  // toward the nearest foe, never a direction repeated blindly). The
  // recorded path is validated through the CANONICAL movement authority
  // (validateSpatialIntent — the same bounds/occupancy/impassable/rampart
  // decision the reducer's move application uses): every step orthogonally
  // adjacent, inside the grid, and every cell legal under the shared
  // authority. Rush 1 moves up to ONE space; under Charge, Rush 3 moves up
  // to THREE. A missing, malformed, or blocked path fails atomically before
  // any mutation. No decision, or a recorded decline, changes nothing.
  const rushElected = source.talents?.['demon-slayer:demon-cutter'] === 2
    && context.input.booleans?.['rush-before'] === true;
  if (rushElected) {
    const rushPath = context.input.positions?.['rush-before'];
    if (!rushPath || rushPath.length === 0) {
      throw new RuleProgramViolation('choice.position-required', 'Demon Cutter’s pre-use rush needs a recorded path.');
    }
    const maxSteps = context.triggers?.has('charge') ? 3 : 1;
    if (rushPath.length > maxSteps) {
      throw new RuleProgramViolation('choice.position-range', `Demon Cutter’s pre-use rush moves up to ${maxSteps} space${maxSteps === 1 ? '' : 's'}; the recorded path is too long.`);
    }
    let previous = sourcePosition;
    for (const cell of rushPath) {
      const step = Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y);
      if (step !== 1) {
        throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s pre-use rush path must move one orthogonal space per step.');
      }
      const rawState = context.encounterState;
      if (!rawState) {
        throw new RuleProgramViolation('rule.context-incomplete', 'Demon Cutter’s pre-use rush needs the authoritative encounter state.');
      }
      const mover = rawState.actors[source.id];
      const validation = validateSpatialIntent(rawState, {
        kind: 'move',
        actorId: source.id,
        sourceActorId: source.id,
        sourceRuleId: context.sourceId,
        from: previous,
        to: cell,
        rampartObstructed: mover ? rampartObstructs(rawState, mover, cell) : false,
      });
      if (!validation.legal) {
        throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s pre-use rush path is blocked.');
      }
      previous = cell;
    }
    mutations.push(rushMutation(context, source.id, rushPath));
    sourcePosition = { ...rushPath[rushPath.length - 1]! };
  }
  const targetPosition = target.position;
  // ICON Line rules: no listed range → the line's origin is the ability
  // user (a self-origin Line 3 along the dominant axis toward the target);
  // listed range → the origin is the first space of the Line and the player
  // RECORDS the area. "Charge or Heroic: Gains range 2" (p.128) therefore
  // makes the PRIMARY Line a ranged, recorded player choice — placed within
  // range 2 of the POST-rush origin, never a ray forced to emanate from the
  // user.
  let line: Position[];
  if (context.triggers?.has('charge') || context.triggers?.has('heroic')) {
    const recordedPrimary = context.input.positions?.['primary-line'];
    if (!recordedPrimary || recordedPrimary.length === 0) {
      throw new RuleProgramViolation('choice.position-required', 'Demon Cutter’s Line 3 needs a recorded area when it gains range 2.');
    }
    const primaryLine = validateLine(recordedPrimary, 3);
    if (!primaryLine) {
      throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s Line 3 must be an orthogonal, strictly-straight Line 3.');
    }
    if (!primaryLine.every((cell) => withinGrid(cell, context))) {
      throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s Line 3 must be inside the battlefield.');
    }
    if (!areaHasCellWithinRange(primaryLine, sourcePosition, 2)) {
      throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s Line 3 needs at least one space within range 2 of you.');
    }
    if (!primaryLine.some((cell) => sameCell(cell, targetPosition))) {
      throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s Line 3 must include the attack target.');
    }
    line = primaryLine;
  } else {
    const primaryDirection = context.input.directions?.['line-direction'] ?? axisDirection(sourcePosition, targetPosition);
    line = lineCells(sourcePosition, primaryDirection, 3);
    if (!line.some((cell) => sameCell(cell, targetPosition))) {
      throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s Line 3 must include the attack target; attack along an axis toward it.');
    }
  }
  mutations.push(conditionMutation(context, target.id, 'slashed'));
  // ICON's AoE attack rule: the character in the attack space takes the
  // ATTACK component instead of the area effect, so the attack-space target
  // is EXCLUDED from the line's fray. Every other character in the line —
  // allies and foes alike — takes the unrestricted "Area effect: Fray".
  const areaFray = (cells: Position[], opts: { excludeAttackSpace?: boolean } = {}) => {
    for (const character of Object.values(context.state.actors)) {
      // Full-footprint membership (ICON p.290 large characters): a Size 2+
      // character whose anchor sits OUTSIDE the line but whose occupied
      // footprint intersects it counts as inside; a character occupying
      // several cells of one area is still affected EXACTLY once.
      if (!character.position || !footprintIntersectsCells({ position: character.position, size: character.size }, cells)) continue;
      if (opts.excludeAttackSpace && character.id === target.id) continue;
      mutations.push(damageMutation(context, character.id, source.fray, 'area'));
    }
  };
  areaFray(line, { excludeAttackSpace: true });
  if (context.triggers?.has('charge') || context.triggers?.has('heroic')) {
    // "Charge or Heroic: Gains range 2, and repeat the area effect in a new
    // line 3 area in range. The areas cannot overlap." The grammar makes the
    // REPEAT mandatory once the source fires ("and repeat", never "may");
    // only the AREA is a choice — a recorded player-selected Line 3. The
    // chosen path is validated through the SINGLE canonical Line authority
    // (validateLine, area-geometry.ts — never a ray invented from the user's
    // position, never a deterministic perpendicular fallback), placed by the
    // shared area-placement rule (at least one space within the granted
    // range 2 of the POST-rush origin — a ranged Line need not start
    // adjacent to the user), fully on-grid, and non-overlapping with the
    // first line. A missing or malformed chosen line fails closed before any
    // mutation is emitted.
    const recorded = context.input.positions?.['second-line'];
    if (!recorded || recorded.length === 0) {
      throw new RuleProgramViolation('choice.position-required', 'Demon Cutter’s repeated line needs a recorded Line 3 area.');
    }
    const secondLine = validateLine(recorded, 3);
    if (!secondLine) {
      throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s repeated line must be an orthogonal, strictly-straight Line 3.');
    }
    if (!secondLine.every((cell) => withinGrid(cell, context))) {
      throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s repeated line must be inside the battlefield.');
    }
    if (!areaHasCellWithinRange(secondLine, sourcePosition, 2)) {
      throw new RuleProgramViolation('choice.position-range', 'Demon Cutter’s repeated Line 3 needs at least one space within range 2 of you.');
    }
    if (secondLine.some((cell) => line.some((first) => sameCell(cell, first)))) {
      throw new RuleProgramViolation('choice.area-overlap', 'Demon Cutter’s repeated line cannot overlap the first line.');
    }
    areaFray(secondLine);
  }
  return mutations;
};

/** ICON p.128: medium-blast area damage, thrown-weapon object with rampart, and a Charge/Heroic rush. */
const cometEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const direction = context.input.directions?.['throw-direction'] ?? rushTowardFoes(context, source.position);
  const defaultCenter = { x: source.position.x + direction.x * 3, y: source.position.y + direction.y * 3 };
  const center = context.input.positions?.['area-center']?.[0] ?? defaultCenter;
  if (!withinGrid(center, context)) throw new RuleProgramViolation('choice.position-range', 'Comet needs an area center inside the battlefield.');
  if (distance(source.position, center) > 3) throw new RuleProgramViolation('choice.position-range', 'Comet needs an area center within range 3.');
  // Comet is a MEDIUM blast (p.128): the exact template, not a square.
  const blast = blastTemplateCells('medium', center);
  const mutations: RuleMutation[] = [];
  for (const character of Object.values(context.state.actors)) {
    if (character.id === source.id || !character.position || !footprintIntersectsCells({ position: character.position, size: character.size }, blast)) continue;
    mutations.push(damageMutation(context, character.id, 2, 'area'));
  }
  const blocked = (position: Position) => occupied(position, context, source.id)
    || Object.values(context.state.entities).some((entity) =>
      entity.positions.some((cell) => sameCell(cell, position)));
  const freeCells = [center, ...orthogonalNeighbors(center), ...blastTemplateCells('small', center).filter((cell) => !sameCell(cell, center))];
  const placement = freeCells.find((cell) => withinGrid(cell, context) && !blocked(cell)) ?? center;
  mutations.push({ kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: 'object', ownerId: source.id, positions: [placement], count: 1, state: { thrownWeapon: true } });
  for (const neighbor of orthogonalNeighbors(placement)) {
    if (withinGrid(neighbor, context)) {
      mutations.push({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: source.id, operation: 'create', terrain: 'rampart', positions: [neighbor], height: null });
    }
  }
  mutations.push(stateMutation(context, source.id, 'weapon-deployed', true));
  if (context.triggers?.has('charge') || context.triggers?.has('heroic')) {
    const path = plannedRush(context, source.id, 3, direction);
    if (path.length > 0) mutations.push(rushMutation(context, source.id, path));
  }
  return mutations;
};

/** ICON p.128: small-blast attack (hit 2[D]+fray / miss fray / crit +[D])
 * with its Area effect, a REQUIRED base Effect, and a Charge/Heroic repeat.
 *
 * Blast geometry (p.97 exact templates): the primary and later blasts are
 * SMALL templates (center + 4 orthogonal squares) by default; Talent II's
 * "all areas may be increased to medium blasts instead" switches every
 * created area to the MEDIUM template (center + 8 surrounding squares).
 * Cell membership is the exact template, never a square approximation.
 *
 * Re-read fidelity semantics:
 * - The attack resolves FIRST (source order: Attack, then its Area effect,
 *   then Effect, then Charge/Heroic, then Talent consequences). The
 *   attack-space character gets the ATTACK component INSTEAD of the area
 *   effect (ICON's AoE attack rule); every OTHER character in the primary
 *   blast — allies, foes, even the user standing inside it — takes the area
 *   effect: fray ("Area effect: Fray" names no foe restriction, and an
 *   unrestricted area affects every character in it).
 * - The base Effect is NOT optional as a whole: "You may rush 1, then target
 *   another small blast area in range 3…" reads like every other "You may
 *   Rush X, then …" construction — the RUSH may be declined, but the second
 *   Small Blast area is REQUIRED. Both undertakings are player spatial
 *   choices: the rush needs a recorded direction when elected, and the area
 *   needs a recorded center — never a deterministic "nearest foe" or
 *   auto-selected fallback.
 * - Placement legality for the later areas is the ICON p.97 region rule: the
 *   pattern is legal when AT LEAST ONE of its spaces is within the effective
 *   blast range of the POST-RUSH origin (never the center alone), every cell
 *   is on the battlefield, and no cell overlaps an area this use already
 *   created. The whole operation is validated BEFORE any rush mutation is
 *   emitted, so a malformed chosen area can never leave a half-applied rush
 *   behind (atomic Effect execution).
 * - "Charge or Heroic: Gains true strike, and may repeat the effect." The
 *   true strike folds into the authoritative roll (Charge = durable
 *   slow-turn fact; Heroic = validated declaration); the repeat is another
 *   complete Effect operation (optional rush 1 + its own REQUIRED area,
 *   non-overlapping with every prior area) and is itself optional.
 * - Talent II (p.128): "Charge: Increase range to 5, and all areas may be
 *   increased to medium blasts instead." ONE recorded resolution-level
 *   decision (`booleans['medium-areas']`) sizes every created area small OR
 *   medium ("all areas … instead"); the player may decline. The range half
 *   folds through the generic charge-gated range rule; `blastRange` here is
 *   the same widened authority.
 * - Talent I: "Exceed: Deal fray damage again to all characters in any area
 *   created by this ability." "All characters" is explicit — it includes
 *   the attack-space character (a later separate effect, not the primary
 *   area effect repeated blindly) and is identity-deduplicated per area.
 */
const drakenCrossEffects: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position || !target || !target.position) return [];
  const mutations: RuleMutation[] = [];
  const charged = source.talents?.['demon-slayer:draken-cross'] === 2
    && context.triggers?.has('charge');
  const medium = charged === true && context.input.booleans?.['medium-areas'] === true;
  const scaled = (center: Position) => blastTemplateCells(medium ? 'medium' : 'small', center);
  const blastRange = charged ? 5 : 3;
  const areas: Position[][] = [];
  // Area-effect recipient fold: every character in `cells` except the named
  // exclusions takes ONE area-fray mutation (identity-deduplicated even for
  // multi-cell footprints — a character inside the area is hit once). No
  // side filter: "Area effect: Fray" affects every character in the area.
  const frayArea = (cells: Position[], opts: { exclude?: readonly string[] } = {}) => {
    const excluded = new Set(opts.exclude ?? []);
    for (const character of Object.values(context.state.actors)) {
      if (excluded.has(character.id) || !character.position) continue;
      // Full-footprint membership (ICON p.290 large characters), exactly one
      // area-fray instance per character even for multi-cell footprints.
      if (!footprintIntersectsCells({ position: character.position, size: character.size }, cells)) continue;
      mutations.push(damageMutation(context, character.id, source.fray, 'area'));
    }
  };
  // One complete base-Effect operation: optional recorded rush 1 (direction
  // REQUIRED when elected), then a REQUIRED player-chosen blast center whose
  // legality (on-grid, at least one cell within the effective blast range of
  // the post-rush origin, no overlap with any prior area of this use) is
  // validated BEFORE anything is emitted. Returns the position after the
  // operation's rush (the origin the NEXT invocation measures from).
  const applyEffect = (index: number, origin: Position): Position => {
    const rushKey = `effect-rush-${index}`;
    const areaKey = `effect-area-${index}`;
    let effectOrigin = { ...origin };
    let rushPath: Position[] = [];
    if (context.input.booleans?.[rushKey] === true) {
      const direction = context.input.directions?.[rushKey];
      if (!direction) {
        throw new RuleProgramViolation('choice.position-required', `Draken Cross effect ${index} rush needs a recorded direction.`);
      }
      rushPath = plannedRush(context, source.id, 1, direction, effectOrigin);
      if (rushPath.length > 0) effectOrigin = { ...rushPath[rushPath.length - 1]! };
    }
    const supplied = context.input.positions?.[areaKey]?.[0];
    if (!supplied) {
      throw new RuleProgramViolation('choice.position-required', `Draken Cross effect ${index} needs a recorded area center.`);
    }
    const blast = scaled(supplied);
    if (!blast.every((cell) => withinGrid(cell, context))) {
      throw new RuleProgramViolation('choice.position-range', `Draken Cross effect area ${index} must be fully inside the battlefield.`);
    }
    if (!areaHasCellWithinRange(blast, effectOrigin, blastRange)) {
      throw new RuleProgramViolation('choice.position-range', `Draken Cross effect area ${index} needs at least one space within range ${blastRange} of the position after its rush.`);
    }
    if (blast.some((cell) => areas.some((prior) => prior.some((first) => sameCell(cell, first))))) {
      throw new RuleProgramViolation('choice.area-overlap', `Draken Cross effect area ${index} cannot overlap an area already created by this use.`);
    }
    // Atomic: every validation passed, so now emit the recorded rush and the
    // area's recipients.
    if (rushPath.length > 0) mutations.push(rushMutation(context, source.id, rushPath));
    areas.push(blast);
    frayArea(blast);
    return effectOrigin;
  };
  // Attack (p.128): hit 2[D]+fray, miss fray, crit +1[D]. "Charge or
  // Heroic: Gains true strike" folds into the roll below; the exceed fact
  // (Talent I) reads this SAME authoritative roll.
  const trueStrike = (context.triggers?.has('charge') || context.triggers?.has('heroic')) === true;
  const roll = resolveAuthoritativeAttack(context, source, target, { trueStrike });
  mutations.push(roll.attackMutation);
  // Primary area recipients: the attack-space character gets the ATTACK
  // component instead of the area effect (p.97); everyone else in the blast
  // takes the area fray. A LARGE (Size 2+) target whose footprint straddles
  // the central attack space AND the area-only cells triggers the p.290
  // owner arbitration: the recorded U4 decision picks ONE branch, applied
  // exactly once (the ability owner never damages the target twice). A
  // missing decision fails closed.
  const primary = scaled(target.position);
  areas.push(primary);
  const targetPosition = target.position;
  const targetEligibility = recipientBranchEligibility({
    areaCells: primary.filter((cell) => !sameCell(cell, targetPosition)),
    attackSpaceCells: [targetPosition],
    actors: [{ id: target.id, position: targetPosition, size: target.size }],
  })[0];
  const recordedArea = context.input.booleans?.['target-branch-area'];
  const targetBranch = targetEligibility === undefined ? undefined
    : resolveRecipientBranch(targetEligibility, recordedArea === true ? 'area' : recordedArea === false ? 'attack' : undefined);
  if (targetBranch === 'unresolved') {
    throw new RuleProgramViolation('choice.effect-branch-required', 'Draken Cross: the large attack-space target straddles the blast — record the owner’s attack/area branch choice.');
  }
  const attackBranch = targetBranch === undefined || targetBranch === 'attack';
  if (attackBranch) {
    mutations.push(roll.hit
      ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
      : damageMutation(context, target.id, source.fray, 'miss'));
    if (roll.critical) mutations.push(damageMutation(context, target.id, context.dice.die(roll.damageDie), 'hit'));
  }
  // Attack branch: the attack-space target is excluded from the primary fray
  // (it already took the attack). Area branch: the target takes the primary
  // fray EXACTLY ONCE as its chosen branch.
  frayArea(primary, { exclude: attackBranch ? [target.id] : [] });
  // The base Effect is part of the ability — its second (REQUIRED) blast
  // resolves with the optional rush.
  let origin = applyEffect(1, source.position);
  // "Charge or Heroic: … may repeat the effect" — another complete Effect
  // operation with its own recorded rush/center, gated on the authoritative
  // Charge fact / declared Heroic AND a recorded repeat decision.
  if ((context.triggers?.has('charge') || context.triggers?.has('heroic')) && context.input.booleans?.['repeat'] === true) {
    applyEffect(2, origin);
  }
  // Talent I (p.128): "Exceed: Deal fray damage again to all characters in
  // any area created by this ability." — ALL characters, including the
  // attack-space target, once per area (areas never overlap, so once per
  // character).
  const attackMutation = roll.attackMutation as Extract<RuleMutation, { kind: 'attack' }>;
  if (attackMutation.exceed === true && (source.talents?.['demon-slayer:draken-cross'] ?? 0) >= 1) {
    for (const area of areas) frayArea(area);
  }
  return mutations;
};

/** ICON p.128: interrupt that splits determined damage with resistance and grants sturdy. */
const righteousDisdain: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const allyId = context.input.actorIds?.target?.[0];
  if (!source || !source.position || !allyId) throw new RuleProgramViolation('choice.actor-count', 'Righteous Disdain requires an ally target.');
  const ally = sourceActor(context, allyId);
  if (!ally || ally.side !== source.side || !ally.position) throw new RuleProgramViolation('choice.actor-range', 'Righteous Disdain requires an ally in range 2.');
  if (distance(source.position, ally.position) > 2) throw new RuleProgramViolation('choice.actor-range', 'Righteous Disdain requires an ally in range 2.');
  const incoming = Math.max(0, Math.floor(context.input.numbers?.damage ?? 0));
  const shared = Math.ceil(incoming / 2);
  const sturdy: RuleDuration = { kind: 'turn-end', actor: self, turns: 1 };
  const mutations: RuleMutation[] = [
    damageMutation(context, source.id, shared, 'effect'),
    damageMutation(context, ally.id, shared, 'effect'),
    conditionMutation(context, source.id, 'sturdy', 'normal', sturdy),
    conditionMutation(context, ally.id, 'sturdy', 'normal', sturdy),
  ];
  if (context.triggers?.has('heroic')) mutations.push({ kind: 'vigor', sourceId: context.sourceId, actorId: source.id, amount: 4, uncapped: false });
  return mutations;
};

/** ICON p.129: rush 1 twice, dealing 2 damage to adjacent foes (all of them when the user has not attacked this turn). */
const demonClaw: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const direction = context.input.directions?.['rush1'] ?? rushTowardFoes(context, source.position);
  const special = !source.attacked;
  // ICON p.129 Demon Claw mastery (RAGING DEMON): "Demon Claw's damage
  // increases by 1 for every 25% of your maximum hp you are missing, up to a
  // maximum of +3 damage." The missing-HP percentage is a % HEALTH
  // calculation, so p.107's rule applies: "Any ability that costs or damages
  // a certain percent of health always considers maximum BASE hp, and not
  // max hp based on wounds". The denominator (and the missing amount) is
  // therefore the BASE class maximum — never the wounds-adjusted maximum the
  // bloodied/quarter STATE thresholds use (hp-threshold kernel) — so a
  // wound's temporary max reduction counts as missing hp for the bonus. The
  // flat bonus reads the mastered gate (parent equipped AND mastered through
  // the shared hasMastery surface) and applies to every 2-damage instance
  // this ability emits.
  const baseMaximum = context.encounterState ? context.encounterState.actors[source.id]?.baseMaxHp ?? source.maxHp : source.maxHp;
  const ragingBonus = hasMastery(source, 'demon-slayer:demon-claw')
    ? Math.min(3, Math.floor((baseMaximum - source.hp) / (baseMaximum / 4)))
    : 0;
  const mutations: RuleMutation[] = [];
  const damaged = new Set<string>();
  const weakened = new Set<string>();
  // The rush 2 path comes from the shared movement authority (plannedRush →
  // walk) — never a local grid-steady loop. Each step's adjacent-foe damage
  // reads the actual cell of the recorded path.
  const rushPath = plannedRush(context, source.id, 2, direction);
  for (let index = 0; index < rushPath.length; index += 1) {
    const position = rushPath[index]!;
    mutations.push(rushMutation(context, source.id, [position]));
    const adjacentFoes = Object.values(context.state.actors)
      .filter((candidate) => candidate.id !== source.id && candidate.side !== source.side && candidate.position && distance(candidate.position, position) <= 1 && !damaged.has(candidate.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const targets = special ? adjacentFoes : adjacentFoes.slice(0, 1);
    for (const foe of targets) {
      mutations.push(damageMutation(context, foe.id, 2 + ragingBonus, 'effect'));
      damaged.add(foe.id);
    }
    if (index === 0 && (context.triggers?.has('charge') || context.triggers?.has('heroic'))) {
      for (const adjacent of Object.values(context.state.actors)) {
        if (adjacent.id === source.id || !adjacent.position || distance(adjacent.position, position) > 1 || weakened.has(adjacent.id)) continue;
        mutations.push(conditionMutation(context, adjacent.id, 'weakened'));
        weakened.add(adjacent.id);
      }
    }
  }
  return mutations;
};

/** ICON p.129: rush 2, gain vigilance, and counter until the start of the user's next turn. */
const gatesOfHell: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const direction = context.input.directions?.['rush-direction'] ?? { x: 1, y: 0 };
  const path = plannedRush(context, source.id, 2, direction);
  const mutations: RuleMutation[] = [];
  if (path.length > 0) mutations.push(rushMutation(context, source.id, path));
  const vigilance = context.triggers?.has('heroic') ? 2 : 1;
  mutations.push({ kind: 'resource', sourceId: context.sourceId, actorId: source.id, resourceId: 'vigilance', operation: 'gain', amount: vigilance, minimum: 0, maximum: null });
  mutations.push(conditionMutation(context, source.id, 'counter', 'normal', { kind: 'turn-start', actor: self, turns: 1 }));
  return mutations;
};

/** ICON p.129: may rush 2 after activating vigilance, once per turn. */
const gatesOfHellVigilanceRush: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  // The once-per-turn gate routes through the U16 `any-turn` ledger
  // (vigilanceRushOncePerTurnKey): availability via the U16 ledger read over the
  // projected state bag (ledgerAvailable), consume via the U16 consume mutation
  // riding this event. The mark reopens at every turn start via
  // refreshAnyTurnLedgersForAll — never a raw ruleState boolean.
  if (!ledgerAvailable({ ruleState: source.state }, vigilanceRushOncePerTurnKey())) throw new RuleProgramViolation('rule.turn-limit', 'The vigilance rush can only be used once a turn.');
  const direction = context.input.directions?.['rush-direction'] ?? { x: 1, y: 0 };
  const path = plannedRush(context, source.id, 2, direction);
  const mutations: RuleMutation[] = [];
  if (path.length > 0) mutations.push(rushMutation(context, source.id, path));
  mutations.push(consumeUsageMutation(context.sourceId, source.id, vigilanceRushOncePerTurnKey()));
  return mutations;
};

/** ICON p.129: enter the Soul Blade stance with a d6 power die at 2. */
const soulBladeEnter: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const adjacentFoes = Object.values(context.state.actors)
    .filter((candidate) => candidate.id !== source.id && candidate.side !== source.side && candidate.position && distance(candidate.position!, source.position!) <= 1).length;
  const bonus = context.triggers?.has('heroic') ? adjacentFoes : 0;
  const die = Math.min(6, 2 + bonus);
  return [
    { kind: 'stance', sourceId: context.sourceId, sourceActorId: source.id, operation: 'enter', actorId: source.id, stanceId: 'soul-blade', state: {} },
    stateMutation(context, source.id, 'soul-blade:die', die),
  ];
};

/** ICON p.129: refresh ticks the power die up by 1. */
const soulBladeRefresh: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source) return [];
  const die = Number(source.state['soul-blade:die'] ?? 2);
  return [
    { kind: 'stance', sourceId: context.sourceId, sourceActorId: source.id, operation: 'refresh', actorId: source.id, stanceId: 'soul-blade', state: {} },
    stateMutation(context, source.id, 'soul-blade:die', Math.min(6, die + 1)),
  ];
};

/** ICON p.129: the aether slash — a line-3 true-strike area that must include the target. */
const soulBladeSlash: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position || !target || !target.position) return [];
  const tick = Math.max(1, Math.floor(context.input.numbers?.tick ?? 0));
  const die = Number(source.state['soul-blade:die'] ?? 0);
  if (tick > die) throw new RuleProgramViolation('choice.number-maximum', `Soul Blade can only tick the die down by ${die}.`);
  const sourcePosition = source.position;
  const targetPosition = target.position;
  const direction = context.input.directions?.['slash-direction'] ?? axisDirection(sourcePosition, targetPosition);
  const line = lineCells(sourcePosition, direction, 3);
  if (!line.some((cell) => sameCell(cell, targetPosition))) {
    throw new RuleProgramViolation('choice.position-range', 'The aether slash Line 3 must include your target.');
  }
  const remaining = die - tick;
  const damage = tick === 6 ? tick + 3 : tick;
  const mutations: RuleMutation[] = [];
  for (const foe of Object.values(context.state.actors)) {
    if (foe.side === source.side || !foe.position || !line.some((cell) => sameCell(cell, foe.position!))) continue;
    mutations.push(damageMutation(context, foe.id, damage, 'area'));
  }
  if (tick >= 3) mutations.push({ kind: 'vigor', sourceId: context.sourceId, actorId: source.id, amount: remaining + (tick === 6 ? 3 : 0), uncapped: false });
  if (remaining === 0) {
    mutations.push({ kind: 'stance', sourceId: context.sourceId, sourceActorId: source.id, operation: 'exit', actorId: source.id, stanceId: 'soul-blade', state: {} });
  }
  mutations.push(stateMutation(context, source.id, 'soul-blade:die', remaining));
  return mutations;
};

/** ICON p.129: burst-2 (self) terrain effect that ends the turn and activates at the start of the user's next turn. */
const sixHellsTrigram: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  if (!source || !source.position) return [];
  const mutations: RuleMutation[] = [];
  // The area lasts until this ability is used again: remove any previous
  // trigram (and its heroic rampart) before placing the new one.
  for (const effect of context.state.terrainEffects) {
    if (effect.terrain === 'six-hells-trigram' && effect.ownerId === source.id) {
      mutations.push({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: source.id, operation: 'remove', terrain: 'six-hells-trigram', positions: [...effect.positions], height: null });
      mutations.push({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: source.id, operation: 'remove', terrain: 'rampart', positions: [...effect.positions], height: null });
    }
  }
  const area = squareArea(source.position, 2);
  mutations.push({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: source.id, operation: 'create', terrain: 'six-hells-trigram', positions: area, height: null });
  mutations.push(stateMutation(context, source.id, 'six-hells:stage', 'pending'));
  mutations.push(stateMutation(context, source.id, 'six-hells:heroic', context.triggers?.has('heroic') ? true : false));
  mutations.push(stateMutation(context, source.id, 'six-hells:slow-turn', true));
  return mutations;
};

/** ICON p.130: Wicked Sheath — rush per charge (Charge/Heroic), attack-boosting shove, and the charged-weapon state. */
const wickedSheath: RuleResolver = (context) => {
  const source = resolveSourceActor(context);
  const target = resolveAttackTarget(context);
  if (!source || !source.position) return [];
  const die = Number(source.resources['wicked-sheath-die'] ?? 0);
  const mutations: RuleMutation[] = [];
  if ((context.triggers?.has('charge') || context.triggers?.has('heroic')) && die > 0) {
    const direction = context.input.directions?.['rush-direction'] ?? { x: 1, y: 0 };
    const path = plannedRush(context, source.id, die, direction);
    if (path.length > 0) mutations.push(rushMutation(context, source.id, path));
  }
  // The shove is part of the attack step's on-hit effects ("On hit: fray
  // and shove 1"); the resolver handles the charge/heroic rush, the
  // post-attack charged-weapon state, and Talent I's extra shove.
  mutations.push(stateMutation(context, source.id, 'wicked-sheath:charged', true));
  // ICON p.130 Wicked Sheath talent 1: "Also shove your foe 1 for every
  // charge on the die." An additional shove gated on TI being equipped.
  if ((source.talents?.['demon-slayer:wicked-sheath'] ?? 0) >= 1 && die > 0 && target?.position) {
    const direction = axisDirection(source.position, target.position);
    mutations.push(shoveMutation(context, target.id, die, direction));
  }
  return mutations;
};

export const DEMON_SLAYER_RULE_RESOLVERS: RuleResolverRegistry = {
  'demon-slayer:demon-cutter:effects': demonCutterEffects,
  'demon-slayer:comet': cometEffects,
  'demon-slayer:draken-cross:effects': drakenCrossEffects,
  'demon-slayer:righteous-disdain': righteousDisdain,
  'demon-slayer:demon-claw': demonClaw,
  'demon-slayer:gates-of-hell': gatesOfHell,
  'demon-slayer:gates-of-hell:vigilance-rush': gatesOfHellVigilanceRush,
  'demon-slayer:soul-blade:enter': soulBladeEnter,
  'demon-slayer:soul-blade:refresh': soulBladeRefresh,
  'demon-slayer:soul-blade:slash': soulBladeSlash,
  'demon-slayer:six-hells-trigram': sixHellsTrigram,
  'demon-slayer:wicked-sheath': wickedSheath,
};

export const DEMON_SLAYER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'demon-slayer:demon-cutter': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'true strike', 'line'],
    range: constant(3),
    resolverId: 'demon-slayer:demon-cutter:effects',
    steps: [{
      id: 'attack', timing: 'use', effects: [{
        kind: 'attack', target: attackTarget, trueStrike: true,
        onHit: [normalDamage({ kind: 'add', values: [damageDie(1), fray()] })],
        onMiss: [normalDamage(fray(), 'miss')],
        onCritical: [normalDamage(damageDie(1))],
      }],
    }],
  })], ['effect', 'on hit', 'miss', 'effect', 'area effect', 'charge or heroic']),

  'demon-slayer:comet': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['medium blast', 'object', 'range'],
    range: constant(3),
    resolverId: 'demon-slayer:comet',
    steps: [],
  })], ['area effect', 'effect', 'object effect', 'charge or heroic']),

  'demon-slayer:draken-cross': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack', 'small blast', 'range'],
    range: constant(3),
    resolverId: 'demon-slayer:draken-cross:effects',
    // The attack roll lives in the resolver: the base attack, the
    // Charge/Heroic true strike, the crit die, and the Exceed fact (Talent I
    // re-frays every created area on the ability's own 15+ roll) all read the
    // SAME authoritative roll — the VM could never share one exceed fact
    // across the resolver's area bookkeeping.
    steps: [],
  })], ['effect', 'on hit', 'miss', 'area effect', 'effect', 'charge or heroic']),

  'demon-slayer:righteous-disdain': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: ['interrupt', 'range'],
    range: constant(2),
    resolverId: 'demon-slayer:righteous-disdain',
    steps: [],
  })], ['effect', 'trigger', 'effect', 'heroic']),

  'demon-slayer:demon-claw': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['true strike'],
    resolverId: 'demon-slayer:demon-claw',
    steps: [],
  })], ['effect', 'effect', 'special', 'charge or heroic']),

  'demon-slayer:gates-of-hell': (unit) => compilation(unit, [
    action({
      name: unit.name,
      timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: [],
      resolverId: 'demon-slayer:gates-of-hell',
      steps: [],
    }),
    action({
      id: 'vigilance-rush',
      name: 'Vigilance Rush',
      timing: 'targeted',
      costs: [],
      tags: ['movement'],
      resolverId: 'demon-slayer:gates-of-hell:vigilance-rush',
      steps: [],
    }),
  ], ['effect', 'effect', 'effect', 'heroic']),

  'demon-slayer:soul-blade': (unit) => compilation(unit, [
    action({
      name: unit.name,
      timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['stance'],
      resolverId: 'demon-slayer:soul-blade:enter',
      steps: [],
    }),
    action({
      id: 'stance-refresh',
      name: 'Refresh',
      timing: 'stance-refresh',
      costs: [],
      tags: ['stance'],
      resolverId: 'demon-slayer:soul-blade:refresh',
      steps: [],
    }),
    action({
      id: 'aether-slash',
      name: 'Aether Slash',
      timing: 'targeted',
      costs: [],
      tags: ['area'],
      range: constant(3),
      resolverId: 'demon-slayer:soul-blade:slash',
      steps: [],
    }),
  ], ['stance', 'effect', 'refresh', 'effect', 'heroic']),

  'demon-slayer:six-hells-trigram': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['end turn', 'terrain effect', 'delay'],
    resolverId: 'demon-slayer:six-hells-trigram',
    steps: [],
  })], ['effect', 'terrain effect', 'delay', 'effect', 'heroic']),

  'demon-slayer:wicked-sheath': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'true strike', 'power die'],
    resolverId: 'demon-slayer:wicked-sheath',
    steps: [{
      id: 'attack', timing: 'use', effects: [{
        kind: 'attack', target: attackTarget, trueStrike: true,
        boons: { kind: 'resource', actor: self, resourceId: 'wicked-sheath-die' },
        onHit: [
          normalDamage({ kind: 'add', values: [fray(), { kind: 'multiply', values: [damageDie(1), { kind: 'resource', actor: self, resourceId: 'wicked-sheath-die' }] }] }),
          { kind: 'move', target: attackTarget, movement: 'shove', distance: { kind: 'add', values: [constant(1), { kind: 'resource', actor: self, resourceId: 'wicked-sheath-die' }] } },
        ],
        onMiss: [normalDamage(fray(), 'miss')],
        onCritical: [normalDamage(damageDie(1))],
      }],
    }],
  })], ['effect', 'on hit', 'miss', 'effect', 'effect', 'charge or heroic']),
};
