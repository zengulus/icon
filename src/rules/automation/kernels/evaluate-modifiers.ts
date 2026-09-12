/**
 * evaluate-modifiers.ts — U14 × U5/U6: the thin KERNEL-LAYER modifier-value
 * and modifier-APPLICABILITY evaluator.
 *
 * APPLICABILITY (U14 → U6, one authority): a modifier rule carries a U6
 * `RulePredicate` (`ModifierRule.applicability`). This module owns the two
 * halves of the seam:
 *
 *   - `modifierGatePredicate` — the LOSSLESS LOWERING of the modifier
 *     authoring shorthand (`ModifierGate`) onto U6 predicate vocabulary. It
 *     maps syntax; it NEVER decides truth.
 *   - `modifierApplicabilityHolds` — the boolean decision, delegated to
 *     `evaluatePredicate` over the predicate context the fold adapter
 *     projected. No other module may implement a modifier gate switch.
 *
 * The lowered predicate set is CLOSED and asserted at evaluation time: a
 * predicate outside it rejects (`modifier.applicability-unrepresentable`)
 * rather than being answered by a context that cannot represent it.
 *
 * VALUE: the thin U5 projection below (`resolveModifierNumber`).
 *
 * The U14 primitive fold (`primitives/modifiers.ts`) resolves numeric
 * modifier values through an INJECTED resolver (`ModifierNumberResolver`) —
 * the primitive never imports a U5 evaluation kernel, and the value language
 * is the full U5 `RuleNumber` vocabulary (no special dynamic literals
 * accumulate in U14). This module is that resolver: it projects the shared
 * `ModifierFoldView` onto the subset of the U5 algebra the fold view can
 * represent EXACTLY — constants, the dynamic `round`, and pure scalar
 * compositions (add / multiply / minimum / maximum / clamp / percent) over
 * them.
 *
 * FAIL CLOSED: any `RuleNumber` form that needs full execution context (a
 * stat/resource/input/count/distance/die read) throws a
 * `RuleProgramViolation` — the fold view cannot answer it, and a guessed
 * value would silently change the rule. Content that needs such dynamic
 * values must resolve them against full execution context at the command
 * boundary and pass the resolved constant into the fold, never smuggle a
 * context-dependent expression through the view.
 *
 * Replay semantics: a pure function of the expression and the durable view —
 * replay folds identically.
 *
 * No source IDs; no primitives imports beyond the typed vocabulary.
 */
import { RuleProgramViolation } from './violations.js';
import { evaluatePredicate } from './evaluate-predicate.js';
import type { ModifierFoldView, ModifierGate } from '../primitives/modifiers.js';
import type { RuleNumber, RulePredicate, RuleSelector } from '../primitives/types.js';

// ── Applicability (U14 → U6) ────────────────────────────────────────────────

/** The acting actor — the perspective every modifier gate is read from ("you
 * are Stealth", "your foe is bloodied"). */
const SELF: RuleSelector = { kind: 'self' };
/** The ability's attack target (the target-scoped gates). */
const ATTACK_TARGET: RuleSelector = { kind: 'attack-target' };

/** Lower the modifier authoring shorthand onto U6 predicate vocabulary.
 * LOSSLESS and PURE: this function maps one syntax onto the other and never
 * evaluates anything — the boolean decision belongs to `evaluatePredicate`.
 * Every variant preserves its exact prior semantics:
 *
 *   always            → always
 *   stealth           → has-condition(self, stealth)
 *   comeback/self-bloodied → bloodied(self)          (BASE max, p.81)
 *   charge            → slow-turn(self)              (durable p.95 flag)
 *   round-at-least N  → compare(round >= N)
 *   mastery A         → has-mastery(self, A)         (equipped AND mastered)
 *   choice S          → declared-choice(S)           (durable command input)
 *   target-bloodied   → all(bloodied(attack-target), relation(attack-target, foe))
 *   target-has-condition → all(has-condition(attack-target[, id]), relation(attack-target, foe))
 */
export function modifierGatePredicate(gate: ModifierGate): RulePredicate {
  switch (gate.kind) {
    case 'always': return { kind: 'always' };
    case 'stealth': return { kind: 'has-condition', target: SELF, conditionId: 'stealth' };
    case 'comeback': return { kind: 'bloodied', target: SELF };
    case 'self-bloodied': return { kind: 'bloodied', target: SELF };
    case 'charge': return { kind: 'slow-turn', target: SELF };
    case 'round-at-least': return { kind: 'compare', left: { kind: 'round' }, operator: '>=', right: { kind: 'constant', value: gate.value } };
    case 'mastery': return { kind: 'has-mastery', target: SELF, abilityId: gate.abilityId };
    case 'choice': return { kind: 'declared-choice', sourceId: gate.sourceId };
    // A target-scoped gate requires BOTH the state read AND a genuine hostile
    // attack target: the relation half is what keeps a same-side actor from
    // ever satisfying "your foe is bloodied" (the audit's allied-target case).
    case 'target-bloodied': return {
      kind: 'all',
      predicates: [
        { kind: 'bloodied', target: ATTACK_TARGET },
        { kind: 'relation', target: ATTACK_TARGET, relation: 'foe' },
      ],
    };
    case 'target-has-condition': return {
      kind: 'all',
      predicates: [
        {
          kind: 'has-condition',
          target: ATTACK_TARGET,
          ...(gate.conditionId === undefined ? {} : { conditionId: gate.conditionId }),
        },
        { kind: 'relation', target: ATTACK_TARGET, relation: 'foe' },
      ],
    };
  }
}

/** Lower a rule's full gate list: absent/empty = unconditional, one gate = that
 * predicate, several = their AND composition (exactly the previous
 * "every listed gate must hold"). */
export function modifierGatePredicates(gates: readonly ModifierGate[] | undefined): RulePredicate | undefined {
  if (gates === undefined || gates.length === 0) return undefined;
  const lowered = gates.map(modifierGatePredicate);
  return lowered.length === 1 ? lowered[0] : { kind: 'all', predicates: lowered };
}

/** The predicate kinds the modifier applicability context can answer exactly.
 * The set is CLOSED: it is exactly what `modifierGatePredicate` produces. */
function assertLoweredApplicability(predicate: RulePredicate): void {
  switch (predicate.kind) {
    case 'always':
    case 'bloodied':
    case 'has-condition':
    case 'relation':
    case 'slow-turn':
    case 'has-mastery':
    case 'declared-choice':
      return;
    case 'all': {
      for (const entry of predicate.predicates) assertLoweredApplicability(entry);
      return;
    }
    case 'compare': {
      if (predicate.left.kind === 'round' && predicate.right.kind === 'constant') return;
      break;
    }
  }
  throw new RuleProgramViolation(
    'modifier.applicability-unrepresentable',
    `The modifier applicability predicate '${predicate.kind}' is not part of the lowered modifier-gate vocabulary; lower the gate through modifierGatePredicate or resolve the clause against full execution context instead of smuggling it through a modifier rule.`,
  );
}

/**
 * THE modifier applicability authority: does this rule's recorded U6 predicate
 * hold for the fold view's acting actor right now? Delegates the boolean to
 * `evaluatePredicate` (the ONE predicate evaluator) over the durable context
 * the fold adapter projected (`view.applicabilityContext`), which carries the
 * same `encounterRuleState` projection every other kernel reads.
 *
 * FAILS CLOSED: an applicability predicate the projected context cannot
 * represent (outside the lowered vocabulary, or no context at all) THROWS —
 * it never silently applies (granting the modifier unconditionally) and never
 * silently skips (hiding the missing authority). Replay evaluates the same
 * recorded predicate against the same durable state, so the answer never
 * changes between the command boundary and replay.
 */
export function modifierApplicabilityHolds(
  applicability: RulePredicate | undefined,
  view: ModifierFoldView,
): boolean {
  if (applicability === undefined) return true;
  assertLoweredApplicability(applicability);
  const context = view.applicabilityContext?.(view.actor.id, view.target?.id);
  if (context === undefined) {
    throw new RuleProgramViolation(
      'modifier.applicability-context-missing',
      'A modifier rule carries an applicability predicate but the fold view projects no U6 predicate context; the modifier cannot be decided against the durable state.',
    );
  }
  return evaluatePredicate(applicability, context);
}

/** Resolve a U5 `RuleNumber` against the fold view — constants, the dynamic
 * round, and pure scalar compositions over them. Anything richer fails
 * closed (the fold view cannot represent it exactly). */
export function resolveModifierNumber(expression: RuleNumber, view: ModifierFoldView): number {
  switch (expression.kind) {
    case 'constant':
      return expression.value;
    case 'round':
      return view.round;
    case 'add':
      return expression.values.reduce((total, value) => total + resolveModifierNumber(value, view), 0);
    case 'multiply':
      return expression.values.reduce((total, value) => total * resolveModifierNumber(value, view), 1);
    case 'minimum':
      return Math.min(...expression.values.map((value) => resolveModifierNumber(value, view)));
    case 'maximum':
      return Math.max(...expression.values.map((value) => resolveModifierNumber(value, view)));
    case 'clamp': {
      const value = resolveModifierNumber(expression.value, view);
      const minimum = expression.minimum ? resolveModifierNumber(expression.minimum, view) : Number.NEGATIVE_INFINITY;
      const maximum = expression.maximum ? resolveModifierNumber(expression.maximum, view) : Number.POSITIVE_INFINITY;
      return Math.min(maximum, Math.max(minimum, value));
    }
    case 'percent': {
      const value = resolveModifierNumber(expression.value, view) * expression.percent / 100;
      return expression.rounding === 'up' ? Math.ceil(value) : expression.rounding === 'down' ? Math.floor(value) : Math.round(value);
    }
    default:
      throw new RuleProgramViolation(
        'modifier.value-unrepresentable',
        `RuleNumber '${expression.kind}' cannot be resolved against the modifier fold view — resolve it against full execution context at the command boundary instead of smuggling a context-dependent expression through a modifier value.`,
      );
  }
}
