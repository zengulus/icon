import { ACTION_IDS, CHARACTER_SCHEMA_VERSION, RULES_VERSION, type ActionRatings, type IconCharacter, type ValidationIssue } from './types.js';
import { BONDS, findAbility, findBond, findClass, findJob, findRelic } from './catalog.js';

const emptyActions = (): ActionRatings => Object.fromEntries(ACTION_IDS.map((id) => [id, 0])) as ActionRatings;
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `icon-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createCharacter(now = new Date().toISOString()): IconCharacter {
  return {
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    id: makeId(),
    ownerId: null,
    name: '',
    pronouns: '',
    kin: '',
    culture: '',
    bondId: '',
    bondAction: null,
    bondPowers: [],
    actions: emptyActions(),
    level: 0,
    xp: 0,
    pendingLevelUps: 0,
    xpAbilityPointClaimed: false,
    jobs: [],
    primaryJobId: null,
    abilities: [],
    equippedAbilityIds: [],
    relics: [],
    dust: 0,
    activeKit: '',
    customKitItems: [],
    looseGear: [],
    equippedLooseGear: [],
    burdens: [],
    ambitions: [],
    effort: 3,
    strain: 0,
    wounds: 0,
    personalResolve: 0,
    notes: '',
    portraitUrl: '',
    createdAt: now,
    updatedAt: now,
  };
}

export const chapterForLevel = (level: number) => Math.min(3, Math.floor(Math.max(0, level - 1) / 4) + 1);

const BASE_ABILITY_POINTS = [2, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18] as const;

export function jobSlotsForLevel(level: number) {
  return 1 + (level >= 4 ? 1 : 0) + (level >= 8 ? 1 : 0);
}

export function abilityPointAllowance(character: IconCharacter) {
  const base = BASE_ABILITY_POINTS[Math.max(0, Math.min(12, character.level))];
  const bonusJobs = Math.max(0, character.jobs.length - 1) * 2;
  return base + bonusJobs + (character.xpAbilityPointClaimed ? 1 : 0);
}

export function abilityPointsSpent(character: IconCharacter) {
  return character.abilities.reduce((total, ability) => total + 1 + (ability.talent ? 1 : 0), 0);
}

export function masteryPointAllowance(character: IconCharacter) {
  const levelPoints = [3, 7, 10, 12].filter((level) => character.level >= level).length;
  const forgoneJobs = Math.max(0, jobSlotsForLevel(character.level) - character.jobs.length);
  return levelPoints + forgoneJobs;
}

export function relicSlotsForLevel(level: number) {
  return [2, 6, 9].filter((requiredLevel) => level >= requiredLevel).length;
}

export function narrativeBudgets(level: number) {
  const fixedPowers = 1 + [1, 2, 3, 6, 9, 12].filter((requiredLevel) => level >= requiredLevel).length;
  const fixedActionDots = 6 + [1, 2, 5, 7, 10, 11].filter((requiredLevel) => level >= requiredLevel).length;
  const flexibleChoices = [4, 8].filter((requiredLevel) => level >= requiredLevel).length;
  return { fixedPowers, fixedActionDots, flexibleChoices };
}

export function characterStats(character: IconCharacter) {
  const job = character.primaryJobId ? findJob(character.primaryJobId) : undefined;
  const jobClass = job ? findClass(job.classId) : undefined;
  if (!jobClass) return null;
  const maxHp = Math.max(0, jobClass.stats.hp - character.wounds * jobClass.stats.vitality);
  return { ...jobClass.stats, maxHp, chapter: chapterForLevel(character.level) };
}

export function validateCharacter(character: IconCharacter, complete = true): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: 'error' });
  const warning = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: 'warning' });
  if (character.schemaVersion !== CHARACTER_SCHEMA_VERSION) error('schemaVersion', 'schema.unsupported', 'Character data must be migrated to the current schema.');
  if (character.rulesVersion !== RULES_VERSION) error('rulesVersion', 'rules.unsupported', `Expected ICON rules ${RULES_VERSION}.`);
  if (complete && !character.name.trim()) error('name', 'required', 'Give the character a name.');
  if (complete && !character.kin) error('kin', 'required', 'Choose a Kin.');
  if (complete && !character.culture) error('culture', 'required', 'Choose a Culture.');

  const bond = findBond(character.bondId);
  if (complete && !bond) error('bondId', 'required', 'Choose a Bond.');
  if (bond && (!character.bondAction || !bond.actions.includes(character.bondAction))) {
    error('bondAction', 'bond.action', `Choose ${bond.actions.join(' or ')} for the Bond's +2 dots.`);
  }
  if (bond && character.bondAction && character.actions[character.bondAction] < 2) {
    error(`actions.${character.bondAction}`, 'bond.minimum', 'The selected Bond action must include its two starting dots.');
  }
  if (bond && (!Number.isInteger(character.effort) || character.effort < 0 || character.effort > bond.effort)) error('effort', 'effort.range', `Effort must be between 0 and ${bond.effort} for the ${bond.name}.`);
  if (bond && (!Number.isInteger(character.strain) || character.strain < 0 || character.strain > bond.strain)) error('strain', 'strain.range', `Strain must be between 0 and ${bond.strain} for the ${bond.name}.`);

  const actionTotal = ACTION_IDS.reduce((sum, id) => sum + character.actions[id], 0);
  const maxRating = character.level === 0 ? 3 : 4;
  for (const id of ACTION_IDS) {
    if (!Number.isInteger(character.actions[id]) || character.actions[id] < 0 || character.actions[id] > maxRating) {
      error(`actions.${id}`, 'action.range', `Action ratings must be whole numbers from 0 to ${maxRating}.`);
    }
  }
  const narrative = narrativeBudgets(character.level);
  if (character.level === 0 && actionTotal !== 6) error('actions', 'action.total', `Level 0 characters need exactly 6 action dots; currently ${actionTotal}.`);
  if (actionTotal > narrative.fixedActionDots + narrative.flexibleChoices * 2) error('actions', 'action.budget', 'Action ratings exceed the narrative benefits earned at this level.');
  if (ACTION_IDS.filter((id) => character.actions[id] === 4).length > 1) error('actions', 'action.four-limit', 'Only one action can ever have a rating of 4.');
  if (new Set(character.bondPowers).size !== character.bondPowers.length) error('bondPowers', 'bond.power-duplicate', 'A Bond power cannot be selected more than once.');
  if (character.level === 0 && complete && character.bondPowers.length !== 1) error('bondPowers', 'bond.power-count', 'Level 0 characters choose one Bond power.');
  const allBondPowers = new Set(BONDS.flatMap(({ powers }) => powers));
  if (character.bondPowers.some((power) => !allBondPowers.has(power))) error('bondPowers', 'bond.power-unknown', 'One or more Bond powers do not exist in ICON 1.5.');
  if (bond) {
    const ownPowerCount = character.bondPowers.filter((power) => bond.powers.includes(power)).length;
    const gambitCount = character.bondPowers.length - ownPowerCount;
    if (gambitCount > 1 || (gambitCount === 1 && ownPowerCount < 4)) error('bondPowers', 'bond.gambit', 'A single Gambit from another Bond unlocks only after taking four powers from your own Bond.');
  }
  if (character.bondPowers.length > narrative.fixedPowers + narrative.flexibleChoices) error('bondPowers', 'bond.power-budget', 'Bond powers exceed the narrative benefits earned at this level.');
  const flexibleActionChoices = Math.ceil(Math.max(0, actionTotal - narrative.fixedActionDots) / 2);
  const flexiblePowerChoices = Math.max(0, character.bondPowers.length - narrative.fixedPowers);
  if (flexibleActionChoices + flexiblePowerChoices > narrative.flexibleChoices) error('bondPowers', 'narrative.choice-budget', 'Level 4 and 8 narrative choices must be spent on either two action improvements or one Bond power.');

  const primaryJob = character.primaryJobId ? findJob(character.primaryJobId) : undefined;
  if (complete && !primaryJob) error('primaryJobId', 'required', 'Choose a combat Job.');
  if (new Set(character.jobs).size !== character.jobs.length) error('jobs', 'job.duplicate', 'A Job cannot be learned more than once.');
  if (character.jobs.some((jobId) => !findJob(jobId))) error('jobs', 'job.unknown', 'One or more learned Jobs do not exist in ICON 1.5.');
  if (character.jobs.length > jobSlotsForLevel(character.level)) error('jobs', 'job.level', `Level ${character.level} permits at most ${jobSlotsForLevel(character.level)} learned Job${jobSlotsForLevel(character.level) === 1 ? '' : 's'}.`);
  if (primaryJob && !character.jobs.includes(primaryJob.id)) error('jobs', 'job.primary', 'The primary Job must be one of the character’s learned Jobs.');
  const abilityDefinitions = character.abilities.map(({ abilityId }) => findAbility(abilityId));
  if (abilityDefinitions.some((ability) => !ability)) error('abilities', 'ability.unknown', 'One or more abilities do not exist in ICON 1.5.');
  if (abilityDefinitions.some((ability) => ability && ability.chapter > chapterForLevel(character.level))) {
    error('abilities', 'ability.chapter', `This character can only learn Chapter ${chapterForLevel(character.level)} abilities at level ${character.level}.`);
  }
  if (abilityDefinitions.some((ability) => ability && !character.jobs.includes(ability.jobId))) error('abilities', 'ability.job', 'Abilities can only be learned from this character’s Jobs.');
  if (new Set(character.abilities.map(({ abilityId }) => abilityId)).size !== character.abilities.length) {
    error('abilities', 'ability.duplicate', 'An ability cannot be learned more than once.');
  }
  if (character.level === 0 && character.abilities.length !== 2) error('abilities', 'ability.starting-count', 'Level 0 characters choose exactly two abilities.');
  if (abilityPointsSpent(character) > abilityPointAllowance(character)) error('abilities', 'ability.ap-budget', `Abilities and talents cost ${abilityPointsSpent(character)} AP; only ${abilityPointAllowance(character)} AP has been earned.`);
  const masterySpent = character.abilities.filter(({ mastered }) => mastered).length;
  if (masterySpent > masteryPointAllowance(character)) error('abilities', 'ability.mastery-budget', `Masteries cost ${masterySpent} points; only ${masteryPointAllowance(character)} has been earned.`);
  if (character.equippedAbilityIds.some((abilityId) => !character.abilities.some((ability) => ability.abilityId === abilityId))) {
    error('equippedAbilityIds', 'ability.not-learned', 'Only learned abilities can be equipped.');
  }
  if (new Set(character.equippedAbilityIds).size !== character.equippedAbilityIds.length) {
    error('equippedAbilityIds', 'ability.equipped-duplicate', 'An ability cannot occupy more than one loadout slot.');
  }
  if (character.equippedAbilityIds.length > 6) error('equippedAbilityIds', 'ability.equipped-limit', 'An expedition loadout can contain at most six abilities.');
  if (primaryJob && character.equippedAbilityIds.length > 0) {
    const matching = character.equippedAbilityIds.filter((id) => findAbility(id)?.classId === primaryJob.classId).length;
    if (matching < Math.ceil(character.equippedAbilityIds.length / 2)) error('equippedAbilityIds', 'ability.class-balance', 'At least half the loadout must match the primary Job’s class.');
  }
  if (character.level < 0 || character.level > 12) error('level', 'level.range', 'Level must be between 0 and 12.');
  if (character.xp < 0 || character.xp > 14) error('xp', 'xp.range', 'XP must be between 0 and 14; reaching 15 banks a level-up and resets XP.');
  if (character.wounds < 0 || character.wounds > 4) error('wounds', 'wounds.range', 'Wounds must be between 0 and 4.');
  if (character.wounds === 4) warning('wounds', 'character.fallen', 'A character with four wounds is Fallen and cannot continue as a player character.');
  if (!Number.isInteger(character.dust) || character.dust < 0 || character.dust > 8) error('dust', 'dust.range', 'A character can carry from 0 to 8 dust.');
  if (character.relics.length > relicSlotsForLevel(character.level)) error('relics', 'relic.slot-budget', `Level ${character.level} permits ${relicSlotsForLevel(character.level)} relic slot${relicSlotsForLevel(character.level) === 1 ? '' : 's'}.`);
  if (new Set(character.relics.map(({ relicId }) => relicId)).size !== character.relics.length) error('relics', 'relic.duplicate', 'A relic can only occupy one slot.');
  for (const [index, relic] of character.relics.entries()) {
    if (!findRelic(relic.relicId)) error(`relics.${index}.relicId`, 'relic.unknown', 'That relic does not exist in ICON 1.5.');
    if (![1, 2, 3, 4].includes(relic.rank)) error(`relics.${index}.rank`, 'relic.rank', 'Relic rank must be I, II, III, or Aspected.');
    if (!Number.isInteger(relic.dustInfused) || relic.dustInfused < 0) error(`relics.${index}.dustInfused`, 'relic.dust', 'Relic infusion must be a non-negative whole number.');
  }
  if (character.equippedLooseGear.some((item) => !character.looseGear.includes(item))) error('equippedLooseGear', 'gear.not-owned', 'Only recorded loose gear can be taken on an expedition.');
  if (character.equippedLooseGear.length > 2) error('equippedLooseGear', 'gear.limit', 'An expedition can include at most two pieces of loose gear.');
  if (bond && character.activeKit && character.activeKit !== 'Custom Kit' && !bond.kits.some(({ name }) => name === character.activeKit)) error('activeKit', 'gear.kit', 'The active kit must come from the character’s Bond.');
  if (character.activeKit === 'Custom Kit' && character.customKitItems.filter(Boolean).length !== 3) warning('customKitItems', 'gear.custom-kit', 'A custom kit contains exactly three items from this Bond’s kits.');
  for (const [group, clocks] of [['burdens', character.burdens], ['ambitions', character.ambitions]] as const) {
    if (clocks.length > 3) error(group, 'clock.limit', `A character can track at most three ${group}.`);
    for (const [index, clock] of clocks.entries()) {
      if (![4, 6, 10].includes(clock.size) || !Number.isInteger(clock.progress) || clock.progress < 0 || clock.progress > clock.size) error(`${group}.${index}`, 'clock.range', 'Clock progress must fit a 4, 6, or 10 segment clock.');
    }
  }
  return issues;
}

export function awardXp(character: IconCharacter, amount: number): IconCharacter {
  const total = character.xp + Math.max(0, Math.floor(amount));
  const xpAbilityPointClaimed = character.xpAbilityPointClaimed || total >= 7;
  const canBankLevel = total >= 15 && character.pendingLevelUps === 0;
  return {
    ...character,
    xp: canBankLevel ? 0 : Math.min(14, total),
    pendingLevelUps: canBankLevel ? 1 : character.pendingLevelUps,
    xpAbilityPointClaimed,
    updatedAt: new Date().toISOString(),
  };
}

export function spendLevelUp(character: IconCharacter, chapterCap: number): IconCharacter {
  if (character.pendingLevelUps < 1) throw new Error('No banked level-up is available.');
  if (character.level >= 12) throw new Error('ICON characters cannot advance beyond level 12.');
  const nextLevel = character.level + 1;
  if (chapterForLevel(nextLevel) > chapterCap) throw new Error('The campaign chapter does not permit this level yet.');
  return { ...character, level: nextLevel, pendingLevelUps: character.pendingLevelUps - 1, xpAbilityPointClaimed: false, updatedAt: new Date().toISOString() };
}

export function migrateCharacter(input: unknown): IconCharacter {
  if (!input || typeof input !== 'object') throw new Error('Character import must be a JSON object.');
  const candidate = input as Omit<Partial<IconCharacter>, 'schemaVersion'> & { schemaVersion?: number; relicIds?: string[] };
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== CHARACTER_SCHEMA_VERSION) throw new Error(`Unsupported character schema version: ${String(candidate.schemaVersion)}`);
  const defaults = createCharacter();
  const migrated = {
    ...defaults,
    ...candidate,
    rulesVersion: RULES_VERSION,
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    xpAbilityPointClaimed: candidate.xpAbilityPointClaimed ?? ((candidate.xp ?? 0) >= 7),
    relics: candidate.relics ?? (candidate.relicIds ?? []).map((relicId) => ({ relicId, rank: 1 as const, dustInfused: 0 })),
    customKitItems: [...(candidate.customKitItems ?? [])],
    looseGear: [...(candidate.looseGear ?? [])],
    equippedLooseGear: [...(candidate.equippedLooseGear ?? [])],
    burdens: [...(candidate.burdens ?? [])],
    ambitions: [...(candidate.ambitions ?? [])],
  } as IconCharacter;
  const issues = validateCharacter(migrated, false).filter((issue) => issue.severity === 'error' && !issue.code.endsWith('total') && !issue.code.endsWith('starting-count'));
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' '));
  return migrated;
}
