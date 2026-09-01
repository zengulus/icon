import { describe, expect, it } from 'vitest';
import type { DiceSource } from '../dice.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterCommand, EncounterEvent, EncounterState, Position } from '../types.js';
import '../automation/content/registry.js';
import { arcCells, cellKey, lineCells, squareArea } from '../area-geometry.js';
import { effectiveAreaFor, type AreaStateView } from '../automation/kernels/area.js';
import type { RuleMutation } from '../automation/primitives/types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';
import { turnEligibleActorIds } from '../turn-scheduler.js';

/** The shove mutations inside an ability's recorded mutation stream. */
const shoveMutations = (mutations: readonly RuleMutation[]) =>
  mutations.filter((m) => m.kind === 'move' && m.movement === 'shove') as Extract<RuleMutation, { kind: 'move' }>[];

/**
 * Area fixtures (docs/rules-foundations.md §Area).
 *
 * The area kernel is the shared authority for ICON's p.97 AoE patterns: the
 * geometry module owns the deterministic pattern math (line cells, arc path
 * validation, the three exact Blast templates, burst squares), and the kernel
 * folds registered area modifiers (shape/length overrides under
 * round/talent/mastery gates) into an EFFECTIVE area descriptor that the
 * parent resolver reads at command time — the same discipline as the range
 * kernel. Every test here uses a shape with exact source authority (line,
 * arc, burst squares, or the encoded Blast templates in `blastTemplateCells`).
 */

interface AreaFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
}

/** A bare-bones area view for the kernel unit tests (round + actor reads). */
const view = (overrides: { round?: number; hp?: number; maximumHp?: number; talents?: Record<string, 1 | 2>; mastered?: string[]; conditions?: string[] } = {}): AreaStateView => ({
  round: overrides.round ?? 1,
  actor: {
    hp: overrides.hp ?? 40,
    maximumHp: overrides.maximumHp ?? 40,
    abilityIds: ['spellblade:sturmreiten', 'freelancer:soul-shot'],
    masteredAbilityIds: overrides.mastered ?? [],
    talents: overrides.talents ?? {},
    conditions: new Set(overrides.conditions ?? []),
  },
});

describe('Area geometry — Arc paths (ICON p.97)', () => {
  it('a legal orthogonal arc with turns returns the exact cells in order', () => {
    const start = { x: 1, y: 1 };
    const path = [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }];
    expect(arcCells(start, path)).toEqual(path);
  });

  it('a straight orthogonal arc is legal and exactly its length', () => {
    const start = { x: 1, y: 1 };
    const path = [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 1, y: 5 }, { x: 1, y: 6 }];
    expect(arcCells(start, path)).toHaveLength(5);
  });

  it('rejects a diagonal step', () => {
    const start = { x: 1, y: 1 };
    const path = [{ x: 2, y: 2 }]; // dx+dy = 2 — a diagonal
    expect(arcCells(start, path)).toBeNull();
  });

  it('rejects a non-contiguous jump (skips a space)', () => {
    const start = { x: 1, y: 1 };
    const path = [{ x: 1, y: 2 }, { x: 1, y: 4 }]; // 1,3 skipped
    expect(arcCells(start, path)).toBeNull();
  });

  it('rejects self-overlap', () => {
    const start = { x: 1, y: 1 };
    const path = [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 1, y: 2 }]; // back onto an earlier cell
    expect(arcCells(start, path)).toBeNull();
  });

  it('rejects a path that enters the ability user\u2019s own space', () => {
    const start = { x: 1, y: 1 };
    const path = [{ x: 1, y: 2 }, { x: 1, y: 1 }]; // returns to the origin
    expect(arcCells(start, path)).toBeNull();
  });

  it('rejects an empty path and a standing-still step', () => {
    expect(arcCells({ x: 1, y: 1 }, [])).toBeNull();
    expect(arcCells({ x: 1, y: 1 }, [{ x: 1, y: 1 }])).toBeNull();
  });

  it('an arc path that would overlap the origin is rejected even mid-path', () => {
    const start = { x: 1, y: 1 };
    const path = [{ x: 1, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 1 }];
    expect(arcCells(start, path)).toBeNull();
  });
});

describe('Area modifier authority (effectiveAreaFor)', () => {
  it('returns the base descriptor unchanged when no rule applies', () => {
    expect(effectiveAreaFor(view(), 'hero', 'unrelated:ability', 'line', 3)).toEqual({ shape: 'line', length: 3 });
    expect(effectiveAreaFor(view(), 'hero', 'unrelated:ability', 'arc', 5)).toEqual({ shape: 'arc', length: 5 });
  });

  it('Soul Shot talent 2: line 3, and only line 6 from round 4 with the talent selected', () => {
    const base = { round: 1, actor: { hp: 40, maximumHp: 40, abilityIds: ['freelancer:soul-shot'], masteredAbilityIds: [], talents: { 'freelancer:soul-shot': 2 as const }, conditions: new Set<string>() } };
    // Round 1: the round gate does not hold — stays line 3.
    expect(effectiveAreaFor(base, 'hero', 'freelancer:soul-shot', 'line', 3)).toEqual({ shape: 'line', length: 3 });
    // Round 4: the override applies.
    expect(effectiveAreaFor({ ...base, round: 4 }, 'hero', 'freelancer:soul-shot', 'line', 3)).toEqual({ shape: 'line', length: 6 });
    // Without the talent selected, even at round 4 the base stays.
    const unselected = { round: 4, actor: { hp: 40, maximumHp: 40, abilityIds: ['freelancer:soul-shot'], masteredAbilityIds: [], talents: {}, conditions: new Set<string>() } };
    expect(effectiveAreaFor(unselected, 'hero', 'freelancer:soul-shot', 'line', 3)).toEqual({ shape: 'line', length: 3 });
  });

  it('Sturmreiten mastery: line 3 without the mastery, arc 5 with it', () => {
    expect(effectiveAreaFor(view(), 'hero', 'spellblade:sturmreiten', 'line', 3)).toEqual({ shape: 'line', length: 3 });
    const mastered = view({ mastered: ['spellblade:sturmreiten'] });
    expect(effectiveAreaFor(mastered, 'hero', 'spellblade:sturmreiten', 'line', 3)).toEqual({ shape: 'arc', length: 5 });
  });

  it('a mastery of another ability never changes this ability\u2019s area', () => {
    const other = view({ mastered: ['freelancer:soul-shot'] });
    expect(effectiveAreaFor(other, 'hero', 'spellblade:sturmreiten', 'line', 3)).toEqual({ shape: 'line', length: 3 });
  });

  it('the round gate is evaluated against current state — it reverts when the round passes back', () => {
    const talents = { 'freelancer:soul-shot': 2 as const };
    expect(effectiveAreaFor(view({ round: 3, talents }), 'hero', 'freelancer:soul-shot', 'line', 3).length).toBe(3);
    expect(effectiveAreaFor(view({ round: 4, talents }), 'hero', 'freelancer:soul-shot', 'line', 3).length).toBe(6);
    expect(effectiveAreaFor(view({ round: 5, talents }), 'hero', 'freelancer:soul-shot', 'line', 3).length).toBe(6);
  });
});

/** End every actor's turn in insertion order, advancing through the round.
 * Each boundary leaves the scheduler awaiting a controller choice, so the
 * fixture explicitly selects the next actor in insertion order (ICON p.87). */
function endAllTurns(state: EncounterState, dice = scriptedDice()): EncounterState {
  let next = state;
  for (const id of Object.keys(state.actors)) {
    if (next.activeActorId !== id) {
      if (next.activeActorId !== null) next = executeCommand(next, { type: 'END_TURN', actorId: next.activeActorId }, dice).state;
      const eligible = turnEligibleActorIds(next);
      if (!eligible.includes(id)) throw new Error('endAllTurns: ' + id + ' is not eligible here.');
      next = executeCommand(next, { type: 'TAKE_TURN', actorId: id }, dice).state;
    }
    next = executeCommand(next, { type: 'END_TURN', actorId: id }, dice).state;
  }
  return next;
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

function freelancerAreaEncounter(options: { heroAt?: Position; foeAt?: Position; secondAt?: Position | null; talents?: Record<string, 1 | 2> } = {}): AreaFixture {
  let state = createEncounter('Soul Shot fixture');
  const hero = actorFromCharacter(validCharacter('Deadeye'), options.heroAt ?? { x: 1, y: 1 });
  hero.abilityIds = ['freelancer:soul-shot'];
  hero.chapter = 3;
  hero.talents = { ...(options.talents ?? {}) };
  const foe = createFoe('Relict', options.foeAt ?? { x: 4, y: 1 });
  const second = options.secondAt === null ? null : createFoe('Grim', options.secondAt ?? { x: 3, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second };
}

describe('Soul Shot talent 2 — the effective line feeds target legality (p.158)', () => {
  it('without the talent, the attack target must lie in the line 3 (regression)', () => {
    const { state, hero, foe } = freelancerAreaEncounter({ foeAt: { x: 5, y: 1 } }); // distance 4 — outside line 3
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:soul-shot', targetIds: [foe.id],
    }, scriptedDice(10, 1, 1))).toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });

  it('with talent 2 at round 1, the line is still 3 — a distance-4 target is rejected', () => {
    const { state, hero, foe } = freelancerAreaEncounter({
      foeAt: { x: 5, y: 1 }, talents: { 'freelancer:soul-shot': 2 },
    });
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:soul-shot', targetIds: [foe.id],
    }, scriptedDice(10, 1, 1))).toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });

  it('from round 4, the extended line 6 makes a distance-4 target legal and the attack lands', () => {
    let state = endAllTurns(freelancerAreaEncounter({
      foeAt: { x: 5, y: 1 }, talents: { 'freelancer:soul-shot': 2 },
    }).state); // round 2
    state = endAllTurns(state); // round 3
    state = endAllTurns(state); // round 4 (awaiting the player side's choice)
    const hero = state.actors[Object.keys(state.actors).find((id) => state.actors[id].side === 'heroes')!];
    const foe = state.actors[Object.keys(state.actors).find((id) => state.actors[id].side === 'foes')!];
    state = executeCommand(state, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:soul-shot', targetIds: [foe.id],
    }, scriptedDice(10, 1, 1));
    expect(result.state.actors[foe.id].hp).toBeLessThan(32); // the attack resolved
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('beyond the effective line 6, the target is rejected even at round 4', () => {
    let state = endAllTurns(freelancerAreaEncounter({
      foeAt: { x: 8, y: 1 }, talents: { 'freelancer:soul-shot': 2 },
    }).state);
    state = endAllTurns(state);
    state = endAllTurns(state); // round 4 (awaiting the player side's choice)
    const hero = state.actors[Object.keys(state.actors).find((id) => state.actors[id].side === 'heroes')!];
    const foe = state.actors[Object.keys(state.actors).find((id) => state.actors[id].side === 'foes')!];
    state = executeCommand(state, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:soul-shot', targetIds: [foe.id],
    }, scriptedDice(10, 1, 1))).toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });
});

function spellbladeAreaEncounter(options: { heroAt?: Position; foeAt?: Position; mastered?: string[] } = {}): AreaFixture {
  let state = createEncounter('Sturmreiten fixture');
  const hero = actorFromCharacter(validCharacter('Aether Duelist'), options.heroAt ?? { x: 1, y: 1 });
  hero.abilityIds = ['spellblade:sturmreiten'];
  hero.chapter = 3;
  hero.masteredAbilityIds = [...(options.mastered ?? [])];
  const foe = createFoe('Relict', options.foeAt ?? { x: 2, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second: null };
}

describe('Sturmreiten mastery (MJÖLLNIR) — the arc 5 is a chosen path, never an approximation (p.227)', () => {
  it('without the mastery, Sturmreiten stays a line 3 (regression)', () => {
    const { state, hero, foe } = spellbladeAreaEncounter({ foeAt: { x: 3, y: 1 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:sturmreiten',
      actionId: 'default',
      timing: 'interrupt',
      input: { directions: { line: { x: 1, y: 0 } } },
    }, scriptedDice());
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 1 }); // end of line 3
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2 piercing
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('with the mastery, the chosen arc path is validated, teleports to its end, and pierces characters in it', () => {
    const { state, hero, foe } = spellbladeAreaEncounter({
      foeAt: { x: 2, y: 3 }, mastered: ['spellblade:sturmreiten'],
    });
    // Arc 5 from (1,1): up, right, up, right, right — a twisting path.
    const path = [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }];
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:sturmreiten',
      actionId: 'default',
      timing: 'interrupt',
      input: { positions: { 'arc-path': path } },
    }, scriptedDice());
    // Teleports to the arc's end, and the foe standing at arc cell (2,3) took
    // 2 piercing (32 → 30). The chosen path survives replay.
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 3 });
    expect(result.state.actors[foe.id].hp).toBe(30);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('an illegal path (diagonal step) is rejected as a RuleProgramViolation', () => {
    const { state, hero } = spellbladeAreaEncounter({ mastered: ['spellblade:sturmreiten'] });
    const diagonal = [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }];
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:sturmreiten',
      actionId: 'default',
      timing: 'interrupt',
      input: { positions: { 'arc-path': diagonal } },
    }, scriptedDice())).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
  });

  it('a self-overlapping path is rejected', () => {
    const { state, hero } = spellbladeAreaEncounter({ mastered: ['spellblade:sturmreiten'] });
    const overlapping = [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 2 }, { x: 1, y: 2 }];
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:sturmreiten',
      actionId: 'default',
      timing: 'interrupt',
      input: { positions: { 'arc-path': overlapping } },
    }, scriptedDice())).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
  });

  it('a path that is not exactly arc 5 is rejected (position-count)', () => {
    const { state, hero } = spellbladeAreaEncounter({ mastered: ['spellblade:sturmreiten'] });
    const tooShort = [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }];
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:sturmreiten',
      actionId: 'default',
      timing: 'interrupt',
      input: { positions: { 'arc-path': tooShort } },
    }, scriptedDice())).toThrowError(expect.objectContaining({ code: 'choice.position-count' }));
  });
});

function enochianAreaEncounter(options: { foeAt?: Position; secondAt?: Position | null; talents?: Record<string, 1 | 2> } = {}): AreaFixture {
  let state = createEncounter('Pyre fixture');
  const hero = actorFromCharacter(validCharacter('Pyromancer'), { x: 1, y: 1 });
  hero.abilityIds = ['enochian:pyre'];
  hero.chapter = 3;
  hero.talents = { ...(options.talents ?? {}) };
  const foe = createFoe('Relict', options.foeAt ?? { x: 3, y: 1 });
  const second = options.secondAt === null ? null : createFoe('Grim', options.secondAt ?? { x: 3, y: 2 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second };
}

describe('Pyre talent 2 — Exceed shoves the blast area (p.209)', () => {
  it('without the talent, an Exceed re-explosion shoves nothing (regression)', () => {
    const { state, hero, foe, second } = enochianAreaEncounter({});
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:pyre', targetIds: [foe.id],
    }, scriptedDice(15, 4, 4)); // d20 15 → exceed
    expect(result.state.actors[foe.id].position).toEqual({ x: 3, y: 1 }); // not shoved
    expect(result.state.actors[second!.id].position).toEqual({ x: 3, y: 2 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('with talent 2, an Exceed shoves the attack target and every blast-area character 2 away from the user', () => {
    const { state, hero, foe, second } = enochianAreaEncounter({ talents: { 'enochian:pyre': 2 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:pyre', targetIds: [foe.id],
    }, scriptedDice(15, 4, 4)); // d20 15 → exceed fires the talent's shove
    const shoves = shoveMutations(mutationsOf(result.events, 'enochian:pyre'));
    expect(shoves.length).toBeGreaterThanOrEqual(2);
    const foeShove = shoves.find((s) => s.actorId === foe.id);
    expect(foeShove).toMatchObject({ distance: 2, direction: { x: 1, y: 0 } }); // away from (1,1)
    const secondShove = shoves.find((s) => s.actorId === second!.id);
    expect(secondShove).toMatchObject({ distance: 2, direction: { x: 1, y: 0 } });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('an Exceed without any area characters still shoves only the attack target', () => {
    const { state, hero, foe } = enochianAreaEncounter({ secondAt: null, talents: { 'enochian:pyre': 2 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:pyre', targetIds: [foe.id],
    }, scriptedDice(15, 4, 4));
    const shoves = shoveMutations(mutationsOf(result.events, 'enochian:pyre'));
    expect(shoves).toHaveLength(1);
    expect(shoves[0]).toMatchObject({ actorId: foe.id, distance: 2 });
  });
});

describe('Eye Of The Storm — retracted with its talent 2 (p.236)', () => {
  it('the ability and talent 2 are unresolved: the ally-center fly-4 is a free player-chosen flight', () => {
    // ICON p.236: "If an ally is in the center space, they may fly 4 after
    // the ability resolves" — a player-chosen flight the engine cannot
    // represent yet (the old "away from the nearest foe" direction invented
    // a rule). The ability and its program-level talent 2 (piercing per area
    // character) are retracted together (manual-programs.ts
    // DOCUMENTED_NON_EXECUTABLE), so neither USE_ABILITY nor EXECUTE_RULE
    // may run the program.
    let state = createEncounter('Eye Of The Storm retraction fixture');
    const hero = actorFromCharacter(validCharacter('Stormbinder'), { x: 1, y: 4 });
    hero.abilityIds = ['stormbender:eye-of-the-storm'];
    hero.chapter = 3;
    hero.talents = { 'stormbender:eye-of-the-storm': 2 };
    const center = createFoe('Relict', { x: 3, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: center }).state;
    state = startEncounterTo(state, hero.id);
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'stormbender:eye-of-the-storm',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [center.id] } },
    }, scriptedDice(4))).toThrow('does not have an independently verified RuleProgram implementation');
  });
});
