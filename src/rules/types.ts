import type { RuleDuration, RuleExecutionInput, RuleModifier, RuleMutation, RuleTiming } from './automation/types.js';

export const RULES_VERSION = '1.5' as const;
export const CHARACTER_SCHEMA_VERSION = 3 as const;
// Schema 6 records ownership for every persisted mechanic produced by
// automation. Player projections use that provenance to withhold mechanics
// created by a GM-hidden actor without leaking the source id.
export const ENCOUNTER_SCHEMA_VERSION = 6 as const;

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
  traits: readonly TraitDefinition[];
  gambit: string;
  source: SourceReference;
}

export interface TraitDefinition {
  id: string;
  name: string;
  rulesText: string;
  source: SourceReference;
  automation: 'structured' | 'executable';
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
  traits: readonly TraitDefinition[];
  summonRulesText: string;
  limitBreak: {
    id: string;
    name: string;
    resolveCost: number;
    cost: { kind: 'action' | 'free'; value: number };
    range: number | null;
    tags: readonly string[];
    rulesText: string;
  } | null;
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
  phaseId: string | null;
  source: SourceReference;
}

export interface FoeTraitDefinition {
  id: string;
  name: string;
  rulesText: string;
  phaseId: string | null;
  source: SourceReference;
  automation: 'structured' | 'executable';
}

export interface FoePhaseDefinition {
  id: string;
  name: string;
  rulesText: string;
  source: SourceReference;
}

export interface FoeChapterRule {
  chapter: 1 | 2 | 3;
  rulesText: string;
  source: SourceReference;
}

export interface TrophyDefinition {
  id: string;
  name: string;
  uses: { count: number; period: 'use' | 'combat' | 'expedition' };
  rulesText: string;
  source: SourceReference;
  automation: 'structured' | 'executable';
}

export interface CampFixtureFeatureDefinition {
  id: string;
  name: string;
  rulesText: string;
  source: SourceReference;
  automation: 'structured' | 'executable';
}

export interface CampFixtureDefinition {
  id: string;
  name: string;
  purchaseCost: number;
  upgradeCost: number;
  rulesText: string;
  features: readonly CampFixtureFeatureDefinition[];
  source: SourceReference;
  automation: 'structured' | 'executable';
}

export interface RewardRuleDefinition {
  id: string;
  name: string;
  rulesText: string;
  source: SourceReference;
  automation: 'structured' | 'executable';
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
  traits: readonly FoeTraitDefinition[];
  phases: readonly FoePhaseDefinition[];
  chapterRules: readonly FoeChapterRule[];
  minimumChapter: 1 | 2 | 3;
  stats: {
    vitality?: number;
    hp?: number;
    speed?: number;
    dash?: number;
    defense?: number;
    armor?: number;
    fray?: number;
    damageDie?: DamageDie;
    size?: number;
  };
  trophies: readonly TrophyDefinition[];
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
  /** How an Aspected relic was legitimately advanced. */
  aspectState: 'none' | 'dust' | 'quest' | 'shared-quest' | 'unresolved';
  /** Total dust permanently infused into this relic, not dust currently carried. */
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

export interface EncounterCondition {
  id: string;
  sourceId: string;
  /** Actor that created the condition, when it came from encounter authority. */
  ownerId: string | null;
  potency: 'normal' | 'plus';
  duration: RuleDuration | null;
}

export interface EncounterActiveEffect {
  id: string;
  sourceId: string;
  effectId: string;
  ownerId: string;
  duration: RuleDuration;
  modifiers: RuleModifier[];
  triggers: string[];
  state: Record<string, string | number | boolean | null>;
}

export interface EncounterMark {
  id: string;
  sourceId: string;
  ownerId: string;
  markId: string;
  duration: RuleDuration | null;
  state: Record<string, string | number | boolean | null>;
}

export interface EncounterStance {
  id: string;
  sourceId: string;
  /** Actor that created the stance; null only for legacy/imported state. */
  ownerId: string | null;
  stanceId: string;
  state: Record<string, string | number | boolean | null>;
}

export interface EncounterActor {
  id: string;
  name: string;
  side: 'heroes' | 'foes';
  controllerId: string | null;
  characterId: string | null;
  foeProfileId?: string | null;
  roleId: FoeRoleId | null;
  actorKind: 'hero' | 'foe' | 'summon';
  size: number;
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
  conditions: EncounterCondition[];
  resources: Record<string, number>;
  ruleState: Record<string, string | number | boolean | null>;
  /** Provenance for ruleState entries; no mechanic may rely on this map. */
  ruleStateOwners: Record<string, string | null>;
  activeEffects: EncounterActiveEffect[];
  marks: EncounterMark[];
  stance: EncounterStance | null;
  traitIds: string[];
  onBattlefield: boolean;
  defeated: boolean;
  actionsRemaining: number;
  standardMoveUsed: boolean;
  attackedThisTurn: boolean;
  usedAbilityIds: string[];
  interruptUses: Record<string, number>;
  interruptUsedThisTurn: boolean;
  slashedTriggeredThisTurn: boolean;
  dangerousTerrainTriggeredThisTurn: boolean;
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
  entities: Record<string, EncounterEntity>;
  terrainEffects: EncounterTerrainEffect[];
  revision: number;
  eventLog: EncounterEvent[];
}

export interface EncounterEntity {
  id: string;
  type: string;
  ownerId: string | null;
  positions: Position[];
  state: Record<string, string | number | boolean | null>;
  duration: RuleDuration | null;
}

export interface EncounterTerrainEffect {
  id: string;
  sourceId: string;
  ownerId: string | null;
  terrain: string;
  positions: Position[];
  height: number | null;
  duration: RuleDuration | null;
}

export type EncounterCommand =
  | { type: 'ADD_ACTOR'; actor: EncounterActor }
  | { type: 'REMOVE_ACTOR'; actorId: string }
  | { type: 'SET_TERRAIN'; cell: TerrainCell }
  | { type: 'START_ENCOUNTER' }
  | { type: 'MOVE'; actorId: string; path: Position[]; mode: 'standard' | 'dash' }
  | { type: 'BASIC_ATTACK'; actorId: string; targetId: string; weight: 'light' | 'heavy' }
  | { type: 'USE_ABILITY'; actorId: string; abilityId: string; targetIds: string[] }
  | { type: 'EXECUTE_RULE'; actorId: string; sourceId: string; actionId: string; timing: RuleTiming; input: RuleExecutionInput; attackTargetId?: string; triggerSourceId?: string; triggerTargetIds?: string[]; triggers?: string[] }
  | { type: 'INTERACT'; actorId: string; position: Position; description: string }
  | { type: 'RESCUE'; actorId: string; targetId: string }
  | { type: 'RECOVER'; actorId: string }
  | { type: 'END_TURN'; actorId: string }
  /** Internal deterministic fixture/admin command; never accepted by the websocket schema. */
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
  | { type: 'ENCOUNTER_ENDED' }
  | { type: 'RULE_MUTATIONS_APPLIED'; actorId: string; sourceId: string; actionId: string; timing: RuleTiming; tags: string[]; mutations: RuleMutation[] };

export interface CommandResult {
  state: EncounterState;
  events: EncounterEvent[];
}
