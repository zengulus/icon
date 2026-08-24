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

// ── Chanter ─────────────────────────────────────────────────────────────────

// ICON p.179 Gentleness (chanter stance): "When you take this stance, you
// have aura 1. All characters (including yourself) in the aura gain +1 curse
// on attacks…" The aura is active while the stance is held; the +1 curse on
// attacks is the base projection (this row makes the previously documented
// fidelity gap executable through the shared attack-modifier fold).
registerAuraDefinition({
  sourceId: 'chanter:gentleness',
  origin: { kind: 'stance', stanceId: 'gentleness' },
  radius: 1,
  relations: ['characters'],
  includesOrigin: true,
  attackModifiers: { curses: 1 },
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
