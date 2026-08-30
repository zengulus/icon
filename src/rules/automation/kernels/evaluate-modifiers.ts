/**
 * evaluate-modifiers.ts — U14 × U5: the thin KERNEL-LAYER modifier-value
 * evaluator.
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
import type { ModifierFoldView } from '../primitives/modifiers.js';
import type { RuleNumber } from '../primitives/types.js';

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
