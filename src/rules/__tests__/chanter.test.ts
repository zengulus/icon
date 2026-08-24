import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Chanter
 * ability set (ICON p.174–181), the first Mendicant job. Blessings are the
 * `blessing` resource, motes are `symphony-mote` terrain effects, and pits are
 * `pit` terrain effects. Cross-command lifecycles (Aria's delay blast,
 * Symphony's mote detonations, Monogatari's tales, Chastise's retribution, and
 * Gentleness's reflection) resolve through reducer hooks. Each scenario must
 * replay to the identical state through applyEvents.
 */

interface ChanterFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
  ally: EncounterActor | null;
  ally2: EncounterActor | null;
}

function chanterEncounter(options: {
  foe?: Position; second?: Position | null; ally?: Position | null; ally2?: Position | null;
} = {}): ChanterFixture {
  let state = createEncounter('Chanter fixture');
  const hero = actorFromCharacter(validCharacter('Flying Skald'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 4, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  const ally2 = options.ally2 === null || options.ally2 === undefined ? null : actorFromCharacter(validCharacter('Olin'), options.ally2);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  if (ally2) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally2 }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe, second, ally, ally2 };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

const motesOf = (state: EncounterState) => state.terrainEffects.filter((effect) => effect.terrain === 'symphony-mote');

describe('Chanter ability automation (p.174–181)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('chanter:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const chanterIds = JOBS.find((job) => job.id === 'chanter')!.abilities.map(({ id }) => id);
    expect(chanterIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Holy: pacifies the foe and cures a character in range 2 of them', () => {
    const { state, hero, foe } = chanterEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:holy', targetIds: [foe.id] }, scriptedDice());
    expect(mutationsOf(result.events, 'chanter:holy')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'pacified' },
      { kind: 'cure', actorId: hero.id },
    ]);
    expect(result.state.actors[foe.id].statuses).toContain('pacified');
    expect(result.state.actors[hero.id].vigor).toBe(4); // cured (not bloodied)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Holy: a Charge grants 3 vigor to other characters in range 2 of the foe', () => {
    const { state, hero, foe, ally } = chanterEncounter({ second: null, ally: { x: 4, y: 1 } }); // ally at range 2; the hero at range 1 takes the cure
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'chanter:holy',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
      triggers: ['charge'],
    }, scriptedDice());
    expect(result.state.actors[ally!.id].vigor).toBe(3);
  });

  it('Holy combo (HADES): autohits fray, splashes fray in the medium blast, and opens a pit', () => {
    const { state, hero, foe, second } = chanterEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'chanter:holy',
      actionId: 'combo',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice());
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(28); // 32 - fray 4
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (area)
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions[0]?.x === 3 && effect.positions[0]?.y === 1)).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Felicity: marks an ally and grants a blessing', () => {
    const { state, hero, ally } = chanterEncounter({ second: null, ally: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:felicity', targetIds: [ally!.id] }, scriptedDice());
    expect(result.state.actors[ally!.id].marks.some(({ markId, ownerId }) => markId === 'felicity' && ownerId === hero.id)).toBe(true);
    expect(result.state.actors[ally!.id].resources.blessing).toBe(1);
  });

  it('Felicity combo (FLEET): blesses an ally, flies them 4, and grants 2 vigor per character passed', () => {
    const { state, hero, foe, ally } = chanterEncounter({ foe: { x: 5, y: 1 }, second: null, ally: { x: 3, y: 1 } });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'chanter:felicity',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    expect(result.state.actors[ally!.id].resources.blessing).toBe(1);
    expect(result.state.actors[ally!.id].position).toEqual({ x: 7, y: 1 }); // flew 4 past the foe
    expect(result.state.actors[ally!.id].vigor).toBe(2); // 2 vigor for the foe passed over
    expect(result.state.actors[foe.id].position).toEqual({ x: 5, y: 1 });
  });

  it('Pandaemonium: autohits [D]+fray and rearranges every character in the medium blast', () => {
    const { state, hero, foe, second } = chanterEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:pandaemonium', targetIds: [foe.id] }, scriptedDice(4));
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - ([D] 4 + fray 4)
    const positions = [hero.id, foe.id, second!.id].map((id) => result.state.actors[id].position!);
    expect(new Set(positions.map((position) => `${position.x},${position.y}`)).size).toBe(3); // all relocated to distinct spaces
    for (const position of positions) {
      expect(Math.max(Math.abs(position.x - 3), Math.abs(position.y - 1))).toBeLessThanOrEqual(2); // still in the area
    }
  });

  it('Pandaemonium combo (PURGATORIO): autohits, splashes fray, and explodes every pit in the area', () => {
    const { state, hero, foe } = chanterEncounter({ foe: { x: 3, y: 1 }, second: null });
    state.actors[hero.id].resources.combo = 1;
    state.terrainEffects.push({ id: 'fixture-pit', sourceId: 'fixture', ownerId: hero.id, terrain: 'pit', positions: [{ x: 4, y: 1 }], height: null, duration: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'chanter:pandaemonium',
      actionId: 'combo',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(4));
    expect(result.state.actors[foe.id].hp).toBe(20); // 32 - 8 attack - 4 pit explosion
    expect(result.state.actors[hero.id].hp).toBe(40); // the caster is not hit by their own splash or pit blasts
    const pits = result.state.terrainEffects.filter((effect) => effect.terrain === 'pit');
    expect(pits.some((effect) => effect.positions[0]?.x === 4 && effect.positions[0]?.y === 1)).toBe(true); // the exploding pit stays
    expect(pits.some((effect) => effect.positions[0]?.x === 3 && effect.positions[0]?.y === 1)).toBe(true); // new pit under the target
  });

  it('Aria: ends the turn, then a small blast at the start of the slow next turn', () => {
    const { state, hero, foe } = chanterEncounter({ second: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:aria', targetIds: [] }, scriptedDice());
    expect(used.state.actors[hero.id].ruleState['aria:pending']).toBe(true);
    expect(used.state.activeActorId).toBe(foe.id); // the turn ended

    const resolved = executeCommand(used.state, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(resolved.actors[hero.id].ruleState['slow-turn']).toBe(true);
    expect(resolved.actors[foe.id].hp).toBe(24); // 32 - fray twice
    expect(resolved.actors[foe.id].statuses).toContain('sealed');
    expect(resolved.actors[foe.id].position).toEqual({ x: 3, y: 1 }); // sealed foes are shoved 1
    expect(resolved.actors[hero.id].vigor).toBe(4); // allies in the area are cured
  });

  it('Aria: taking two foe hits before the performance widens it to a large blast', () => {
    const fixture = chanterEncounter({ foe: { x: 4, y: 1 }, second: null });
    fixture.state.actors[fixture.hero.id].ruleState['aria:pending'] = true;
    fixture.state.actors[fixture.hero.id].ruleState['aria:damaged'] = 2;
    fixture.state.actors[fixture.hero.id].ruleStateOwners['aria:damaged'] = fixture.hero.id;
    const used = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'chanter:aria', targetIds: [] }, scriptedDice());
    const resolved = executeCommand(used.state, { type: 'END_TURN', actorId: fixture.foe.id }, scriptedDice()).state;
    expect(resolved.actors[fixture.foe.id].hp).toBe(24); // 32 - fray twice (large blast reaches range 3)
    expect(resolved.actors[fixture.foe.id].statuses).toContain('sealed');
  });

  it('Dervish: flies 1 and whisks an ally into a space adjacent to where you land', () => {
    const { state, hero, foe, ally } = chanterEncounter({ foe: { x: 5, y: 1 }, second: null, ally: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:dervish', targetIds: [ally!.id] }, scriptedDice());
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 }); // flew 1 toward the foe
    expect(result.state.actors[ally!.id].position).toEqual({ x: 1, y: 0 }); // whisked adjacent to the landing space
    expect(result.state.actors[ally!.id].onBattlefield).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Dervish combo (DAWN): gains an aura until the end of the next turn', () => {
    const { state, hero } = chanterEncounter({ second: null });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'chanter:dervish',
      actionId: 'combo',
      timing: 'use',
      input: {},
    }, scriptedDice());
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'dervish:dawn-aura')).toBe(true);
  });

  it('Symphony: consumes four blessings to create non-adjacent pulsing motes', () => {
    const { state, hero } = chanterEncounter({ second: null });
    state.actors[hero.id].resources.blessing = 4;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:symphony', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].resources.blessing).toBe(0);
    expect(motesOf(result.state)).toHaveLength(4);
    const cells = motesOf(result.state).flatMap((effect) => effect.positions);
    for (const first of cells) {
      for (const second of cells) {
        if (first === second) continue;
        expect(Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y))).toBeGreaterThan(1); // none adjacent
      }
    }
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Symphony: a foe that starts a turn on a mote detonates it', () => {
    const { state, hero, foe } = chanterEncounter({ foe: { x: 2, y: 1 }, second: null });
    state.actors[hero.id].resources.blessing = 4;
    const placed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:symphony', targetIds: [] }, scriptedDice()).state;
    placed.actors[foe.id].position = { x: 2, y: 0 }; // a mote cell
    const resolved = executeCommand(placed, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(resolved.actors[foe.id].hp).toBe(28); // 32 - fray 4 (the foe is in its own blast)
    expect(resolved.actors[hero.id].vigor).toBe(2); // allies in the blast gain 2 vigor
    expect(resolved.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions[0]?.x === 2 && effect.positions[0]?.y === 0)).toBe(true);
    expect(motesOf(resolved)).toHaveLength(3); // the detonated mote is removed
  });

  it('Gentleness: enters the stance, and a character that deals damage in the aura takes 1 divine', () => {
    const { state, hero, foe } = chanterEncounter({ second: null });
    const gentle = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:gentleness', targetIds: [] }, scriptedDice()).state;
    expect(gentle.actors[hero.id].stance).toMatchObject({ stanceId: 'gentleness' });

    // The hero is inside their own Gentleness aura, so the aura's +1 curse on
    // attacks (p.179) rolls a curse d6 (1) before the damage die (4).
    const attacked = executeCommand(gentle, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 1, 4)).state;
    expect(attacked.actors[foe.id].hp).toBe(24); // 32 - 8
    expect(attacked.actors[hero.id].hp).toBe(39); // 40 - 1 divine reflection (hero is in their own aura)
  });

  it('Monogatari: the tale is gambled at the end of the turn, and completing it blesses the hero', () => {
    const { state, hero, foe } = chanterEncounter({ second: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:monogatari', targetIds: [] }, scriptedDice());
    expect(used.state.actors[hero.id].ruleState['monogatari:active']).toBe(true);

    const ended = executeCommand(used.state, { type: 'END_TURN', actorId: hero.id }, scriptedDice(3)).state; // Tale of Green
    expect(ended.actors[hero.id].ruleState['monogatari:tale']).toBe(3);

    const afterFoe = executeCommand(ended, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    const blessed = executeCommand(afterFoe, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(blessed.actors[hero.id].resources.blessing).toBe(1); // did not attack -> tale complete
    expect(blessed.actors[hero.id].ruleState['monogatari:granted']).toBe(true);
  });

  it('Chastise: autohits fray, seals the foe, and marks the retribution', () => {
    const { state, hero, foe } = chanterEncounter({ foe: { x: 3, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:chastise', targetIds: [foe.id] }, scriptedDice());
    expect(mutationsOf(result.events, 'chanter:chastise')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', autoHit: true, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 4 },
      { kind: 'condition', actorId: foe.id, conditionId: 'sealed' },
      { kind: 'mark', markId: 'chastise-retribution' },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(28);
    expect(result.state.actors[foe.id].statuses).toContain('sealed');
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'chastise-retribution')).toBe(true);
  });

  it('Chastise: a marked foe that damages a chosen character takes 1 divine three times', () => {
    const { state, hero, foe } = chanterEncounter({ foe: { x: 3, y: 1 }, second: null });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:chastise', targetIds: [foe.id] }, scriptedDice()).state;
    // The foe damages the hero with an ability. The hero has an unused
    // when-damaged interrupt (Righteous Disdain, p.107/p.128), so the 2
    // piercing is held unapplied: the retribution mark has not fired yet.
    const triggered = applyEvents(marked, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-ability',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [{ kind: 'damage', sourceId: 'fixture:foe-ability', sourceActorId: foe.id, actorId: hero.id, amount: 2, damageType: 'piercing', instance: 1, delivery: 'hit', ignoreCover: false }],
    }]);
    expect(triggered.actors[hero.id].hp).toBe(40); // held, not applied
    expect(triggered.pendingInterrupts.some((window) => window.actorId === hero.id && window.heldDamage?.amount === 2)).toBe(true);
    expect(triggered.actors[foe.id].marks.find(({ markId }) => markId === 'chastise-retribution')?.state.triggered).toBeFalsy();

    // The held damage resolves at the end of the hero's turn — the foe's
    // damage now counts as applied, so the retribution triggers before the
    // foe's own turn end, where it is dealt.
    const heroTurn = executeCommand(triggered, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(heroTurn.actors[hero.id].hp).toBe(38); // 40 - 2
    expect(heroTurn.actors[foe.id].marks.find(({ markId }) => markId === 'chastise-retribution')?.state.triggered).toBe(true);

    const resolved = executeCommand(heroTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(resolved.actors[foe.id].hp).toBe(25); // 28 - 3 divine
    expect(resolved.actors[foe.id].marks.some(({ markId }) => markId === 'chastise-retribution')).toBe(false);
  });

  it('Chastise combo (CHARISM): at the foe’s next turn end, cures allies in a small blast and opens a pit with 2+', () => {
    const { state, hero, foe, ally, ally2 } = chanterEncounter({ foe: { x: 3, y: 1 }, second: null, ally: { x: 2, y: 1 }, ally2: { x: 3, y: 0 } });
    state.actors[hero.id].resources.combo = 1;
    const marked = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'chanter:chastise',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice()).state;
    expect(marked.actors[foe.id].marks.some(({ markId }) => markId === 'chastise-charism')).toBe(true);

    const heroTurn = executeCommand(marked, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    const resolved = executeCommand(heroTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(resolved.actors[ally!.id].vigor).toBe(4); // cured
    expect(resolved.actors[ally2!.id].vigor).toBe(4); // cured
    expect(resolved.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions[0]?.x === 3 && effect.positions[0]?.y === 1)).toBe(true);
    expect(resolved.actors[foe.id].marks.some(({ markId }) => markId === 'chastise-charism')).toBe(false);
  });

  describe('Symphony mote movement-entry triggers (ICON p.178)', () => {
    /** Orthogonal contiguous path from `from` to `to` (Manhattan routing). */
    function orthogonalPath(from: Position, to: Position): Position[] {
      const path: Position[] = [];
      let cx = from.x, cy = from.y;
      while (cx !== to.x) { cx += Math.sign(to.x - cx); path.push({ x: cx, y: cy }); }
      while (cy !== to.y) { cy += Math.sign(to.y - cy); path.push({ x: cx, y: cy }); }
      return path;
    }

    /** Use Symphony to create real motes, reposition the foe adjacent to the
     * first mote, and hand the turn to the foe. Returns the mote position
     * and a one-step path from the foe into the mote. */
    function symphonyMoteFixture(options: { second?: Position | null } = {}) {
      const { state: base, hero, foe } = chanterEncounter({
        foe: { x: 5, y: 1 }, second: options.second ?? { x: 8, y: 8 }, ally: null, ally2: null,
      });
      base.actors[hero.id].resources.blessing = 4;
      const placed = executeCommand(base, {
        type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:symphony', targetIds: [],
      }, scriptedDice()).state;
      const motes = motesOf(placed);
      expect(motes.length).toBeGreaterThanOrEqual(1);
      const motePos = motes[0].positions[0];
      // Reposition the foe in the state so it can reach the mote in one step.
      const adjacent: Position[] = [
        { x: motePos.x + 1, y: motePos.y }, { x: motePos.x - 1, y: motePos.y },
        { x: motePos.x, y: motePos.y + 1 }, { x: motePos.x, y: motePos.y - 1 },
      ];
      const free = adjacent.find((c) =>
        c.x >= 0 && c.y >= 0 && c.x < placed.grid.width && c.y < placed.grid.height
        && !motes.some((m) => m.positions.some((p) => p.x === c.x && p.y === c.y))
        && !Object.values(placed.actors).some((a) => a.onBattlefield && !a.defeated && a.position && a.position.x === c.x && a.position.y === c.y),
      );
      expect(free).toBeDefined();
      // Mutate the foe's position in the live state (executeCommand may copy actors).
      placed.actors[foe.id].position = { ...free! };
      const foeTurn = executeCommand(placed, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
      // The foe in the returned state may be a copy; read it back.
      const liveFoe = foeTurn.actors[foe.id];
      return { state: foeTurn, hero, foe: liveFoe, motePos, foeAdjacent: free! };
    }

    it('a foe moving into a mote space detonates it: foe takes fray, pit created, mote removed', () => {
      const { state, foe, motePos, foeAdjacent } = symphonyMoteFixture();
      const moved = executeCommand(state, {
        type: 'MOVE', actorId: foe.id, path: [motePos], mode: 'standard',
      }, scriptedDice());
      expect(moved.state.actors[foe.id].hp).toBe(28); // 32 - fray 4
      expect(motesOf(moved.state)).toHaveLength(3);
      expect(moved.state.terrainEffects.some((e) =>
        e.terrain === 'pit' && e.positions[0]?.x === motePos.x && e.positions[0]?.y === motePos.y,
      )).toBe(true);
      const detonation = moved.events.filter((e) =>
        e.type === 'RULE_MUTATIONS_APPLIED' && e.sourceId === 'chanter:symphony',
      );
      expect(detonation).toHaveLength(1);
      expect(applyEvents(state, moved.events)).toEqual(moved.state);
    });

    it('a hero moving into a mote space detonates it: hero blessed + flies 1, no pit', () => {
      // Create a fresh encounter where the hero is adjacent to a mote.
      let state = createEncounter('Hero mote entry');
      const hero = actorFromCharacter(validCharacter('Flying Skald'), { x: 1, y: 1 });
      hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
      hero.chapter = 3;
      const foe = createFoe('Relict', { x: 8, y: 8 });
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
      state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
      // Set blessings AFTER start (START_ENCOUNTER resets per-encounter resources).
      state.actors[hero.id].resources.blessing = 4;
      // Place a mote at (2,1) — adjacent to the hero at (1,1).
      state.terrainEffects.push({
        id: 'hero-test-mote:1', sourceId: 'chanter:symphony', ownerId: hero.id,
        terrain: 'symphony-mote', positions: [{ x: 2, y: 1 }], height: null, duration: null,
      });
      // Hero moves into the mote.
      const moved = executeCommand(state, {
        type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }], mode: 'standard',
      }, scriptedDice());
      expect(motesOf(moved.state)).toHaveLength(0);
      const heroActor = moved.state.actors[hero.id];
      expect(heroActor.resources.blessing).toBe(5); // 4 base + 1 from detonation
      // Hero flew 1 toward the nearest foe from the mote position.
      expect(heroActor.position).not.toEqual({ x: 2, y: 1 }); // no longer at the mote
      expect(moved.state.terrainEffects.some((e) => e.terrain === 'pit')).toBe(false);
      expect(applyEvents(state, moved.events)).toEqual(moved.state);
    });

    it('a multi-cell path through a mote detonates it exactly once', () => {
      const { state, foe, motePos, foeAdjacent } = symphonyMoteFixture();
      const moved = executeCommand(state, {
        type: 'MOVE', actorId: foe.id,
        path: [motePos, foeAdjacent],
        mode: 'standard',
      }, scriptedDice());
      const detonations = moved.events.filter((e) =>
        e.type === 'RULE_MUTATIONS_APPLIED' && e.sourceId === 'chanter:symphony',
      );
      expect(detonations).toHaveLength(1);
      expect(motesOf(moved.state)).toHaveLength(3);
      expect(applyEvents(state, moved.events)).toEqual(moved.state);
    });

    it('movement that does not enter a mote space does not detonate (closed negative)', () => {
      // Create a fresh encounter with a foe far from any motes.
      let state = createEncounter('Mote negative test');
      const hero = actorFromCharacter(validCharacter('Flying Skald'), { x: 1, y: 1 });
      hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
      hero.chapter = 3;
      const foe = createFoe('Relict', { x: 9, y: 9 });
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
      state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
      // Place a mote far from the foe.
      state.terrainEffects.push({
        id: 'neg-mote:1', sourceId: 'chanter:symphony', ownerId: hero.id,
        terrain: 'symphony-mote', positions: [{ x: 1, y: 2 }], height: null, duration: null,
      });
      // End the hero's turn so the foe becomes active.
      state = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
      // Foe at (9,9) moves one step — not entering any mote.
      const moved = executeCommand(state, {
        type: 'MOVE', actorId: foe.id, path: [{ x: 9, y: 8 }], mode: 'standard',
      }, scriptedDice());
      expect(motesOf(moved.state)).toHaveLength(1);
      expect(moved.state.actors[foe.id].hp).toBe(32);
      expect(applyEvents(state, moved.events)).toEqual(moved.state);
    });

    it('the turn-start lifecycle hook is a no-op when the mote was consumed by entry', () => {
      const { state, foe, motePos } = symphonyMoteFixture();
      const moved = executeCommand(state, {
        type: 'MOVE', actorId: foe.id, path: [motePos], mode: 'standard',
      }, scriptedDice()).state;
      expect(motesOf(moved)).toHaveLength(3);
      const afterTurn = executeCommand(moved, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
      expect(afterTurn.actors[foe.id].hp).toBe(28);
    });
  });
});
