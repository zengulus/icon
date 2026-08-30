import { ACTIONS, BONDS, CULTURES, JOBS, KINS, findBond, findBondPower } from './catalog.js';
import { createCharacter, narrativeBudgets, validateCharacter } from './character.js';
import { ACTION_IDS } from './types.js';
import type {
  AbilityDefinition,
  ActionId,
  BondDefinition,
  BondId,
  BondPowerDefinition,
  BondPowerId,
  CultureDefinition,
  CultureId,
  IconCharacter,
  JobDefinition,
  JobClassId,
  KinDefinition,
  KinId,
  ValidationIssue,
} from './types.js';

/**
 * Creation-facing projections for the player-selectable NARRATIVE catalog.
 *
 * These types deliberately carry ONLY identity + display data (`id`, `name`,
 * descriptions, rules text) and never the engine's implementation-status
 * fields (`automation`, `executable`, `structured`, `implemented`,
 * `unresolved`, ...). Selecting an item here means "the player chose source
 * content ID X" — nothing about whether that rule is executable.
 *
 * The underscore-prefixed `Unsafe` types document the projection boundary:
 * they are the structural vulnerable types (which CAN include automation
 * status) that the projection maps AWAY from, so a field can never leak into
 * the creation surface by accident.
 */

type _UnsafeKin = KinDefinition;
type _UnsafeCulture = CultureDefinition;
type _UnsafeBond = BondDefinition;
type _UnsafeBondPower = BondPowerDefinition;

export interface KinOption {
  readonly id: KinDefinition['id'];
  readonly name: KinDefinition['name'];
  readonly description: KinDefinition['description'];
  readonly sourcePage: number;
}

export interface CultureOption {
  readonly id: CultureDefinition['id'];
  readonly name: CultureDefinition['name'];
  readonly description: CultureDefinition['description'];
  readonly sourcePage: number;
}

export interface BondPowerOption {
  readonly id: BondPowerDefinition['id'];
  readonly bondId: BondPowerDefinition['bondId'];
  readonly name: BondPowerDefinition['name'];
  readonly rulesText: BondPowerDefinition['rulesText'];
}

export interface BondOption {
  readonly id: BondDefinition['id'];
  readonly name: BondDefinition['name'];
  readonly summary: BondDefinition['summary'];
  readonly actions: readonly [ActionId, ActionId];
  readonly powers: readonly BondPowerOption[];
  readonly secondWind: BondDefinition['secondWind'];
  readonly specialAbility: BondDefinition['specialAbility'];
  readonly kits: readonly { readonly name: string }[];
  readonly sourcePage: number;
}

export interface ActionOption {
  readonly id: ActionId;
  readonly name: string;
  readonly description: string;
  readonly sourcePage: number;
}

export const kinOptions = (): readonly KinOption[] => KINS.map(({ id, name, description, source }) => ({ id, name, description, sourcePage: source.page }));
export const cultureOptions = (): readonly CultureOption[] => CULTURES.map(({ id, name, description, source }) => ({ id, name, description, sourcePage: source.page }));
export const actionOptions = (): readonly ActionOption[] => ACTIONS.map(({ id, name, description, source }) => ({ id, name, description, sourcePage: source.page }));
export const bondOptions = (): readonly BondOption[] => BONDS.map((bond): BondOption => ({
  id: bond.id,
  name: bond.name,
  summary: bond.summary,
  actions: [bond.actions[0], bond.actions[1]],
  powers: bond.powers.map((power): BondPowerOption => ({ id: power.id, bondId: power.bondId, name: power.name, rulesText: power.rulesText })),
  secondWind: bond.secondWind,
  specialAbility: bond.specialAbility,
  kits: bond.kits.map((kit) => ({ name: kit.name })),
  sourcePage: bond.source.page,
}));

/* ============================================================================
 * LEVEL-0 CREATION MODEL
 * ============================================================================ */

/**
 * The complete set of player-declared NARRATIVE choices for a level-0
 * character (ICON 1.5 p.46). Every value is a canonical catalog ID; no field
 * may ever hold a display label. `additionalActionDots` are the four
 * non-Bond dots (p.46 "Add four additional action dots") and must sum to
 * exactly 4 for a complete creation.
 */
export interface LevelZeroNarrativeSelection {
  readonly kinId: KinId;
  readonly cultureId: CultureId;
  readonly bondId: BondId;
  /** Exactly one starting Bond power (p.46 "Choose one Bond power"). */
  readonly bondPowerId: BondPowerId;
  /** One of the chosen Bond's two actions; it receives the Bond +2 dots. */
  readonly bondActionId: ActionId;
  /** The four additional action dots spread across any Actions. */
  readonly additionalActionDots: Partial<Record<ActionId, number>>;
}

/** The level-0 tactical choices (p.112): exactly one Job and exactly two
 * level-0 (chapter 1) abilities from that Job. */
export interface LevelZeroTacticalSelection {
  readonly jobId: JobDefinition['id'];
  readonly abilityIds: readonly AbilityDefinition['id'][];
}

/** Build the narrative half of a level-0 character onto a fresh record.
 * `identity` (name/pronouns/portrait) is application metadata collected
 * separately and never treated as a source-backed rules selection. */
export function createLevelZeroNarrative(
  identity: { name: string; pronouns?: string; portraitUrl?: string },
  selection: LevelZeroNarrativeSelection,
  now?: string,
): IconCharacter {
  const bond = findBond(selection.bondId);
  if (!bond) throw new Error('Choose a Bond from the ICON 1.5 source catalog.');
  if (!findBondPower(selection.bondPowerId) || findBondPower(selection.bondPowerId)?.bondId !== selection.bondId) {
    throw new Error('The starting Bond power must belong to the chosen Bond.');
  }
  if (!bond.actions.includes(selection.bondActionId)) {
    throw new Error(`The Bond's +2 dots must go to ${bond.actions.join(' or ')}.`);
  }
  const base = createCharacter(now);
  const actions = Object.fromEntries(ACTION_IDS.map((id) => [id, 0])) as IconCharacter['actions'];
  actions[selection.bondActionId] = 2;
  for (const [actionId, dots] of Object.entries(selection.additionalActionDots)) {
    actions[actionId as ActionId] = Math.max(0, (actions[actionId as ActionId] ?? 0) + (dots ?? 0));
  }
  const character: IconCharacter = {
    ...base,
    name: identity.name,
    pronouns: identity.pronouns ?? '',
    portraitUrl: identity.portraitUrl ?? '',
    kinId: selection.kinId,
    cultureId: selection.cultureId,
    bondId: selection.bondId,
    bondActionId: selection.bondActionId,
    bondPowerIds: [selection.bondPowerId],
    actions,
    effort: bond.effort,
    strain: 0,
    level: 0,
    updatedAt: now ?? base.updatedAt,
  };
  const blocking = validateNarrativeCharacter(character);
  if (blocking.length) throw new Error(blocking.map((issue) => issue.message).join(' '));
  return character;
}

/** Apply the level-0 tactical choices (one Job, two chapter-1 abilities from
 * it, p.112/p.115) onto an already-narratively-complete character. */
export function applyLevelZeroTactical(
  character: IconCharacter,
  selection: LevelZeroTacticalSelection,
  now?: string,
): IconCharacter {
  const job = JOBS.find((candidate) => candidate.id === selection.jobId);
  if (!job) throw new Error('Choose a Job from the ICON 1.5 source catalog.');
  if (selection.abilityIds.length !== 2) throw new Error('Level 0 characters choose exactly two starting abilities.');
  const learned = selection.abilityIds.map((abilityId) => {
    const ability = job.abilities.find((candidate) => candidate.id === abilityId);
    if (!ability) throw new Error('Starting abilities must belong to the chosen Job.');
    if (ability.chapter !== 1) throw new Error(`"${ability.name}" is not a level-0 (chapter 1) ability.`);
    return ability;
  });
  const next: IconCharacter = {
    ...character,
    jobs: [job.id],
    primaryJobId: job.id,
    abilities: learned.map((ability) => ({ abilityId: ability.id, talent: null, mastered: false })),
    equippedAbilityIds: [...learned.map((ability) => ability.id)],
    updatedAt: now ?? new Date().toISOString(),
  };
  const blocking = validateCharacter(next).filter(({ severity }) => severity === 'error');
  if (blocking.length) throw new Error(blocking.map((issue) => issue.message).join(' '));
  return next;
}

/** Narrative-only validation for the level-0 creation gate. Deliberately
 * ignores the tactical half (Job/abilities/primary Job), so a narrative-only
 * draft that has not reached the combat gate is a legitimate valid state. */
export function validateNarrativeCharacter(character: IconCharacter): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: 'error' });
  if (!character.kinId) error('kinId', 'required', 'Choose a Kin.');
  else if (!KINS.some((kin) => kin.id === character.kinId)) error('kinId', 'kin.unknown', 'Choose a Kin from the ICON 1.5 source catalog.');
  if (!character.cultureId) error('cultureId', 'required', 'Choose a Culture.');
  else if (!CULTURES.some((culture) => culture.id === character.cultureId)) error('cultureId', 'culture.unknown', 'Choose a Culture from the ICON 1.5 source catalog.');
  const bond = character.bondId ? findBond(character.bondId) : undefined;
  if (!bond) error('bondId', 'required', 'Choose a Bond.');
  if (bond && (!character.bondActionId || !bond.actions.includes(character.bondActionId))) {
    error('bondActionId', 'bond.action', `The Bond's +2 dots go to ${bond.actions.join(' or ')}.`);
  }
  const actionTotal = ACTION_IDS.reduce((sum, id) => sum + character.actions[id], 0);
  for (const id of ACTION_IDS) {
    if (!Number.isInteger(character.actions[id]) || character.actions[id] < 0 || character.actions[id] > 3) {
      error(`actions.${id}`, 'action.range', 'Level 0 action ratings are whole numbers from 0 to 3.');
    }
  }
  if (character.level === 0 && actionTotal !== 6) error('actions', 'action.total', `A level 0 character needs exactly 6 action dots; currently ${actionTotal}.`);
  if (actionTotal > narrativeBudgets(0).fixedActionDots + narrativeBudgets(0).flexibleChoices * 2) {
    error('actions', 'action.budget', 'Action ratings exceed the level 0 budget.');
  }
  if (character.bondPowerIds.length !== 1) error('bondPowerIds', 'bond.power-count', 'A level 0 character chooses exactly one Bond power.');
  if (character.bondPowerIds.some((powerId) => !findBondPower(powerId))) {
    error('bondPowerIds', 'bond.power-unknown', 'One or more Bond powers do not exist in ICON 1.5.');
  }
  if (bond && character.bondPowerIds.some((powerId) => findBondPower(powerId)?.bondId !== bond.id)) {
    error('bondPowerIds', 'bond.power-own', 'A starting Bond power must belong to the chosen Bond.');
  }
  return issues;
}

/* ============================================================================
 * LEVEL-0 TACTICAL CREATION PROJECTION
 * ============================================================================
 *
 * The combat half of creation is deliberately terse and carries ONLY identity
 * + a page reference for each selectable. It never projects the underlying
 * AbilityDefinition's `automation` status, summary/rules text, cost, range,
 * talents, or mastery — the type boundary below guarantees a field cannot
 * accidentally reach the creation surface.
 */

type _UnsafeJob = JobDefinition;
type _UnsafeAbility = AbilityDefinition;

export interface LevelZeroAbilityOption {
  readonly id: AbilityDefinition['id'];
  readonly name: AbilityDefinition['name'];
  /** Always 1 — only chapter 1 abilities are level-0 legal. Kept as a literal
   * `1` so the projection cannot accidentally admit a higher-chapter row. */
  readonly chapter: 1;
  readonly sourcePage: number;
}

export interface LevelZeroJobOption {
  readonly id: JobDefinition['id'];
  readonly name: JobDefinition['name'];
  readonly epithet: JobDefinition['epithet'];
  readonly classId: JobClassId;
  readonly sourcePage: number;
  /** Only the level-0 legal (chapter 1) abilities of this Job. */
  readonly abilities: readonly LevelZeroAbilityOption[];
}

export function levelZeroJobOptions(): readonly LevelZeroJobOption[] {
  return JOBS.map((job): LevelZeroJobOption => ({
    id: job.id,
    name: job.name,
    epithet: job.epithet,
    classId: job.classId,
    sourcePage: job.source.page,
    abilities: job.abilities
      .filter((ability) => ability.chapter === 1)
      .map((ability): LevelZeroAbilityOption => ({
        id: ability.id,
        name: ability.name,
        chapter: 1,
        sourcePage: ability.source.page,
      })),
  }));
}