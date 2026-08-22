import type { RuleSourceUnit } from '../source-units.js';
import type { RuleAction, RuleClauseCompilation, RuleProgramCompilation, RuleTiming } from './types.js';
import { BASTION_ABILITY_PROGRAMS } from './bastion-programs.js';
import { COLOSSUS_ABILITY_PROGRAMS } from './colossus-programs.js';
import { DEMON_SLAYER_ABILITY_PROGRAMS } from './demon-slayer-programs.js';
import { FOOL_ABILITY_PROGRAMS } from './fool-programs.js';
import { FREELANCER_ABILITY_PROGRAMS } from './freelancer-programs.js';
import { KNAVE_ABILITY_PROGRAMS } from './knave-programs.js';
import { SHADE_ABILITY_PROGRAMS } from './shade-programs.js';
import { WARDEN_ABILITY_PROGRAMS } from './warden-programs.js';
import { CHANTER_ABILITY_PROGRAMS } from './chanter-programs.js';
import { HARVESTER_ABILITY_PROGRAMS } from './harvester-programs.js';
import { SEALER_ABILITY_PROGRAMS } from './sealer-programs.js';
import { SEER_ABILITY_PROGRAMS } from './seer-programs.js';
import { ENOCHIAN_ABILITY_PROGRAMS } from './enochian-programs.js';
import { GEOMANCER_ABILITY_PROGRAMS } from './geomancer-programs.js';
import { SPELLBLADE_ABILITY_PROGRAMS } from './spellblade-programs.js';
import { STORMBENDER_ABILITY_PROGRAMS } from './stormbender-programs.js';
import { FOE_ABILITY_RECIPES, compileFoeAbilityRecipe } from './foe-recipes.js';

const coreUseCosts: Record<string, number> = {
  'core:dash': 1,
  'core:interact': 1,
  'core:rescue': 1,
  'core:light-attack': 1,
  'core:heavy-attack': 2,
  'core:recover': 2,
};

const coreUseRules = new Set(['core:standard-move', ...Object.keys(coreUseCosts)]);
const activeClassTraits: Record<string, { cost: number; range: number | null }> = {
  'vagabond:trait:prowl': { cost: 1, range: null },
  'mendicant:trait:diaga': { cost: 1, range: 4 },
  'mendicant:trait:bless': { cost: 1, range: 4 },
};

/**
 * These are the only hand-authored programs that are independently safe to
 * execute through the generic RuleProgram VM.  Other core rules are enforced
 * by dedicated encounter commands or reducer lifecycle code, while the
 * remaining class traits still need a complete typed resolver.  Keeping that
 * distinction here prevents a passive placeholder from being reported as a
 * fully executable source rule.
 */
const independentlyExecutableManualPrograms = new Set([
  'vagabond:trait:skirmisher',
]);

/**
 * Interrupt programs whose trigger is `when-damaged` — damage that has been
 * determined but not yet applied (ICON p.107). While a character with one of
 * these available takes foe damage, the reducer holds the damage unapplied,
 * opens a window carrying it, and applies it after the interrupt resolves (or
 * at the end of the turn). Each entry maps to its interrupt cost: the number
 * of uses the character has per round before the ability must refresh.
 */
export const WHEN_DAMAGED_INTERRUPT_IDS: Readonly<Record<string, { usesPerRound: number }>> = {
  // ICON p.128 Righteous Disdain (Demon Slayer): "damage to your ally has been
  // determined on the foe's end but not applied yet".
  'demon-slayer:righteous-disdain': { usesPerRound: 1 },
};

/**
 * Interrupt programs whose trigger is `uses-ability` — "a foe targets your
 * ally with an ability" (ICON p.107). While the named stance is active and the
 * interrupt is available, the reducer holds the foe ability's effect mutations
 * (its costs already paid), opens a window carrying them, and resolves the
 * interrupt before the ability's effects apply. Keyed by the stance that arms
 * the interrupt; `programId` is the source program the interruptUses counter
 * is tracked under.
 */
export const USES_ABILITY_INTERRUPT_IDS: Readonly<Record<string, { programId: string; usesPerRound: number }>> = {
  // ICON p.122 Endless Battlement (Bastion): while the aura is active, "you can
  // use the following interrupt: Heroic Intervention — Interrupt 1. Trigger: A
  // foe targets your ally with an ability".
  'endless-battlement': { programId: 'bastion:endless-battlement', usesPerRound: 1 },
};

/**
 * Interrupt programs whose trigger is `defeated` — "when you are defeated"
 * (ICON p.107/p.138). While the interrupt is available, a foe blow that would
 * defeat the character is held unapplied so the interrupt resolves first
 * (Boiling Blood arms defy-death; the held blow then lands, keeping the
 * character standing at 1 hp).
 */
export const DEFEATED_INTERRUPT_IDS: Readonly<Record<string, { usesPerRound: number }>> = {
  // ICON p.138 Boiling Blood (Colossus): "Trigger: You are defeated — you
  // fight on, remaining standing at 1 hp".
  'colossus:boiling-blood': { usesPerRound: 1 },
};

/**
 * Interrupt programs whose trigger is `area-inclusion` — "you are included in
 * an allied area effect" (ICON p.107/p.123). While the interrupt is
 * available, an ally's area effect that includes the character is held so the
 * interrupt resolves first (Perseus grants immunity before the effect lands).
 */
export const AREA_INCLUSION_INTERRUPT_IDS: Readonly<Record<string, { usesPerRound: number }>> = {
  // ICON p.123 Perseus (Bastion): "Trigger: You are included in an allied
  // area effect — you release an aura 1 effect and can be immune to any part
  // of the triggering ability".
  'bastion:perseus': { usesPerRound: 2 },
};

/**
 * Interrupt programs whose trigger is `targeted-by-ability` — "a character
 * uses an ability against you" (ICON p.107/p.151). While the interrupt is
 * available, an ability that targets the character is held so the interrupt
 * resolves first; Masquerade swaps places with a willing ally in range 3 and
 * the held effects are retargeted to the ally.
 */
export const TARGETED_BY_ABILITY_INTERRUPT_IDS: Readonly<Record<string, { usesPerRound: number }>> = {
  // ICON p.151 Masquerade (Fool): "Trigger: A character uses an ability
  // against you, and there's a willing ally in range 3 — swap places with
  // your ally and the ability targets your ally instead".
  'fool:masquerade': { usesPerRound: 1 },
};

/**
 * Interrupt programs that re-roll a rolled save — "an enemy adjacent to you
 * rolls a save and you see the result; the enemy must re-roll the save,
 * keeping the second result" (ICON p.143). While the interrupt is available,
 * the reducer holds the save's branch in a `save-rolled` window; the command
 * layer re-rolls and regenerates the branch, which replaces the held one.
 */
export const SAVE_REROLL_INTERRUPT_IDS: Readonly<Record<string, { usesPerRound: number }>> = {
  // ICON p.143 Sucker Punch (Knave).
  'knave:sucker-punch': { usesPerRound: 1 },
};

/**
 * The Bastion ability set (ICON p.122–124) has passed the source-specific
 * resolver + replay-fixture bar. Each entry has a hand-authored typed
 * RuleProgram in bastion-programs.ts whose named resolvers cover shoves,
 * slashes, stances, interrupts, burst areas, and delayed marks. Keeping this
 * explicit allowlist separate from the generic RuleProgram list means a
 * future `automation: "executable"` metadata edit cannot accidentally unlock
 * an ability that lacks an independently reviewed resolver.
 */
export const EXECUTABLE_JOB_ABILITY_IDS: ReadonlySet<string> = new Set([
  'bastion:heracule',
  'bastion:battering-ram',
  'bastion:land-waster',
  'bastion:valiant',
  'bastion:endless-battlement',
  'bastion:catapult',
  'bastion:perseus',
  'bastion:rook',
  'bastion:great-giorgios',
  'demon-slayer:demon-cutter',
  'demon-slayer:comet',
  'demon-slayer:draken-cross',
  'demon-slayer:righteous-disdain',
  'demon-slayer:demon-claw',
  'demon-slayer:gates-of-hell',
  'demon-slayer:soul-blade',
  'demon-slayer:six-hells-trigram',
  'demon-slayer:wicked-sheath',
  'colossus:valkyrie',
  'colossus:upheaval',
  'colossus:dropkick',
  'colossus:massive-overhead',
  'colossus:takedown',
  'colossus:great-suplex',
  'colossus:gigaton-whip',
  'colossus:raging-wolf',
  'colossus:boiling-blood',
  'knave:low-blow',
  'knave:provoke',
  'knave:revenge',
  'knave:riposte',
  'knave:dark-knight',
  'knave:strongarm',
  'knave:intimidate',
  'knave:sucker-punch',
  'knave:bleak-mercy',
  'fool:cavaliere',
  'fool:carnevale',
  'fool:spinning-top',
  'fool:death',
  'fool:gallows-humor',
  'fool:party-favor',
  'fool:masquerade',
  'fool:diablo',
  'fool:chronotemper',
  'freelancer:strafe-shot',
  'freelancer:exorcism',
  'freelancer:trick-shot',
  'freelancer:astral-chain',
  'freelancer:deus-ex-machina',
  'freelancer:ace',
  'freelancer:showdown',
  'freelancer:warding-bolts',
  'freelancer:soul-shot',
  'shade:umbra',
  'shade:harrow',
  'shade:death-blossom',
  'shade:nightmare',
  'shade:shadow-play',
  'shade:umbral-echo',
  'shade:assassinate',
  'shade:nocturne',
  'shade:incubus',
  'warden:apex',
  'warden:gwynt',
  'warden:circle-the-oak',
  'warden:mist-strider',
  'warden:stampede',
  'warden:strength-of-the-pack',
  'warden:underway',
  'warden:morrigan',
  'warden:sidhe',
  'chanter:holy',
  'chanter:felicity',
  'chanter:pandaemonium',
  'chanter:aria',
  'chanter:dervish',
  'chanter:symphony',
  'chanter:gentleness',
  'chanter:monogatari',
  'chanter:chastise',
  'harvester:sow',
  'harvester:growing-season',
  'harvester:gravebirth',
  'harvester:harvest',
  'harvester:blood-grove',
  'harvester:rot',
  'harvester:crimson-bloom',
  'harvester:fairy-ring',
  'harvester:dark-sliver',
  'sealer:god-hand',
  'sealer:grand-seal',
  'sealer:matsuri',
  'sealer:spirit-shrine',
  'sealer:sanctify',
  'sealer:grand-banishment',
  'sealer:divine-aegis',
  'sealer:justice',
  'sealer:open-the-gates',
  'seer:sleight-of-hand',
  'seer:chaos-tarot',
  'seer:astra',
  'seer:polaris',
  'seer:sisyphus',
  'seer:gran-reversa',
  'seer:eclipse',
  'seer:wish',
  'seer:the-tower',
  'enochian:pyre',
  'enochian:elden-rune',
  'enochian:lance',
  'enochian:soul-burn',
  'enochian:blazing-bond',
  'enochian:aethershard',
  'enochian:implode',
  'enochian:pyroclast',
  'enochian:blackstar',
  'geomancer:bio',
  'geomancer:dragon-dive',
  'geomancer:geo',
  'geomancer:helix-heel',
  'geomancer:terraforming',
  'geomancer:obsidian-flesh',
  'geomancer:realignment',
  'geomancer:midas',
  'geomancer:quaking-palm',
  'spellblade:blitz',
  'spellblade:odinforce',
  'spellblade:nothung',
  'spellblade:atherwand',
  'spellblade:fulminate',
  'spellblade:bifrost',
  'spellblade:rampant-nail',
  'spellblade:sturmreiten',
  'spellblade:drifting-leaf',
  'stormbender:rime',
  'stormbender:tsunami',
  'stormbender:cryo',
  'stormbender:geyser',
  'stormbender:gust',
  'stormbender:heave-ho',
  'stormbender:deepwrath',
  'stormbender:waterspout',
  'stormbender:eye-of-the-storm',
]);

/** The reviewed foe-ability slices have passed the same source-specific
 * resolver + replay-fixture bar as the job sets. Each entry is one
 * declarative FoeRecipe in foe-recipes.ts (Crusher p.301, Warrior p.300,
 * Soldier p.300, Brute p.300, Pepperbox p.302, Hunter p.302); the generic
 * factories compile the recipe into a typed RuleProgram and its named
 * deterministic resolver — no per-ability resolver code. */
export const EXECUTABLE_FOE_ABILITY_IDS: ReadonlySet<string> = new Set(Object.keys(FOE_ABILITY_RECIPES));

/** Every independently executable ability is also independently executable
 * through the generic RuleProgram VM (EXECUTE_RULE), which is how triggered
 * steps such as Collide/Heroic and stance refresh are activated. */
for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) independentlyExecutableManualPrograms.add(abilityId);
for (const foeld of EXECUTABLE_FOE_ABILITY_IDS) independentlyExecutableManualPrograms.add(foeld);

const independentlyExecutableAbilityIds = new Set<string>(EXECUTABLE_JOB_ABILITY_IDS);

export function isIndependentlyExecutableManualProgram(sourceId: string) {
  return independentlyExecutableManualPrograms.has(sourceId);
}

export function isIndependentlyExecutableAbility(abilityId: string) {
  return independentlyExecutableAbilityIds.has(abilityId);
}

export function compileManualRuleProgram(unit: RuleSourceUnit): RuleProgramCompilation | null {
  if (unit.kind === 'job-ability') {
    const bastion = BASTION_ABILITY_PROGRAMS[unit.id];
    if (bastion) return bastion(unit);
    const demonSlayer = DEMON_SLAYER_ABILITY_PROGRAMS[unit.id];
    if (demonSlayer) return demonSlayer(unit);
    const colossus = COLOSSUS_ABILITY_PROGRAMS[unit.id];
    if (colossus) return colossus(unit);
    const knave = KNAVE_ABILITY_PROGRAMS[unit.id];
    if (knave) return knave(unit);
    const fool = FOOL_ABILITY_PROGRAMS[unit.id];
    if (fool) return fool(unit);
    const freelancer = FREELANCER_ABILITY_PROGRAMS[unit.id];
    if (freelancer) return freelancer(unit);
    const shade = SHADE_ABILITY_PROGRAMS[unit.id];
    if (shade) return shade(unit);
    const warden = WARDEN_ABILITY_PROGRAMS[unit.id];
    if (warden) return warden(unit);
    const chanter = CHANTER_ABILITY_PROGRAMS[unit.id];
    if (chanter) return chanter(unit);
    const harvester = HARVESTER_ABILITY_PROGRAMS[unit.id];
    if (harvester) return harvester(unit);
    const sealer = SEALER_ABILITY_PROGRAMS[unit.id];
    if (sealer) return sealer(unit);
    const seer = SEER_ABILITY_PROGRAMS[unit.id];
    if (seer) return seer(unit);
    const enochian = ENOCHIAN_ABILITY_PROGRAMS[unit.id];
    if (enochian) return enochian(unit);
    const geomancer = GEOMANCER_ABILITY_PROGRAMS[unit.id];
    if (geomancer) return geomancer(unit);
    const spellblade = SPELLBLADE_ABILITY_PROGRAMS[unit.id];
    if (spellblade) return spellblade(unit);
    const stormbender = STORMBENDER_ABILITY_PROGRAMS[unit.id];
    return stormbender ? stormbender(unit) : null;
  }
  if (unit.kind === 'foe-ability') {
    const recipe = FOE_ABILITY_RECIPES[unit.id];
    return recipe ? compileFoeAbilityRecipe(unit, recipe) : null;
  }
  if (unit.kind !== 'core' && unit.kind !== 'class-trait') return null;
  const classActivation = activeClassTraits[unit.id];
  const timing: RuleTiming = unit.kind === 'core' ? coreUseRules.has(unit.id) ? 'use' : 'passive' : classActivation ? 'use' : 'passive';
  const cost = unit.kind === 'core' ? coreUseCosts[unit.id] ?? 0 : classActivation?.cost ?? 0;
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing,
    costs: cost ? [{ kind: 'action', amount: { kind: 'constant', value: cost } }] : [],
    tags: unit.id === 'core:light-attack' || unit.id === 'core:heavy-attack' ? ['attack'] : [],
    range: unit.kind === 'class-trait' ? classActivation?.range === null || classActivation?.range === undefined ? null : { kind: 'constant', value: classActivation.range } : unit.id === 'core:interact' || unit.id === 'core:rescue' ? { kind: 'constant', value: 1 } : null,
    area: null,
    choices: [],
    resolverId: unit.id,
    steps: [],
  };
  const clause: RuleClauseCompilation = {
    id: `${unit.id}:clause:1`,
    label: timing,
    text: unit.rulesText,
    effects: [],
    complete: isIndependentlyExecutableManualProgram(unit.id),
    unsupportedText: isIndependentlyExecutableManualProgram(unit.id)
      ? ''
      : unit.kind === 'core'
        ? 'Implemented by a dedicated encounter reducer path; it has no complete generic RuleProgram resolver yet.'
        : 'Class trait requires a complete typed resolver before it can execute through the generic RuleProgram VM.',
  };
  return {
    program: {
      schemaVersion: 1,
      rulesVersion: '1.5',
      id: `program:${unit.id}`,
      sourceId: unit.id,
      source: unit.source,
      name: unit.name,
      actions: [action],
      dependencies: [],
      classification: 'encounter',
    },
    clauses: [clause],
    unsupportedClauses: clause.complete ? [] : [clause],
  };
}
