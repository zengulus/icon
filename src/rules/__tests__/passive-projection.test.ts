import { describe, expect, it } from 'vitest';
import { PASSIVE_TRAIT_CONDITION_RECIPES, projectedPassiveConditions } from '../automation/passive-projection.js';

describe('closed passive-condition projection registry', () => {
  it('projects only reviewed character and foe source IDs', () => {
    expect([...projectedPassiveConditions([
      'vagabond:trait:skirmisher',
      'basic:hellion:302:trait:special-traits',
      'unknown:trait:flying-and-sturdy',
    ])].sort()).toEqual(['flying', 'skirmisher']);
  });

  it('keeps the character registry auditable instead of deriving conditions from prose', () => {
    expect(PASSIVE_TRAIT_CONDITION_RECIPES['wright:trait:aetherwall']).toEqual(['aetherwall']);
    expect(PASSIVE_TRAIT_CONDITION_RECIPES['basic:hellion:302:trait:special-traits']).toBeUndefined();
  });
});
