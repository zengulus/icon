import { BONDS, JOBS } from '../catalog.js';
import { createCharacter } from '../character.js';
import type { DiceSource } from '../dice.js';
import type { IconCharacter } from '../types.js';

export function validCharacter(name = 'Aster'): IconCharacter {
  const character = createCharacter('2026-08-19T00:00:00.000Z');
  const bond = BONDS[0];
  const job = JOBS[0];
  return {
    ...character,
    name,
    kin: 'Thrynn',
    culture: 'Yeokin',
    bondId: bond.id,
    bondAction: 'traverse',
    bondPowers: [bond.powers[0]],
    actions: { ...character.actions, traverse: 3, sense: 1, study: 1, charm: 1 },
    jobs: [job.id],
    primaryJobId: job.id,
    abilities: job.abilities.slice(0, 2).map(({ id }) => ({ abilityId: id, talent: null, mastered: false })),
    equippedAbilityIds: job.abilities.slice(0, 2).map(({ id }) => id),
  };
}

export function scriptedDice(...rolls: number[]): DiceSource {
  let index = 0;
  return {
    die(sides) {
      const value = rolls[index++] ?? 1;
      if (value < 1 || value > sides) throw new Error(`Scripted roll ${value} is invalid for d${sides}.`);
      return value;
    },
  };
}
