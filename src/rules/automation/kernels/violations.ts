/**
 * violations.ts — the shared rule-program violation type.
 *
 * Extracted out of `kernels/runtime.ts` so the query/value/predicate kernels
 * can throw this error without importing the VM barrel (which imports them),
 * avoiding a kernel↔kernel import cycle. `kernels/runtime.ts` re-exports the
 * class, so every existing `import { RuleProgramViolation } from
 * './runtime.js'` keeps working unchanged.
 */
export class RuleProgramViolation extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RuleProgramViolation';
  }
}
