import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABILITIES, BOND_POWERS, BONDS, CULTURES, JOBS, KINS, findBond, findBondPower, findCulture, findKin } from '../catalog.js';
import { ACTION_IDS, BOND_IDS, CULTURE_IDS, KIN_IDS } from '../types.js';
import { validCharacter } from './fixtures.js';

/**
 * The canonical, source-ordered registries for every persistent player-selection
 * ID domain. These are compatibility contracts: renaming, reordering, deleting,
 * or recycling any released ID must fail a test until the explicit schema
 * migration (`__snapshots__/catalog-identity.json`) is updated.
 */
const DOMAINS = {
  kin: KINS.map(({ id }) => id),
  culture: CULTURES.map(({ id }) => id),
  bond: BONDS.map(({ id }) => id),
  bondPower: BOND_POWERS.map(({ id }) => id),
  action: [...ACTION_IDS],
  job: JOBS.map(({ id }) => id),
  ability: ABILITIES.map(({ id }) => id),
} as const;

function readSnapshot() {
  const raw = readFileSync(new URL('./__snapshots__/catalog-identity.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as { version: number; domains: Record<string, string[]> };
}

describe('permanent player-selection IDs', () => {
  it('freezes the canonical ordered registry (ID immutability guard)', () => {
    const snapshot = readSnapshot();
    expect(snapshot.version).toBe(1);
    // Order-sensitive: an accidental rename, reorder, deletion, or reuse of any
    // released ID fails here until the explicit compatibility contract is
    // updated in `catalog-identity.json`.
    for (const [domain, ids] of Object.entries(snapshot.domains)) {
      expect(DOMAINS[domain as keyof typeof DOMAINS], `domain "${domain}"`).toEqual(ids);
    }
  });

  it('has no duplicate IDs within any domain', () => {
    for (const [domain, ids] of Object.entries(DOMAINS)) {
      expect(new Set(ids).size, `domain "${domain}"`).toBe(ids.length);
    }
  });

  it('matches the literal ID types for the small narrative domains', () => {
    expect(DOMAINS.kin).toEqual([...KIN_IDS]);
    expect(DOMAINS.culture).toEqual([...CULTURE_IDS]);
    expect(DOMAINS.bond).toEqual([...BOND_IDS]);
  });

  it('namespaces every Bond-power ID by its owning Bond', () => {
    expect(new Set(DOMAINS.bondPower).size).toBe(120);
    for (const bond of BONDS) {
      for (const power of bond.powers) {
        expect(power.id.startsWith(`${bond.id}:`)).toBe(true);
        expect(power.bondId).toBe(bond.id);
        expect(power.name.length).toBeGreaterThan(0);
        expect(power.rulesText.length).toBeGreaterThan(0);
      }
      // A Bond power selected for this Bond is unique within it.
      expect(new Set(bond.powers.map(({ id }) => id)).size).toBe(bond.powers.length);
    }
  });

  it('every Bond references valid, distinct Action IDs', () => {
    for (const bond of BONDS) {
      expect(bond.actions).toHaveLength(2);
      expect(bond.actions[0]).not.toBe(bond.actions[1]);
      for (const action of bond.actions) {
        expect(ACTION_IDS).toContain(action);
      }
    }
  });

  it('every persisted selection resolves through the catalog finders', () => {
    for (const id of DOMAINS.kin) expect(findKin(id)?.id).toBe(id);
    for (const id of DOMAINS.culture) expect(findCulture(id)?.id).toBe(id);
    for (const id of DOMAINS.bond) expect(findBond(id)?.id).toBe(id);
    for (const id of DOMAINS.bondPower) expect(findBondPower(id)?.id).toBe(id);

    // A populated character's persisted narrative fields all resolve.
    const character = validCharacter();
    expect(findKin(character.kinId)?.id).toBe('thrynn');
    expect(findCulture(character.cultureId)?.id).toBe('yeokin');
    expect(findBond(character.bondId)?.id).toBe(character.bondId);
    expect(character.bondActionId).toBe('traverse');
    for (const powerId of character.bondPowerIds) {
      expect(findBondPower(powerId)?.id).toBe(powerId);
    }
  });

  it('keeps machine identity separate from display names', () => {
    // IDs are narrow, lower-case machine tokens authored in the catalog; they
    // never contain the spaces/capitalization that live on display labels.
    for (const id of [...DOMAINS.kin, ...DOMAINS.culture, ...DOMAINS.bond]) {
      expect(id).toMatch(/^[a-z]+$/);
    }
    for (const id of DOMAINS.bondPower) {
      expect(id).toMatch(/^[a-z]+:[a-z0-9-]+$/);
    }
    // Display labels are independently mutable: they use characters IDs cannot,
    // and renaming a label leaves the ID registry untouched above.
    expect(KINS.every(({ name }) => /[A-Z]/.test(name))).toBe(true);
    expect(BOND_POWERS.some(({ name }) => /\s/.test(name))).toBe(true);
  });
});