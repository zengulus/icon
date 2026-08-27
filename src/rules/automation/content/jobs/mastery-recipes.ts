import { registerMasteryRecipe } from '../../kernels/mastery.js';

/**
 * Reviewed mastery rows (content/jobs).
 *
 * A mastery is not an independently activated ability — it modifies or
 * extends the ability that owns it. Each row declares its attachment kind
 * (how the mastery participates in the parent ability's existing resolver,
 * lifecycle, or passive authority) through the generic mastery kernel; the
 * kernel never branches on a source ID. Implemented rows execute through
 * the parent's authoritative path (a resolver fold, a program-level branch,
 * a continuous aura projection, or a lifecycle recipe) and audit as
 * complete. Unimplemented rows would stay source-visible with their
 * documented remaining kernel need.
 */

registerMasteryRecipe({
  sourceId: 'bastion:rook:mastery',
  abilityId: 'bastion:rook',
  name: 'Implacable Fortress',
  status: 'implemented',
  attachment: 'continuous',
  mechanic: 'While Rook\'s aura is active, allies in it reduce all damage by 2 as if by armor (the aura kernel\'s armorBonus projection folds into the shared damage authority, p.123).',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'knave:dark-knight:mastery',
  abilityId: 'knave:dark-knight',
  name: 'Infectious Hatred',
  status: 'implemented',
  attachment: 'lifecycle',
  mechanic: 'While in Dark Knight, the mastered user has Aura 1 (a stance-origin aura gated on mastery); foes that end their turn in the aura save (the command boundary pre-rolls the save) or gain hatred of the user, p.143.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'knave:intimidate:mastery',
  abilityId: 'knave:intimidate',
  name: 'Iron Skull',
  status: 'implemented',
  attachment: 'fold',
  mechanic: 'When Intimidate\'s stun triggers (the turn-start mark resolution), the mastered user also becomes unstoppable until the end of their next turn, p.143.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'knave:bleak-mercy:mastery',
  abilityId: 'knave:bleak-mercy',
  name: 'Painkiller',
  status: 'implemented',
  attachment: 'program-level',
  mechanic: 'Sweet Torment\'s aura lasts indefinitely (combat duration) once gained; using Sweet Torment again while the aura is active deals 2 damage once to every foe in the aura per status they suffer (max 3), instead of re-gaining the aura, p.144.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'freelancer:warding-bolts:mastery',
  abilityId: 'freelancer:warding-bolts',
  name: 'Phantom Bolts',
  status: 'implemented',
  attachment: 'program-level',
  mechanic: 'Warding Bolts can hover as an Aura 2 around the mastered user for the rest of combat with the same start-in/end-out strike; using it again while the aura is active deals 2 unerring damage to all foes in the aura instead of replacing it, p.158.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'chanter:gentleness:mastery',
  abilityId: 'chanter:gentleness',
  name: 'Gentle Prayer',
  status: 'implemented',
  attachment: 'program-level',
  mechanic: 'When the Gentleness aura refreshes, the mastered user may resize the aura by +1 (max 3, min 1); when they do, foes inside save or are pacified, p.179.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'spellblade:rampant-nail:mastery',
  abilityId: 'spellblade:rampant-nail',
  name: 'Voracious Nail',
  status: 'implemented',
  attachment: 'lifecycle',
  mechanic: 'Characters that start their turn adjacent to the nail become vulnerable (turn-start lifecycle grant); vulnerable characters are vulnerable+ instead while inside the nail\'s aura (an upgrade-only aura projection), p.227.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'spellblade:sturmreiten:mastery',
  abilityId: 'spellblade:sturmreiten',
  name: 'Mjölnir',
  status: 'implemented',
  attachment: 'program-level',
  mechanic: 'Any area Sturmreiten would create is an arc 5 instead (the shared area kernel\'s shape override, gated on mastery): the player chooses the arc\'s orthogonal path, the arc geometry validates it (contiguous, orthogonal, no self-overlap, never the user\'s space), and the resolver teleports to the arc\'s end and pierces the characters in it, p.227.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'bastion:catapult:mastery',
  abilityId: 'bastion:catapult',
  name: 'MANGONEL',
  status: 'implemented',
  attachment: 'fold',
  mechanic: 'Catapult becomes Interrupt 3 — the mastery-fold kernel\'s interrupt-rank override (uses per round 1 → 3), consumed at the USE_ABILITY interrupt gate so the extra uses are mechanically real, p.123.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'spellblade:nothung:mastery',
  abilityId: 'spellblade:nothung',
  name: 'EXCALIBUR',
  status: 'implemented',
  attachment: 'fold',
  mechanic: 'All 1 piercing damage listed by Nothung becomes divine — every piercing instance the resolver emits (the adjacent-character strikes and the GRAM flurry) asks the mastery-fold kernel\'s damage-type conversion and delivers through the shared damage pipeline\'s divine semantics (bypasses Defiance and vigor), p.225.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'demon-slayer:demon-claw:mastery',
  abilityId: 'demon-slayer:demon-claw',
  name: 'RAGING DEMON',
  status: 'implemented',
  attachment: 'program-level',
  mechanic: 'Demon Claw\u2019s damage increases by 1 for every 25% of the user\u2019s maximum hp they are missing, up to a maximum of +3 — the resolver reads the mastered gate (the shared hasMastery surface) and the BASE class maximum from current state at use time (p.107 % HEALTH: percentage-of-health damage always considers maximum base hp, not the wounds-adjusted maximum) and adds the flat bonus to each 2-damage instance, p.129.',
  detail: '',
});

registerMasteryRecipe({
  sourceId: 'bastion:endless-battlement:mastery',
  abilityId: 'bastion:endless-battlement',
  name: 'PERFECT BATTLEMENT',
  status: 'implemented',
  attachment: 'program-level',
  mechanic: 'At round 4 or higher: Endless Battlement has no maximum range (the mastery-fold unlimited-range rule collapses both the stance-enter ally-selection bound and the window-scan aura-range bound); Heroic Intervention deals 4 damage instead of 2 (the resolver\'s program-level value fold); and it becomes interrupt 2 (the kernel\'s round-gated interrupt-rank override consumed by the uses-ability window scan), p.122.',
  detail: '',
});
