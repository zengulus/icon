import { ENCOUNTER_SCHEMA_VERSION } from '../rules/types.js';
import {
  VTT_ROOM_SCHEMA_VERSION,
  assertValidEncounterState,
  assertValidVttRoomState,
  migrateVttRoom,
  type VttRoomState,
} from '../rules/vtt-room.js';

function record(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

/**
 * Restore an offline room without treating a current durable snapshot as a
 * legacy shape. Historical snapshots can still receive their documented,
 * deterministic migrations; a current snapshot must already satisfy the
 * strict checkpoint contract before it is allowed through.
 */
export function restorePersistedVttRoom(input: unknown): VttRoomState {
  const candidate = record(input);
  if (!candidate) return migrateAndValidate(input);

  if (candidate.schemaVersion === VTT_ROOM_SCHEMA_VERSION && 'encounter' in candidate) {
    assertValidVttRoomState(input);
    return structuredClone(input) as VttRoomState;
  }

  // A legacy room wrapper may legitimately contain a current encounter while
  // retaining a historical table model. Do not let encounter migration fill
  // missing current fields in that mixed-version case.
  const encounter = 'encounter' in candidate ? record(candidate.encounter) : candidate;
  if (encounter?.schemaVersion === ENCOUNTER_SCHEMA_VERSION) {
    assertValidEncounterState(encounter);
  }

  return migrateAndValidate(input);
}

function migrateAndValidate(input: unknown): VttRoomState {
  const migrated = migrateVttRoom(input);
  assertValidVttRoomState(migrated);
  return migrated;
}
