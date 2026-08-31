import { registerMasteryModifierRule } from '../../kernels/mastery-fold.js';

/**
 * Reviewed mastery modifier rows (content/jobs).
 *
 * Each row decomposes one mastered clause of a source mastery into a typed
 * modifier family of the mastery-fold kernel (kernels/mastery-fold.ts); the
 * kernel executes it wherever the engine reads that authority, gated on the
 * parent being equipped AND mastered AND the source conditions. A clause
 * whose complete semantics do not fit a family stays out of this file with
 * its documented remaining kernel need (content/jobs/mastery-recipes.ts).
 */

// ICON p.123 MANGONEL (Catapult): "Catapult becomes Interrupt 3" — the
// interrupt's rank (= per-round uses, p.91) overrides 1 → 3.
registerMasteryModifierRule({
  sourceId: 'bastion:catapult:mastery',
  abilityId: 'bastion:catapult',
  gate: { kind: 'always' },
  modifier: { kind: 'interrupt-rank', rank: 3 },
});

// ICON p.225 EXCALIBUR (Nothung): "All 1 piercing damage listed by this
// ability becomes divine" — every piercing instance Nothung's resolver emits
// (the adjacent-character strikes and the GRAM flurry) delivers as divine.
registerMasteryModifierRule({
  sourceId: 'spellblade:nothung:mastery',
  abilityId: 'spellblade:nothung',
  gate: { kind: 'always' },
  modifier: { kind: 'damage-type', from: 'piercing', to: 'divine' },
});

// ICON p.122 PERFECT BATTLEMENT (Endless Battlement), round-4 clauses:
// "…has no maximum range … and becomes interrupt 2." The damage clause
// ("deals 4 damage instead of 2") is the parent interrupt resolver's own
// program-level fold (programs/bastion-programs.ts) — it changes a value,
// not one of this kernel's families.
registerMasteryModifierRule({
  sourceId: 'bastion:endless-battlement:mastery',
  abilityId: 'bastion:endless-battlement',
  gate: { kind: 'round-at-least', value: 4 },
  modifier: { kind: 'interrupt-rank', rank: 2 },
});
registerMasteryModifierRule({
  sourceId: 'bastion:endless-battlement:mastery',
  abilityId: 'bastion:endless-battlement',
  gate: { kind: 'round-at-least', value: 4 },
  modifier: { kind: 'unlimited-range' },
});

// ICON p.158 PHANTOM BOLTS (Warding Bolts): "You can cause the area to hover
// around you as an Aura 2 instead, which lasts for the rest of combat … when
// the ability triggers again, you may deal 2 unerring damage to all foes in
// this aura instead of replacing the aura." The mastered interrupt is
// Repeatable for the mastered actor (p.290-style): using Warding Bolts again
// while the aura is active re-triggers it rather than being blocked by the
// p.91 No Repeats rule or the actor-local one-interrupt-per-turn window/pool.
// The row's resolver already branches on `hasMastery` + aura-active for the
// retrigger damage; this row is what makes the retrigger LEGAL to issue, and
// the reducer skips recording usage marks for a repeatable action.
registerMasteryModifierRule({
  sourceId: 'freelancer:warding-bolts:mastery',
  abilityId: 'freelancer:warding-bolts',
  gate: { kind: 'always' },
  modifier: { kind: 'repeatable' },
});
