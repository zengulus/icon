import type { SourceReference, StatusId, TerrainType } from './types.js';

export interface CoreRuleDefinition {
  id: string;
  name: string;
  kind: 'basic-ability' | 'terrain' | 'status' | 'state' | 'positive-effect' | 'trigger' | 'resource';
  rulesText: string;
  source: SourceReference;
}

const rule = (kind: CoreRuleDefinition['kind'], page: number, id: string, name: string, rulesText: string): CoreRuleDefinition => ({
  id,
  name,
  kind,
  rulesText,
  source: { page, sectionId: page >= 102 ? 'combat-glossary' : 'abilities' },
});

export const BASIC_ABILITIES = [
  rule('basic-ability', 91, 'standard-move', 'Standard Move', 'Free action: move up to Speed once during the turn.'),
  rule('basic-ability', 91, 'dash', 'Dash', '1 action: move half Speed, rounded up, while ignoring engagement.'),
  rule('basic-ability', 91, 'interact', 'Interact', '1 action: manipulate a substantial battlefield feature in the user’s space or an adjacent space.'),
  rule('basic-ability', 91, 'rescue', 'Rescue', '1 action: an adjacent defeated ally ends incapacitation and returns at maximum HP after wounds.'),
  rule('basic-ability', 93, 'light-attack', 'Light Attack', '1 action, Attack: hit for [D] + fray; miss for fray.'),
  rule('basic-ability', 93, 'heavy-attack', 'Heavy Attack', '2 actions, Attack: hit for 2[D] + fray; miss for fray.'),
  rule('basic-ability', 91, 'recover', 'Recover', '2 actions: cure self, then save against each saveable status. Cure grants 4 vigor, or a vigor surge while bloodied.'),
] as const;

export const TERRAIN_RULES: ReadonlyArray<CoreRuleDefinition & { id: TerrainType }> = [
  rule('terrain', 89, 'basic', 'Basic Terrain', 'No inherent effect; carries elevation.') as CoreRuleDefinition & { id: TerrainType },
  rule('terrain', 89, 'difficult', 'Difficult Terrain', 'Costs +1 movement to exit; use only the highest movement penalty.') as CoreRuleDefinition & { id: TerrainType },
  rule('terrain', 89, 'dangerous', 'Dangerous Terrain', 'Entering or exiting deals 2 piercing damage that bypasses vigor, at most once per turn.') as CoreRuleDefinition & { id: TerrainType },
  rule('terrain', 89, 'impassable', 'Impassable Terrain', 'Obstructs movement, grants cover, and blocks line of sight.') as CoreRuleDefinition & { id: TerrainType },
  rule('terrain', 89, 'slope', 'Slope', 'Counts at its base elevation; exiting ignores one level of upward movement cost.') as CoreRuleDefinition & { id: TerrainType },
  rule('terrain', 89, 'pit', 'Pit', 'Counts as one elevation lower than its base space and may carry additional scenario effects.') as CoreRuleDefinition & { id: TerrainType },
];

export const STATUS_RULES: ReadonlyArray<CoreRuleDefinition & { id: StatusId }> = [
  rule('status', 104, 'slashed', 'Slashed', 'Take 4 damage after self or an ally uses an ability that moves this character, at most once per turn.'),
  rule('status', 104, 'blind', 'Blind', 'Maximum listed range of abilities is 2.'),
  rule('status', 104, 'dazed', 'Dazed', 'Attacks gain +1 curse.'),
  rule('status', 104, 'hatred', 'Hatred of X', 'Deal half damage to foes other than X; ends at turn end or while X is untargetable or immune to damage.'),
  rule('status', 104, 'pacified', 'Pacified', 'Deal half damage. Ends when damaged by a foe’s ability.'),
  rule('status', 104, 'sealed', 'Sealed', 'Cannot inflict statuses.'),
  rule('status', 104, 'shattered', 'Shattered', 'Cannot gain or benefit from vigor.'),
  rule('status', 104, 'stunned', 'Stunned', 'Cannot use interrupts. The next ability used ends the turn, then Stunned ends.'),
  rule('status', 104, 'weakened', 'Weakened', 'Reduce each instance of damage dealt by 2.'),
  rule('status', 104, 'vulnerable', 'Vulnerable', 'Increase each instance of damage taken by 1.'),
] as ReadonlyArray<CoreRuleDefinition & { id: StatusId }>;

export const SPECIAL_STATES = [
  rule('state', 94, 'bloodied', 'Bloodied', 'At or below 50% maximum HP.'),
  rule('state', 94, 'immobile', 'Immobile', 'Cannot move, be moved, be removed, or be placed.'),
  rule('state', 94, 'incapacitated', 'Incapacitated', 'Cannot act or take turns and provides no obstruction or engagement; owned active effects and summons end.'),
] as const;

export const POSITIVE_EFFECTS = [
  rule('positive-effect', 104, 'counter', 'Counter', 'When damaged by an ability, deal 2 damage back for each applied damage instance.'),
  rule('positive-effect', 104, 'defiance', 'Defiance', 'Prevent HP dropping below 1 once, then gain damage immunity for the rest of the turn.'),
  rule('positive-effect', 104, 'divine', 'Divine', 'Damage cannot be mitigated except by immunity and bypasses vigor.'),
  rule('positive-effect', 104, 'dodge', 'Dodge', 'Ignore damage from misses, successful saves, and area effects.'),
  rule('positive-effect', 104, 'evasion', 'Evasion', 'Before an attack roll, a 4+ on d6 makes the attack miss.'),
  rule('positive-effect', 104, 'flying', 'Flying', 'Ignore terrain damage and movement penalties, height costs, obstruction, and engagement while moving.'),
  rule('positive-effect', 104, 'intangible', 'Intangible', 'Ignore foe damage and effects and provide no obstruction or engagement.'),
  rule('positive-effect', 104, 'phasing', 'Phasing', 'Pass through obstructions but do not end movement sharing their space.'),
  rule('positive-effect', 104, 'pierce', 'Pierce', 'Damage ignores armor and Weakened.'),
  rule('positive-effect', 104, 'rampart', 'Rampart', 'Foes cannot enter or exit affected spaces by dashing, flying, or teleporting.'),
  rule('positive-effect', 104, 'regeneration', 'Regeneration', 'Gain 4 vigor at turn end while bloodied.'),
  rule('positive-effect', 104, 'skirmisher', 'Skirmisher', 'Move diagonally and dash at full Speed.'),
  rule('positive-effect', 104, 'stealth', 'Stealth', 'Cannot be directly targeted except from adjacency; most abilities break Stealth.'),
  rule('positive-effect', 104, 'sturdy', 'Sturdy', 'Foe movement and placement effects can move this character at most one space per turn.'),
  rule('positive-effect', 104, 'true-strike', 'True Strike', 'Ignore Dodge, Blind, Evasion, and Stealth.'),
  rule('positive-effect', 105, 'unerring', 'Unerring', 'Ignore cover and aetherwall.'),
  rule('positive-effect', 105, 'unstoppable', 'Unstoppable', 'Immune to statuses and hostile movement; movement ignores engagement and rampart.'),
] as const;

export const TRIGGER_RULES = [
  rule('trigger', 95, 'chain-reaction', 'Chain Reaction', 'Triggers when a Wright ability damages at least two foes.'),
  rule('trigger', 95, 'charge', 'Charge', 'Triggers when the ability is used on a slow turn.'),
  rule('trigger', 95, 'collide', 'Collide', 'Triggers when an ability shoves a character into an obstruction.'),
  rule('trigger', 95, 'comeback', 'Comeback', 'Triggers while the ability user is bloodied.'),
  rule('trigger', 95, 'heroic', 'Heroic', 'Stalwart trigger whose condition is defined by the active Job.'),
  rule('trigger', 95, 'infuse', 'Infuse', 'Wright trigger activated by spending the listed Aether.'),
  rule('trigger', 95, 'exceed', 'Exceed', 'Triggers on a total attack roll of 15 or more.'),
  rule('trigger', 95, 'finishing-blow', 'Finishing Blow', 'Vagabond trigger activated when targeting a bloodied foe.'),
  rule('trigger', 95, 'slay', 'Slay', 'Triggers when the ability reduces at least one character to 0 HP.'),
] as const;

export const RESOURCE_RULES = [
  rule('resource', 99, 'resolve', 'Resolve', 'Party resource that increases each round and pays Limit Break costs; personal resolve is gained after fights.'),
  rule('resource', 105, 'vigor', 'Vigor', 'A shield over HP capped at Vitality. Most damage removes vigor before HP; all vigor ends after combat.'),
  rule('resource', 105, 'vigilance', 'Vigilance', 'Spend a charge to roll d6 and reduce damage to a nearby ally or damage a foe breaking adjacency.'),
  rule('resource', 100, 'wounds', 'Wounds', 'Each wound reduces maximum HP by Vitality. Four wounds cause a player character to become Fallen.'),
] as const;

export const CORE_RULES: readonly CoreRuleDefinition[] = [
  ...BASIC_ABILITIES,
  ...TERRAIN_RULES,
  ...STATUS_RULES,
  ...SPECIAL_STATES,
  ...POSITIVE_EFFECTS,
  ...TRIGGER_RULES,
  ...RESOURCE_RULES,
];
