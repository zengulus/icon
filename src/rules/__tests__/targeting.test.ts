import { describe, expect, it } from 'vitest';
import { eligibleTargets, isEligibleTarget, matchesTargetRelation, queryDirectTarget } from '../automation/targeting.js';

const source = { id: 'hero', side: 'heroes', position: { x: 1, y: 1 }, defeated: false };
const ally = { id: 'ally', side: 'heroes', position: { x: 2, y: 1 }, defeated: false };
const foe = { id: 'foe', side: 'foes', position: { x: 3, y: 1 }, defeated: false };
const defeatedFoe = { id: 'fallen', side: 'foes', position: { x: 4, y: 1 }, defeated: true };
const offBoardFoe = { id: 'away', side: 'foes', position: null, defeated: false };

describe('shared target eligibility', () => {
  it('keeps self and ally distinct under the ICON p.92 relation contract', () => {
    expect(matchesTargetRelation(source, source, 'self')).toBe(true);
    expect(matchesTargetRelation(source, source, 'ally')).toBe(false);
    expect(matchesTargetRelation(source, ally, 'ally')).toBe(true);
    expect(matchesTargetRelation(source, foe, 'foe')).toBe(true);
  });

  it('excludes defeated and off-board candidates unless a future explicit query opts in', () => {
    expect(eligibleTargets(source, [source, ally, foe, defeatedFoe, offBoardFoe], { relation: 'foe' }).map(({ id }) => id)).toEqual(['foe']);
    expect(isEligibleTarget(source, defeatedFoe, { relation: 'foe', includeDefeated: true })).toBe(true);
    expect(isEligibleTarget(source, offBoardFoe, { relation: 'foe', includeOffBattlefield: true })).toBe(true);
  });

  it('centralizes Blind, True Strike, Stealth, range, and line-of-sight ordering for one direct target', () => {
    const blinded = queryDirectTarget(source, foe, {
      relation: 'foe', maximumRange: 4, sourceBlind: true, requireLineOfSight: true, hasLineOfSight: true,
    });
    expect(blinded).toMatchObject({ legal: true, maximumRange: 2, distance: 2 });

    const tooFarWhileBlind = queryDirectTarget(source, { ...foe, position: { x: 4, y: 1 } }, {
      relation: 'foe', maximumRange: 4, sourceBlind: true, requireLineOfSight: true, hasLineOfSight: true,
    });
    expect(tooFarWhileBlind).toMatchObject({ legal: false, problem: 'range', maximumRange: 2 });

    const trueStrike = queryDirectTarget(source, { ...foe, position: { x: 4, y: 1 } }, {
      relation: 'foe', maximumRange: 4, sourceBlind: true, targetStealth: true, trueStrike: true,
      requireLineOfSight: true, hasLineOfSight: true,
    });
    expect(trueStrike).toMatchObject({ legal: true, maximumRange: 4 });

    const blocked = queryDirectTarget(source, foe, {
      relation: 'foe', maximumRange: 4, requireLineOfSight: true, hasLineOfSight: false,
    });
    expect(blocked).toMatchObject({ legal: false, problem: 'line-of-sight' });
  });

  it('treats an actor retained at a last-known cell as unavailable after leaving the battlefield', () => {
    expect(queryDirectTarget(source, { ...foe, onBattlefield: false }, {
      relation: 'foe', maximumRange: 4,
    })).toMatchObject({ legal: false, problem: 'unavailable' });
  });
});
