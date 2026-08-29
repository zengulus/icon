// Content registry: importing the barrel registers every content module's
// kernel rows (lifecycle recipes, passive projections, attack modifiers,
// content encounter hooks) before any command runs.
import './content/registry.js';

// ---------------------------------------------------------------------------
// primitives — content-agnostic vocabulary and pure computation
// ---------------------------------------------------------------------------
export * from './primitives/types.js';
export * from './primitives/anchor.js';
export * from './primitives/job-kit.js';
export * from './primitives/foe-kit.js';
export * from './primitives/targeting.js';
export * from './primitives/spatial-intent.js';
export * from './primitives/attack-resolution.js';
export * from './primitives/damage-resolution.js';
export * from './primitives/save-window.js';
export * from './primitives/status-saves.js';

// ---------------------------------------------------------------------------
// kernels — shared mechanics + registry machinery (no source IDs)
// ---------------------------------------------------------------------------
export * from './kernels/runtime.js';
export * from './kernels/evaluate-query.js';
export * from './kernels/encounter-adapter.js';
export * from './kernels/damage-ledger.js';
export * from './kernels/trigger-window.js';
export * from './kernels/core-resolvers.js';
export * from './kernels/lifecycle.js';
export * from './kernels/passive-projection.js';
export * from './kernels/attack-modifiers.js';
export * from './kernels/talent-recipes.js';
export * from './kernels/foe-recipes.js';
export * from './kernels/foe-trait-recipes.js';
export * from './kernels/summon-recipes.js';

// ---------------------------------------------------------------------------
// content — source-ID rows + glue (registry import above runs registration)
// ---------------------------------------------------------------------------
export * from './content/glue/compiler.js';
export * from './content/glue/manual-programs.js';
export * from './content/glue/resolvers.js';
export * from './content/classes/class-resolvers.js';
export * from './content/classes/trait-condition-recipes.js';
export * from './content/jobs/job-trait-recipes.js';
export * from './content/jobs/job-trait-resolvers.js';
export * from './content/jobs/trait-condition-recipes.js';
export * from './content/jobs/lifecycle-recipes.js';
export * from './content/jobs/attack-modifier-recipes.js';
export * from './content/jobs/talent-recipes.js';
export * from './content/jobs/summon-recipes.js';
export * from './content/jobs/encounter-hooks.js';
export * from './content/jobs/programs/bastion-programs.js';
export * from './content/jobs/programs/demon-slayer-programs.js';
export * from './content/jobs/programs/colossus-programs.js';
export * from './content/jobs/programs/knave-programs.js';
export * from './content/jobs/programs/fool-programs.js';
export * from './content/jobs/programs/freelancer-programs.js';
export * from './content/jobs/programs/shade-programs.js';
export * from './content/jobs/programs/warden-programs.js';
export * from './content/jobs/programs/chanter-programs.js';
export * from './content/jobs/programs/harvester-programs.js';
export * from './content/jobs/programs/sealer-programs.js';
export * from './content/jobs/programs/seer-programs.js';
export * from './content/jobs/programs/enochian-programs.js';
export * from './content/jobs/programs/geomancer-programs.js';
export * from './content/jobs/programs/spellblade-programs.js';
export * from './content/jobs/programs/stormbender-programs.js';
export * from './content/foes/role-baseline-recipes.js';
export * from './content/foes/turn-entitlement-recipes.js';
export * from './content/foes/mark-recipes.js';
export * from './content/foes/ability-recipes.js';
export * from './content/foes/trait-recipes.js';
