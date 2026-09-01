/**
 * Heroic activation transaction kernel (ICON pp.116 + the four heroic-
 * granting trait rows registered from content/jobs/heroic-activation-
 * recipes.ts).
 *
 * Heroic is a DECLARATION — the caller says "I use this ability's heroic
 * effects". It becomes an authoritative validated-player-activation ONLY
 * through this transaction: the content-registered row for the actor's
 * owned heroic-granting trait decides whether the declaration is legal,
 * what it costs, and what consequences it records. A caller naming `heroic`
 * never bypasses the transaction; owning a trait is never proof that a
 * specific activation was legal and paid.
 *
 * The kernel is generic (no source ids): it folds ONLY the fields the
 * content rows declare — lockout-gated availability, the Wolfheart
 * once-per-round U16 ledger + 25%-of-base-max sacrifice cost, and the
 * recorded lockout / hatred+ consequences. Content rows whose FULL source
 * consequence cannot yet be attached carry that audit data in
 * `missingSeams` (documented as precise blockers) — the representable
 * activation halves still execute exactly.
 *
 * Determinism/replay: every accepted activation returns the recorded
 * mutations (sacrifice HP cost, lockout/hatred conditions, and the
 * once-per-round ledger commit via the U16 grouping) that ride the
 * resolution's own event — replay applies exactly what the command decided;
 * nothing is re-decided or re-derived.
 */
import type { EncounterActor, EncounterState } from '../../types.js';
import { footprintDistance } from '../primitives/spatial-intent.js';
import { sacrificeMutation } from '../primitives/cost-payment.js';
import { usageKey } from '../primitives/usage.js';
import { applyOncePerRoundUsage, useLedgerAvailable } from './use-ledger.js';
import type { RuleMutation } from '../primitives/types.js';

/**
 * The transaction's availability/cost/consequence contract per heroic-
 * granting trait (content/jobs/heroic-activation-recipes.ts registers the
 * four rows). The kernel folds ONLY these declared fields — content may
 * extend this table as the missing seams land without touching the kernel.
 * `missingSeams` is audit/provenance data (the source halves this row cannot
 * attach yet); it never changes what executes.
 */
export type HeroicActivationRule =
  | {
      kind: 'strive';
      sourceId: 'bastion:trait:strive';
      /** Availability: a currently-active lockout from a prior heroic blocks
       * the declaration ("can't use heroics until the end of your next turn"). */
      requiresNotLockedOut: { conditionId: string };
      /** Consequence: the durable Heroic lockout until the owner's next
       * turn end (turn-end duration, 2 owner turn-ends). */
      applyLockout: { conditionId: string; durationTurns: number };
      /** Source halves without a generic seam: shove-distance +1 and
       * half-damage-during-that-turn. Precisely blocked, never dropped
       * silently. */
      missingSeams: readonly string[];
    }
  | {
      kind: 'demon-strength';
      sourceId: 'demon-slayer:trait:demon-strength';
      requiresNotLockedOut: { conditionId: string };
      applyLockout: { conditionId: string; durationTurns: number };
      /** Full activation represented (the attack gate consumes the same
       * condition id). */
      missingSeams: readonly [];
    }
  | {
      kind: 'wolfheart';
      sourceId: 'colossus:trait:wolfheart';
      /** Availability: once per ROUND — a round-scoped U16 usage ledger
       * commit grouped with the effect mutations on the resolution. */
      oncePerRound: { ledgerSourceId: string };
      /** Cost: sacrifice N% of the BASE maximum hp (p.107 "% HEALTH": percent
       * costs use the base max, never the wounds-adjusted bar; the declared
       * rounding is deterministic content data). */
      sacrifice: { percentOfBaseMaximumHp: number; rounding: 'up' | 'down' };
      /** Source half without a generic seam: +1 flight/rush/dash distance
       * as part of that move. Precisely blocked, never dropped silently. */
      missingSeams: readonly string[];
    }
  | {
      kind: 'spite';
      sourceId: 'knave:trait:spite';
      requiresNotLockedOut: { conditionId: string };
      applyLockout: { conditionId: string; durationTurns: number };
      /** Consequence: Hatred+ of the closest foe until the owner's next
       * turn end; an equidistant tie is a recorded U4 choice (no recorded
       * choice FAILS — never an invented tie-break). */
      applyHatred: { ofClosestFoe: true; tieIsRecordedChoice: true; durationTurns: number };
      missingSeams: readonly [];
    };

/** The registry: content rows register their trait's activation contract at
 * module load (content → kernel, never kernel → content). */
const heroicActivationRules: HeroicActivationRule[] = [];

/** Register one heroic-granting trait's activation contract (called by the
 * content rows in content/jobs/heroic-activation-recipes.ts). */
export function registerHeroicActivationRule(rule: HeroicActivationRule): void {
  heroicActivationRules.push(rule);
}

/** The registered activation rules the actor owns, in registration order.
 * The Stalwart class's four heroic-granting traits are mutually exclusive in
 * practice (one per job); if the data ever allows more, the presence of ANY
 * failing rule blocks activation (the engine never picks a "best" row). */
export function heroicActivationRulesFor(traitIds: readonly string[] | undefined): HeroicActivationRule[] {
  if (!traitIds) return [];
  return heroicActivationRules.filter((rule) => traitIds.includes(rule.sourceId));
}

/** The result of the activation transaction. `ok: true` carries the
 * recorded mutations that ride the resolution; `ok: false` carries the
 * fail-closed code/detail (thrown by the command boundary as the
 * authoritative rejection before any cost, effect, or RNG). */
export type HeroicActivationResult =
  | { ok: true; rule: HeroicActivationRule; mutations: RuleMutation[] }
  | { ok: false; code: string; detail: string };

/** Spite's nearest-foe choice: the unique closest foe derived from the
 * shared footprint metric, or — when several foes are equidistant — the
 * RECORDED U4 choice from the command input. An equidistant tie without a
 * recorded choice FAILS: the engine never invents the tie-break. */
function spiteClosestFoeId(state: EncounterState, actor: EncounterActor, chosenIds: readonly string[] | undefined): string | null {
  const foes = Object.values(state.actors).filter((candidate) =>
    candidate.id !== actor.id && candidate.side !== actor.side && !candidate.defeated && candidate.onBattlefield && candidate.position !== null);
  if (foes.length === 0) return null;
  const anchor = actor.position ?? { x: 0, y: 0 };
  const distances = foes.map((foe) => ({ foe, distance: footprintDistance({ position: anchor, size: actor.size }, { position: foe.position!, size: foe.size }) }));
  const minimum = Math.min(...distances.map((entry) => entry.distance));
  const closest = distances.filter((entry) => entry.distance === minimum);
  if (closest.length === 1) return closest[0]!.foe.id;
  // Equidistant tie: the choice MUST be recorded (U4), never invented.
  const chosen = chosenIds?.find((id) => closest.some((entry) => entry.foe.id === id));
  return chosen ?? null;
}

/** The lockout condition mutation (owner turn-end duration) shared by the
 * Strive / Demon Strength / Spite consequence rows. Condition `remove`
 * clears on the owner's recorded lifecycle; the attack gate reads the same
 * condition id for Demon Strength. */
function lockoutMutations(rule: Extract<HeroicActivationRule, { applyLockout: unknown }>, actorId: string): RuleMutation[] {
  return [{
    kind: 'condition',
    sourceId: rule.sourceId,
    sourceActorId: actorId,
    actorId,
    conditionId: rule.applyLockout.conditionId,
    operation: 'apply',
    potency: 'normal',
    duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: rule.applyLockout.durationTurns },
  }];
}

/** Spite's hatred+ of the chosen closest foe. The `hatred` CONDITION's
 * `sourceActorId` IS the hated foe's id — the shared condition apply path
 * records `ruleState['hatred-of']` from it, and the damage authority halves
 * damage against every foe other than X (encounter-adapter
 * `hatredDivertsDamage`, ICON p.104). */
function spiteMutations(rule: Extract<HeroicActivationRule, { applyHatred: unknown }>, state: EncounterState, actor: EncounterActor, chosenFoeIds: readonly string[] | undefined): RuleMutation[] | 'tie-unrecorded' {
  const hatedId = spiteClosestFoeId(state, actor, chosenFoeIds);
  if (hatedId === null) return 'tie-unrecorded';
  return [
    {
      kind: 'condition',
      sourceId: rule.sourceId,
      sourceActorId: hatedId, // ← the hated foe: the shared `hatred-of` provenance.
      actorId: actor.id,
      conditionId: 'hatred',
      operation: 'apply',
      potency: 'plus',
      duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: rule.applyHatred.durationTurns },
    },
    ...lockoutMutations(rule, actor.id),
  ];
}

/**
 * Run the heroic activation transaction for `actor`. Returns the recorded
 * mutations on success (the binding boundary prepends them to the
 * resolution's event); throws NOTHING itself — the binding boundary raises
 * the `RuleViolation` so the caller controls the failure surface. Every
 * rejection happens BEFORE any cost, effect, or RNG.
 */
export function resolveHeroicActivation(
  state: EncounterState,
  actor: EncounterActor,
  chosenClosestFoeIds: readonly string[] | undefined,
): HeroicActivationResult {
  const rules = heroicActivationRulesFor(actor.traitIds);
  if (rules.length === 0) {
    return { ok: false, code: 'rule.trigger-forged', detail: `Only a character with a heroic-granting trait (Strive, Demon Strength, Wolfheart, Spite) may declare Heroic; ${actor.name} cannot.` };
  }
  for (const rule of rules) {
    const reject = (code: string, detail: string): HeroicActivationResult => ({ ok: false, code, detail });

    // 1. Availability: a currently-active lockout blocks the declaration for
    // the lockout-gated traits (Strive / Demon Strength / Spite).
    if ('requiresNotLockedOut' in rule) {
      const locked = actor.conditions.some(({ id }) => id === rule.requiresNotLockedOut.conditionId);
      if (locked) {
        return reject('rule.heroic-lockout', 'A previous Heroic locks out further Heroics until the end of your next turn.');
      }
    }

    // 1b. Availability: Wolfheart's once-per-ROUND gate (U16 round ledger).
    if ('oncePerRound' in rule) {
      const ledgerKey = usageKey({ sourceId: rule.oncePerRound.ledgerSourceId, ownerId: actor.id, scope: 'round' });
      if (!useLedgerAvailable(actor, ledgerKey)) {
        return reject('rule.heroic-round', 'Wolfheart can make one ability Heroic per round — already used this round.');
      }
    }

    // 2. Cost (Wolfheart): sacrifice N% of the BASE maximum hp (p.107
    // "% HEALTH"). Sacrifice cannot bring hp below 1 and may overpay while
    // the owner can pay at all (p.97 glossary) — the only LEGALLY unpayable
    // state is an owner at 0 hp, which fails the transaction atomically.
    const mutations: RuleMutation[] = [];
    if ('sacrifice' in rule) {
      const baseMax = actor.baseMaxHp;
      if (typeof baseMax !== 'number' || !Number.isFinite(baseMax) || baseMax <= 0) {
        return reject('rule.heroic-unavailable', 'Wolfheart requires the base maximum hp to pay its sacrifice; it is unavailable.');
      }
      const fraction = baseMax * rule.sacrifice.percentOfBaseMaximumHp / 100;
      const amount = rule.sacrifice.rounding === 'up' ? Math.ceil(fraction) : Math.floor(fraction);
      if (actor.hp < 1) {
        return reject('rule.heroic-unavailable', 'Wolfheart cannot be paid — the owner is at 0 hp and cannot legally sacrifice.');
      }
      mutations.push(sacrificeMutation(rule.sourceId, actor.id, amount));
    }

    // 3. Consequences (recorded mutations riding the resolution's event).
    if ('applyHatred' in rule) {
      const spite = spiteMutations(rule, state, actor, chosenClosestFoeIds);
      if (spite === 'tie-unrecorded') {
        return reject('rule.heroic-spite-target', 'Spite requires the closest foe; multiple foes are equidistant — record the choice (the engine never invents a tie-break).');
      }
      mutations.push(...spite);
    } else if ('applyLockout' in rule) {
      mutations.push(...lockoutMutations(rule, actor.id));
    }

    // 4. Wolfheart's once-per-round commit: the U16 transaction groups the
    // sacrifice + consequences with the ledger consume in ONE bundle (the
    // boundary emits it verbatim; the gate above already proved the round
    // was open, so the commit can never re-decide availability).
    if ('oncePerRound' in rule) {
      const transaction = applyOncePerRoundUsage({ actor, sourceId: rule.oncePerRound.ledgerSourceId, mutations });
      if (!transaction.available) {
        return reject('rule.heroic-round', 'Wolfheart can make one ability Heroic per round — already used this round.');
      }
      return { ok: true, rule, mutations: [...transaction.mutations] };
    }
    return { ok: true, rule, mutations };
  }
  return { ok: false, code: 'rule.heroic-unavailable', detail: 'No executable heroic activation for this character.' };
}