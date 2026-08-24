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
