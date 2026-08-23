import type { SourceReference, StatusId, TerrainType } from './types.js';

export interface CoreRuleDefinition {
  id: string;
  name: string;
  kind: 'basic-ability' | 'terrain' | 'status' | 'state' | 'positive-effect' | 'trigger' | 'resource';
  rulesText: string;
  source: SourceReference;
  /** Shared-resource registry metadata (present only on `resource` rules). */
  resource?: {
    /** Hard ceiling while the resource is tracked; null means no cap. */
    maximum: number | null;
    /** Cleared to zero at encounter start and at encounter end. */
    perEncounter: boolean;
    /** Party resolve lives on the encounter, not on a single actor. */
    scope: 'per-character' | 'party';
    /** Encounter resources live on actors and reset at combat boundaries;
     * narrative resources (effort, strain, wounds) live on the character
     * sheet and reset at camp, interludes, and expeditions (p.40–43). */
    tier: 'encounter' | 'narrative';
  };
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
  rule('state', 107, 'interrupt-order', 'Interrupt Order', 'Interrupts resolve with the most recently triggered interrupt first. Interrupts that have the same trigger and trigger at the same time resolve in the same order as turns (player character/npc, alternating).'),
  rule('state', 107, 'when-damaged-window', 'When-Damaged Window', 'When damage has been determined but not applied yet, a when-damaged interrupt can resolve before the damage applies. The held damage applies after the interrupt resolves — or at the end of the turn — unless the interrupt re-dealt the damage.'),
  rule('state', 107, 'uses-ability-window', 'Uses-Ability Window', 'When a foe targets an armed ally with an ability, the uses-ability interrupt (e.g. Heroic Intervention, p.122) can resolve before the ability resolves. The ability’s costs pay immediately; its effects apply after the interrupt — or at the end of the turn if none answers.'),
  rule('state', 107, 'defeated-window', 'Defeated Window', 'When a blow would defeat a character with an available defeated interrupt (e.g. Boiling Blood, p.138), the blow is held until the interrupt resolves. The held blow applies after the interrupt — defy-death keeps the character standing at 1 hp.'),
  rule('state', 107, 'area-inclusion-window', 'Area-Inclusion Window', 'When an allied area effect includes a character with an available area-inclusion interrupt (Perseus, p.123), the effect is held until the interrupt resolves — the immunity applies before the effect.'),
  rule('state', 107, 'targeted-by-ability-window', 'Targeted-By-Ability Window', 'When a character uses an ability against a character with an available targeted interrupt (Masquerade, p.151), the ability is held until the interrupt resolves; the swap redirects the ability to the willing ally instead.'),
  rule('state', 107, 'save-rolled-window', 'Save-Rolled Window', 'When an enemy adjacent to a character with an available save-reroll interrupt (Sucker Punch, p.143) rolls a save, the save’s branch is held until the interrupt resolves; the interrupt re-rolls the save, keeping the second result, and the regenerated branch replaces the held one.'),
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

const resourceRule = (
  page: number,
  id: string,
  name: string,
  rulesText: string,
  resource: Omit<NonNullable<CoreRuleDefinition['resource']>, 'tier'> & { tier?: 'encounter' | 'narrative' },
): CoreRuleDefinition & { id: SharedResourceId } => ({ ...rule('resource', page, id, name, rulesText), resource: { tier: 'encounter', ...resource } }) as CoreRuleDefinition & { id: SharedResourceId };

/** The encounter resources the shared rules track. Each entry is both a
 * traceable source unit (kind `resource`) and the registry the reducer uses to
 * reset, cap, and validate gains and spends. */
export const RESOURCE_RULES = [
  resourceRule(99, 'resolve', 'Resolve', 'Party Resolve goes up by 1 at the start of each round in combat, and depletes to 0 after combat ends. When you spend Resolve to use a limit break, you can use any combination of party or personal resolve, but party resolve is shared between all members of the group, and any use of it must be with the consent of your team members. Resolve is always spent at the beginning of the action.', { maximum: null, perEncounter: true, scope: 'party', tier: 'encounter' }),
  resourceRule(99, 'personal-resolve', 'Personal Resolve', 'Personal resolve is gained the following ways: all characters gain 1 personal resolve after every combat, and when you limit break, you may give 1 personal resolve to another character who has not used a limit break this expedition. Personal resolve resets to 0 after you camp.', { maximum: null, perEncounter: false, scope: 'per-character', tier: 'encounter' }),
  resourceRule(100, 'wounds', 'Wounds', 'Each wound reduces maximum HP by Vitality. Four wounds cause a player character to become Fallen.', { maximum: null, perEncounter: false, scope: 'per-character', tier: 'narrative' }),
  resourceRule(102, 'blessing', 'Blessing', 'Certain abilities give yourself or allies a Blessing token, and ways to spend those tokens for powerful effects. By default a character can use a blessing token to gain +1 boon when they make a save. All blessings are discarded at the end of combat.', { maximum: null, perEncounter: true, scope: 'per-character', tier: 'encounter' }),
  resourceRule(102, 'bonus-damage', 'Bonus Damage', 'When an ability gains bonus damage, roll one more [D] for each instance of bonus damage and pick the highest result.', { maximum: null, perEncounter: true, scope: 'per-character', tier: 'encounter' }),
  resourceRule(103, 'combo', 'Combo', 'Actions with Combo have two versions, a base version and combo version. When you use the base ability, gain a combo token. Any time you use a combo ability and have a token, you use the combo version instead, discarding the token. You can only have one combo token at once, and discard all tokens at the end of combat.', { maximum: 1, perEncounter: true, scope: 'per-character', tier: 'encounter' }),
  resourceRule(105, 'vigor', 'Vigor', 'A shield over HP capped at Vitality. Most damage removes vigor before HP; all vigor ends after combat.', { maximum: null, perEncounter: true, scope: 'per-character', tier: 'encounter' }),
  resourceRule(105, 'vigilance', 'Vigilance', 'Spend a charge to roll d6 and reduce damage to a nearby ally or damage a foe breaking adjacency.', { maximum: null, perEncounter: true, scope: 'per-character', tier: 'encounter' }),
  resourceRule(56, 'effort', 'Effort', 'Effort is spent (ticked) to use bond powers and certain actions; it is recovered (unticked) by Second Wind, by camping, and at the start of an interlude. Your bond defines your maximum (3 by default).', { maximum: null, perEncounter: false, scope: 'per-character', tier: 'narrative' }),
  resourceRule(56, 'strain', 'Strain', 'Strain is taken when characters push themselves or use certain bond powers; it is healed by camping and fully at the start of an interlude, alongside hit points and wounds. Your bond defines your maximum (5 by default).', { maximum: null, perEncounter: false, scope: 'per-character', tier: 'narrative' }),
  resourceRule(204, 'aether', 'Aether', 'Start combat at 0 Aether, gain 1 at the start of each turn, spend it on one Infuse effect per ability, and lose it after combat.', { maximum: null, perEncounter: true, scope: 'per-character', tier: 'encounter' }),
] as const;

export type SharedResourceId = 'aether' | 'combo' | 'blessing' | 'resolve' | 'personal-resolve' | 'vigilance' | 'bonus-damage' | 'effort' | 'strain';

export const SHARED_RESOURCE_IDS: readonly SharedResourceId[] = ['aether', 'combo', 'blessing', 'resolve', 'personal-resolve', 'vigilance', 'bonus-damage', 'effort', 'strain'];

/** The shared, cross-job encounter resources (Wright Aether, Combo, Mendicant
 * Blessing, Resolve, and Vigilance). Vigor and wounds are per-character stats
 * with their own pipelines and are intentionally excluded from this registry. */
export const SHARED_RESOURCE_RULES: ReadonlyArray<CoreRuleDefinition & { id: SharedResourceId; resource: NonNullable<CoreRuleDefinition['resource']> }> =
  RESOURCE_RULES.filter((entry) => SHARED_RESOURCE_IDS.includes(entry.id as SharedResourceId)) as ReadonlyArray<CoreRuleDefinition & { id: SharedResourceId; resource: NonNullable<CoreRuleDefinition['resource']> }>;

/** The hard ceiling for a resource while it is tracked, or null when the rules
 * place no cap on it (only Combo caps: one token at once, p.103). */
export function resourceMaximum(resourceId: string): number | null {
  return SHARED_RESOURCE_RULES.find((entry) => entry.id === resourceId)?.resource.maximum ?? null;
}

/** Every per-character resource cleared to zero at encounter start/end. */
export function perEncounterCharacterResourceIds(): string[] {
  return SHARED_RESOURCE_RULES
    .filter((entry) => entry.resource.scope === 'per-character' && entry.resource.perEncounter)
    .map((entry) => entry.id);
}

/** The starting `resources` map for a character entering an encounter:
 * per-encounter resources at zero plus the character's accumulated personal
 * resolve (which survives combat and resets only after camping). */
export function initialCharacterResources(personalResolve: number): Record<string, number> {
  const resources: Record<string, number> = {};
  for (const id of perEncounterCharacterResourceIds()) resources[id] = 0;
  resources['personal-resolve'] = personalResolve;
  return resources;
}

/**
 * Every mechanic in the executable set that still needs a human ruling at the
 * table (or a caller choice), with the source page and the exact ruling. This
 * is the sweep registry: an ability is either independently executable (its
 * program resolves deterministically) or listed here with what a player or GM
 * must decide. `status` is `wired` when the engine resolves the deterministic
 * parts and only a genuinely optional sub-effect stays table-facing, and
 * `documented` when the whole clause is a table decision.
 */
export interface TableFacingMechanic {
  id: string;
  name: string;
  sourcePage: number;
  /** What the engine resolves deterministically (or leaves to the caller). */
  mechanic: string;
  /** The exact ruling a human must make when this clause triggers. */
  ruling: string;
  status: 'wired' | 'documented';
}

export const TABLE_FACING_MECHANICS: readonly TableFacingMechanic[] = [
  {
    id: 'fool:carnevale:optional-dash',
    name: 'Carnevale (p.150) — optional dash',
    sourcePage: 150,
    mechanic: 'Bombs detonate at turn end; the post-summon dash is left to the normal movement command.',
    ruling: 'The player chooses whether to dash 1 after each bomb (a movement choice, not a resolver effect).',
    status: 'documented',
  },
  {
    id: 'fool:party-favor:movement-entry',
    name: 'Party Favor (p.151) — movement-entry detonation',
    sourcePage: 151,
    mechanic: 'The mine detonates through the movement-entry trigger fold (kernels/movement-triggers.ts) on voluntary MOVE/DASH entry; the `detonate` sub-action remains for manual resolution. The source text says "when any character enters" — forced-movement entry (rush, shove, teleport) is an incomplete semantic boundary.',
    ruling: 'Auto-fires on a voluntary MOVE/DASH into the mine space; the gamble is pre-rolled at the command boundary and recorded on the event. Forced-movement entry is not yet wired.',
    status: 'wired',
  },
  {
    id: 'freelancer:trick-shot:rebound',
    name: 'Trick Shot (p.156) — rebound bounce',
    sourcePage: 156,
    mechanic: 'The armed next attack gains +1 boon and ignore-cover damage (both wired); the rebound bounce to a second target is not.',
    ruling: 'The player chooses the second target for the rebound bounce after the armed attack resolves.',
    status: 'wired',
  },
  {
    id: 'freelancer:deus-ex-machina:decline',
    name: 'Deus Ex Machina (p.157) — allies may decline',
    sourcePage: 157,
    mechanic: 'Divine Intervention teleports the marked character 1 closer (deterministic direction).',
    ruling: 'Allies may decline the teleport at the table; the direction is otherwise deterministic.',
    status: 'wired',
  },
  {
    id: 'shade:harrow:once-a-round',
    name: 'Harrow (p.162) — once-a-round teleport trigger',
    sourcePage: 162,
    mechanic: 'The Finishing Blow immediate trigger is deterministic; the once-a-round "when you teleport" follow-up is a reactive window.',
    ruling: 'The player chooses whether to also teleport the marked character 1 (and deal 2 to a foe) when they teleport.',
    status: 'documented',
  },
  {
    id: 'shade:nightmare:consume-shadow',
    name: 'Nightmare (p.162) — consume a shadow for evasion',
    sourcePage: 162,
    mechanic: 'Shadows are summons; the consume-a-shadow-when-targeted evasion is a reactive window (no targeting interrupt).',
    ruling: 'The player chooses whether to consume a shadow to gain evasion when targeted.',
    status: 'documented',
  },
  {
    id: 'shade:shadow-play:repeat',
    name: 'Shadow Play (p.163) — Finishing Blow repeat',
    sourcePage: 163,
    mechanic: 'The swap, stealth, and daze resolve deterministically; the Finishing Blow "repeat" is a second choice.',
    ruling: 'The player chooses whether to repeat the swap on a Finishing Blow.',
    status: 'documented',
  },
  {
    id: 'shade:umbral-echo:stance-rewrite',
    name: 'Umbral Echo (p.163) — finishing-blow stance rewrite',
    sourcePage: 163,
    mechanic: 'The stance refresh and power-die tick are wired; the finishing-blow effect-trigger-and-rewrite is a reactive window.',
    ruling: 'The player chooses whether to trigger finishing-blow effects and tick the die down (per-ability stance rewrite).',
    status: 'documented',
  },
  {
    id: 'warden:gwynt:optional-dash',
    name: 'Gwynt / Circle the Oak (p.169) — optional ally dashes',
    sourcePage: 169,
    mechanic: 'The circular traversal and toward-the-foe dash directions are deterministic.',
    ruling: 'The player chooses which allies take the optional dash and may decline it at the table.',
    status: 'documented',
  },
  {
    id: 'warden:mist-strider:consume-cloud',
    name: 'Mist Strider (p.169) — consume a cloud at turn start',
    sourcePage: 169,
    mechanic: 'Mist clouds are terrain effects; the consume-a-cloud-at-turn-start is a free-action choice.',
    ruling: 'The player chooses whether to consume a cloud at the start of their turn.',
    status: 'documented',
  },
  {
    id: 'warden:stampede:line-geometry',
    name: 'Stampede (p.170) — line-from-the-edge geometry',
    sourcePage: 170,
    mechanic: 'The damage, shove, and summon core resolve; the exact line-from-the-edge geometry and side shoves are table-facing.',
    ruling: 'The player/GM decides the line origin and which side each passed character is shoved to.',
    status: 'documented',
  },
  {
    id: 'warden:underway:portal-teleport',
    name: 'Underway (p.170) — portal teleport',
    sourcePage: 170,
    mechanic: 'The second portal grows at turn end; the portal-to-portal teleport is a free-action choice.',
    ruling: 'The player chooses whether to teleport through the portals (free action).',
    status: 'documented',
  },
  {
    id: 'chanter:felicity:combo-fly',
    name: 'Felicity (p.177) — spend a combo to fly the marked ally',
    sourcePage: 177,
    mechanic: 'The blessing, cure, and mark resolve; the "spend a combo token to fly the marked ally" is a free action.',
    ruling: 'The player chooses whether to spend a combo token to fly the marked ally.',
    status: 'documented',
  },
  {
    id: 'chanter:dervish:save-boon',
    name: 'Dervish Dawn (p.178) — +1 boon on saves',
    sourcePage: 178,
    mechanic: 'The aura is wired; the "+1 boon on saves in the aura" is a save-window effect.',
    ruling: 'The player adds +1 boon to saves made by characters in the aura (save-window effect).',
    status: 'documented',
  },
  {
    id: 'chanter:symphony:movement-entry',
    name: 'Symphony (p.178) — mote movement-entry detonation',
    sourcePage: 178,
    mechanic: 'Motes detonate on voluntary-MOVE/DASH entry via the movement-entry trigger fold and on turn-start via the lifecycle hook. The source text says "a character that enters" — forced-movement entry is an incomplete semantic boundary.',
    ruling: 'The entry trigger fires at the command boundary; the turn-start hook is a no-op when the mote was already consumed. Forced-movement entry is not yet wired.',
    status: 'wired',
  },
  {
    id: 'chanter:monogatari:tales',
    name: 'Monogatari (p.179) — tales 1 (Fury) and 6 (Triumph)',
    sourcePage: 179,
    mechanic: 'The song gamble and completion blessings are wired; tales 1 (Fury) and 6 (Triumph) are reactive windows.',
    ruling: 'The player/GM resolves tales 1 (Fury) and 6 (Triumph) as documented windows at the table.',
    status: 'documented',
  },
  {
    id: 'core:cover-edge-touch',
    name: 'Cover (p.92) — exact edge-touch ambiguity',
    sourcePage: 92,
    mechanic: 'Cover is granted only for an unambiguous line through the terrain cell (hasCoverFrom).',
    ruling: 'The GM rules on exact edge-touch cases; the engine never guesses.',
    status: 'documented',
  },
  {
    id: 'core:slow-turn-order',
    name: 'Slow turn (p.95) — turn-order deferral',
    sourcePage: 95,
    mechanic: 'The slow-turn flag is recorded and the Charge trigger fires on it; the delayed turn still grants full actions.',
    ruling: 'The table places a slow-turn character at the end of the round order (the reducer does not reorder).',
    status: 'documented',
  },
  {
    id: 'bonds:narrative-powers',
    name: 'Bonds (p.56) — free-form narrative powers',
    sourcePage: 56,
    mechanic: 'Effort/strain are tracked; narrative power outcomes are free-form by design.',
    ruling: 'The GM resolves bond power outcomes narratively at the table.',
    status: 'documented',
  },
];

export const CORE_RULES: readonly CoreRuleDefinition[] = [
  ...BASIC_ABILITIES,
  ...TERRAIN_RULES,
  ...STATUS_RULES,
  ...SPECIAL_STATES,
  ...POSITIVE_EFFECTS,
  ...TRIGGER_RULES,
  ...RESOURCE_RULES,
];
