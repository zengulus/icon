import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, createEncounter, createFoe } from '../encounter.js';
import { bonusDamageDiceForUse, registerBonusDamageRule, registerTraitBonusDamageRule, type BonusDamageGate } from '../automation/kernels/bonus-damage.js';
import { validCharacter } from './fixtures.js';

// Characterization before consolidating the numeric/scaled/trait gate paths.
// ICON p.81 + adopted base-max adjudication, p.142 Low Blow TI (status),
// p.187 Dark Sliver TI (Comeback), p.225 Nothung TI (bloodied foe).
const gates: BonusDamageGate[] = [
  { kind: 'always' }, { kind: 'self-bloodied' }, { kind: 'target-bloodied' },
  { kind: 'target-has-condition' }, { kind: 'target-has-condition', conditionId: 'dazed' },
];
for (const [index, gate] of gates.entries()) {
  registerBonusDamageRule({ sourceId: `test:gate:numeric:${index}`, abilityId: `test:numeric:${index}`, gate, dice: 1 });
  registerBonusDamageRule({ sourceId: `test:gate:scaled:${index}`, abilityId: `test:scaled:${index}`, gate, dice: () => 1 });
  registerTraitBonusDamageRule({ sourceId: `test:gate:trait:${index}`, traitId: `test:trait:${index}`, gate, dice: 1 });
}

describe('shared bonus-damage applicability', () => {
  it.each([
    ['healthy', 30, 30, false, undefined, true],
    ['self exact half', 20, 30, false, undefined, true],
    ['self above half', 21, 30, false, undefined, true],
    ['foe exact half', 30, 20, false, undefined, true],
    ['foe above half', 30, 21, false, undefined, true],
    ['allied bloodied target', 20, 10, true, 'dazed', true],
    ['hostile matching status', 30, 30, false, 'dazed', true],
    ['hostile other status', 30, 30, false, 'blind', true],
    ['missing target', 20, 20, false, 'dazed', false],
  ] as const)('%s: numeric, scaled, and trait rows agree', (_name, hp, targetHp, allied, status, targetPresent) => {
    const state = createEncounter('Gate parity');
    const actor = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    const target = createFoe('Target', { x: 3, y: 1 });
    actor.hp = hp; actor.baseMaxHp = 40; actor.wounds = 1; // wounds do not move the threshold
    target.hp = targetHp; target.baseMaxHp = 40; target.wounds = 1;
    if (allied) target.side = actor.side;
    if (status) target.conditions.push({ id: status, potency: 'normal', sourceId: 'test:status', ownerId: null, duration: null });
    state.actors = { [actor.id]: actor, ...(targetPresent ? { [target.id]: target } : {}) };
    actor.abilityIds = gates.flatMap((_, index) => [`test:numeric:${index}`, `test:scaled:${index}`]);
    const expected = [true, hp <= 20, targetPresent && !allied && targetHp <= 20, targetPresent && !allied && status !== undefined, targetPresent && !allied && status === 'dazed'];
    for (const index of gates.keys()) {
      actor.traitIds = [];
      expect(bonusDamageDiceForUse(state, actor, `test:numeric:${index}`, [target.id])).toBe(Number(expected[index]));
      expect(bonusDamageDiceForUse(state, actor, `test:scaled:${index}`, [target.id])).toBe(Number(expected[index]));
      actor.traitIds = [`test:trait:${index}`];
      expect(bonusDamageDiceForUse(state, actor, 'test:trait-use', [target.id])).toBe(Number(expected[index]));
    }
  });
});
