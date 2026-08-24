/**
 * A structured rejection for a pre-resolution ability-use choice. Converted
 * to the encounter's `RuleViolation` at the command boundary so an invalid or
 * insufficiently-resourced choice is rejected before meaningful resolution.
 */
export class AbilityUseChoiceViolation extends Error {
  readonly code: 'unknown' | 'no-owner' | 'invalid-spend' | 'insufficient-resource';
  constructor(code: AbilityUseChoiceViolation['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'AbilityUseChoiceViolation';
  }
}

/**
 * F10 ability-use choice source projection (docs/rules-foundations.md §8).
 *
 * A slim, source-ID-free read surface that the choice fold consumes. It keeps
 * the fold from depending on the full EncounterActor shape while exposing the
 * durable reads it needs: the resolving actor's traits/resources, and any
 * living allied owners whose granted trait legitimizes a choice. The fold
 * never branches on a specific trait id; content supplies those.
 */

/** The minimal per-actor read the choice fold needs. */
export interface AbilityUseChoiceActor {
  id: string;
  side: string;
  defeated: boolean;
  onBattlefield: boolean;
  traitIds: readonly string[];
  resources: Readonly<Record<string, number>>;
}

export interface AbilityUseChoiceSource {
  self: AbilityUseChoiceActor;
  /** Living, on-battlefield actors on the same side as `self` (excluding self). */
  allies: readonly AbilityUseChoiceActor[];
}
