import { registerAreaModifierRule } from '../../kernels/area.js';

/**
 * Area-modifier content rows (docs/rules-foundations.md §Area).
 *
 * Every row here is an audited AREA shape/size change on its parent ability:
 * the rule feeds the shared `kernels/area.ts` effective-area authority, which
 * the parent resolver reads at command time — so the change is authoritative
 * cell generation, never UI metadata. Arc paths remain player-chosen and are
 * validated by the shared arc geometry (never approximated); blast templates
 * are deliberately NOT here (their exact geometry is visual-only in the
 * source, so blast-requiring units stay unresolved with `blast-template`).
 * The kernel never branches on a source ID: `sourceId` is provenance,
 * `abilityId` selects the parent.
 */

// ICON p.158 Freelancer Soul Shot talent 2: "At round 4 or greater, Soul Shot
// becomes Line 6." Soul Shot's base is a Line 3; the conditional override
// extends the line to 6 from round 4 on (the resolver validates that the
// attack target still lies in the effective line).
registerAreaModifierRule({
  sourceId: 'freelancer:soul-shot:talent:2',
  abilityId: 'freelancer:soul-shot',
  length: 6,
  gates: [{ kind: 'round-at-least', value: 4 }, { kind: 'talent', talent: 2 }],
});

// ICON p.227 Spellblade Sturmreiten mastery (MJÖLLNIR): "Create an arc 5 area
// any time you would create an area with this ability instead." The mastery
// gate replaces Sturmreiten's Line 3 with an Arc 5: the player chooses the
// arc's orthogonal path (input.positions), the shared arc geometry validates
// it (contiguous, orthogonal, no self-overlap, no user space), and the
// resolver teleports to the arc's end and pierces the characters in it.
registerAreaModifierRule({
  sourceId: 'spellblade:sturmreiten:mastery',
  abilityId: 'spellblade:sturmreiten',
  shape: 'arc',
  length: 5,
  gates: [{ kind: 'mastery', abilityId: 'spellblade:sturmreiten' }],
});
