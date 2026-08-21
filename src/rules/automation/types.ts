import type { DiceSource } from '../dice.js';
import type { Position, SourceReference } from '../types.js';

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

export type RuleCostKind = 'action' | 'free' | 'interrupt' | 'round' | 'resolve' | 'aether' | 'sacrifice' | 'use' | 'passive';

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
  | { kind: 'distance'; from: RuleSelector; to: RuleSelector }
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
  | { kind: 'defeated'; target: RuleSelector }
  | { kind: 'in-terrain'; target: RuleSelector; terrain: string }
  | { kind: 'trigger'; trigger: string }
  | { kind: 'state'; target: RuleSelector; key: string; equals?: string | number | boolean | null };

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

export type RuleEffect =
  | { kind: 'attack'; target: RuleSelector; boons?: RuleNumber; autoHit?: boolean; trueStrike?: boolean; onHit: RuleEffect[]; onMiss: RuleEffect[]; onCritical?: RuleEffect[] }
  | { kind: 'damage'; target: RuleSelector; amount: RuleNumber; damageType: 'normal' | 'piercing' | 'divine' | 'sacrifice'; instances?: RuleNumber; delivery?: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain'; ignoreCover?: boolean }
  | { kind: 'heal'; target: RuleSelector; amount: RuleNumber; maximum?: RuleNumber }
  | { kind: 'vigor'; target: RuleSelector; amount: RuleNumber; uncapped?: boolean }
  | { kind: 'condition'; target: RuleSelector; conditionId: string; operation: 'apply' | 'remove'; potency?: 'normal' | 'plus'; duration?: RuleDuration }
  | { kind: 'cure'; target: RuleSelector; all?: boolean }
  | { kind: 'move'; target: RuleSelector; movement: 'rush' | 'shove' | 'fly' | 'teleport' | 'place' | 'remove' | 'swap'; distance?: RuleNumber; positionInput?: string; directionInput?: string; phasing?: boolean }
  | { kind: 'resource'; target: RuleSelector; resourceId: string; operation: 'gain' | 'spend' | 'set' | 'tick-up' | 'tick-down'; amount: RuleNumber; minimum?: number; maximum?: number }
  | { kind: 'actions'; target: RuleSelector; operation: 'gain' | 'spend' | 'set' | 'refund'; amount: RuleNumber }
  | { kind: 'terrain'; operation: 'create' | 'remove' | 'raise' | 'lower'; terrain: string; positionInput: string; count?: RuleNumber; height?: RuleNumber; duration?: RuleDuration }
  | { kind: 'entity'; operation: 'summon' | 'create' | 'remove'; entityType: string; owner: RuleSelector; positionInput?: string; count?: RuleNumber; state?: Readonly<Record<string, string | number | boolean | null>>; duration?: RuleDuration }
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
  maxHp: number;
  vitality: number;
  vigor: number;
  defense: number;
  armor: number;
  speed: number;
  dash: number;
  fray: number;
  damageDie: number;
  actions: number;
  size: number;
  defeated: boolean;
  conditions: ReadonlySet<string>;
  resources: Readonly<Record<string, number>>;
  state: Readonly<Record<string, string | number | boolean | null>>;
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
  actors: Readonly<Record<string, RuleActorView>>;
  entities: Readonly<Record<string, RuleEntityView>>;
  terrainAt(position: Position): ReadonlySet<string>;
}

export interface RuleExecutionInput {
  actorIds?: Readonly<Record<string, string[]>>;
  positions?: Readonly<Record<string, Position[]>>;
  directions?: Readonly<Record<string, Position>>;
  options?: Readonly<Record<string, string>>;
  numbers?: Readonly<Record<string, number>>;
  booleans?: Readonly<Record<string, boolean>>;
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
  triggerSourceId?: string;
  triggerTargetIds?: string[];
  triggers?: ReadonlySet<string>;
  actionTags?: ReadonlySet<string>;
  delivery?: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain';
}

export type RuleMutation =
  | { kind: 'attack'; sourceId: string; actorId: string; targetId: string; d20: number | null; boon: number; total: number | null; hit: boolean; critical: boolean; evasionRoll: number | null; trueStrike: boolean; autoHit: boolean }
  | { kind: 'damage'; sourceId: string; sourceActorId: string; actorId: string; amount: number; damageType: 'normal' | 'piercing' | 'divine' | 'sacrifice'; instance: number; delivery: 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain'; ignoreCover: boolean }
  | { kind: 'heal'; sourceId: string; actorId: string; amount: number; maximum: number | null }
  | { kind: 'vigor'; sourceId: string; actorId: string; amount: number; uncapped: boolean }
  | { kind: 'condition'; sourceId: string; sourceActorId: string; actorId: string; conditionId: string; operation: 'apply' | 'remove'; potency: 'normal' | 'plus'; duration?: RuleDuration }
  | { kind: 'cure'; sourceId: string; actorId: string; all: boolean }
  | { kind: 'move'; sourceId: string; sourceActorId: string; actorId: string; movement: 'rush' | 'shove' | 'fly' | 'teleport' | 'place' | 'remove' | 'swap'; distance: number | null; positions: Position[]; direction: Position | null; phasing: boolean }
  | { kind: 'resource'; sourceId: string; actorId: string; resourceId: string; operation: 'gain' | 'spend' | 'set' | 'tick-up' | 'tick-down'; amount: number; minimum: number | null; maximum: number | null }
  | { kind: 'actions'; sourceId: string; actorId: string; operation: 'gain' | 'spend' | 'set' | 'refund'; amount: number }
  | { kind: 'terrain'; sourceId: string; sourceActorId: string; operation: 'create' | 'remove' | 'raise' | 'lower'; terrain: string; positions: Position[]; height: number | null; duration?: RuleDuration }
  | { kind: 'entity'; sourceId: string; operation: 'summon' | 'create' | 'remove'; entityType: string; ownerId: string; positions: Position[]; count: number; state: Readonly<Record<string, string | number | boolean | null>>; duration?: RuleDuration }
  | { kind: 'mark'; sourceId: string; ownerId: string; operation: 'apply' | 'remove'; actorId: string; markId: string; duration?: RuleDuration; state: Readonly<Record<string, string | number | boolean | null>> }
  | { kind: 'stance'; sourceId: string; sourceActorId: string; operation: 'enter' | 'refresh' | 'exit'; actorId: string; stanceId: string; state: Readonly<Record<string, string | number | boolean | null>> }
  | { kind: 'persistent'; sourceId: string; ownerId: string; operation: 'add' | 'remove'; actorId: string; effectId: string; duration: RuleDuration; modifiers: RuleModifier[]; triggers: string[]; state: Readonly<Record<string, string | number | boolean | null>> }
  | { kind: 'modifier'; sourceId: string; ownerId: string; actorId: string; modifier: RuleModifier; duration: RuleDuration }
  | { kind: 'save'; sourceId: string; actorId: string; roll: number; boon: number; total: number; success: boolean }
  | { kind: 'defeat'; sourceId: string; actorId: string }
  | { kind: 'phase'; sourceId: string; sourceActorId: string; actorId: string; phaseId: string }
  | { kind: 'end-turn'; sourceId: string; sourceActorId: string; actorId: string }
  | { kind: 'state'; sourceId: string; sourceActorId: string; actorId: string; key: string; operation: 'set' | 'clear' | 'increment'; value?: string | number | boolean | null };

export interface RuleExecutionResult {
  mutations: RuleMutation[];
  selectedAction: RuleAction;
  selectedSteps: RuleStep[];
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
