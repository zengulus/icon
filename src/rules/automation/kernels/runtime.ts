import { costContextFromRuntime, effectiveRuleCosts, evaluateCosts, ruleCostMutations } from './cost-payment.js';
import { applyOrdering } from '../primitives/ordering.js';
import { RuleProgramViolation } from './violations.js';
// The U5 VALUE algebra (`evaluateNumber`) and its selector read surface
// (`selectActors`) plus the U6 PREDICATE algebra (`evaluatePredicate`) live
// in their semantic modules; this barrel re-exports them for the migration
// duration (the split plan's "runtime.ts stays a compatibility barrel").
import { integer } from './evaluate-value.js';
import { evaluatePredicate } from './evaluate-predicate.js';
// The U11 FLOW authority (kernels/execute-flow.ts) owns ordered rule
// execution against the PURE SIMULATED intermediate encounter state;
// `executeRuleProgram` plans through it and this barrel re-exports it.
import { FlowPlanner, effectsToMutations } from './execute-flow.js';
import type { SaveWindowKind, SaveWindowModifiers } from '../primitives/save-window.js';
import type {
  RuleAction,
  RuleEffect,
  RuleExecutionContext,
  RuleExecutionResult,
  RuleMutation,
  RuleProgram,
  RuleResolverRegistry,
  RuleStep,
} from '../primitives/types.js';

export { RuleProgramViolation };

export * from './evaluate-value.js';
export { evaluatePredicate } from './evaluate-predicate.js';
export * from './execute-flow.js';

/**
 * ICON p.85 ("Effects resolve in the order they are listed") and p.107 §4
 * ("The effects of abilities resolve in the order they are listed") define
 * the deterministic order of an ability's trigger steps: there is no global
 * trigger priority — simultaneously-derived triggers share the ability's
 * source-listing order. This returns the selected steps in that canonical
 * order so execution never depends on Set iteration or author discipline.
 * The ordering is the U17 `source-order` policy applied against the
 * ability's step listing (`primitives/ordering.ts`) — the ONE ordering
 * authority, never a bespoke sort.
 */
export function orderedSelectedSteps(action: RuleAction, selectedSteps: RuleStep[]): RuleStep[] {
  const result = applyOrdering(
    { kind: 'source-order' },
    selectedSteps.map((step) => ({ id: step.id })),
    { sourceOrder: action.steps.map((step) => step.id) },
  );
  // FAIL CLOSED: every selected step must be named by the action's step
  // listing (a selected step the source listing does not know is a malformed
  // action — reject, never an accidental array-order tie-break).
  if (!result.ok) {
    throw new RuleProgramViolation('program.step-order', `Cannot order steps: ${result.problem === 'unknown-candidate' ? 'a selected step is not in the ability step listing.' : 'the ability step listing is unavailable.'}`);
  }
  const byId = new Map(selectedSteps.map((step) => [step.id, step]));
  return result.ordered
    .map((candidate) => byId.get(candidate.id))
    .filter((step): step is RuleStep => step !== undefined);
}

/** ICON p.143 — regenerate a save and its outcome branch for a re-roll
 * (Sucker Punch: "the enemy must re-roll the save, keeping the second
 * result"). The roll and its rolled boon/curse are supplied by the caller
 * (the command layer, which owns the dice and re-rolls the modifier); the
 * branch for the new result is generated from the held save's continuation
 * AST with the triggering ability's provenance, so the regenerated mutations
 * are replay-exact and carry the same durable SaveWindow record
 * (`windowKind`, `windowId`, `modifiers`, `threshold`) as the original. The
 * branch effects emit through the same U11 flow planner
 * (`effectsToMutations`); with no `encounterState` on the context the
 * planner evaluates against the original view — exactly the pre-flow
 * behavior for this window path. */
export function rerollSaveMutations(
  save: {
    targetId: string;
    sourceId: string;
    sourceActorId: string;
    windowKind?: SaveWindowKind;
    windowId?: string;
    statusId?: string;
    modifiers?: SaveWindowModifiers;
    threshold?: number;
    onSuccess: RuleEffect[];
    onFailure: RuleEffect[];
  },
  context: RuleExecutionContext,
  roll: number,
  boon: number,
): RuleMutation[] {
  const threshold = save.threshold ?? 10;
  const total = roll + boon;
  const success = total >= threshold;
  const output: RuleMutation[] = [{
    kind: 'save',
    sourceId: save.sourceId,
    actorId: save.targetId,
    ...(save.windowKind ? { windowKind: save.windowKind } : {}),
    ...(save.windowId ? { windowId: save.windowId } : {}),
    ...(save.statusId ? { statusId: save.statusId } : {}),
    ...(save.modifiers ? { modifiers: save.modifiers } : {}),
    threshold,
    roll,
    boon,
    total,
    success,
    branch: { boon: save.modifiers ? save.modifiers.sourceModifier + save.modifiers.saveBoon - save.modifiers.saveCurse + (save.modifiers.blessing ? 1 : 0) : 0, threshold, onSuccess: save.onSuccess, onFailure: save.onFailure },
  }];
  effectsToMutations(success ? save.onSuccess : save.onFailure, {
    ...context,
    actorId: save.sourceActorId,
    sourceId: save.sourceId,
    input: {},
    triggerTargetIds: [save.targetId],
    delivery: success ? 'save-success' : 'effect',
  }, output);
  return output;
}

export function executeRuleProgram(
  program: RuleProgram,
  context: RuleExecutionContext,
  resolvers: RuleResolverRegistry = {},
  options: { onlyTriggers?: ReadonlySet<string> } = {},
): RuleExecutionResult {
  if (program.sourceId !== context.sourceId) throw new RuleProgramViolation('program.source', 'The execution context does not match this source program.');
  const action = program.actions.find(({ id, timing }) => id === context.actionId && timing === context.timing);
  if (!action) throw new RuleProgramViolation('program.action', `${context.actionId} is not available at ${context.timing}.`);
  const appendOnly = options.onlyTriggers !== undefined;
  const selectedSteps = orderedSelectedSteps(action, action.steps.filter(({ timing, trigger, condition }) => timing === context.timing
    && (!trigger || context.triggers?.has(trigger))
    && (!appendOnly || (trigger !== undefined && options.onlyTriggers!.has(trigger)))
    && (!condition || evaluatePredicate(condition, context))));
  // U11 flow authority (kernels/execute-flow.ts): the whole action plans
  // against a PURE simulated intermediate encounter state. Costs and the
  // named resolver are absorbed first (paid at the start of the ability,
  // ICON p.99/p.102 — later flow steps observe the paid/resolved state),
  // then each ordered step's effects run against the simulation, so a later
  // effect observes the ACTUAL intermediate state produced by the earlier
  // ones (rush-then-damage, remove-then-place, teleport-then-adjacency,
  // repeat iterations). The emitted mutation list IS the durable event
  // payload; replay consumes those recorded mutations and never re-runs
  // this planning logic.
  const planner = new FlowPlanner(context);
  // Costs and the named resolver are paid once, on the primary execution pass;
  // an append-only pass re-resolves only the newly-qualifying trigger steps.
  // Payments ride the shared cost-payment transaction kernel: the effective
  // costs (after any registered cost modifiers) are validated at the command
  // boundary and emitted here through the same mutation builders, so the
  // amount validated and the amount paid never drift.
  if (!appendOnly && (context.timing === 'use' || context.timing === 'interrupt')) {
    const costContext = costContextFromRuntime(context.state, context.actorId, context.sourceId, program.name);
    const effective = effectiveRuleCosts(action.costs, costContext);
    const evaluated = evaluateCosts(effective, (amount) => integer(amount, context));
    planner.absorb(ruleCostMutations(costContext, evaluated));
  }
  if (!appendOnly && action.resolverId) {
    const resolver = resolvers[action.resolverId];
    if (!resolver) throw new RuleProgramViolation('program.resolver', `Named resolver ${action.resolverId} is not registered.`);
    planner.absorb(resolver(context, action));
  }
  // Each ordered step's effects run against the planner's SIMULATED view
  // (never the original context view); only the action tags are overlaid.
  for (const step of selectedSteps) planner.effects(step.effects, { actionTags: new Set(action.tags) });
  return {
    mutations: planner.mutations,
    selectedAction: action,
    selectedSteps,
    // U10 integration: facts emitted by `emit-fact` flow nodes ride the
    // execution result so the event boundary can record them.
    ...(planner.facts.length > 0 ? { facts: planner.facts } : {}),
  };
}
