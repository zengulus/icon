/**
 * Talent fold kernel (F7, docs/rules-foundations.md §8).
 *
 * A wired talent declares a trigger-effect (`exceed` when the ability's
 * attack roll is 15+, `comeback` while the user is bloodied, `slay` when the
 * ability reduces a foe to 0 HP, `collide` when one of the ability's shoves
 * collides — the slay/collide triggers are post-application, decided by the
 * shared reactive dry run on the ability's recorded mutations —
 * `finishing-blow` when the ability targets a bloodied foe, the same rule
 * `deriveTriggers` uses, and `always` for unconditional ability
 * augmentations whose magnitude reads state — e.g. a charge-scaled effect
 * reading the user's slow-turn state) and the effect mutations are folded
 * into the ability's mutation stream at command time, so replay carries
 * them on the event (F0 durable-record principle).
 *
 * A row may declare a `condition` override for its trigger (a per-row fired
 * check, e.g. a finishing-blow row whose eligibility extends to dazed or
 * blinded foes), and `build` receives a `TalentFoldContext` (the encounter
 * state and the ability's own produced mutations) when it needs them.
 *
 * The wired rows themselves live in `content/jobs/talent-recipes.ts` and
 * register through `registerWiredTalentRecipe`; program-level talents (the
 * ability programs read the equipped choice themselves and emit the variant
 * in their own mutation stream, e.g. Demon Cutter t2's pre-ability rush)
 * register through `registerProgramLevelTalent`. This module contains only
 * the fold and the executable allowlists, and deliberately no source IDs of
 * its own.
 */
import type { EncounterActor, EncounterState } from '../../types.js';
import type { RuleMutation } from '../primitives/types.js';

/** ICON p.102: bloodied at or below half maximum HP (same formula as the
 * kernel's isBloodied — inlined here to keep the module graph acyclic: the
 * adapter imports manual-programs, which imports this module). */
function isBloodied(actor: EncounterActor): boolean {
  return actor.hp <= Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality) / 2;
}

export type TalentStatus = 'wired' | 'program-level' | 'passive-projection' | 'range-modifier' | 'area-modifier' | 'bonus-damage' | 'mark-modifier' | 'documented';

/** The resolved mutation kinds a wired talent may emit (each without its
 * sourceId — the kernel fills the talent's source id at fold time).
 * terrain mutations let talents create terrain effects (pits, difficult
 * terrain, dangerous terrain) as post-resolution effects. */
export type TalentEffect =
  | Omit<Extract<RuleMutation, { kind: 'vigor' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'resource' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'condition' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'damage' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'move' }>, 'sourceId'>
  | Omit<Extract<RuleMutation, { kind: 'terrain' }>, 'sourceId'>;

/** The fold context handed to a wired row's `condition`/`build`: the
 * encounter state, the ability's own produced mutations, the ability's
 * target ids, and the acting actor's id (so side-relative predicates such
 * as "the ability affected exactly one foe" can be expressed without
 * re-deriving the source from the mutation stream). */
export interface TalentFoldContext {
  state: EncounterState;
  mutations: readonly RuleMutation[];
  targetIds: readonly string[];
  actorId: string;
}

/** The distinct foe actor ids a set of the ability's own mutations affected
 * through the given interaction kinds (shove / damage). Shared by the
 * single-foe conditional talent family (e.g. "If you only shove one foe,
 * they gain hatred of you"): the predicate reads the ability's recorded
 * mutations — never re-decides anything — so replay applies exactly what the
 * command boundary folded. Source-ID-free: it derives purely from the
 * mutation stream and the actors' sides. */
export function affectedFoeIds(
  mutations: readonly RuleMutation[],
  state: EncounterState,
  sourceActorId: string,
  kinds: ReadonlyArray<'shove' | 'damage'>,
): string[] {
  const sourceSide = state.actors[sourceActorId]?.side;
  const foeIds = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind === 'damage') {
      if (!kinds.includes('damage')) continue;
      const target = state.actors[mutation.actorId];
      if (target && target.side !== sourceSide) foeIds.add(mutation.actorId);
    } else if (mutation.kind === 'move' && mutation.movement === 'shove') {
      if (!kinds.includes('shove')) continue;
      const target = state.actors[mutation.actorId];
      if (target && target.side !== sourceSide) foeIds.add(mutation.actorId);
    }
  }
  return [...foeIds];
}

/** A wired talent's declared trigger-effect. The `build` factory fills the
 * actor/target ids at fold time; the kernel adds the talent's sourceId. */
export interface TalentTriggerEffect {
  /** `exceed` fires when the ability's attack roll totals 15+ (ICON p.85);
   * `comeback` fires while the user is bloodied (ICON p.102); `finishing-
   * blow` fires when the ability targets a bloodied foe (the `deriveTriggers`
   * rule, ICON p.95); `always` fires on every use of the ability (an
   * unconditional augmentation; the build reads the fold context for
   * magnitudes, e.g. a charge-scaled shove reading the user's slow-turn
   * state); `slay` and `collide` are post-application triggers (ICON p.95)
   * decided by the shared reactive dry run on the ability's recorded
   * mutations. */
  trigger: 'exceed' | 'comeback' | 'slay' | 'collide' | 'finishing-blow' | 'always';
  /** True when the source says the player MAY do this ("you can …", "you may
   * …") — the row then fires only when the player explicitly named this
   * talent's source id in the command's `talentChoices` input. The engine
   * never assumes "yes" merely because the effect is beneficial. */
  optional?: boolean;
  /** Optional per-row override of the trigger's fired check (e.g. a
   * finishing-blow row whose eligibility extends to dazed or blinded foes).
   * When present it replaces the trigger kind's default condition. */
  condition?(context: TalentFoldContext): boolean;
  /** Deterministic effect mutations for the firing actor, the ability's
   * target ids, the trigger's own targets (the collided actors for
   * `collide`, the defeated actors for `slay`, the bloodied foe targets for
   * `finishing-blow`), and the fold context. */
  build(actorId: string, targetIds: readonly string[], triggerTargetIds: readonly string[], context?: TalentFoldContext): TalentEffect[];
}

export interface TalentRecipe {
  sourceId: string;
  /** The ability whose source block owns this talent. */
  abilityId: string;
  name: string;
  status: TalentStatus;
  /** What the engine resolves deterministically. */
  mechanic: string;
  /** The ruling / remaining kernel need (documented rows). */
  detail: string;
  /** Wired rows carry their trigger-effect; documented rows never do. */
  triggerEffect?: TalentTriggerEffect;
}

/** A registered wired talent row: the trigger-effect plus its mechanic text. */
export interface WiredTalentRow {
  mechanic: string;
  triggerEffect: TalentTriggerEffect;
}

const wiredTalentRecipes: Record<string, WiredTalentRow> = {};

/** Register a wired talent row (content/jobs/talent-recipes.ts). */
export function registerWiredTalentRecipe(sourceId: string, row: WiredTalentRow): void {
  wiredTalentRecipes[sourceId] = row;
}

/** Program-level talent implementations: talents the ability programs
 * themselves gate on the equipped choice (`context.state.actors[id]
 * .talents[abilityId]`) and emit in their own mutation stream — e.g. Demon
 * Cutter t2's pre-ability rush (a charge-scaled movement variant that changes
 * the ability's own origin, which a post-mutation fold cannot express). They
 * are executable (audit-complete) but deliberately not fold rows: the fold
 * must not double-apply them. */
const programLevelTalentRecipes: Record<string, string> = {};

/** Register a program-level talent implementation (content/jobs/
 * talent-recipes.ts). */
export function registerProgramLevelTalent(sourceId: string, mechanic: string): void {
  programLevelTalentRecipes[sourceId] = mechanic;
}

/** A continuous passive-projection talent: the mechanic is a projection the
 * kernel derives from current state (e.g. Rook talent 1's counter while the
 * Rook aura is active, Dervish talent 1's counter from the swirling winds
 * aura, Gentleness talent 1's counter in the stance) rather than a fold
 * trigger or a program-emitted variant. It is executable (audit-complete)
 * but deliberately not a fold row: there is no ability-use moment to fold
 * into, and a durable condition grant would go stale when membership
 * changes. The projection itself lives in the aura/condition registries. */
const passiveProjectionTalentRecipes: Record<string, string> = {};

/** Register a continuous passive-projection talent (content/jobs/
 * talent-recipes.ts). */
export function registerPassiveProjectionTalent(sourceId: string, mechanic: string): void {
  passiveProjectionTalentRecipes[sourceId] = mechanic;
}

/** Range-modifier talents: the talent's COMPLETE semantics are a listed-range
 * change on its parent ability ("Valkyrie gains range 4"), executed by the
 * shared range kernel (`kernels/range.ts`) at both command gates whenever the
 * parent ability is used. The row is executable (audit-complete) but
 * deliberately not a fold row: there is no mutation to fold — the effective
 * range is authoritative target validation. The rule itself lives in
 * `content/jobs/range-recipes.ts`; this allowlist mirrors it for audit. */
const rangeModifierTalentRecipes: Record<string, string> = {};

/** Bonus-damage talents (F6a): the talent's COMPLETE semantics are "this
 * ability deals bonus damage" under a source gate (self bloodied, target
 * bloodied, target status, a scaled count), executed by the bonus-damage
 * grant kernel (`kernels/bonus-damage.ts`) at the USE_ABILITY boundary — the
 * folded dice ride the ability's recorded damage roll (ICON p.102 keep-
 * highest), so there is no post-mutation fold to run and no program variant
 * to emit. The rule itself lives in `content/jobs/bonus-damage-recipes.ts`;
 * this allowlist mirrors it for audit. */
const bonusDamageTalentRecipes: Record<string, string> = {};

/** Register a range-modifier talent implementation (content/jobs/
 * talent-recipes.ts + range-recipes.ts). */
export function registerRangeModifierTalent(sourceId: string, mechanic: string): void {
  rangeModifierTalentRecipes[sourceId] = mechanic;
}

/** Register a bonus-damage talent implementation (content/jobs/
 * talent-recipes.ts + bonus-damage-recipes.ts). */
export function registerBonusDamageTalent(sourceId: string, mechanic: string): void {
  bonusDamageTalentRecipes[sourceId] = mechanic;
}

/** Mark-modifier talents (F5): the talent's COMPLETE semantics are a change
 * to what an existing mark does at one of the engine's mark query points —
 * a carrier-aware mark-condition projection (with potency, e.g. Grand Seal
 * talent 2's pacified+), a mark-keyed status-save policy row (Grand Seal
 * talent 1's save curse), or a mark-adjacency turn-boundary trigger (Rot
 * talent 2's start-of-turn damage). The rows themselves live in
 * `content/jobs/mark-modifier-recipes.ts` / `content/jobs/
 * lifecycle-recipes.ts`; this allowlist mirrors them for audit. */
const markModifierTalentRecipes: Record<string, string> = {};

/** Register a mark-modifier talent implementation (content/jobs/
 * talent-recipes.ts + mark-modifier-recipes.ts + lifecycle-recipes.ts). */
export function registerMarkModifierTalent(sourceId: string, mechanic: string): void {
  markModifierTalentRecipes[sourceId] = mechanic;
}

/** Area-modifier talents: the talent's COMPLETE semantics are a shape/size
 * change on its parent ability's area ("Soul Shot becomes Line 6"), executed
 * by the shared area kernel (`kernels/area.ts`) inside the parent resolver
 * whenever the parent ability is used. The row is executable
 * (audit-complete) but deliberately not a fold row: there is no mutation to
 * fold — the effective area is authoritative cell generation. The rule
 * itself lives in `content/jobs/area-recipes.ts`; this allowlist mirrors it
 * for audit. */
const areaModifierTalentRecipes: Record<string, string> = {};

/** Register an area-modifier talent implementation (content/jobs/
 * talent-recipes.ts + area-recipes.ts). */
export function registerAreaModifierTalent(sourceId: string, mechanic: string): void {
  areaModifierTalentRecipes[sourceId] = mechanic;
}

/** The executable talent ids — the allowlist that makes each talent's
 * compilation complete (audit authority: allowlist + source fixture + replay
 * test). The wired fold rows, the program-level implementations, the
 * continuous passive-projection rows, the range-modifier rows, and the
 * area-modifier rows are all explicit, so this never touches the source
 * manifest. */
export function getExecutableTalentIds(): ReadonlySet<string> {
  return new Set([
    ...Object.keys(wiredTalentRecipes),
    ...Object.keys(programLevelTalentRecipes),
    ...Object.keys(passiveProjectionTalentRecipes),
    ...Object.keys(rangeModifierTalentRecipes),
    ...Object.keys(areaModifierTalentRecipes),
    ...Object.keys(bonusDamageTalentRecipes),
    ...Object.keys(markModifierTalentRecipes),
  ]);
}

export const isExecutableTalent = (sourceId: string): boolean =>
  Object.prototype.hasOwnProperty.call(wiredTalentRecipes, sourceId)
  || Object.prototype.hasOwnProperty.call(programLevelTalentRecipes, sourceId)
  || Object.prototype.hasOwnProperty.call(passiveProjectionTalentRecipes, sourceId)
  || Object.prototype.hasOwnProperty.call(rangeModifierTalentRecipes, sourceId)
  || Object.prototype.hasOwnProperty.call(areaModifierTalentRecipes, sourceId)
  || Object.prototype.hasOwnProperty.call(bonusDamageTalentRecipes, sourceId)
  || Object.prototype.hasOwnProperty.call(markModifierTalentRecipes, sourceId);

/** The mechanic text of a program-level talent implementation, or undefined
 * for a fold-wired or documented talent. */
export function getProgramLevelTalentMechanic(sourceId: string): string | undefined {
  return programLevelTalentRecipes[sourceId];
}

/** The mechanic text of a range-modifier talent implementation, or undefined. */
export function getRangeModifierTalentMechanic(sourceId: string): string | undefined {
  return rangeModifierTalentRecipes[sourceId];
}

/** The mechanic text of an area-modifier talent implementation, or undefined. */
export function getAreaModifierTalentMechanic(sourceId: string): string | undefined {
  return areaModifierTalentRecipes[sourceId];
}

/** The mechanic text of a bonus-damage talent implementation, or undefined. */
export function getBonusDamageTalentMechanic(sourceId: string): string | undefined {
  return bonusDamageTalentRecipes[sourceId];
}

/** The mechanic text of a mark-modifier talent implementation, or undefined. */
export function getMarkModifierTalentMechanic(sourceId: string): string | undefined {
  return markModifierTalentRecipes[sourceId];
}

/** The post-application trigger targets a wired slay/collide talent needs.
 * The caller computes them from the ability's recorded mutations via the
 * shared reactive dry run (`collidingShoveTargets` / `reactiveSlayTargets`)
 * — the same kernel that decides the ability's own collide/slay clauses — so
 * the fold stays framework-free and the module graph stays acyclic. */
export interface TalentReactiveTargets {
  collidedActorIds?: readonly string[];
  slainActorIds?: readonly string[];
}

/** The reactive trigger a wired slay/collide talent needs, or null when the
 * actor's equipped talent for this ability is not a wired slay/collide row.
 * Callers use this to decide whether the post-application dry run is needed
 * before folding (the dry run clones the encounter state). */
export function talentReactiveTrigger(actor: EncounterActor, abilityId: string): 'slay' | 'collide' | null {
  const chosen = actor.talents?.[abilityId];
  if (!chosen) return null;
  const trigger = wiredTalentRecipes[`${abilityId}:talent:${chosen}`]?.triggerEffect?.trigger;
  return trigger === 'slay' || trigger === 'collide' ? trigger : null;
}

/**
 * The shared talent fold (F7): after an ability's program produced its
 * mutations, append the equipped wired talent's trigger-effect mutations when
 * its trigger fired. The trigger decision is deterministic and derived from
 * the same engine semantics the program used:
 *
 * - `comeback` — the user is bloodied (the same check as `deriveTriggers`).
 * - `exceed` — any produced `attack` mutation rolled 15+ (the engine's
 *   exceed threshold, runtime.ts), so no re-roll and no re-decision happen.
 * - `finishing-blow` — any ability target is a bloodied foe (the same check
 *   as `deriveTriggers`); the bloodied foe targets are handed to `build` as
 *   its third argument.
 * - `always` — fires on every use of the ability (an unconditional
 *   augmentation); the row's `build` reads the fold context for magnitudes
 *   (e.g. a charge-scaled shove reading the user's slow-turn state).
 * - `collide` / `slay` — post-application triggers: the caller passes the
 *   reactive targets (`collidedActorIds` / `slainActorIds`) computed from
 *   the ability's recorded mutations by the same dry run that derives the
 *   ability's own reactive clauses, and the fold fires when the relevant
 *   set is non-empty. The trigger's own targets (the collided / defeated
 *   actors) are handed to `build` as its third argument.
 * - A row's `condition` override replaces the trigger kind's default check.
 *
 * The returned mutations ride the ability's RULE_MUTATIONS_APPLIED event, so
 * replay applies exactly what the command boundary decided (F0 durable
 * record). A talent outside the wired table, or one whose trigger did not
 * fire, contributes nothing.
 */
export function talentTriggerMutations(
  state: EncounterState,
  actor: EncounterActor,
  abilityId: string,
  mutations: readonly RuleMutation[],
  targetIds: readonly string[] = [],
  reactive: TalentReactiveTargets = {},
  choices: ReadonlySet<string> = new Set(),
): RuleMutation[] {
  const chosen = actor.talents?.[abilityId];
  if (!chosen) return [];
  const sourceId = `${abilityId}:talent:${chosen}`;
  // The runtime fold reads the explicit wired table — never the manifest.
  const recipe = wiredTalentRecipes[sourceId];
  const triggerEffect = recipe?.triggerEffect;
  if (!triggerEffect) return [];
  const context: TalentFoldContext = { state, mutations, targetIds, actorId: actor.id };
  const finishedBlowTargets = targetIds.filter((id) => {
    const target = state.actors[id];
    return Boolean(target && target.side !== actor.side && isBloodied(target));
  });
  const conditionFired = triggerEffect.condition
    ? triggerEffect.condition(context)
    : triggerEffect.trigger === 'comeback'
      ? isBloodied(actor)
      : triggerEffect.trigger === 'exceed'
        ? mutations.some((mutation) => mutation.kind === 'attack' && (mutation.total ?? 0) >= 15)
        : triggerEffect.trigger === 'collide'
          ? (reactive.collidedActorIds?.length ?? 0) > 0
          : triggerEffect.trigger === 'slay'
            ? (reactive.slainActorIds?.length ?? 0) > 0
            : triggerEffect.trigger === 'finishing-blow'
              ? finishedBlowTargets.length > 0
              : triggerEffect.trigger === 'always'
                ? true
                : false;
  const fired = triggerEffect.optional ? conditionFired && choices.has(sourceId) : conditionFired;
  if (!fired) return [];
  const triggerTargetIds = triggerEffect.trigger === 'collide' ? (reactive.collidedActorIds ?? [])
    : triggerEffect.trigger === 'slay' ? (reactive.slainActorIds ?? [])
    : triggerEffect.trigger === 'finishing-blow' ? finishedBlowTargets
    : [];
  return triggerEffect.build(actor.id, targetIds, triggerTargetIds, context).map((mutation) => ({ ...mutation, sourceId } as RuleMutation));
}
