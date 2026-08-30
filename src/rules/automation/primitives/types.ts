import type { DiceSource } from '../../dice.js';
import type { AttackDamageProvenance } from './attack-resolution.js';
import type { SaveWindowBranch, SaveWindowKind, SaveWindowModifiers } from './save-window.js';
import type { Fact } from './facts.js';
import type { EncounterState, Position, SourceReference } from '../../types.js';
import type { Binder, Reference } from './reference.js';
import type { RoleSelector } from './roles.js';
import type { SpatialAnchor } from './anchor.js';
import type { ValueQuery } from './query.js';

// Compatibility barrel: incremental underlay extraction re-exports new
// primitive vocabulary here so consumers can keep importing from the
// canonical types surface (U7 anchor vocabulary, then U1/U2/U8 as they
// split).
export * from './anchor.js';
export * from './query.js';
export * from './reference.js';
export * from './roles.js';
export * from './scope.js';
export * from './modifiers.js';
export * from './usage.js';
export * from './transaction.js';
export * from './ordering.js';
export * from './provenance.js';
export * from './facts.js';

export const RULE_PROGRAM_SCHEMA_VERSION = 1 as const;

export type RuleTiming =
  | 'use'
  | 'passive'
  | 'interrupt'
  | 'round-start'
  | 'round-end'
  | 'turn-start'
  | 'turn-end'
  | 'targeted'
  | 'attack-before'
  | 'attack-hit'
  | 'attack-miss'
  | 'attack-critical'
  | 'ability-resolved'
  | 'damaged'
  | 'defeated'
  | 'movement-start'
  | 'movement-end'
  | 'stance-refresh'
  | 'mark-trigger'
  | 'summon-trigger'
  | 'phase-change'
  | 'camp'
  | 'interlude'
  | 'expedition-start'
  | 'combat-start'
  | 'combat-end';

export type RuleCostKind = 'action' | 'free' | 'interrupt' | 'round' | 'resolve' | 'aether' | 'sacrifice' | 'use' | 'passive' | 'combo';

export interface RuleCost {
  kind: RuleCostKind;
  amount: RuleNumber;
  resourceId?: string;
}

export type RuleAreaShape = 'aura' | 'blast' | 'burst' | 'line' | 'arc' | 'path' | 'spaces';

export interface RuleArea {
  shape: RuleAreaShape;
  size: RuleNumber;
  origin: 'self' | 'target' | 'position' | 'entity';
  range?: RuleNumber;
  excludesOrigin?: boolean;
}

export type RuleRelation = 'self' | 'ally' | 'foe' | 'any';

/** One endpoint of a `distance` expression (U5): a RuleSelector (resolved
 * through the selector authority), a typed U1 reference, or a U7 anchor. */
export type DistanceEndpoint =
  | RuleSelector
  | { ref: Reference<'actor' | 'entity' | 'position'> }
  | { anchor: SpatialAnchor };


export type RuleSelector =
  | { kind: 'self' }
  | { kind: 'attack-target' }
  | { kind: 'trigger-source' }
  | { kind: 'trigger-targets' }
  | { kind: 'input'; key: string; relation?: RuleRelation; minimum?: number; maximum?: number; range?: RuleNumber }
  | { kind: 'all'; relation: RuleRelation }
  | { kind: 'adjacent'; origin: RuleSelector; relation: RuleRelation }
  | { kind: 'within'; origin: RuleSelector; relation: RuleRelation; range: RuleNumber }
  | { kind: 'condition'; conditionId: string; relation: RuleRelation }
  | { kind: 'marked'; markId?: string }
  | { kind: 'summons'; summonType?: string; owner: 'self' | 'any' };

export type RuleNumber =
  | { kind: 'constant'; value: number }
  | { kind: 'stat'; actor: RuleSelector; stat: 'hp' | 'max-hp' | 'vitality' | 'vigor' | 'defense' | 'armor' | 'speed' | 'dash' | 'fray' | 'actions' | 'size' }
  | { kind: 'resource'; actor: RuleSelector; resourceId: string }
  | { kind: 'round' }
  | { kind: 'input'; key: string; minimum?: number; maximum?: number }
  | { kind: 'count'; selector: RuleSelector }
  /** Count over a general QUERY domain (U3/U5): `count(foesInArea) == 1`
   * style reads over actors/entities/positions/terrain cells. The query
   * spec is the typed U3 vocabulary (`primitives/query.ts`) with RESOLVED
   * scalars; the kernel dispatches through `evaluateValueQuery`. */
  | { kind: 'count-query'; query: ValueQuery }
  /** Distance between two arbitrary ENDPOINTS (U5/U7): a RuleSelector, a
   * typed U1 reference (actor/entity/position), or a U7 SpatialAnchor.
   * Always the canonical p.92 footprint metric. */
  | { kind: 'distance'; from: DistanceEndpoint; to: DistanceEndpoint }
  /** Percent of the target's BASE maximum HP (ICON p.107 "% HEALTH":
   * percentage costs/damage use the BASE maximum — never the
   * wounds-adjusted bar). Fails closed when the view does not project the
   * durable base max. */
  | { kind: 'percent-base-max'; target: RuleSelector; percent: number; rounding: 'up' | 'down' | 'nearest' }
  | { kind: 'die'; sides: number; count?: RuleNumber }
  | { kind: 'damage-die'; actor: RuleSelector; count: RuleNumber }
  | { kind: 'damage-roll'; actor: RuleSelector; dice: RuleNumber; bonusDice?: RuleNumber; flat?: RuleNumber }
  | { kind: 'if'; predicate: RulePredicate; then: RuleNumber; otherwise: RuleNumber }
  | { kind: 'percent'; value: RuleNumber; percent: number; rounding: 'up' | 'down' | 'nearest' }
  | { kind: 'add' | 'multiply' | 'minimum' | 'maximum'; values: RuleNumber[] }
  | { kind: 'clamp'; value: RuleNumber; minimum?: RuleNumber; maximum?: RuleNumber };

export type RulePredicate =
  | { kind: 'always' }
  | { kind: 'not'; predicate: RulePredicate }
  | { kind: 'all' | 'any'; predicates: RulePredicate[] }
  | { kind: 'compare'; left: RuleNumber; operator: '<' | '<=' | '=' | '>=' | '>'; right: RuleNumber }
  | { kind: 'has-condition'; target: RuleSelector; conditionId: string }
  | { kind: 'bloodied'; target: RuleSelector }
  | { kind: 'quarter'; target: RuleSelector }
  | { kind: 'defeated'; target: RuleSelector }
  | { kind: 'in-terrain'; target: RuleSelector; terrain: string }
  /** Mark-exists: the target carries a mark (p.94). Absent `markId` = the
   * source unit id, mirroring the `marked` query filter's default. */
  | { kind: 'mark-exists'; target: RuleSelector; markId?: string }
  /** In-stance: the target currently holds the stance (stance gate). */
  | { kind: 'in-stance'; target: RuleSelector; stanceId: string }
  /** Inside-aura: the target is currently inside the aura whose provenance
   * is `sourceId` (default the acting source). Membership is derived
   * through the shared aura kernel — never a parallel geometry read. */
  | { kind: 'inside-aura'; target: RuleSelector; sourceId?: string }
  /** Acted-this-round: the target has already made an attack this turn
   * (the VM view's durable act state, p.129 Special). */
  | { kind: 'acted-this-round'; target: RuleSelector }
  | { kind: 'trigger'; trigger: string }
  | { kind: 'state'; target: RuleSelector; key: string; equals?: string | number | boolean | null }
  | { kind: 'target-state'; target: RuleSelector; key: string; equals?: string | number | boolean | null }
  /** Used-scope (U16, T3): the target has used `sourceId` at least `atLeast`
   * (default 1) times within `scope` (turn/round/combat). Reads the durable
   * usage ledger key — never ambient state. DISTINCT from trigger-event
   * de-duplication (the U10 fact-backed `hasResolvedAsFact` read, U16/T4):
   * this counts entitlements; the fact read answers "has this specific use
   * resolved for this fact/event?". */
  | { kind: 'used-scope'; target: RuleSelector; sourceId: string; scope: 'turn' | 'round' | 'combat'; atLeast?: number }
  /** Effect-still-exists (U6, completed T4): does the SPECIFIC live effect
   * instance named by `effectKind`/`effectId` (scoped to `sourceId`, default
   * the acting source) still exist on the target? Reads through the U10
   * fact/instance seam (`effectExistsLive`) against the target's LIVE effect
   * surfaces — never re-derived history. `instanceId` names the specific
   * coexisting instance when multiple may exist (a U10 fact's
   * `effectInstanceId`); an instance identity the live view cannot
   * represent FAILS CLOSED. */
  | { kind: 'effect-still-exists'; target: RuleSelector; effectKind: 'condition' | 'status' | 'mark' | 'stance' | 'persistent'; effectId: string; sourceId?: string; /** The authoritative DURABLE instance id (a U10 fact's `instanceId` / the
     reducer's EncounterActiveEffect.id): asks whether THAT EXACT instance
     still exists. Absent = presence by effectId (or owner-sensitive mark). */
    instanceId?: string; ownerId?: string; /** Owner-sensitive: when true + `ownerId`, only that owner's mark satisfies
     the read (marks from another owner with an identical markId never do). */
    ownerSensitive?: boolean };

export interface RuleChoice {
  key: string;
  label: string;
  kind: 'actors' | 'positions' | 'direction' | 'option' | 'number' | 'boolean';
  required: boolean;
  minimum?: number;
  maximum?: number;
  relation?: RuleRelation;
  range?: RuleNumber;
  options?: readonly string[];
  /** U2 ROLE carriage (typed, optional — behavior-neutral until U4 consumes
   * them): who DECIDES this choice (defaults to the controller, then the
   * source). */
  chooser?: RoleSelector;
  /** U2 ROLE carriage (typed, optional — behavior-neutral until U4 consumes
   * them): who ANSWERS at the network boundary. */
  controller?: RoleSelector;
  /** U7 ANCHOR carriage: the spatial frame a `positions` choice's range is
   * measured from (default the acting actor). Resolved through the shared
   * anchor authority at the choice point. */
  rangeOrigin?: SpatialAnchor;
}

export type RuleDuration =
  | { kind: 'instant' }
  | { kind: 'turn-end'; actor: RuleSelector; turns?: number }
  | { kind: 'turn-start'; actor: RuleSelector; turns?: number }
  | { kind: 'round-end'; rounds?: number }
  | { kind: 'round-start'; rounds?: number }
  | { kind: 'combat' }
  | { kind: 'expedition' }
  | { kind: 'until'; event: string; sourceId?: string };

export interface RuleResolutionFacts {
  /** Outcome facts recorded by the authority that resolved this command. */
  triggers: readonly string[];
  attackTargets: readonly string[];
  collidedActorIds: readonly string[];
  slainActorIds: readonly string[];
}

export interface RuleContinuationState {
  /** Monotonic source-step execution ledger for same-ability continuation. */
  executedStepIds: readonly string[];
  /** Monotonic outcome ledger; replay must consume, never rediscover, these. */
  derivedTriggers: readonly string[];
}

export type RuleEffect =
  | { kind: 'attack'; target: RuleSelector; boons?: RuleNumber; autoHit?: boolean; trueStrike?: boolean; onHit: RuleEffect[]; onMiss: RuleEffect[]; onCritical?: RuleEffect[] }
  | { kind: 'resolution-targets'; outcome: 'attack-targets' | 'collided' | 'slain'; effects: RuleEffect[] }
  | { kind: 'damage'; target: RuleSelector; amount: RuleNumber; damageType: 'normal' | 'piercing' | 'divine' | 'sacrifice'; instances?: RuleNumber; delivery?: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain'; ignoreCover?: boolean }
  | { kind: 'heal'; target: RuleSelector; amount: RuleNumber; maximum?: RuleNumber }
  | { kind: 'vigor'; target: RuleSelector; amount: RuleNumber; uncapped?: boolean }
  | { kind: 'condition'; target: RuleSelector; conditionId: string; operation: 'apply' | 'remove'; potency?: 'normal' | 'plus'; duration?: RuleDuration }
  | { kind: 'cure'; target: RuleSelector; all?: boolean }
  | { kind: 'move'; target: RuleSelector; movement: 'rush' | 'shove' | 'fly' | 'teleport' | 'place' | 'remove' | 'swap'; distance?: RuleNumber; positionInput?: string; directionInput?: string; phasing?: boolean }
  | { kind: 'resource'; target: RuleSelector; resourceId: string; operation: 'gain' | 'spend' | 'set' | 'tick-up' | 'tick-down'; amount: RuleNumber; minimum?: number; maximum?: number }
  | { kind: 'actions'; target: RuleSelector; operation: 'gain' | 'spend' | 'set' | 'refund'; amount: RuleNumber }
  | { kind: 'terrain'; operation: 'create' | 'remove' | 'raise' | 'lower'; terrain: string; positionInput: string; count?: RuleNumber; height?: RuleNumber; duration?: RuleDuration }
  | { kind: 'entity'; operation: 'summon' | 'create' | 'remove'; entityType: string; owner: RuleSelector; positionInput?: string; count?: RuleNumber; state?: Readonly<Record<string, string | number | boolean | null>>; duration?: RuleDuration; /** Source-declared creation spatial contract: origin selector (evaluated at command time against the runtime state, e.g. the owner's position), the origin actor's size (RuleNumber) for the p.92 footprint-distance range metric, and an optional maximum footprint distance. Origin and range are a PAIRED invariant — a contract always carries an origin, so "range without origin" is unrepresentable. */ spatial?: { origin: RuleSelector; originSize?: RuleNumber; maxRange?: number } }
  | { kind: 'mark'; operation: 'apply' | 'remove'; target: RuleSelector; markId: string; duration?: RuleDuration; state?: Readonly<Record<string, string | number | boolean | null>> }
  | { kind: 'stance'; operation: 'enter' | 'refresh' | 'exit'; target: RuleSelector; stanceId: string; state?: Readonly<Record<string, string | number | boolean | null>> }
  | { kind: 'persistent'; operation: 'add' | 'remove'; target: RuleSelector; effectId: string; duration: RuleDuration; modifiers?: RuleModifier[]; triggers?: string[]; state?: Readonly<Record<string, string | number | boolean | null>> }
  | { kind: 'modifier'; target: RuleSelector; modifier: RuleModifier; duration: RuleDuration }
  | { kind: 'save'; target: RuleSelector; boon?: RuleNumber; onSuccess: RuleEffect[]; onFailure: RuleEffect[] }
  | { kind: 'if'; predicate: RulePredicate; then: RuleEffect[]; otherwise?: RuleEffect[] }
  | { kind: 'repeat'; times: RuleNumber; effects: RuleEffect[] }
  | { kind: 'defeat'; target: RuleSelector }
  | { kind: 'phase'; target: RuleSelector; phaseId: string }
  | { kind: 'end-turn'; target: RuleSelector }
  | { kind: 'state'; target: RuleSelector; key: string; operation: 'set' | 'clear' | 'increment'; value?: string | number | boolean | null };

export interface RuleModifier {
  stat: string;
  operation: 'add' | 'subtract' | 'set' | 'upgrade' | 'downgrade' | 'grant' | 'deny' | 'immune' | 'resist';
  value?: RuleNumber | string | boolean;
}

export interface RuleStep {
  id: string;
  timing: RuleTiming;
  trigger?: string;
  condition?: RulePredicate;
  optional?: boolean;
  choices?: RuleChoice[];
  effects: RuleEffect[];
}

export interface RuleAction {
  id: string;
  name: string;
  timing: RuleTiming;
  costs: RuleCost[];
  tags: string[];
  range: RuleNumber | null;
  area: RuleArea | null;
  choices: RuleChoice[];
  resolverId?: string;
  steps: RuleStep[];
  /** Source-declared gate: the action cannot be made when its atomic
   * spatial group (the `spatialBatchId` legs of the resolver's mutations)
   * would be denied — e.g. ICON p.151 Masquerade: "If you or your ally
   * can't make a valid teleport, this interrupt can't be made." The command
   * is rejected before any event is emitted. */
  requiresLegalSpatialBatch?: boolean;
}

export interface RuleProgram {
  schemaVersion: typeof RULE_PROGRAM_SCHEMA_VERSION;
  rulesVersion: '1.5';
  id: string;
  sourceId: string;
  source: SourceReference;
  name: string;
  actions: RuleAction[];
  dependencies: string[];
  classification: 'encounter' | 'character' | 'reward' | 'narrative';
}

export interface RuleActorView {
  id: string;
  side: 'heroes' | 'foes';
  position: Position | null;
  hp: number;
  /** The wounds-adjusted maximum (base minus wounds×vitality) — the bar
   * HP thresholds (bloodied/quarter) are measured against. */
  maxHp: number;
  /** The durable BASE maximum (p.107 "% HEALTH": percentage costs/damage
   * use the BASE maximum, never the wounds-adjusted bar). Optional: views
   * that do not project it fail closed on `percent-base-max` reads. */
  baseMaxHp?: number;
  vitality: number;
  vigor: number;
  defense: number;
  armor: number;
  speed: number;
  dash: number;
  fray: number;
  damageDie: number;
  actions: number;
  /** Whether this actor has already made an attack this turn (p.129 Special). */
  attacked: boolean;
  /** Active job/class/foe trait ids — the trait-modifier kernels (attack
   * path, collide) read their armed state through this surface. */
  traitIds: readonly string[];
  /** Parent abilities currently equipped and eligible for attachment folds. */
  abilityIds: readonly string[];
  /** The equipped talent choice per ability (1 or 2), projected from the
   * actor's loadout so ability programs can gate behavior on the chosen
   * talent (e.g. Demon Cutter t2's pre-ability rush) exactly as the fold
   * reads the durable selection on command and replay. */
  talents: Readonly<Record<string, 1 | 2>>;
  /** The mastered ability ids projected into encounter authority — a mastery
   * attachment executes only when its parent ability is equipped (abilityIds)
   * and present here, never by querying the character sheet. */
  masteredAbilityIds: readonly string[];
  /** Durable active-effect records (the `aura`-grant effects the aura kernel
   * reads). Exposed on the runtime view so ability resolvers can gate on an
   * active aura's presence — e.g. Painkiller's Sweet Torment re-use and
   * Phantom Bolts' retrigger (p.144/p.158) — and so the runtime aura view
   * resolves `aura-effect` origins identically to the reducer view. The
   * modifier payload stays reducer-side; the durable `id`/`ownerId` are
   * carried so a recorded U10 effect fact can ask whether THAT SAME instance
   * still exists (specific-instance reads never fabricate a key). */
  activeEffects?: ReadonlyArray<{ id: string; sourceId: string; effectId: string; ownerId: string; radius?: number }>;
  size: number;
  defeated: boolean;
  /** The durable stance this actor holds, when any (the stance gate the
   * aura kernel and stance-gated resolvers read; marks are exposed the same
   * way). The durable `id`/`ownerId` are carried for specific-instance
   * `effect-still-exists` reads. */
  stance?: { id: string; ownerId: string | null; stanceId: string } | null;
  conditions: ReadonlySet<string>;
  /**
   * Statuses with their source potency.  `conditions` remains the broad
   * lookup surface for existing resolvers; this projection preserves the
   * p.94 distinction between ordinary statuses and ongoing (+) statuses.
   */
  statuses: ReadonlyArray<{ id: string; potency: 'normal' | 'plus' }>;
  /**
   * Encounter-authoritative modifiers that apply when this character is
   * cured or saves to clear a status.  These fields are transient projection
   * data, never persisted in encounter snapshots.
   */
  statusSavePolicy: {
    cureDenied: boolean;
    statusSaveDenied: boolean;
    saveBoon: number;
    saveCurse: number;
  };
  resources: Readonly<Record<string, number>>;
  state: Readonly<Record<string, string | number | boolean | null>>;
  /** Marks on this actor (resolvers key on markId/ownerId, e.g. Incubus). The
   * durable `id` is carried so a specific-instance mark read is exact; two
   * owners' same markId stay owner-distinct through `ownerId`. */
  marks: ReadonlyArray<{ id: string; markId: string; ownerId: string }>;
}

export interface RuleEntityView {
  id: string;
  type: string;
  ownerId: string | null;
  position: Position | null;
  state: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RuleRuntimeState {
  round: number;
  /** Battlefield bounds so resolvers can compute legal positions. */
  grid: { width: number; height: number };
  actors: Readonly<Record<string, RuleActorView>>;
  entities: Readonly<Record<string, RuleEntityView>>;
  terrainAt(position: Position): ReadonlySet<string>;
  /** ICON p.89: terrain elevation (including pit adjustment) for the shared
   * attack-resolution kernel. */
  elevationAt(position: Position): number;
  /** Durable terrain effects (delays, objects, rampart) for resolver lifecycle. */
  terrainEffects: ReadonlyArray<{ id: string; terrain: string; ownerId: string | null; positions: readonly Position[]; height: number | null }>;
}

export interface RuleExecutionInput {
  actorIds?: Readonly<Record<string, string[]>>;
  positions?: Readonly<Record<string, Position[]>>;
  directions?: Readonly<Record<string, Position>>;
  options?: Readonly<Record<string, string>>;
  numbers?: Readonly<Record<string, number>>;
  booleans?: Readonly<Record<string, boolean>>;
  /**
   * Optional, per-status Blessing choices for a command-time status save.
   * The actor being saved owns and spends the token (ICON p.102/p.172).
   */
  statusSaveChoices?: Readonly<Record<string, Readonly<Record<string, { spendBlessing?: boolean }>>>>;
  /**
   * Optional source-backed choices made before an ability resolves (ICON
   * p.184/p.191 Blessing of Rebirth / Blessing of War). Carry as opaque
   * input into the fold; kernels never interpret a trait id directly.
   */
  abilityUseChoices?: ReadonlyArray<{ traitId: string; spend: number }>;
  /**
   * Optional post-resolution talent effects the player explicitly opted into
   * (source unit ids, e.g. `knave:provoke:talent:2`'s may-sacrifice). The
   * engine never chooses "yes" on the player's behalf — an optional wired
   * talent fires only when its source id is named here, and replay carries
   * the recorded choice.
   */
  talentChoices?: ReadonlyArray<string>;
}

export interface RuleExecutionContext {
  state: RuleRuntimeState;
  actorId: string;
  sourceId: string;
  actionId: string;
  timing: RuleTiming;
  input: RuleExecutionInput;
  dice: DiceSource;
  attackTargetId?: string;
  /** The recipient of the damage currently being rolled. The VM threads this
   * per damage effect target so recipient-scoped bonus-damage grants (Finesse,
   * p.116) are evaluated against the actual damage recipient at the roll
   * query point — never against the primary attack target for every recipient. */
  damageRecipientId?: string;
  /** The authoritative encounter records behind the projected `state` view.
   * Recipient-scoped bonus-damage folds (Finesse / Vagabond Gambit) read the
   * source's durable class/trait ownership and the recipient's live HP from
   * here at the roll query point. Optional: contexts without encounter state
   * (isolated VM fixtures) simply skip recipient-scoped grants. */
  encounterState?: EncounterState;
  triggerSourceId?: string;
  triggerTargetIds?: string[];
  triggers?: ReadonlySet<string>;
  actionTags?: ReadonlySet<string>;
  delivery?: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain';
  /** Durable outcomes supplied to continuation steps; never caller-predicted. */
  resolutionFacts?: RuleResolutionFacts;
  /** Internal VM branch state. It is derived from a just-resolved attack,
   * never supplied by a command, and applies only to that attack target. */
  attackDamageProvenance?: Readonly<AttackDamageProvenance & { targetId: string }>;
  /**
   * F10 per-resolution ability-use modifiers (Blessing of War / Rebirth).
   * Threaded for this one resolution only — never persisted as an actor
   * flag. The VM folds these into its ordinary attack/damage handling, so a
   * newly executable ability works with the traits automatically.
   */
  abilityUseModifiers?: { boons?: number; bonusDamage?: number; bonusDamageDice?: number; pierce?: boolean };
  /** U1 REFERENCE carriage: names BOUND by earlier operations in this
   * resolution (`CHOOSE a position AS landing`). Optional and behavior-
   * neutral until U12 continuation records carry it across windows; when
   * absent, reference resolution treats every bound name as unbound. */
  boundNames?: Binder;
}

export type RuleMutation =
  | { kind: 'attack'; sourceId: string; actorId: string; targetId: string; d20: number | null; boon: number; total: number | null; hit: boolean; critical: boolean; exceed?: boolean; exceedThreshold?: number; evasionRoll: number | null; trueStrike: boolean; autoHit: boolean }
  | {
      kind: 'damage'; sourceId: string; sourceActorId: string; actorId: string; amount: number;
      damageType: 'normal' | 'piercing' | 'divine' | 'sacrifice'; instance: number;
      delivery: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain'; ignoreCover: boolean;
      /** Present only when an attack's True Strike provenance applies. */ ignoreDodge?: boolean;
      /** Present when an attack's Unerring provenance applies (p.105). */
      ignoreAetherwall?: boolean;
      /** Explicit source exceptions. They are not aliases for Divine. */
      bypassVigor?: boolean;
      ignoreArmor?: boolean;
      ignoreDefiance?: boolean;
      /** The command/window boundary's SINGLE determination of this instance:
       * the final post-mitigation amount (armor/resistance/dodge/etc. already
       * resolved) decided ONCE against the sequentially-simulated pre-event
       * state. The reducer consumes this recorded outcome instead of invoking
       * the damage authority again; replay applies the recorded result without
       * re-calculating mitigation. Absent only on historical events that
       * predate the determined handoff (they replay the legacy re-derivation
       * path, which is deterministic). A no-op (defeated/immunized/fully
       * prevented) records amount 0 so no false damage-applied fact is emitted. */
      determined?: { amount: number };
    }
  | { kind: 'heal'; sourceId: string; actorId: string; amount: number; maximum: number | null }
  | { kind: 'vigor'; sourceId: string; actorId: string; amount: number; uncapped: boolean }
  | { kind: 'condition'; sourceId: string; sourceActorId: string; actorId: string; conditionId: string; operation: 'apply' | 'remove'; potency: 'normal' | 'plus'; duration?: RuleDuration }
  | { kind: 'cure'; sourceId: string; actorId: string; all: boolean }
  | { kind: 'move'; sourceId: string; sourceActorId: string; actorId: string; movement: 'rush' | 'shove' | 'fly' | 'teleport' | 'place' | 'remove' | 'swap'; distance: number | null; positions: Position[]; direction: Position | null; phasing: boolean; /** Source-declared atomic spatial group: legs sharing an id are one
     * destination permutation, prevalidated together against the pre-swap
     * state and applied every-leg-or-none by the reducer (swapMutations,
     * primitives/job-kit.ts). Absent = independent per-leg resolution. */
    spatialBatchId?: string }
  | { kind: 'resource'; sourceId: string; actorId: string; resourceId: string; operation: 'gain' | 'spend' | 'set' | 'tick-up' | 'tick-down'; amount: number; minimum: number | null; maximum: number | null }
  | { kind: 'actions'; sourceId: string; actorId: string; operation: 'gain' | 'spend' | 'set' | 'refund'; amount: number }
  | { kind: 'terrain'; sourceId: string; sourceActorId: string; operation: 'create' | 'remove' | 'raise' | 'lower'; terrain: string; positions: Position[]; height: number | null; duration?: RuleDuration }
  | { kind: 'entity'; sourceId: string; operation: 'summon' | 'create' | 'remove' | 'update'; entityType: string; ownerId: string; positions: Position[]; count: number; state: Readonly<Record<string, string | number | boolean | null>>; duration?: RuleDuration; /** The source category ('summon' default; 'object' for boulders/statues/ etc). When absent the reducer/registry infer it from a single central registry. */ category?: 'summon' | 'object'; /** 'exact' — must land exactly `count` legal cells or the creation fails; 'up-to' (default) — create as many legal cells as exist, bounded by the per-owner cap. */ countMode?: 'exact' | 'up-to'; /** Replay-safe creation spatial contract, computed at command time: the resolved CREATOR LoS origin position, the origin actor's size for the p.92 footprint-distance metric, and an optional maximum range. A PAIRED invariant: the contract always carries a valid origin — the reducer rejects a range without a valid origin defensively even if a malformed mutation bypasses the type. */ creationSpatial?: { origin: Position; originSize: number; maxRange?: number } }
  | { kind: 'mark'; sourceId: string; ownerId: string; operation: 'apply' | 'remove'; actorId: string; markId: string; duration?: RuleDuration; state: Readonly<Record<string, string | number | boolean | null>>; /** The canonical LIVE instance id this operation creates/removes — decided
     ONCE at the command/window boundary (the same deterministic id the reducer
     mints for legacy mutations) and consumed by the reducer, so the recorded
     U10 fact and the live EncounterMark.id are the SAME id. A removal naming
     an instance removes THAT instance only; absent on legacy events (the
     reducer falls back to the historical markId-scoped removal). */
    instanceId?: string }
  | { kind: 'stance'; sourceId: string; sourceActorId: string; operation: 'enter' | 'refresh' | 'exit'; actorId: string; stanceId: string; state: Readonly<Record<string, string | number | boolean | null>>; /** The canonical LIVE instance id this operation creates/removes (see the
     mark `instanceId` contract). */
    instanceId?: string }
  | { kind: 'persistent'; sourceId: string; ownerId: string; operation: 'add' | 'remove'; actorId: string; effectId: string; duration: RuleDuration; modifiers: RuleModifier[]; triggers: string[]; state: Readonly<Record<string, string | number | boolean | null>>; /** The canonical LIVE instance id this operation creates/removes (see the
     mark `instanceId` contract). A removal naming an instance removes THAT
     instance only — coexisting instances stay intact. */
    instanceId?: string }
  | { kind: 'modifier'; sourceId: string; ownerId: string; actorId: string; modifier: RuleModifier; duration: RuleDuration }
  /** The F2 durable SaveWindow record: `windowKind` names the save's nature
   * (`status-clear` / `cure-immediate` / `effect` / `movement`), `modifiers`
   * is the evaluated boon/curse breakdown, `threshold` the target, `forced`
   * records a denial that skipped the roll, and `branch` is the continuation
   * AST a save-reroll interrupt (Sucker Punch, p.143) regenerates. Fields are
   * optional so historical logs without the record stay replayable. */
  | { kind: 'save'; sourceId: string; actorId: string; windowKind?: SaveWindowKind; windowId?: string; statusId?: string; modifiers?: SaveWindowModifiers; threshold?: number; forced?: boolean; roll: number; boon: number; total: number; success: boolean; branch?: SaveWindowBranch }
  | { kind: 'defeat'; sourceId: string; actorId: string }
  | { kind: 'phase'; sourceId: string; sourceActorId: string; actorId: string; phaseId: string }
  | { kind: 'end-turn'; sourceId: string; sourceActorId: string; actorId: string }
  | { kind: 'state'; sourceId: string; sourceActorId: string; actorId: string; key: string; operation: 'set' | 'clear' | 'increment'; value?: string | number | boolean | null }
  | { kind: 'resolution-facts'; sourceId: string; facts: RuleResolutionFacts };

export interface RuleExecutionResult {
  mutations: RuleMutation[];
  selectedAction: RuleAction;
  selectedSteps: RuleStep[];
  resolutionFacts?: RuleResolutionFacts;
  /** The durable U10 fact history recorded under `resolutionId` — the event
   * boundary carries it so replay consumes the recorded outcomes. */
  facts?: Fact[];
  /** The durable, replay-stable resolution identity this execution resolved
   * under (owned by the command/event boundary). */
  resolutionId?: string;
  continuation?: RuleContinuationState;
}

export type RuleResolver = (context: RuleExecutionContext, action: RuleAction) => RuleMutation[];
export type RuleResolverRegistry = Readonly<Record<string, RuleResolver>>;

export interface RuleClauseCompilation {
  id: string;
  label: string;
  text: string;
  effects: RuleEffect[];
  complete: boolean;
  unsupportedText: string;
}

export interface RuleProgramCompilation {
  program: RuleProgram;
  clauses: RuleClauseCompilation[];
  unsupportedClauses: RuleClauseCompilation[];
}
