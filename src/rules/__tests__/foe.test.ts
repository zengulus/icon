import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_FOE_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { FOE_ABILITY_RECIPES } from '../automation/content/foes/ability-recipes.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand } from '../encounter.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter, endTurnTo, startEncounterTo } from './fixtures.js';

/**
 * Source-derived golden fixtures for the recipe-driven foe ability slices
 * (ICON p.300–306: Crusher, Warrior, Soldier, Brute, Pepperbox, Hunter,
 * Cantrix, and Chaos Wright).
 * Every ability below is one declarative FoeRecipe in
 * `automation/foe-recipes.ts` — the generic factories resolve it — and each
 * scenario resolves through the shared encounter reducer and must replay to
 * the identical state through `applyEvents`.
 *
 * Foe abilities execute through EXECUTE_RULE (the same generic VM the job
 * sub-actions use), so each fixture hands the turn to the foe with END_TURN
 * and strips the hero's when-damaged/defeated interrupts so the foe blow
 * applies instead of being held by the p.107 interrupt protocol.
 */

interface FoeLayout {
  foe: Position;
  hero: Position;
  /** Extra actors added after the main foe so it receives the turn. */
  extras?: Array<{ kind: 'hero' | 'foe'; at: Position }>;
}

interface FoeFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  extras: EncounterActor[];
}

function foeFixture(profileId: string, layout: FoeLayout): FoeFixture {
  let state = createEncounter('Foe fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), layout.hero);
  // Foe damage must apply in fixtures: strip the when-damaged (p.128) and
  // defeated (p.138) interrupts that would otherwise hold every foe blow.
  hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
  // Drop the Stalwart Fortify trait so its projected rampart (p.116, p.104)
  // does not block the foe's own rushes/dashes into melee — the recipes under
  // test are the foe moves, not the defensive rampart.
  hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
  const foe = createFoeFromProfile(profileId, layout.foe);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  const extras: EncounterActor[] = [];
  for (const item of layout.extras ?? []) {
    const extra = item.kind === 'hero'
      ? actorFromCharacter(validCharacter(`Ally ${extras.length + 1}`), item.at)
      : createFoeFromProfile(profileId, item.at);
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: extra }).state;
    extras.push(extra);
  }
  state = startEncounterTo(state, hero.id);
  // The hero starts; END_TURN hands the turn to the first foe.
  state = endTurnTo(state, foe.id, scriptedDice());
  return { state, hero, foe, extras };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

/** EXECUTE_RULE through the same command surface the VTT/transport use. */
function foeAbility(state: EncounterState, fixture: FoeFixture, abilityId: string, options: { targetId?: string; dice?: number[]; positions?: Record<string, Position[]> } = {}) {
  return executeCommand(state, {
    type: 'EXECUTE_RULE',
    actorId: fixture.foe.id,
    sourceId: abilityId,
    actionId: 'default',
    timing: 'use',
    input: { ...(options.targetId ? { actorIds: { target: [options.targetId] } } : {}), positions: options.positions },
    ...(options.targetId && abilityIsAttack(abilityId) ? { attackTargetId: options.targetId } : {}),
  }, scriptedDice(...(options.dice ?? [])));
}

function abilityIsAttack(abilityId: string) {
  return findRuleSourceUnit(abilityId)?.metadata.tags?.toString().includes('attack') ?? false;
}

describe('foe ability automation (p.300–306 recipes)', () => {
  it('marks every reviewed foe ability executable in the catalog and audit', () => {
    expect(Object.keys(FOE_ABILITY_RECIPES)).toHaveLength(22);
    for (const abilityId of EXECUTABLE_FOE_ABILITY_IDS) {
      const unit = findRuleSourceUnit(abilityId)!;
      expect(unit.kind).toBe('foe-ability');
      expect(FOE_ABILITY_RECIPES[abilityId]).toBeDefined();
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
  });

  it('Crusher Headbutt: true-strike attack, weakened on hit, [D]+fray', () => {
    const fixture = foeFixture('basic:crusher:301', { foe: { x: 1, y: 1 }, hero: { x: 2, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:crusher:301:headbutt', { targetId: fixture.hero.id, dice: [12, 3] });
    expect(mutationsOf(result.events, 'basic:crusher:301:headbutt')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 12, total: 12, hit: true, trueStrike: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: 7, delivery: 'hit' },
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'weakened' },
    ]);
    expect(result.state.actors[fixture.hero.id].hp).toBe(35); // 40 - (3 + fray 4 - armor 2)
    expect(result.state.actors[fixture.hero.id].statuses).toContain('weakened');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Crusher Headbutt: bonus damage die (keep highest) against weakened foes (p.102)', () => {
    const fixture = foeFixture('basic:crusher:301', { foe: { x: 1, y: 1 }, hero: { x: 2, y: 1 } });
    fixture.state.actors[fixture.hero.id].statuses.push('weakened');
    const result = foeAbility(fixture.state, fixture, 'basic:crusher:301:headbutt', { targetId: fixture.hero.id, dice: [12, 3, 2, 5] });
    expect(mutationsOf(result.events, 'basic:crusher:301:headbutt')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: 12 }, // die 3 + fray 4 + max(2,5)
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'weakened' },
    ]);
    expect(result.state.actors[fixture.hero.id].hp).toBe(30); // 40 - (12 - armor 2)
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Crusher Mighty Blow: 2 damage and a shove 1', () => {
    const fixture = foeFixture('basic:crusher:301', { foe: { x: 1, y: 1 }, hero: { x: 2, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:crusher:301:mighty-blow', { targetId: fixture.hero.id });
    expect(mutationsOf(result.events, 'basic:crusher:301:mighty-blow')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'damage', actorId: fixture.hero.id, amount: 2, delivery: 'effect' },
      { kind: 'move', actorId: fixture.hero.id, movement: 'shove', distance: 1, direction: { x: 1, y: 0 } },
    ]);
    expect(result.state.actors[fixture.hero.id].position).toEqual({ x: 3, y: 1 }); // armor 2 absorbs the damage
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Crusher Grapple: marks an adjacent foe', () => {
    const fixture = foeFixture('basic:crusher:301', { foe: { x: 1, y: 1 }, hero: { x: 2, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:crusher:301:grapple', { targetId: fixture.hero.id });
    expect(mutationsOf(result.events, 'basic:crusher:301:grapple')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'mark', actorId: fixture.hero.id, markId: 'crusher:grapple', ownerId: fixture.foe.id },
    ]);
    expect(result.state.actors[fixture.hero.id].marks.some(({ markId, ownerId }) => markId === 'crusher:grapple' && ownerId === fixture.foe.id)).toBe(true);
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Warrior Redondo (free action): swaps places with an adjacent ally', () => {
    const fixture = foeFixture('basic:warrior:300', {
      foe: { x: 1, y: 1 }, hero: { x: 5, y: 5 },
      extras: [{ kind: 'foe', at: { x: 2, y: 1 } }],
    });
    const result = foeAbility(fixture.state, fixture, 'basic:warrior:300:redondo', { targetId: fixture.extras[0].id });
    expect(mutationsOf(result.events, 'basic:warrior:300:redondo')).toMatchObject([
      { kind: 'move', actorId: fixture.foe.id, movement: 'place' },
      { kind: 'move', actorId: fixture.extras[0].id, movement: 'place' },
    ]);
    expect(result.state.actors[fixture.foe.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[fixture.extras[0].id].position).toEqual({ x: 1, y: 1 });
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Warrior Cleave: 2[D]+fray attack and fray splash to adjacent foes', () => {
    const fixture = foeFixture('basic:warrior:300', {
      foe: { x: 1, y: 1 }, hero: { x: 2, y: 1 },
      extras: [{ kind: 'hero', at: { x: 3, y: 1 } }],
    });
    const result = foeAbility(fixture.state, fixture, 'basic:warrior:300:cleave', { targetId: fixture.hero.id, dice: [12, 3, 4] });
    expect(mutationsOf(result.events, 'basic:warrior:300:cleave')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', hit: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: 11, delivery: 'hit' },
      { kind: 'damage', actorId: fixture.hero.id, amount: 4, delivery: 'area' },
      { kind: 'damage', actorId: fixture.extras[0].id, amount: 4, delivery: 'area' },
    ]);
    expect(result.state.actors[fixture.hero.id].hp).toBe(29); // 40 - (11-2) - (4-2)
    expect(result.state.actors[fixture.extras[0].id].hp).toBe(38); // 40 - (4-2)
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Warrior Bull rush: rushes 1 and weakens the adjacent character it reaches', () => {
    const fixture = foeFixture('basic:warrior:300', { foe: { x: 1, y: 1 }, hero: { x: 3, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:warrior:300:bull-rush');
    expect(mutationsOf(result.events, 'basic:warrior:300:bull-rush')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: fixture.foe.id, movement: 'rush' },
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'weakened' },
    ]);
    expect(result.state.actors[fixture.foe.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[fixture.hero.id].statuses).toContain('weakened');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Soldier Slash: true-strike attack that slashes, and a critical adds a die', () => {
    const fixture = foeFixture('basic:soldier:300', { foe: { x: 1, y: 1 }, hero: { x: 2, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:soldier:300:slash', { targetId: fixture.hero.id, dice: [20, 3, 4] });
    expect(mutationsOf(result.events, 'basic:soldier:300:slash')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 20, hit: true, critical: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: 7, delivery: 'hit' },
      { kind: 'damage', actorId: fixture.hero.id, amount: 4, delivery: 'hit' },
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'slashed' },
    ]);
    expect(result.state.actors[fixture.hero.id].hp).toBe(33); // 40 - (7-2) - (4-2)
    expect(result.state.actors[fixture.hero.id].statuses).toContain('slashed');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Soldier Bash: shoves an adjacent foe 2', () => {
    const fixture = foeFixture('basic:soldier:300', { foe: { x: 1, y: 1 }, hero: { x: 2, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:soldier:300:bash', { targetId: fixture.hero.id });
    expect(result.state.actors[fixture.hero.id].position).toEqual({ x: 4, y: 1 });
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Soldier Valiant: rushes up to 4 toward the nearest foe', () => {
    const fixture = foeFixture('basic:soldier:300', { foe: { x: 1, y: 1 }, hero: { x: 6, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:soldier:300:valiant');
    expect(mutationsOf(result.events, 'basic:soldier:300:valiant')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'move', actorId: fixture.foe.id, movement: 'rush' },
    ]);
    expect(result.state.actors[fixture.foe.id].position).toEqual({ x: 5, y: 1 }); // blocked by the hero at 6
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Brute Backhand: true-strike [D]+fray attack', () => {
    // The hero stands one space past the Size-2 Brute's footprint edge (the
    // footprint spans x∈[1,2]), which is range 1 in footprint terms.
    const fixture = foeFixture('basic:brute:300', { foe: { x: 1, y: 1 }, hero: { x: 3, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:brute:300:backhand', { targetId: fixture.hero.id, dice: [12, 3] });
    expect(result.state.actors[fixture.hero.id].hp).toBe(35); // 40 - (3 + fray 4 - armor 2)
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Brute Backbreaker: rush stops at the first footprint-blocked cell and the attack lands', () => {
    const fixture = foeFixture('basic:brute:300', { foe: { x: 1, y: 1 }, hero: { x: 3, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:brute:300:backbreaker', { targetId: fixture.hero.id, dice: [12, 3, 4] });
    expect(mutationsOf(result.events, 'basic:brute:300:backbreaker')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', hit: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: 11, delivery: 'hit' },
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'stunned' },
    ]);
    // The Brute is Size 2: its footprint at (1,1) already spans x∈[1,2], so
    // its edge touches the hero at (3,1) — the first rush step to anchor
    // (2,1) would put the footprint (2,1)-(3,2) over the hero, so the walk
    // stops without moving and no rush mutation is emitted. The brute
    // attacks from where it stands.
    expect(result.state.actors[fixture.foe.id].position).toEqual({ x: 1, y: 1 });
    expect(result.state.actors[fixture.hero.id].hp).toBe(31); // 40 - (11 - armor 2)
    expect(result.state.actors[fixture.hero.id].statuses).toContain('stunned');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Brute Backbreaker: rushes as far as the footprint allows when a legal rush cell exists', () => {
    // Hero at (4,1) is within range 2 of the Brute's original footprint edge
    // (x=2), but the full 2-space rush to anchor (3,1) would overlap the
    // hero, so the walk stops at anchor (2,1) after one step.
    const fixture = foeFixture('basic:brute:300', { foe: { x: 1, y: 1 }, hero: { x: 4, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:brute:300:backbreaker', { targetId: fixture.hero.id, dice: [12, 3, 4] });
    expect(mutationsOf(result.events, 'basic:brute:300:backbreaker')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'move', actorId: fixture.foe.id, movement: 'rush' },
      { kind: 'attack', hit: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: 11, delivery: 'hit' },
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'stunned' },
    ]);
    expect(result.state.actors[fixture.foe.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[fixture.hero.id].hp).toBe(31); // 40 - (11 - armor 2)
    expect(result.state.actors[fixture.hero.id].statuses).toContain('stunned');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Brute Bulk up: gains 4 vigor, or 6 when bloodied', () => {
    const fixture = foeFixture('basic:brute:300', { foe: { x: 1, y: 1 }, hero: { x: 5, y: 5 } });
    const buffed = foeAbility(fixture.state, fixture, 'basic:brute:300:bulk-up');
    expect(buffed.state.actors[fixture.foe.id].vigor).toBe(4);

    fixture.state.actors[fixture.foe.id].hp = 10; // bloodied (40/2)
    fixture.state.actors[fixture.foe.id].vigor = 0;
    const bloodied = foeAbility(fixture.state, fixture, 'basic:brute:300:bulk-up');
    expect(bloodied.state.actors[fixture.foe.id].vigor).toBe(6);
    expect(applyEvents(fixture.state, bloodied.events)).toEqual(bloodied.state);
  });

  it('Brute Hurl: shoves 2, and a Collide weakens the shoved character', () => {
    const clear = foeFixture('basic:brute:300', { foe: { x: 1, y: 1 }, hero: { x: 3, y: 1 } });
    const shoved = foeAbility(clear.state, clear, 'basic:brute:300:hurl', { targetId: clear.hero.id });
    expect(shoved.state.actors[clear.hero.id].position).toEqual({ x: 5, y: 1 });
    expect(shoved.state.actors[clear.hero.id].statuses).not.toContain('weakened');

    const colliding = foeFixture('basic:brute:300', {
      foe: { x: 1, y: 1 }, hero: { x: 3, y: 1 },
      extras: [{ kind: 'hero', at: { x: 5, y: 1 } }],
    });
    const result = foeAbility(colliding.state, colliding, 'basic:brute:300:hurl', { targetId: colliding.hero.id });
    expect(result.state.actors[colliding.hero.id].position).toEqual({ x: 4, y: 1 }); // stopped by the ally at 5
    expect(result.state.actors[colliding.hero.id].statuses).toContain('weakened');
    expect(applyEvents(colliding.state, result.events)).toEqual(result.state);
  });

  it('Brute Hurl: a shove stops at a large actor footprint edge, not its anchor cell', () => {
    // A second Size-2 Brute at (4,0) occupies (4,0)-(5,1). The shoved hero's
    // path (4,1), (5,1) enters that footprint at its non-anchor cell (4,1) —
    // an anchor-only collision check would let the hero walk through to
    // (5,1) inside the footprint without colliding.
    const fixture = foeFixture('basic:brute:300', {
      foe: { x: 1, y: 1 }, hero: { x: 3, y: 1 },
      extras: [{ kind: 'foe', at: { x: 4, y: 0 } }],
    });
    const result = foeAbility(fixture.state, fixture, 'basic:brute:300:hurl', { targetId: fixture.hero.id });
    // The very first shove step enters the second Brute's footprint, so the
    // hero does not move at all and the shove collides immediately.
    expect(result.state.actors[fixture.hero.id].position).toEqual({ x: 3, y: 1 });
    expect(result.state.actors[fixture.hero.id].statuses).toContain('weakened');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Pepperbox Riddle: 3 damage three times, dazed and unerring at exactly range 3', () => {
    const fixture = foeFixture('basic:pepperbox:302', { foe: { x: 1, y: 1 }, hero: { x: 4, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:pepperbox:302:riddle', { targetId: fixture.hero.id, dice: [12, 4] });
    expect(mutationsOf(result.events, 'basic:pepperbox:302:riddle')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 12, boon: 4, total: 16, hit: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: 3, instance: 1, ignoreCover: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: 3, instance: 2, ignoreCover: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: 3, instance: 3, ignoreCover: true },
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'dazed' },
    ]);
    expect(result.state.actors[fixture.hero.id].hp).toBe(37); // 3 × (3 - armor 2)
    expect(result.state.actors[fixture.hero.id].statuses).toContain('dazed');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Pepperbox Riddle: a miss deals 3 damage', () => {
    const fixture = foeFixture('basic:pepperbox:302', { foe: { x: 1, y: 1 }, hero: { x: 4, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:pepperbox:302:riddle', { targetId: fixture.hero.id, dice: [1, 4] });
    // The Effect clause is unconditional: at exactly range 3 the target is
    // dazed whether the attack hits or misses.
    expect(mutationsOf(result.events, 'basic:pepperbox:302:riddle')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 1, total: 5, hit: false },
      { kind: 'damage', actorId: fixture.hero.id, amount: 3, delivery: 'miss' },
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'dazed' },
    ]);
    expect(result.state.actors[fixture.hero.id].hp).toBe(39); // 40 - (3 - armor 2)
    expect(result.state.actors[fixture.hero.id].statuses).toContain('dazed');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Pepperbox Strafe: dashes 2 then deals 2 damage to a foe in range 3', () => {
    const fixture = foeFixture('basic:pepperbox:302', { foe: { x: 1, y: 1 }, hero: { x: 4, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:pepperbox:302:strafe');
    expect(mutationsOf(result.events, 'basic:pepperbox:302:strafe')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: fixture.foe.id, movement: 'rush' },
      { kind: 'damage', actorId: fixture.hero.id, amount: 2, delivery: 'effect' },
    ]);
    expect(result.state.actors[fixture.foe.id].position).toEqual({ x: 3, y: 1 });
    expect(result.state.actors[fixture.hero.id].hp).toBe(40); // armor 2 absorbs the 2 damage
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Pepperbox Flash Bomb: small blast deals 3 damage twice, blinds foes, and grants allies stealth', () => {
    const fixture = foeFixture('basic:pepperbox:302', {
      foe: { x: 1, y: 1 }, hero: { x: 3, y: 1 },
      extras: [
        { kind: 'hero', at: { x: 4, y: 1 } },
        { kind: 'foe', at: { x: 2, y: 1 } },
      ],
    });
    const result = foeAbility(fixture.state, fixture, 'basic:pepperbox:302:flash-bomb', { targetId: fixture.hero.id });
    const mutations = mutationsOf(result.events, 'basic:pepperbox:302:flash-bomb');
    expect(mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === fixture.hero.id)).toHaveLength(2);
    expect(mutations.filter((mutation) => mutation.kind === 'condition' && mutation.conditionId === 'blind')).toHaveLength(2);
    expect(result.state.actors[fixture.hero.id].hp).toBe(38); // 2 × (3 - armor 2)
    expect(result.state.actors[fixture.extras[0].id].hp).toBe(38);
    expect(result.state.actors[fixture.hero.id].statuses).toContain('blind');
    // The allied foe in the area gains stealth instead of damage.
    expect(result.state.actors[fixture.extras[1].id].conditions.some(({ id }) => id === 'stealth')).toBe(true);
    expect(result.state.actors[fixture.extras[1].id].hp).toBe(28); // skirmisher, untouched by the blast
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Hunter shot: +1 boon ranged attack, shoving and dazing bloodied targets', () => {
    const fixture = foeFixture('basic:hunter:302', { foe: { x: 1, y: 1 }, hero: { x: 4, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:hunter:302:hunter-shot', { targetId: fixture.hero.id, dice: [12, 4, 3] });
    expect(result.state.actors[fixture.hero.id].hp).toBe(37); // 40 - (3 + fray 2 - armor 2)
    expect(result.state.actors[fixture.hero.id].statuses).not.toContain('dazed'); // not bloodied

    fixture.state.actors[fixture.hero.id].hp = 10;
    const bloodied = foeAbility(fixture.state, fixture, 'basic:hunter:302:hunter-shot', { targetId: fixture.hero.id, dice: [12, 4, 3] });
    expect(bloodied.state.actors[fixture.hero.id].position).toEqual({ x: 5, y: 1 }); // shoved 1
    expect(bloodied.state.actors[fixture.hero.id].statuses).toContain('dazed');
    expect(bloodied.state.actors[fixture.hero.id].hp).toBe(7); // 10 - (3 + fray 2 - armor 2)
    expect(applyEvents(fixture.state, bloodied.events)).toEqual(bloodied.state);
  });

  it('Hunter Set Trap: creates a dangerous terrain space in free space in range 2', () => {
    const fixture = foeFixture('basic:hunter:302', { foe: { x: 1, y: 1 }, hero: { x: 5, y: 5 } });
    const result = foeAbility(fixture.state, fixture, 'basic:hunter:302:set-trap', { positions: { 'terrain-position': [{ x: 0, y: 1 }] } });
    const traps = result.state.terrainEffects.filter((effect) => effect.terrain === 'dangerous');
    expect(traps).toHaveLength(1);
    expect(traps[0].ownerId).toBe(fixture.foe.id);
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Hunter Set Trap measures range from a Size-2 Jotunn footprint edge', () => {
    const fixture = foeFixture('basic:hunter:302', { foe: { x: 1, y: 1 }, hero: { x: 5, y: 5 } });
    fixture.state.actors[fixture.foe.id].size = 2; // Jotunn Titanblood (p.448)
    const allowed = { x: 4, y: 1 }; // anchor distance 3; footprint distance 2
    for (let y = 0; y < fixture.state.grid.height; y += 1) {
      for (let x = 0; x < fixture.state.grid.width; x += 1) {
        const inSourceFootprint = x >= 1 && x <= 2 && y >= 1 && y <= 2;
        if (inSourceFootprint || (x === allowed.x && y === allowed.y)) continue;
        fixture.state.entities[`blocker:${x},${y}`] = {
          id: `blocker:${x},${y}`, type: 'boulder', kind: 'object', ownerId: null,
          positions: [{ x, y }], state: { height: 1 }, duration: null,
        };
      }
    }
    const result = foeAbility(fixture.state, fixture, 'basic:hunter:302:set-trap', { positions: { 'terrain-position': [allowed] } });
    expect(result.state.terrainEffects).toContainEqual(expect.objectContaining({
      terrain: 'dangerous', positions: [allowed],
    }));
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Hunter Set Trap rejects missing and non-free recorded cells without spending its action', () => {
    const fixture = foeFixture('basic:hunter:302', { foe: { x: 1, y: 1 }, hero: { x: 5, y: 5 } });
    const before = structuredClone(fixture.state);
    expect(() => foeAbility(fixture.state, fixture, 'basic:hunter:302:set-trap')).toThrow(/recorded choice/);
    expect(() => foeAbility(fixture.state, fixture, 'basic:hunter:302:set-trap', { positions: { 'terrain-position': [{ x: 1, y: 1 }] } })).toThrow(/eligible candidate/);
    expect(fixture.state).toEqual(before);
  });

  it('Hunter Prowl: dashes 1, gains stealth, and records the end-turn request', () => {
    const fixture = foeFixture('basic:hunter:302', { foe: { x: 1, y: 1 }, hero: { x: 3, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:hunter:302:prowl');
    expect(mutationsOf(result.events, 'basic:hunter:302:prowl')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: fixture.foe.id, movement: 'rush' },
      { kind: 'condition', actorId: fixture.foe.id, conditionId: 'stealth' },
      { kind: 'end-turn', actorId: fixture.foe.id },
    ]);
    expect(result.state.actors[fixture.foe.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[fixture.foe.id].conditions.some(({ id }) => id === 'stealth')).toBe(true);
    // The end-turn mutation is what EXECUTE_RULE honors to auto-end the turn.
    expect(result.events.some((event) => event.type === 'TURN_ENDED' && event.actorId === fixture.foe.id)).toBe(true);
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Hunter Hunt: marks a character in range, then Hunter shot deals bonus damage and unerring to it', () => {
    const fixture = foeFixture('basic:hunter:302', { foe: { x: 1, y: 1 }, hero: { x: 4, y: 1 } });
    const marked = foeAbility(fixture.state, fixture, 'basic:hunter:302:hunt', { targetId: fixture.hero.id });
    expect(marked.state.actors[fixture.hero.id].marks.some(({ markId, ownerId }) => markId === 'hunter:hunt' && ownerId === fixture.foe.id)).toBe(true);

    const shot = foeAbility(marked.state, fixture, 'basic:hunter:302:hunter-shot', { targetId: fixture.hero.id, dice: [12, 4, 3, 5, 1] });
    const hitDamage = mutationsOf(shot.events, 'basic:hunter:302:hunter-shot').find((mutation) => mutation.kind === 'damage' && mutation.delivery === 'hit');
    expect(hitDamage).toMatchObject({ amount: 10, ignoreCover: true }); // die 3 + fray 2 + max(5,1) bonus die
    expect(shot.state.actors[fixture.hero.id].hp).toBe(32); // 40 - (10 - armor 2)
    expect(applyEvents(marked.state, shot.events)).toEqual(shot.state);
  });

  it('Cantrix Discord: range-8 Pierce autohit bypasses Evasion but not the target gate', () => {
    const fixture = foeFixture('basic:cantrix:305', { foe: { x: 1, y: 1 }, hero: { x: 9, y: 1 } });
    // p.104 Pierce means this Fray instance ignores both Armor and the
    // source's Weakened reduction. Autohit also skips the Evasion d6.
    fixture.state.actors[fixture.foe.id].statuses.push('weakened');
    fixture.state.actors[fixture.hero.id].conditions.push({ id: 'evasion', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });

    const result = foeAbility(fixture.state, fixture, 'basic:cantrix:305:discord', { targetId: fixture.hero.id });
    expect(mutationsOf(result.events, 'basic:cantrix:305:discord')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: null, boon: 0, total: null, evasionRoll: null, hit: true, critical: false, trueStrike: false, autoHit: true },
      { kind: 'damage', actorId: fixture.hero.id, amount: fixture.foe.fray, damageType: 'piercing', delivery: 'hit' },
    ]);
    expect(result.state.actors[fixture.hero.id].hp).toBe(40 - fixture.foe.fray);
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Cantrix Discord retains the shared range, line-of-sight, and Stealth target gates', () => {
    const outOfRange = foeFixture('basic:cantrix:305', { foe: { x: 0, y: 1 }, hero: { x: 9, y: 1 } });
    expect(() => foeAbility(outOfRange.state, outOfRange, 'basic:cantrix:305:discord', { targetId: outOfRange.hero.id })).toThrow(/outside this ability’s range/i);

    const blocked = foeFixture('basic:cantrix:305', { foe: { x: 1, y: 1 }, hero: { x: 9, y: 1 } });
    blocked.state.grid.terrain.push({ position: { x: 5, y: 1 }, type: 'impassable', elevation: 1 });
    expect(() => foeAbility(blocked.state, blocked, 'basic:cantrix:305:discord', { targetId: blocked.hero.id })).toThrow(/line of sight/i);

    const stealthy = foeFixture('basic:cantrix:305', { foe: { x: 1, y: 1 }, hero: { x: 9, y: 1 } });
    stealthy.state.actors[stealthy.hero.id].conditions.push({ id: 'stealth', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    expect(() => foeAbility(stealthy.state, stealthy, 'basic:cantrix:305:discord', { targetId: stealthy.hero.id })).toThrow(/stealth/i);
  });

  it('Chaos Wright Chaos Shard: piercing [D]+fray hit and unconditional Shattered effect', () => {
    const fixture = foeFixture('basic:chaos-wright:306', { foe: { x: 1, y: 1 }, hero: { x: 7, y: 1 } });
    // Pierce preserves the full roll even if the source is Weakened, and
    // ignores the hero's Armor when the shared damage kernel applies it.
    fixture.state.actors[fixture.foe.id].statuses.push('weakened');
    const result = foeAbility(fixture.state, fixture, 'basic:chaos-wright:306:chaos-shard', { targetId: fixture.hero.id, dice: [12, 3] });
    expect(mutationsOf(result.events, 'basic:chaos-wright:306:chaos-shard')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 12, total: 12, hit: true, critical: false },
      { kind: 'damage', actorId: fixture.hero.id, amount: fixture.foe.fray + 3, damageType: 'piercing', delivery: 'hit' },
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'shattered' },
    ]);
    expect(result.state.actors[fixture.hero.id].hp).toBe(40 - fixture.foe.fray - 3);
    expect(result.state.actors[fixture.hero.id].statuses).toContain('shattered');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Chaos Wright Chaos Shard: a miss deals piercing Fray and still Shatters', () => {
    const fixture = foeFixture('basic:chaos-wright:306', { foe: { x: 1, y: 1 }, hero: { x: 7, y: 1 } });
    const result = foeAbility(fixture.state, fixture, 'basic:chaos-wright:306:chaos-shard', { targetId: fixture.hero.id, dice: [1] });
    expect(mutationsOf(result.events, 'basic:chaos-wright:306:chaos-shard')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 1, total: 1, hit: false, critical: false },
      { kind: 'damage', actorId: fixture.hero.id, amount: fixture.foe.fray, damageType: 'piercing', delivery: 'miss' },
      { kind: 'condition', actorId: fixture.hero.id, conditionId: 'shattered' },
    ]);
    expect(result.state.actors[fixture.hero.id].hp).toBe(40 - fixture.foe.fray);
    expect(result.state.actors[fixture.hero.id].statuses).toContain('shattered');
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });
});
