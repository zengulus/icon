import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { beginInterlude, campCharacter, characterCurrentHp, characterStats, createCharacter, migrateCharacter, validateCharacter } from '../character.js';
import { actorFromCharacter, applyEvents, characterFromActor, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterState, IconCharacter } from '../types.js';
import { endTurnOnly, expectCommandPurity, scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

/**
 * Combat settlement & cross-combat continuity (ICON p.99/p.94; roadmap P1):
 *
 *   character -> combat 1 -> ENCOUNTER_ENDED settlement -> projection ->
 *   persistent sheet -> combat 2 starts from the projected outcome.
 *
 * Settlement grants every player-character actor exactly +1 personal resolve
 * at the ENCOUNTER_ENDED boundary ("all characters gain 1 personal resolve
 * after every combat", p.99), and `characterFromActor` projects the durable
 * post-combat state (HP attrition, wounds, personal resolve) back onto the
 * persistent sheet. Vigor, statuses, marks, stances, and shared per-encounter
 * resources end with the combat and are deliberately not transferred.
 */

function settlementFixture(): { state: EncounterState; character: IconCharacter; heroId: string; foeId: string } {
  const character = validCharacter('Aster');
  let state = createEncounter('Settlement fixture');
  const hero = actorFromCharacter(character, { x: 1, y: 1 });
  const foe = createFoe('Brigand', { x: 5, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }, scriptedDice()).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }, scriptedDice()).state;
  return { state, character, heroId: hero.id, foeId: foe.id };
}

describe('combat settlement — personal Resolve grant (p.99)', () => {
  it('grants each surviving PC exactly +1 personal resolve at END_ENCOUNTER', () => {
    const { state, heroId, foeId } = settlementFixture();
    const started = startEncounterTo(state, heroId, scriptedDice());
    started.actors[heroId].resources['personal-resolve'] = 3;
    let current = endTurnOnly(started, scriptedDice());
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foeId }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    const result = expectCommandPurity(current, { type: 'END_ENCOUNTER' });
    expect(result.state.phase).toBe('complete');
    expect(result.state.actors[heroId].resources['personal-resolve']).toBe(4); // 3 + exactly one grant
    expect(result.state.partyResolve).toBe(0);
    // Replay from the pre-command snapshot reproduces the settlement exactly.
    expect(applyEvents(current, result.events)).toEqual(result.state);
  });

  it('grants the +1 to a DEFEATED PC too (the source names no exception), and never to foes or summons', () => {
    const { state, heroId } = settlementFixture();
    const character = validCharacter('Conjured');
    const summon = { ...actorFromCharacter(character, { x: 1, y: 2 }), id: 'summon:settlement-blade', name: 'Conjured Blade', actorKind: 'summon' as const, characterId: null };
    let current = executeCommand(state, { type: 'ADD_ACTOR', actor: summon }, scriptedDice()).state;
    current = executeCommand(current, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    current.actors[heroId].defeated = true;
    current.actors[heroId].resources['personal-resolve'] = 0;
    current.actors[summon.id].resources['personal-resolve'] = 5;
    const foeId = Object.values(current.actors).find(({ side }) => side === 'foes')!.id;
    current.actors[foeId].resources['personal-resolve'] = 7;
    const ended = executeCommand(current, { type: 'END_ENCOUNTER' }, scriptedDice()).state;
    expect(ended.actors[heroId].resources['personal-resolve']).toBe(1); // defeated PC still earns it
    expect(ended.actors[summon.id].resources['personal-resolve']).toBe(5); // summons never earn it
    expect(ended.actors[foeId].resources['personal-resolve']).toBe(7); // foes never earn it
  });
});

describe('combat settlement — actor-to-character handoff', () => {
  it('projects HP attrition, wounds, and spent personal resolve back onto the sheet', () => {
    const { state, character, heroId } = settlementFixture();
    const started = startEncounterTo(state, heroId, scriptedDice());
    // Attrition suffered during combat 1: damage taken, a wound gained, and a
    // point of personal resolve spent (e.g., on a Limit Break).
    started.actors[heroId].hp = 12;
    started.actors[heroId].wounds = 1;
    started.actors[heroId].resources['personal-resolve'] = 0;
    const ended = executeCommand(started, { type: 'END_ENCOUNTER' }, scriptedDice()).state;

    const settled = characterFromActor(character, ended.actors[heroId], '2026-08-25T00:00:00.000Z');
    expect(settled.wounds).toBe(1);
    expect(settled.personalResolve).toBe(1); // 0 spent + the settlement grant
    const maxHp = characterStats(settled)!.maxHp; // measured AFTER the new wound (p.94)
    expect(maxHp - settled.hpLost).toBe(12);
    expect(characterCurrentHp(settled)).toBe(12);
    expect(validateCharacter(settled)).toEqual([]);
  });

  it('round-trips into combat 2: the next encounter starts from the projected outcome', () => {
    const { state, character, heroId } = settlementFixture();
    const started = startEncounterTo(state, heroId, scriptedDice());
    started.actors[heroId].hp = 12;
    started.actors[heroId].wounds = 1;
    const ended = executeCommand(started, { type: 'END_ENCOUNTER' }, scriptedDice()).state;
    const settled = characterFromActor(character, ended.actors[heroId]);

    // Combat 2 begins from the durable sheet, not from full health.
    let secondState = createEncounter('Second combat');
    const hero2 = actorFromCharacter(settled, { x: 1, y: 1 });
    secondState = executeCommand(secondState, { type: 'ADD_ACTOR', actor: hero2 }, scriptedDice()).state;
    expect(hero2.wounds).toBe(1);
    const secondMaxHp = characterStats(settled)!.maxHp;
    expect(hero2.hp).toBe(secondMaxHp - settled.hpLost);
    secondState = executeCommand(secondState, { type: 'ADD_ACTOR', actor: createFoe('Brigand 2', { x: 5, y: 1 }) }, scriptedDice()).state;
    const started2 = executeCommand(secondState, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    expect(started2.actors[hero2.id].wounds).toBe(1);
    expect(started2.actors[hero2.id].hp).toBe(hero2.hp);
  });

  it('rejects projecting a foreign actor, a non-PC actor, or a jobless character', () => {
    const { state, character, heroId, foeId } = settlementFixture();
    const started = startEncounterTo(state, heroId, scriptedDice());
    expect(() => characterFromActor(validCharacter('Someone Else'), started.actors[heroId]))
      .toThrowError(expect.objectContaining({ code: 'character.mismatch' }));
    // The foe's ownership check passes only if forged, so forge it to prove
    // the non-PC guard fires independently.
    expect(() => characterFromActor(character, { ...started.actors[foeId], characterId: character.id }))
      .toThrowError(expect.objectContaining({ code: 'character.not-player-character' }));
    const jobless = { ...createCharacter(), id: character.id };
    expect(() => characterFromActor(jobless, started.actors[heroId]))
      .toThrowError(expect.objectContaining({ code: 'character.job-required' }));
  });

  it('keeps command purity through the whole chain', () => {
    const { state, character, heroId } = settlementFixture();
    const before = structuredClone({ state, character });
    const started = startEncounterTo(state, heroId, scriptedDice());
    const ended = executeCommand(started, { type: 'END_ENCOUNTER' }, scriptedDice()).state;
    characterFromActor(character, ended.actors[heroId]);
    expect({ state, character }).toEqual(before);
  });
});

describe('character schema v4 — durable attrition field', () => {
  it('migrates a v3 record with hpLost defaulting to 0 (full health between combats)', () => {
    const legacy = validCharacter('Migrated') as unknown as Record<string, unknown>;
    delete legacy.hpLost;
    legacy.schemaVersion = 3;
    const migrated = migrateCharacter(legacy);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.hpLost).toBe(0);
    expect(validateCharacter(migrated)).toEqual([]);
  });

  it('round-trips a current record through migration unchanged and rejects future versions', () => {
    const { state, character, heroId } = settlementFixture();
    const started = startEncounterTo(state, heroId, scriptedDice());
    started.actors[heroId].hp = 9;
    const settled = characterFromActor(character, started.actors[heroId]);
    const migrated = migrateCharacter(structuredClone(settled));
    expect(migrated).toEqual(settled);
    expect(() => migrateCharacter({ ...settled, schemaVersion: 99 })).toThrow(/Unsupported character schema/);
  });

  it('camp heals strain and resets personal resolve; an interlude restores HP, wounds, and strain (p.56)', () => {
    const { state, character, heroId } = settlementFixture();
    const started = startEncounterTo(state, heroId, scriptedDice());
    started.actors[heroId].hp = 12;
    started.actors[heroId].wounds = 1;
    const sheet = { ...characterFromActor(character, started.actors[heroId]), strain: 3 };
    expect(characterCurrentHp(sheet)).toBe(12);

    const camped = campCharacter(sheet, '2026-08-25T00:00:00.000Z');
    expect(camped.strain).toBe(0); // strain is healed by camping
    expect(camped.personalResolve).toBe(0); // personal resolve resets to 0 after camping (p.99)
    expect(camped.hpLost).toBe(sheet.hpLost); // attrition persists through camp
    expect(camped.wounds).toBe(sheet.wounds);

    const interlude = beginInterlude(camped, '2026-08-25T01:00:00.000Z');
    expect(interlude.hpLost).toBe(0);
    expect(interlude.wounds).toBe(0);
    expect(interlude.strain).toBe(0);
    expect(characterCurrentHp(interlude)).toBe(characterStats(interlude)!.maxHp);
    expect(validateCharacter(interlude)).toEqual([]);
  });
});
