import { RuleProgramViolation } from './runtime.js';
import type { RuleSourceUnit } from '../source-units.js';
import type { Position } from '../types.js';
import type {
  RuleActorView,
  RuleCost,
  RuleExecutionContext,
  RuleMutation,
  RuleProgramCompilation,
  RuleResolver,
  RuleResolverRegistry,
  RuleTiming,
} from './types.js';
import {
  axisDirection, sameCell, squareArea,
  constant, distance, sourceActor, walk, freeCellsInRange, rushTowardFoes, resolveAttack,
  conditionMutation, markMutation, rushMutation, shoveMutation, terrainMutation, vigorMutation,
  action, compilation,
} from './foe-kit.js';
import { adjacentActors } from './foe-kit.js';

/**
 * foe-recipes.ts — the genericised foe ability layer.
 *
 * The 1,365 source `foe-ability` units are built from a small vocabulary of
 * recurring mechanics (canonical "On hit: [D]+fray / Miss: fray" attacks,
 * shoves, rushes, marks, blasts, terrain, self-buffs). Instead of a
 * hand-authored resolver per ability, each ability is one declarative
 * `FoeRecipe` entry below; the generic factories in this file turn the recipe
 * into deterministic mutations. Adding a new foe slice is therefore a data
 * change (plus a replay fixture), not resolver code.
 *
 * The recipes still meet the project's executability bar per ability: typed
 * costs (from the source catalog), typed range, source-derived tags, explicit
 * hit/miss/critical behavior, and a named deterministic resolver
 * (`<abilityId>:effects`, built by `FOE_RULE_RESOLVERS`). The full source text
 * is preserved on every event via the clause labels.
 *
 * Fidelity conventions (kept on the recipes themselves as comments):
 * - Deterministic defaults are taken where the source offers a GM choice
 *   ("either … or …", "may …"); the unchosen branch is documented table-facing
 *   in `docs/rules-coverage.md` and on the recipe comment.
 * - Bonus damage (p.102) rolls one extra [D] and keeps the higher result;
 *   critical hits add one extra [D] (the generic VM convention).
 * - The reducer's attack gate runs before a resolver, so a recipe attack's
 *   `range` is the pre-move gate; `preRush` (Backbreaker's optional rush 2)
 *   is resolved inside the resolver and re-validated from the landing cell.
 * - "Repeatable" and "end turn" tags are recorded on the program; the foe
 *   turn still advances via the normal END_TURN command (same as jobs).
 */

// ── Amounts ──────────────────────────────────────────────────────────────────
/** A damage formula rolled against the source's damage die / fray. */
export type FoeAmount =
  | { kind: 'die'; count?: number }
  | { kind: 'die-fray'; count?: number }
  | { kind: 'die-fixed'; count: number; fixed: number }
  | { kind: 'fray' }
  | { kind: 'fixed'; value: number };

interface FoeRecipeBase {
  /** Clause labels declared complete for the audit (mirror the source text). */
  clauses: string[];
  /** Range gate for the reducer attack check and resolver positional checks.
   * Defaults to the source catalog range, then 1 for adjacency-targeting. */
  range?: number | null;
}

// ── Recipes ──────────────────────────────────────────────────────────────────
export interface FoeAttackRecipe extends FoeRecipeBase {
  kind: 'attack';
  hit: FoeAmount;
  /** Fixed multi-instance damage (Pepperbox Riddle: 3 damage, three times). */
  hitInstances?: number;
  miss?: FoeAmount;
  /** Attack: Autohit skips the d20/boon/Evasion roll, but not the shared
   * direct-target legality gate (range, Stealth, and line of sight). */
  autoHit?: boolean;
  trueStrike?: boolean;
  boons?: number;
  /** ICON p.104 Pierce applies to every damage instance from this attack. */
  damageType?: 'normal' | 'piercing' | 'divine';
  /** Ignore cover on all damage from this ability (tagged unerring). */
  unerring?: boolean;
  /** Ignore cover when the target holds this mark owned by the attacker. */
  unerringWhenMarked?: string;
  /** p.102 bonus damage: an extra [D], keep the higher result, when the
   * target has a condition or (optionally) a mark owned by the attacker. */
  bonusDamage?: { condition?: string; mark?: string };
  hitConditions?: string[];
  /** Conditions declared by an `Effect:` clause after the attack resolve on
   * either a hit or a miss (Chaos Shard, p.306). */
  effectConditions?: string[];
  hitShove?: number;
  hitMark?: string;
  /** All foes adjacent to the source or the attack target take this damage. */
  splash?: { amount: FoeAmount };
  /** Conditional effect when the target is at exactly this range. */
  atRange?: { range: number; unerring?: boolean; conditions?: string[] };
  /** Effect against bloodied targets (Hunter shot: shove 1 + dazed). */
  bloodiedEffect?: { shove?: number; conditions?: string[] };
  /** Rush toward the target before the attack (Backbreaker's optional rush 2,
   * taken deterministically; re-validated from the landing cell). */
  preRush?: number;
}

export interface FoeShoveRecipe extends FoeRecipeBase {
  kind: 'shove';
  distance: number;
  damage?: FoeAmount | number;
  /** Conditions applied when the shove is stopped by an obstruction
   * (Hurl: "Collide: Character is weakened"). */
  collideConditions?: string[];
}

export interface FoeRushRecipe extends FoeRecipeBase {
  kind: 'rush';
  distance: number;
  /** Deterministically weaken the first adjacent foe after the rush
   * (Bull rush's "either weakened or shoved 1"). */
  endWeaken?: boolean;
  direction?: 'toward-nearest-foe' | Position;
}

export interface FoeVigorRecipe extends FoeRecipeBase {
  kind: 'vigor';
  amount: number;
  /** Amount instead when bloodied (Brute Bulk up: 6 if bloodied). */
  bloodiedAmount?: number;
}

export interface FoeMarkRecipe extends FoeRecipeBase {
  kind: 'mark';
  markId: string;
}

export interface FoeSwapRecipe extends FoeRecipeBase {
  kind: 'swap';
}

export interface FoeDashStrikeRecipe extends FoeRecipeBase {
  kind: 'dash-strike';
  dash: number;
  damage: FoeAmount | number;
  /** Hit range measured from the post-dash position. */
  range: number;
}

export interface FoeBlastRecipe extends FoeRecipeBase {
  kind: 'blast';
  shape: 'small' | 'medium' | 'large';
  damage: FoeAmount | number;
  instances?: number;
  conditions?: string[];
  /** Allies (and the source) in the area gain stealth (Pepperbox Flash Bomb). */
  alliesStealth?: boolean;
  alliesVigor?: number;
  /** The blast is centered on a chosen foe in this range. */
  range: number;
}

export interface FoeTerrainRecipe extends FoeRecipeBase {
  kind: 'terrain';
  terrain: string;
  range: number;
}

export interface FoeEndTurnStealthRecipe extends FoeRecipeBase {
  kind: 'end-turn-stealth';
  dash: number;
}

export type FoeRecipe =
  | FoeAttackRecipe
  | FoeShoveRecipe
  | FoeRushRecipe
  | FoeVigorRecipe
  | FoeMarkRecipe
  | FoeSwapRecipe
  | FoeDashStrikeRecipe
  | FoeBlastRecipe
  | FoeTerrainRecipe
  | FoeEndTurnStealthRecipe;

// ── Recipe table ─────────────────────────────────────────────────────────────
/**
 * Independently reviewed foe ability recipes (ICON p.300–302), the second
 * `foe-ability` slice after the Crusher (p.301) pilot. Each entry is one
 * declarative recipe; the generic factories below resolve it. Profiles:
 * Warrior, Soldier, and Brute (basic heavy, p.300) plus Pepperbox and Hunter
 * (basic skirmisher, p.302), covering the canonical attack (with true strike,
 * bonus damage, conditions, splash, and criticals), shove with collide,
 * rush, vigor buff, adjacency and ranged marks, swap, dash-strike, blast
 * area, terrain creation, and end-turn stealth.
 */
export const FOE_ABILITY_RECIPES: Readonly<Record<string, FoeRecipe>> = {
  // ── Crusher (p.301) ────────────────────────────────────────────────────────
  // Headbutt: attack, true strike. On hit: [D]+fray. Miss: fray. Effect: Foe
  // is weakened. Effect: Deals bonus damage to weakened foes (p.102).
  'basic:crusher:301:headbutt': {
    kind: 'attack',
    clauses: ['attack', 'on hit', 'effect', 'effect'],
    range: 1,
    hit: { kind: 'die-fray' },
    trueStrike: true,
    hitConditions: ['weakened'],
    bonusDamage: { condition: 'weakened' },
  },
  // Mighty Blow: deals 2 damage to an adjacent foe and either shoves them 1 or
  // creates a pit under them. The shove branch is resolved; the pit branch is
  // a documented GM choice.
  'basic:crusher:301:mighty-blow': {
    kind: 'shove',
    clauses: ['effect'],
    range: 1,
    damage: { kind: 'fixed', value: 2 },
    distance: 1,
  },
  // Grapple: marks an adjacent foe. The reactive "while marked, must save to
  // break adjacency" window is documented table-facing; the mark itself is
  // deterministic.
  'basic:crusher:301:grapple': {
    kind: 'mark',
    clauses: ['mark', 'effect'],
    range: 1,
    markId: 'crusher:grapple',
  },

  // ── Warrior (p.300) ────────────────────────────────────────────────────────
  // Redondo (free): swap places with an adjacent ally, removing and placing
  // both characters.
  'basic:warrior:300:redondo': {
    kind: 'swap',
    clauses: ['effect'],
    range: 1,
  },
  // Cleave: 2 actions, attack, true strike. On hit: 2[D]+fray. Miss: fray.
  // Effect: All foes adjacent to the warrior or its attack target take fray
  // damage.
  'basic:warrior:300:cleave': {
    kind: 'attack',
    clauses: ['attack', 'on hit', 'miss', 'effect'],
    range: 1,
    hit: { kind: 'die-fray', count: 2 },
    trueStrike: true,
    splash: { amount: { kind: 'fray' } },
  },
  // Bull rush (repeatable): the warrior rushes 1; an adjacent character when
  // it finishes its movement is either weakened or shoved 1. The weaken
  // branch is resolved (listed first); the shove branch is documented.
  'basic:warrior:300:bull-rush': {
    kind: 'rush',
    clauses: ['effect'],
    range: 1,
    distance: 1,
    endWeaken: true,
  },

  // ── Soldier (p.300) ────────────────────────────────────────────────────────
  // Slash: attack, true strike. On hit: [D]+fray. Miss: fray. Effect: Foe is
  // slashed.
  'basic:soldier:300:slash': {
    kind: 'attack',
    clauses: ['attack', 'on hit', 'miss', 'effect'],
    range: 1,
    hit: { kind: 'die-fray' },
    trueStrike: true,
    hitConditions: ['slashed'],
  },
  // Bash (repeatable): an adjacent foe is shoved 2.
  'basic:soldier:300:bash': {
    kind: 'shove',
    clauses: ['effect'],
    range: 1,
    distance: 2,
  },
  // Valiant: rushes up to 4 spaces in a straight line (dominant axis toward
  // the nearest foe), then may use Bash as a free action — the free Bash is a
  // documented caller choice.
  'basic:soldier:300:valiant': {
    kind: 'rush',
    clauses: ['effect'],
    range: 1,
    distance: 4,
    direction: 'toward-nearest-foe',
  },

  // ── Brute (p.300) ──────────────────────────────────────────────────────────
  // Backhand: attack, true strike, combo. On hit: [D]+fray. Miss: fray.
  'basic:brute:300:backhand': {
    kind: 'attack',
    clauses: ['attack', 'on hit', 'miss'],
    range: 1,
    hit: { kind: 'die-fray' },
    trueStrike: true,
  },
  // Backbreaker: 2 actions, attack, combo. On hit: 2[D]+fray. Miss: fray.
  // Effect: Foe is stunned. Effect: Brute may rush 2 before using this
  // ability — taken deterministically and re-validated from the landing cell.
  'basic:brute:300:backbreaker': {
    kind: 'attack',
    clauses: ['attack', 'on hit', 'miss', 'effect', 'effect'],
    range: 2,
    hit: { kind: 'die-fray', count: 2 },
    hitConditions: ['stunned'],
    preRush: 2,
  },
  // Bulk up: gain 4 vigor, or 6 if bloodied.
  'basic:brute:300:bulk-up': {
    kind: 'vigor',
    clauses: ['effect'],
    range: 1,
    amount: 4,
    bloodiedAmount: 6,
  },
  // Hurl (repeatable): shoves an adjacent character or object 2. Collide:
  // Character is weakened.
  'basic:brute:300:hurl': {
    kind: 'shove',
    clauses: ['effect', 'collide'],
    range: 1,
    distance: 2,
    collideConditions: ['weakened'],
  },

  // ── Pepperbox (p.302) ──────────────────────────────────────────────────────
  // Riddle: attack, range 4, +1 boon. On hit: 3 damage, three times. Miss:
  // 3 damage. Effect: Against foes at exactly range 3, inflicts dazed and
  // gains unerring.
  'basic:pepperbox:302:riddle': {
    kind: 'attack',
    clauses: ['attack', 'on hit', 'miss', 'effect'],
    range: 4,
    hit: { kind: 'fixed', value: 3 },
    hitInstances: 3,
    miss: { kind: 'fixed', value: 3 },
    boons: 1,
    atRange: { range: 3, unerring: true, conditions: ['dazed'] },
  },
  // Strafe: dashes 2, then deals 2 damage to a foe in range 3 of the landing
  // cell (deterministically the nearest foe in range).
  'basic:pepperbox:302:strafe': {
    kind: 'dash-strike',
    clauses: ['effect'],
    range: 3,
    dash: 2,
    damage: { kind: 'fixed', value: 2 },
  },
  // Flash Bomb: 2 actions, range 3, small blast. Area effect: all foes take
  // 3 damage twice and are blinded. Effect: if the Pepperbox catches itself
  // or allies in the area, they gain stealth.
  'basic:pepperbox:302:flash-bomb': {
    kind: 'blast',
    clauses: ['area effect', 'effect'],
    range: 3,
    shape: 'small',
    damage: { kind: 'fixed', value: 3 },
    instances: 2,
    conditions: ['blind'],
    alliesStealth: true,
  },

  // ── Hunter (p.302) ─────────────────────────────────────────────────────────
  // Hunter shot: attack, ranged 4, +1 boon. On hit: [D]+fray. Miss: fray.
  // Effect: bloodied characters are shoved 1 and dazed. Against a hunted
  // character (Hunt's mark) the shot gains a bonus damage die (p.102) and
  // unerring (ignore cover), per the Hunt mark's benefit.
  'basic:hunter:302:hunter-shot': {
    kind: 'attack',
    clauses: ['attack', 'on hit', 'miss', 'effect'],
    range: 4,
    hit: { kind: 'die-fray' },
    boons: 1,
    unerringWhenMarked: 'hunter:hunt',
    bonusDamage: { mark: 'hunter:hunt' },
    bloodiedEffect: { shove: 1, conditions: ['dazed'] },
  },
  // Set Trap: creates a trap dangerous terrain space in free space in range 2
  // (deterministically the nearest free cell).
  'basic:hunter:302:set-trap': {
    kind: 'terrain',
    clauses: ['effect'],
    range: 2,
    terrain: 'dangerous',
  },
  // Prowl (end turn): dash 1 and gain stealth. The turn still advances via
  // END_TURN; the end-turn tag is recorded on the program.
  'basic:hunter:302:prowl': {
    kind: 'end-turn-stealth',
    clauses: ['effect'],
    range: 1,
    dash: 1,
  },
  // Hunt: a character in range is marked. The hunter deals bonus damage to
  // the marked character and their abilities gain unerring against them — the
  // bonus damage die (p.102) and ignore-cover flag are wired into the
  // Hunter's attack recipes via `bonusDamage.mark` / `unerringWhenMarked`.
  'basic:hunter:302:hunt': {
    kind: 'mark',
    clauses: ['mark', 'effect'],
    range: 4,
    markId: 'hunter:hunt',
  },

  // ── Cantrix (p.305) ───────────────────────────────────────────────────────
  // Discord: attack, range 8, pierce. Autohit: fray damage. Auto-hit avoids
  // the attack-roll/Evasion step, while the shared direct target gate still
  // owns range, Stealth, and line-of-sight legality. Pierce means the Fray
  // instance ignores Armor and Weakened (p.104).
  'basic:cantrix:305:discord': {
    kind: 'attack',
    clauses: ['autohit'],
    range: 8,
    hit: { kind: 'fray' },
    autoHit: true,
    damageType: 'piercing',
  },

  // ── Chaos Wright (p.306) ──────────────────────────────────────────────────
  // Chaos Shard: attack, range 6, pierce. On hit: [D]+fray. Miss: fray.
  // Effect: foe is shattered. The Effect clause is deliberately separate
  // from hitConditions: it applies after either attack outcome.
  'basic:chaos-wright:306:chaos-shard': {
    kind: 'attack',
    clauses: ['on hit', 'miss', 'effect'],
    range: 6,
    hit: { kind: 'die-fray' },
    miss: { kind: 'fray' },
    damageType: 'piercing',
    effectConditions: ['shattered'],
  },
};

// ── Shared resolver helpers ──────────────────────────────────────────────────
const blastRadius: Record<'small' | 'medium' | 'large', number> = { small: 1, medium: 2, large: 3 };

function chosenTarget(context: RuleExecutionContext): RuleActorView | undefined {
  const targetId = context.attackTargetId ?? context.input.actorIds?.target?.[0];
  return targetId ? context.state.actors[targetId] : undefined;
}

/** Positional gate shared by every foe recipe that targets another actor:
 * the target must exist, be a foe of the source, and be within `range`. */
function requireFoeInRange(context: RuleExecutionContext, source: RuleActorView, target: RuleActorView | undefined, abilityName: string, range: number): RuleActorView {
  if (!source?.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', `${abilityName} needs a target.`);
  if (target.side === source.side || distance(source.position, target.position) > range) {
    throw new RuleProgramViolation('choice.actor-range', `${abilityName} targets a foe within ${range}.`);
  }
  return target;
}

function requireAllyInRange(context: RuleExecutionContext, source: RuleActorView, target: RuleActorView | undefined, abilityName: string, range: number): RuleActorView {
  if (!source?.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', `${abilityName} needs a target.`);
  if (target.side !== source.side || distance(source.position, target.position) > range) {
    throw new RuleProgramViolation('choice.actor-range', `${abilityName} targets an ally within ${range}.`);
  }
  return target;
}

function foeDamage(
  context: RuleExecutionContext,
  actorId: string,
  amount: number,
  delivery: 'hit' | 'miss' | 'area' | 'effect' = 'effect',
  damageType: 'normal' | 'piercing' | 'divine' = 'normal',
  ignoreCover = false,
  instance = 1,
  ignoreDodge = false,
): RuleMutation {
  return { kind: 'damage', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, amount, damageType, instance, delivery, ignoreCover, ...(ignoreDodge ? { ignoreDodge: true } : {}) };
}

function rollAmount(context: RuleExecutionContext, source: RuleActorView, amount: FoeAmount | number): number {
  if (typeof amount === 'number') return amount;
  switch (amount.kind) {
    case 'die': {
      let total = 0;
      for (let index = 0; index < (amount.count ?? 1); index += 1) total += context.dice.die(source.damageDie);
      return total;
    }
    case 'die-fray': {
      let total = source.fray;
      for (let index = 0; index < (amount.count ?? 1); index += 1) total += context.dice.die(source.damageDie);
      return total;
    }
    case 'die-fixed': {
      let total = amount.fixed;
      for (let index = 0; index < amount.count; index += 1) total += context.dice.die(source.damageDie);
      return total;
    }
    case 'fray': return source.fray;
    case 'fixed': return amount.value;
  }
}

/** p.102 bonus damage: one extra [D], keep the higher result. */
function bonusDamageActive(recipe: FoeAttackRecipe, context: RuleExecutionContext, target: RuleActorView): boolean {
  const { bonusDamage } = recipe;
  if (!bonusDamage) return false;
  if (bonusDamage.condition) return target.conditions.has(bonusDamage.condition);
  if (bonusDamage.mark) return target.marks.some((mark) => mark.markId === bonusDamage.mark && mark.ownerId === context.actorId);
  return false;
}

/** True when a shove of `distance` along `direction` is stopped early by the
 * grid edge, another living character, or an impassable grid terrain cell —
 * the reducer's `shoveResolution` collision rules (ICON p.95 Collide). */
function shoveCollides(context: RuleExecutionContext, actorId: string, start: Position, direction: Position, distanceToTravel: number): boolean {
  let position = { ...start };
  for (let step = 0; step < distanceToTravel; step += 1) {
    const next = { x: position.x + Math.sign(direction.x), y: position.y + Math.sign(direction.y) };
    const obstructed = next.x < 0 || next.y < 0 || next.x >= context.state.grid.width || next.y >= context.state.grid.height
      || Object.values(context.state.actors).some((candidate) => candidate.id !== actorId && candidate.position && !candidate.defeated && sameCell(candidate.position, next))
      || context.state.terrainAt(next).has('impassable');
    if (obstructed) return true;
    position = next;
  }
  return false;
}

function sortedActors(context: RuleExecutionContext): RuleActorView[] {
  return Object.values(context.state.actors)
    .filter((actor) => actor.position && !actor.defeated)
    .sort((a, b) => (a.position!.y - b.position!.y) || (a.position!.x - b.position!.x) || a.id.localeCompare(b.id));
}

// ── Generic resolver factories ───────────────────────────────────────────────
function attackResolver(recipe: FoeAttackRecipe): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    const target = chosenTarget(context);
    if (!source?.position || !target?.position) throw new RuleProgramViolation('choice.actor-count', `${context.sourceId} targets a foe.`);
    if (target.side === source.side) throw new RuleProgramViolation('choice.actor-range', `${context.sourceId} targets a foe.`);
    const mutations: RuleMutation[] = [];
    // Optional pre-attack rush (Backbreaker p.300). The reducer's range gate
    // ran against the original position, so the resolver re-validates from
    // the landing cell.
    let attackOrigin = source.position;
    if (recipe.preRush) {
      const direction = axisDirection(source.position, target.position);
      const landing = walk(context, source.position, direction, recipe.preRush, false, source.id);
      if (!sameCell(landing, source.position)) {
        mutations.push(rushMutation(context, source.id, landing));
        attackOrigin = landing;
      }
    }
    if (distance(attackOrigin, target.position) > (recipe.range ?? 1)) {
      throw new RuleProgramViolation('choice.actor-range', `${context.sourceId} targets a foe within ${recipe.range ?? 1}.`);
    }
    const atRange = recipe.atRange && distance(attackOrigin, target.position) === recipe.atRange.range;
    const ignoreCover = Boolean(recipe.unerring
      || (atRange && recipe.atRange?.unerring)
      || (recipe.unerringWhenMarked && target.marks.some((mark) => mark.markId === recipe.unerringWhenMarked && mark.ownerId === context.actorId)));
    const roll = resolveAttack(context, source, target, {
      boons: recipe.boons,
      trueStrike: recipe.trueStrike,
      autoHit: recipe.autoHit,
    });
    const attackIgnoreCover = ignoreCover || roll.damageProvenance.ignoreCover;
    const attackIgnoreDodge = roll.damageProvenance.ignoreDodge;
    mutations.push(roll.attackMutation);
    const damageType = recipe.damageType ?? 'normal';
    if (roll.hit) {
      const base = rollAmount(context, source, recipe.hit);
      const bonus = bonusDamageActive(recipe, context, target)
        ? Math.max(context.dice.die(source.damageDie), context.dice.die(source.damageDie))
        : 0;
      const instances = recipe.hitInstances ?? 1;
      for (let instance = 1; instance <= instances; instance += 1) {
        mutations.push(foeDamage(context, target.id, base + bonus, 'hit', damageType, attackIgnoreCover, instance, attackIgnoreDodge));
      }
      if (roll.critical) mutations.push(foeDamage(context, target.id, context.dice.die(source.damageDie), 'hit', damageType, attackIgnoreCover, instances + 1, attackIgnoreDodge));
      for (const conditionId of recipe.hitConditions ?? []) mutations.push(conditionMutation(context, target.id, conditionId));
      if (recipe.hitShove) mutations.push(shoveMutation(context, target.id, recipe.hitShove, axisDirection(attackOrigin, target.position)));
      if (recipe.hitMark) mutations.push(markMutation(context, target.id, recipe.hitMark, {}));
    } else {
      const missAmount = recipe.miss ? rollAmount(context, source, recipe.miss) : source.fray;
      mutations.push(foeDamage(context, target.id, missAmount, 'miss', damageType, attackIgnoreCover, 1, attackIgnoreDodge));
    }
    for (const conditionId of recipe.effectConditions ?? []) mutations.push(conditionMutation(context, target.id, conditionId));
    if (atRange) for (const conditionId of recipe.atRange?.conditions ?? []) mutations.push(conditionMutation(context, target.id, conditionId));
    if (recipe.bloodiedEffect && target.hp <= target.maxHp / 2) {
      if (recipe.bloodiedEffect.shove) mutations.push(shoveMutation(context, target.id, recipe.bloodiedEffect.shove, axisDirection(attackOrigin, target.position)));
      for (const conditionId of recipe.bloodiedEffect.conditions ?? []) mutations.push(conditionMutation(context, target.id, conditionId));
    }
    if (recipe.splash) {
      const foeSide = source.side === 'heroes' ? 'foes' : 'heroes';
      const victims = new Set<string>();
      for (const origin of [source.position, target.position]) {
        const exclude = sameCell(origin, source.position) ? source.id : target.id;
        for (const actor of adjacentActors(context, origin, foeSide, exclude)) victims.add(actor.id);
      }
      for (const victimId of victims) mutations.push(foeDamage(context, victimId, rollAmount(context, source, recipe.splash.amount), 'area', damageType));
    }
    return mutations;
  };
}

function shoveResolver(recipe: FoeShoveRecipe): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    const target = requireFoeInRange(context, source, chosenTarget(context), context.sourceId, recipe.range ?? 1);
    const mutations: RuleMutation[] = [];
    if (recipe.damage) mutations.push(foeDamage(context, target.id, rollAmount(context, source, recipe.damage), 'effect'));
    const direction = axisDirection(source.position!, target.position!);
    mutations.push(shoveMutation(context, target.id, recipe.distance, direction));
    if (recipe.collideConditions && shoveCollides(context, target.id, target.position!, direction, recipe.distance)) {
      for (const conditionId of recipe.collideConditions) mutations.push(conditionMutation(context, target.id, conditionId));
    }
    return mutations;
  };
}

function rushResolver(recipe: FoeRushRecipe): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    if (!source?.position) throw new RuleProgramViolation('choice.actor-count', `${context.sourceId} requires a position.`);
    const { direction: chosenDirection } = recipe;
    const towardNearest = chosenDirection === undefined || chosenDirection === 'toward-nearest-foe';
    const direction = towardNearest ? rushTowardFoes(context, source.position) : { x: chosenDirection.x, y: chosenDirection.y };
    const landing = walk(context, source.position, direction, recipe.distance, false, source.id);
    const mutations: RuleMutation[] = [rushMutation(context, source.id, landing)];
    if (recipe.endWeaken && !sameCell(landing, source.position)) {
      const foeSide = source.side === 'heroes' ? 'foes' : 'heroes';
      const first = adjacentActors(context, landing, foeSide, source.id)[0];
      if (first) mutations.push(conditionMutation(context, first.id, 'weakened'));
    }
    return mutations;
  };
}

function vigorResolver(recipe: FoeVigorRecipe): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    if (!source) throw new RuleProgramViolation('choice.actor-count', `${context.sourceId} requires the source actor.`);
    const bloodied = source.hp <= source.maxHp / 2;
    const amount = bloodied && recipe.bloodiedAmount !== undefined ? recipe.bloodiedAmount : recipe.amount;
    return [vigorMutation(context, source.id, amount)];
  };
}

function markResolver(recipe: FoeMarkRecipe): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    const target = requireFoeInRange(context, source, chosenTarget(context), context.sourceId, recipe.range ?? 1);
    return [markMutation(context, target.id, recipe.markId, {})];
  };
}

function swapResolver(): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    const target = requireAllyInRange(context, source, chosenTarget(context), context.sourceId, 1);
    const mutations: RuleMutation[] = [
      { kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: source.id, movement: 'place', distance: null, positions: [target.position!], direction: null, phasing: false },
      { kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, movement: 'place', distance: null, positions: [source.position!], direction: null, phasing: false },
    ];
    return mutations;
  };
}

function dashStrikeResolver(recipe: FoeDashStrikeRecipe): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    const chosen = chosenTarget(context);
    if (!source?.position) throw new RuleProgramViolation('choice.actor-count', `${context.sourceId} requires a position.`);
    const direction = chosen?.position ? axisDirection(source.position, chosen.position) : { x: 1, y: 0 };
    const landing = walk(context, source.position, direction, recipe.dash, false, source.id);
    const mutations: RuleMutation[] = [];
    if (!sameCell(landing, source.position)) mutations.push(rushMutation(context, source.id, landing));
    const foeSide = source.side === 'heroes' ? 'foes' : 'heroes';
    const victim = sortedActors(context)
      .filter((actor) => actor.side === foeSide && distance(actor.position!, landing) <= recipe.range)
      .sort((a, b) => distance(a.position!, landing) - distance(b.position!, landing) || a.id.localeCompare(b.id))[0];
    if (victim) mutations.push(foeDamage(context, victim.id, rollAmount(context, source, recipe.damage), 'effect'));
    return mutations;
  };
}

function blastResolver(recipe: FoeBlastRecipe): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    const center = requireFoeInRange(context, source, chosenTarget(context), context.sourceId, recipe.range);
    const centerPosition = center.position;
    if (!centerPosition) throw new RuleProgramViolation('choice.actor-count', `${context.sourceId} needs a blast center.`);
    const cells = squareArea(centerPosition, blastRadius[recipe.shape]);
    const mutations: RuleMutation[] = [];
    const foeSide = source.side === 'heroes' ? 'foes' : 'heroes';
    for (const actor of sortedActors(context)) {
      const actorPosition = actor.position;
      if (!actorPosition || !cells.some((cell) => sameCell(cell, actorPosition))) continue;
      if (actor.side === foeSide) {
        for (let instance = 1; instance <= (recipe.instances ?? 1); instance += 1) {
          mutations.push(foeDamage(context, actor.id, rollAmount(context, source, recipe.damage), 'area', 'normal', false, instance));
        }
        for (const conditionId of recipe.conditions ?? []) mutations.push(conditionMutation(context, actor.id, conditionId));
      } else if (recipe.alliesStealth) {
        mutations.push(conditionMutation(context, actor.id, 'stealth'));
      } else if (recipe.alliesVigor) {
        mutations.push(vigorMutation(context, actor.id, recipe.alliesVigor));
      }
    }
    return mutations;
  };
}

function terrainResolver(recipe: FoeTerrainRecipe): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    if (!source?.position) throw new RuleProgramViolation('choice.actor-count', `${context.sourceId} requires a position.`);
    const cell = freeCellsInRange(context, source.position, recipe.range)[0];
    if (!cell) throw new RuleProgramViolation('choice.no-space', `${context.sourceId} needs a free space in range.`);
    return [terrainMutation(context, 'create', recipe.terrain, [cell])];
  };
}

function endTurnStealthResolver(recipe: FoeEndTurnStealthRecipe): RuleResolver {
  return (context) => {
    const source = sourceActor(context, context.actorId);
    if (!source?.position) throw new RuleProgramViolation('choice.actor-count', `${context.sourceId} requires a position.`);
    const direction = rushTowardFoes(context, source.position);
    const landing = walk(context, source.position, direction, recipe.dash, false, source.id);
    const mutations: RuleMutation[] = [];
    if (!sameCell(landing, source.position)) mutations.push(rushMutation(context, source.id, landing));
    mutations.push(conditionMutation(context, source.id, 'stealth'));
    mutations.push({ kind: 'end-turn', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: context.actorId });
    return mutations;
  };
}

// ── Compilation ──────────────────────────────────────────────────────────────
/** Build the typed RuleProgram for a recipe, deriving costs, tags, and the
 * default range from the source catalog unit. Returns null when the unit has
 * no reviewed recipe. */
export function compileFoeAbilityRecipe(unit: RuleSourceUnit, recipe: FoeRecipe): RuleProgramCompilation {
  const tags = typeof unit.metadata.tags === 'string' ? unit.metadata.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [];
  const actionKind = typeof unit.metadata.actionKind === 'string' ? unit.metadata.actionKind : 'action';
  const actionCost = typeof unit.metadata.actionCost === 'number' ? unit.metadata.actionCost : 0;
  const timing: RuleTiming = actionKind === 'interrupt' ? 'interrupt' : 'use';
  const costs: RuleCost[] = actionCost > 0 && actionKind !== 'free'
    ? [{ kind: actionKind === 'interrupt' ? 'interrupt' as const : 'action' as const, amount: constant(actionCost) }]
    : [];
  const range = recipe.range ?? (typeof unit.metadata.range === 'number' ? unit.metadata.range : null) ?? 1;
  return compilation(unit, [action({
    name: unit.name,
    timing,
    costs,
    tags,
    range: constant(range),
    resolverId: `${unit.id}:effects`,
    steps: [],
  })], recipe.clauses);
}

/** The named deterministic resolver registry for every reviewed recipe
 * (`<abilityId>:effects`). Built from the table so a new recipe needs no
 * wiring beyond its entry. */
export const FOE_RULE_RESOLVERS: RuleResolverRegistry = Object.fromEntries(
  Object.entries(FOE_ABILITY_RECIPES).map(([id, recipe]) => {
    const resolver: RuleResolver = (() => {
      switch (recipe.kind) {
        case 'attack': return attackResolver(recipe);
        case 'shove': return shoveResolver(recipe);
        case 'rush': return rushResolver(recipe);
        case 'vigor': return vigorResolver(recipe);
        case 'mark': return markResolver(recipe);
        case 'swap': return swapResolver();
        case 'dash-strike': return dashStrikeResolver(recipe);
        case 'blast': return blastResolver(recipe);
        case 'terrain': return terrainResolver(recipe);
        case 'end-turn-stealth': return endTurnStealthResolver(recipe);
      }
    })();
    return [`${id}:effects`, resolver];
  }),
);
