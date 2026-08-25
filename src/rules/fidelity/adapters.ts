/**
 * fidelity/adapters.ts — the ONLY bridge between contract expectation rows
 * and production runtime code.
 *
 * Independence rules enforced here (and tested):
 *
 * - Adapters IMPORT production implementations; the evidence graph
 *   (`types.ts` / `world.ts` / `engine.ts` / contracts) never imports
 *   adapters. One direction only — a dedicated proof/adaptor layer, per the
 *   architecture boundary, not runtime callbacks inside content registries.
 * - Adapters MAP fixture inputs onto real calls and normalize outputs. They
 *   never choose expected values: expectations live in contract rows,
 *   hand-derived from source semantics. An adapter importing an expectation
 *   constant from the implementation it verifies would be circular and is
 *   rejected by review + self-tests.
 * - The evaluator in `evaluate.ts` is generic: the same machinery evaluates
 *   these production adapters and the synthetic mutation fixtures.
 */

import { awardXp, spendLevelUp, abilityPointAllowance, LIMIT_BREAK_UNLOCK_LEVEL } from '../character.js';
import type { IconCharacter } from '../types.js';
import type { AdapterRegistry } from './types.js';

/** Minimal advancement-relevant projection of a character; the adapter casts
 * because awardXp/spendLevelUp only touch these fields plus identity spread. */
interface AdvancementState {
  level: number;
  xp: number;
  pendingLevelUps: number;
  xpAbilityPointClaimed: boolean;
  jobs?: string[];
}

function toCharacter(state: AdvancementState): IconCharacter {
  return {
    jobs: [],
    ...state,
  } as unknown as IconCharacter;
}

interface AwardInput {
  op: 'award';
  char: AdvancementState;
  amount: number;
}

interface SpendInput {
  op: 'spend';
  char: AdvancementState;
  chapterCap: number;
}

interface AllowanceInput {
  op: 'allowance';
  char: AdvancementState;
}

/** Output normalization: only the durable advancement state is compared, so
 * unrelated character fields cannot mask or fake agreement. */
function project(character: IconCharacter) {
  return {
    xp: character.xp,
    pendingLevelUps: character.pendingLevelUps,
    claimed: character.xpAbilityPointClaimed,
    level: character.level,
  };
}

function runAdvancement(input: unknown): unknown {
  const i = input as AwardInput | SpendInput | AllowanceInput | { op: 'limitBreakUnlockLevel' };
  switch (i.op) {
    case 'award': {
      const { char, amount } = i as AwardInput;
      return project(awardXp(toCharacter(char), amount));
    }
    case 'spend': {
      const { char, chapterCap } = i as SpendInput;
      return project(spendLevelUp(toCharacter(char), chapterCap));
    }
    case 'allowance': {
      const { char } = i as AllowanceInput;
      return { allowance: abilityPointAllowance(toCharacter(char)) };
    }
    case 'limitBreakUnlockLevel':
      return { limitBreakUnlockLevel: LIMIT_BREAK_UNLOCK_LEVEL };
  }
}

/**
 * Production adapters for the migrated `advancement` scope. Registered per
 * obligation so the strict audit executes each contract against real code.
 */
export const PRODUCTION_ADAPTERS: AdapterRegistry = new Map([
  ['icon-1.5:advancement:xp-bar-bank', { id: 'character.awardXp/spendLevelUp', run: runAdvancement }],
  ['icon-1.5:advancement:mid-level-ap-boundary', { id: 'character.awardXp/abilityPointAllowance', run: runAdvancement }],
  ['icon-1.5:advancement:limit-break-unlock-level', { id: 'character.limit-break-unlock-level', run: runAdvancement }],
]);
