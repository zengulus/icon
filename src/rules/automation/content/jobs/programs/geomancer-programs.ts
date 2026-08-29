import { RuleProgramViolation } from '../../../kernels/runtime.js';
import type { RuleSourceUnit } from '../../../../source-units.js';
import type { RuleExecutionContext, RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from '../../../primitives/types.js';
import { entityKindOf } from '../../../primitives/entity-kind.js';
import { footprintCells } from '../../../primitives/spatial-intent.js';
import { validateLine } from '../../../../area-geometry.js';
import {
  axisDirection, sameCell, squareArea, withinGrid, occupied,
  constant,
  distance, sourceActor, walk, freeCellsInRange, nearestFoe,
  damageMutation, conditionMutation, stateMutation, vigorMutation,
  stanceMutation, markMutation,
  shoveMutation, flyMutation, placeMutation, removeMutation, entityMutation, terrainMutation,
  summonEntity,
  action, compilation,
} from '../../../primitives/job-kit.js';
import { resolveAuthoritativeAttack } from '../../../kernels/attack-resolution.js';

/**
 * Independently reviewed Geomancer ability implementations (ICON p.215–221),
 * the second Wright job. Every ability below has typed costs, targets, ranges,
 * and tags from the source catalog plus a hand-authored typed RuleProgram and
 * a named deterministic resolver. Aether is the `aether` resource.
 *
 * Boulders, statues, and spires are `boulder` / `statue` / `magma-spire`
 * entities; pits and difficult terrain are `pit` / `difficult` terrain.
 *
 * Fidelity notes (the full source text is preserved on every event):
 * - Dragon Dive's start-of-slow-turn dive-and-erupt, Obsidian Flesh's
 *   damage-triggered die ticks and resistance, Quaking Palm's end-of-next-turn
 *   vibrations, and Terraforming's object height raises are reducer hooks
 *   documented below.
 * - Midas's statue swap is modeled at the interrupt boundary: the interrupt
 *   records the transmutation and the statue replacement, and the
 *   start-of-next-turn return is a documented turn-start window.
 * - Realignment's purge count drives the burst damage inline; the MEDICINE
 *   PALM vigor-surge and the Aftershock class trait are documented.
 */

/** Standard resolver-driven autohit attack mutation (no roll). */
const autohitAttack = (context: RuleExecutionContext): RuleMutation => ({
  kind: 'attack', sourceId: context.sourceId, actorId: context.actorId, targetId: context.attackTargetId ?? '',
  d20: null, boon: 0, total: null, hit: true, critical: false, evasionRoll: null, trueStrike: true, autoHit: true,
});

/** ICON p.218 Bio: shatter the attack target, [D]+fray on hit (fray on miss),
 * fray to the other characters in the small blast. Charge: dangerous terrain
 * in the center space and under every foe in the area. */
const bioEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [autohitAttack(context)];
  mutations.push(conditionMutation(context, target.id, 'shattered'));
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const area = squareArea(target.position, 1);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || !position || !area.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  if (context.triggers?.has('charge')) {
    const cells = [target.position];
    for (const character of Object.values(context.state.actors)) {
      const position = character.position;
      if (position && character.side !== source.side && area.some((cell) => sameCell(cell, position))) cells.push(position);
    }
    mutations.push(terrainMutation(context, 'create', 'dangerous', cells));
  }
  return mutations;
};

/** ICON p.218 Bio infuse (BIOTIC): the blast grows to a medium blast and every
 * character inside is shattered. */
const bioticEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [autohitAttack(context)];
  mutations.push(conditionMutation(context, target.id, 'shattered'));
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const area = squareArea(target.position, 2);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !area.some((cell) => sameCell(cell, position))) continue;
    if (character.id !== target.id) {
      mutations.push(conditionMutation(context, character.id, 'shattered'));
      mutations.push(damageMutation(context, character.id, source.fray, 'area'));
    }
  }
  return mutations;
};

/** ICON p.218 Dragon Dive: choose a character in range 6, end your turn, and
 * gain delay — your next turn must be slow. At the start of that turn you dive
 * into the earth and place yourself within range 3 of the character, then
 * release a burst 1 area effect (shove 1, 2 piercing). The dive is a
 * documented delay window. */
const dragonDiveEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  if (target && target.position && distance(source.position, target.position) > 6) throw new RuleProgramViolation('choice.actor-range', 'Dragon Dive requires a character in range 6.');
  return [
    stateMutation(context, source.id, 'dragon-dive:target', target?.id ?? ''),
    stateMutation(context, source.id, 'end-turn-requested', true),
  ];
};

/** ICON p.218 Geo: 2[D]+fray on hit (fray on miss), fray to the other
 * characters in the small blast, and a height 1 boulder object in a free space
 * in the area. Charge: the target explodes in a medium blast — 2 piercing again
 * to all characters and a pit under them. */
const geoEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + context.dice.die(roll.damageDie) + source.fray, 'hit')
    : damageMutation(context, target.id, source.fray, 'miss'));
  const area = squareArea(target.position, 1);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || !position || !area.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, source.fray, 'area'));
  }
  const boulder = source.position
    ? summonEntity(context, source.id, 'boulder', target.position, { radius: 1, count: 1, state: { height: 1 }, losOrigin: source.position })[0]
    : undefined;
  if (boulder) mutations.push(boulder);
  if (context.triggers?.has('charge')) {
    const blast = squareArea(target.position, 2);
    for (const character of Object.values(context.state.actors)) {
      const position = character.position;
      if (!position || !blast.some((cell) => sameCell(cell, position))) continue;
      mutations.push(damageMutation(context, character.id, 2, 'area', 'piercing'));
    }
    mutations.push(terrainMutation(context, 'create', 'pit', [target.position]));
  }
  return mutations;
};

/** ICON p.219 Helix Heel: a shockwave in a line 3 dealing 2 piercing to all
 * foes. An object at the end space extends the line by 3 (once per object),
 * and every object passed through resonates with a burst 1 area effect of 2
 * piercing. Charge: shatter any foe damaged by the ability. */
const helixHeelEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  if (!source.position) return [];
  const mutations: RuleMutation[] = [];
  const direction = context.input.directions?.line ?? { x: 1, y: 0 };
  const damaged = new Set<string>();
  const lines: { x: number; y: number }[][] = [];
  let cursor = source.position;
  let directionNow = direction;
  for (let segment = 0; segment < 8; segment += 1) {
    const cells: { x: number; y: number }[] = [];
    for (let step = 1; step <= 3; step += 1) {
      const cell = { x: cursor.x + directionNow.x * step, y: cursor.y + directionNow.y * step };
      if (!withinGrid(cell, context)) break;
      cells.push(cell);
    }
    if (cells.length === 0) break;
    lines.push(cells);
    const end = cells.at(-1)!;
    const object = Object.values(context.state.entities).find((entity) => entity.position && sameCell(entity.position, end));
    if (!object) break;
    cursor = end;
    directionNow = context.input.directions?.extend ?? directionNow;
  }
  const allCells = lines.flat();
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (!position || !allCells.some((cell) => sameCell(cell, position))) continue;
    if (character.side !== source.side) {
      mutations.push(damageMutation(context, character.id, 2, 'area', 'piercing'));
      damaged.add(character.id);
    }
  }
  for (const entity of Object.values(context.state.entities)) {
    const position = entity.position;
    if (!position || !allCells.some((cell) => sameCell(cell, position))) continue;
    const burst = squareArea(position, 1);
    for (const character of Object.values(context.state.actors)) {
      const charPosition = character.position;
      if (!charPosition || !burst.some((cell) => sameCell(cell, charPosition))) continue;
      if (character.side !== source.side) {
        mutations.push(damageMutation(context, character.id, 2, 'area', 'piercing'));
        damaged.add(character.id);
      }
    }
  }
  if (context.triggers?.has('charge')) {
    for (const id of damaged) mutations.push(conditionMutation(context, id, 'shattered'));
  }
  return mutations;
};

/** ICON p.219 Terraforming: target a burst 2 (target) area in range 6 and
 * choose two terrain effects to create there (four on a Charge):
 *   - boulders:  two height 1 boulder objects
 *   - pits:      two pits
 *   - raise:     destroy your created objects in the area OR raise the height
 *                of ANY existing object by +1 (player picks branch + objects)
 *   - difficult: a Line 3 of difficult terrain, at least one space in the area
 *   - remove:    remove chosen difficult/dangerous terrain spaces in the area
 *   - dangerous: Talent II — up to 3 spaces of dangerous terrain (selectable)
 * Each BULLET is ONE chosen effect clause that produces its full payload by
 * itself, so the choice budget counts clauses, never objects. Player input:
 *   options.effects — the chosen bullet names (exactly `count`, no repeats)
 *   options.raiseBranch — 'destroy' | 'raise' (for the raise/destroy bullet)
 *   positions.raise / positions.destroy — object cells for that branch
 *   positions.line — 3 ordered cells of the Line 3
 *   positions.remove — cells to remove (in the area)
 *   positions.dangerous — 0-3 cells for Talent II dangerous terrain
 * Talent I (Charge) expands every creation placement to cells adjacent to the
 * area; Talent II adds 'dangerous' as a selectable effect.
 */
const terraformingEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position) return [];
  const center = target?.position ?? source.position;
  if (distance(source.position, center) > 6) throw new RuleProgramViolation('choice.actor-range', 'Terraforming requires its center in range 6.');
  const gridValid = (cell: { x: number; y: number }): boolean => withinGrid(cell, context);
  const area = squareArea(center, 2).filter(gridValid);
  const inArea = (cell: { x: number; y: number }): boolean => area.some((c) => sameCell(c, cell));
  const charged = context.triggers?.has('charge');
  const count = charged ? 4 : 2;
  const hasTalentI = (source.talents?.['geomancer:terraforming'] ?? 0) >= 1;
  const hasTalentII = (source.talents?.['geomancer:terraforming'] ?? 0) >= 2;
  // Talent I: "Charge: effects can also be placed in any space adjacent to the
  // area." Only when equipped AND charged does the placement pool expand.
  const adjacentCells = charged && hasTalentI
    ? area.flatMap((cell) => [
        { x: cell.x + 1, y: cell.y }, { x: cell.x - 1, y: cell.y },
        { x: cell.x, y: cell.y + 1 }, { x: cell.x, y: cell.y - 1 },
      ]).filter((cell) => gridValid(cell) && !inArea(cell))
    : [];
  const poolCells = [...area, ...adjacentCells];
  const inPool = (cell: { x: number; y: number }): boolean => inArea(cell) || adjacentCells.some((c) => sameCell(c, cell));
  const createFree = (cell: { x: number; y: number }): boolean => inPool(cell) && !occupied(cell, context);

  const baseClauses = ['boulders', 'pits', 'raise', 'difficult', 'remove'];
  const clauses = hasTalentII ? [...baseClauses, 'dangerous'] : baseClauses;
  const raw = (context.input.options?.effects ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  const selected: string[] = [];
  for (const name of raw) {
    if (!clauses.includes(name)) throw new RuleProgramViolation('choice.effects', `Unknown Terraforming effect: ${name}`);
    if (selected.includes(name)) throw new RuleProgramViolation('choice.effects', `Terraforming cannot select the same effect more than once: ${name}`);
    selected.push(name);
  }
  if (selected.length !== count) throw new RuleProgramViolation('choice.effects', `Terraforming requires exactly ${count} distinct effects (got ${selected.length}).`);

  const pos = (key: string): { x: number; y: number }[] => {
    const value = context.input.positions?.[key];
    return Array.isArray(value) ? (value as { x: number; y: number }[]) : [];
  };
  // ICON p.219: "Effects cannot be created in spaces occupied by characters."
  // Character occupancy is the explicit forbidden case for EVERY creation
  // bullet (boulders, pits, difficult line, dangerous). It does NOT apply to
  // the REMOVE bullet (removal may target area terrain regardless of who
  // occupies the cell). Objects may still stack onto other objects (the
  // reducer enforces the ≤3 ceiling); terrain may overlap other terrain.
  // ICON Size N characters occupy an N×N footprint (p.92), so a cell is
  // character-occupied when it lies in ANY living actor's footprint — not just
  // its anchor cell. Reuses the canonical `footprintCells` authority (the same
  // helper validateEntityCreation uses); no second geometry implementation.
  const characterOccupiedAt = (cell: { x: number; y: number }): boolean =>
    Object.values(context.state.actors).some((actor) => !actor.defeated && actor.position !== null
      && footprintCells(actor.position, Math.max(1, actor.size)).some((foot) => sameCell(foot, cell)));
  const objectsAt = (cell: { x: number; y: number }) =>
    Object.values(context.state.entities).filter((entity) => entity.position !== null && sameCell(entity.position, cell) && entityKindOf(entity) === 'object');
  const mutations: RuleMutation[] = [];

  for (const name of selected) {
    if (name === 'boulders') {
      // One chosen effect producing exactly two height-1 boulders into free
      // (non-character) pool cells; the reducer stacks onto objects ≤3 and
      // rejects summons/characters.
      const cells = poolCells.filter((cell) => inPool(cell) && !characterOccupiedAt(cell)).slice(0, 2);
      if (cells.length !== 2) throw new RuleProgramViolation('choice.placement', 'Terraforming\u2019s boulders effect requires two free spaces.');
      for (const cell of cells) mutations.push(entityMutation(context, source.id, cell, 'boulder', { height: 1 }));
    } else if (name === 'pits') {
      // Exactly two pits into free (non-character) pool cells.
      const cells = poolCells.filter((cell) => inPool(cell) && !characterOccupiedAt(cell)).slice(0, 2);
      if (cells.length !== 2) throw new RuleProgramViolation('choice.placement', 'Terraforming\u2019s pits effect requires two free spaces.');
      for (const cell of cells) mutations.push(terrainMutation(context, 'create', 'pit', [cell]));
    } else if (name === 'raise') {
      // One bullet with an internal player choice: destroy your created
      // OBJECTS OR raise the height of ANY existing OBJECT by +1. Only objects
      // are affected (never summons), and a raise that pushes a cell's total
      // object height past 3 is illegal (ICON p.107) and rejected fail-closed.
      const branch = context.input.options?.raiseBranch;
      if (branch !== 'destroy' && branch !== 'raise') throw new RuleProgramViolation('choice.raise', 'Terraforming\u2019s raise/destroy effect requires options.raiseBranch of \u201cdestroy\u201d or \u201craise\u201d.');
      const chosen = pos(branch).filter(inArea);
      if (branch === 'raise') {
        for (const cell of chosen) {
          const objects = objectsAt(cell);
          if (objects.length === 0) throw new RuleProgramViolation('choice.raise', `No object to raise at (${cell.x},${cell.y}).`);
          const raiseTarget = objects[0];
          const currentTotal = objects.reduce((total, entity) => total + (Number(entity.state.height ?? 1)), 0);
          const nextHeight = Number(raiseTarget.state.height ?? 1) + 1;
          if (currentTotal + 1 > 3) throw new RuleProgramViolation('choice.raise', 'Raising this object would exceed the height ceiling of 3 (ICON p.107).');
          mutations.push({ kind: 'entity', sourceId: context.sourceId, operation: 'update', entityType: raiseTarget.type, ownerId: source.id, positions: [cell], count: 1, state: { height: nextHeight } });
        }
      } else {
        // Destroy ANY object created by you in the area (not merely boulders,
        // and never summons): group the chosen cells by the object type there.
        const byType = new Map<string, { x: number; y: number }[]>();
        for (const cell of chosen) {
          const object = objectsAt(cell).find((entity) => entity.ownerId === source.id);
          if (!object) throw new RuleProgramViolation('choice.destroy', `No object you created at (${cell.x},${cell.y}).`);
          const list = byType.get(object.type) ?? [];
          list.push(cell);
          byType.set(object.type, list);
        }
        for (const [type, cells] of byType) {
          mutations.push({ kind: 'entity', sourceId: context.sourceId, operation: 'remove', entityType: type, ownerId: source.id, positions: cells, count: cells.length, state: {} });
        }
      }
    } else if (name === 'difficult') {
      // A TRUE Line 3 (ICON p.97): orthogonal, each space strictly further
      // from the line's origin (its first space), no L-turn/backtrack/dup —
      // canonical `validateLine`, not a second validator. At least one space
      // in the burst (the line may extend outside it even without Talent I),
      // all in-grid, and none in a character-occupied space.
      const line = pos('line');
      const cells = validateLine(line, 3);
      const legal = cells !== null
        && cells.every(gridValid)
        && cells.some(inArea)
        && !cells.some(characterOccupiedAt);
      if (!legal) throw new RuleProgramViolation('choice.line', 'Terraforming\u2019s difficult effect must be a legal Line 3 (orthogonal, strictly further from its origin, no overlap) with at least one space in the area and none in a character-occupied space.');
      mutations.push(terrainMutation(context, 'create', 'difficult', cells!));
    } else if (name === 'remove') {
      // Remove ONLY the player-chosen difficult/dangerous cells in the area;
      // the reducer keeps out-of-area cells of the same multi-cell record.
      const chosen = pos('remove').filter(inArea);
      const grouped: Record<string, { x: number; y: number }[]> = { difficult: [], dangerous: [] };
      for (const cell of chosen) {
        for (const terrain of ['difficult', 'dangerous'] as const) {
          const present = context.state.terrainEffects.some((effect) => effect.terrain === terrain && effect.positions.some((p) => sameCell(p, cell)));
          if (present) grouped[terrain].push(cell);
        }
      }
      for (const terrain of ['difficult', 'dangerous'] as const) {
        if (grouped[terrain].length > 0) mutations.push(terrainMutation(context, 'remove', terrain, grouped[terrain]));
      }
    } else if (name === 'dangerous') {
      // Talent II: "create up to 3 spaces of dangerous terrain in the area as a
      // choosable effect" — a selectable bullet. Up-to-3 legal spaces; every
      // chosen space must be a legal, non-character-occupied placement or the
      // choice is rejected fail-closed (an illegal choice is never silently
      // dropped).
      const danger = pos('dangerous');
      if (danger.length > 3) throw new RuleProgramViolation('choice.dangerous', 'Terraforming\u2019s dangerous effect allows at most 3 spaces.');
      if (danger.some((cell) => !inPool(cell) || characterOccupiedAt(cell))) throw new RuleProgramViolation('choice.placement', 'Terraforming cannot create dangerous terrain in a character-occupied or out-of-pool space.');
      for (const cell of danger) mutations.push(terrainMutation(context, 'create', 'dangerous', [cell]));
    }
  }
  return mutations;
};

/** ICON p.219 Obsidian Flesh: enter the stance with a d6 power die at 1. The
 * damage-triggered ticks, resistance at 4+, and the stunned collapse are
 * documented stance windows. */
const obsidianFleshEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  return [
    stanceMutation(context, source.id, 'enter', 'obsidian-flesh'),
    stateMutation(context, source.id, 'obsidian-flesh:die', 1),
  ];
};

/** ICON p.220 Realignment: end all statuses on an adjacent character and
 * create a burst 1 area effect from them — characters inside take piercing fray
 * once for each effect purged (max 4). A foe target may also be shattered.
 * Charge: also end any marks of your choice, counting as purging an effect. */
const realignmentEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Realignment requires an adjacent character with a status.');
  if (distance(source.position, target.position) > 1) throw new RuleProgramViolation('choice.actor-range', 'Realignment requires an adjacent character.');
  const purged = target.conditions.size + (context.triggers?.has('charge') ? target.marks.length : 0);
  if (purged === 0) throw new RuleProgramViolation('choice.actor-count', 'Realignment requires a character affected by at least one status.');
  const mutations: RuleMutation[] = [];
  for (const condition of target.conditions) {
    mutations.push({ kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, conditionId: condition, operation: 'remove', potency: 'normal' });
  }
  if (context.triggers?.has('charge')) {
    for (const mark of target.marks) mutations.push({ kind: 'mark', sourceId: context.sourceId, ownerId: source.id, operation: 'remove', actorId: target.id, markId: mark.markId, state: {} });
  }
  if (target.side !== source.side) mutations.push(conditionMutation(context, target.id, 'shattered'));
  const burst = squareArea(target.position, 1);
  for (const character of Object.values(context.state.actors)) {
    const position = character.position;
    if (character.id === target.id || !position || !burst.some((cell) => sameCell(cell, position))) continue;
    mutations.push(damageMutation(context, character.id, source.fray * Math.min(4, purged), 'area', 'piercing'));
  }
  return mutations;
};

/** ICON p.220 Midas (interrupt): after the triggering ability resolves, remove
 * the character (you or a willing ally in range 5) and replace them with a
 * height 1 statue object. The start-of-next-turn return and the twice-per-
 * combat permanence are documented turn-start windows. */
const midasEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const targetId = context.input.actorIds?.target?.[0] ?? context.triggerTargetIds?.[0];
  const target = targetId ? sourceActor(context, targetId) : undefined;
  if (!source.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', 'Midas requires a character in range 5.');
  if (distance(source.position, target.position) > 5) throw new RuleProgramViolation('choice.actor-range', 'Midas requires a character in range 5.');
  const mutations: RuleMutation[] = [
    removeMutation(context, target.id),
    { kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType: 'statue', ownerId: source.id, positions: [target.position], count: 1, state: { held: target.id } },
    stateMutation(context, source.id, 'midas:used', Number(source.state['midas:used'] ?? 0) + 1),
  ];
  return mutations;
};

/** ICON p.221 Quaking Palm: [D]+1 on hit (1 on miss), the foe is vulnerable,
 * and lethal vibrations are set up in their body — when they end their next
 * turn they take 1 piercing damage for every object adjacent to them (max 4).
 * The vibration damage is a documented turn-end window. */
const quakingPalmEffects: RuleResolver = (context) => {
  const source = sourceActor(context, context.actorId);
  const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;
  if (!source.position || !target?.position) return [];
  const mutations: RuleMutation[] = [];
  const roll = resolveAuthoritativeAttack(context, source, target);
  mutations.push(roll.attackMutation);
  mutations.push(roll.hit
    ? damageMutation(context, target.id, context.dice.die(roll.damageDie) + 1, 'hit')
    : damageMutation(context, target.id, 1, 'miss'));
  mutations.push(conditionMutation(context, target.id, 'vulnerable'));
  mutations.push(markMutation(context, target.id, 'quaking-palm', {}));
  return mutations;
};

export const GEOMANCER_RULE_RESOLVERS: RuleResolverRegistry = {
  'geomancer:bio:effects': bioEffects,
  'geomancer:bio:biotic': bioticEffects,
  'geomancer:dragon-dive:effects': dragonDiveEffects,
  'geomancer:geo:effects': geoEffects,
  'geomancer:helix-heel:effects': helixHeelEffects,
  'geomancer:terraforming:effects': terraformingEffects,
  'geomancer:obsidian-flesh:effects': obsidianFleshEffects,
  'geomancer:realignment:effects': realignmentEffects,
  'geomancer:midas:effects': midasEffects,
  'geomancer:quaking-palm:effects': quakingPalmEffects,
};

export const GEOMANCER_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'geomancer:bio': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['attack', 'pierce', 'small blast', 'range'],
      range: constant(8),
      resolverId: 'geomancer:bio:effects',
      steps: [],
    }),
    action({
      id: 'infuse', name: 'BIOTIC', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(3) }],
      tags: ['attack', 'pierce', 'medium blast', 'range'],
      range: constant(8),
      resolverId: 'geomancer:bio:biotic',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'charge']),

  'geomancer:dragon-dive': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['end turn', 'delay', 'range'],
    range: constant(6),
    resolverId: 'geomancer:dragon-dive:effects',
    steps: [],
  })], ['effect', 'end turn', 'delay', 'area effect']),

  'geomancer:geo': (unit) => compilation(unit, [
    action({
      name: unit.name, timing: 'use',
      costs: [{ kind: 'action', amount: constant(2) }],
      tags: ['attack', 'arc'],
      range: constant(6),
      resolverId: 'geomancer:geo:effects',
      steps: [],
    }),
    action({
      id: 'infuse', name: 'GEOTIC', timing: 'use',
      costs: [{ kind: 'aether', amount: constant(4) }],
      tags: ['attack', 'arc'],
      resolverId: 'geomancer:geo:effects',
      steps: [],
    }),
  ], ['attack', 'on hit', 'miss', 'area effect', 'terrain effect', 'charge']),

  'geomancer:helix-heel': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['line'],
    resolverId: 'geomancer:helix-heel:effects',
    steps: [],
  })], ['area effect', 'effect', 'charge']),

  'geomancer:terraforming': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['range'],
    range: constant(6),
    resolverId: 'geomancer:terraforming:effects',
    steps: [],
  })], ['terrain effect', 'charge']),

  'geomancer:obsidian-flesh': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['stance', 'power die'],
    resolverId: 'geomancer:obsidian-flesh:effects',
    steps: [],
  })], ['stance', 'refresh']),

  'geomancer:realignment': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: [],
    resolverId: 'geomancer:realignment:effects',
    steps: [],
  })], ['effect', 'area effect', 'charge']),

  'geomancer:midas': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: ['range'],
    range: constant(5),
    resolverId: 'geomancer:midas:effects',
    steps: [],
  })], ['interrupt', 'effect']),

  'geomancer:quaking-palm': (unit) => compilation(unit, [action({
    name: unit.name, timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'pierce', 'range'],
    range: constant(3),
    resolverId: 'geomancer:quaking-palm:effects',
    steps: [],
  })], ['attack', 'on hit', 'miss', 'effect', 'charge']),
};
