import { applyEvents, createEncounter, executeCommand, MAX_ENCOUNTER_EVENT_LOG, migrateEncounter, RuleViolation } from './encounter.js';
import type { DiceSource } from './dice.js';
import { ENCOUNTER_SCHEMA_VERSION, RULES_VERSION, type EncounterCommand, type EncounterEvent, type EncounterState, type Position } from './types.js';
import { windowHeldDamage, windowHeldSave } from './automation/kernels/decision-window.js';
import { durableAssetUrlProblem } from './durable-assets.js';

/**
 * The room wrapper is deliberately separate from EncounterState. EncounterState
 * remains the authoritative mechanical model; this module owns only durable
 * tabletop presentation data and the room-wide revision.
 */
export const VTT_ROOM_SCHEMA_VERSION = 2 as const;
/** Durable tabletop budgets prevent an otherwise valid drawing from becoming a room-sized DoS. */
export const MAX_TABLE_ACTOR_PRESENTATIONS = 1_000;
export const MAX_TABLE_FOG_REGIONS = 500;
export const MAX_TABLE_ANNOTATIONS = 1_000;
export const MAX_TABLE_TEMPLATES = 500;
export const MAX_TABLE_CLOCKS = 500;
export const MAX_TABLE_POINTS_PER_ARTIFACT = 10_000;
export const MAX_TABLE_GEOMETRY_POINTS = 20_000;
/**
 * A durable room must fit comfortably inside one realtime state message,
 * leaving headroom for the envelope and the just-accepted event batch.
 * This is a byte budget (not JavaScript string length) because source text
 * and table labels may contain multi-byte Unicode.
 */
export const MAX_VTT_ROOM_SERIALIZED_BYTES = 384 * 1024;
const utf8 = new TextEncoder();

export interface TableMapState {
  backgroundUrl: string;
  /** Visual multiplier only. It never changes a mechanical grid position. */
  scale: number;
  /** World-space image offset in rendered pixels. */
  offset: Position;
  /** Preferred rendered cell size in CSS pixels. */
  cellSize: number;
  showGrid: boolean;
  showCoordinates: boolean;
}

export interface ActorPresentation {
  tokenUrl?: string;
  label?: string;
  tokenScale?: number;
  hidden?: boolean;
}

export interface FogRegion {
  id: string;
  cells: Position[];
  hidden?: boolean;
}

export type AnnotationKind = 'line' | 'arrow' | 'marker' | 'note';

export interface Annotation {
  id: string;
  /** Server-stamped for player-owned marks; never trusted from a client. */
  authorId?: string | null;
  kind: AnnotationKind;
  points: Position[];
  color: string;
  text: string;
  hidden?: boolean;
}

export type AreaTemplateKind = 'burst' | 'cone' | 'line' | 'rectangle';

export interface AreaTemplate {
  id: string;
  /** Server-stamped for player-owned templates; never trusted from a client. */
  authorId?: string | null;
  kind: AreaTemplateKind;
  origin: Position;
  rotation: number;
  length: number;
  width: number;
  label: string;
  color: string;
  hidden?: boolean;
}

export interface TableClock {
  id: string;
  name: string;
  segments: 4 | 6 | 8 | 10 | 12;
  filled: number;
  hidden?: boolean;
}

export interface TableState {
  map: TableMapState;
  actorPresentation: Record<string, ActorPresentation>;
  fog: FogRegion[];
  annotations: Annotation[];
  templates: AreaTemplate[];
  clocks: TableClock[];
}

export interface VttRoomState {
  schemaVersion: typeof VTT_ROOM_SCHEMA_VERSION;
  encounter: EncounterState;
  table: TableState;
  /** Monotonic revision for every accepted durable room operation. */
  revision: number;
}

export type TableCommand =
  | { type: 'SET_MAP'; map: Partial<TableMapState> }
  | { type: 'SET_ACTOR_PRESENTATION'; actorId: string; presentation: ActorPresentation | null }
  | { type: 'PAINT_FOG'; region: FogRegion }
  | { type: 'ERASE_FOG'; regionId: string }
  | { type: 'CLEAR_FOG' }
  | { type: 'UPSERT_ANNOTATION'; annotation: Annotation }
  | { type: 'REMOVE_ANNOTATION'; annotationId: string }
  | { type: 'UPSERT_TEMPLATE'; template: AreaTemplate }
  | { type: 'REMOVE_TEMPLATE'; templateId: string }
  | { type: 'UPSERT_CLOCK'; clock: TableClock }
  | { type: 'REMOVE_CLOCK'; clockId: string };

export type TableEvent =
  | { type: 'MAP_SET'; map: TableMapState }
  | { type: 'ACTOR_PRESENTATION_SET'; actorId: string; presentation: ActorPresentation | null }
  | { type: 'FOG_PAINTED'; region: FogRegion }
  | { type: 'FOG_ERASED'; regionId: string }
  | { type: 'FOG_CLEARED' }
  | { type: 'ANNOTATION_UPSERTED'; annotation: Annotation }
  | { type: 'ANNOTATION_REMOVED'; annotationId: string }
  | { type: 'TEMPLATE_UPSERTED'; template: AreaTemplate }
  | { type: 'TEMPLATE_REMOVED'; templateId: string }
  | { type: 'CLOCK_UPSERTED'; clock: TableClock }
  | { type: 'CLOCK_REMOVED'; clockId: string };

export type RoomCommand =
  | { domain: 'encounter'; command: EncounterCommand }
  | { domain: 'table'; command: TableCommand };

export type RoomEvent =
  | { domain: 'encounter'; events: EncounterEvent[] }
  | { domain: 'table'; event: TableEvent };

export interface RoomCommandResult {
  state: VttRoomState;
  events: RoomEvent[];
}

export class VttRoomViolation extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const clone = <T>(value: T): T => structuredClone(value);
const validClockSegments = new Set<TableClock['segments']>([4, 6, 8, 10, 12]);

function assertIdentifier(value: string, path: string) {
  if (!value.trim() || value.length > 160) throw new VttRoomViolation('table.identifier', `${path} must be a non-empty identifier.`);
}

function assertPosition(value: Position, path: string) {
  if (!Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y)) throw new VttRoomViolation('table.position', `${path} must use integer grid coordinates.`);
}

function assertDurableUrl(value: string, path: string) {
  const problem = durableAssetUrlProblem(value);
  if (problem) throw new VttRoomViolation('table.asset-url', `${path} ${problem}`);
}

export function createDefaultTableState(backgroundUrl = ''): TableState {
  return {
    map: {
      backgroundUrl,
      scale: 1,
      offset: { x: 0, y: 0 },
      cellSize: 64,
      showGrid: true,
      showCoordinates: false,
    },
    actorPresentation: {},
    fog: [],
    annotations: [],
    templates: [],
    clocks: [],
  };
}

/**
 * Persistence projection for Supabase checkpoints.
 *
 * Checkpoints are current-state snapshots, not replay archives. The encounter
 * event log remains available in the live room for fan-out/audit behavior, but
 * must never be serialized into a durable VTT save because it grows without
 * bound and duplicates the authoritative state already represented by the
 * snapshot.
 */
export function currentStateForPersistence(room: VttRoomState): VttRoomState {
  const snapshot = clone(room);
  snapshot.encounter.eventLog = [];
  return snapshot;
}

export function createVttRoom(encounter = createEncounter()): VttRoomState {
  return {
    schemaVersion: VTT_ROOM_SCHEMA_VERSION,
    encounter: clone(encounter),
    table: createDefaultTableState(encounter.grid.backgroundUrl),
    revision: encounter.revision,
  };
}

function asRecord(input: unknown, message: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new VttRoomViolation('room.invalid', message);
  return input as Record<string, unknown>;
}

function migrateMap(input: unknown, legacyBackgroundUrl: string): TableMapState {
  const defaults = createDefaultTableState(legacyBackgroundUrl).map;
  // Historical snapshots may omit the whole map, but an explicitly present
  // malformed map is corruption, not a request to quietly replace it with
  // defaults. Only absent legacy fields receive compatibility defaults.
  if (input === undefined) return defaults;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new VttRoomViolation('room.invalid', 'Historical map state must be an object when present.');
  }
  const candidate = input as Partial<TableMapState>;
  const readOptional = <T>(value: unknown, predicate: (candidate: unknown) => candidate is T, path: string, fallback: T): T => {
    if (value === undefined) return fallback;
    if (!predicate(value)) throw new VttRoomViolation('room.invalid', `${path} has an invalid historical value.`);
    return value;
  };
  let offset = defaults.offset;
  if (candidate.offset !== undefined) {
    if (!candidate.offset || typeof candidate.offset !== 'object' || Array.isArray(candidate.offset)) {
      throw new VttRoomViolation('room.invalid', 'Historical map offset must be an object when present.');
    }
    const offsetCandidate = candidate.offset as Partial<TableMapState['offset']>;
    offset = {
      x: readOptional(offsetCandidate.x, (value): value is number => typeof value === 'number', 'Historical map offset.x', defaults.offset.x),
      y: readOptional(offsetCandidate.y, (value): value is number => typeof value === 'number', 'Historical map offset.y', defaults.offset.y),
    };
  }
  const map: TableMapState = {
    backgroundUrl: readOptional(candidate.backgroundUrl, (value): value is string => typeof value === 'string', 'Historical map backgroundUrl', defaults.backgroundUrl),
    scale: readOptional(candidate.scale, (value): value is number => typeof value === 'number', 'Historical map scale', defaults.scale),
    offset,
    cellSize: readOptional(candidate.cellSize, (value): value is number => typeof value === 'number', 'Historical map cellSize', defaults.cellSize),
    showGrid: readOptional(candidate.showGrid, (value): value is boolean => typeof value === 'boolean', 'Historical map showGrid', defaults.showGrid),
    showCoordinates: readOptional(candidate.showCoordinates, (value): value is boolean => typeof value === 'boolean', 'Historical map showCoordinates', defaults.showCoordinates),
  };
  validateMap(map);
  return map;
}

function migrateList<T>(input: unknown, path: string, mapper: (value: unknown) => T): T[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new VttRoomViolation('room.invalid', `${path} must be an array when present in a historical room.`);
  return input.map((value, index) => {
    try {
      return mapper(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid value';
      throw new VttRoomViolation('room.invalid', `${path}[${index}] cannot be migrated without losing data: ${message}`);
    }
  });
}

function migrateTable(input: unknown, legacyBackgroundUrl: string): TableState {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new VttRoomViolation('room.invalid', 'Historical table state must be an object when present.');
  }
  const candidate = (input ?? {}) as Partial<TableState>;
  const actorPresentation: Record<string, ActorPresentation> = {};
  if (candidate.actorPresentation !== undefined) {
    if (!candidate.actorPresentation || typeof candidate.actorPresentation !== 'object' || Array.isArray(candidate.actorPresentation)) {
      throw new VttRoomViolation('room.invalid', 'Historical actor presentation state must be an object when present.');
    }
    for (const [actorId, presentation] of Object.entries(candidate.actorPresentation)) {
      if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
        throw new VttRoomViolation('room.invalid', `Historical actor presentation ${actorId} cannot be migrated without losing data.`);
      }
      assertIdentifier(actorId, 'actor presentation id');
      validatePresentation(presentation as ActorPresentation);
      actorPresentation[actorId] = clone(presentation as ActorPresentation);
    }
  }
  const table: TableState = {
    map: migrateMap(candidate.map, legacyBackgroundUrl),
    actorPresentation,
    fog: migrateList(candidate.fog, 'Historical fog', (value) => {
      validateFog(value as FogRegion);
      return clone(value as FogRegion);
    }),
    annotations: migrateList(candidate.annotations, 'Historical annotations', (value) => {
      validateAnnotation(value as Annotation);
      return clone(value as Annotation);
    }),
    templates: migrateList(candidate.templates, 'Historical templates', (value) => {
      validateTemplate(value as AreaTemplate);
      return clone(value as AreaTemplate);
    }),
    clocks: migrateList(candidate.clocks, 'Historical clocks', (value) => {
      validateClock(value as TableClock);
      return clone(value as TableClock);
    }),
  };
  assertTableCapacity(table);
  return table;
}

/** Migrate both historical room wrappers and legacy bare EncounterState saves. */
export function migrateVttRoom(input: unknown): VttRoomState {
  const candidate = asRecord(input, 'VTT room data must be an object.');
  if (!('encounter' in candidate)) return createVttRoom(migrateEncounter(input));
  const schemaVersion = candidate.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== VTT_ROOM_SCHEMA_VERSION) {
    throw new VttRoomViolation('room.schema', `Unsupported VTT room schema version: ${String(schemaVersion)}`);
  }
  const encounter = migrateEncounter(candidate.encounter);
  const revision = typeof candidate.revision === 'number' && Number.isSafeInteger(candidate.revision) && candidate.revision >= 0
    ? candidate.revision
    : encounter.revision;
  if (revision < encounter.revision) throw new VttRoomViolation('room.revision', 'A room revision cannot predate its encounter revision.');
  return {
    schemaVersion: VTT_ROOM_SCHEMA_VERSION,
    encounter,
    // A schema-2 table is already the canonical table model. Preserve its
    // exact shape so the strict checkpoint boundary can reject corruption;
    // only historical wrapper schemas are allowed to use the forgiving table
    // migration that fills old display defaults and drops invalid remnants.
    table: schemaVersion === VTT_ROOM_SCHEMA_VERSION
      ? clone(candidate.table as TableState)
      : migrateTable(candidate.table, encounter.grid.backgroundUrl),
    revision,
  };
}

/**
 * Strictly validate a canonical, already-migrated room snapshot.
 *
 * `migrateVttRoom` is intentionally forgiving so historical local exports can
 * be upgraded. A durable checkpoint is a different trust boundary: callers
 * must run this after migration before treating the result as live authority.
 * This function therefore rejects missing and unexpected state fields instead
 * of silently filling them in.
 */
export function assertValidVttRoomState(input: unknown): asserts input is VttRoomState {
  const room = strictRecord(input, 'room');
  assertExactKeys(room, 'room', ['schemaVersion', 'encounter', 'table', 'revision']);
  if (room.schemaVersion !== VTT_ROOM_SCHEMA_VERSION) invalidSnapshot('room.schemaVersion', `must be ${VTT_ROOM_SCHEMA_VERSION}.`);
  const roomRevision = strictInteger(room.revision, 'room.revision', 0);
  const encounter = strictEncounter(room.encounter);
  if (roomRevision < encounter.revision) invalidSnapshot('room.revision', 'cannot predate encounter.revision.');
  strictTable(room.table);
  let serializedBytes: number;
  try {
    serializedBytes = utf8.encode(JSON.stringify(room)).byteLength;
  } catch {
    invalidSnapshot('room', 'cannot be serialized as durable JSON.');
  }
  if (serializedBytes! > MAX_VTT_ROOM_SERIALIZED_BYTES) {
    invalidSnapshot('room', `exceeds the ${MAX_VTT_ROOM_SERIALIZED_BYTES.toLocaleString()} byte realtime durability budget.`);
  }
}

/** Strict current-schema encounter validation for wrappers that are older. */
export function assertValidEncounterState(input: unknown): asserts input is EncounterState {
  strictEncounter(input);
}

const statusIds = new Set(['slashed', 'blind', 'dazed', 'hatred', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable']);
const terrainTypes = new Set(['basic', 'difficult', 'dangerous', 'impassable', 'pit', 'slope']);
const roleIds = new Set(['mob', 'heavy', 'skirmisher', 'leader', 'artillery', 'legend', 'special']);
const eventTypes = new Set([
  'ACTOR_ADDED', 'ACTOR_REMOVED', 'TERRAIN_SET', 'ENCOUNTER_STARTED',
  'ACTOR_MOVED', 'ATTACK_RESOLVED', 'ABILITY_RESOLVED', 'ACTOR_INTERACTED',
  'ACTOR_RESCUED', 'STATUS_REMOVED', 'ACTOR_RECOVERED', 'STATUS_APPLIED',
  'TURN_ENDED', 'TURN_STARTED', 'ACTOR_WENT_SLOW', 'ACTOR_DEFEATED',
  'VIGILANCE_SPENT', 'ENCOUNTER_ENDED', 'RULE_MUTATIONS_APPLIED',
  // T5c/T6.2: a decision-window answer (including a recorded same-owner
  // ordering) is a durable encounter event and must survive a room snapshot.
  'DECISION_ANSWERED',
]);

function invalidSnapshot(path: string, message: string): never {
  throw new VttRoomViolation('room.invalid', `${path} ${message}`);
}

function strictRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidSnapshot(path, 'must be an object.');
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, path: string, required: readonly string[], optional: readonly string[] = []) {
  for (const key of required) if (!(key in record)) invalidSnapshot(`${path}.${key}`, 'is required.');
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  if (unexpected) invalidSnapshot(`${path}.${unexpected}`, 'is not a recognized durable state field.');
}

function strictString(value: unknown, path: string, maximum = 2_048, nonEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (nonEmpty && value.trim().length === 0)) {
    invalidSnapshot(path, nonEmpty ? `must be a non-empty string up to ${maximum} characters.` : `must be a string up to ${maximum} characters.`);
  }
  return value;
}

function strictIdentifier(value: unknown, path: string): string {
  return strictString(value, path, 160, true);
}

function strictNullableIdentifier(value: unknown, path: string): string | null {
  return value === null ? null : strictIdentifier(value, path);
}

function strictBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalidSnapshot(path, 'must be a boolean.');
  return value;
}

function strictFinite(value: unknown, path: string, minimum = -Number.MAX_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalidSnapshot(path, `must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function strictInteger(value: unknown, path: string, minimum = -Number.MAX_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalidSnapshot(path, `must be a safe integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function strictEnum(value: unknown, path: string, options: ReadonlySet<string>): string {
  const candidate = strictString(value, path, 160, true);
  if (!options.has(candidate)) invalidSnapshot(path, `must be one of ${[...options].join(', ')}.`);
  return candidate;
}

function strictPosition(value: unknown, path: string): Position {
  const position = strictRecord(value, path);
  assertExactKeys(position, path, ['x', 'y']);
  strictInteger(position.x, `${path}.x`);
  strictInteger(position.y, `${path}.y`);
  return position as unknown as Position;
}

function strictGridPosition(value: unknown, path: string, width: number, height: number): Position {
  const position = strictPosition(value, path);
  if (position.x < 0 || position.y < 0 || position.x >= width || position.y >= height) {
    invalidSnapshot(path, 'must be inside the encounter grid.');
  }
  return position;
}

function strictIdentifierArray(value: unknown, path: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) invalidSnapshot(path, `must be an array with at most ${maximum} identifiers.`);
  value.forEach((item, index) => strictIdentifier(item, `${path}[${index}]`));
  return value as string[];
}

function strictPositionArray(value: unknown, path: string, maximum: number): Position[] {
  if (!Array.isArray(value) || value.length > maximum) invalidSnapshot(path, `must be an array with at most ${maximum} positions.`);
  value.forEach((item, index) => strictPosition(item, `${path}[${index}]`));
  return value as Position[];
}

function strictPrimitive(value: unknown, path: string): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return invalidSnapshot(path, 'must be a JSON primitive.');
}

function strictPrimitiveRecord(value: unknown, path: string, maximumEntries = 500): Record<string, string | number | boolean | null> {
  const record = strictRecord(value, path);
  const entries = Object.entries(record);
  if (entries.length > maximumEntries) invalidSnapshot(path, `cannot contain more than ${maximumEntries} values.`);
  for (const [key, item] of entries) {
    strictIdentifier(key, `${path} key`);
    strictPrimitive(item, `${path}.${key}`);
  }
  return record as Record<string, string | number | boolean | null>;
}

function strictNullableIdentifierRecord(value: unknown, path: string, maximumEntries = 500): Record<string, string | null> {
  const record = strictRecord(value, path);
  const entries = Object.entries(record);
  if (entries.length > maximumEntries) invalidSnapshot(path, `cannot contain more than ${maximumEntries} values.`);
  for (const [key, ownerId] of entries) {
    strictIdentifier(key, `${path} key`);
    strictNullableIdentifier(ownerId, `${path}.${key}`);
  }
  return record as Record<string, string | null>;
}

function strictJson(value: unknown, path: string, depth = 0): void {
  if (depth > 32) invalidSnapshot(path, 'is nested too deeply to be a durable JSON value.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidSnapshot(path, 'must not contain a non-finite number.');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 100_000) invalidSnapshot(path, 'contains an excessively long string.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) invalidSnapshot(path, 'contains too many array values.');
    value.forEach((item, index) => strictJson(item, `${path}[${index}]`, depth + 1));
    return;
  }
  const record = strictRecord(value, path);
  const entries = Object.entries(record);
  if (entries.length > 10_000) invalidSnapshot(path, 'contains too many object fields.');
  entries.forEach(([key, item]) => strictJson(item, `${path}.${key}`, depth + 1));
}

function strictDuration(value: unknown, path: string, nullable: boolean): void {
  if (value === null && nullable) return;
  const duration = strictRecord(value, path);
  const kind = strictString(duration.kind, `${path}.kind`, 80, true);
  switch (kind) {
    case 'instant':
    case 'combat':
    case 'expedition':
      assertExactKeys(duration, path, ['kind']);
      return;
    case 'turn-end':
    case 'turn-start':
      assertExactKeys(duration, path, ['kind', 'actor'], ['turns']);
      strictJson(duration.actor, `${path}.actor`);
      if (duration.turns !== undefined) strictInteger(duration.turns, `${path}.turns`, 1, 100);
      return;
    case 'round-end':
    case 'round-start':
      assertExactKeys(duration, path, ['kind'], ['rounds']);
      if (duration.rounds !== undefined) strictInteger(duration.rounds, `${path}.rounds`, 1, 100);
      return;
    case 'until':
      assertExactKeys(duration, path, ['kind', 'event'], ['sourceId']);
      strictIdentifier(duration.event, `${path}.event`);
      if (duration.sourceId !== undefined) strictIdentifier(duration.sourceId, `${path}.sourceId`);
      return;
    default:
      invalidSnapshot(`${path}.kind`, 'is not a supported rule duration.');
  }
}

function strictModifier(value: unknown, path: string) {
  const modifier = strictRecord(value, path);
  assertExactKeys(modifier, path, ['stat', 'operation'], ['value']);
  strictIdentifier(modifier.stat, `${path}.stat`);
  strictEnum(modifier.operation, `${path}.operation`, new Set(['add', 'subtract', 'set', 'upgrade', 'downgrade', 'grant', 'deny', 'immune', 'resist']));
  if (modifier.value !== undefined) strictJson(modifier.value, `${path}.value`);
}

function strictActor(value: unknown, path: string, expectedId: string, gridWidth: number, gridHeight: number) {
  const actor = strictRecord(value, path);
  assertExactKeys(actor, path, [
    'id', 'name', 'side', 'controllerId', 'characterId', 'foeProfileId', 'roleId',
    'actorKind', 'size', 'tokenUrl', 'classId', 'chapter', 'abilityIds', 'position',
    'vitality', 'baseMaxHp', 'hp', 'vigor', 'wounds', 'defense', 'armor', 'speed',
    'dash', 'fray', 'damageDie', 'basicAttackRange', 'statuses', 'conditions',
    'resources', 'ruleState', 'ruleStateOwners', 'activeEffects', 'marks', 'stance', 'traitIds', 'talents', 'masteredAbilityIds',
    'onBattlefield', 'defeated', 'actionsRemaining', 'standardMoveUsed',
    'attackedThisTurn', 'usedAbilityIds', 'turnTaken',
    'turnsRemaining', 'turnsTakenThisRound', 'slow',
  ], ['foeKind']);
  const actorId = strictIdentifier(actor.id, `${path}.id`);
  if (actorId !== expectedId) invalidSnapshot(`${path}.id`, 'must match its actors record key.');
  strictString(actor.name, `${path}.name`, 120, true);
  strictEnum(actor.side, `${path}.side`, new Set(['heroes', 'foes']));
  strictNullableIdentifier(actor.controllerId, `${path}.controllerId`);
  strictNullableIdentifier(actor.characterId, `${path}.characterId`);
  if (actor.foeProfileId !== null) strictString(actor.foeProfileId, `${path}.foeProfileId`, 200, true);
  if (actor.roleId !== null) strictEnum(actor.roleId, `${path}.roleId`, roleIds);
  // Optional durable foe template identity (p.298–299 entitlements); absent
  // only on historical snapshots predating the field.
  if (actor.foeKind !== undefined && actor.foeKind !== null) {
    strictEnum(actor.foeKind, `${path}.foeKind`, new Set(['job', 'variant', 'unique', 'elite', 'legend', 'component', 'special']));
  }
  strictEnum(actor.actorKind, `${path}.actorKind`, new Set(['hero', 'foe', 'summon']));
  strictInteger(actor.size, `${path}.size`, 1, 20);
  const tokenUrl = strictString(actor.tokenUrl, `${path}.tokenUrl`);
  assertDurableUrl(tokenUrl, `${path}.tokenUrl`);
  strictEnum(actor.classId, `${path}.classId`, new Set(['stalwart', 'vagabond', 'mendicant', 'wright', 'foe']));
  strictInteger(actor.chapter, `${path}.chapter`, 1, 3);
  const abilityIds = strictIdentifierArray(actor.abilityIds, `${path}.abilityIds`, 200);
  strictGridPosition(actor.position, `${path}.position`, gridWidth, gridHeight);
  strictInteger(actor.vitality, `${path}.vitality`, 0);
  strictInteger(actor.baseMaxHp, `${path}.baseMaxHp`, 1);
  strictInteger(actor.hp, `${path}.hp`, 0);
  strictInteger(actor.vigor, `${path}.vigor`, 0);
  strictInteger(actor.wounds, `${path}.wounds`, 0, 4);
  strictInteger(actor.defense, `${path}.defense`, 0);
  strictInteger(actor.armor, `${path}.armor`, 0);
  strictInteger(actor.speed, `${path}.speed`, 0);
  strictInteger(actor.dash, `${path}.dash`, 0);
  strictInteger(actor.fray, `${path}.fray`, 0);
  strictInteger(actor.damageDie, `${path}.damageDie`, 6, 10);
  if (actor.damageDie !== 6 && actor.damageDie !== 8 && actor.damageDie !== 10) invalidSnapshot(`${path}.damageDie`, 'must be d6, d8, or d10.');
  strictInteger(actor.basicAttackRange, `${path}.basicAttackRange`, 0);
  if (!Array.isArray(actor.statuses) || actor.statuses.length > 20) invalidSnapshot(`${path}.statuses`, 'must contain at most 20 statuses.');
  actor.statuses.forEach((status, index) => strictEnum(status, `${path}.statuses[${index}]`, statusIds));
  if (!Array.isArray(actor.conditions) || actor.conditions.length > 200) invalidSnapshot(`${path}.conditions`, 'must contain at most 200 conditions.');
  actor.conditions.forEach((condition, index) => {
    const itemPath = `${path}.conditions[${index}]`;
    const conditionRecord = strictRecord(condition, itemPath);
    assertExactKeys(conditionRecord, itemPath, ['id', 'sourceId', 'ownerId', 'potency', 'duration']);
    strictIdentifier(conditionRecord.id, `${itemPath}.id`);
    strictIdentifier(conditionRecord.sourceId, `${itemPath}.sourceId`);
    strictNullableIdentifier(conditionRecord.ownerId, `${itemPath}.ownerId`);
    strictEnum(conditionRecord.potency, `${itemPath}.potency`, new Set(['normal', 'plus']));
    strictDuration(conditionRecord.duration, `${itemPath}.duration`, true);
  });
  strictNumberRecord(actor.resources, `${path}.resources`, 500, 0);
  const ruleState = strictPrimitiveRecord(actor.ruleState, `${path}.ruleState`);
  const ruleStateOwners = strictNullableIdentifierRecord(actor.ruleStateOwners, `${path}.ruleStateOwners`);
  for (const key of Object.keys(ruleState)) {
    if (!Object.prototype.hasOwnProperty.call(ruleStateOwners, key)) invalidSnapshot(`${path}.ruleStateOwners.${key}`, 'is required for every ruleState entry.');
  }
  for (const key of Object.keys(ruleStateOwners)) {
    if (!Object.prototype.hasOwnProperty.call(ruleState, key)) invalidSnapshot(`${path}.ruleStateOwners.${key}`, 'cannot exist without a matching ruleState entry.');
  }
  if (!Array.isArray(actor.activeEffects) || actor.activeEffects.length > 500) invalidSnapshot(`${path}.activeEffects`, 'must contain at most 500 effects.');
  actor.activeEffects.forEach((effect, index) => {
    const itemPath = `${path}.activeEffects[${index}]`;
    const effectRecord = strictRecord(effect, itemPath);
    assertExactKeys(effectRecord, itemPath, ['id', 'sourceId', 'effectId', 'ownerId', 'duration', 'modifiers', 'triggers', 'state']);
    strictIdentifier(effectRecord.id, `${itemPath}.id`);
    strictIdentifier(effectRecord.sourceId, `${itemPath}.sourceId`);
    strictIdentifier(effectRecord.effectId, `${itemPath}.effectId`);
    strictIdentifier(effectRecord.ownerId, `${itemPath}.ownerId`);
    strictDuration(effectRecord.duration, `${itemPath}.duration`, false);
    if (!Array.isArray(effectRecord.modifiers) || effectRecord.modifiers.length > 100) invalidSnapshot(`${itemPath}.modifiers`, 'must contain at most 100 modifiers.');
    effectRecord.modifiers.forEach((modifier, modifierIndex) => strictModifier(modifier, `${itemPath}.modifiers[${modifierIndex}]`));
    strictIdentifierArray(effectRecord.triggers, `${itemPath}.triggers`, 100);
    strictPrimitiveRecord(effectRecord.state, `${itemPath}.state`);
  });
  if (!Array.isArray(actor.marks) || actor.marks.length > 100) invalidSnapshot(`${path}.marks`, 'must contain at most 100 marks.');
  actor.marks.forEach((mark, index) => {
    const itemPath = `${path}.marks[${index}]`;
    const markRecord = strictRecord(mark, itemPath);
    assertExactKeys(markRecord, itemPath, ['id', 'sourceId', 'ownerId', 'markId', 'duration', 'state']);
    strictIdentifier(markRecord.id, `${itemPath}.id`);
    strictIdentifier(markRecord.sourceId, `${itemPath}.sourceId`);
    strictIdentifier(markRecord.ownerId, `${itemPath}.ownerId`);
    strictIdentifier(markRecord.markId, `${itemPath}.markId`);
    strictDuration(markRecord.duration, `${itemPath}.duration`, true);
    strictPrimitiveRecord(markRecord.state, `${itemPath}.state`);
  });
  if (actor.stance !== null) {
    const stance = strictRecord(actor.stance, `${path}.stance`);
    assertExactKeys(stance, `${path}.stance`, ['id', 'sourceId', 'ownerId', 'stanceId', 'state']);
    strictIdentifier(stance.id, `${path}.stance.id`);
    strictIdentifier(stance.sourceId, `${path}.stance.sourceId`);
    strictNullableIdentifier(stance.ownerId, `${path}.stance.ownerId`);
    strictIdentifier(stance.stanceId, `${path}.stance.stanceId`);
    strictPrimitiveRecord(stance.state, `${path}.stance.state`);
  }
  strictIdentifierArray(actor.traitIds, `${path}.traitIds`, 500);
  // F7: the equipped talent choice per ability — an exact 1-or-2 enum, keyed
  // by the ability id, bounded like the interrupt-uses record.
  const talents = strictRecord(actor.talents, `${path}.talents`);
  if (Object.keys(talents).length > 200) invalidSnapshot(`${path}.talents`, 'cannot contain more than 200 values.');
  for (const [abilityId, talent] of Object.entries(talents)) {
    strictIdentifier(abilityId, `${path}.talents key`);
    strictInteger(talent, `${path}.talents.${abilityId}`, 1, 2);
  }
  // Mastery ownership: a bounded identifier list, validated exactly like the
  // equipped ability list it is restricted to.
  const masteredAbilityIds = strictIdentifierArray(actor.masteredAbilityIds, `${path}.masteredAbilityIds`, 200);
  for (const abilityId of masteredAbilityIds) {
    if (!abilityIds.includes(abilityId)) invalidSnapshot(`${path}.masteredAbilityIds`, `lists ${abilityId}, which is not an equipped ability.`);
  }
  strictBoolean(actor.onBattlefield, `${path}.onBattlefield`);
  strictBoolean(actor.defeated, `${path}.defeated`);
  strictInteger(actor.actionsRemaining, `${path}.actionsRemaining`, 0);
  strictBoolean(actor.standardMoveUsed, `${path}.standardMoveUsed`);
  strictBoolean(actor.attackedThisTurn, `${path}.attackedThisTurn`);
  strictIdentifierArray(actor.usedAbilityIds, `${path}.usedAbilityIds`, 200);
  strictBoolean(actor.turnTaken, `${path}.turnTaken`);
  strictInteger(actor.turnsRemaining, `${path}.turnsRemaining`, 0);
  strictInteger(actor.turnsTakenThisRound, `${path}.turnsTakenThisRound`, 0);
  strictBoolean(actor.slow, `${path}.slow`);
}

function strictNumberRecord(value: unknown, path: string, maximumEntries: number, minimum: number): Record<string, number> {
  const record = strictRecord(value, path);
  const entries = Object.entries(record);
  if (entries.length > maximumEntries) invalidSnapshot(path, `cannot contain more than ${maximumEntries} values.`);
  for (const [key, item] of entries) {
    strictIdentifier(key, `${path} key`);
    strictInteger(item, `${path}.${key}`, minimum);
  }
  return record as Record<string, number>;
}

function strictEncounter(value: unknown): EncounterState {
  const encounter = strictRecord(value, 'room.encounter');
  assertExactKeys(encounter, 'room.encounter', [
    'schemaVersion', 'rulesVersion', 'id', 'name', 'phase', 'grid', 'actors',
    'round', 'activeActorId', 'turnPhase', 'eligibleSide', 'lastSide', 'partyResolve', 'entities',
    'terrainEffects', 'decisionWindows', 'continuations', 'windowSerial', 'revision', 'resolutionSerial', 'eventLog',
  ]);
  if (encounter.schemaVersion !== ENCOUNTER_SCHEMA_VERSION) invalidSnapshot('room.encounter.schemaVersion', `must be ${ENCOUNTER_SCHEMA_VERSION}.`);
  if (encounter.rulesVersion !== RULES_VERSION) invalidSnapshot('room.encounter.rulesVersion', `must be ${RULES_VERSION}.`);
  strictIdentifier(encounter.id, 'room.encounter.id');
  strictString(encounter.name, 'room.encounter.name', 500, true);
  strictEnum(encounter.phase, 'room.encounter.phase', new Set(['setup', 'active', 'complete']));
  const grid = strictRecord(encounter.grid, 'room.encounter.grid');
  assertExactKeys(grid, 'room.encounter.grid', ['width', 'height', 'backgroundUrl', 'terrain']);
  const gridWidth = strictInteger(grid.width, 'room.encounter.grid.width', 1, 10_000);
  const gridHeight = strictInteger(grid.height, 'room.encounter.grid.height', 1, 10_000);
  const backgroundUrl = strictString(grid.backgroundUrl, 'room.encounter.grid.backgroundUrl');
  assertDurableUrl(backgroundUrl, 'room.encounter.grid.backgroundUrl');
  if (!Array.isArray(grid.terrain) || grid.terrain.length > 100_000) invalidSnapshot('room.encounter.grid.terrain', 'contains too many terrain cells.');
  grid.terrain.forEach((cell, index) => {
    const cellPath = `room.encounter.grid.terrain[${index}]`;
    const item = strictRecord(cell, cellPath);
    assertExactKeys(item, cellPath, ['position', 'type', 'elevation']);
    strictGridPosition(item.position, `${cellPath}.position`, gridWidth, gridHeight);
    strictEnum(item.type, `${cellPath}.type`, terrainTypes);
    strictInteger(item.elevation, `${cellPath}.elevation`, -100, 100);
  });
  const actors = strictRecord(encounter.actors, 'room.encounter.actors');
  if (Object.keys(actors).length > 1_000) invalidSnapshot('room.encounter.actors', 'contains too many actors.');
  for (const [actorId, actor] of Object.entries(actors)) {
    strictIdentifier(actorId, 'room.encounter.actors key');
    strictActor(actor, `room.encounter.actors.${actorId}`, actorId, gridWidth, gridHeight);
  }
  strictInteger(encounter.round, 'room.encounter.round', 0);
  if (encounter.activeActorId !== null) {
    const activeActorId = strictIdentifier(encounter.activeActorId, 'room.encounter.activeActorId');
    if (!actors[activeActorId]) invalidSnapshot('room.encounter.activeActorId', 'must identify a current actor.');
  }
  strictEnum(encounter.turnPhase, 'room.encounter.turnPhase', new Set(['normal', 'slow']));
  if (encounter.eligibleSide !== null) strictEnum(encounter.eligibleSide, 'room.encounter.eligibleSide', new Set(['heroes', 'foes']));
  if (encounter.lastSide !== null) strictEnum(encounter.lastSide, 'room.encounter.lastSide', new Set(['heroes', 'foes']));
  strictInteger(encounter.partyResolve, 'room.encounter.partyResolve', 0);
  const entities = strictRecord(encounter.entities, 'room.encounter.entities');
  if (Object.keys(entities).length > 10_000) invalidSnapshot('room.encounter.entities', 'contains too many entities.');
  for (const [entityId, entity] of Object.entries(entities)) {
    const entityPath = `room.encounter.entities.${entityId}`;
    strictIdentifier(entityId, 'room.encounter.entities key');
    const item = strictRecord(entity, entityPath);
    assertExactKeys(item, entityPath, ['id', 'type', 'ownerId', 'positions', 'state', 'duration']);
    if (strictIdentifier(item.id, `${entityPath}.id`) !== entityId) invalidSnapshot(`${entityPath}.id`, 'must match its entities record key.');
    strictIdentifier(item.type, `${entityPath}.type`);
    strictNullableIdentifier(item.ownerId, `${entityPath}.ownerId`);
    strictPositionArray(item.positions, `${entityPath}.positions`, 10_000)
      .forEach((position, index) => strictGridPosition(position, `${entityPath}.positions[${index}]`, gridWidth, gridHeight));
    strictPrimitiveRecord(item.state, `${entityPath}.state`);
    strictDuration(item.duration, `${entityPath}.duration`, true);
  }
  if (!Array.isArray(encounter.terrainEffects) || encounter.terrainEffects.length > 10_000) invalidSnapshot('room.encounter.terrainEffects', 'contains too many terrain effects.');
  encounter.terrainEffects.forEach((effect, index) => {
    const effectPath = `room.encounter.terrainEffects[${index}]`;
    const item = strictRecord(effect, effectPath);
    assertExactKeys(item, effectPath, ['id', 'sourceId', 'ownerId', 'terrain', 'positions', 'height', 'duration']);
    strictIdentifier(item.id, `${effectPath}.id`);
    strictIdentifier(item.sourceId, `${effectPath}.sourceId`);
    strictNullableIdentifier(item.ownerId, `${effectPath}.ownerId`);
    strictIdentifier(item.terrain, `${effectPath}.terrain`);
    strictPositionArray(item.positions, `${effectPath}.positions`, 10_000)
      .forEach((position, positionIndex) => strictGridPosition(position, `${effectPath}.positions[${positionIndex}]`, gridWidth, gridHeight));
    if (item.height !== null) strictInteger(item.height, `${effectPath}.height`, -100, 100);
    strictDuration(item.duration, `${effectPath}.duration`, true);
  });
  if (!Array.isArray(encounter.decisionWindows) || encounter.decisionWindows.length > 10_000) invalidSnapshot('room.encounter.decisionWindows', 'contains too many windows.');
  encounter.decisionWindows.forEach((window, index) => {
    const windowPath = `room.encounter.decisionWindows[${index}]`;
    const item = strictRecord(window, windowPath);
    assertExactKeys(item, windowPath, ['id', 'kind', 'actorId', 'triggeredAt', 'order', 'resolvedOrder', 'openedBy', 'provenance', 'heldPayload', 'heldEffects', 'retarget', 'retargetProgramId', 'choice', 'ordering', 'resume', 'heldBoundary']);
    strictIdentifier(item.id, `${windowPath}.id`);
    const windowActorId = strictIdentifier(item.actorId, `${windowPath}.actorId`);
    if (!actors[windowActorId]) invalidSnapshot(`${windowPath}.actorId`, 'must identify a current actor.');
    strictEnum(item.kind, `${windowPath}.kind`, new Set(['when-damaged', 'defeated', 'save-rolled', 'uses-ability', 'area-inclusion', 'targeted-by-ability', 'choice']));
    strictInteger(item.triggeredAt, `${windowPath}.triggeredAt`, 0);
    strictInteger(item.order, `${windowPath}.order`, 0);
    // T6.2: the recorded owner-ordering rank (written only by a recorded
    // ordering decision) — a non-negative integer when present.
    if (item.resolvedOrder !== undefined) strictInteger(item.resolvedOrder, `${windowPath}.resolvedOrder`, 0);
    if (item.openedBy !== undefined) {
      const openedByPath = `${windowPath}.openedBy`;
      const openedBy = strictRecord(item.openedBy, openedByPath);
      assertExactKeys(openedBy, openedByPath, ['factKind', 'instanceId']);
      strictString(openedBy.factKind, `${openedByPath}.factKind`, 200);
      if (openedBy.instanceId !== undefined) strictString(openedBy.instanceId, `${openedByPath}.instanceId`, 300);
    }
    if (item.provenance !== undefined) {
      const provenancePath = `${windowPath}.provenance`;
      const provenance = strictRecord(item.provenance, provenancePath);
      assertExactKeys(provenance, provenancePath, ['sourceId', 'sourceActorId']);
      if (provenance.sourceId !== undefined) strictIdentifier(provenance.sourceId, `${provenancePath}.sourceId`);
      if (provenance.sourceActorId !== undefined) strictIdentifier(provenance.sourceActorId, `${provenancePath}.sourceActorId`);
    }
    if (item.heldPayload !== undefined) {
      // The U12 held-result / deferred continuation is bounded JSON — the
      // durable payload the window holds, never recomputed.
      strictJson(item.heldPayload, `${windowPath}.heldPayload`);
    }
    if (item.heldEffects !== undefined) {
      // The held effects are the triggering ability's already-generated
      // mutation list, bounded like the event history they came from: they are
      // replayed by Render, not by the checkpoint hydrator, so bounded JSON
      // is the correct validation surface.
      const heldEffectsPath = `${windowPath}.heldEffects`;
      if (!Array.isArray(item.heldEffects) || item.heldEffects.length > 1_000) invalidSnapshot(heldEffectsPath, 'contains too many held effect mutations.');
      item.heldEffects.forEach((effect, effectIndex) => strictJson(effect, `${heldEffectsPath}[${effectIndex}]`));
    }
    if (item.retarget !== undefined) {
      const retargetPath = `${windowPath}.retarget`;
      const retarget = strictRecord(item.retarget, retargetPath);
      assertExactKeys(retarget, retargetPath, ['fromActorId', 'toActorId']);
      strictIdentifier(retarget.fromActorId, `${retargetPath}.fromActorId`);
      strictIdentifier(retarget.toActorId, `${retargetPath}.toActorId`);
    }
    if (item.retargetProgramId !== undefined) strictIdentifier(item.retargetProgramId, `${windowPath}.retargetProgramId`);
    if (item.choice !== undefined) strictJson(item.choice, `${windowPath}.choice`);
    if (item.ordering !== undefined) strictJson(item.ordering, `${windowPath}.ordering`);
    if (item.resume !== undefined) {
      // The U11 flow suspension: remaining flow nodes + binder are bounded
      // JSON (the same durable surface as held effects / the event history).
      const resumePath = `${windowPath}.resume`;
      const resume = strictRecord(item.resume, resumePath);
      assertExactKeys(resume, resumePath, ['remaining', 'binder', 'continuationPoint']);
      if (!Array.isArray(resume.remaining) || resume.remaining.length > 1_000) invalidSnapshot(`${resumePath}.remaining`, 'contains too many flow nodes.');
      resume.remaining.forEach((node, nodeIndex) => strictJson(node, `${resumePath}.remaining[${nodeIndex}]`));
      strictJson(resume.binder, `${resumePath}.binder`);
      strictString(resume.continuationPoint, `${resumePath}.continuationPoint`, 200);
    }
    if (item.heldBoundary !== undefined) {
      // T6.3: the deferred turn-boundary effects an ordering window gates are
      // bounded JSON (the same durable surface as held effects) — replayed by
      // Render, never by the checkpoint hydrator.
      strictJson(item.heldBoundary, `${windowPath}.heldBoundary`);
    }
  });
  // U12 (schema 8): the durable armed-continuation collection — bounded JSON
  // records, deterministic order (arm order).
  if (!Array.isArray(encounter.continuations) || encounter.continuations.length > 10_000) invalidSnapshot('room.encounter.continuations', 'contains too many armed continuations.');
  encounter.continuations.forEach((continuation, index) => strictJson(continuation, `room.encounter.continuations[${index}]`));
  const encounterRevision = strictInteger(encounter.revision, 'room.encounter.revision', 0);
  strictInteger(encounter.resolutionSerial, 'room.encounter.resolutionSerial', 0);
  strictInteger(encounter.windowSerial, 'room.encounter.windowSerial', 0);
  if (!Array.isArray(encounter.eventLog) || encounter.eventLog.length > MAX_ENCOUNTER_EVENT_LOG) invalidSnapshot('room.encounter.eventLog', `contains more than ${MAX_ENCOUNTER_EVENT_LOG} recent events.`);
  encounter.eventLog.forEach((event, index) => {
    const eventPath = `room.encounter.eventLog[${index}]`;
    const item = strictRecord(event, eventPath);
    const type = strictEnum(item.type, `${eventPath}.type`, eventTypes);
    // Event history is not replayed during hydration, but it is later sent to
    // GMs and traversed during player redaction. Require bounded JSON here so
    // a malformed checkpoint cannot smuggle executable/non-serializable data.
    strictJson(item, eventPath);
    if (type === 'ACTOR_ADDED') {
      // Event history is presentation/audit material and is never replayed
      // while hydrating live mechanics. Historical actor snapshots predate
      // several schema fields, so retain a bounded identity-bearing shape
      // rather than requiring them to satisfy the current live Actor schema.
      const actor = strictRecord(item.actor, `${eventPath}.actor`);
      strictIdentifier(actor.id, `${eventPath}.actor.id`);
    }
  });
  return encounter as unknown as EncounterState & { revision: typeof encounterRevision };
}

function strictTable(value: unknown): TableState {
  const table = strictRecord(value, 'room.table');
  assertExactKeys(table, 'room.table', ['map', 'actorPresentation', 'fog', 'annotations', 'templates', 'clocks']);
  const map = strictRecord(table.map, 'room.table.map');
  assertExactKeys(map, 'room.table.map', ['backgroundUrl', 'scale', 'offset', 'cellSize', 'showGrid', 'showCoordinates']);
  const mapBackgroundUrl = strictString(map.backgroundUrl, 'room.table.map.backgroundUrl');
  assertDurableUrl(mapBackgroundUrl, 'room.table.map.backgroundUrl');
  strictFinite(map.scale, 'room.table.map.scale', Number.MIN_VALUE, 100);
  const offset = strictRecord(map.offset, 'room.table.map.offset');
  assertExactKeys(offset, 'room.table.map.offset', ['x', 'y']);
  strictFinite(offset.x, 'room.table.map.offset.x');
  strictFinite(offset.y, 'room.table.map.offset.y');
  strictFinite(map.cellSize, 'room.table.map.cellSize', 8, 1_024);
  strictBoolean(map.showGrid, 'room.table.map.showGrid');
  strictBoolean(map.showCoordinates, 'room.table.map.showCoordinates');
  const presentation = strictRecord(table.actorPresentation, 'room.table.actorPresentation');
  if (Object.keys(presentation).length > MAX_TABLE_ACTOR_PRESENTATIONS) invalidSnapshot('room.table.actorPresentation', 'contains too many actor presentations.');
  for (const [actorId, value] of Object.entries(presentation)) {
    const itemPath = `room.table.actorPresentation.${actorId}`;
    strictIdentifier(actorId, 'room.table.actorPresentation key');
    const item = strictRecord(value, itemPath);
    assertExactKeys(item, itemPath, [], ['tokenUrl', 'label', 'tokenScale', 'hidden']);
    if (item.tokenUrl !== undefined) assertDurableUrl(strictString(item.tokenUrl, `${itemPath}.tokenUrl`), `${itemPath}.tokenUrl`);
    if (item.label !== undefined) strictString(item.label, `${itemPath}.label`, 160);
    if (item.tokenScale !== undefined) strictFinite(item.tokenScale, `${itemPath}.tokenScale`, Number.MIN_VALUE, 20);
    if (item.hidden !== undefined) strictBoolean(item.hidden, `${itemPath}.hidden`);
  }
  let geometryPointCount = 0;
  strictTableList(table.fog, 'room.table.fog', MAX_TABLE_FOG_REGIONS, (item, path) => {
    assertExactKeys(item, path, ['id', 'cells'], ['hidden']);
    strictIdentifier(item.id, `${path}.id`);
    const cells = strictPositionArray(item.cells, `${path}.cells`, MAX_TABLE_POINTS_PER_ARTIFACT);
    if (cells.length === 0) invalidSnapshot(`${path}.cells`, 'must not be empty.');
    geometryPointCount += cells.length;
    if (item.hidden !== undefined) strictBoolean(item.hidden, `${path}.hidden`);
  });
  strictTableList(table.annotations, 'room.table.annotations', MAX_TABLE_ANNOTATIONS, (item, path) => {
    assertExactKeys(item, path, ['id', 'kind', 'points', 'color', 'text'], ['authorId', 'hidden']);
    strictIdentifier(item.id, `${path}.id`);
    strictEnum(item.kind, `${path}.kind`, new Set(['line', 'arrow', 'marker', 'note']));
    const points = strictPositionArray(item.points, `${path}.points`, MAX_TABLE_POINTS_PER_ARTIFACT);
    if (points.length === 0) invalidSnapshot(`${path}.points`, 'must not be empty.');
    geometryPointCount += points.length;
    strictString(item.color, `${path}.color`, 80);
    strictString(item.text, `${path}.text`, 1_000);
    if (item.authorId !== undefined && item.authorId !== null) strictIdentifier(item.authorId, `${path}.authorId`);
    if (item.hidden !== undefined) strictBoolean(item.hidden, `${path}.hidden`);
  });
  if (geometryPointCount > MAX_TABLE_GEOMETRY_POINTS) invalidSnapshot('room.table', `contains more than ${MAX_TABLE_GEOMETRY_POINTS} fog/annotation points.`);
  strictTableList(table.templates, 'room.table.templates', MAX_TABLE_TEMPLATES, (item, path) => {
    assertExactKeys(item, path, ['id', 'kind', 'origin', 'rotation', 'length', 'width', 'label', 'color'], ['authorId', 'hidden']);
    strictIdentifier(item.id, `${path}.id`);
    strictEnum(item.kind, `${path}.kind`, new Set(['burst', 'cone', 'line', 'rectangle']));
    strictPosition(item.origin, `${path}.origin`);
    strictFinite(item.rotation, `${path}.rotation`);
    strictInteger(item.length, `${path}.length`, 1, 100);
    strictInteger(item.width, `${path}.width`, 1, 100);
    strictString(item.label, `${path}.label`, 160);
    strictString(item.color, `${path}.color`, 80);
    if (item.authorId !== undefined && item.authorId !== null) strictIdentifier(item.authorId, `${path}.authorId`);
    if (item.hidden !== undefined) strictBoolean(item.hidden, `${path}.hidden`);
  });
  strictTableList(table.clocks, 'room.table.clocks', MAX_TABLE_CLOCKS, (item, path) => {
    assertExactKeys(item, path, ['id', 'name', 'segments', 'filled'], ['hidden']);
    strictIdentifier(item.id, `${path}.id`);
    strictString(item.name, `${path}.name`, 160, true);
    const segments = strictInteger(item.segments, `${path}.segments`);
    if (!validClockSegments.has(segments as TableClock['segments'])) invalidSnapshot(`${path}.segments`, 'must use a supported clock size.');
    strictInteger(item.filled, `${path}.filled`, 0, segments);
    if (item.hidden !== undefined) strictBoolean(item.hidden, `${path}.hidden`);
  });
  return table as unknown as TableState;
}

function strictTableList(value: unknown, path: string, maximum: number, validate: (item: Record<string, unknown>, path: string) => void) {
  if (!Array.isArray(value) || value.length > maximum) invalidSnapshot(path, `must be an array with at most ${maximum} items.`);
  value.forEach((item, index) => validate(strictRecord(item, `${path}[${index}]`), `${path}[${index}]`));
}

function validateMap(map: TableMapState) {
  assertDurableUrl(map.backgroundUrl, 'map background');
  if (!Number.isFinite(map.scale) || map.scale <= 0 || map.scale > 100) throw new VttRoomViolation('table.map-scale', 'Map scale must be between 0 and 100.');
  if (!Number.isFinite(map.cellSize) || map.cellSize < 8 || map.cellSize > 1_024) throw new VttRoomViolation('table.cell-size', 'Cell display size must be between 8 and 1024.');
  if (!Number.isFinite(map.offset.x) || !Number.isFinite(map.offset.y)) throw new VttRoomViolation('table.map-offset', 'Map offset must be finite.');
}

function validatePresentation(presentation: ActorPresentation) {
  if (presentation.tokenUrl !== undefined) assertDurableUrl(presentation.tokenUrl, 'token URL');
  if (presentation.label !== undefined && presentation.label.length > 160) throw new VttRoomViolation('table.label', 'Actor label is too long.');
  if (presentation.tokenScale !== undefined && (!Number.isFinite(presentation.tokenScale) || presentation.tokenScale <= 0 || presentation.tokenScale > 20)) throw new VttRoomViolation('table.token-scale', 'Token scale must be between 0 and 20.');
}

function validateFog(region: FogRegion) {
  assertIdentifier(region.id, 'fog id');
  if (!Array.isArray(region.cells) || region.cells.length === 0 || region.cells.length > MAX_TABLE_POINTS_PER_ARTIFACT) throw new VttRoomViolation('table.fog', `Fog must contain between one and ${MAX_TABLE_POINTS_PER_ARTIFACT.toLocaleString()} cells.`);
  region.cells.forEach((position, index) => assertPosition(position, `fog cell ${index + 1}`));
}

function validateAnnotation(annotation: Annotation) {
  assertIdentifier(annotation.id, 'annotation id');
  if (annotation.authorId !== undefined && annotation.authorId !== null) assertIdentifier(annotation.authorId, 'annotation author id');
  if (!['line', 'arrow', 'marker', 'note'].includes(annotation.kind)) throw new VttRoomViolation('table.annotation', 'Unknown annotation type.');
  if (!Array.isArray(annotation.points) || annotation.points.length === 0 || annotation.points.length > MAX_TABLE_POINTS_PER_ARTIFACT) throw new VttRoomViolation('table.annotation', `An annotation needs between one and ${MAX_TABLE_POINTS_PER_ARTIFACT.toLocaleString()} points.`);
  annotation.points.forEach((point, index) => assertPosition(point, `annotation point ${index + 1}`));
  if (annotation.text.length > 1_000 || annotation.color.length > 80) throw new VttRoomViolation('table.annotation', 'Annotation text or color is too long.');
}

function validateTemplate(template: AreaTemplate) {
  assertIdentifier(template.id, 'template id');
  if (template.authorId !== undefined && template.authorId !== null) assertIdentifier(template.authorId, 'template author id');
  if (!['burst', 'cone', 'line', 'rectangle'].includes(template.kind)) throw new VttRoomViolation('table.template', 'Unknown area template type.');
  assertPosition(template.origin, 'template origin');
  if (!Number.isFinite(template.rotation) || !Number.isInteger(template.length) || !Number.isInteger(template.width) || template.length < 1 || template.width < 1 || template.length > 100 || template.width > 100) throw new VttRoomViolation('table.template', 'Template dimensions must be whole values between one and 100.');
  if (template.label.length > 160 || template.color.length > 80) throw new VttRoomViolation('table.template', 'Template label or color is too long.');
}

function validateClock(clock: TableClock) {
  assertIdentifier(clock.id, 'clock id');
  if (clock.name.trim().length === 0 || clock.name.length > 160) throw new VttRoomViolation('table.clock', 'A clock needs a name.');
  if (!validClockSegments.has(clock.segments) || !Number.isInteger(clock.filled) || clock.filled < 0 || clock.filled > clock.segments) throw new VttRoomViolation('table.clock', 'Clock progress must fit its supported segment count.');
}

function replaceById<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex(({ id }) => id === item.id);
  if (index < 0) return [...items, clone(item)];
  const next = [...items];
  next[index] = clone(item);
  return next;
}

function assertTableCapacity(table: TableState) {
  if (Object.keys(table.actorPresentation).length > MAX_TABLE_ACTOR_PRESENTATIONS) {
    throw new VttRoomViolation('table.capacity', `A table can have at most ${MAX_TABLE_ACTOR_PRESENTATIONS} actor presentations.`);
  }
  if (table.fog.length > MAX_TABLE_FOG_REGIONS) throw new VttRoomViolation('table.capacity', `A table can have at most ${MAX_TABLE_FOG_REGIONS} fog regions.`);
  if (table.annotations.length > MAX_TABLE_ANNOTATIONS) throw new VttRoomViolation('table.capacity', `A table can have at most ${MAX_TABLE_ANNOTATIONS} annotations.`);
  if (table.templates.length > MAX_TABLE_TEMPLATES) throw new VttRoomViolation('table.capacity', `A table can have at most ${MAX_TABLE_TEMPLATES} templates.`);
  if (table.clocks.length > MAX_TABLE_CLOCKS) throw new VttRoomViolation('table.capacity', `A table can have at most ${MAX_TABLE_CLOCKS} clocks.`);
  const geometryPointCount = table.fog.reduce((count, region) => count + region.cells.length, 0)
    + table.annotations.reduce((count, annotation) => count + annotation.points.length, 0);
  if (geometryPointCount > MAX_TABLE_GEOMETRY_POINTS) {
    throw new VttRoomViolation('table.capacity', `Fog and annotations can contain at most ${MAX_TABLE_GEOMETRY_POINTS.toLocaleString()} total points.`);
  }
}

function checkedTableCommandResult(state: TableState, event: TableEvent): { state: TableState; event: TableEvent } {
  assertTableCapacity(state);
  return { state, event };
}

export function executeTableCommand(table: TableState, command: TableCommand): { state: TableState; event: TableEvent } {
  const state = clone(table);
  switch (command.type) {
    case 'SET_MAP': {
      const map = { ...state.map, ...clone(command.map), offset: command.map.offset ? { ...state.map.offset, ...command.map.offset } : state.map.offset };
      validateMap(map);
      return checkedTableCommandResult({ ...state, map }, { type: 'MAP_SET', map });
    }
    case 'SET_ACTOR_PRESENTATION': {
      assertIdentifier(command.actorId, 'actor id');
      if (command.presentation) validatePresentation(command.presentation);
      if (command.presentation) state.actorPresentation[command.actorId] = clone(command.presentation);
      else delete state.actorPresentation[command.actorId];
      return checkedTableCommandResult(state, { type: 'ACTOR_PRESENTATION_SET', actorId: command.actorId, presentation: command.presentation ? clone(command.presentation) : null });
    }
    case 'PAINT_FOG':
      validateFog(command.region);
      state.fog = replaceById(state.fog, command.region);
      return checkedTableCommandResult(state, { type: 'FOG_PAINTED', region: clone(command.region) });
    case 'ERASE_FOG':
      assertIdentifier(command.regionId, 'fog id');
      state.fog = state.fog.filter(({ id }) => id !== command.regionId);
      return checkedTableCommandResult(state, { type: 'FOG_ERASED', regionId: command.regionId });
    case 'CLEAR_FOG':
      state.fog = [];
      return checkedTableCommandResult(state, { type: 'FOG_CLEARED' });
    case 'UPSERT_ANNOTATION':
      validateAnnotation(command.annotation);
      state.annotations = replaceById(state.annotations, command.annotation);
      return checkedTableCommandResult(state, { type: 'ANNOTATION_UPSERTED', annotation: clone(command.annotation) });
    case 'REMOVE_ANNOTATION':
      assertIdentifier(command.annotationId, 'annotation id');
      state.annotations = state.annotations.filter(({ id }) => id !== command.annotationId);
      return checkedTableCommandResult(state, { type: 'ANNOTATION_REMOVED', annotationId: command.annotationId });
    case 'UPSERT_TEMPLATE':
      validateTemplate(command.template);
      state.templates = replaceById(state.templates, command.template);
      return checkedTableCommandResult(state, { type: 'TEMPLATE_UPSERTED', template: clone(command.template) });
    case 'REMOVE_TEMPLATE':
      assertIdentifier(command.templateId, 'template id');
      state.templates = state.templates.filter(({ id }) => id !== command.templateId);
      return checkedTableCommandResult(state, { type: 'TEMPLATE_REMOVED', templateId: command.templateId });
    case 'UPSERT_CLOCK':
      validateClock(command.clock);
      state.clocks = replaceById(state.clocks, command.clock);
      return checkedTableCommandResult(state, { type: 'CLOCK_UPSERTED', clock: clone(command.clock) });
    case 'REMOVE_CLOCK':
      assertIdentifier(command.clockId, 'clock id');
      state.clocks = state.clocks.filter(({ id }) => id !== command.clockId);
      return checkedTableCommandResult(state, { type: 'CLOCK_REMOVED', clockId: command.clockId });
  }
}

export function applyTableEvent(table: TableState, event: TableEvent): TableState {
  switch (event.type) {
    case 'MAP_SET': return { ...clone(table), map: clone(event.map) };
    case 'ACTOR_PRESENTATION_SET': {
      const state = clone(table);
      if (event.presentation) state.actorPresentation[event.actorId] = clone(event.presentation);
      else delete state.actorPresentation[event.actorId];
      return state;
    }
    case 'FOG_PAINTED': return { ...clone(table), fog: replaceById(table.fog, event.region) };
    case 'FOG_ERASED': return { ...clone(table), fog: table.fog.filter(({ id }) => id !== event.regionId) };
    case 'FOG_CLEARED': return { ...clone(table), fog: [] };
    case 'ANNOTATION_UPSERTED': return { ...clone(table), annotations: replaceById(table.annotations, event.annotation) };
    case 'ANNOTATION_REMOVED': return { ...clone(table), annotations: table.annotations.filter(({ id }) => id !== event.annotationId) };
    case 'TEMPLATE_UPSERTED': return { ...clone(table), templates: replaceById(table.templates, event.template) };
    case 'TEMPLATE_REMOVED': return { ...clone(table), templates: table.templates.filter(({ id }) => id !== event.templateId) };
    case 'CLOCK_UPSERTED': return { ...clone(table), clocks: replaceById(table.clocks, event.clock) };
    case 'CLOCK_REMOVED': return { ...clone(table), clocks: table.clocks.filter(({ id }) => id !== event.clockId) };
  }
}

export function executeRoomCommand(room: VttRoomState, command: RoomCommand, dice?: DiceSource): RoomCommandResult {
  if (command.domain === 'encounter') {
    const result = executeCommand(room.encounter, command.command, dice);
    return {
      state: { ...clone(room), encounter: result.state, revision: room.revision + 1 },
      events: [{ domain: 'encounter', events: result.events }],
    };
  }
  const result = executeTableCommand(room.table, command.command);
  return {
    state: { ...clone(room), table: result.state, revision: room.revision + 1 },
    events: [{ domain: 'table', event: result.event }],
  };
}

/** Replays room events without using React or a second tabletop state model. */
export function applyRoomEvents(room: VttRoomState, events: RoomEvent[]): VttRoomState {
  let state = clone(room);
  for (const event of events) {
    if (event.domain === 'encounter') state = { ...state, encounter: applyEvents(state.encounter, event.events), revision: state.revision + 1 };
    else state = { ...state, table: applyTableEvent(state.table, event.event), revision: state.revision + 1 };
  }
  return state;
}

/** Redacts every GM-hidden item before a player payload is serialized. */
export function roomVisibleToRole(room: VttRoomState, role: 'gm' | 'player'): VttRoomState {
  if (role === 'gm') return clone(room);
  const hiddenActorIds = new Set(Object.entries(room.table.actorPresentation)
    .filter(([, presentation]) => presentation.hidden)
    .map(([actorId]) => actorId));
  // Legacy snapshots did not always retain an owner id. In that case, a
  // source unit uniquely carried by a hidden actor is still enough to keep
  // its mechanics out of the player projection. New mutations always carry
  // ownerId, so this is only a conservative migration safety net.
  const hiddenSourceIds = new Set(
    [...hiddenActorIds].flatMap((actorId) => {
      const actor = room.encounter.actors[actorId];
      return actor ? [...actor.abilityIds, ...actor.traitIds] : [];
    }),
  );
  const isHiddenMechanic = (ownerId: string | null, sourceId: string) =>
    // Unknown historical provenance is not safe to show to a player: it may
    // have been created by a hidden source whose owner field did not exist in
    // that schema. Render still resolves full authority; the projection errs
    // on the side of withholding the ambiguous presentation.
    ownerId === null
    || hiddenActorIds.has(ownerId)
    || hiddenSourceIds.has(sourceId);
  const table = clone(room.table);
  table.actorPresentation = Object.fromEntries(Object.entries(table.actorPresentation).filter(([, presentation]) => !presentation.hidden));
  table.fog = table.fog.filter((region) => !region.hidden);
  table.annotations = table.annotations.filter((annotation) => !annotation.hidden);
  table.templates = table.templates.filter((template) => !template.hidden);
  table.clocks = table.clocks.filter((clock) => !clock.hidden);
  const encounter = clone(room.encounter);
  for (const actorId of hiddenActorIds) delete encounter.actors[actorId];
  if (encounter.activeActorId && hiddenActorIds.has(encounter.activeActorId)) encounter.activeActorId = null;
  encounter.entities = Object.fromEntries(Object.entries(encounter.entities)
    .filter(([, entity]) => entity.ownerId !== null && !hiddenActorIds.has(entity.ownerId)));
  encounter.terrainEffects = encounter.terrainEffects
    .filter((effect) => !isHiddenMechanic(effect.ownerId, effect.sourceId));
  // A hidden actor's windows are as sensitive as the actor record.
  encounter.decisionWindows = encounter.decisionWindows
    .filter((window) => !hiddenActorIds.has(window.actorId))
    // Deferred-trigger windows hold the triggering ability's mutations, which
    // name the source; a Masquerade redirect names the swap partner; the U12
    // held payload names the source/target of the held result. Render stays
    // authoritative; the player projection withholds any reference to a
    // hidden actor rather than leak its id.
    .map((window) => {
      const heldSave = windowHeldSave(window);
      const heldDamage = windowHeldDamage(window);
      const payloadHidden = heldSave
        ? hiddenActorIds.has(heldSave.targetId) || hiddenActorIds.has(heldSave.sourceActorId)
        : heldDamage
          ? hiddenActorIds.has(heldDamage.sourceActorId)
          : false;
      return {
        ...window,
        heldEffects: window.heldEffects?.filter((effect) => !hiddenActorIds.has((effect as { sourceActorId?: string }).sourceActorId ?? '')
          && !hiddenSourceIds.has((effect as { sourceId?: string }).sourceId ?? '')) || undefined,
        retarget: window.retarget && !hiddenActorIds.has(window.retarget.fromActorId) && !hiddenActorIds.has(window.retarget.toActorId) ? window.retarget : undefined,
        heldPayload: window.heldPayload && !payloadHidden ? window.heldPayload : undefined,
      };
    });
  // A visible actor can carry mechanics created by another actor. Keep no
  // owner reference for a GM-hidden source in the player projection: those
  // IDs are as sensitive as the hidden actor record itself. Filtering is
  // safe here because Render, not this projection, remains authoritative for
  // subsequent command resolution.
  for (const actor of Object.values(encounter.actors)) {
    actor.conditions = actor.conditions.filter((condition) => !isHiddenMechanic(condition.ownerId, condition.sourceId));
    actor.marks = actor.marks.filter((mark) => !hiddenActorIds.has(mark.ownerId) && !hiddenSourceIds.has(mark.sourceId));
    actor.activeEffects = actor.activeEffects.filter((effect) => !hiddenActorIds.has(effect.ownerId) && !hiddenSourceIds.has(effect.sourceId));
    if (actor.stance && isHiddenMechanic(actor.stance.ownerId, actor.stance.sourceId)) actor.stance = null;
    for (const [key, ownerId] of Object.entries(actor.ruleStateOwners)) {
      // A current mutation records its source actor. Null is therefore only a
      // legacy/ambiguous provenance value and cannot safely be shown in a
      // player projection: custom rule-state keys may have originated with a
      // hidden actor just as readily as built-in trait/core-rule keys.
      if (ownerId === null || hiddenActorIds.has(ownerId)) {
        delete actor.ruleState[key];
        delete actor.ruleStateOwners[key];
      }
    }
  }
  // Historical reducer events are an engineering/audit surface, not a player
  // protocol. Event schemas have evolved and a GM checkpoint can contain
  // arbitrary diagnostic fields even when its mechanical state is valid. The
  // authoritative server already gives players an empty replay stream, so do
  // the same in the projected snapshot rather than trying to prove every
  // nested historical event is safe to disclose.
  encounter.eventLog = [];
  return { ...clone(room), encounter, table };
}

/** Convert low-level invalid command errors into the familiar rules violation shape. */
export function asRuleViolation(error: unknown): never {
  if (error instanceof RuleViolation) throw error;
  if (error instanceof VttRoomViolation) throw new RuleViolation(error.code, error.message);
  throw error;
}
