export const RULES_VERSION = '1.5' as const;
export const CHARACTER_SCHEMA_VERSION = 2 as const;
export const ENCOUNTER_SCHEMA_VERSION = 2 as const;

export const ACTION_IDS = [
  'sneak',
  'traverse',
  'sense',
  'study',
  'charm',
  'command',
  'tinker',
  'excel',
  'smash',
  'endure',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];
export type ActionRatings = Record<ActionId, number>;
export type JobClassId = 'stalwart' | 'vagabond' | 'mendicant' | 'wright';
export type FoeRoleId = 'mob' | 'heavy' | 'skirmisher' | 'leader' | 'artillery' | 'legend' | 'special';
export type FoeKind = 'job' | 'variant' | 'unique' | 'elite' | 'legend' | 'component' | 'special';
export type DamageDie = 6 | 8 | 10;

export interface SourceReference {
  page: number;
  sectionId: string;
}

export interface ActionDefinition {
  id: ActionId;
  name: string;
  description: string;
  source: SourceReference;
}

export interface BondDefinition {
  id: string;
  name: string;
  summary: string;
  actions: readonly [ActionId, ActionId];
  effort: number;
  strain: number;
  powers: readonly string[];
  ideals: readonly string[];
  secondWind: string;
  specialAbility: string;
  kits: readonly { name: string; itemsText: string }[];
  powerDetails: readonly { name: string; rulesText: string; source: SourceReference }[];
  source: SourceReference;
}

export interface ClassStats {
  vitality: number;
  hp: number;
  defense: number;
  armor: number;
  speed: number;
  dash: number;
  fray: number;
  damageDie: DamageDie;
  basicAttackRange: number;
}

export interface JobClassDefinition {
  id: JobClassId;
  name: string;
  color: string;
  summary: string;
  stats: ClassStats;
  source: SourceReference;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  jobId: string;
  classId: JobClassId;
  chapter: 1 | 2 | 3;
  cost: { kind: 'action' | 'free' | 'interrupt' | 'passive'; value: number };
  range: number | null;
  tags: readonly string[];
  header: string;
  summary: string;
  rulesText: string;
  talents: readonly [] | readonly [string, string];
  mastery: { name: string; text: string } | null;
  source: SourceReference;
  automation: 'structured' | 'executable';
}

export interface JobDefinition {
  id: string;
  name: string;
  epithet: string;
  classId: JobClassId;
  source: SourceReference;
  endPage: number;
  traitsText: string;
  limitBreak: { name: string; rulesText: string } | null;
  abilities: readonly AbilityDefinition[];
}

export interface RelicDefinition {
  id: string;
  name: string;
  description: string;
  ranks: readonly [string, string, string];
  aspect: string;
  aspectQuest: string;
  source: SourceReference;
  automation: 'structured' | 'executable';
}

export interface FoeRoleDefinition {
  id: Exclude<FoeRoleId, 'special'>;
  name: string;
  vitality: number | null;
  hp: number | null;
  hpPerPlayer: number | null;
  minimumHp: number | null;
  speed: number;
  dash: number;
  defense: number;
  fray: number;
  damageDie: DamageDie;
  membersPerPlayer: number | null;
  memberHits: number | null;
  traitsText: string;
  source: SourceReference;
}

export interface FoeAbilityDefinition {
  id: string;
  name: string;
  header: string;
  cost: { kind: 'action' | 'free' | 'interrupt' | 'round' | 'passive'; value: number };
  range: number | null;
  tags: readonly string[];
  rulesText: string;
}

export interface FoeProfileDefinition {
  id: string;
  name: string;
  faction: string;
  roleId: FoeRoleId;
  kind: FoeKind;
  parentId: string | null;
  description: string;
  traitsText: string;
  abilities: readonly FoeAbilityDefinition[];
  source: SourceReference;
  automation: 'structured' | 'executable';
}

export interface CharacterAbility {
  abilityId: string;
  talent: 1 | 2 | null;
  mastered: boolean;
}

export interface CharacterRelic {
  relicId: string;
  rank: 1 | 2 | 3 | 4;
  dustInfused: number;
}

export interface CharacterClock {
  id: string;
  name: string;
  size: 4 | 6 | 10;
  progress: number;
}

export interface IconCharacter {
  schemaVersion: typeof CHARACTER_SCHEMA_VERSION;
  rulesVersion: typeof RULES_VERSION;
  id: string;
  ownerId: string | null;
  name: string;
  pronouns: string;
  kin: string;
  culture: string;
  bondId: string;
  bondAction: ActionId | null;
  bondPowers: string[];
  actions: ActionRatings;
  level: number;
  xp: number;
  pendingLevelUps: number;
  xpAbilityPointClaimed: boolean;
  jobs: string[];
  primaryJobId: string | null;
  abilities: CharacterAbility[];
  equippedAbilityIds: string[];
  relics: CharacterRelic[];
  dust: number;
  activeKit: string;
  customKitItems: string[];
  looseGear: string[];
  equippedLooseGear: string[];
  burdens: CharacterClock[];
  ambitions: CharacterClock[];
  effort: number;
  strain: number;
  wounds: number;
  personalResolve: number;
  notes: string;
  portraitUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export type StatusId =
  | 'slashed'
  | 'blind'
  | 'dazed'
  | 'hatred'
  | 'pacified'
  | 'sealed'
  | 'shattered'
  | 'stunned'
  | 'weakened'
  | 'vulnerable';

export interface Position {
  x: number;
  y: number;
}

export interface EncounterActor {
  id: string;
  name: string;
  side: 'heroes' | 'foes';
  controllerId: string | null;
  characterId: string | null;
  foeProfileId?: string | null;
  tokenUrl: string;
  classId: JobClassId | 'foe';
  chapter: 1 | 2 | 3;
  abilityIds: string[];
  position: Position;
  vitality: number;
  baseMaxHp: number;
  hp: number;
  vigor: number;
  wounds: number;
  defense: number;
  armor: number;
  speed: number;
  dash: number;
  fray: number;
  damageDie: DamageDie;
  basicAttackRange: number;
  statuses: StatusId[];
  defeated: boolean;
  actionsRemaining: number;
  standardMoveUsed: boolean;
  attackedThisTurn: boolean;
  usedAbilityIds: string[];
  interruptUses: Record<string, number>;
  interruptUsedThisTurn: boolean;
  slashedTriggeredThisTurn: boolean;
  turnTaken: boolean;
}

export type TerrainType = 'basic' | 'difficult' | 'dangerous' | 'impassable' | 'pit' | 'slope';

export interface TerrainCell {
  position: Position;
  type: TerrainType;
  elevation: number;
}

export interface EncounterState {
  schemaVersion: typeof ENCOUNTER_SCHEMA_VERSION;
  rulesVersion: typeof RULES_VERSION;
  id: string;
  name: string;
  phase: 'setup' | 'active' | 'complete';
  grid: {
    width: number;
    height: number;
    backgroundUrl: string;
    terrain: TerrainCell[];
  };
  actors: Record<string, EncounterActor>;
  round: number;
  activeActorId: string | null;
  lastSide: EncounterActor['side'] | null;
  partyResolve: number;
  revision: number;
  eventLog: EncounterEvent[];
}

export type EncounterCommand =
  | { type: 'ADD_ACTOR'; actor: EncounterActor }
  | { type: 'REMOVE_ACTOR'; actorId: string }
  | { type: 'SET_TERRAIN'; cell: TerrainCell }
  | { type: 'START_ENCOUNTER' }
  | { type: 'MOVE'; actorId: string; path: Position[]; mode: 'standard' | 'dash' }
  | { type: 'BASIC_ATTACK'; actorId: string; targetId: string; weight: 'light' | 'heavy'; boons?: number; cover?: boolean }
  | { type: 'USE_ABILITY'; actorId: string; abilityId: string; targetIds: string[]; boons?: number; cover?: boolean }
  | { type: 'INTERACT'; actorId: string; position: Position; description: string }
  | { type: 'RESCUE'; actorId: string; targetId: string }
  | { type: 'RECOVER'; actorId: string }
  | { type: 'END_TURN'; actorId: string }
  | { type: 'APPLY_STATUS'; actorId: string; targetId: string; status: StatusId }
  | { type: 'END_ENCOUNTER' };

export type EncounterEvent =
  | { type: 'ACTOR_ADDED'; actor: EncounterActor }
  | { type: 'ACTOR_REMOVED'; actorId: string }
  | { type: 'TERRAIN_SET'; cell: TerrainCell }
  | { type: 'ENCOUNTER_STARTED'; firstActorId: string }
  | { type: 'ACTOR_MOVED'; actorId: string; path: Position[]; mode: 'standard' | 'dash'; dangerousDamage: number; slashedDamage: number }
  | { type: 'ATTACK_RESOLVED'; actorId: string; targetId: string; weight: 'light' | 'heavy'; d20: number; boonDie: number; total: number; hit: boolean; critical: boolean; rawDamage: number; appliedDamage: number }
  | {
      type: 'ABILITY_RESOLVED';
      actorId: string;
      abilityId: string;
      targetIds: string[];
      actionCost: number;
      interrupt: boolean;
      attackAbility: boolean;
      endsTurn: boolean;
      attack: {
        targetId: string;
        d20: number | null;
        boonDie: number;
        total: number | null;
        hit: boolean;
        critical: boolean;
        rawDamage: number;
        appliedDamage: number;
        bypassVigor: boolean;
      } | null;
      resolvedEffects: string[];
      pendingRulesText: string;
    }
  | { type: 'ACTOR_INTERACTED'; actorId: string; position: Position; description: string }
  | { type: 'ACTOR_RESCUED'; actorId: string; targetId: string; restoredHp: number }
  | { type: 'STATUS_REMOVED'; actorId: string; status: StatusId }
  | { type: 'ACTOR_RECOVERED'; actorId: string; vigorGained: number; saves: Array<{ status: StatusId; roll: number; cleared: boolean }> }
  | { type: 'STATUS_APPLIED'; actorId: string; targetId: string; status: StatusId }
  | { type: 'TURN_ENDED'; actorId: string; nextActorId: string; round: number; saves: Array<{ status: StatusId; roll: number; cleared: boolean }> }
  | { type: 'ACTOR_DEFEATED'; actorId: string; woundGained: boolean }
  | { type: 'ENCOUNTER_ENDED' };

export interface CommandResult {
  state: EncounterState;
  events: EncounterEvent[];
}
