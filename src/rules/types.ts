import type { RuleContinuationState, RuleDuration, RuleEffect, RuleExecutionInput, RuleModifier, RuleMutation, RuleResolutionFacts, RuleTiming } from './automation/primitives/types.js';
import type { Fact } from './automation/primitives/facts.js';
import type { SaveWindowKind, SaveWindowModifiers } from './automation/primitives/save-window.js';
import type { AttackResolutionLedger, DamageLedgerEntry } from './automation/kernels/damage-ledger.js';
import type { TurnTransitionIntent } from './automation/kernels/lifecycle.js';

export const RULES_VERSION = '1.5' as const;
// Schema v5 locks every player-selectable narrative value (Kin, Culture, Bond,
// Bond power, Bond-linked action) to permanent canonical IDs. v4 records
// stored Kin/Culture and Bond-power display names and the legacy `bondAction`/
// `bondPowers` field names; `migrateCharacter` converts those to IDs.
export const CHARACTER_SCHEMA_VERSION = 5 as const;
// Schema 6 records ownership for every persisted mechanic produced by
// automation. Player projections use that provenance to withhold mechanics
// created by a GM-hidden actor without leaking the source id.
export const ENCOUNTER_SCHEMA_VERSION = 7 as const;

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

/**
 * Permanent backend-safe IDs for the player-selectable narrative character
 * content (ICON pp.45–78). These are compatibility contracts: once persisted,
 * an ID must never silently change, be recycled, or be reused for a different
 * source entry — only an explicit character-schema migration may repoint them.
 * Display names live on the definitions and are freely editable independent of
 * identity.
 */
export const KIN_IDS = ['thrynn', 'trogg', 'beastfolk', 'xixo'] as const;
export type KinId = (typeof KIN_IDS)[number];

export const CULTURE_IDS = ['yeokin', 'islander', 'leggio', 'churner', 'chronicler', 'guilder'] as const;
export type CultureId = (typeof CULTURE_IDS)[number];

export const BOND_IDS = ['pathfinder', 'seeker', 'mighty', 'wolf', 'harlequin', 'highborn', 'mender', 'brave', 'broker', 'elder', 'outsider', 'dreamer'] as const;
export type BondId = (typeof BOND_IDS)[number];

/**
 * Bond powers are namespaced by Bond (`pathfinder:saddleborn`) and authored
 * explicitly in the catalog (`src/content`/`catalog.ts`). A branded string
 * keeps machine identity distinct from the player-facing name while avoiding
 * a 120-member literal union.
 */
export type BondPowerId = string & { readonly __brand?: 'BondPowerId' };
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

export interface KinDefinition {
  id: KinId;
  name: string;
  description: string;
  source: SourceReference;
}

export interface CultureDefinition {
  id: CultureId;
  name: string;
  description: string;
  source: SourceReference;
}

export interface BondPowerDefinition {
  id: BondPowerId;
  bondId: BondId;
  name: string;
  rulesText: string;
  source: SourceReference;
}

export interface BondDefinition {
  id: BondId;
  name: string;
  summary: string;
  actions: readonly [ActionId, ActionId];
  effort: number;
  strain: number;
  powers: readonly BondPowerDefinition[];
  ideals: readonly string[];
  secondWind: string;
  specialAbility: string;
  kits: readonly { name: string; itemsText: string }[];
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
  /** Permanent Kin ID (null until chosen at creation). Display name resolves
   * through the catalog; never persisted by name. Schema v5+. */
  kinId: KinId | null;
  /** Permanent Culture ID (null until chosen at creation). Schema v5+. */
  cultureId: CultureId | null;
  bondId: BondId | '';
  /** The Bond's linked action that took the Bond +2 dots. Schema v5+ ids the
   * field explicitly as `bondActionId` (was `bondAction`, already an ActionId). */
  bondActionId: ActionId | null;
  /** Permanent Bond-power IDs (namespaced `bondId:power`). Schema v5+. */
  bondPowerIds: BondPowerId[];
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
  /** Hit points lost below the current (wounds-adjusted) maximum — the
   * durable record of combat attrition between combats. Current HP is
   * `maxHp - hpLost`; camping and interludes reset it to 0 alongside wounds
   * (p.56). Schema v4; v3 records migrate with `hpLost: 0`, preserving the
   * prior implicit "always full between combats" semantics. */
  hpLost: number;
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
  /** The extracted foe profile kind ('job' | 'elite' | 'legend' | …),
   * projected at construction exactly like `roleId`, so content rows (e.g.
   * the p.299 Elite-template turn entitlement) read a durable actor fact
   * instead of querying the generated catalog at execution time. Null for
   * non-foe actors; absent only on historical/imported state until the
   * reducer boundary canonicalizes it. */
  foeKind?: FoeKind | null;
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
  /** The equipped talent choice per ability (1 or 2) — the F7 talent fold
   * reads this to fold a wired talent's trigger-effect into ability use. */
  talents: Record<string, 1 | 2>;
  /** The abilities this actor has mastered (projected from the character
   * sheet's `CharacterAbility.mastered`), restricted to equipped abilities.
   * A mastery attachment executes only when the parent ability is both
   * equipped and present here — the durable encounter authority every
   * mastery kernel/content gate reads, so replay never queries the sheet. */
  masteredAbilityIds: string[];
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
  /** True once the actor has taken at least one actual turn this round. The
   * scheduler derives it from `turnsTakenThisRound`; content once-per-round
   * ledgers read it as the durable "acted this round" boolean. */
  turnTaken: boolean;
  /** Turn entitlements still owed this round (default 1). Decremented when an
   * actual turn completes; reset to the actor's entitlement at round start.
   * Multi-turn elites/legends have more than one. */
  turnsRemaining: number;
  /** Actual turns completed this round. */
  turnsTakenThisRound: number;
  /** True when the actor is committed to the Slow mini-round this round
   * (elected via GO_SLOW or forced by a delay effect). */
  slow: boolean;
}

export type TerrainType = 'basic' | 'difficult' | 'dangerous' | 'impassable' | 'pit' | 'slope';

export interface TerrainCell {
  position: Position;
  type: TerrainType;
  elevation: number;
}

/** ICON p.107 — damage that was determined but held unapplied while a
 * `when-damaged` interrupt window is open. The held damage is the final
 * mitigated amount (armor, resistance, and other reductions already applied).
 * It applies after the window's interrupt resolves — or at the end of the turn
 * if no interrupt answers the window — unless the interrupt's own mutations
 * re-dealt damage to the held target (e.g. Righteous Disdain, p.128, splits
 * the held damage between two characters). */
export interface EncounterHeldDamage {
  amount: number;
  damageType: 'normal' | 'piercing' | 'divine' | 'sacrifice';
  /**
   * Source-specific HP routing. Piercing does not itself imply this flag:
   * dangerous terrain (p.89) is explicitly piercing *and* bypasses vigor.
   * Absent on historical windows means the legacy divine-only behavior.
   */
  bypassVigor?: boolean;
  /** Source-specific application exception (for example Bleak Mercy p.144).
   * It does not imply generic damage immunity bypass. */
  ignoreDefiance?: boolean;
  sourceActorId: string;
  sourceId: string;
  instance: number;
  delivery: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain';
  ignoreCover: boolean;
  /** Audit provenance for a determined True-Strike damage instance. The held
   * amount is already final, so replay does not recalculate this exception. */
  ignoreDodge?: boolean;
  /** Durable proof that Defiance's application-time HP floor was applied to
   * this already-determined amount (ICON p.104). Legacy `ATTACK_RESOLVED` /
   * `VIGILANCE_SPENT` events record the post-floor applied amount, so replay
   * cannot re-infer Defiance from that reduced number. Only event replay sets
   * this; fresh held interrupt windows carry the full determined amount and
   * must never persist it. */
  defianceTriggered?: boolean;
}

/** ICON p.107 — an interrupt window opened by an effect. `triggeredAt` is the
 * encounter revision when the window opened, so windows opened later (nested
 * interrupts) resolve first; windows opened by the same effect share the
 * revision and resolve in turn order (see `orderInterrupts`). A `when-damaged`
 * window may hold the damage that opened it (see `EncounterHeldDamage`); a
 * `uses-ability` window may hold the triggering ability's effect mutations
 * (costs already paid) until the interrupt resolves. */
export interface EncounterPendingInterrupt {
  id: string;
  /** The character whose interrupt the window belongs to. */
  actorId: string;
  /** The trigger that opened the window (e.g. `when-damaged`, `uses-ability`). */
  trigger: string;
  /** Encounter revision when the window opened; higher resolves first (LIFO). */
  triggeredAt: number;
  /** Registration order within the same trigger event (deterministic tiebreak). */
  order: number;
  /** Present when the window opened on damage that has not been applied yet. */
  heldDamage?: EncounterHeldDamage;
  /** Present when the window opened on an ability that has not resolved yet
   * (a foe targeted the interrupt user's ally; the ability's effects resolve
   * after the interrupt, or at the end of the turn if none answers). */
  heldEffects?: RuleMutation[];
  /** Present when the interrupt redirects the held ability (Masquerade, p.151:
   * the ability targeted `fromActorId` and targets `toActorId` instead after
   * the swap). Applied when the held effects resolve — and only when the
   * interrupt that closes the window is the program that armed the redirect
   * (`retargetProgramId`): if that interrupt cannot be made ("If you or your
   * ally can't make a valid teleport, this interrupt can't be made") or the
   * window closes at a boundary, the held ability hits its original target. */
  retarget?: { fromActorId: string; toActorId: string };
  /** The interrupt program that armed `retarget` (the targeted-by-ability
   * allowlist row). The reducer honors the redirect only when the closing
   * interrupt event carries this exact source id. */
  retargetProgramId?: string;
  /** Present when the window opened on a rolled save (Sucker Punch, p.143: an
   * enemy adjacent to the interrupt user rolled a save). `heldEffects` carries
   * the save's original branch; the interrupt re-rolls it, keeping the second
   * result, and the regenerated branch replaces it (see the event `reroll`).
   * New windows carry the full F2 SaveWindow record (`windowKind`, `windowId`,
   * `statusId`, `modifiers`, `threshold`) so the re-roll reproduces the exact
   * evaluated modifier; historical windows fall back to the recorded `boon`. */
  heldSave?: {
    targetId: string;
    /** Evaluated save modifier (boon/curse) applied to both rolls. */
    boon: number;
    /** Provenance of the triggering ability, reused for the regenerated branch. */
    sourceId: string;
    sourceActorId: string;
    /** F2 durable record — the held save's window nature and modifier breakdown. */
    windowKind?: SaveWindowKind;
    windowId?: string;
    statusId?: string;
    modifiers?: SaveWindowModifiers;
    threshold?: number;
    onSuccess: RuleEffect[];
    onFailure: RuleEffect[];
  };
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
  /** The actor currently taking a turn, or null while the scheduler awaits a
   * controller selection (or between rounds). */
  activeActorId: string | null;
  /** The scheduler phase: 'normal' turns, or the Slow mini-round ('slow').
   * A slow turn is an actual turn taken after all non-slow actors have
   * acted (ICON p.87). */
  turnPhase: 'normal' | 'slow';
  /** The side whose controller may select an actor right now. The engine
   * determines the side; the controller chooses the actor (ICON p.87). */
  eligibleSide: EncounterActor['side'] | null;
  /** The side of the actor whose actual turn most recently ended. The round
   * after the current one opens with the opposite side. */
  lastSide: EncounterActor['side'] | null;
  partyResolve: number;
  entities: Record<string, EncounterEntity>;
  terrainEffects: EncounterTerrainEffect[];
  /** ICON p.107: interrupt windows opened by effects (e.g. damage dealt). They
   * resolve most-recently-triggered first (LIFO) and close at turn end. */
  pendingInterrupts: EncounterPendingInterrupt[];
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
  /** The source category: 'summon' (removed on controller defeat, intangible)
   * or 'object' (Size stacked ≤ 3, survives defeat). Inferred through the
   * central entity-kind registry when absent (ICON p.95). */
  kind?: 'summon' | 'object';
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

/**
 * A source-backed optional choice the player may make before an ability
 * resolves (e.g. ICON p.184/p.191 Blessing of Rebirth / Blessing of War
 * "spend N blessings"). The client names the narrow decision (which trait's
 * option and how much to spend); the rules engine derives every consequence
 * (resource spends, boons, bonus damage, pierce, forced triggers) from the
 * registered ICON source rule. This deliberately does not expose the generic
 * RuleProgram input surface on ordinary encounter commands.
 */
export interface AbilityUseChoice {
  /** The source trait id whose option is being used (e.g.
   * `sealer:trait:blessing-of-war`). */
  traitId: string;
  /** How much of the trait's resource to spend (e.g. 1 or 3 blessings). */
  spend: number;
}

/**
 * The player-declared input accepted by the core command save windows and the
 * pre-resolution ability-use choice fold. It keeps p.102 Blessing decisions
 * and p.184/p.191 ability-use choices explicit and carries the generic
 * choice buckets (RuleChoice rows) an ability's program declares — the
 * CHOOSE underlay (kernels/choice.ts) validates every bucket entry against
 * those rows at the command boundary.
 */
export type StatusSaveCommandInput = Pick<
  RuleExecutionInput,
  | 'statusSaveChoices'
  | 'positions'
  | 'actorIds'
  | 'directions'
  | 'options'
  | 'numbers'
  | 'booleans'
> & {
  abilityUseChoices?: readonly AbilityUseChoice[];
  /** Optional post-resolution talent effects the player explicitly opted into
   * (source unit ids — see `RuleExecutionInput.talentChoices`). */
  talentChoices?: readonly string[];
};

export type EncounterCommand =
  | { type: 'ADD_ACTOR'; actor: EncounterActor }
  | { type: 'REMOVE_ACTOR'; actorId: string }
  | { type: 'SET_TERRAIN'; cell: TerrainCell }
  | { type: 'START_ENCOUNTER' }
  | { type: 'MOVE'; actorId: string; path: Position[]; mode: 'standard' | 'dash'; input?: StatusSaveCommandInput }
  | { type: 'BASIC_ATTACK'; actorId: string; targetId: string; weight: 'light' | 'heavy'; input?: StatusSaveCommandInput }
  | { type: 'USE_ABILITY'; actorId: string; abilityId: string; targetIds: string[]; input?: StatusSaveCommandInput }
  | { type: 'EXECUTE_RULE'; actorId: string; sourceId: string; actionId: string; timing: RuleTiming; input: RuleExecutionInput; attackTargetId?: string; triggerSourceId?: string; triggerTargetIds?: string[]; triggers?: string[] }
  | { type: 'INTERACT'; actorId: string; position: Position; description: string; input?: StatusSaveCommandInput }
  | { type: 'RESCUE'; actorId: string; targetId: string; input?: StatusSaveCommandInput }
  | { type: 'RECOVER'; actorId: string; input?: StatusSaveCommandInput }
  | { type: 'SPEND_VIGILANCE'; actorId: string; targetId: string; use: 'guard' | 'punish'; damage?: number }
  | { type: 'END_TURN'; actorId: string; input?: StatusSaveCommandInput }
  /** Controller decision: the eligible side's controller selects an eligible
   * actor to start a turn (ICON p.87 — players/GM choose the actor; the
   * engine only determines which side/phase may act). */
  | { type: 'TAKE_TURN'; actorId: string }
  /** Controller decision: an eligible player character skips its normal turn
   * and commits to the Slow mini-round instead (ICON p.87). */
  | { type: 'GO_SLOW'; actorId: string }
  /** Internal deterministic fixture/admin command; never accepted by the websocket schema. */
  | { type: 'APPLY_STATUS'; actorId: string; targetId: string; status: StatusId }
  | { type: 'END_ENCOUNTER' };

/**
 * Why a turn boundary occurred. New events retain this provenance so later
 * lifecycle/interrupt work can reason about a boundary without inferring it
 * from mutable actor state. Historical event logs omit it.
 */
export type TurnEndCause = 'voluntary' | 'ability-tag' | 'forced-status' | 'rule-requested';

export type EncounterEvent =
  | { type: 'ACTOR_ADDED'; actor: EncounterActor }
  | { type: 'ACTOR_REMOVED'; actorId: string }
  | { type: 'TERRAIN_SET'; cell: TerrainCell }
  | { type: 'ENCOUNTER_STARTED'; /** Legacy field: the old automatic scheduler named the first actor and started its turn. New events omit it; the player side selects the first PC via TAKE_TURN (ICON p.87). */ firstActorId?: string }
  | { type: 'ACTOR_MOVED'; actorId: string; path: Position[]; mode: 'standard' | 'dash'; dangerousDamage: number; slashedDamage: number; /** Durable damage ledger for the movement's dangerous-terrain damage (p.89, source handoff). New events carry it; historical events replay the legacy numeric field. */
      ledger?: DamageLedgerEntry; /** F2 movement-kind SaveWindow: the recorded save this move passed to leave a
   * Six Hells Trigram (p.129). Provenance only — replay does not re-roll it;
   * a future save-reroll interrupt or held window reads the same record. */
      exitSave?: Extract<RuleMutation, { kind: 'save' }> }
  /**
   * The roll is recorded rather than recalculated during replay.  Evasion
   * resolves before a d20 is rolled, so an evaded basic attack deliberately
   * has null d20/total and its d6 result is retained for the event log.
   */
  | {      type: 'ATTACK_RESOLVED'; actorId: string; targetId: string; weight: 'light' | 'heavy'; d20: number | null; boonDie: number; total: number | null; evasionRoll: number | null; hit: boolean; critical: boolean; rawDamage: number; appliedDamage: number; /** Durable Defiance result: the applied amount is already floored at 1 HP and
   * the condition was consumed at command time. Present only when it triggered. */
      defianceTriggered?: boolean; /** Durable F0 ledger — the attack-roll/authority provenance (legal target,
   * range, line of effect, cover, attack-window choices) with the attack's
   * downstream damage ledger nested inside. New events carry it; historical
   * events replay the legacy appliedDamage + defianceTriggered fields. */
      attackResolution?: AttackResolutionLedger }
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
        /** Durable damage ledger (determined handoff). Replay prefers it over
         * the legacy bypassVigor → divine mapping, which is documented lossy. */
        ledger?: DamageLedgerEntry;
      } | null;
      resolvedEffects: string[];
      pendingRulesText: string;
    }
  | { type: 'ACTOR_INTERACTED'; actorId: string; position: Position; description: string }
  | { type: 'ACTOR_RESCUED'; actorId: string; targetId: string; restoredHp: number }
  | { type: 'STATUS_REMOVED'; actorId: string; status: StatusId }
  /**
   * `statusSaveMutations` is present on newly-created events.  It records
   * every policy-aware roll, Blessing spend, and successful removal for
   * deterministic replay; absent means a legacy event using `saves` alone.
   */
  | { type: 'ACTOR_RECOVERED'; actorId: string; vigorGained: number; saves: Array<{ status: StatusId; roll: number; cleared: boolean }>; statusSaveMutations?: RuleMutation[] }
  | { type: 'STATUS_APPLIED'; actorId: string; targetId: string; status: StatusId }
  | { type: 'TURN_ENDED'; actorId: string; /** Legacy field: the old automatic scheduler named the next actor. New events omit it; the controller selects via TAKE_TURN. */ nextActorId?: string; round: number; /** Scheduler transition recorded at the command boundary: the side eligible to select next and the phase. */ eligibleSide?: EncounterActor['side']; turnPhase?: 'normal' | 'slow'; saves: Array<{ status: StatusId; roll: number; cleared: boolean }>; statusSaveMutations?: RuleMutation[]; carnevaleGamble?: number; monogatariGamble?: number; cause?: TurnEndCause; intent?: TurnTransitionIntent }
  | { type: 'TURN_STARTED'; actorId: string; turnPhase: 'normal' | 'slow'; /** The recorded turn-start lifecycle participants for this actor. */ participants: string[]; /** True only for the combat-start first turn, which replays the historical ENCOUNTER_STARTED cadence (round-start effects already ran; no turn-start lifecycle fires). */ combatStart?: boolean }
  | { type: 'ACTOR_WENT_SLOW'; actorId: string; eligibleSide: EncounterActor['side']; turnPhase: 'normal' | 'slow' }
  | { type: 'ACTOR_DEFEATED'; actorId: string; woundGained: boolean }
  | { type: 'VIGILANCE_SPENT'; actorId: string; targetId: string; use: 'guard' | 'punish'; roll: number; appliedDamage: number; /** Durable Defiance result: the applied amount is already floored at 1 HP and
   * the condition was consumed at command time. Present only when it triggered. */
      defianceTriggered?: boolean; /** Durable damage ledger (determined handoff). New events carry it; historical
   * events replay the legacy appliedDamage + defianceTriggered fields. */
      ledger?: DamageLedgerEntry }
  | { type: 'ENCOUNTER_ENDED' }
  | { type: 'RULE_MUTATIONS_APPLIED'; actorId: string; sourceId: string; actionId: string; timing: RuleTiming; tags: string[]; mutations: RuleMutation[]; resolutionFacts?: RuleResolutionFacts; /** The durable U10 fact history for this resolution, ID-scoped by
     `resolutionId`. Carried so replay consumes the recorded outcomes (and
     their IDs) rather than re-deriving them from mutations. */
    facts?: Fact[]; /** The durable, replay-stable identity of this resolution (owned by the
     command/event boundary); every fact instance id is scoped under it, so
     two separate uses of the same ability never collide and a replayed event
     reproduces the identical fact history. */
    resolutionId?: string; continuation?: RuleContinuationState; reroll?: { roll: number; boon: number; total: number; success: boolean; mutations: RuleMutation[] } };

export interface CommandResult {
  state: EncounterState;
  events: EncounterEvent[];
}
