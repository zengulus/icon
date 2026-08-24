import { resolveAuthoritativeAttack, type AuthoritativeAttackResult } from './attack-resolution.js';
import type { RuleActorView, RuleExecutionContext, RuleMutation } from '../primitives/types.js';

/** Build the recorded ordinary attack and its direct damage from one resolved authority. */
export function resolveOrdinaryAttackMutations(
  context: RuleExecutionContext,
  source: RuleActorView,
  target: RuleActorView,
  diceCount: number,
  options: Parameters<typeof resolveAuthoritativeAttack>[3] = {},
  bonusDice = 0,
): { attack: AuthoritativeAttackResult; mutations: RuleMutation[] } {
  const attack = resolveAuthoritativeAttack(context, source, target, options);
  const baseDice = attack.hit
    ? Array.from({ length: Math.max(0, diceCount) }, () => context.dice.die(attack.damageDie))
    : [];
  const criticalDice = attack.hit && attack.critical
    ? [context.dice.die(attack.damageDie)]
    : [];
  const extraDice = attack.hit
    ? Array.from({ length: Math.max(0, bonusDice) }, () => context.dice.die(attack.damageDie))
    : [];
  const allDice = [...baseDice, ...criticalDice, ...extraDice];
  const keptDice = allDice.slice().sort((first, second) => second - first).slice(0, Math.max(0, diceCount));
  // A critical adds one damage die; it is additive, not another bonus die
  // subject to keep-highest selection. Bonus-damage charges, by contrast,
  // increase the pool and keep the highest ordinary attack dice.
  const criticalTotal = criticalDice.reduce((sum, roll) => sum + roll, 0);
  const keptBaseAndBonus = [...baseDice, ...extraDice].sort((first, second) => second - first).slice(0, Math.max(0, diceCount));
  const amount = attack.hit
    ? source.fray + keptBaseAndBonus.reduce((sum, roll) => sum + roll, 0) + criticalTotal + attack.damageProvenance.bonusFlat
    : source.fray;
  const damage: RuleMutation = {
    kind: 'damage', sourceId: context.sourceId, sourceActorId: source.id, actorId: target.id,
    amount, damageType: 'normal', instance: 1, delivery: attack.hit ? 'hit' : 'miss',
    ignoreCover: attack.damageProvenance.ignoreCover,
    ...(attack.damageProvenance.ignoreDodge ? { ignoreDodge: true } : {}),
    ...(attack.damageProvenance.ignoreAetherwall ? { ignoreAetherwall: true } : {}),
  };
  return { attack, mutations: [attack.attackMutation, damage] };
}
