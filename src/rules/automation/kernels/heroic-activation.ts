/**
 * Heroic activation transaction kernel (ICON pp.116 + the heroic-granting
 * trait/class rows registered from content/jobs/heroic-activation-recipes.ts).
 *
 * Heroic is a DECLARATION — the caller says "I use this ability's heroic
 * effects". It becomes an authoritative validated-player-activation ONLY
 * through this transaction: the content-registered recipe whose `applies`
 * predicate covers the actor (and, for the Stalwart Gambit, the ability being
 * used) decides whether the declaration is legal, what it costs, and what
 * consequences it records. A caller naming `heroic` never bypasses the
 * transaction; owning a trait is never proof that a specific activation was
 * legal and paid.
 *
 * The kernel is GENERIC — it knows NO named trait, class, ability, or source
 * id. It folds ONLY the declared recipe fields:
 *
 * - `applies` — the content-side applicability predicate (pure function of
 *   durable metadata: trait ownership, the actor's class id, and the ability
 *   catalog's class id for the Stalwart Gambit).
 * - `availability` — typed predicates (lockout condition, once-per-round or
 *   once-per-combat U16 ledger gates).
 * - `costs` — typed pre-resolution costs (a 25%-of-base-max sacrifice).
 * - `preResolutionEffects` — typed consequences riding the resolution's event
 *   (a durable lockout condition).
 * - `postResolutionContinuation` — an optional U12 deferred-rule arm whose
 *   resume evaluates against THEN-CURRENT state after the ability resolves
 *   (Spite's "after it resolves, gain Hatred+ of the closest foe to you").
 *
 * FAIL CLOSED on partial source units: a recipe whose `missingSeams` is
 * non-empty is REGISTERED (for census/provenance) but its activation is
 * REJECTED with the precise blocker list before any cost, effect, or RNG.
 * The engine never executes a source half while a mandatory clause is absent
 * (Strive's half-damage + shove-distance, Wolfheart's movement distance).
 *
 * Determinism/replay: every accepted activation returns the recorded
 * mutations (sacrifice HP cost, lockout conditions, and the once-per-round /
 * once-per-combat ledger commits via the U16 grouping) that ride the
 * resolution's own event — replay applies exactly what the command decided;
 * nothing is re-decided or re-derived. A post-resolution continuation is a
 * durable U12 arm correlated to the resolution's `ability-used` fact; the
 * reducer resumes it against then-current state (unique → deterministic;
 * source-granted tie → the recorded U4 choice through the U13 window).
 */
import type { EncounterActor, EncounterState } from '../../types.js';
import { armContinuation, type ArmedContinuation } from '../primitives/continuation.js';
import { factInstanceId } from '../primitives/facts.js';
import { capturedActor } from '../primitives/reference.js';
import { usageKey } from '../primitives/usage.js';
import { sacrificeMutation } from '../primitives/cost-payment.js';
import { applyOncePerRoundUsage, useLedgerAvailable } from './use-ledger.js';
import { consumeUsageMutation } from '../primitives/usage.js';
import type { RuleMutation } from '../primitives/types.js';

/** The content-side applicability context: the declaring actor and — where
 * the declaration rides a specific ability use (EXECUTE_RULE) — the ability
 * id, so the Stalwart Gambit recipe can gate on the ability's catalog class.
 * Absent for declarations without a specific ability (no current surface). */
export interface HeroicActivationContext {
  actor: EncounterActor;
  abilityId: string | undefined;
  /** The deterministic resolution identity the declaration rides (the U12
   * continuation's fact correlation, so a later ability use can never
   * cross-fire the post-resolution consequence). */
  resolutionId: string | undefined;
}

/** The caller-supplied declaration surface (the kernel binds the actor). */
export interface HeroicDeclarationContext {
  abilityId?: string;
  resolutionId?: string;
}

/** One typed availability predicate. All declared predicates must pass. */
export type HeroicAvailability =
  | { kind: 'not-locked-out'; conditionId: string }
  | { kind: 'once-per-round'; ledgerSourceId: string }
  | { kind: 'once-per-combat'; ledgerSourceId: string };

/** One typed pre-resolution cost, paid atomically before any effect/RNG. */
export type HeroicCost =
  | { kind: 'sacrifice-percent'; percentOfBaseMaximumHp: number; rounding: 'up' | 'down' };

/** One typed pre-resolution consequence, recorded on the resolution's event. */
export type HeroicPreResolutionEffect =
  | { kind: 'apply-condition'; conditionId: string; durationTurns: number };

/** An optional POST-RESOLUTION continuation (U12): armed at activation, the
 * reducer resumes it after the ability's own mutations apply, so its query
 * sees the RESOLVED battlefield (movements/defeats final). `programId` is
 * the content-owned resume dispatch key (the content resolver/decision row
 * registered against it). */
export type HeroicPostResolutionContinuation =
  | { kind: 'hatred-of-closest-foe'; programId: string; durationTurns: number; tieIsRecordedChoice: true };

/**
 * The transaction's availability/cost/consequence contract per heroic-
 * granting source (content/jobs/heroic-activation-recipes.ts registers the
 * rows). The kernel folds ONLY these declared fields — content may extend
 * the recipe table as missing seams land without touching the kernel.
 * `missingSeams` is audit/provenance data AND the fail-closed gate: a row
 * with non-empty `missingSeams` never executes a partial version.
 */
export interface HeroicActivationRecipe {
  /** Opaque provenance only — the kernel never branches on it. */
  sourceId: string;
  /** Audit: the source halves this row cannot attach yet (precise blockers).
   * NON-EMPTY ⇒ the recipe is registered but FAILS CLOSED. */
  missingSeams: readonly string[];
  /** Content-declared applicability (trait ownership / class gambit + the
   * ability's catalog class). Pure function of durable metadata. */
  applies: (ctx: HeroicActivationContext) => boolean;
  /** Availability predicates (all must pass). */
  availability: readonly HeroicAvailability[];
  /** Costs paid atomically before resolution. */
  costs: readonly HeroicCost[];
  /** Pre-resolution consequences riding the resolution's event. */
  preResolutionEffects: readonly HeroicPreResolutionEffect[];
  /** Optional post-resolution continuation (e.g. Spite's hatred+ of the
   * closest foe, evaluated after the ability resolves). */
  postResolutionContinuation?: HeroicPostResolutionContinuation;
}

/** The registry: content rows register their source's activation contract at
 * module load (content → kernel, never kernel → content). */
const heroicActivationRecipes: HeroicActivationRecipe[] = [];

/** Register one heroic-granting source's activation contract (called by the
 * content rows in content/jobs/heroic-activation-recipes.ts). */
export function registerHeroicActivationRecipe(recipe: HeroicActivationRecipe): void {
  heroicActivationRecipes.push(recipe);
}

/** The registered recipes whose content-side applicability predicate covers
 * this declaration, in registration order. */
export function heroicActivationRecipesFor(ctx: HeroicActivationContext): HeroicActivationRecipe[] {
  return heroicActivationRecipes.filter((recipe) => recipe.applies(ctx));
}

/** The result of the activation transaction. `ok: true` carries the
 * recorded mutations that ride the resolution (plus an optional durable
 * post-resolution continuation arm); `ok: false` carries the fail-closed
 * code/detail (thrown by the command boundary as the authoritative rejection
 * before any cost, effect, or RNG). */
export type HeroicActivationResult =
  | { ok: true; recipe: HeroicActivationRecipe; mutations: RuleMutation[]; postResolutionContinuation?: ArmedContinuation }
  | { ok: false; code: string; detail: string };

/** The lockout condition mutation (owner turn-end duration) shared by the
 * lockout consequence rows. Condition `remove` clears on the owner's recorded
 * lifecycle; the attack gate reads the same condition id for Demon Strength. */
function lockoutMutations(recipe: HeroicActivationRecipe, effect: Extract<HeroicPreResolutionEffect, { kind: 'apply-condition' }>, actorId: string): RuleMutation[] {
  return [{
    kind: 'condition',
    sourceId: recipe.sourceId,
    sourceActorId: actorId,
    actorId,
    conditionId: effect.conditionId,
    operation: 'apply',
    potency: 'normal',
    duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: effect.durationTurns },
  }];
}

/** Build the durable U12 arm for a declared post-resolution continuation.
 * Pure construction: the record is correlated to the resolution's
 * `ability-used` fact instance, so a LATER ability use by the same actor can
 * never cross-fire it. The resolver/decision row registered against the
 * recipe's `programId` owns the resume body. */
function armPostResolutionContinuation(
  recipe: HeroicActivationRecipe,
  continuation: HeroicPostResolutionContinuation,
  actor: EncounterActor,
  resolutionId: string | undefined,
): ArmedContinuation {
  return armContinuation({
    id: `cont:heroic-post-resolution:${recipe.sourceId}:${resolutionId ?? actor.id}`,
    programId: continuation.programId,
    ownerRef: capturedActor(actor.id),
    // The trigger: THIS resolution's ability-use fact. The reducer resumes
    // fact-due continuations after the ability's mutations apply (the
    // post-resolution seam); the correlated instance id guarantees a later
    // unrelated ability use can never satisfy it.
    trigger: {
      kind: 'fact',
      factKind: 'ability-used',
      instanceId: resolutionId === undefined ? undefined : factInstanceId(resolutionId, 'ability-used', 0),
    },
    capturedValues: continuation.kind === 'hatred-of-closest-foe' ? { durationTurns: continuation.durationTurns } : {},
    payload: { kind: 'deferred-rule' },
  });
}

/**
 * Run the heroic activation transaction for `actor`. Returns the recorded
 * mutations on success (the binding boundary prepends them to the
 * resolution's event) plus the optional post-resolution continuation arm;
 * throws NOTHING itself — the binding boundary raises the `RuleViolation`
 * so the caller controls the failure surface. Every rejection happens BEFORE
 * any cost, effect, or RNG.
 *
 * FAIL CLOSED on a recipe with non-empty `missingSeams`: the declaration is
 * rejected with the precise blocker list — a partial source unit never
 * executes. When several recipes apply (a trait + a gambit edge), ANY
 * failing recipe blocks the declaration (the engine never picks a "best"
 * row); the first fully-passing recipe in registration order executes.
 */
export function resolveHeroicActivation(
  state: EncounterState,
  actor: EncounterActor,
  ctx: HeroicDeclarationContext = {},
): HeroicActivationResult {
  const recipes = heroicActivationRecipesFor({ actor, abilityId: ctx.abilityId, resolutionId: ctx.resolutionId });
  if (recipes.length === 0) {
    return { ok: false, code: 'rule.trigger-forged', detail: `Only a character with a heroic-granting trait or the Stalwart Gambit may declare Heroic; ${actor.name} cannot.` };
  }
  for (const recipe of recipes) {
    const reject = (code: string, detail: string): HeroicActivationResult => ({ ok: false, code, detail });

    // 0. Fail closed on partial source units: a registered recipe whose
    // mandatory source halves are not attachable never executes.
    if (recipe.missingSeams.length > 0) {
      return reject('rule.heroic-incomplete', `${recipe.sourceId}'s Heroic activation is not source-complete (missing: ${recipe.missingSeams.join(', ')}); the declaration fails closed — no partial version executes.`);
    }

    // 1. Availability predicates.
    for (const gate of recipe.availability) {
      if (gate.kind === 'not-locked-out') {
        if (actor.conditions.some(({ id }) => id === gate.conditionId)) {
          return reject('rule.heroic-lockout', 'A previous Heroic locks out further Heroics until the end of your next turn.');
        }
      } else if (gate.kind === 'once-per-round') {
        const ledgerKey = usageKey({ sourceId: gate.ledgerSourceId, ownerId: actor.id, scope: 'round' });
        if (!useLedgerAvailable(actor, ledgerKey)) {
          return reject('rule.heroic-round', 'This Heroic can be used once per round — already used this round.');
        }
      } else {
        const ledgerKey = usageKey({ sourceId: gate.ledgerSourceId, ownerId: actor.id, scope: 'combat' });
        if (!useLedgerAvailable(actor, ledgerKey)) {
          return reject('rule.heroic-combat', 'This Heroic can be used once per combat — already used this combat.');
        }
      }
    }

    // 2. Costs (Wolfheart): sacrifice N% of the BASE maximum hp (p.107
    // "% HEALTH"). Sacrifice cannot bring hp below 1 and may overpay while
    // the owner can pay at all (p.97 glossary) — the only LEGALLY unpayable
    // state is an owner at 0 hp, which fails the transaction atomically.
    const mutations: RuleMutation[] = [];
    for (const cost of recipe.costs) {
      if (cost.kind === 'sacrifice-percent') {
        const baseMax = actor.baseMaxHp;
        if (typeof baseMax !== 'number' || !Number.isFinite(baseMax) || baseMax <= 0) {
          return reject('rule.heroic-unavailable', 'This Heroic requires the base maximum hp to pay its sacrifice; it is unavailable.');
        }
        const fraction = baseMax * cost.percentOfBaseMaximumHp / 100;
        const amount = cost.rounding === 'up' ? Math.ceil(fraction) : Math.floor(fraction);
        if (actor.hp < 1) {
          return reject('rule.heroic-unavailable', 'This Heroic cannot be paid — the owner is at 0 hp and cannot legally sacrifice.');
        }
        mutations.push(sacrificeMutation(recipe.sourceId, actor.id, amount));
      }
    }

    // 3. Pre-resolution consequences (recorded mutations riding the event).
    for (const effect of recipe.preResolutionEffects) {
      if (effect.kind === 'apply-condition') mutations.push(...lockoutMutations(recipe, effect, actor.id));
    }

    // 4. Once-per-round / once-per-combat commits: the U16 transaction groups
    // the costs + consequences with the ledger consume in ONE bundle (the
    // boundary emits it verbatim; the gates above already proved the scope
    // was open, so the commit can never re-decide availability).
    for (const gate of recipe.availability) {
      if (gate.kind === 'once-per-round') {
        const transaction = applyOncePerRoundUsage({ actor, sourceId: gate.ledgerSourceId, mutations });
        if (!transaction.available) {
          return reject('rule.heroic-round', 'This Heroic can be used once per round — already used this round.');
        }
        return {
          ok: true,
          recipe,
          mutations: [...transaction.mutations],
          ...(recipe.postResolutionContinuation
            ? { postResolutionContinuation: armPostResolutionContinuation(recipe, recipe.postResolutionContinuation, actor, ctx.resolutionId) }
            : {}),
        };
      }
      if (gate.kind === 'once-per-combat') {
        const key = usageKey({ sourceId: gate.ledgerSourceId, ownerId: actor.id, scope: 'combat' });
        const consume = consumeUsageMutation(recipe.sourceId, actor.id, key);
        return {
          ok: true,
          recipe,
          mutations: [...mutations, consume],
          ...(recipe.postResolutionContinuation
            ? { postResolutionContinuation: armPostResolutionContinuation(recipe, recipe.postResolutionContinuation, actor, ctx.resolutionId) }
            : {}),
        };
      }
    }

    return {
      ok: true,
      recipe,
      mutations,
      ...(recipe.postResolutionContinuation
        ? { postResolutionContinuation: armPostResolutionContinuation(recipe, recipe.postResolutionContinuation, actor, ctx.resolutionId) }
        : {}),
    };
  }
  return { ok: false, code: 'rule.heroic-unavailable', detail: 'No executable heroic activation for this character.' };
}
