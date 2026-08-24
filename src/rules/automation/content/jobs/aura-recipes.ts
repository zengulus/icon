import { registerAuraDefinition } from '../../kernels/aura.js';

/**
 * Reviewed job/class aura rows (content/jobs).
 *
 * Each `registerAuraDefinition` row is one source aura: origin resolution,
 * radius, relations, and the ephemeral projection onto current members. The
 * rows below deliberately contain no runtime prose interpretation — every
 * mechanic is either this registry entry, an ability-program mutation, or a
 * lifecycle recipe.
 */

// ── Bastion ─────────────────────────────────────────────────────────────────

// ICON p.121 Shieldmaster (bastion trait): "You have aura 1. If you end your
// turn with an ally in the aura, gain vigilance +1 and become sturdy until
// the start of your turn." The aura itself projects nothing; the turn-end
// membership query is the lifecycle recipe (lifecycle-recipes.ts).
registerAuraDefinition({
  sourceId: 'bastion:trait:shieldmaster',
  origin: { kind: 'actor-trait', traitId: 'bastion:trait:shieldmaster' },
  radius: 1,
  relations: ['allies'],
  includesOrigin: false,
});

// ICON p.123 Rook: "You gain aura 1 until the end of your next turn …
// Heroic: … increase aura to Aura 2." The Rook ability program already holds
// the durable aura effect (the aura's lifetime + radius record); this row
// interprets it. Rook talent 1 ("You also have counter while Rook's aura is
// active") is the projection, gated on the equipped talent so the base aura
// grants nothing by itself.
registerAuraDefinition({
  sourceId: 'bastion:rook',
  origin: { kind: 'aura-effect' },
  radius: 1,
  relations: [],
  includesOrigin: true,
  talentGate: { abilityId: 'bastion:rook', talent: 1 },
  conditions: ['counter'],
});

// ICON p.123 Rook mastery (Implacable Fortress): "Allies in the aura also
// reduce all damage by 2, as if by armor." A separate row interprets the same
// durable aura effect (its provenance is the ability id) under the mastery's
// own provenance, gated on the mastered parent: only mastered users project
// the armor bonus onto their allies, and the base/talent-1 rows above stay
// unchanged for unmastered users.
registerAuraDefinition({
  sourceId: 'bastion:rook:mastery',
  origin: { kind: 'aura-effect', sourceId: 'bastion:rook' },
  radius: 1,
  relations: ['allies'],
  includesOrigin: false,
  masteryGate: { abilityId: 'bastion:rook' },
  armorBonus: 2,
});

// ── Chanter ─────────────────────────────────────────────────────────────────

// ICON p.179 Gentleness (chanter stance): "When you take this stance, you
// have aura 1. All characters (including yourself) in the aura gain +1 curse
// on attacks…" The aura is active while the stance is held; the +1 curse on
// attacks is the base projection (this row makes the previously documented
// fidelity gap executable through the shared attack-modifier fold). The
// radiusStateKey lets the Gentle Prayer mastery (p.179) resize the aura by
// ±1 (max 3, min 1) through the same shared authority.
registerAuraDefinition({
  sourceId: 'chanter:gentleness',
  origin: { kind: 'stance', stanceId: 'gentleness' },
  radius: 1,
  relations: ['characters'],
  includesOrigin: true,
  attackModifiers: { curses: 1 },
  radiusStateKey: 'gentleness:aura-radius',
});

// ICON p.179 Gentleness talent 1: "Yourself and allies inside the aura also
// have counter in this stance." The counter projects onto the same stance
// aura, gated on the equipped talent.
registerAuraDefinition({
  sourceId: 'chanter:gentleness:talent:1',
  origin: { kind: 'stance', stanceId: 'gentleness' },
  radius: 1,
  relations: ['allies'],
  includesOrigin: true,
  talentGate: { abilityId: 'chanter:gentleness', talent: 1 },
  conditions: ['counter'],
  radiusStateKey: 'gentleness:aura-radius',
});

// ── Knave ───────────────────────────────────────────────────────────────────

// ICON p.144 Knave Bleak Mercy combo (Sweet Torment): "aura 1 — foes in the
// active aura cannot be cured or save clear statuses." The combo program
// holds the durable aura effect; the status-save policy hook (encounter-
// hooks.ts) asks the shared kernel who is inside instead of re-measuring
// distance.
registerAuraDefinition({
  sourceId: 'knave:bleak-mercy',
  origin: { kind: 'aura-effect' },
  radius: 1,
  relations: ['foes'],
  includesOrigin: false,
});

// ── Knave (mastery) ─────────────────────────────────────────────────────────

// ICON p.143 Dark Knight mastery (Infectious Hatred): "While in Dark Knight,
// you have Aura 1. Foes that end their turn in the aura must save or gain
// hatred of you." The stance-origin aura is gated on the mastered parent
// (only mastered dark knights emanate it) and projects nothing itself — the
// turn-end save-or-hatred is the lifecycle recipe, which asks the shared
// kernel who is inside.
registerAuraDefinition({
  sourceId: 'knave:dark-knight:mastery',
  origin: { kind: 'stance', stanceId: 'dark-knight' },
  radius: 1,
  relations: ['foes'],
  includesOrigin: false,
  masteryGate: { abilityId: 'knave:dark-knight' },
});

// ── Freelancer (mastery) ────────────────────────────────────────────────────

// ICON p.158 Warding Bolts mastery (Phantom Bolts): "You can cause the area
// to hover around you as an Aura 2 instead, which lasts for the rest of
// combat, with the same effect as the default area." The mastered resolver
// emits the durable `phantom-bolts` aura effect (combat duration); this row
// interprets it (the effect's provenance is the ability id) gated on the
// mastered parent. The aura projects nothing by itself — the start-in/end-out
// strike is the lifecycle recipe, and the retrigger damage is the resolver.
registerAuraDefinition({
  sourceId: 'freelancer:warding-bolts:mastery',
  origin: { kind: 'aura-effect', sourceId: 'freelancer:warding-bolts' },
  radius: 2,
  relations: ['foes'],
  includesOrigin: false,
  masteryGate: { abilityId: 'freelancer:warding-bolts' },
});

// ── Spellblade (mastery) ────────────────────────────────────────────────────

// ICON p.227 Rampant Nail mastery (Voracious Nail): "Vulnerable characters
// are vulnerable+ instead while inside the nail's aura." The nail's aura
// emanates from the lightning-spike entity; the upgrade-only row never
// GRANTS vulnerable (that is the turn-start adjacency lifecycle grant) — it
// only upgrades the potency of a vulnerable character while inside, and the
// upgrade disappears the moment they leave (no stale snapshot).
registerAuraDefinition({
  sourceId: 'spellblade:rampant-nail:mastery',
  origin: { kind: 'entity-type', entityType: 'lightning-spike' },
  radius: 2,
  relations: ['characters'],
  includesOrigin: false,
  masteryGate: { abilityId: 'spellblade:rampant-nail' },
  conditions: ['vulnerable'],
  conditionPotencies: { vulnerable: 'plus' },
  upgradeOnly: true,
});

// ── Chanter ─────────────────────────────────────────────────────────────────

// ICON p.178 Dervish talent 1: "A swirling aura 1 of winds surrounds you
// after taking this ability until the start of your next turn, granting you
// and allies inside counter." The Dervish ability program emits the durable
// aura effect when the talent is equipped; this row interprets it.
registerAuraDefinition({
  sourceId: 'chanter:dervish',
  origin: { kind: 'aura-effect' },
  radius: 1,
  relations: ['allies'],
  includesOrigin: true,
  conditions: ['counter'],
});
