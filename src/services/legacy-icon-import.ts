/**
 * LEGACY .icon IMPORT ADAPTER (import-only, level 0)
 *
 * This is the compatibility boundary for the external character format
 * represented by `Douglas.icon` at the repository root. It is IMPORT ONLY:
 * there is deliberately no export path, and the Dashboard no longer offers a
 * generic JSON import.
 *
 * Design rules (see AGENTS.md §15 — fail closed rather than guess):
 *
 * - Every legacy display label is translated to a canonical catalog ID by an
 *   exact, case-insensitive match against the creation projections' source
 *   catalogs. No fuzzy matching, no slugging, no guessing: a label that
 *   resolves to zero or more than one catalog entry rejects the record.
 * - The level-0 rules are never re-implemented here. A record is converted
 *   into the native `LevelZeroNarrativeSelection` and built through
 *   `createLevelZeroNarrative`; when the record carries a Job + two
 *   abilities it is completed through `applyLevelZeroTactical`. Validation is
 *   therefore exactly the native creation validation.
 * - `actionBonuses` are FINAL ratings; `bondBonus` names the action that
 *   received the Bond +2 dots. `additionalActionDots` are reconstructed by
 *   subtracting 2 from the Bond action's final rating. A final rating below
 *   2 for the Bond action (a negative reconstruction) rejects — the native
 *   builder must never silently repair an invalid allocation.
 * - Only level 0 is supported. level > 0 rejects rather than dropping
 *   advancement state.
 * - Non-creation legacy state (XP, dust, stress, wounds, HP/vigor, prepared
 *   loadouts, trophies, clocks, …) is NOT spread into the canonical record:
 *   the empty/zero/default values Douglas.icon carries are accepted and the
 *   canonical creation path supplies fresh defaults; any materially
 *   non-default value this importer cannot represent rejects the record
 *   instead of silently losing it.
 * - The legacy `id` is never trusted. `createLevelZeroNarrative` fabricates a
 *   fresh secure canonical UUID through the same mechanism as native
 *   creation, so importing the same file twice produces two distinct
 *   canonical characters.
 *
 * The adapter is pure: it never touches localStorage or Supabase. Persistence
 * happens through the caller (the Dashboard) using the existing
 * `CharacterContext.save()` local-first path.
 */
import {
  ABILITIES,
  ACTIONS,
  BONDS,
  BOND_POWERS,
  CULTURES,
  JOBS,
  KINS,
  applyLevelZeroTactical,
  createLevelZeroNarrative,
  type ActionId,
  type IconCharacter,
  type JobDefinition,
  type LevelZeroNarrativeSelection,
  type LevelZeroTacticalSelection,
} from '../rules/index.js';

/** The Dashboard file-picker accept filter for the legacy external format. */
export const LEGACY_ICON_FILE_ACCEPT = '.icon';

export interface LegacyIconImportError {
  /** Index of the record within the top-level array. */
  index: number;
  message: string;
}

export interface LegacyIconImportResult {
  imported: IconCharacter[];
  errors: LegacyIconImportError[];
}

/* ============================================================================
 * LABEL → CANONICAL ID TRANSLATION
 *
 * Strict, case-insensitive exact match against the same source catalogs the
 * creation projections expose. Ambiguity (a label matching more than one
 * catalog entry) rejects: identity is never guessed.
 * ========================================================================== */

function labelIndex<T extends { name: string }>(items: readonly T[]): Map<string, readonly T[]> {
  const index = new Map<string, T[]>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    index.set(key, [...(index.get(key) ?? []), item]);
  }
  return index;
}

const KIN_INDEX = labelIndex(KINS);
const CULTURE_INDEX = labelIndex(CULTURES);
const BOND_INDEX = labelIndex(BONDS);
const BOND_POWER_INDEX = labelIndex(BOND_POWERS);
const ACTION_INDEX = labelIndex(ACTIONS);
const JOB_INDEX = labelIndex(JOBS);
const ABILITY_INDEX = labelIndex(ABILITIES);

function resolveLabel<T extends { name: string }>(
  index: Map<string, readonly T[]>,
  label: unknown,
  kind: string,
): T {
  if (typeof label !== 'string' || !label.trim()) {
    throw new Error(`A ${kind} display label is required.`);
  }
  const matches = index.get(label.trim().toLowerCase());
  if (!matches || matches.length !== 1) {
    throw new Error(`Unrecognized ${kind} label "${label}"; refusing to guess a canonical ID.`);
  }
  return matches[0]!;
}

/* ============================================================================
 * LEGACY NON-CREATION STATE GUARDS
 *
 * Only the creation fields and identity metadata are transferred. Every other
 * legacy field must carry its default/empty value; anything materially
 * non-default rejects because this narrow importer cannot represent it.
 * ========================================================================== */

const HANDLED_LEGACY_KEYS = new Set([
  'level', 'name', 'kin', 'culture', 'bond', 'powers', 'actionBonuses',
  'bondBonus', 'jobs', 'abilities', 'image', 'id',
]);

function isZero(value: unknown): boolean {
  return typeof value === 'number' && value === 0;
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

/** The legacy `session` block is default only when its XP counters are all 0
 * and no powers were used this session. */
function isDefaultSession(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  if (Object.keys(session).some((key) => key !== 'xp' && key !== 'powersUsed')) return false;
  if ('powersUsed' in session) {
    const powersUsed = session.powersUsed;
    if (!powersUsed || typeof powersUsed !== 'object' || Array.isArray(powersUsed) || Object.keys(powersUsed as object).length > 0) return false;
  }
  if ('xp' in session) {
    const xp = session.xp;
    if (!xp || typeof xp !== 'object' || Array.isArray(xp)) return false;
    for (const [key, value] of Object.entries(xp as Record<string, unknown>)) {
      if (!['ideals', 'challenges', 'ambitions', 'burdens'].includes(key) || value !== 0) return false;
    }
  }
  return true;
}

/** The legacy `prepared` block is the app's default template: one "Default"
 * loadout carrying no abilities or trophies. Anything else is loadout state
 * this importer cannot represent. */
function isDefaultPrepared(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const entry = value[0];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const prepared = entry as Record<string, unknown>;
  if (Object.keys(prepared).some((key) => !['name', 'trophies', 'abilities', 'class', 'job'].includes(key))) return false;
  if (prepared.name !== 'Default') return false;
  return isEmptyArray(prepared.trophies) && isEmptyArray(prepared.abilities);
}

function summary(value: unknown): string {
  if (Array.isArray(value)) return `array of ${value.length}`;
  if (value && typeof value === 'object') return JSON.stringify(value).slice(0, 80);
  return JSON.stringify(value);
}

function assertLegacyRuntimeDefaults(raw: Record<string, unknown>): void {
  for (const key of Object.keys(raw)) {
    if (HANDLED_LEGACY_KEYS.has(key)) continue;
    const value = raw[key];
    if (isZero(value) || isEmptyArray(value) || value === '') continue;
    if (key === 'session' && isDefaultSession(value)) continue;
    if (key === 'prepared' && isDefaultPrepared(value)) continue;
    throw new Error(
      `Legacy "${key}" state (${summary(value)}) cannot be represented by this level-0 importer; refusing to drop it silently.`,
    );
  }
}

/* ============================================================================
 * RECORD IMPORT
 * ========================================================================== */

/** Convert one legacy level-0 record into a canonical `IconCharacter`. Throws
 * with a specific message on any value this importer cannot faithfully
 * represent. */
export function importLegacyIconRecord(record: unknown): IconCharacter {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('The record is not an object.');
  }
  const raw = record as Record<string, unknown>;

  const level = raw.level;
  if (typeof level !== 'number' || !Number.isInteger(level)) {
    throw new Error(`The record must declare an integer level; found ${String(level)}.`);
  }
  if (level !== 0) {
    throw new Error(`The record is level ${level}; only level 0 .icon characters can be imported.`);
  }
  const name = raw.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('The record needs a name.');
  }
  const portraitUrl = raw.image;
  if (portraitUrl !== undefined && typeof portraitUrl !== 'string') {
    throw new Error('Legacy "image" must be a portrait URL string.');
  }

  // Narrative selections: display labels → canonical IDs.
  const kin = resolveLabel(KIN_INDEX, raw.kin, 'Kin');
  const culture = resolveLabel(CULTURE_INDEX, raw.culture, 'Culture');
  const bond = resolveLabel(BOND_INDEX, raw.bond, 'Bond');

  const powers = raw.powers;
  if (!Array.isArray(powers) || powers.length !== 1) {
    throw new Error('A level 0 character records exactly one Bond power.');
  }
  const bondPower = resolveLabel(BOND_POWER_INDEX, powers[0], 'Bond power');

  // Action allocation: `actionBonuses` are FINAL ratings and `bondBonus`
  // names the action that received the Bond +2 dots. Reconstruct the four
  // additional dots by subtracting the Bond +2 from that action; the native
  // builder/validation then proves the Bond action is legal, exactly four
  // extra dots exist (six total), and no rating exceeds 3.
  const actionBonuses = raw.actionBonuses;
  if (!actionBonuses || typeof actionBonuses !== 'object' || Array.isArray(actionBonuses)) {
    throw new Error('"actionBonuses" must be an object of final action ratings.');
  }
  const bondBonusLabel = raw.bondBonus;
  if (typeof bondBonusLabel !== 'string' || !bondBonusLabel.trim()) {
    throw new Error('"bondBonus" must name the action that received the Bond +2 dots.');
  }
  const bondAction = resolveLabel(ACTION_INDEX, bondBonusLabel, 'Action');

  const additionalActionDots: Partial<Record<ActionId, number>> = {};
  for (const [label, value] of Object.entries(actionBonuses as Record<string, unknown>)) {
    const action = resolveLabel(ACTION_INDEX, label, 'Action');
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`The final rating for "${label}" must be a whole number.`);
    }
    const extra = action.id === bondAction.id ? value - 2 : value;
    if (extra < 0) {
      throw new Error(`"${action.name}" has final rating ${value}, below the +2 dots the Bond grants; the allocation cannot be imported.`);
    }
    if (extra > 0) additionalActionDots[action.id] = extra;
  }

  // Tactical selections (optional — a record without them is the legitimate
  // narrative-only "Not yet" state).
  let jobs: JobDefinition[] = [];
  if (raw.jobs !== undefined) {
    if (!Array.isArray(raw.jobs)) throw new Error('"jobs" must be an array of Job names.');
    jobs = raw.jobs.map((label) => resolveLabel(JOB_INDEX, label, 'Job'));
    if (jobs.length > 1) throw new Error('A level 0 character chooses at most one Job.');
  }
  let abilities: Array<{ id: string; name: string }> = [];
  if (raw.abilities !== undefined) {
    if (!Array.isArray(raw.abilities)) throw new Error('"abilities" must be an array of { name } records.');
    abilities = raw.abilities.map((entry, abilityIndex) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`abilities[${abilityIndex}] must be an object with a name.`);
      }
      return resolveLabel(ABILITY_INDEX, (entry as Record<string, unknown>).name, 'Ability');
    });
  }

  // Reject state this importer cannot represent before building anything.
  assertLegacyRuntimeDefaults(raw);

  const character = createLevelZeroNarrative(
    { name: name.trim(), pronouns: '', portraitUrl: portraitUrl ?? '' },
    {
      kinId: kin.id,
      cultureId: culture.id,
      bondId: bond.id,
      bondPowerId: bondPower.id,
      bondActionId: bondAction.id,
      additionalActionDots,
    } satisfies LevelZeroNarrativeSelection,
  );

  if (jobs.length === 1) {
    if (abilities.length !== 2) {
      throw new Error(`"${jobs[0].name}" requires exactly two starting abilities at level 0; found ${abilities.length}.`);
    }
    const tactical: LevelZeroTacticalSelection = {
      jobId: jobs[0].id,
      abilityIds: abilities.map((ability) => ability.id),
    };
    // Native tactical validation rejects abilities that do not belong to the
    // chosen Job (or are not chapter 1).
    return applyLevelZeroTactical(character, tactical);
  }
  if (abilities.length > 0) {
    throw new Error('Starting abilities are recorded without a Job.');
  }
  return character;
}

/** Parse a legacy .icon file (a JSON top-level array) and import every
 * supported record independently: a valid record imports even when another
 * record in the same file is invalid. The file-level parse errors throw (the
 * whole file is unusable); per-record failures are reported in `errors`. */
export function importLegacyIconFile(text: string): LegacyIconImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (reason) {
    throw new Error(`The .icon file is not valid JSON: ${reason instanceof Error ? reason.message : 'parse failed.'}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('A legacy .icon file must be a JSON array of character records.');
  }
  const imported: IconCharacter[] = [];
  const errors: LegacyIconImportError[] = [];
  parsed.forEach((record, index) => {
    try {
      imported.push(importLegacyIconRecord(record));
    } catch (reason) {
      errors.push({ index, message: reason instanceof Error ? reason.message : 'Import failed.' });
    }
  });
  return { imported, errors };
}
