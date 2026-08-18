export interface DiceSource {
  die(sides: number): number;
}

export const randomDice: DiceSource = {
  die: (sides) => Math.floor(Math.random() * sides) + 1,
};

export function seededDice(seed: number): DiceSource {
  let state = seed >>> 0;
  return {
    die(sides) {
      state = (state * 1664525 + 1013904223) >>> 0;
      return Math.floor((state / 0x1_0000_0000) * sides) + 1;
    },
  };
}

export function rollBoonOrCurse(amount: number, dice: DiceSource): { rolls: number[]; modifier: number } {
  const net = Math.max(-2, Math.min(2, amount));
  if (net === 0) return { rolls: [], modifier: 0 };
  const rolls = Array.from({ length: Math.abs(net) }, () => dice.die(6));
  const value = Math.max(...rolls);
  return { rolls, modifier: net > 0 ? value : -value };
}

export interface NarrativeRoll {
  dice: number[];
  kept: number;
  result: 'failure' | 'cost' | 'success' | 'critical';
  zeroRating: boolean;
}

export function rollNarrativeAction(rating: number, boonCurse: number, dice: DiceSource = randomDice): NarrativeRoll {
  const net = Math.max(-2, Math.min(2, boonCurse));
  const count = rating + net;
  const zeroRating = count <= 0;
  const rolled = Array.from({ length: zeroRating ? 2 : count }, () => dice.die(6));
  const sorted = [...rolled].sort((a, b) => b - a);
  const kept = zeroRating ? Math.min(...rolled) : sorted[0];
  const critical = !zeroRating && sorted[0] === 6 && sorted[1] === 6;
  return {
    dice: rolled,
    kept,
    result: critical ? 'critical' : kept === 6 ? 'success' : kept >= 4 ? 'cost' : 'failure',
    zeroRating,
  };
}

export function rollDamage(die: number, count: number, bonusDice: number, dice: DiceSource): { rolls: number[]; kept: number[]; total: number } {
  const rolls = Array.from({ length: count + Math.max(0, bonusDice) }, () => dice.die(die));
  const kept = [...rolls].sort((a, b) => b - a).slice(0, count);
  return { rolls, kept, total: kept.reduce((sum, value) => sum + value, 0) };
}
