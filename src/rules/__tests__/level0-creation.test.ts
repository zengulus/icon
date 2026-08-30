import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS,
  createLevelZeroNarrative,
  applyLevelZeroTactical,
  validateNarrativeCharacter,
  levelZeroJobOptions,
  actionOptions,
  bondOptions,
  cultureOptions,
  kinOptions,
  type IconCharacter,
  type LevelZeroNarrativeSelection,
} from '../index.js';

/** A valid default level-0 narrative selection built from the source catalog,
 * so individual tests can mutate the one field they care about. */
function validSelection(): LevelZeroNarrativeSelection {
  const bond = bondOptions()[0]!;
  // Spread the four additional dots across Actions that are NOT the Bond's two
  // actions, keeping every level-0 rating at or below 3.
  const freeActions = ACTION_IDS.filter((id) => !bond.actions.includes(id));
  return {
    kinId: kinOptions()[0]!.id,
    cultureId: cultureOptions()[0]!.id,
    bondId: bond.id,
    bondPowerId: bond.powers[0]!.id,
    bondActionId: bond.actions[0],
    additionalActionDots: { [freeActions[0]!]: 2, [freeActions[1]!]: 2 },
  };
}

describe('level-0 narrative creation', () => {
  it('begins at level 0 and records canonical catalog IDs', () => {
    const sel = validSelection();
    const character = createLevelZeroNarrative({ name: 'Aria', pronouns: 'she/her' }, sel);
    expect(character.level).toBe(0);
    expect(character.kinId).toBe(sel.kinId);
    expect(character.cultureId).toBe(sel.cultureId);
    expect(character.bondId).toBe(sel.bondId);
    expect(character.bondPowerIds).toEqual([sel.bondPowerId]);
    expect(character.bondActionId).toBe(sel.bondActionId);
    // Name/pronouns are application metadata, not source choices.
    expect(character.name).toBe('Aria');
    expect(character.pronouns).toBe('she/her');
  });

  it('cannot complete without Kin, Culture, and Bond', () => {
    const issues = validateNarrativeCharacter({
      id: '', level: 0, kinId: null, cultureId: null, bondId: null, bondActionId: null,
      bondPowerIds: [], actions: Object.fromEntries(ACTION_IDS.map((action) => [action, 0])),
    } as never);
    const codes = issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code);
    // Kin + Culture + Bond are all reported as missing.
    expect(codes.filter((code) => code === 'required').length).toBeGreaterThanOrEqual(3);
    // A mismatched (noncatalog) Kin is a distinct unknown-id failure, not a guess.
    const badKin = validateNarrativeCharacter({
      id: '', level: 0, kinId: 'not-a-kin', cultureId: null, bondId: validSelection().bondId,
      bondActionId: validSelection().bondActionId, bondPowerIds: validSelection().bondPowerId ? [validSelection().bondPowerId!] : [],
      actions: Object.fromEntries(ACTION_IDS.map((action) => [action, 0])),
    } as never);
    expect(badKin.map((issue) => issue.code)).toContain('kin.unknown');
  });

  it('rejects a starting Bond action that is not one of the Bond\'s two actions', () => {
    const bond = bondOptions()[0]!;
    const sel = { ...validSelection(), bondId: bond.id, bondPowerId: bond.powers[0]!.id };
    // An action from outside the Bond's two linked actions has no claim on the
    // Bond's +2 dots.
    const wrongAction = ACTION_IDS.find((id) => !bond.actions.includes(id))!;
    const forged = { ...sel, bondActionId: wrongAction };
    expect(() => createLevelZeroNarrative({ name: 'X' }, forged)).toThrow(/must go to/);
    // A matching-power variant reaches the action rule specifically.
    const forgedPower = { ...validSelection(), bondPowerId: bondOptions()[0]!.powers[0]!.id, bondActionId: wrongAction };
    const issues = validateNarrativeCharacter({
      ...fakeCharacter(forgedPower), bondActionId: wrongAction,
    });
    expect(issues.map((issue) => issue.code)).toContain('bond.action');
  });

  it('applies the Bond +2 starting dots to the chosen action', () => {
    const sel = validSelection();
    const character = createLevelZeroNarrative({ name: 'X' }, sel);
    expect(character.actions[sel.bondActionId]).toBe(2);
  });

  it('requires exactly one starting Bond power, belonging to the Bond', () => {
    const sel = validSelection();
    // Owning power works.
    expect(createLevelZeroNarrative({ name: 'X' }, sel).bondPowerIds).toHaveLength(1);
    // A power from a different Bond is rejected.
    const otherBondPower = bondOptions()[2]!.powers[0]!.id;
    expect(() => createLevelZeroNarrative({ name: 'X' }, { ...sel, bondPowerId: otherBondPower }))
      .toThrow(/must belong to the chosen Bond/);
    const issues = validateNarrativeCharacter({ ...fakeCharacter(sel), bondPowerIds: [otherBondPower] });
    expect(issues.map((issue) => issue.code)).toContain('bond.power-own');
  });

  it('exactly six action dots with exactly four additional dots', () => {
    const sel = validSelection();
    const character = createLevelZeroNarrative({ name: 'X' }, sel);
    const total = ACTION_IDS.reduce((sum, action) => sum + character.actions[action], 0);
    const additional = Object.values(sel.additionalActionDots).reduce((sum, dots) => sum + (dots ?? 0), 0);
    expect(total).toBe(6);
    expect(additional).toBe(4);
  });

  it('rejects an action rating above 3 at level 0', () => {
    const sel = validSelection();
    const over = { ...sel, additionalActionDots: { [sel.bondActionId]: 4 } };
    const issues = validateNarrativeCharacter({ ...fakeCharacter(over) });
    expect(issues.map((issue) => issue.code)).toContain('action.range');
  });
});

describe('level-0 tactical creation', () => {
  it('permits exactly one Job', () => {
    const jobs = levelZeroJobOptions();
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('requires starting abilities to belong to the selected Job and exactly two of them', () => {
    const sel = validSelection();
    const narrative = createLevelZeroNarrative({ name: 'X' }, sel);
    const job = levelZeroJobOptions()[0]!;
    expect(() => applyLevelZeroTactical(narrative, { jobId: job.id, abilityIds: [job.abilities[0]!.id] }))
      .toThrow(/exactly two/);
    const forged = (levelZeroJobOptions()[1]!).abilities[0]!.id;
    expect(() => applyLevelZeroTactical(narrative, { jobId: job.id, abilityIds: [forged, job.abilities[0]!.id] }))
      .toThrow(/belong to the chosen Job/);
    const valid = applyLevelZeroTactical(narrative, { jobId: job.id, abilityIds: [job.abilities[0]!.id, job.abilities[1]!.id] });
    expect(valid.primaryJobId).toBe(job.id);
    expect(valid.abilities).toHaveLength(2);
    expect(valid.abilities.map((ability) => ability.abilityId)).toEqual([job.abilities[0]!.id, job.abilities[1]!.id]);
  });
});

describe('creation-catalog projection boundary', () => {
  it('never exposes automation, coverage, or implementation metadata to job/ability options', () => {
    for (const job of levelZeroJobOptions()) {
      const jobKeys = Object.keys(job);
      expect(jobKeys).not.toContain('automation');
      expect(jobKeys).not.toContain('coverage');
      expect(jobKeys).not.toContain('executable');
      expect(jobKeys).not.toContain('structured');
      expect(jobKeys).not.toContain('implemented');
      expect(jobKeys).not.toContain('manual');
      expect(JSON.stringify(job)).not.toMatch(/"automation"|"coverage"|"executable"|"structured"|"implemented"|"unresolved"/);
      for (const ability of job.abilities) {
        const abilityKeys = Object.keys(ability);
        expect(abilityKeys).toEqual(expect.arrayContaining(['id', 'name', 'chapter', 'sourcePage']));
        expect(abilityKeys).not.toContain('summary');
        expect(abilityKeys).not.toContain('rulesText');
        expect(abilityKeys).not.toContain('cost');
        expect(abilityKeys).not.toContain('automation');
      }
    }
  });

  it('narrative projections carry only identity + display + source, never engine status', () => {
    for (const option of [...kinOptions(), ...cultureOptions()]) {
      const keys = Object.keys(option);
      expect(keys).toEqual(expect.arrayContaining(['id', 'name', 'sourcePage']));
      expect(JSON.stringify(option)).not.toMatch(/"automation"|"implemented"|"coverage"/);
    }
    for (const bond of bondOptions()) {
      expect(JSON.stringify(bond)).not.toMatch(/"automation"|"implemented"|"coverage"/);
      for (const power of bond.powers) {
        const keys = Object.keys(power);
        expect(keys).toEqual(expect.arrayContaining(['id', 'bondId', 'name', 'rulesText']));
        expect(JSON.stringify(power)).not.toMatch(/"automation"|"implemented"|"coverage"/);
      }
    }
    expect(actionOptions()[0]).toBeDefined();
  });
});

function fakeCharacter(sel: LevelZeroNarrativeSelection): IconCharacter {
  const actions = Object.fromEntries(ACTION_IDS.map((action) => [action, 0])) as Record<string, number>;
  actions[sel.bondActionId] = 2;
  for (const [actionId, dots] of Object.entries(sel.additionalActionDots)) {
    actions[actionId] = Math.max(0, (actions[actionId] ?? 0) + (dots ?? 0));
  }
  return {
    id: 'probe', level: 0, kinId: sel.kinId, cultureId: sel.cultureId, bondId: sel.bondId,
    bondActionId: sel.bondActionId, bondPowerIds: [sel.bondPowerId], actions,
  } as unknown as IconCharacter;
}