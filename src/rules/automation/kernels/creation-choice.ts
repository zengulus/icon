import type { RuleExecutionContext, RuleMutation } from '../primitives/types.js';
import type { PositionQuery } from '../primitives/query.js';
import { evaluatePositions } from './evaluate-query.js';
import { resolveCapturedPositionListChoice } from './choice.js';
import { entityCreationAllowance, validateEntityCreation, type EntityCreationRequest } from './entity-creation.js';
import { RuleProgramViolation } from './violations.js';

/** Recorded entity placement composes U3's region with the ONE creation
 * authority. The reducer receives only the recorded cells, never candidates
 * from which it could silently substitute another player decision. */
export function chooseEntityCreation(
  context: RuleExecutionContext,
  key: string,
  label: string,
  region: PositionQuery,
  request: Omit<EntityCreationRequest, 'positions' | 'duration'> & {
    spatial: { origin: { x: number; y: number }; originSize: number; maxRange?: number };
  },
): Extract<RuleMutation, { kind: 'entity' }> {
  if (!context.encounterState) throw new RuleProgramViolation('creation.state-required', `${label} requires encounter state.`);
  const count = entityCreationAllowance(context.encounterState, request);
  if (count === 0) return {
    kind: 'entity', operation: 'create', sourceId: context.sourceId,
    ownerId: request.ownerId, entityType: request.entityType, category: request.kind,
    positions: [], count: 0, countMode: 'exact', state: request.state, creationSpatial: request.spatial,
  };
  const candidates = evaluatePositions(region, context).filter((position) =>
    validateEntityCreation(context.encounterState!, { ...request, positions: [position], count: 1, countMode: 'exact', duration: null }) !== null);
  const positions = resolveCapturedPositionListChoice({
    key, label, required: count > 0, minimum: count, maximum: count,
  }, candidates, context);
  const validated = validateEntityCreation(context.encounterState, { ...request, count, positions, countMode: 'exact', duration: null });
  if (count > 0 && !validated) throw new RuleProgramViolation('choice.position-unavailable', `${label} cannot create at the recorded positions.`);
  return {
    kind: 'entity', operation: 'create', sourceId: context.sourceId,
    ownerId: request.ownerId, entityType: request.entityType, category: request.kind,
    positions, count, countMode: 'exact', state: request.state,
    creationSpatial: request.spatial,
  };
}
