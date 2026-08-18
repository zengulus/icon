import type { EncounterCommand, EncounterEvent, EncounterState } from './types.js';
import { z } from 'zod';

export type ClientMessage =
  | { type: 'join'; encounterId: string; token: string }
  | { type: 'command'; encounterId: string; expectedRevision: number; command: EncounterCommand }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'joined'; encounterId: string; state: EncounterState; role: 'gm' | 'player' }
  | { type: 'events'; encounterId: string; events: EncounterEvent[]; state: EncounterState }
  | { type: 'error'; code: string; message: string; state?: EncounterState }
  | { type: 'pong' };

const identifier = z.string().min(1).max(160);
const position = z.object({ x: z.number().int(), y: z.number().int() }).strict();
const status = z.enum(['slashed', 'blind', 'dazed', 'hatred', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable']);
const terrainType = z.enum(['basic', 'difficult', 'dangerous', 'impassable', 'pit', 'slope']);
const primitive = z.union([z.string().max(2_048), z.number().finite(), z.boolean(), z.null()]);
const stateRecord = z.record(identifier, primitive);
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

const actor = z.object({
  id: identifier,
  name: z.string().min(1).max(120),
  side: z.enum(['heroes', 'foes']),
  controllerId: z.string().max(160).nullable(),
  characterId: z.string().max(160).nullable(),
  foeProfileId: z.string().max(200).nullable().optional(),
  roleId: z.enum(['mob', 'heavy', 'skirmisher', 'leader', 'artillery', 'legend', 'special']).nullable(),
  actorKind: z.enum(['hero', 'foe', 'summon']),
  size: z.number().int().min(1).max(20),
  tokenUrl: z.string().max(2_048),
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
  conditions: z.array(z.object({ id: identifier, sourceId: identifier, potency: z.enum(['normal', 'plus']), duration: duration.nullable() }).strict()).max(200),
  resources: z.record(identifier, z.number().int().min(0).max(1_000_000)),
  ruleState: stateRecord,
  activeEffects: z.array(z.object({ id: identifier, sourceId: identifier, effectId: identifier, ownerId: identifier, duration, modifiers: z.array(modifier).max(100), triggers: z.array(identifier).max(100), state: stateRecord }).strict()).max(500),
  marks: z.array(z.object({ id: identifier, sourceId: identifier, ownerId: identifier, markId: identifier, duration: duration.nullable(), state: stateRecord }).strict()).max(100),
  stance: z.object({ id: identifier, sourceId: identifier, stanceId: identifier, state: stateRecord }).strict().nullable(),
  traitIds: z.array(identifier).max(500),
  onBattlefield: z.boolean(),
  defeated: z.boolean(),
  actionsRemaining: z.number().int().min(0).max(20),
  standardMoveUsed: z.boolean(),
  attackedThisTurn: z.boolean(),
  usedAbilityIds: z.array(identifier).max(200),
  interruptUses: z.record(identifier, z.number().int().min(0).max(100)),
  interruptUsedThisTurn: z.boolean(),
  slashedTriggeredThisTurn: z.boolean(),
  turnTaken: z.boolean(),
}).strict();

const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ADD_ACTOR'), actor }).strict(),
  z.object({ type: z.literal('REMOVE_ACTOR'), actorId: identifier }).strict(),
  z.object({ type: z.literal('SET_TERRAIN'), cell: z.object({ position, type: terrainType, elevation: z.number().int().min(-100).max(100) }).strict() }).strict(),
  z.object({ type: z.literal('START_ENCOUNTER') }).strict(),
  z.object({ type: z.literal('MOVE'), actorId: identifier, path: z.array(position).min(1).max(1_000), mode: z.enum(['standard', 'dash']) }).strict(),
  z.object({ type: z.literal('BASIC_ATTACK'), actorId: identifier, targetId: identifier, weight: z.enum(['light', 'heavy']), boons: z.number().int().min(-20).max(20).optional(), cover: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('USE_ABILITY'), actorId: identifier, abilityId: identifier, targetIds: z.array(identifier).max(100), boons: z.number().int().min(-20).max(20).optional(), cover: z.boolean().optional() }).strict(),
  z.object({
    type: z.literal('EXECUTE_RULE'),
    actorId: identifier,
    sourceId: identifier,
    actionId: identifier,
    timing: z.enum(['use', 'passive', 'interrupt', 'round-start', 'round-end', 'turn-start', 'turn-end', 'targeted', 'attack-before', 'attack-hit', 'attack-miss', 'attack-critical', 'ability-resolved', 'damaged', 'defeated', 'movement-start', 'movement-end', 'stance-refresh', 'mark-trigger', 'summon-trigger', 'phase-change', 'camp', 'interlude', 'expedition-start', 'combat-start', 'combat-end']),
    input: z.object({
      actorIds: z.record(identifier, z.array(identifier).max(100)).optional(),
      positions: z.record(identifier, z.array(position).max(1_000)).optional(),
      directions: z.record(identifier, position).optional(),
      options: z.record(identifier, z.string().max(500)).optional(),
      numbers: z.record(identifier, z.number().finite()).optional(),
      booleans: z.record(identifier, z.boolean()).optional(),
    }).strict(),
    attackTargetId: identifier.optional(),
    triggerSourceId: identifier.optional(),
    triggerTargetIds: z.array(identifier).max(100).optional(),
    triggers: z.array(identifier).max(100).optional(),
  }).strict(),
  z.object({ type: z.literal('INTERACT'), actorId: identifier, position, description: z.string().max(500) }).strict(),
  z.object({ type: z.literal('RESCUE'), actorId: identifier, targetId: identifier }).strict(),
  z.object({ type: z.literal('RECOVER'), actorId: identifier }).strict(),
  z.object({ type: z.literal('END_TURN'), actorId: identifier }).strict(),
  z.object({ type: z.literal('APPLY_STATUS'), actorId: identifier, targetId: identifier, status }).strict(),
  z.object({ type: z.literal('END_ENCOUNTER') }).strict(),
]);

const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), encounterId: identifier, token: z.string().min(1).max(16_384) }).strict(),
  z.object({ type: z.literal('command'), encounterId: identifier, expectedRevision: z.number().int().min(0), command }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);

export function parseClientMessage(input: string): ClientMessage {
  const parsed = clientMessage.safeParse(JSON.parse(input));
  if (!parsed.success) throw new Error(`Invalid websocket message: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`);
  return parsed.data as ClientMessage;
}
