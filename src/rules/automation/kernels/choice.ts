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
 *     U4 owns cardinality (minimum/maximum/distinct), closed options and
 *     numeric bounds; actor/position membership delegates to U3 (whose range
 *     frame composes U7);
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
import type { RuleChoice, RuleExecutionContext } from '../primitives/types.js';
import type { PositionLegalityQuery } from '../primitives/query.js';
import { defaultActorAnchor } from '../primitives/anchor.js';
import { deriveRoles, resolveRoleSelector, roleFrameFromContext, type RoleFrame } from '../primitives/roles.js';
import { resolveSpatialAnchor, validateActorCandidate } from './candidate.js';
import { validatePositionCandidate, validatePositionLegality } from './evaluate-query.js';
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
  | { kind: 'boolean'; value: boolean | null }
  | { kind: 'ordering'; ids: string[] };

/** A captured list choice whose candidate domain has already been produced by
 * its owning U3 query. U4 owns only presence/cardinality/distinctness and
 * membership in that supplied CandidateSet. */
export interface CapturedListChoice {
  key: string;
  label: string;
  required: boolean;
  minimum?: number;
  maximum?: number;
  /** Whether repeated recorded values are malformed or collapse to the
   * mathematical subset they denote. Defaults to reject. */
  repetition?: 'reject' | 'collapse';
}

function choiceViolation(code: string, choice: RuleChoice, detail: string): RuleProgramViolation {
  return new RuleProgramViolation(code, `${choice.label}: ${detail}`);
}

function capturedListViolation(code: string, choice: CapturedListChoice, detail: string): RuleProgramViolation {
  return new RuleProgramViolation(code, `${choice.label}: ${detail}`);
}

function validateCapturedList(
  choice: CapturedListChoice,
  supplied: readonly string[] | undefined,
  kind: 'actor' | 'option' | 'position',
): string[] {
  if (!supplied || supplied.length === 0) {
    if (!choice.required) return [];
    throw capturedListViolation(`choice.${kind}-required`, choice, 'requires a recorded choice.');
  }
  const values = choice.repetition === 'collapse' ? [...new Set(supplied)] : [...supplied];
  const minimum = choice.minimum ?? (choice.required ? 1 : 0);
  const maximum = choice.maximum ?? Number.POSITIVE_INFINITY;
  if (values.length < minimum || values.length > maximum) {
    throw capturedListViolation(
      `choice.${kind}-count`,
      choice,
      `requires ${minimum}–${maximum === Number.POSITIVE_INFINITY ? 'any' : maximum} choices (got ${values.length}).`,
    );
  }
  if (choice.repetition !== 'collapse' && new Set(values).size !== values.length) {
    throw capturedListViolation(`choice.${kind}-distinct`, choice, 'choices must be distinct.');
  }
  return values;
}

/** Resolve an actor selection against a U3-produced CandidateSet. This is the
 * thin composition seam for area/other domain queries that cannot be
 * reconstructed from `RuleChoice`'s basic relation/range fields. It never
 * generates, sorts, or selects candidates. */
export function resolveCapturedActorChoice(
  choice: CapturedListChoice,
  candidates: readonly { id: string }[],
  context: RuleExecutionContext,
): string[] {
  const ids = validateCapturedList(choice, context.input.actorIds?.[choice.key], 'actor');
  const candidateIds = new Set(candidates.map(({ id }) => id));
  for (const id of ids) {
    if (!candidateIds.has(id)) {
      throw capturedListViolation('choice.actor-ineligible', choice, `actor "${id}" is not an eligible candidate.`);
    }
  }
  return ids;
}

/** Resolve a comma-delimited recorded option list from the existing durable
 * option bucket. Candidate vocabulary is content-declared; U4 validates only
 * presence, cardinality, distinctness, and membership. The returned order is
 * exactly the recorded order and must only be interpreted where source rules
 * define whether ordering is meaningful. */
export function resolveCapturedOptionListChoice(
  choice: CapturedListChoice & { options: readonly string[] },
  context: RuleExecutionContext,
): string[] {
  const raw = context.input.options?.[choice.key];
  const supplied = raw === undefined || raw.trim() === ''
    ? undefined
    : raw.split(',').map((value) => value.trim());
  const values = validateCapturedList(choice, supplied, 'option');
  const candidates = new Set(choice.options);
  for (const value of values) {
    if (!candidates.has(value)) {
      throw capturedListViolation('choice.option-invalid', choice, `"${value}" is not one of: ${choice.options.join(', ')}.`);
    }
  }
  return values;
}

/** Read one durable position decision without supplying any default. Source
 * resolvers own whether absence is required, optional, or valid only when the
 * U3 CandidateSet is empty; this seam owns the single-position cardinality. */
export function readCapturedPositionChoice(
  context: RuleExecutionContext,
  key: string,
  label = key,
): Position | null {
  const supplied = context.input.positions?.[key];
  if (!supplied || supplied.length === 0) return null;
  if (supplied.length !== 1) {
    throw new RuleProgramViolation('choice.position-count', `${label}: requires exactly one recorded position (got ${supplied.length}).`);
  }
  return supplied[0];
}

/** Capture an exact/subset position decision over a U3 CandidateSet. No
 * candidate order, padding, or singleton default can decide for the player. */
export function resolveCapturedPositionListChoice(
  choice: CapturedListChoice,
  candidates: readonly Position[],
  context: RuleExecutionContext,
): Position[] {
  const supplied = context.input.positions?.[choice.key];
  const keys = supplied?.map((cell) => {
    if (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) {
      throw capturedListViolation('choice.position-invalid', choice, 'requires integer grid positions.');
    }
    return `${cell.x},${cell.y}`;
  });
  const values = validateCapturedList(choice, keys, 'position');
  const eligible = new Set(candidates.map((cell) => `${cell.x},${cell.y}`));
  for (const value of values) {
    if (!eligible.has(value)) throw capturedListViolation('choice.position-unavailable', choice, 'position is not an eligible candidate.');
  }
  return values.map((value) => {
    const [x, y] = value.split(',').map(Number);
    return { x, y };
  });
}

/** Validate one recorded free-placement decision through U3's shared bounds,
 * footprint range, occupancy, and optional LoS authority. The caller supplies
 * the source-declared policy; this U4 adapter only maps structured legality
 * problems to the established choice-boundary violations. */
export function validateCapturedPositionChoice(
  context: RuleExecutionContext,
  position: Position,
  legality: PositionLegalityQuery,
  label: string,
): Position {
  const result = validatePositionLegality(legality, position, context);
  if (result.legal) return position;
  switch (result.problem) {
    case 'out-of-bounds':
      throw new RuleProgramViolation('move.out-of-bounds', `${label}: position is outside the battlefield.`);
    case 'range':
      throw new RuleProgramViolation('move.range', `${label}: position is outside range ${legality.range}.`);
    case 'occupied':
      throw new RuleProgramViolation('choice.position-unavailable', `${label}: position is not free.`);
    case 'line-of-sight':
      throw new RuleProgramViolation('move.line-of-sight', `${label}: position is outside line of sight.`);
  }
  throw new RuleProgramViolation('choice.position-unavailable', `${label}: position is not legal.`);
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
    case 'ordering': return resolveOrdering(choice, context);
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
  // The range frame is the U7 ANCHOR (default the acting actor), resolved
  // through the shared anchor authority — a malformed anchor (zero/multi
  // actors, a position-less actor) FAILS CLOSED rather than silently
  // skipping the range check.
  const origin = resolveSpatialAnchor(choice.rangeOrigin ?? defaultActorAnchor(), context);
  const maximumRange = choice.range === undefined ? Number.POSITIVE_INFINITY : evaluateNumber(choice.range, context);
  const positions: Position[] = [];
  for (const cell of supplied) {
    const candidate = validatePositionCandidate({ origin: origin.position, originSize: origin.size, range: maximumRange }, cell, context);
    if (!candidate.legal && candidate.problem === 'out-of-bounds') {
      throw choiceViolation('move.out-of-bounds', choice, `position (${cell.x},${cell.y}) is outside the battlefield.`);
    }
    if (!candidate.legal) {
      throw choiceViolation('move.range', choice, `position (${cell.x},${cell.y}) is outside range ${maximumRange}.`);
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
    // The current compatibility bucket carries a displacement vector. U4 can
    // reject the absence of direction, but must not invent a source-specific
    // direction vocabulary here; a later closed candidate set belongs in U3.
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
  // A boolean choice is a strict yes/no — a malformed non-boolean (a string,
  // a number) is NOT read as accept or decline, it is rejected.
  if (typeof supplied !== 'boolean') {
    throw choiceViolation('choice.boolean-invalid', choice, 'must be a literal yes/no (true or false).');
  }
  return { kind: 'boolean', value: supplied };
}

/** A U17 same-owner ORDERING decision (T6.2): the player supplies the full
 * order of the pending candidate effects as an ordered id list (p.107 "If a
 * character owns multiple effects, and there's ambiguity in the order in
 * which they trigger, they can determine the order"). The answer must be an
 * EXACT PERMUTATION of the choice's `candidateIds` — the engine never
 * accepts a plausible-looking subset, a foreign id, a duplicate, or an
 * extra candidate. The returned ids are exactly the recorded order — the
 * durable decision; replay consumes them, never re-derives or re-sorts. */
function resolveOrdering(choice: RuleChoice, context: RuleExecutionContext): ChosenValue {
  const supplied = context.input.actorIds?.[choice.key];
  if (!supplied || supplied.length === 0) {
    if (!choice.required) return { kind: 'ordering', ids: [] };
    throw choiceViolation('choice.ordering-required', choice, 'requires an ordering of the pending effects.');
  }
  const candidates = choice.candidateIds ?? [];
  // The pending set is EXACT: a different-length answer is never accepted,
  // so a partial permutation and an extra-candidate answer both reject here.
  if (candidates.length !== supplied.length) {
    throw choiceViolation('choice.ordering-set', choice, `must order exactly ${candidates.length} pending effects (got ${supplied.length}).`);
  }
  // Each pending effect may be ordered exactly once.
  if (new Set(supplied).size !== supplied.length) {
    throw choiceViolation('choice.ordering-distinct', choice, 'each pending effect may be ordered exactly once.');
  }
  const expected = new Set(candidates);
  for (const id of supplied) {
    if (!expected.has(id)) {
      throw choiceViolation('choice.ordering-unknown', choice, `"${id}" is not one of the pending effects.`);
    }
  }
  // Length equality + distinctness + membership ⇒ the supplied list is a
  // permutation of the exact pending set (every candidate appears).
  return { kind: 'ordering', ids: [...supplied] };
}

/**
 * The entitled chooser for a choice row (U2 CHOICE/CHOER/control substrate):
 * the declared `chooser` role, else the declared `controller`, else the
 * acting source. Returns null when a DECLARED chooser/controller cannot be
 * derived from the role frame — the command/network boundary must REJECT
 * rather than guess (an underivable semantic role is malformed; the engine
 * never silently falls back to the source for a declared role).
 *
 * The frame is the durable role authority: `roleFrameFromContext` builds it
 * from the legacy context slots; the command/network boundary supplies the
 * recorded per-subject controllers (multiplayer/VTT). No content row sets
 * `chooser`/`controller` yet — this is the substrate the window layer (U13)
 * and the network boundary consume.
 */
export function choiceEntitledPlayer(choice: RuleChoice, frame: RoleFrame): string | null {
  const selector = choice.chooser ?? choice.controller;
  if (!selector) return frame.sourceId;
  return resolveRoleSelector(selector, deriveRoles(frame));
}

/** Convenience over the legacy context slots. The legacy context carries no
 * recorded per-subject controller facts, so every `controller-of` resolution
 * fails closed (returns null) until a real multiplayer/session authority
 * records controllers — never a silent fallback to the source. */
export function choiceEntitledPlayerFromContext(choice: RuleChoice, context: RuleExecutionContext): string | null {
  return choiceEntitledPlayer(choice, roleFrameFromContext(context));
}
