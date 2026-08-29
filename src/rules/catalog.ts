import mechanics from '../content/generated/mechanics-1.5.json' with { type: 'json' };
import { EXECUTABLE_JOB_ABILITY_IDS } from './automation/content/glue/manual-programs.js';
import { coverageLadderComplete } from './phase-gates.js';
import type {
  AbilityDefinition,
  ActionDefinition,
  ActionId,
  BondDefinition,
  BondId,
  BondPowerDefinition,
  BondPowerId,
  CultureDefinition,
  JobClassDefinition,
  JobClassId,
  JobDefinition,
  KinDefinition,
  RelicDefinition,
  TraitDefinition,
} from './types.js';

export const ACTIONS: readonly ActionDefinition[] = [
  ['sneak', 'Sneak', 'Move with stealth and silence; act without notice or spring an ambush.'],
  ['traverse', 'Traverse', 'Climb, swim, leap, fly, chase, flee, pilot, or ride.'],
  ['sense', 'Sense', 'Scan a broad area, find tracks, and sense hidden things or magic.'],
  ['study', 'Study', 'Analyze details, intentions, research, or inscriptions.'],
  ['charm', 'Charm', 'Sway through charisma, deception, diplomacy, or favors.'],
  ['command', 'Command', 'Compel through force of will, leadership, or intimidation.'],
  ['tinker', 'Tinker', 'Create, alter, repair, or dismantle magical and mundane devices.'],
  ['excel', 'Excel', 'Perform feats of agility, precision, or ranged skill.'],
  ['smash', 'Smash', 'Use violence, force, weapons, or magic to destroy an obstacle.'],
  ['endure', 'Endure', 'Withstand hardship or exert tremendous physical or magical force.'],
].map(([id, name, description]) => ({ id, name, description, source: { page: 17, sectionId: 'narrative-play' } })) as readonly ActionDefinition[];

/**
 * Permanent Kin IDs (p.48–51). `name` is the mutable display label; `id` is
 * the persistence contract. Kin have no statistical or mechanical differences.
 */
export const KINS: readonly KinDefinition[] = [
  { id: 'thrynn', name: 'Thrynn', description: 'The adaptable, aether-sensitive people found everywhere across Arden Eld, many said to descend from the Arken that survived the Doom.', source: { page: 48, sectionId: 'kin' } },
  { id: 'trogg', name: 'Trogg', description: 'Few in number but outsize in stature — horned demi-giants who can live centuries and never stop growing.', source: { page: 49, sectionId: 'kin' } },
  { id: 'beastfolk', name: 'Beastfolk', description: 'The varied animal-like Kin of Arden Eld, from Lopen and Garou to Vodya and Lorito, present in every culture.', source: { page: 50, sectionId: 'kin' } },
  { id: 'xixo', name: 'Xixo', description: 'The insectile or crustacean-like water-dwelling Kin who trade along the waterways and remember everything.', source: { page: 51, sectionId: 'kin' } },
];

export const CULTURES: readonly CultureDefinition[] = [
  { id: 'yeokin', name: 'Yeokin', description: 'The peaceful farmlands, villages, and trading posts of the Green, organized around yearly harvests and local traditions.', source: { page: 52, sectionId: 'cultures' } },
  { id: 'islander', name: 'Islander', description: 'The seafaring folk of the great islands, where ships, fishing, and trade shape daily life.', source: { page: 52, sectionId: 'cultures' } },
  { id: 'leggio', name: 'Leggio', description: 'The bustling, cosmopolitan culture of city guilds and commerce across Arden Eld.', source: { page: 52, sectionId: 'cultures' } },
  { id: 'churner', name: 'Churner', description: 'The travelling merchants and caravan kin, always on the road and trading between settlements.', source: { page: 52, sectionId: 'cultures' } },
  { id: 'chronicler', name: 'Chronicler', description: 'The scribes and archivists who record, study, and preserve knowledge of the world.', source: { page: 52, sectionId: 'cultures' } },
  { id: 'guilder', name: 'Guilder', description: 'The powerful merchant houses and guild families whose influence spans nations.', source: { page: 52, sectionId: 'cultures' } },
];

export const findKin = (id: string | null | undefined): KinDefinition | undefined => KINS.find((kin) => kin.id === id);
export const findCulture = (id: string | null | undefined): CultureDefinition | undefined => CULTURES.find((culture) => culture.id === id);

const classTrait = (classId: JobClassId, page: number, name: string, rulesText: string): TraitDefinition => ({
  id: `${classId}:trait:${name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
  name,
  rulesText,
  source: { page, sectionId: classId },
  automation: 'structured',
});

const BOND_POWER_NAMES: Record<BondId, readonly string[]> = {
  pathfinder: ['Saddleborn', 'Windrider', 'Dabbler', 'Freesoul', 'Lay Burdens', 'Airfeel', 'Colortongue', 'Horizon Sweeper', 'Memory of the Sole', 'Lightspeed'],
  seeker: ['Heartsight', 'Library Organ', 'Argus', 'Midnight Eyes', 'Unhinge', 'Dark Clarity', 'Possession', 'Instinctive', 'Geist', 'Terrible Truth'],
  mighty: ['True Grit', 'Iron Jaw', 'Volcanic', 'Hammersoul', 'Overpower', 'The Tower', 'Force of Will', 'Half Light', 'The Wall', 'Make Total Destroy'],
  wolf: ['Clarity', 'Scarcoat', 'Blood Scent', 'Go for a Walk', 'Cornered', 'Lurk', 'It’s Nothing', 'Crack Shell', 'Bishop', 'Wick'],
  harlequin: ['Mirrormask', 'Mercurio', 'Mockingbird', 'Fast Friends', 'The Big Show', 'Habitual Line Stepper', 'Quickfingers', 'Ridi Pagliacci', 'Exuent', 'Step of the Smiling Few'],
  highborn: ['Rarefied', 'Private Tutor', 'Silver Spoon', 'Trust the Fund', 'Special Reserve', 'Ivory Tower', 'Honor Student', 'Passionate', 'Unflappable', 'Perfect Grace'],
  mender: ['Push Through', 'Divine Luck', 'Illuminate', 'Untangle', 'Pangloss', 'A Better Way', 'Mender', 'Encourage', 'Iron Cutting', 'Heart Forge'],
  brave: ['Strike the Road', 'Crush Limiter', 'Luck as a Constant', 'All In', 'Joyluck Wind Thrower', 'The Sun', 'Coordinate', 'Heart of Hearts', 'Team Player', 'Brave Destiny'],
  broker: ['Contingency', 'Swoon', 'Immaculate', 'Beg, Borrow, or Steal', 'Fruitful', 'Faust', 'Make It Work', 'Coordinator', 'Ladder Climber', 'Golden Hand'],
  elder: ['Parable', 'Pacifist', 'Long Memory', 'Been Around', 'Spinner of Tales', 'Pillar of Rock', 'Saltbelly', 'Mentor', 'Reputation', 'The Mountain'],
  outsider: ['Xenoclash', 'Gaia Compass', 'Open Up', 'Bloom', 'Earth Glide', 'Tour Guide', 'Earth Speech', 'Centered', 'Resourceful', 'The Wave'],
  dreamer: ['Improvise', 'Punching Bag', 'Best Efforts', 'Bright Eyed', 'Follow the Leader', 'Lost Cat', 'Rash', 'Underdog', 'Heart Held Dream', 'The Lobster'],
};

/**
 * Explicit, permanent Bond-power IDs (`pathfinder:saddleborn`, …). Authored
 * here once and referenced by the catalog; never slugged from display names at
 * runtime. Keep index-aligned with `BOND_POWER_NAMES` (both have ten per Bond).
 */
const BOND_POWER_IDS: Record<BondId, readonly BondPowerId[]> = {
  pathfinder: ['pathfinder:saddleborn', 'pathfinder:windrider', 'pathfinder:dabbler', 'pathfinder:freesoul', 'pathfinder:lay-burdens', 'pathfinder:airfeel', 'pathfinder:colortongue', 'pathfinder:horizon-sweeper', 'pathfinder:memory-of-the-sole', 'pathfinder:lightspeed'],
  seeker: ['seeker:heartsight', 'seeker:library-organ', 'seeker:argus', 'seeker:midnight-eyes', 'seeker:unhinge', 'seeker:dark-clarity', 'seeker:possession', 'seeker:instinctive', 'seeker:geist', 'seeker:terrible-truth'],
  mighty: ['mighty:true-grit', 'mighty:iron-jaw', 'mighty:volcanic', 'mighty:hammersoul', 'mighty:overpower', 'mighty:the-tower', 'mighty:force-of-will', 'mighty:half-light', 'mighty:the-wall', 'mighty:make-total-destroy'],
  wolf: ['wolf:clarity', 'wolf:scarcoat', 'wolf:blood-scent', 'wolf:go-for-a-walk', 'wolf:cornered', 'wolf:lurk', 'wolf:it-s-nothing', 'wolf:crack-shell', 'wolf:bishop', 'wolf:wick'],
  harlequin: ['harlequin:mirrormask', 'harlequin:mercurio', 'harlequin:mockingbird', 'harlequin:fast-friends', 'harlequin:the-big-show', 'harlequin:habitual-line-stepper', 'harlequin:quickfingers', 'harlequin:ridi-pagliacci', 'harlequin:exuent', 'harlequin:step-of-the-smiling-few'],
  highborn: ['highborn:rarefied', 'highborn:private-tutor', 'highborn:silver-spoon', 'highborn:trust-the-fund', 'highborn:special-reserve', 'highborn:ivory-tower', 'highborn:honor-student', 'highborn:passionate', 'highborn:unflappable', 'highborn:perfect-grace'],
  mender: ['mender:push-through', 'mender:divine-luck', 'mender:illuminate', 'mender:untangle', 'mender:pangloss', 'mender:a-better-way', 'mender:mender', 'mender:encourage', 'mender:iron-cutting', 'mender:heart-forge'],
  brave: ['brave:strike-the-road', 'brave:crush-limiter', 'brave:luck-as-a-constant', 'brave:all-in', 'brave:joyluck-wind-thrower', 'brave:the-sun', 'brave:coordinate', 'brave:heart-of-hearts', 'brave:team-player', 'brave:brave-destiny'],
  broker: ['broker:contingency', 'broker:swoon', 'broker:immaculate', 'broker:beg-borrow-or-steal', 'broker:fruitful', 'broker:faust', 'broker:make-it-work', 'broker:coordinator', 'broker:ladder-climber', 'broker:golden-hand'],
  elder: ['elder:parable', 'elder:pacifist', 'elder:long-memory', 'elder:been-around', 'elder:spinner-of-tales', 'elder:pillar-of-rock', 'elder:saltbelly', 'elder:mentor', 'elder:reputation', 'elder:the-mountain'],
  outsider: ['outsider:xenoclash', 'outsider:gaia-compass', 'outsider:open-up', 'outsider:bloom', 'outsider:earth-glide', 'outsider:tour-guide', 'outsider:earth-speech', 'outsider:centered', 'outsider:resourceful', 'outsider:the-wave'],
  dreamer: ['dreamer:improvise', 'dreamer:punching-bag', 'dreamer:best-efforts', 'dreamer:bright-eyed', 'dreamer:follow-the-leader', 'dreamer:lost-cat', 'dreamer:rash', 'dreamer:underdog', 'dreamer:heart-held-dream', 'dreamer:the-lobster'],
};

type BondSeed = readonly [BondId, string, string, ActionId, ActionId, number];

const BOND_SEEDS: readonly BondSeed[] = [
  ['pathfinder', 'Pathfinder', 'Discover, travel, and meet the unknown.', 'traverse', 'sense', 56],
  ['seeker', 'Seeker', 'Uncover forbidden knowledge and untangle mysteries.', 'study', 'sense', 58],
  ['mighty', 'Mighty', 'Use prodigious strength to protect and overcome.', 'smash', 'endure', 60],
  ['wolf', 'Wolf', 'A scarred, competent exterior learning to trust the pack.', 'excel', 'sneak', 62],
  ['harlequin', 'Harlequin', 'Trick and dance around those who take power seriously.', 'sneak', 'charm', 64],
  ['highborn', 'Highborn', 'Turn privilege, poise, and learning toward the wider world.', 'charm', 'study', 66],
  ['mender', 'Mender', 'Gather, repair, heal, and understand what is broken.', 'tinker', 'charm', 68],
  ['brave', 'Brave', 'Meet problems head-on with courage, luck, and allies.', 'endure', 'command', 70],
  ['broker', 'Broker', 'Use preparation, influence, and a plan for everything.', 'command', 'tinker', 72],
  ['elder', 'Elder', 'Bring patience, experience, and weathered skill.', 'endure', 'excel', 74],
  ['outsider', 'Outsider', 'Bring a unique culture and perspective to the group.', 'sense', 'traverse', 76],
  ['dreamer', 'Dreamer', 'Try the impossible with creativity and optimism.', 'sneak', 'smash', 78],
];

export const BONDS: readonly BondDefinition[] = BOND_SEEDS.map(([id, name, summary, firstAction, secondAction, page]) => {
  const extracted = mechanics.bonds.find((bond) => bond.id === id);
  const powerNames = BOND_POWER_NAMES[id];
  const powerIds = BOND_POWER_IDS[id];
  const sourcePage = Number(page);
  return {
    id,
    name,
    summary: extracted?.summary || summary,
    actions: [firstAction, secondAction],
    effort: extracted?.effort ?? 3,
    strain: extracted?.strain ?? 5,
    powers: powerIds.map((powerId, index) => ({
      id: powerId,
      bondId: id,
      name: powerNames[index] ?? extracted?.powers[index]?.name ?? powerId,
      rulesText: extracted?.powers[index]?.rulesText ?? '',
      source: { page: sourcePage + 1, sectionId: 'bonds' },
    })),
    ideals: extracted?.ideals ?? [],
    secondWind: extracted?.secondWind ?? '',
    specialAbility: extracted?.specialAbility ?? '',
    kits: extracted?.kits ?? [],
    source: { page: sourcePage, sectionId: 'bonds' },
  };
});

/** The canonical, source-ordered registry of every Bond power, owned by the
 * catalog and used by `findBondPower` and the ID-immutability guard. */
export const BOND_POWERS: readonly BondPowerDefinition[] = BONDS.flatMap((bond) => [...bond.powers]);

export const JOB_CLASSES: readonly JobClassDefinition[] = [
  {
    id: 'stalwart',
    name: 'Stalwart',
    color: '#d4513c',
    summary: 'Tough weapon masters who punish foes and control the battlefield.',
    stats: { vitality: 10, hp: 40, defense: 6, armor: 2, speed: 4, dash: 2, fray: 4, damageDie: 6, basicAttackRange: 3 },
    traits: [
      classTrait('stalwart', 116, 'Armor 2', 'Reduce all damage taken by 2.'),
      classTrait('stalwart', 116, 'Fortify', 'Spaces adjacent to you have Rampart. Gain Vigilance +1 at the end of your turn.'),
    ],
    gambit: 'If you take a Stalwart ability while your primary Job is not Stalwart, you gain Heroics and may trigger one Heroic effect for free once per combat.',
    source: { page: 116, sectionId: 'stalwart' },
  },
  {
    id: 'vagabond',
    name: 'Vagabond',
    color: '#e9b949',
    summary: 'Mobile blades for hire who exploit bloodied and isolated foes.',
    stats: { vitality: 7, hp: 28, defense: 10, armor: 0, speed: 4, dash: 4, fray: 2, damageDie: 10, basicAttackRange: 4 },
    traits: [
      classTrait('vagabond', 145, 'Skirmisher', 'May move diagonally and Dash at full Speed.'),
      classTrait('vagabond', 145, 'Dodge', 'Immune to damage from missed attacks, successful saves, and area effects.'),
      classTrait('vagabond', 145, 'Prowl', '1 action: Gain Stealth. This is a free action if no foes are in range 2.'),
      classTrait('vagabond', 145, 'Finesse', 'Deal bonus damage to bloodied foes.'),
    ],
    gambit: 'If you take a Vagabond ability while your primary Job is not Vagabond, those Vagabond abilities benefit from Finesse.',
    source: { page: 145, sectionId: 'vagabond' },
  },
  {
    id: 'mendicant',
    name: 'Mendicant',
    color: '#46a36f',
    summary: 'Healers and storytellers who cure, bless, and support their allies.',
    stats: { vitality: 10, hp: 40, defense: 8, armor: 0, speed: 4, dash: 2, fray: 3, damageDie: 6, basicAttackRange: 5 },
    traits: [
      classTrait('mendicant', 172, 'Diaga', '1 action: Cure a character in range 4.'),
      classTrait('mendicant', 172, 'Bless', '1 action: Grant a Blessing token to a character in range 4.'),
      classTrait('mendicant', 172, 'Succor', 'Rescue may target a defeated ally in range 4 instead of only an adjacent ally.'),
    ],
    gambit: 'If you take a Mendicant ability while your primary Job is not Mendicant, you gain the Bless action.',
    source: { page: 172, sectionId: 'mendicant' },
  },
  {
    id: 'wright',
    name: 'Wright',
    color: '#4f7ecb',
    summary: 'Aetheric mages with long range and powerful area effects.',
    stats: { vitality: 8, hp: 32, defense: 7, armor: 0, speed: 4, dash: 2, fray: 3, damageDie: 8, basicAttackRange: 6 },
    traits: [
      classTrait('wright', 204, 'Slip', 'Movement ignores and does not trigger interrupts, Vigilance, or Rampart.'),
      classTrait('wright', 204, 'Aetherwall', 'Gain resistance against abilities used by characters outside range 2.'),
      classTrait('wright', 204, 'Chain Reaction', 'Once per round after damaging two or more foes with one ability, gain 1 Aether.'),
      classTrait('wright', 204, 'Aether', 'Start combat at 0 Aether, gain 1 at the start of each turn, spend it on one Infuse effect per ability, and lose it after combat.'),
    ],
    gambit: 'If you take a Wright ability while your primary Job is not Wright, you gain Aether and Chain Reaction.',
    source: { page: 204, sectionId: 'wright' },
  },
];

const jobEpithets: Record<string, string> = {
  bastion: 'Unbreakable Knight',
  'demon-slayer': 'Furious Exorcist',
  colossus: 'Titanic Vanguard',
  knave: 'Blackguard',
  fool: 'Dancing Duelist',
  freelancer: 'Deadeye',
  shade: 'Nightblade',
  warden: 'Wild Hunter',
  chanter: 'Flying Skald',
  harvester: 'Green Witch',
  sealer: 'Exorcist',
  seer: 'Fate Weaver',
  enochian: 'Pyromancer',
  geomancer: 'Earth Shaper',
  spellblade: 'Aether Duelist',
  stormbender: 'Elemental Savant',
};

export const JOBS: readonly JobDefinition[] = mechanics.jobs.map((job) => ({
  id: job.id,
  name: job.name,
  epithet: jobEpithets[job.id] ?? '',
  classId: job.classId as JobClassId,
  source: { page: job.sourcePage, sectionId: job.id },
  endPage: job.endPage,
  traitsText: job.traitsText,
  traits: job.traits.map((trait) => ({
    id: trait.id,
    name: trait.name,
    rulesText: trait.rulesText,
    source: { page: trait.sourcePage, sectionId: job.id },
    automation: 'structured' as const,
  })),
  summonRulesText: job.summonRulesText,
  limitBreak: job.limitBreak ? {
    ...job.limitBreak,
    cost: { ...job.limitBreak.cost, kind: job.limitBreak.cost.kind as 'action' | 'free' },
  } : null,
  abilities: job.abilities.map((ability) => ({
    ...ability,
    classId: ability.classId as JobClassId,
    chapter: ability.chapter as 1 | 2 | 3,
    cost: { ...ability.cost, kind: ability.cost.kind as AbilityDefinition['cost']['kind'] },
    talents: ability.talents as [] | [string, string],
    source: { page: ability.sourcePage, sectionId: job.id },
    automation: EXECUTABLE_JOB_ABILITY_IDS.has(ability.id) ? 'executable' as const : 'structured' as const,
  })),
}));

export const ABILITIES = JOBS.flatMap((job) => job.abilities);

export const RELICS: readonly RelicDefinition[] = mechanics.relics.map((relic) => ({
  id: relic.id,
  name: relic.name,
  description: relic.description,
  ranks: relic.ranks as [string, string, string],
  aspect: relic.aspect,
  aspectQuest: relic.aspectQuest,
  source: { page: relic.sourcePage, sectionId: 'relics' },
  automation: 'structured',
}));

export const findBond = (id: string): BondDefinition | undefined => BONDS.find((bond) => bond.id === id);
export const findBondPower = (id: BondPowerId): BondPowerDefinition | undefined => BOND_POWERS.find((power) => power.id === id);
export const findJob = (id: string) => JOBS.find((job) => job.id === id);
export const findClass = (id: JobClassId) => JOB_CLASSES.find((jobClass) => jobClass.id === id);
export const findAbility = (id: string) => ABILITIES.find((ability) => ability.id === id);
export const findRelic = (id: string) => RELICS.find((relic) => relic.id === id);

export const RULES_COVERAGE = [
  { id: 'source', label: 'Sourcebook extraction and search', status: 'complete' },
  { id: 'creation', label: 'Character creation and loadout validation', status: 'complete' },
  { id: 'narrative', label: 'Narrative action resolution', status: 'complete' },
  { id: 'bond-structure', label: 'All 12 Bonds, 120 powers, ideals, features, and kits', status: 'complete' },
  { id: 'combat-core', label: 'Core movement, attacks, damage, saves, and turns', status: 'partial' },
  { id: 'advancement', label: 'Levels, AP, talents, masteries, relics, and respecialization', status: 'partial' },
  { id: 'job-structure', label: 'All 144 job abilities, talents, masteries, traits, and limit breaks', status: 'complete' },
  { id: 'job-ability-automation', label: 'All 144 independently reviewed Job ability programs', status: 'complete' },
  { id: 'job-automation', label: 'Job traits, talents, masteries, Limit Breaks, summons, and remaining triggered effects', status: 'partial' },
  { id: 'relic-structure', label: 'All 40 relic ranks, aspects, and aspect quests', status: 'complete' },
  { id: 'relic-automation', label: 'Relic invokes and persistent effects', status: 'reference' },
  { id: 'foe-structure', label: 'Foe roles, jobs, variants, uniques, elites, legends, and components', status: 'complete' },
  { id: 'foe-automation', label: 'Foe and legend ability/trait execution beyond reviewed recipes', status: 'reference' },
  { id: 'reward-structure', label: 'Trophies, camp fixtures, and expedition rewards', status: 'reference' },
] as const;

// Coverage-ladder telemetry derived from the shared COVERAGE_ITEM_IDS registry
// in `phase-gates.ts`. These are NOT the phase gates and are NOT release
// authority: `*_COVERAGE_READY` means only that every tracked sourcebook
// coverage item is complete (both constants evaluate the same ladder, as both
// gates always subsumed it). The full PHASE_*_READY gates — roadmap acceptance
// criteria, generated audits, and fidelity scopes — are enforced solely by the
// strict source-fidelity claims path (`npm run audit:source-fidelity --
// --strict --run-prereqs`) and can never be satisfied by flipping anything
// here.
export const PHASE_TWO_COVERAGE_READY = coverageLadderComplete(RULES_COVERAGE);
export const PHASE_THREE_COVERAGE_READY = coverageLadderComplete(RULES_COVERAGE);
