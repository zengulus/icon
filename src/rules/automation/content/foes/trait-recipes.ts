import { durableFoeTraitGrantConditions, registerFoeTraitKeywordRecipes } from '../../kernels/foe-trait-recipes.js';
import { registerCombatStartTraitRecipe } from '../../kernels/lifecycle.js';
import type { FoeTraitKeywordEffect, FoeTraitKeywordRecipe } from '../../kernels/foe-trait-recipes.js';

/**
 * Closed foe-trait keyword manifest (ICON p.298 glossary + p.104 positive
 * effects). Foe `special-traits`/`traits` rows are comma-separated keyword
 * lists; every registered row below was reviewed against its exact source ID
 * and text. The rows register into the `kernels/foe-trait-recipes.ts`
 * projection registry on import.
 *
 * A row is fully executable (audits complete, `automation: 'executable'`)
 * only when every keyword maps to a wired mechanic: a consumed condition
 * (p.104), a consumed stat (Armor/Speed), or a p.298 role baseline. Keywords
 * with no wired engine path yet — Counter's "damaged by an ability" window,
 * Diaga's active Leader cure, the p.92 Size footprint — are registered as
 * `pending` so the row's other keywords still project while the audit stays
 * honestly incomplete.
 *
 * Deliberately absent (no projection, no row): prose rows that are not pure
 * keyword lists (Elite/Legend suffixes, `Enrage`, `Mob`, `Shelter`,
 * `Phasing. This trait also transfers to a rider`), and rows whose only
 * keywords are unwired (Counter-only rows such as howler/war-beast). They
 * stay source-visible with their kernel need in `docs/kernels-needed.md`.
 */

const SIZE_FOOTPRINT_PENDING = 'Size footprint (p.92) is not enforced yet (F1 footprint matrix pending).';
const COUNTER_PENDING = 'Counter needs a durable "damaged by an ability" damage window (p.104, F4 provenance).';
const DIAGA_PENDING = 'Diaga is the Leader role active cure ability (p.298), not a passive projection.';

const cond = (keyword: string, condition = keyword.toLocaleLowerCase()): FoeTraitKeywordEffect => ({
  kind: 'condition',
  keyword,
  condition,
});
/** A consumable positive condition (p.104 Defiance) granted durably at
 * combat start, never projected (a projection would resurrect it after the
 * damage kernel consumed it). */
const durable = (keyword: string, condition: string): FoeTraitKeywordEffect => ({
  kind: 'durable',
  keyword,
  condition,
});
const stat = (keyword: string, stat: 'size' | 'armor' | 'speed', value: number, pending?: string): FoeTraitKeywordEffect => ({
  kind: 'stat',
  keyword,
  stat,
  value,
  pending,
});
const role = (keyword: string, roleId: 'heavy'): FoeTraitKeywordEffect => ({ kind: 'role', keyword, roleId });
const pending = (keyword: string, note: string): FoeTraitKeywordEffect => ({ kind: 'pending', keyword, note });

const row = (sourceId: string, effects: readonly FoeTraitKeywordEffect[]): FoeTraitKeywordRecipe => ({ sourceId, effects });

/**
 * The reviewed manifest, keyed by exact source trait ID. Keyword lists are
 * transcribed exactly from the source artifact (including artifacts such as
 * `S ize 3`, lowercase `sturdy`/`size 2`, and a trailing `Regeneration.`
 * period): the compiler requires the source text to parse to exactly these
 * keywords, so a row can never fire on un-reviewed text.
 */
export const FOE_TRAIT_KEYWORD_RECIPES: Readonly<Record<string, FoeTraitKeywordRecipe>> = {
  // ── Basic jobs (p.300–311) ────────────────────────────────────────────────
  'basic:impaler:300:trait:special-traits': row('basic:impaler:300:trait:special-traits', [cond('Sturdy')]),
  'basic:brute:300:trait:special-traits': row('basic:brute:300:trait:special-traits', [
    cond('Sturdy'),
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'basic:berserker:301:trait:special-traits': row('basic:berserker:301:trait:special-traits', [durable('Defiance', 'defiance')]),
  'basic:crusher:301:trait:special-traits': row('basic:crusher:301:trait:special-traits', [cond('Sturdy')]),
  'basic:hellion:302:trait:special-traits': row('basic:hellion:302:trait:special-traits', [cond('Flying')]),
  'basic:shadow:303:trait:special-traits': row('basic:shadow:303:trait:special-traits', [cond('Phasing')]),
  'basic:priest:303:trait:special-traits': row('basic:priest:303:trait:special-traits', [durable('Defiance', 'defiance')]),
  'basic:storm-caller:306:trait:special-traits': row('basic:storm-caller:306:trait:special-traits', [cond('Flying')]),
  'basic:chaos-wright:306:trait:special-traits': row('basic:chaos-wright:306:trait:special-traits', [cond('Phasing')]),
  'basic:archon:308:trait:special-traits': row('basic:archon:308:trait:special-traits', [cond('Sturdy')]),
  'basic:crucible:309:trait:special-traits': row('basic:crucible:309:trait:special-traits', [cond('Flying')]),
  'basic:demolisher:310:trait:special-traits': row('basic:demolisher:310:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
    cond('Sturdy'),
  ]),
  'basic:nocturnal:310:trait:special-traits': row('basic:nocturnal:310:trait:special-traits', [cond('Skirmisher')]),
  // ── Relict (p.324–344) ────────────────────────────────────────────────────
  'relict:legionary:326:trait:traits': row('relict:legionary:326:trait:traits', [cond('Sturdy')]),
  'relict:necrosavant:326:trait:special-traits': row('relict:necrosavant:326:trait:special-traits', [durable('Defiance', 'defiance')]),
  'relict:grafter:327:trait:special-traits': row('relict:grafter:327:trait:special-traits', [cond('Regeneration')]),
  'relict:ghul:327:trait:special-traits': row('relict:ghul:327:trait:special-traits', [cond('Phasing')]),
  'relict:devourer:328:trait:traits': row('relict:devourer:328:trait:traits', [durable('Defiance', 'defiance')]),
  'relict:wraith:328:trait:special-traits': row('relict:wraith:328:trait:special-traits', [cond('Flying'), cond('Phasing')]),
  'relict:silent-one:330:trait:special-traits': row('relict:silent-one:330:trait:special-traits', [durable('Defiance', 'defiance')]),
  'relict:strigoi:330:trait:special-traits': row('relict:strigoi:330:trait:special-traits', [cond('Phasing')]),
  'relict:automata:330:trait:special-traits': row('relict:automata:330:trait:special-traits', [cond('Sturdy')]),
  'relict:fused:330:trait:special-traits': row('relict:fused:330:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'relict:idol:331:trait:special-traits': row('relict:idol:331:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
    cond('Sturdy'),
  ]),
  'relict:life-hunter:331:trait:special-traits': row('relict:life-hunter:331:trait:special-traits', [cond('Phasing')]),
  'relict:immortal:332:trait:special-traits': row('relict:immortal:332:trait:special-traits', [cond('Sturdy'), durable('Defiance', 'defiance')]),
  'relict:warmech:333:trait:special-traits': row('relict:warmech:333:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
    cond('Sturdy'),
  ]),
  'relict:izenghast:333:trait:special-traits': row('relict:izenghast:333:trait:special-traits', [cond('Phasing')]),
  'relict:arkitek:333:trait:special-traits': row('relict:arkitek:333:trait:special-traits', [durable('Defiance', 'defiance')]),
  'relict:atrophic-grave:334:trait:special-traits': row('relict:atrophic-grave:334:trait:special-traits', [
    durable('Defiance', 'defiance'),
    cond('Sturdy'),
    stat('Size 3', 'size', 3, SIZE_FOOTPRINT_PENDING),
  ]),
  'relict:lord-evictor:341:trait:special-traits': row('relict:lord-evictor:341:trait:special-traits', [
    cond('Sturdy'),
    cond('Rampart'),
    stat('Armor 2', 'armor', 2),
  ]),
  'relict:lord-prelictor:342:trait:special-traits': row('relict:lord-prelictor:342:trait:special-traits', [cond('Aetherwall')]),
  'relict:lord-vexator:342:trait:special-traits': row('relict:lord-vexator:342:trait:special-traits', [cond('Skirmisher'), cond('Dodge')]),
  // ── Ruin Beast (p.345–365) ────────────────────────────────────────────────
  'ruin-beast:horned-rooter:346:trait:special-traits': row('ruin-beast:horned-rooter:346:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'ruin-beast:baggoth:347:trait:special-traits': row('ruin-beast:baggoth:347:trait:special-traits', [
    // p.347 source artifact: "S ize 3" (extra space) means Size 3.
    stat('S ize 3', 'size', 3, SIZE_FOOTPRINT_PENDING),
    stat('Speed 2', 'speed', 2),
    cond('Sturdy'),
  ]),
  'ruin-beast:aetherachnid:347:trait:special-traits': row('ruin-beast:aetherachnid:347:trait:special-traits', [cond('Phasing')]),
  'ruin-beast:dungeon-jelly:348:trait:special-traits': row('ruin-beast:dungeon-jelly:348:trait:special-traits', [cond('Flying')]),
  'ruin-beast:ironfeather:350:trait:special-traits': row('ruin-beast:ironfeather:350:trait:special-traits', [cond('Flying')]),
  'ruin-beast:harpy:350:trait:special-traits': row('ruin-beast:harpy:350:trait:special-traits', [cond('Flying')]),
  'ruin-beast:barghest:351:trait:special-traits': row('ruin-beast:barghest:351:trait:special-traits', [cond('Phasing')]),
  'ruin-beast:canoptic-swarm:351:trait:special-traits': row('ruin-beast:canoptic-swarm:351:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'ruin-beast:bonabra:352:trait:special-traits': row('ruin-beast:bonabra:352:trait:special-traits', [
    stat('Size 3', 'size', 3, SIZE_FOOTPRINT_PENDING),
  ]),
  'ruin-beast:megacrab:352:trait:special-traits': row('ruin-beast:megacrab:352:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
    stat('Armor 10', 'armor', 10),
  ]),
  'ruin-beast:floatfish:353:trait:special-traits': row('ruin-beast:floatfish:353:trait:special-traits', [cond('Flying')]),
  'ruin-beast:doomcloak:353:trait:special-traits': row('ruin-beast:doomcloak:353:trait:special-traits', [
    cond('Flying'),
    cond('Sturdy'),
    pending('Counter', COUNTER_PENDING),
    durable('Defiance', 'defiance'),
  ]),
  'ruin-beast:hellhound:354:trait:special-traits': row('ruin-beast:hellhound:354:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'ruin-beast:kinfisher:355:trait:special-traits': row('ruin-beast:kinfisher:355:trait:special-traits', [
    cond('Immobile'),
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'ruin-beast:basilisk:355:trait:special-traits': row('ruin-beast:basilisk:355:trait:special-traits', [cond('Phasing')]),
  'ruin-beast:gigantapede:356:trait:special-traits': row('ruin-beast:gigantapede:356:trait:special-traits', [durable('Defiance', 'defiance'), cond('Sturdy')]),
  'ruin-beast:i-chimaera:357:trait:special-traits': row('ruin-beast:i-chimaera:357:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'ruin-beast:ii-apex:359:trait:special-traits': row('ruin-beast:ii-apex:359:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  // ── Scavenger (p.366–386) ─────────────────────────────────────────────────
  'scavenger:splitter:368:trait:special-traits': row('scavenger:splitter:368:trait:special-traits', [cond('Sturdy')]),
  'scavenger:nightcloak:369:trait:traits': row('scavenger:nightcloak:369:trait:traits', [cond('Phasing')]),
  'scavenger:blood-broker:370:trait:special-traits': row('scavenger:blood-broker:370:trait:special-traits', [cond('Regeneration')]),
  'scavenger:tollkin:372:trait:special-traits': row('scavenger:tollkin:372:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'scavenger:scum:372:trait:special-traits': row('scavenger:scum:372:trait:special-traits', [cond('Dodge')]),
  'scavenger:aurelian:373:trait:special-traits': row('scavenger:aurelian:373:trait:special-traits', [durable('Defiance', 'defiance')]),
  'scavenger:mondo:373:trait:special-traits': row('scavenger:mondo:373:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
    // p.373 source artifact: lowercase "sturdy".
    cond('sturdy'),
  ]),
  'scavenger:boots:380:trait:traits': row('scavenger:boots:380:trait:traits', [role('Guard', 'heavy')]),
  'scavenger:fixer:380:trait:traits': row('scavenger:fixer:380:trait:traits', [role('Guard', 'heavy')]),
  'scavenger:filth:381:trait:traits': row('scavenger:filth:381:trait:traits', [cond('Skirmisher'), cond('Dodge')]),
  'scavenger:cats:381:trait:traits': row('scavenger:cats:381:trait:traits', [cond('Skirmisher'), cond('Dodge')]),
  'scavenger:pale:381:trait:traits': row('scavenger:pale:381:trait:traits', [cond('Skirmisher'), cond('Dodge')]),
  'scavenger:sharp:381:trait:traits': row('scavenger:sharp:381:trait:traits', [cond('Aetherwall'), cond('Slip')]),
  'scavenger:fanatic:381:trait:traits': row('scavenger:fanatic:381:trait:traits', [cond('Aetherwall'), cond('Slip')]),
  'scavenger:broker:381:trait:traits': row('scavenger:broker:381:trait:traits', [
    pending('Diaga', DIAGA_PENDING),
    durable('Defiance', 'defiance'),
  ]),
  // ── Imperial (p.387–405) ──────────────────────────────────────────────────
  'imperial:hessian:389:trait:special-traits': row('imperial:hessian:389:trait:special-traits', [cond('Sturdy')]),
  'imperial:iron-soldat:393:trait:special-traits': row('imperial:iron-soldat:393:trait:special-traits', [cond('Sturdy')]),
  'imperial:clank:393:trait:special-traits': row('imperial:clank:393:trait:special-traits', [durable('Defiance', 'defiance')]),
  'imperial:gear-walker:394:trait:special-traits': row('imperial:gear-walker:394:trait:special-traits', [cond('Sturdy')]),
  'imperial:battle-wagon:396:trait:special-traits': row('imperial:battle-wagon:396:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
    cond('Sturdy'),
  ]),
  'imperial:i-crimson-weapon:398:trait:traits': row('imperial:i-crimson-weapon:398:trait:traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  // ── Demon (p.406–427) ─────────────────────────────────────────────────────
  'demon:armor-demon:408:trait:special-traits': row('demon:armor-demon:408:trait:special-traits', [cond('Sturdy')]),
  'demon:horn-demon:408:trait:traits': row('demon:horn-demon:408:trait:traits', [cond('Regeneration')]),
  'demon:smoke-demon:410:trait:traits': row('demon:smoke-demon:410:trait:traits', [cond('Phasing'), cond('Flying')]),
  'demon:bulging-demon:410:trait:special-traits': row('demon:bulging-demon:410:trait:special-traits', [cond('Regeneration')]),
  'demon:warping-demon:410:trait:special-traits': row('demon:warping-demon:410:trait:special-traits', [cond('Flying')]),
  'demon:chaos-demon:411:trait:special-traits': row('demon:chaos-demon:411:trait:special-traits', [cond('Flying')]),
  'demon:feathered-demon:411:trait:special-traits': row('demon:feathered-demon:411:trait:special-traits', [cond('Flying')]),
  'demon:gazer:413:trait:special-traits': row('demon:gazer:413:trait:special-traits', [cond('Flying')]),
  'demon:lesser-emissary:414:trait:special-traits': row('demon:lesser-emissary:414:trait:special-traits', [cond('Flying')]),
  'demon:greater-emissary:415:trait:special-traits': row('demon:greater-emissary:415:trait:special-traits', [cond('Flying')]),
  'demon:judicator-demon:415:trait:special-traits': row('demon:judicator-demon:415:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'demon:limb-demon:417:trait:special-traits': row('demon:limb-demon:417:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'demon:ii-violence-demon:420:trait:special-traits': row('demon:ii-violence-demon:420:trait:special-traits', [cond('Skirmisher')]),
  'demon:iii-majesty-demon:422:trait:special-traits': row('demon:iii-majesty-demon:422:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  // ── Lowlander (p.428–447) ─────────────────────────────────────────────────
  'lowlander:slab:430:trait:special-traits': row('lowlander:slab:430:trait:special-traits', [durable('Defiance', 'defiance')]),
  'lowlander:mycowright:433:trait:special-traits': row('lowlander:mycowright:433:trait:special-traits', [cond('Regeneration')]),
  'lowlander:black-mead-brewer:434:trait:traits': row('lowlander:black-mead-brewer:434:trait:traits', [durable('Defiance', 'defiance'), cond('Regeneration')]),
  'lowlander:swarm-wright:434:trait:traits': row('lowlander:swarm-wright:434:trait:traits', [cond('Flying'), cond('Phasing')]),
  'lowlander:riding-insect:435:trait:special-traits': row('lowlander:riding-insect:435:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'lowlander:clot:436:trait:special-traits': row('lowlander:clot:436:trait:special-traits', [durable('Defiance', 'defiance')]),
  'lowlander:sage-snail:436:trait:special-traits': row('lowlander:sage-snail:436:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'lowlander:battle-beetle:437:trait:special-traits': row('lowlander:battle-beetle:437:trait:special-traits', [
    cond('Sturdy'),
    stat('Size 3', 'size', 3, SIZE_FOOTPRINT_PENDING),
  ]),
  // ── Jotunn (p.448–466) ────────────────────────────────────────────────────
  'jotunn:hirsinn:449:trait:special-traits': row('jotunn:hirsinn:449:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
    cond('Sturdy'),
  ]),
  'jotunn:bloody-companion:450:trait:special-traits': row('jotunn:bloody-companion:450:trait:special-traits', [durable('Defiance', 'defiance'), cond('Regeneration')]),
  'jotunn:elemental:450:trait:special-traits': row('jotunn:elemental:450:trait:special-traits', [
    cond('Phasing'),
    // p.450 source artifact: lowercase "size 2".
    stat('size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'jotunn:mistral:451:trait:traits': row('jotunn:mistral:451:trait:traits', [cond('Flying')]),
  'jotunn:quintessent:452:trait:traits': row('jotunn:quintessent:452:trait:traits', [cond('Flying')]),
  'jotunn:troll:452:trait:special-traits': row('jotunn:troll:452:trait:special-traits', [
    // p.452 source artifact: trailing period. The reviewed keyword keeps the
    // artifact; the projected condition id is the canonical `regeneration`
    // consumed by the turn-end lifecycle.
    cond('Regeneration.', 'regeneration'),
  ]),
  'jotunn:starblood:454:trait:special-traits': row('jotunn:starblood:454:trait:special-traits', [cond('Flying')]),
  'jotunn:watcher:454:trait:traits': row('jotunn:watcher:454:trait:traits', [cond('Phasing')]),
  'jotunn:i-rider-of-the-primal-storm:459:trait:special-traits': row('jotunn:i-rider-of-the-primal-storm:459:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'jotunn:ii-keeper-of-the-eldflame:460:trait:special-traits': row('jotunn:ii-keeper-of-the-eldflame:460:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'jotunn:iii-warden-of-the-aeongate:463:trait:special-traits': row('jotunn:iii-warden-of-the-aeongate:463:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  // ── Hob (p.467–490) ───────────────────────────────────────────────────────
  'hob:spirit-hob:470:trait:special-traits': row('hob:spirit-hob:470:trait:special-traits', [cond('Phasing')]),
  'hob:eaves-hob:472:trait:traits': row('hob:eaves-hob:472:trait:traits', [cond('Flying')]),
  'hob:pixie:473:trait:traits': row('hob:pixie:473:trait:traits', [cond('Flying')]),
  'hob:floating-petal-aesi:474:trait:special-traits': row('hob:floating-petal-aesi:474:trait:special-traits', [cond('Phasing')]),
  'hob:greenkeeper:477:trait:special-traits': row('hob:greenkeeper:477:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'hob:great-boulder-hob:477:trait:special-traits': row('hob:great-boulder-hob:477:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'hob:wissan:479:trait:special-traits': row('hob:wissan:479:trait:special-traits', [cond('Phasing')]),
  'hob:white-beast:480:trait:special-traits': row('hob:white-beast:480:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'hob:summer-flame-aesi:481:trait:special-traits': row('hob:summer-flame-aesi:481:trait:special-traits', [
    stat('Size 2', 'size', 2, SIZE_FOOTPRINT_PENDING),
  ]),
  'hob:deep-snow-aesi:487:trait:special-traits': row('hob:deep-snow-aesi:487:trait:special-traits', [cond('Flying')]),
};

registerFoeTraitKeywordRecipes(FOE_TRAIT_KEYWORD_RECIPES);

// Consumable p.104 conditions (Defiance) are granted durably at combat start
// through the same F6 combat-start recipe registry the Job traits use — never
// projected, so the damage kernel's consumption is not resurrected by the
// next condition-set fold. Idempotent and replay-safe (ENCOUNTER_STARTED).
for (const [sourceId, recipe] of Object.entries(FOE_TRAIT_KEYWORD_RECIPES)) {
  const grants = durableFoeTraitGrantConditions(sourceId);
  if (grants.length > 0) registerCombatStartTraitRecipe(sourceId, { grantConditions: [...grants] });
}
