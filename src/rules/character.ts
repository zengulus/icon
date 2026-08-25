import { ACTION_IDS, CHARACTER_SCHEMA_VERSION, RULES_VERSION, type ActionRatings, type IconCharacter, type ValidationIssue } from './types.js';
import { BONDS, CULTURES, KIN, findAbility, findBond, findClass, findJob, findRelic } from './catalog.js';

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
    hpLost: 0,
    personalResolve: 0,
    notes: '',
    portraitUrl: '',
    createdAt: now,
    updatedAt: now,
  };
}

export const chapterForLevel = (level: number) => Math.min(3, Math.floor(Math.max(0, level - 1) / 4) + 1);

/** The executable boundary of source adjudication
 * `icon-1.5:advancement:limit-break-level` (see
 * src/rules/source-adjudications.ts): the advancement tables (pp.15, 115,
 * 241) and the p.112 prose grant the Limit Break at level 1, conflicting with
 * the Resolve section's single "level 2" sentence (p.99). The engine adopts
 * level 1; no Limit Break availability gate exists yet, so this constant is
 * the durable boundary a future gate must agree with. */
export const LIMIT_BREAK_UNLOCK_LEVEL = 1;

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

/** Sourcebook p.242–245: levels II and III each need six dust; an Aspect
 * needs a level III relic plus 12 dust, or a documented quest alternative. */
export function relicMinimumInfusedDust(rank: 1 | 2 | 3 | 4, aspectState: IconCharacter['relics'][number]['aspectState'] = 'none') {
  if (rank === 1) return 0;
  if (rank === 2) return 6;
  if (rank === 3) return 12;
  if (aspectState === 'dust') return 24;
  if (aspectState === 'shared-quest') return 16;
  return 12;
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

/** Current hit points against the wounds-adjusted maximum (p.94): the
 * persistent attrition record between combats. Null when the character has
 * no primary Job to derive stats from. */
export function characterCurrentHp(character: IconCharacter): number | null {
  const stats = characterStats(character);
  if (!stats) return null;
  return Math.max(0, stats.maxHp - Math.max(0, character.hpLost));
}

/** Camping (p.253, "The Camp"): camping "heals all strain, unticks all
 * effort, and heals all HP". Pure — returns a new character.
 *
 * - all strain healed (`strain` → 0);
 * - all effort unticked (`effort` → back to the Bond's maximum);
 * - all HP healed (`hpLost` → 0).
 * Wounds are NOT healed by camping (the source grounds wound recovery at the
 * interlude), and personal resolve resets to 0 after camping (p.99). */
export function campCharacter(character: IconCharacter, now = new Date().toISOString()): IconCharacter {
  const bond = character.bondId ? findBond(character.bondId) : undefined;
  return {
    ...character,
    strain: 0,
    effort: bond ? Math.max(0, bond.effort) : character.effort,
    hpLost: 0,
    personalResolve: 0,
    updatedAt: now,
  };
}

/** The start of an interlude (p.56): hit points, wounds, and strain are all
 * fully restored. Pure — returns a new character. */
export function beginInterlude(character: IconCharacter, now = new Date().toISOString()): IconCharacter {
  return { ...character, hpLost: 0, wounds: 0, strain: 0, updatedAt: now };
}

export function validateCharacter(character: IconCharacter, complete = true): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: 'error' });
  const warning = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: 'warning' });
  if (character.schemaVersion !== CHARACTER_SCHEMA_VERSION) error('schemaVersion', 'schema.unsupported', 'Character data must be migrated to the current schema.');
  if (character.rulesVersion !== RULES_VERSION) error('rulesVersion', 'rules.unsupported', `Expected ICON rules ${RULES_VERSION}.`);
  if (complete && !character.name.trim()) error('name', 'required', 'Give the character a name.');
  if (complete && !character.kin) error('kin', 'required', 'Choose a Kin.');
  else if (character.kin && !KIN.includes(character.kin as typeof KIN[number])) error('kin', 'kin.unknown', 'Choose a Kin from the ICON 1.5 source catalog.');
  if (complete && !character.culture) error('culture', 'required', 'Choose a Culture.');
  else if (character.culture && !CULTURES.includes(character.culture as typeof CULTURES[number])) error('culture', 'culture.unknown', 'Choose a Culture from the ICON 1.5 source catalog.');

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
  if (!Number.isInteger(character.hpLost) || character.hpLost < 0) {
    error('hpLost', 'hp-lost.range', 'Hit points lost must be a non-negative whole number.');
  } else {
    const primaryClassStats = primaryJob ? findClass(primaryJob.classId)?.stats : undefined;
    if (primaryClassStats && character.hpLost > Math.max(0, primaryClassStats.hp - character.wounds * primaryClassStats.vitality)) {
      error('hpLost', 'hp-lost.maximum', 'Hit points lost cannot exceed the wounds-adjusted maximum.');
    }
  }
  if (!Number.isInteger(character.dust) || character.dust < 0 || character.dust > 8) error('dust', 'dust.range', 'A character can carry from 0 to 8 dust.');
  if (character.relics.length > relicSlotsForLevel(character.level)) error('relics', 'relic.slot-budget', `Level ${character.level} permits ${relicSlotsForLevel(character.level)} relic slot${relicSlotsForLevel(character.level) === 1 ? '' : 's'}.`);
  if (new Set(character.relics.map(({ relicId }) => relicId)).size !== character.relics.length) error('relics', 'relic.duplicate', 'A relic can only occupy one slot.');
  for (const [index, relic] of character.relics.entries()) {
    if (!findRelic(relic.relicId)) error(`relics.${index}.relicId`, 'relic.unknown', 'That relic does not exist in ICON 1.5.');
    if (![1, 2, 3, 4].includes(relic.rank)) error(`relics.${index}.rank`, 'relic.rank', 'Relic rank must be I, II, III, or Aspected.');
    if (!['none', 'dust', 'quest', 'shared-quest', 'unresolved'].includes(relic.aspectState)) error(`relics.${index}.aspectState`, 'relic.aspect-state', 'Relic aspect state is invalid.');
    if (relic.rank < 4 && relic.aspectState !== 'none') error(`relics.${index}.aspectState`, 'relic.aspect-state', 'Only an Aspected relic can have an aspect state.');
    if (relic.rank === 4 && relic.aspectState === 'none') error(`relics.${index}.aspectState`, 'relic.aspect-required', 'An Aspected relic requires recorded dust or quest advancement.');
    if (relic.rank === 4 && relic.aspectState === 'unresolved') error(`relics.${index}.aspectState`, 'relic.aspect-unresolved', 'Confirm how this historical Aspected relic was earned before it can enter an encounter.');
    if (!Number.isInteger(relic.dustInfused) || relic.dustInfused < 0) error(`relics.${index}.dustInfused`, 'relic.dust', 'Relic infusion must be a non-negative whole number.');
    else if ([1, 2, 3, 4].includes(relic.rank) && relic.dustInfused < relicMinimumInfusedDust(relic.rank, relic.aspectState)) {
      error(`relics.${index}.dustInfused`, 'relic.infusion-required', `Relic rank ${relic.rank === 4 ? 'Aspect' : relic.rank} requires at least ${relicMinimumInfusedDust(relic.rank, relic.aspectState)} infused dust for its recorded advancement.`);
    }
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

/** ICON p.113: Refocus refunds every ability, talent, and mastery, drops all
 * Jobs, and re-picks the same number of Jobs during an interlude. */
export const REFOCUS_DUST_COST = 8;
/** ICON p.113: Refocusing without changing any Job costs half the dust. */
export const REFOCUS_KEEP_JOBS_DUST_COST = 4;

export interface RefocusPlan {
  jobs: string[];
  primaryJobId: string | null;
  abilities: IconCharacter['abilities'];
  equippedAbilityIds: string[];
}

/** The sourcebook charges 8 dust to change Jobs and 4 dust to keep them. */
export function refocusDustCost(character: IconCharacter, nextJobs: string[]) {
  const changed = nextJobs.length !== character.jobs.length
    || nextJobs.some((jobId) => !character.jobs.includes(jobId))
    || character.jobs.some((jobId) => !nextJobs.includes(jobId));
  return changed ? REFOCUS_DUST_COST : REFOCUS_KEEP_JOBS_DUST_COST;
}

/**
 * Respecialize during an interlude (ICON p.113). Refunds every ability point,
 * talent, and mastery, drops all Jobs, then re-picks the same number of Jobs
 * and re-spends AP on the provided abilities. Narrative state (Bond, action
 * ratings, powers, relics, gear) is untouched. The re-pick is validated with
 * the same blocking rules as character creation, so a Refocus can never
 * silently legalize an illegal build.
 */
export function refocusCharacter(character: IconCharacter, plan: RefocusPlan): IconCharacter {
  if (character.level < 1) throw new Error('Refocus requires a level 1 or higher character during an interlude.');
  if (plan.jobs.length !== character.jobs.length) {
    throw new Error('Refocus re-picks the same number of Jobs the character already had.');
  }
  const cost = refocusDustCost(character, plan.jobs);
  if (character.dust < cost) throw new Error(`Refocus costs ${cost} dust; the character carries ${character.dust}.`);
  const next: IconCharacter = {
    ...character,
    dust: character.dust - cost,
    jobs: [...plan.jobs],
    primaryJobId: plan.primaryJobId,
    abilities: plan.abilities.map((ability) => ({ ...ability })),
    equippedAbilityIds: [...plan.equippedAbilityIds],
    updatedAt: new Date().toISOString(),
  };
  const blocking = blockingCharacterIssues(next);
  if (blocking.length) throw new Error(blocking.map((issue) => issue.message).join(' '));
  return next;
}

/** ICON p.245: Relics start at level I and need 6 dust for levels II and III. */
export function relicRankForDust(dustInfused: number): 1 | 2 | 3 {
  if (dustInfused >= 12) return 3;
  if (dustInfused >= 6) return 2;
  return 1;
}

function findRelicSlot(character: IconCharacter, relicId: string) {
  const index = character.relics.findIndex((relic) => relic.relicId === relicId);
  if (index === -1) throw new Error('That relic is not recorded on this character.');
  return index;
}

/**
 * Permanently infuse carried dust into a relic (ICON p.245: “Infuse 1 dust
 * into a relic of your choice when you complete a tactical combat”). Rank
 * advances deterministically at 6, 12, and 24 infused dust; crossing 24 on a
 * level III relic is the 12-dust Aspect path.
 */
export function infuseRelicDust(character: IconCharacter, relicId: string, amount = 1): IconCharacter {
  const index = findRelicSlot(character, relicId);
  const relic = character.relics[index];
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Relic infusion must spend at least one dust.');
  if (relic.rank === 4) throw new Error(`${relic.relicId} is already Aspected and cannot take more dust.`);
  if (character.dust < amount) throw new Error(`Infusing ${amount} dust requires ${amount} carried dust; the character carries ${character.dust}.`);
  const dustInfused = relic.dustInfused + amount;
  const next: IconCharacter['relics'][number] = { ...relic, dustInfused, rank: relicRankForDust(dustInfused) };
  if (next.rank === 3 && dustInfused >= 24 && relic.aspectState === 'none') {
    next.rank = 4;
    next.aspectState = 'dust';
  }
  const relics = character.relics.map((candidate, candidateIndex) => candidateIndex === index ? next : candidate);
  return { ...character, dust: character.dust - amount, relics, updatedAt: new Date().toISOString() };
}

/** ICON p.245: a level III relic becomes Aspected by completing a legendary task. */
export function completeRelicAspectQuest(character: IconCharacter, relicId: string): IconCharacter {
  const index = findRelicSlot(character, relicId);
  const relic = character.relics[index];
  if (relic.rank !== 3 || relic.aspectState !== 'none') throw new Error('Only a level III relic without an aspect can complete an aspect quest.');
  if (relic.dustInfused < relicMinimumInfusedDust(3)) throw new Error('A relic must reach level III (12 infused dust) before it can be Aspected.');
  const relics = character.relics.map((candidate, candidateIndex) => candidateIndex === index
    ? { ...candidate, rank: 4 as const, aspectState: 'quest' as const }
    : candidate);
  return { ...character, relics, updatedAt: new Date().toISOString() };
}

/** ICON p.245: once any character completed the quest, others Aspect for 4 dust. */
export function aspectRelicFromSharedQuest(character: IconCharacter, relicId: string): IconCharacter {
  const index = findRelicSlot(character, relicId);
  const relic = character.relics[index];
  if (relic.rank !== 3 || relic.aspectState !== 'none') throw new Error('Only a level III relic without an aspect can share a completed aspect quest.');
  if (relic.dustInfused < relicMinimumInfusedDust(3)) throw new Error('A relic must reach level III (12 infused dust) before it can be Aspected.');
  if (character.dust < 4) throw new Error('Sharing a completed aspect quest costs 4 dust.');
  const dustInfused = relic.dustInfused + 4;
  const relics = character.relics.map((candidate, candidateIndex) => candidateIndex === index
    ? { ...candidate, rank: 4 as const, aspectState: 'shared-quest' as const, dustInfused }
    : candidate);
  return { ...character, dust: character.dust - 4, relics, updatedAt: new Date().toISOString() };
}

/**
 * Repair a migrated Aspected relic whose provenance was unknown. The chosen
 * path must satisfy its own minimum infusion, and dustInfused is raised to
 * that minimum rather than inventing or discarding recorded dust.
 */
export function resolveRelicAspect(character: IconCharacter, relicId: string, path: 'dust' | 'quest' | 'shared-quest'): IconCharacter {
  const index = findRelicSlot(character, relicId);
  const relic = character.relics[index];
  if (relic.rank !== 4 || relic.aspectState !== 'unresolved') throw new Error('Only an Aspected relic with unresolved provenance can be resolved.');
  const minimum = relicMinimumInfusedDust(4, path);
  const relics = character.relics.map((candidate, candidateIndex) => candidateIndex === index
    ? { ...candidate, aspectState: path, dustInfused: Math.max(candidate.dustInfused, minimum) }
    : candidate);
  return { ...character, relics, updatedAt: new Date().toISOString() };
}

const CHARACTER_FIELDS = [
  'schemaVersion', 'rulesVersion', 'id', 'ownerId', 'name', 'pronouns',
  'kin', 'culture', 'bondId', 'bondAction', 'bondPowers', 'actions',
  'level', 'xp', 'pendingLevelUps', 'xpAbilityPointClaimed', 'jobs',
  'primaryJobId', 'abilities', 'equippedAbilityIds', 'relics', 'dust',
  'activeKit', 'customKitItems', 'looseGear', 'equippedLooseGear',
  'burdens', 'ambitions', 'effort', 'strain', 'wounds', 'hpLost', 'personalResolve',
  'notes', 'portraitUrl', 'createdAt', 'updatedAt',
] as const;

const CURRENT_CHARACTER_FIELDS = new Set<string>(CHARACTER_FIELDS);
const HISTORICAL_CHARACTER_FIELDS = new Set<string>([...CHARACTER_FIELDS, 'relicIds']);

function characterRecord(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${path} must be an object.`);
  return input as Record<string, unknown>;
}

function exactCharacterKeys(record: Record<string, unknown>, path: string, keys: readonly string[]) {
  const expected = new Set(keys);
  const actual = Object.keys(record);
  const unexpected = actual.find((key) => !expected.has(key));
  const missing = keys.find((key) => !(key in record));
  if (unexpected) throw new Error(`${path}.${unexpected} is not part of the current character schema.`);
  if (missing) throw new Error(`${path}.${missing} is required by the current character schema.`);
}

function allowedHistoricalCharacterKeys(record: Record<string, unknown>) {
  const unexpected = Object.keys(record).find((key) => !HISTORICAL_CHARACTER_FIELDS.has(key));
  if (unexpected) throw new Error(`Character.${unexpected} has no supported historical migration.`);
}

function characterString(value: unknown, path: string, nonEmpty = false): string {
  if (typeof value !== 'string' || (nonEmpty && !value)) throw new Error(`${path} must be ${nonEmpty ? 'a non-empty ' : 'a '}string.`);
  return value;
}

function characterNullableString(value: unknown, path: string): string | null {
  return value === null ? null : characterString(value, path);
}

function characterInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer.`);
  return value;
}

function characterBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  return value;
}

function characterStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  value.forEach((item, index) => characterString(item, `${path}[${index}]`));
  return value as string[];
}

function characterArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function assertCurrentCharacterStructure(input: unknown): IconCharacter {
  const character = characterRecord(input, 'Character');
  exactCharacterKeys(character, 'Character', CHARACTER_FIELDS);
  if (character.schemaVersion !== CHARACTER_SCHEMA_VERSION) throw new Error(`Character.schemaVersion must be ${CHARACTER_SCHEMA_VERSION}.`);
  if (character.rulesVersion !== RULES_VERSION) throw new Error(`Character.rulesVersion must be ICON ${RULES_VERSION}.`);
  characterString(character.id, 'Character.id', true);
  characterNullableString(character.ownerId, 'Character.ownerId');
  for (const field of ['name', 'pronouns', 'kin', 'culture', 'bondId', 'activeKit', 'notes', 'portraitUrl', 'createdAt', 'updatedAt'] as const) {
    characterString(character[field], `Character.${field}`);
  }
  if (character.bondAction !== null && (!ACTION_IDS.includes(character.bondAction as typeof ACTION_IDS[number]))) {
    throw new Error('Character.bondAction must be a known action or null.');
  }
  characterStringArray(character.bondPowers, 'Character.bondPowers');
  const actions = characterRecord(character.actions, 'Character.actions');
  exactCharacterKeys(actions, 'Character.actions', ACTION_IDS);
  ACTION_IDS.forEach((action) => characterInteger(actions[action], `Character.actions.${action}`));
  for (const field of ['level', 'xp', 'pendingLevelUps', 'dust', 'effort', 'strain', 'wounds', 'hpLost', 'personalResolve'] as const) {
    characterInteger(character[field], `Character.${field}`);
  }
  characterBoolean(character.xpAbilityPointClaimed, 'Character.xpAbilityPointClaimed');
  characterStringArray(character.jobs, 'Character.jobs');
  characterNullableString(character.primaryJobId, 'Character.primaryJobId');
  characterStringArray(character.equippedAbilityIds, 'Character.equippedAbilityIds');
  for (const field of ['customKitItems', 'looseGear', 'equippedLooseGear'] as const) {
    characterStringArray(character[field], `Character.${field}`);
  }
  characterArray(character.abilities, 'Character.abilities').forEach((value, index) => {
    const ability = characterRecord(value, `Character.abilities[${index}]`);
    exactCharacterKeys(ability, `Character.abilities[${index}]`, ['abilityId', 'talent', 'mastered']);
    characterString(ability.abilityId, `Character.abilities[${index}].abilityId`, true);
    if (ability.talent !== null && ability.talent !== 1 && ability.talent !== 2) throw new Error(`Character.abilities[${index}].talent must be 1, 2, or null.`);
    characterBoolean(ability.mastered, `Character.abilities[${index}].mastered`);
  });
  characterArray(character.relics, 'Character.relics').forEach((value, index) => {
    const relic = characterRecord(value, `Character.relics[${index}]`);
    exactCharacterKeys(relic, `Character.relics[${index}]`, ['relicId', 'rank', 'aspectState', 'dustInfused']);
    characterString(relic.relicId, `Character.relics[${index}].relicId`, true);
    if (relic.rank !== 1 && relic.rank !== 2 && relic.rank !== 3 && relic.rank !== 4) throw new Error(`Character.relics[${index}].rank must be 1, 2, 3, or 4.`);
    if (!['none', 'dust', 'quest', 'shared-quest', 'unresolved'].includes(String(relic.aspectState))) throw new Error(`Character.relics[${index}].aspectState is invalid.`);
    characterInteger(relic.dustInfused, `Character.relics[${index}].dustInfused`);
  });
  for (const field of ['burdens', 'ambitions'] as const) {
    characterArray(character[field], `Character.${field}`).forEach((value, index) => {
      const clock = characterRecord(value, `Character.${field}[${index}]`);
      exactCharacterKeys(clock, `Character.${field}[${index}]`, ['id', 'name', 'size', 'progress']);
      characterString(clock.id, `Character.${field}[${index}].id`, true);
      characterString(clock.name, `Character.${field}[${index}].name`);
      if (clock.size !== 4 && clock.size !== 6 && clock.size !== 10) throw new Error(`Character.${field}[${index}].size must be 4, 6, or 10.`);
      characterInteger(clock.progress, `Character.${field}[${index}].progress`);
    });
  }
  return character as unknown as IconCharacter;
}

function blockingCharacterIssues(character: IconCharacter): ValidationIssue[] {
  return validateCharacter(character, false).filter((issue) => issue.severity === 'error'
    && !issue.code.endsWith('total')
    && !issue.code.endsWith('starting-count')
    && issue.code !== 'relic.aspect-unresolved');
}

/** Reject malformed current records before any historical defaults are applied. */
export function assertValidCharacterState(input: unknown): asserts input is IconCharacter {
  const character = assertCurrentCharacterStructure(input);
  const issues = blockingCharacterIssues(character);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' '));
}

function historicalArray(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  return characterArray(value, path);
}

export function migrateCharacter(input: unknown): IconCharacter {
  const raw = characterRecord(input, 'Character import');
  const candidate = raw as Omit<Partial<IconCharacter>, 'schemaVersion'> & { schemaVersion?: number; relicIds?: string[] };
  // Schema v3 predates the durable hpLost attrition field; it migrates like
  // v1/v2 with hpLost defaulting to 0 (full health between combats — the
  // implicit pre-v4 semantics).
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3 && candidate.schemaVersion !== CHARACTER_SCHEMA_VERSION) throw new Error(`Unsupported character schema version: ${String(candidate.schemaVersion)}`);
  if (candidate.rulesVersion !== undefined && candidate.rulesVersion !== RULES_VERSION) {
    throw new Error(`Unsupported ICON rules version: ${String(candidate.rulesVersion)}.`);
  }
  if (candidate.schemaVersion === CHARACTER_SCHEMA_VERSION) {
    assertValidCharacterState(input);
    return structuredClone(input) as IconCharacter;
  }
  allowedHistoricalCharacterKeys(raw);
  const defaults = createCharacter();
  // Schema v1/v2 relic records predate aspectState. Keep the deliberately
  // narrower migration shape here so TypeScript does not accidentally treat a
  // legacy rank-one fallback as a fully current CharacterRelic.
  type MigratingRelic = Omit<IconCharacter['relics'][number], 'aspectState'>
    & Partial<Pick<IconCharacter['relics'][number], 'aspectState'>>;
  const relics = (candidate.relics !== undefined
    ? historicalArray(candidate.relics, 'Character.relics')
    : historicalArray(candidate.relicIds, 'Character.relicIds').map((relicId) => ({ relicId, rank: 1 as const, dustInfused: 0 }))) as MigratingRelic[];
  const { relicIds: _relicIds, ...migratingFields } = candidate;
  const migrated = {
    ...defaults,
    ...migratingFields,
    rulesVersion: RULES_VERSION,
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    xpAbilityPointClaimed: candidate.xpAbilityPointClaimed ?? ((candidate.xp ?? 0) >= 7),
    relics: relics.map((relic) => ({
      ...relic,
      aspectState: relic.aspectState ?? (relic.rank === 4 ? 'unresolved' : 'none'),
    })),
    customKitItems: [...historicalArray(candidate.customKitItems, 'Character.customKitItems')] as string[],
    looseGear: [...historicalArray(candidate.looseGear, 'Character.looseGear')] as string[],
    equippedLooseGear: [...historicalArray(candidate.equippedLooseGear, 'Character.equippedLooseGear')] as string[],
    burdens: [...historicalArray(candidate.burdens, 'Character.burdens')] as IconCharacter['burdens'],
    ambitions: [...historicalArray(candidate.ambitions, 'Character.ambitions')] as IconCharacter['ambitions'],
  } as IconCharacter;
  // A v2 Aspected relic had no provenance field. Preserve it as explicitly
  // unresolved so the editor can repair it; do not silently coerce it into a
  // legal dust or quest path, and do not discard the character on load.
  const issues = blockingCharacterIssues(migrated);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' '));
  return migrated;
}
