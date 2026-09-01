/** Pure damage-dice roll policy shared by value and damage domain kernels. */
import type { DiceSource } from '../../dice.js';

/** ICON p.102: roll base + bonus dice and keep the highest base count. */
export function rollDamageDice(dice: DiceSource, die: number, count: number, bonusDice: number): number {
  const safeCount = Math.max(0, Math.floor(count));
  const safeBonus = Math.max(0, Math.floor(bonusDice));
  const rolls = Array.from({ length: safeCount + safeBonus }, () => dice.die(die))
    .sort((first, second) => second - first);
  return rolls.slice(0, safeCount).reduce((total, roll) => total + roll, 0);
}
