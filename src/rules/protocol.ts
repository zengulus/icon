import type { EncounterCommand } from './types.js';
import type { RoomCommand, RoomEvent, VttRoomState } from './vtt-room.js';
import { isDurableAssetUrl } from './durable-assets.js';
import { z } from 'zod';

export type ClientMessage =
  | { type: 'join'; encounterId: string; token: string }
  | { type: 'command'; encounterId: string; expectedRevision: number; command: RoomCommand }
  | { type: 'ping'; encounterId: string; position: { x: number; y: number } }
  | { type: 'save'; encounterId: string; expectedRevision: number };

export type ServerMessage =
  | { type: 'joined'; encounterId: string; state: VttRoomState; role: 'gm' | 'player'; saveStatus: 'saved' | 'unsaved' | 'save-error' }
  | { type: 'events'; encounterId: string; events: RoomEvent[]; state: VttRoomState; saveStatus: 'saved' | 'unsaved' | 'save-error' }
  | { type: 'error'; code: string; message: string; state?: VttRoomState }
  | { type: 'ping'; encounterId: string; userId: string; position: { x: number; y: number } }
  | { type: 'save-status'; encounterId: string; status: 'saved' | 'unsaved' | 'save-error'; revision: number }
  | { type: 'save-complete'; encounterId: string; revision: number };

const identifier = z.string().min(1).max(160);
// Stateful validation applies exact room-grid bounds. This broad protocol
// bound prevents pathological coordinate payloads before that lookup.
const position = z.object({ x: z.number().int().min(-10_000).max(10_000), y: z.number().int().min(-10_000).max(10_000) }).strict();
const status = z.enum(['slashed', 'blind', 'dazed', 'hatred', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable']);
const terrainType = z.enum(['basic', 'difficult', 'dangerous', 'impassable', 'pit', 'slope']);
const primitive = z.union([z.string().max(2_048), z.number().finite(), z.boolean(), z.null()]);
/** Keep a valid websocket command inside the same durable bounds as a checkpoint. */
function boundedRecord<Value extends z.ZodTypeAny>(value: Value, maximum = 500) {
  return z.record(identifier, value).refine((record) => Object.keys(record).length <= maximum, {
    message: `Record cannot contain more than ${maximum} entries.`,
  });
}
const stateRecord = boundedRecord(primitive);
const duration = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('instant') }).strict(),
  z.object({ kind: z.literal('turn-end'), actor: z.unknown(), turns: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ kind: z.literal('turn-start'), actor: z.unknown(), turns: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ kind: z.literal('round-end'), rounds: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ kind: z.literal('round-start'), rounds: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ kind: z.literal('combat') }).strict(),
  z.object({ kind: z.literal('expedition') }).strict(),
  z.object({ kind: z.literal('until'), event: identifier, sourceId: identifier.optional() }).strict(),
]);
const modifier = z.object({
  stat: identifier,
  operation: z.enum(['add', 'subtract', 'set', 'upgrade', 'downgrade', 'grant', 'deny', 'immune', 'resist']),
  value: z.union([z.string().max(2_048), z.boolean(), z.object({ kind: z.string().max(80) }).passthrough()]).optional(),
}).strict();
const statusSaveChoice = z.object({ spendBlessing: z.boolean().optional() }).strict();
// Core commands expose only explicit p.102 Blessing decisions.  Their
// tactical selector/cost input remains authoritative reducer state rather
// than a client-controlled generic RuleProgram payload.
const statusSaveInput = z.object({
  statusSaveChoices: boundedRecord(boundedRecord(statusSaveChoice, 20), 100).optional(),
}).strict();

const actor = z.object({
  id: identifier,
  name: z.string().min(1).max(120),
  side: z.enum(['heroes', 'foes']),
  controllerId: z.string().max(160).nullable(),
  characterId: z.string().max(160).nullable(),
  foeProfileId: z.string().max(200).nullable(),
  roleId: z.enum(['mob', 'heavy', 'skirmisher', 'leader', 'artillery', 'legend', 'special']).nullable(),
  actorKind: z.enum(['hero', 'foe', 'summon']),
  size: z.number().int().min(1).max(20),
  tokenUrl: z.string().max(2_048).refine(isDurableAssetUrl, 'Token URL must be durable and cannot use blob:.'),
  classId: z.enum(['stalwart', 'vagabond', 'mendicant', 'wright', 'foe']),
  chapter: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  abilityIds: z.array(identifier).max(200),
  position,
  vitality: z.number().int().min(0).max(10_000),
  baseMaxHp: z.number().int().min(1).max(1_000_000),
  hp: z.number().int().min(0).max(1_000_000),
  vigor: z.number().int().min(0).max(1_000_000),
  wounds: z.number().int().min(0).max(4),
  defense: z.number().int().min(0).max(1_000),
  armor: z.number().int().min(0).max(1_000),
  speed: z.number().int().min(0).max(1_000),
  dash: z.number().int().min(0).max(1_000),
  fray: z.number().int().min(0).max(1_000),
  damageDie: z.union([z.literal(6), z.literal(8), z.literal(10)]),
  basicAttackRange: z.number().int().min(0).max(1_000),
  statuses: z.array(status).max(20),
  conditions: z.array(z.object({ id: identifier, sourceId: identifier, ownerId: identifier.nullable(), potency: z.enum(['normal', 'plus']), duration: duration.nullable() }).strict()).max(200),
  resources: boundedRecord(z.number().int().min(0).max(1_000_000)),
  ruleState: stateRecord,
  ruleStateOwners: boundedRecord(identifier.nullable()),
  activeEffects: z.array(z.object({ id: identifier, sourceId: identifier, effectId: identifier, ownerId: identifier, duration, modifiers: z.array(modifier).max(100), triggers: z.array(identifier).max(100), state: stateRecord }).strict()).max(500),
  marks: z.array(z.object({ id: identifier, sourceId: identifier, ownerId: identifier, markId: identifier, duration: duration.nullable(), state: stateRecord }).strict()).max(100),
  stance: z.object({ id: identifier, sourceId: identifier, ownerId: identifier.nullable(), stanceId: identifier, state: stateRecord }).strict().nullable(),
  traitIds: z.array(identifier).max(500),
  // F7: the equipped talent choice per ability (1 or 2).
  talents: boundedRecord(z.union([z.literal(1), z.literal(2)])),
  // F8: the mastered ability ids — durable encounter authority for the
  // mastery attachment gate (never queried from the character sheet).
  masteredAbilityIds: z.array(identifier).max(200),
  onBattlefield: z.boolean(),
  defeated: z.boolean(),
  actionsRemaining: z.number().int().min(0).max(20),
  standardMoveUsed: z.boolean(),
  attackedThisTurn: z.boolean(),
  usedAbilityIds: z.array(identifier).max(200),
  interruptUses: boundedRecord(z.number().int().min(0).max(100)),
  interruptUsedThisTurn: z.boolean(),
  slashedTriggeredThisTurn: z.boolean(),
  dangerousTerrainTriggeredThisTurn: z.boolean(),
  turnTaken: z.boolean(),
}).strict();

const encounterCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ADD_ACTOR'), actor }).strict(),
  z.object({ type: z.literal('REMOVE_ACTOR'), actorId: identifier }).strict(),
  z.object({ type: z.literal('SET_TERRAIN'), cell: z.object({ position, type: terrainType, elevation: z.number().int().min(-100).max(100) }).strict() }).strict(),
  z.object({ type: z.literal('START_ENCOUNTER') }).strict(),
  z.object({ type: z.literal('MOVE'), actorId: identifier, path: z.array(position).min(1).max(1_000), mode: z.enum(['standard', 'dash']), input: statusSaveInput.optional() }).strict(),
  z.object({ type: z.literal('BASIC_ATTACK'), actorId: identifier, targetId: identifier, weight: z.enum(['light', 'heavy']), input: statusSaveInput.optional() }).strict(),
  z.object({ type: z.literal('USE_ABILITY'), actorId: identifier, abilityId: identifier, targetIds: z.array(identifier).max(100), input: statusSaveInput.optional() }).strict(),
  z.object({
    type: z.literal('EXECUTE_RULE'),
    actorId: identifier,
    sourceId: identifier,
    actionId: identifier,
    timing: z.enum(['use', 'passive', 'interrupt', 'round-start', 'round-end', 'turn-start', 'turn-end', 'targeted', 'attack-before', 'attack-hit', 'attack-miss', 'attack-critical', 'ability-resolved', 'damaged', 'defeated', 'movement-start', 'movement-end', 'stance-refresh', 'mark-trigger', 'summon-trigger', 'phase-change', 'camp', 'interlude', 'expedition-start', 'combat-start', 'combat-end']),
    input: z.object({
      actorIds: boundedRecord(z.array(identifier).max(100), 100).optional(),
      positions: boundedRecord(z.array(position).max(1_000), 100).optional(),
      directions: boundedRecord(position, 100).optional(),
      options: boundedRecord(z.string().max(500), 100).optional(),
      numbers: boundedRecord(z.number().finite(), 100).optional(),
      booleans: boundedRecord(z.boolean(), 100).optional(),
      statusSaveChoices: boundedRecord(boundedRecord(statusSaveChoice, 20), 100).optional(),
    }).strict(),
    attackTargetId: identifier.optional(),
    triggerSourceId: identifier.optional(),
    triggerTargetIds: z.array(identifier).max(100).optional(),
    triggers: z.array(identifier).max(100).optional(),
  }).strict(),
  z.object({ type: z.literal('INTERACT'), actorId: identifier, position, description: z.string().max(500), input: statusSaveInput.optional() }).strict(),
  z.object({ type: z.literal('RESCUE'), actorId: identifier, targetId: identifier, input: statusSaveInput.optional() }).strict(),
  z.object({ type: z.literal('RECOVER'), actorId: identifier, input: statusSaveInput.optional() }).strict(),
  z.object({ type: z.literal('SPEND_VIGILANCE'), actorId: identifier, targetId: identifier, use: z.enum(['guard', 'punish']), damage: z.number().finite().optional() }).strict(),
  z.object({ type: z.literal('END_TURN'), actorId: identifier, input: statusSaveInput.optional() }).strict(),
  z.object({ type: z.literal('END_ENCOUNTER') }).strict(),
]);

const mapOffset = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const tableMapPatch = z.object({
  backgroundUrl: z.string().max(2_048).refine(isDurableAssetUrl, 'Map URL must be durable and cannot use blob:.').optional(),
  scale: z.number().finite().positive().max(100).optional(),
  offset: mapOffset.optional(),
  cellSize: z.number().finite().min(8).max(1_024).optional(),
  showGrid: z.boolean().optional(),
  showCoordinates: z.boolean().optional(),
}).strict();
const presentation = z.object({
  tokenUrl: z.string().max(2_048).refine(isDurableAssetUrl, 'Token URL must be durable and cannot use blob:.').optional(),
  label: z.string().max(160).optional(),
  tokenScale: z.number().finite().positive().max(20).optional(),
  hidden: z.boolean().optional(),
}).strict();
const fogRegion = z.object({ id: identifier, cells: z.array(position).min(1).max(10_000), hidden: z.boolean().optional() }).strict();
const annotation = z.object({
  id: identifier,
  kind: z.enum(['line', 'arrow', 'marker', 'note']),
  points: z.array(position).min(1).max(10_000),
  color: z.string().max(80),
  text: z.string().max(1_000),
  hidden: z.boolean().optional(),
}).strict();
const template = z.object({
  id: identifier,
  kind: z.enum(['burst', 'cone', 'line', 'rectangle']),
  origin: position,
  rotation: z.number().finite(),
  length: z.number().int().min(1).max(100),
  width: z.number().int().min(1).max(100),
  label: z.string().max(160),
  color: z.string().max(80),
  hidden: z.boolean().optional(),
}).strict();
const tableClock = z.object({
  id: identifier,
  name: z.string().min(1).max(160),
  segments: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  filled: z.number().int().min(0).max(12),
  hidden: z.boolean().optional(),
}).strict().superRefine((clock, context) => {
  if (clock.filled > clock.segments) context.addIssue({ code: 'custom', message: 'Clock progress cannot exceed its segments.', path: ['filled'] });
});
const tableCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SET_MAP'), map: tableMapPatch }).strict(),
  z.object({ type: z.literal('SET_ACTOR_PRESENTATION'), actorId: identifier, presentation: presentation.nullable() }).strict(),
  z.object({ type: z.literal('PAINT_FOG'), region: fogRegion }).strict(),
  z.object({ type: z.literal('ERASE_FOG'), regionId: identifier }).strict(),
  z.object({ type: z.literal('CLEAR_FOG') }).strict(),
  z.object({ type: z.literal('UPSERT_ANNOTATION'), annotation }).strict(),
  z.object({ type: z.literal('REMOVE_ANNOTATION'), annotationId: identifier }).strict(),
  z.object({ type: z.literal('UPSERT_TEMPLATE'), template }).strict(),
  z.object({ type: z.literal('REMOVE_TEMPLATE'), templateId: identifier }).strict(),
  z.object({ type: z.literal('UPSERT_CLOCK'), clock: tableClock }).strict(),
  z.object({ type: z.literal('REMOVE_CLOCK'), clockId: identifier }).strict(),
]);
const roomCommand = z.discriminatedUnion('domain', [
  z.object({ domain: z.literal('encounter'), command: encounterCommand }).strict(),
  z.object({ domain: z.literal('table'), command: tableCommand }).strict(),
]);

const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), encounterId: identifier, token: z.string().min(1).max(16_384) }).strict(),
  z.object({ type: z.literal('command'), encounterId: identifier, expectedRevision: z.number().int().min(0), command: roomCommand }).strict(),
  z.object({ type: z.literal('ping'), encounterId: identifier, position }).strict(),
  z.object({ type: z.literal('save'), encounterId: identifier, expectedRevision: z.number().int().min(0) }).strict(),
]);

export function parseClientMessage(input: string): ClientMessage {
  const parsed = clientMessage.safeParse(JSON.parse(input));
  if (!parsed.success) throw new Error(`Invalid websocket message: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`);
  return parsed.data as ClientMessage;
}
