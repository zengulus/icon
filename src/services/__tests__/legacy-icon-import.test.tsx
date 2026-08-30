import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  ACTION_IDS,
  CHARACTER_SCHEMA_VERSION,
  validateCharacter,
  validateNarrativeCharacter,
  type IconCharacter,
} from '../../rules/index.js';
import { CharacterProvider } from '../../context/CharacterContext.js';
import { Dashboard } from '../../pages/Dashboard.js';
import {
  CLOUD_SAVE_DEBOUNCE_MS,
  CharacterSyncController,
  type CloudCharacterTransport,
  type LocalCharacterRecord,
} from '../character-sync.js';
import * as legacyIconImport from '../legacy-icon-import.js';
import { importLegacyIconFile, LEGACY_ICON_FILE_ACCEPT } from '../legacy-icon-import.js';

const DOUGLAS_ICON = readFileSync(new URL('../../../Douglas.icon', import.meta.url), 'utf8');
const LEGACY_UUID = '1cd154b8-0bd0-4a3e-b0cf-50df2539be4e';

/** The Douglas.icon compatibility fixture as a plain record, so a test can
 * mutate exactly one field at a time. */
function douglasRecord(): Record<string, unknown> {
  const [record] = JSON.parse(DOUGLAS_ICON) as Record<string, unknown>[];
  if (!record) throw new Error('The Douglas.icon fixture is empty.');
  return record;
}

function importWith(overrides: Record<string, unknown>) {
  return importLegacyIconFile(JSON.stringify([{ ...douglasRecord(), ...overrides }]));
}

/** Commit characters through the real local-first save path (the same
 * `CharacterSyncController` the CharacterContext save() uses) with no cloud
 * transport available, and return the durable local envelope. */
function localRoster(characters: IconCharacter[]): LocalCharacterRecord[] {
  let records: LocalCharacterRecord[] = [];
  const controller = new CharacterSyncController({
    transport: { available: () => false, write: async () => 0 },
    load: () => records,
    write: (next) => { records = next; },
    hooks: { onState() {} },
  });
  controller.start();
  for (const character of characters) controller.commit(character, 'instance-1');
  return records;
}

describe('legacy .icon import', () => {
  it('imports Douglas.icon successfully (test 1)', () => {
    const result = importLegacyIconFile(DOUGLAS_ICON);
    expect(result.errors).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]!.name).toBe('Douglas');
  });

  it('Douglas becomes a valid canonical level-0 character (test 2)', () => {
    const [douglas] = importLegacyIconFile(DOUGLAS_ICON).imported;
    expect(douglas!.level).toBe(0);
    expect(douglas!.schemaVersion).toBe(CHARACTER_SCHEMA_VERSION);
    expect(validateCharacter(douglas!).filter(({ severity }) => severity === 'error')).toEqual([]);
  });

  it('Thrynn / Yeokin / Dreamer / Bright Eyed resolve to canonical IDs (test 3)', () => {
    const [douglas] = importLegacyIconFile(DOUGLAS_ICON).imported;
    expect(douglas!.kinId).toBe('thrynn');
    expect(douglas!.cultureId).toBe('yeokin');
    expect(douglas!.bondId).toBe('dreamer');
    expect(douglas!.bondPowerIds).toEqual(['dreamer:bright-eyed']);
  });

  it('Smash bondBonus + actionBonuses reconstruct the four extra dots (test 4)', () => {
    const [douglas] = importLegacyIconFile(DOUGLAS_ICON).imported;
    expect(douglas!.bondActionId).toBe('smash');
    // Final ratings from the file: Smash 2, Command 2, Excel 2.
    expect(douglas!.actions.smash).toBe(2);
    expect(douglas!.actions.command).toBe(2);
    expect(douglas!.actions.excel).toBe(2);
    const total = ACTION_IDS.reduce((sum, id) => sum + douglas!.actions[id], 0);
    expect(total).toBe(6);
    expect(ACTION_IDS.every((id) => douglas!.actions[id] <= 3)).toBe(true);
    // Smash carries the Bond +2, so the four extra dots land on Command/Excel.
    const extras = ACTION_IDS.reduce((sum, id) => sum + Math.max(0, douglas!.actions[id] - (id === 'smash' ? 2 : 0)), 0);
    expect(extras).toBe(4);
  });

  it('Freelancer + TRICK SHOT + DEUS EX MACHINA resolve and pass native tactical validation (test 5)', () => {
    const [douglas] = importLegacyIconFile(DOUGLAS_ICON).imported;
    expect(douglas!.primaryJobId).toBe('freelancer');
    expect(douglas!.jobs).toEqual(['freelancer']);
    expect(douglas!.abilities.map(({ abilityId }) => abilityId)).toEqual([
      'freelancer:trick-shot',
      'freelancer:deus-ex-machina',
    ]);
    expect(douglas!.equippedAbilityIds).toEqual(['freelancer:trick-shot', 'freelancer:deus-ex-machina']);
    expect(validateCharacter(douglas!).filter(({ severity }) => severity === 'error')).toEqual([]);
  });

  it('imported persisted identity uses canonical IDs, not display labels (test 6)', () => {
    const [douglas] = importLegacyIconFile(DOUGLAS_ICON).imported;
    const record = localRoster([douglas!])[0]!;
    expect(record.character.kinId).toBe('thrynn');
    expect(record.character.cultureId).toBe('yeokin');
    expect(record.character.bondId).toBe('dreamer');
    expect(record.character.bondPowerIds).toEqual(['dreamer:bright-eyed']);
    expect(record.character.jobs).toEqual(['freelancer']);
    expect(record.character.abilities.map(({ abilityId }) => abilityId)).toEqual([
      'freelancer:trick-shot',
      'freelancer:deus-ex-machina',
    ]);
    const persisted = JSON.stringify(record.character);
    expect(persisted).not.toContain('Thrynn');
    expect(persisted).not.toContain('TRICK SHOT');
    expect(persisted).not.toContain('Deus Ex Machina');
    for (const legacyKey of ['kin', 'culture', 'bond', 'powers', 'actionBonuses', 'bondBonus']) {
      expect(legacyKey in record.character).toBe(false);
    }
  });

  it('the legacy UUID is replaced with a fresh canonical UUID (test 7)', () => {
    const [douglas] = importLegacyIconFile(DOUGLAS_ICON).imported;
    expect(douglas!.id).not.toBe(LEGACY_UUID);
    expect(douglas!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('importing the same file twice creates two separate canonical characters (test 8)', () => {
    const first = importLegacyIconFile(DOUGLAS_ICON).imported[0]!;
    const second = importLegacyIconFile(DOUGLAS_ICON).imported[0]!;
    expect(first.id).not.toBe(second.id);
    const roster = localRoster([first, second]);
    expect(roster).toHaveLength(2);
    expect(roster[0]!.character.id).not.toBe(roster[1]!.character.id);
  });

  it.each([
    [{ kin: 'Klingon' }, /Unrecognized Kin/],
    [{ culture: 'Nope' }, /Unrecognized Culture/],
    [{ bond: 'Nope' }, /Unrecognized Bond/],
    [{ powers: ['Nope'] }, /Unrecognized Bond power/],
    [{ bondBonus: 'Nope' }, /Unrecognized Action/],
    [{ actionBonuses: { Smash: 2, Nope: 2 } }, /Unrecognized Action/],
    [{ jobs: ['Nope'] }, /Unrecognized Job/],
    [{ abilities: [{ name: 'Nope' }] }, /Unrecognized Ability/],
  ])('unknown legacy labels reject rather than guess (test 9: %j)', (overrides, pattern) => {
    const result = importWith(overrides);
    expect(result.imported).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(pattern);
  });

  it('invalid action allocations reject through native creation validation (test 10)', () => {
    // Eight total dots → the native builder rejects the total.
    const overBudget = importWith({ actionBonuses: { Smash: 2, Command: 3, Excel: 3 } });
    expect(overBudget.imported).toHaveLength(0);
    expect(overBudget.errors[0]!.message).toMatch(/exactly 6 action dots/);
    // One final rating above 3 → native validation rejects the range.
    const aboveThree = importWith({ actionBonuses: { Smash: 2, Command: 4, Excel: 0 } });
    expect(aboveThree.imported).toHaveLength(0);
    expect(aboveThree.errors[0]!.message).toMatch(/0 to 3/);
    // Bond action below its +2 cannot be reconstructed (negative dots).
    const bondBelow = importWith({ actionBonuses: { Smash: 1, Command: 3, Excel: 2 } });
    expect(bondBelow.imported).toHaveLength(0);
    expect(bondBelow.errors[0]!.message).toMatch(/below the \+2 dots/);
  });

  it('wrong-Job abilities reject through native tactical validation (test 11)', () => {
    // Heracule resolves canonically but belongs to Bastion, not Freelancer.
    const wrongJob = importWith({ jobs: ['Freelancer'], abilities: [{ name: 'Heracule' }, { name: 'TRICK SHOT' }] });
    expect(wrongJob.imported).toHaveLength(0);
    expect(wrongJob.errors[0]!.message).toMatch(/belong to the chosen Job/);
    // Showdown is a Freelancer ability but chapter 2 — not level-0 legal.
    const wrongChapter = importWith({ abilities: [{ name: 'Showdown' }, { name: 'TRICK SHOT' }] });
    expect(wrongChapter.imported).toHaveLength(0);
    expect(wrongChapter.errors[0]!.message).toMatch(/not a level-0 \(chapter 1\) ability/);
  });

  it.each([1, 5, -1])('level %s rejects rather than dropping advancement state (test 12)', (level) => {
    const result = importWith({ level });
    expect(result.imported).toHaveLength(0);
    expect(result.errors[0]!.message).toMatch(/only level 0/);
  });

  it('a missing or non-integer level rejects', () => {
    const nonInteger = importWith({ level: 'zero' });
    expect(nonInteger.imported).toHaveLength(0);
    expect(nonInteger.errors[0]!.message).toMatch(/integer level/);
    expect(importWith({ level: undefined }).imported).toHaveLength(0);
  });

  it('narrative-only level-0 import works when tactical fields are absent (test 13)', () => {
    const { jobs: _jobs, abilities: _abilities, ...narrativeOnly } = douglasRecord();
    const result = importLegacyIconFile(JSON.stringify([narrativeOnly]));
    expect(result.errors).toEqual([]);
    const [character] = result.imported;
    expect(character!.jobs).toEqual([]);
    expect(character!.primaryJobId).toBeNull();
    expect(character!.abilities).toEqual([]);
    expect(character!.equippedAbilityIds).toEqual([]);
    expect(validateNarrativeCharacter(character!).filter(({ severity }) => severity === 'error')).toEqual([]);
  });

  it('Douglas zero/default runtime fields are accepted without becoming a second rules-state authority (test 14)', () => {
    const [douglas] = importLegacyIconFile(DOUGLAS_ICON).imported;
    expect(douglas!.xp).toBe(0);
    expect(douglas!.dust).toBe(0);
    expect(douglas!.wounds).toBe(0);
    expect(douglas!.hpLost).toBe(0);
    expect(douglas!.burdens).toEqual([]);
    expect(douglas!.ambitions).toEqual([]);
    expect(douglas!.relics).toEqual([]);
    expect(douglas!.looseGear).toEqual([]);
    expect(douglas!.activeKit).toBe('');
    // Effort derives from the Bond (Dreamer), never the legacy runtime 0.
    expect(douglas!.effort).toBe(3);
    expect(douglas!.strain).toBe(0);
    for (const legacyKey of [
      'stress', 'session', 'trophies', 'prepared', 'active', 'hp', 'vigor',
      'statuses', 'resolve', 'partyResolve', 'tacticalClocks', 'fixtures',
      'camps', 'levelActionChoice', 'levelJobChoice',
    ]) {
      expect(legacyKey in douglas!).toBe(false);
    }
  });

  it.each([
    [{ xp: 5 }, /"xp"/],
    [{ dust: 3 }, /"dust"/],
    [{ wounds: 2 }, /"wounds"/],
    [{ stress: 1 }, /"stress"/],
    [{ burdens: [{ id: 'clock-1', name: 'Wanted', size: 4, progress: 1 }] }, /"burdens"/],
    [{ prepared: [{ name: 'Default', trophies: [], abilities: ['TRICK SHOT'], class: 'Vagabond', job: 'Freelancer' }] }, /"prepared"/],
    [{ session: { xp: { ideals: 1, challenges: 0, ambitions: 0, burdens: 0 }, powersUsed: {} } }, /"session"/],
  ])('materially non-default unsupported legacy state rejects (test 15: %j)', (overrides, pattern) => {
    const result = importWith(overrides);
    expect(result.imported).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(pattern);
  });

  it('valid records import even when another record in the same file is invalid', () => {
    const invalid = { ...douglasRecord(), level: 4 };
    const result = importLegacyIconFile(JSON.stringify([douglasRecord(), invalid, douglasRecord()]));
    expect(result.imported).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ index: 1 });
  });

  it('import works with cloud/auth unavailable (test 16)', () => {
    vi.useFakeTimers();
    try {
      let records: LocalCharacterRecord[] = [];
      let writes = 0;
      const transport: CloudCharacterTransport = {
        available: () => false,
        write: async () => { writes += 1; return 0; },
      };
      const controller = new CharacterSyncController({
        transport,
        load: () => records,
        write: (next) => { records = next; },
        hooks: { onState() {} },
      });
      controller.start();
      const [douglas] = importLegacyIconFile(DOUGLAS_ICON).imported;
      controller.commit(douglas!, 'instance-1');
      vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        localRevision: 1,
        cloudRevision: null,
        cloudState: 'pending',
        creatorInstanceId: 'instance-1',
      });
      expect(records[0]!.character.name).toBe('Douglas');
      // No identity, no cloud traffic — the import still fully persists locally.
      expect(writes).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a file that is not a JSON array of records', () => {
    expect(() => importLegacyIconFile('{}')).toThrow(/JSON array/);
    expect(() => importLegacyIconFile('{not json')).toThrow(/valid JSON/);
  });
});

describe('Dashboard import control', () => {
  it('the Dashboard accepts .icon, not generic JSON (test 17)', () => {
    expect(LEGACY_ICON_FILE_ACCEPT).toBe('.icon');
    const html = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <CharacterProvider>
          <Dashboard />
        </CharacterProvider>
      </MemoryRouter>,
    );
    // The character import control accepts exactly .icon — never a generic
    // JSON accept. (The separate icon_connect.json descriptor control below is
    // a different, intentionally JSON file input.)
    const accepts = [...html.matchAll(/accept="([^"]*)"/g)].map((match) => match[1]);
    expect(accepts).toContain('.icon');
    expect(accepts).not.toContain('.json');
    expect(accepts).not.toContain('application/json');
  });

  it('no legacy .icon export path is added (test 18)', () => {
    const exports = Object.keys(legacyIconImport);
    expect(exports.some((key) => /export|serialize|download|write/i.test(key))).toBe(false);
    const html = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <CharacterProvider>
          <Dashboard />
        </CharacterProvider>
      </MemoryRouter>,
    );
    // The only export-ish affordance is the PUBLIC icon_connect.json instance
    // descriptor (identity artifact, required by the connect feature). There
    // is no legacy .icon character export: no download attribute, and the
    // import control is import-only.
    expect(html).not.toContain('download=');
    expect(html).not.toMatch(/Export\.icon|export as \.icon|export character/i);
  });
});
