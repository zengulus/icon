/**
 * Action-type-change content rows (F8, docs/rules-foundations.md §K-P7).
 *
 * ICON 1.5 source units with action-type-change semantics modify the effective
 * action cost of a parent ability (e.g. "At round 4 or later, Valiant becomes
 * a free action"). Each row registers one reviewed `ActionTypeModifier` into
 * the kernel (kernels/action-type.ts), which is the single reusable authority
 * consulted by both USE_ABILITY and EXECUTE_RULE before any target validation
 * or RNG.
 *
 * Row kinds:
 * - Mastery rows (requiresMastery = true): the parent ability must be mastered
 *   AND equipped on the actor; the predicate gates on encounter state.
 * - Talent rows (requiresMastery = false): the parent ability must be equipped;
 *   the talent's "active" state is derived from durable encounter state
 *   (terrain effects) so the fold is deterministic under replay.
 *
 * The fold is consulted by:
 * - USE_ABILITY (encounter.ts): effective cost feeds the action-cost gate and
 *   the recorded event's action-cost mutations.
 * - EXECUTE_RULE (encounter.ts): effective cost feeds assertProgramCostsPayable
 *   and the recorded event.
 *
 * Both surfaces consume the SAME validated result, preserving replay
 * compatibility.
 */
import { registerActionTypeModifier } from '../../kernels/action-type.js';

// ── Mastery rows: "At round 4 or later, [ability] becomes a free action" ────

// ICON p.129 Bastion Valiant mastery: "At round 4 or higher in combat, valiant
// becomes a free action."
registerActionTypeModifier({
  sourceId: 'bastion:valiant:mastery',
  abilityId: 'bastion:valiant',
  requiresMastery: true,
  predicate: (state) => state.round >= 4,
  effectiveCost: { kind: 'free', value: 0 },
});

// ICON p.134 Colossus Massive Overhead mastery: "At round 4 or later, Massive
// Overhead also grants you 4 vigor and no longer ends your turn." The action-
// type-change portion (no longer ends your turn = becomes a free action).
registerActionTypeModifier({
  sourceId: 'colossus:massive-overhead:mastery',
  abilityId: 'colossus:massive-overhead',
  requiresMastery: true,
  predicate: (state) => state.round >= 4,
  effectiveCost: { kind: 'free', value: 0 },
});

// ICON p.157 Freelancer Ace mastery: "At round 4 or later, Ace becomes a free
// action to enter if you have not used it yet this combat."
registerActionTypeModifier({
  sourceId: 'freelancer:ace:mastery',
  abilityId: 'freelancer:ace',
  requiresMastery: true,
  predicate: (state) => state.round >= 4,
  effectiveCost: { kind: 'free', value: 0 },
});

// ICON p.168 Shade Shadow Play mastery: "At round 4 or later in combat, Shadow
// Play becomes a free action"
registerActionTypeModifier({
  sourceId: 'shade:shadow-play:mastery',
  abilityId: 'shade:shadow-play',
  requiresMastery: true,
  predicate: (state) => state.round >= 4,
  effectiveCost: { kind: 'free', value: 0 },
});

// ICON p.188 Warden Strength of the Pack mastery: "Cú Chulainn Strength of
// the pack becomes a free action at round 4 or later and its aura affects the
// entire battlefield."
registerActionTypeModifier({
  sourceId: 'warden:strength-of-the-pack:mastery',
  abilityId: 'warden:strength-of-the-pack',
  requiresMastery: true,
  predicate: (state) => state.round >= 4,
  effectiveCost: { kind: 'free', value: 0 },
});

// ICON p.201 Harvester Crimson Bloom mastery: "At round 4 or later, Crimson
// Bloom becomes a free action and its power die starts at 3 ticks."
registerActionTypeModifier({
  sourceId: 'harvester:crimson-bloom:mastery',
  abilityId: 'harvester:crimson-bloom',
  requiresMastery: true,
  predicate: (state) => state.round >= 4,
  effectiveCost: { kind: 'free', value: 0 },
});

// ICON p.222 Seer Polaris mastery: "At round 4+, Polaris becomes a free action."
registerActionTypeModifier({
  sourceId: 'seer:polaris:mastery',
  abilityId: 'seer:polaris',
  requiresMastery: true,
  predicate: (state) => state.round >= 4,
  effectiveCost: { kind: 'free', value: 0 },
});

// ── Talent rows: new free actions gated on ability active state ─────────────

// ICON p.169 Shade Nocturne talent 1: "While Nocturne is active, you may
// teleport up to 2 spaces in or out of the area as a free action." The
// ability is "active" while its nocturne terrain effect persists on the map
// (the terrain is removed when the ability is used again, per source text:
// "This area lasts until this ability is used again").
registerActionTypeModifier({
  sourceId: 'shade:nocturne:talent:1',
  abilityId: 'shade:nocturne',
  requiresMastery: false,
  talentSourceId: 'shade:nocturne:talent:1',
  predicate: (state) =>
    state.terrainEffects.some(
      (effect) => effect.sourceId === 'shade:nocturne' && effect.terrain === 'shadow-cloud',
    ),
  effectiveCost: { kind: 'free', value: 0 },
});

// ICON p.188 Warden Underway talent 1: "While you have stealth, you can create
// a third underway at any point during your turn as a free action. This
// underway is replaced if created again."
registerActionTypeModifier({
  sourceId: 'warden:underway:talent:1',
  abilityId: 'warden:underway',
  requiresMastery: false,
  talentSourceId: 'warden:underway:talent:1',
  predicate: (_state, actor) => actor.conditions.some(c => c.id === 'stealth'),
  effectiveCost: { kind: 'free', value: 0 },
});

// ICON p.210 Enochian Elden Rune talent 1: "You can teleport up to 3 spaces
// into an Elden Rune space as a free action." The rune persists until the
// end of the scene (source text: "The rune lasts until the end of the scene").
registerActionTypeModifier({
  sourceId: 'enochian:elden-rune:talent:1',
  abilityId: 'enochian:elden-rune',
  requiresMastery: false,
  talentSourceId: 'enochian:elden-rune:talent:1',
  predicate: (state) =>
    state.terrainEffects.some(
      (effect) => effect.sourceId === 'enochian:elden-rune' && effect.terrain === 'elden-rune',
    ),
  effectiveCost: { kind: 'free', value: 0 },
});
