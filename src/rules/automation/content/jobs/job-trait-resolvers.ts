import { RuleProgramViolation } from '../../kernels/runtime.js';
import { resolveAttackTarget, resolveSourceActor } from '../glue/reference-authoring.js';
import type { RuleMutation, RuleResolver, RuleResolverRegistry } from '../../primitives/types.js';

/**
 * F6 active Job-trait resolvers (docs/rules-foundations.md §7).
 *
 * The Job traits with a typed, source-reviewable activation resolve here,
 * mirroring `CLASS_RULE_RESOLVERS` for the class traits. Every resolver is
 * deterministic and keyed by the exact source ID; passive/lifecycle traits
 * never appear in this registry (they live in `passive-projection.ts` and
 * `turn-transition.ts`), and the `JOB_TRAIT_RECIPES` inventory is the only
 * authority for which trait is wired vs. documented.
 */

/** ICON p.141 Knave Taunt: "A foe in range 3 gains hatred of you." The free
 * action targets one foe in range 3 (range-checked by the EXECUTE_RULE gate);
 * the hatred condition's `sourceActorId` is the user, which the reducer
 * records as the durable `hatred-of` provenance the damage pipeline halves
 * against (p.104). */
const tauntResolver: RuleResolver = (context) => {
  // The defensive gate stays caller-owned (U4 cardinality / gate validation):
  // Requiring attackTargetId routes the target through the generic
  // range/line-of-sight gate. The reference itself (target, source) resolves
  // through the U1 content-authoring adapter.
  if (!context.attackTargetId) throw new RuleProgramViolation('choice.actor-count', 'Taunt requires one foe in range 3.');
  // The caller-owned gate above guarantees the slot; the adapter still
  // fail-closes (reference.missing-actor) if a nameless actor vanished.
  const target = resolveAttackTarget(context)!;
  const source = resolveSourceActor(context);
  if (target.side === source.side) {
    throw new RuleProgramViolation('choice.actor-relation', 'Taunt can only target a foe.');
  }
  const mutations: RuleMutation[] = [{
    kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id,
    conditionId: 'hatred', operation: 'apply', potency: 'normal',
  }];
  // The hatred condition application records `hatred-of` from the mutation's
  // sourceActorId; make the provenance explicit here so the rule state stays
  // canonical even if a future condition path changes.
  return mutations;
};

/** ICON p.209 Spellblade Klingenkunst: "Teleport 2." The free action moves
 * the user to a chosen in-grid space within range 2 (validated here; the F1
 * spatial gateway re-validates bounds/occupancy/rampart on application). The
 * interrupt-other-abilities-or-movement utility is a timing choice and stays
 * table-facing. */
const klingenkunstResolver: RuleResolver = (context) => {
  const destination = context.input.positions?.destination?.[0];
  if (!destination) throw new RuleProgramViolation('choice.position-required', 'Klingenkunst requires a destination within range 2.');
  const source = resolveSourceActor(context);
  if (!source.position) throw new RuleProgramViolation('actor.unavailable', 'The user cannot teleport from off the battlefield.');
  const grid = context.state.grid;
  if (destination.x < 0 || destination.y < 0 || destination.x >= grid.width || destination.y >= grid.height) {
    throw new RuleProgramViolation('move.out-of-bounds', 'Klingenkunst destination is outside the battlefield.');
  }
  if (Math.max(Math.abs(destination.x - source.position.x), Math.abs(destination.y - source.position.y)) > 2) {
    throw new RuleProgramViolation('move.range', 'Klingenkunst teleports at most 2 spaces.');
  }
  return [{
    kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: context.actorId,
    movement: 'teleport', distance: 2, positions: [{ ...destination }], direction: null, phasing: false,
  }];
};

export const JOB_TRAIT_RULE_RESOLVERS: RuleResolverRegistry = {
  'knave:trait:taunt': tauntResolver,
  'spellblade:trait:klingenkunst': klingenkunstResolver,
};
