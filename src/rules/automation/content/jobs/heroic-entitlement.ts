/**
 * Heroic entitlement registry (trigger-authority gate, ICON p.95 + the
 * heroic-granting class traits).
 *
 * "Heroic" is a DECLARATION: the player says "I use this ability's heroic
 * effects". It only becomes an authoritative trigger activation when the
 * engine can validate the character is genuinely entitled to declare it —
 * i.e. the actor owns one of the source-defined heroic-granting traits:
 *
 * - `bastion:trait:strive` (p.121) — "You may cause any ability to trigger
 *   its heroic effects when you use it…";
 * - `demon-slayer:trait:demon-strength` (p.127) — "You can make any ability
 *   Heroic when you use it…";
 * - `colossus:trait:wolfheart` (p.192) — "…you may sacrifice 25% of your max
 *   hp to make an ability Heroic…";
 * - `knave:trait:spite` (p.141) — "You can choose to use the Heroic effects
 *   of any ability when you use it…".
 *
 * A caller naming `heroic` on a character owning NONE of these fails closed
 * (`rule.trigger-forged`) before any cost/effect/RNG — "I choose Heroic" is
 * intent only until entitlement is proven. The CONSEQUENCES the traits
 * attach to that declaration (Strive's shove +1 / lockout, Demon Strength's
 * no-attack-until-following-turn, Wolfheart's sacrifice, Spite's hatred+)
 * remain content-owned fold seams; this registry proves only the entitlement
 * that turns the declaration into a validated activation.
 *
 * This is content data (named source trait IDs); the predicate itself stays
 * generic at the command boundary.
 */
export const HEROIC_GRANTING_TRAIT_IDS: ReadonlySet<string> = new Set([
  'bastion:trait:strive',
  'demon-slayer:trait:demon-strength',
  'colossus:trait:wolfheart',
  'knave:trait:spite',
]);

/** True when the actor owns at least one heroic-granting trait and can
 * therefore legitimately declare the Heroic trigger. */
export function canDeclareHeroic(traitIds: readonly string[] | undefined): boolean {
  if (!traitIds) return false;
  return traitIds.some((traitId) => HEROIC_GRANTING_TRAIT_IDS.has(traitId));
}