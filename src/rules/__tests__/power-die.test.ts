import { describe, expect, it } from 'vitest';
import { actorFromCharacter } from '../encounter.js';
import { readPowerDie, setPowerDie, tickPowerDie } from '../automation/kernels/power-die.js';
import { validCharacter } from './fixtures.js';

describe('power-die kernel (persistent dN ticker)', () => {
  it('reads the start value when the die is unset', () => {
    const hero = actorFromCharacter(validCharacter('Power die'), { x: 1, y: 1 });
    expect(readPowerDie(hero, 'fixture:die', 4)).toBe(4);
    expect(hero.ruleState['fixture:die']).toBeUndefined(); // read is pure
  });

  it('ticks up by 1 and clamps to the max, recording ownership', () => {
    const hero = actorFromCharacter(validCharacter('Power die'), { x: 1, y: 1 });
    expect(tickPowerDie(hero, 'fixture:die', 1, 6)).toBe(2);
    expect(readPowerDie(hero, 'fixture:die', 1)).toBe(2);
    expect(hero.ruleStateOwners['fixture:die']).toBe(hero.id);

    // continues from the recorded value, clamps at max
    expect(tickPowerDie(hero, 'fixture:die', 1, 6)).toBe(3);
    expect(hero.ruleState['fixture:die']).toBe(3);
    hero.ruleState['fixture:die'] = 6;
    expect(tickPowerDie(hero, 'fixture:die', 1, 6)).toBe(6); // clamped
  });

  it('sets an exact value (start override / empower), clamped to max and floor 0', () => {
    const hero = actorFromCharacter(validCharacter('Power die'), { x: 1, y: 1 });
    expect(setPowerDie(hero, 'fixture:die', 6, 6)).toBe(6);
    expect(readPowerDie(hero, 'fixture:die', 4)).toBe(6);
    expect(setPowerDie(hero, 'fixture:die', 99, 6)).toBe(6); // max clamp
    expect(setPowerDie(hero, 'fixture:die', -3, 6)).toBe(0); // floor
    expect(hero.ruleStateOwners['fixture:die']).toBe(hero.id);
  });
});
