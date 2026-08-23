import { resolveSaveWindow, type SaveWindowKind } from './save-window.js';
import type { RuleActorView, RuleExecutionContext, RuleMutation } from './types.js';

/** A deterministic command-input violation for Cure/status-save choices. */
export class StatusSaveViolation extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'StatusSaveViolation';
  }
}

type StatusSaveChoices = Readonly<Record<string, { spendBlessing?: boolean }>>;

export interface StatusSaveResolutionOptions {
  /**
   * A command can remove a status by rule text before its ordinary save
   * window (for example, Stunned when it forces a turn end).  Such a status
   * is not a legal Blessing target in that window.
   */
  excludedStatusIds?: ReadonlySet<string>;
}

/**
 * Validate the explicit, opt-in Blessing choices before any dice are read.
 * p.94 does not permit saves against ongoing (+) statuses, so callers cannot
 * accidentally spend a Blessing on one.  This validation is shared by Cure
 * and future ordinary status-save windows.
 */
function statusSaveChoices(
  context: RuleExecutionContext,
  target: RuleActorView,
  options: StatusSaveResolutionOptions = {},
): StatusSaveChoices {
  const choices = context.input.statusSaveChoices?.[target.id] ?? {};
  const statuses = new Map(target.statuses.map((status) => [status.id, status.potency]));
  for (const statusId of Object.keys(choices)) {
    const potency = statuses.get(statusId);
    if (!potency) throw new StatusSaveViolation('status-save.unknown-status', `${statusId} is not a status affecting this character.`);
    if (potency === 'plus') throw new StatusSaveViolation('status-save.ongoing', `${statusId}+ cannot be saved against (ICON p.94).`);
    if (options.excludedStatusIds?.has(statusId)) throw new StatusSaveViolation('status-save.excluded-status', `${statusId} is removed by this command instead of being saved against.`);
  }
  return choices;
}

/**
 * Resolve all ordinary status saves for one character.  Blessing is an
 * explicit per-save choice (p.102/p.172), while encounter projection supplies
 * non-optional modifiers such as Rot's curse.  The emitted mutations carry
 * the full F2 SaveWindow record — `windowKind`, `modifiers`, `threshold`,
 * and the declarative remove-on-success continuation branch — so replay is
 * independent from later state and a future qualifying save-reroll interrupt
 * can regenerate either outcome.
 */
export function resolveStatusSaveMutations(
  context: RuleExecutionContext,
  target: RuleActorView,
  options: StatusSaveResolutionOptions = {},
  kind: SaveWindowKind = 'status-clear',
): RuleMutation[] {
  const choices = statusSaveChoices(context, target, options);
  const spendingBlessing = Object.entries(choices)
    .filter(([, choice]) => choice.spendBlessing === true)
    .map(([statusId]) => statusId);

  if (target.statusSavePolicy.statusSaveDenied) {
    if (spendingBlessing.length > 0) throw new StatusSaveViolation('status-save.denied', 'This character cannot save to clear statuses.');
    return [];
  }

  const availableBlessings = target.resources.blessing ?? 0;
  if (spendingBlessing.length > availableBlessings) {
    throw new StatusSaveViolation('resource.insufficient', `This character has only ${availableBlessings} Blessing token${availableBlessings === 1 ? '' : 's'} available.`);
  }

  const mutations: RuleMutation[] = [];
  for (const status of target.statuses) {
    // ICON p.94: ongoing (+) statuses cannot be saved against or removed.
    if (status.potency === 'plus' || options.excludedStatusIds?.has(status.id)) continue;
    const spendBlessing = choices[status.id]?.spendBlessing === true;
    if (spendBlessing) {
      mutations.push({
        kind: 'resource', sourceId: context.sourceId, actorId: target.id,
        resourceId: 'blessing', operation: 'spend', amount: 1, minimum: 0, maximum: null,
      });
    }
    const save = resolveSaveWindow(context, target, {
      id: `${context.sourceId}:status:${target.id}:${status.id}`,
      kind,
      sourceId: context.sourceId,
      actorId: context.actorId,
      statusId: status.id,
      spendBlessing,
      // The durable continuation: a success removes the status, a failure
      // leaves it in place. Retained on the record (never re-inferred).
      branch: {
        onSuccess: [{ kind: 'condition', target: { kind: 'trigger-targets' }, conditionId: status.id, operation: 'remove', potency: status.potency }],
        onFailure: [],
      },
    }).mutation;
    mutations.push(save);
    if (save.success) {
      mutations.push({
        kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId,
        actorId: target.id, conditionId: status.id, operation: 'remove', potency: 'normal',
      });
    }
  }
  return mutations;
}

/**
 * ICON p.102 Cure: gain 4 vigor (or a vigor surge while bloodied), then save
 * against every ordinary status.  The adapter applies the vigor part from the
 * cure mutation so max-HP/wound and denial checks remain encounter-authority.
 */
export function resolveCureMutations(context: RuleExecutionContext, target: RuleActorView, all = false): RuleMutation[] {
  // Always validate a supplied choice, even if a cure-denial makes it moot.
  // This prevents an unknown or ongoing status key from becoming a silent no-op.
  statusSaveChoices(context, target);
  const cure: RuleMutation = { kind: 'cure', sourceId: context.sourceId, actorId: target.id, all };
  if (target.statusSavePolicy.cureDenied) return [cure];
  // ICON p.102 Cure saves are their own window kind (`cure-immediate`): the
  // denial policy and the p.143 save-reroll scope treat a Cure's saves
  // distinctly from an ordinary end-turn status save.
  return [cure, ...resolveStatusSaveMutations(context, target, {}, 'cure-immediate')];
}
