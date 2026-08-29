/**
 * choice.ts — the CHOOSE underlay: one semantic validator over the typed
 * command input buckets (`RuleExecutionInput`).
 *
 * Every player decision is a `RuleChoice` row on the source's `RuleAction`
 * (kind: actors / positions / direction / option / number / boolean), and
 * every command carries the typed buckets (`RuleExecutionInput`: actorIds,
 * positions, directions, options, numbers, booleans). Before this kernel the
 * reading of those buckets was scattered: `kernels/teleport-choice.ts`
 * validated position choices one way, `selectActors`' `input` selector
 * validated actor choices another way, `evaluateNumber`'s `input` case
 * validated numbers a third, and option/boolean choices had no shared
 * validation at all. This kernel is the ONE seam all of them go through:
 *
 *   - a REQUIRED choice missing from its bucket rejects the command
 *     (`choice.<kind>-required`) — nothing is consumed, nothing resolves;
 *   - an OPTIONAL choice missing means "decline" (never "pick a default");
 *   - a supplied choice is validated against its declared constraints:
 *     cardinality (minimum/maximum/distinct), relation (self/ally/foe/any),
 *     range (footprint distance, p.92), option membership, numeric bounds;
 *   - the returned values are exactly what the buckets carried — this kernel
 *     derives legality and consequences, it never invents a value.
 *
 * The kernel carries no source IDs: `key`/`label`/`kind` come from the
 * calling content's `RuleChoice` row. Domain-specific refinements that a
 * generic constraint cannot express (e.g. teleport's in-grid + unoccupied +
 * Rampart leg) stay with their specialists — `kernels/teleport-choice.ts`
 * remains the teleport authority and consumes this kernel's violation codes
 * so every required-choice rejection reads identically at the command
 * boundary.
 */
import type { Position } from '../../types.js';
import type {
  RuleChoice,
  RuleExecutionContext,
} from '../primitives/types.js';
import { footprintDistance } from '../primitives/spatial-intent.js';
import { validateActorCandidate } from './candidate.js';
import { RuleProgramViolation, evaluateNumber } from './runtime.js';

/** The validated value for one `RuleChoice`: what the player supplied,
 * already checked against the row's constraints. `null` means the choice was
 * optional and declined — never a default. */
export type ChosenValue =
  | { kind: 'actors'; ids: string[] }
  | { kind: 'positions'; positions: Position[] }
  | { kind: 'direction'; direction: Position | null }
  | { kind: 'option'; value: string | null }
  | { kind: 'number'; value: number | null }
  | { kind: 'boolean'; value: boolean | null };

function choiceViolation(code: string, choice: RuleChoice, detail: string): RuleProgramViolation {
  return new RuleProgramViolation(code, `${choice.label}: ${detail}`);
}

/** Validate one choice row against the command's typed input buckets.
 *
 * Throws `RuleProgramViolation` when a required choice is missing or a
 * supplied value breaks the row's declared constraints. Returns the chosen
 * value, or `null` for a declined optional choice. */
export function resolveChoice(choice: RuleChoice, context: RuleExecutionContext): ChosenValue {
  switch (choice.kind) {
    case 'actors': return resolveActors(choice, context);
    case 'positions': return resolvePositions(choice, context);
    case 'direction': return resolveDirection(choice, context);
    case 'option': return resolveOption(choice, context);
    case 'number': return resolveNumber(choice, context);
    case 'boolean': return resolveBoolean(choice, context);
  }
}

/** Validate a whole action's choice list in order. Required choices are
 * checked before any optional one so the rejection names the first hard
 * requirement, not whichever optional row happened to decline. */
export function resolveChoices(choices: readonly RuleChoice[], context: RuleExecutionContext): Map<string, ChosenValue> {
  const resolved = new Map<string, ChosenValue>();
  for (const choice of [...choices].sort((a, b) => Number(b.required) - Number(a.required))) {
    resolved.set(choice.key, resolveChoice(choice, context));
  }
  return resolved;
}

function resolveActors(choice: RuleChoice, context: RuleExecutionContext): ChosenValue {
  const supplied = context.input.actorIds?.[choice.key];
  if (!supplied || supplied.length === 0) {
    if (!choice.required) return { kind: 'actors', ids: [] };
    throw choiceViolation('choice.actor-required', choice, 'requires a chosen target.');
  }
  // Candidate legality is delegated to the shared U3 authority (candidate.ts)
  // — the SAME eligibility machinery automatic targeting uses. This kernel
  // keeps only the choice-specific semantics: required/optional, cardinality,
  // and distinctness.
  // The U3 query carries RESOLVED scalars: the dynamic range is evaluated
  // here through the U5 VALUE authority (`evaluateNumber`) at the query
  // point, exactly once for every supplied id.
  const query = {
    relation: choice.relation,
    range: choice.range === undefined ? undefined : evaluateNumber(choice.range, context),
  };
  const ids: string[] = [];
  for (const id of supplied) {
    const result = validateActorCandidate(id, query, context);
    if (!result.legal) {
      throw choiceViolation(result.violation.code, choice, result.violation.message);
    }
    ids.push(id);
  }
  const minimum = choice.minimum ?? (choice.required ? 1 : 0);
  const maximum = choice.maximum ?? Number.POSITIVE_INFINITY;
  if (ids.length < minimum || ids.length > maximum) {
    throw choiceViolation('choice.actor-count', choice, `requires ${minimum}–${maximum === Number.POSITIVE_INFINITY ? 'any' : maximum} targets (got ${ids.length}).`);
  }
  if (new Set(ids).size !== ids.length) {
    throw choiceViolation('choice.actor-distinct', choice, 'targets must be distinct.');
  }
  return { kind: 'actors', ids };
}

function resolvePositions(choice: RuleChoice, context: RuleExecutionContext): ChosenValue {
  const supplied = context.input.positions?.[choice.key];
  if (!supplied || supplied.length === 0) {
    if (!choice.required) return { kind: 'positions', positions: [] };
    throw choiceViolation('choice.position-required', choice, 'requires a chosen position.');
  }
  const source = context.state.actors[context.actorId];
  const origin = source.position;
  const positions: Position[] = [];
  for (const cell of supplied) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= context.state.grid.width || cell.y >= context.state.grid.height) {
      throw choiceViolation('move.out-of-bounds', choice, `position (${cell.x},${cell.y}) is outside the battlefield.`);
    }
    if (choice.range && origin) {
      const maximumRange = evaluateNumber(choice.range, context);
      if (footprintDistance({ position: origin, size: source.size }, { position: cell, size: 1 }) > maximumRange) {
        throw choiceViolation('move.range', choice, `position (${cell.x},${cell.y}) is outside range ${maximumRange}.`);
      }
    }
    positions.push(cell);
  }
  const minimum = choice.minimum ?? (choice.required ? 1 : 0);
  const maximum = choice.maximum ?? Number.POSITIVE_INFINITY;
  if (positions.length < minimum || positions.length > maximum) {
    throw choiceViolation('choice.position-count', choice, `requires ${minimum}–${maximum === Number.POSITIVE_INFINITY ? 'any' : maximum} positions (got ${positions.length}).`);
  }
  return { kind: 'positions', positions };
}

function resolveDirection(choice: RuleChoice, context: RuleExecutionContext): ChosenValue {
  const supplied = context.input.directions?.[choice.key];
  if (!supplied) {
    if (!choice.required) return { kind: 'direction', direction: null };
    throw choiceViolation('choice.direction-required', choice, 'requires a chosen direction.');
  }
  if (supplied.x === 0 && supplied.y === 0) {
    // A direction is an axis unit vector; (0,0) is not a direction.
    throw choiceViolation('choice.direction-invalid', choice, 'direction cannot be (0,0).');
  }
  return { kind: 'direction', direction: supplied };
}

function resolveOption(choice: RuleChoice, context: RuleExecutionContext): ChosenValue {
  const supplied = context.input.options?.[choice.key];
  if (supplied === undefined) {
    if (!choice.required) return { kind: 'option', value: null };
    throw choiceViolation('choice.option-required', choice, 'requires a chosen option.');
  }
  if (choice.options && !choice.options.includes(supplied)) {
    throw choiceViolation('choice.option-invalid', choice, `"${supplied}" is not one of: ${choice.options.join(', ')}.`);
  }
  return { kind: 'option', value: supplied };
}

function resolveNumber(choice: RuleChoice, context: RuleExecutionContext): ChosenValue {
  const supplied = context.input.numbers?.[choice.key];
  if (supplied === undefined || !Number.isFinite(supplied)) {
    if (!choice.required) return { kind: 'number', value: null };
    throw choiceViolation('choice.number-required', choice, 'requires a numeric value.');
  }
  if (choice.minimum !== undefined && supplied < choice.minimum) {
    throw choiceViolation('choice.number-minimum', choice, `must be at least ${choice.minimum}.`);
  }
  if (choice.maximum !== undefined && supplied > choice.maximum) {
    throw choiceViolation('choice.number-maximum', choice, `must be at most ${choice.maximum}.`);
  }
  return { kind: 'number', value: supplied };
}

function resolveBoolean(choice: RuleChoice, context: RuleExecutionContext): ChosenValue {
  const supplied = context.input.booleans?.[choice.key];
  if (supplied === undefined) {
    if (!choice.required) return { kind: 'boolean', value: null };
    throw choiceViolation('choice.boolean-required', choice, 'requires a yes/no answer.');
  }
  return { kind: 'boolean', value: supplied };
}
