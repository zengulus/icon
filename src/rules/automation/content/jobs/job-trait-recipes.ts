/**
 * F6 job-trait foundation (docs/rules-foundations.md §7).
 *
 * The closed inventory of all 65 Job traits. Every row states exactly how the
 * trait is executed: `wired` rows have real engine mechanics (condition
 * projection, lifecycle recipe, typed resolver, or a command/kernel hook)
 * with source fixtures in `__tests__/job-traits.test.ts`; `documented` rows
 * stay source-visible (never approximated) with the exact ruling a player or
 * GM makes at the table, exactly like `TABLE_FACING_MECHANICS` in core.ts.
 *
 * Wiring homes:
 * - `passive-projection.ts` — `JOB_TRAIT_CONDITION_RECIPES` (whole-combat
 *   static condition grants, e.g. sealer martial arts → dodge).
 * - `turn-transition.ts` — lifecycle recipes (turn-end/turn-start/round-start
 *   rows, incl. the F3 `round-start` phase this foundation adds).
 * - `job-trait-resolvers.ts` — active typed resolvers (EXECUTE_RULE 'use').
 * - `encounter.ts` / `movement.ts` / `encounter-adapter.ts` — the small
 *   command/kernel hooks (combat-start durable grants, dash cost, terrain
 *   immunity, entity caps).
 *
 * A row is only `wired` when all five foundation requirements hold: durable
 * record, shared kernel, declarative recipe, closed source-ID manifest, and
 * a deterministic replay fixture. Everything else is explicitly `documented`.
 */
export type JobTraitStatus = 'wired' | 'documented';

export interface JobTraitRecipe {
  sourceId: string;
  name: string;
  status: JobTraitStatus;
  /** What the engine resolves deterministically. */
  mechanic: string;
  /** The ruling / remaining table-facing behavior (documented rows). */
  detail: string;
}

export const JOB_TRAIT_RECIPES: Readonly<Record<string, JobTraitRecipe>> = {
  // ------------------------------------------------------------------ bastion
  'bastion:trait:strive': {
    sourceId: 'bastion:trait:strive', name: 'Strive', status: 'documented',
    mechanic: '',
    detail: 'Making any ability Heroic and the +1 shove distance are a Heroics-economy choice; the half-damage-until-next-turn penalty is a caller decision at the table.',
  },
  'bastion:trait:press-the-advantage': {
    sourceId: 'bastion:trait:press-the-advantage', name: 'Press the Advantage', status: 'documented',
    mechanic: '',
    detail: 'The once-a-round shove-triggered rush of you and a chosen ally anywhere is a reactive choice (which ally, and whether they rush) at the table.',
  },
  'bastion:trait:bull-s-strength': {
    sourceId: 'bastion:trait:bull-s-strength', name: 'Bull\u2019s Strength', status: 'wired',
    mechanic: 'Abilities gain \u201ccollide: deal 2 damage\u201d through the collide fold in executeRuleProgramWithReactiveTriggers: when one of the ability\u2019s shoves collides (the shared collidingShoveTargets detection), the shoved character takes 2 damage, once per turn (guard set at plan time, cleared by the turn-end recipe).',
    detail: '',
  },
  'bastion:trait:shieldmaster': {
    sourceId: 'bastion:trait:shieldmaster', name: 'Shieldmaster', status: 'wired',
    mechanic: 'The trait owns a generic Aura definition (aura 1, allies); the turn-end lifecycle recipe asks the shared aura kernel whether an ally is inside, then grants vigilance +1 and a sturdy condition that clears at the start of the owner\u2019s turn (turn-start duration).',
    detail: '',
  },
  // -------------------------------------------------------------- demon-slayer
  'demon-slayer:trait:demon-edge': {
    sourceId: 'demon-slayer:trait:demon-edge', name: 'Demon Edge', status: 'wired',
    mechanic: 'Triggering a slow-turn or delay (a delay-tagged ability or one that sets six-hells:slow-turn) arms the trait\u2019s window as recorded mutations on the ability\u2019s event: vigilance +1, +1 bonus damage (the shared bonus-damage die) until the end of the owner\u2019s next turn (turn-end recipe clears the window), and a one-shot true strike consumed by the next attack (both attack paths read the armed state through the attack-modifier kernel).',
    detail: '',
  },
  'demon-slayer:trait:demon-strength': {
    sourceId: 'demon-slayer:trait:demon-strength', name: 'Demon Strength', status: 'documented',
    mechanic: '',
    detail: 'Making any ability Heroic and the no-attack/no-Heroics-until-next-turn lockout is a Heroics-economy choice at the table.',
  },
  'demon-slayer:trait:hissatsu': {
    sourceId: 'demon-slayer:trait:hissatsu', name: 'Hissatsu', status: 'wired',
    mechanic: 'Taking a turn without attacking arms the next attack (turn-end recipe on the ending actor\u2019s attackedThisTurn flag): +1 boon, true strike, and a d10 damage die, consumed by the next attack roll through the attack-modifier kernel (VM rolls and the direct basic-attack path both read the armed state).',
    detail: '',
  },
  'demon-slayer:trait:true-horn': {
    sourceId: 'demon-slayer:trait:true-horn', name: 'True Horn', status: 'wired',
    mechanic: 'Sturdy is durably granted at the start of every round (round-start phase) and cleared at the start of the owner\u2019s turn (turn-start), so the character is sturdy during other actors\u2019 turns within the round.',
    detail: '',
  },
  // ---------------------------------------------------------------- colossus
  'colossus:trait:furious-berserk': {
    sourceId: 'colossus:trait:furious-berserk', name: 'Furious Berserk', status: 'wired',
    mechanic: 'Starts combat with a durable Defiance condition; regeneration is a whole-combat condition projection (and is regained after Rescue by the trait). While bloodied, the owner is sturdy (the HP-threshold projection, content/jobs/hp-threshold-recipes.ts) and gains vigilance +1 at the end of their turn (turn-end recipe).',
    detail: '',
  },
  'colossus:trait:wolfheart': {
    sourceId: 'colossus:trait:wolfheart', name: 'Wolfheart', status: 'documented',
    mechanic: '',
    detail: 'The once-a-round sacrifice-25%-to-make-Heroic and +1 flight/rush/dash distance is a Heroics-economy caller choice at the table.',
  },
  'colossus:trait:pulverize': {
    sourceId: 'colossus:trait:pulverize', name: 'Pulverize', status: 'wired',
    mechanic: 'A pure elevation read in the attack-modifier kernel: attacking a target at least one elevation lower deals +2 flat damage on the attack\u2019s direct damage, and at two or more elevations lower the attack exceeds on a 13+ instead of 15+ (the VM exceed trigger honors the roll\u2019s threshold).',
    detail: '',
  },
  'colossus:trait:great-leap': {
    sourceId: 'colossus:trait:great-leap', name: 'Great Leap', status: 'documented',
    mechanic: '',
    detail: 'Gaining flying for the duration of a movement that ends lower needs a movement-planner elevation hook.',
  },
  // ------------------------------------------------------------------- knave
  'knave:trait:martial-master': {
    sourceId: 'knave:trait:martial-master', name: 'Martial Master', status: 'documented',
    mechanic: '',
    detail: 'The two-stances-at-once allowance needs the stance-entry gate to permit a second stance only for this trait; the stance refresh ordering is a reducer decision.',
  },
  'knave:trait:blackheart': {
    sourceId: 'knave:trait:blackheart', name: 'Blackheart', status: 'wired',
    mechanic: 'At the end of the owner\u2019s turn, suffering one or more statuses grants vigilance +1; suffering two or more also grants a bonus-damage charge (the p.102 resource the next damage roll consumes).',
    detail: '',
  },
  'knave:trait:taunt': {
    sourceId: 'knave:trait:taunt', name: 'Taunt', status: 'wired',
    mechanic: 'A free action targeting a foe in range 3 applies Hatred of the user (the durable `hatred-of` provenance the damage pipeline halves against).',
    detail: '',
  },
  'knave:trait:spite': {
    sourceId: 'knave:trait:spite', name: 'Spite', status: 'documented',
    mechanic: '',
    detail: 'Choosing Heroic effects on any ability and the resulting Hatred+ / no-Heroics lockout is a Heroics-economy caller choice at the table.',
  },
  // -------------------------------------------------------------------- fool
  'fool:trait:tumbling': {
    sourceId: 'fool:trait:tumbling', name: 'Tumbling', status: 'documented',
    mechanic: '',
    detail: 'Phasing through characters and entering their space for a maximum of 1 movement is a movement-planner occupancy-cost rule.',
  },
  'fool:trait:curse-of-chaos': {
    sourceId: 'fool:trait:curse-of-chaos', name: 'Curse of Chaos', status: 'documented',
    mechanic: '',
    detail: 'Evasion against characters 3+ spaces away needs a distance-gated evasion read in the attack path (a plain condition projection would evade everyone).',
  },
  'fool:trait:cheap-trick': {
    sourceId: 'fool:trait:cheap-trick', name: 'Cheap Trick', status: 'documented',
    mechanic: '',
    detail: 'The attack-missed-you teleport-1-and-leave-a-bomb is a reactive window with no engine attack-miss hook yet.',
  },
  'fool:trait:stack-dice': {
    sourceId: 'fool:trait:stack-dice', name: 'Stack Dice', status: 'documented',
    mechanic: '',
    detail: 'The once-a-round Stacked Die on finishing-blow/slay and the gamble-consume effect need a gamble resource and a gamble hook.',
  },
  // -------------------------------------------------------------- freelancer
  'freelancer:trait:bound-spirit': {
    sourceId: 'freelancer:trait:bound-spirit', name: 'Bound Spirit', status: 'wired',
    mechanic: 'Summons the persistent Astral Seraph companion in range 2 at combat start (round-start recipe, once per combat); the companion survives the owner\u2019s defeat. The seraph\u2019s lash-out summon action stays table-facing.',
    detail: 'The seraph\u2019s critical/finishing-blow/exceed lash-out for 2 unerring damage at exactly range 3 is a summon-trigger window.',
  },
  'freelancer:trait:aether-shot': {
    sourceId: 'freelancer:trait:aether-shot', name: 'Aether Shot', status: 'documented',
    mechanic: '',
    detail: 'Attacks on rounds 3 and 6 gaining bonus damage and triggering exceed needs a round-gated attack-path modifier hook.',
  },
  'freelancer:trait:trigrammaton': {
    sourceId: 'freelancer:trait:trigrammaton', name: 'Trigrammaton', status: 'wired',
    mechanic: 'The exactly-range-3 attack-path rule is wired through the shared attack-modifier fold: abilities used against a foe at exactly range 3 (the canonical p.92 footprint distance) gain +1 boon on attack rolls and unerring (ignore cover + aetherwall). The distance read never widens targeting range.',
    detail: '',
  },
  'freelancer:trait:astral-binding': {
    sourceId: 'freelancer:trait:astral-binding', name: 'Astral Binding', status: 'documented',
    mechanic: '',
    detail: 'The two-marks-stack allowance needs the mark-stack gate; the free-action teleport-all-marked-1 is a position choice.',
  },
  // ------------------------------------------------------------------- shade
  'shade:trait:shadow-arts': {
    sourceId: 'shade:trait:shadow-arts', name: 'Shadow Arts', status: 'wired',
    mechanic: 'Phasing is a whole-combat condition projection (the movement planner already treats it as ignoring terrain/occupancy).',
    detail: 'Immune to blinded needs a per-status immunity mechanism that does not exist yet.',
  },
  'shade:trait:underworld': {
    sourceId: 'shade:trait:underworld', name: 'Underworld', status: 'documented',
    mechanic: '',
    detail: 'Unerring plus bonus damage against foes in pits/difficult/dangerous terrain needs a terrain-gated attack-path modifier hook.',
  },
  'shade:trait:darkside': {
    sourceId: 'shade:trait:darkside', name: 'Darkside', status: 'documented',
    mechanic: '',
    detail: 'Leaving a shadow on first vacating a space is a movement-vacate hook.',
  },
  'shade:trait:meld': {
    sourceId: 'shade:trait:meld', name: 'Meld', status: 'documented',
    mechanic: '',
    detail: 'The once-a-round swap with a shadow in range 3 needs an entity-position mutation (the entity model only creates/removes whole entities).',
  },
  // ------------------------------------------------------------------ warden
  'warden:trait:beast-master': {
    sourceId: 'warden:trait:beast-master', name: 'Beast Master', status: 'wired',
    mechanic: 'Summons the persistent Great Beast companion in range 2 at combat start (round-start recipe, once per combat); the companion survives the owner\u2019s defeat. The beast\u2019s summon action stays table-facing.',
    detail: 'The beast\u2019s dash-2-then-bite/shove summon action is a summon-trigger window.',
  },
  'warden:trait:path-of-the-aesi': {
    sourceId: 'warden:trait:path-of-the-aesi', name: 'Path of the Aesi', status: 'wired',
    mechanic: 'While the owner has Stealth, the Dash command costs no action (the MOVE dash cost is waived in the reducer).',
    detail: '',
  },
  'warden:trait:ambush-master': {
    sourceId: 'warden:trait:ambush-master', name: 'Ambush Master', status: 'documented',
    mechanic: '',
    detail: 'Abilities from stealth ignoring cover and dealing bonus damage need an attack-path stealth-gated modifier hook.',
  },
  'warden:trait:green-kenning': {
    sourceId: 'warden:trait:green-kenning', name: 'Green Kenning', status: 'wired',
    mechanic: 'The owner ignores terrain movement penalties (difficult, dangerous, and elevation costs) in the movement planner.',
    detail: 'The granted-dash half (\u201cany time you grant a dash\u201d) needs a dash-grant hook and stays table-facing.',
  },
  // ------------------------------------------------------------------ chanter
  'chanter:trait:blessing-of-faith': {
    sourceId: 'chanter:trait:blessing-of-faith', name: 'Blessing of Faith', status: 'documented',
    mechanic: '',
    detail: 'Spending a blessing token while using any ability for True Strike and fly 2 (or three tokens for charge effects) needs an ability-use blessing-spend hook.',
  },
  'chanter:trait:songweave': {
    sourceId: 'chanter:trait:songweave', name: 'Songweave', status: 'documented',
    mechanic: '',
    detail: 'Spending a combo token to activate charge effects (and the base-version swap for combo abilities) needs an ability-use combo-spend hook.',
  },
  'chanter:trait:divine-grace': {
    sourceId: 'chanter:trait:divine-grace', name: 'Divine Grace', status: 'documented',
    mechanic: '',
    detail: 'The once-a-round gain/spend-combo reactive fly-2-and-Bless is a combo-trigger window.',
  },
  'chanter:trait:uplift': {
    sourceId: 'chanter:trait:uplift', name: 'Uplift', status: 'documented',
    mechanic: '',
    detail: 'The first fly-ability per round letting all allies fly 1 needs a fly-ability hook.',
  },
  // ---------------------------------------------------------------- harvester
  'harvester:trait:blessing-of-rebirth': {
    sourceId: 'harvester:trait:blessing-of-rebirth', name: 'Blessing of Rebirth', status: 'wired',
    mechanic: 'For self and allies using any ability: spend 1 blessing for pierce + bonus damage, or 3 to also force slay effects (ability-use choice fold).',
    detail: '',
  },
  'harvester:trait:mark-of-tsumi': {
    sourceId: 'harvester:trait:mark-of-tsumi', name: 'Mark of Tsumi', status: 'wired',
    mechanic: 'At the end of the owner\u2019s turn, every foe marked by the owner takes 2 piercing damage, then the owner is blessed (the first-listed branch of the \u201cbless either yourself or all allies marked by you\u201d choice).',
    detail: 'The alternative branch (bless every marked ally instead) is a caller choice; the deterministic branch is the first-listed one.',
  },
  'harvester:trait:gardener-of-kin': {
    sourceId: 'harvester:trait:gardener-of-kin', name: 'Gardener of Kin', status: 'documented',
    mechanic: '',
    detail: 'The two-marks-stack allowance needs the mark-stack gate; the +1 summon damage against marked foes needs a summon-damage modifier hook.',
  },
  'harvester:trait:balance': {
    sourceId: 'harvester:trait:balance', name: 'Balance', status: 'documented',
    mechanic: '',
    detail: 'All abilities gaining \u201cslay: cure yourself or any ally\u201d needs a slay-trigger cure hook.',
  },
  // ------------------------------------------------------------------ sealer
  'sealer:trait:blessing-of-war': {
    sourceId: 'sealer:trait:blessing-of-war', name: 'Blessing of War', status: 'wired',
    mechanic: 'For self and allies using any ability: spend 1 blessing for +1 attack boon + bonus damage, or 3 to also force exceed effects (ability-use choice fold).',
    detail: '',
  },
  'sealer:trait:mantra-of-sealing': {
    sourceId: 'sealer:trait:mantra-of-sealing', name: 'Mantra of Sealing', status: 'documented',
    mechanic: '',
    detail: 'Attacks blessing all adjacent allies and granting them 2 vigor needs an attack-completion hook.',
  },
  'sealer:trait:godly-smite': {
    sourceId: 'sealer:trait:godly-smite', name: 'Godly Smite', status: 'wired',
    mechanic: 'Starts combat with a mantra power die at 1 that ticks +1 at the start of every round to a maximum of 6 (round-start recipe).',
    detail: 'The attack-roll interrupt (add the die to a seen attack total, then the foe takes that much damage again) needs an attack-roll window that is not one of the six p.107 triggers yet.',
  },
  'sealer:trait:martial-arts': {
    sourceId: 'sealer:trait:martial-arts', name: 'Martial Arts', status: 'wired',
    mechanic: 'Dodge is a whole-combat condition projection (missed attacks, successful saves, and area effects deal no damage).',
    detail: '',
  },
  // -------------------------------------------------------------------- seer
  'seer:trait:the-wheel-of-fate': {
    sourceId: 'seer:trait:the-wheel-of-fate', name: 'The Wheel of Fate', status: 'documented',
    mechanic: '',
    detail: 'The 13-card deck, hand-size cap, and persist-through-combats discard/shuffle bookkeeping is narrative table infrastructure.',
  },
  'seer:trait:skein': {
    sourceId: 'seer:trait:skein', name: 'Skein', status: 'documented',
    mechanic: '',
    detail: 'Drawing a card at the start of your turn (and an extra at the end if you did not attack) is deck bookkeeping.',
  },
  'seer:trait:foretell': {
    sourceId: 'seer:trait:foretell', name: 'Foretell', status: 'documented',
    mechanic: '',
    detail: 'The 13-card Great Wheel effects applied to an ally before they use an ability is a table-facing card resolution.',
  },
  'seer:trait:bend-fate': {
    sourceId: 'seer:trait:bend-fate', name: 'Bend Fate', status: 'documented',
    mechanic: '',
    detail: 'Discarding cards after a gamble to roll extra dice is a gamble hook plus deck bookkeeping.',
  },
  'seer:trait:karma': {
    sourceId: 'seer:trait:karma', name: 'Karma', status: 'documented',
    mechanic: '',
    detail: 'Allies being immune to your area effects (and gaining 2 vigor + a Blessing instead) needs an area-inclusion ally hook.',
  },
  // ------------------------------------------------------------------ enochian
  'enochian:trait:inner-furnace': {
    sourceId: 'enochian:trait:inner-furnace', name: 'Inner Furnace', status: 'documented',
    mechanic: '',
    detail: 'The once-a-round sacrifice-25%-to-reduce-Aether-cost-by-2 on Infuse is a caller choice on an Infuse trigger.',
  },
  'enochian:trait:embersoul': {
    sourceId: 'enochian:trait:embersoul', name: 'Embersoul', status: 'wired',
    mechanic: 'Starts combat with a durable Defiance condition; regeneration is a whole-combat condition projection (and is regained after Rescue by the trait).',
    detail: '',
  },
  'enochian:trait:phoenix-rage': {
    sourceId: 'enochian:trait:phoenix-rage', name: 'Phoenix Rage', status: 'wired',
    mechanic: 'From round 5, the owner gains a durable Defiance condition at the start of every round (round-start recipe), so it returns each round after being consumed.',
    detail: 'The wound-gamble (\u201cwhen you would take a wound, gamble; on a 4+ ignore it, 2+ on the last wound\u201d) needs a wound-taking hook and stays table-facing.',
  },
  'enochian:trait:soulfire': {
    sourceId: 'enochian:trait:soulfire', name: 'Soulfire', status: 'documented',
    mechanic: '',
    detail: 'The Comeback-gated 18+/13+ (15+/10+ at 1 hp) critical/exceed thresholds need an attack-path threshold hook.',
  },
  // ---------------------------------------------------------------- geomancer
  'geomancer:trait:aftershock': {
    sourceId: 'geomancer:trait:aftershock', name: 'Aftershock', status: 'documented',
    mechanic: '',
    detail: 'The attack-triggered aftershock with the Delay/slow-turn follow-up needs an attack hook plus a delayed-terrain recipe.',
  },
  'geomancer:trait:resonance': {
    sourceId: 'geomancer:trait:resonance', name: 'Resonance', status: 'documented',
    mechanic: '',
    detail: 'Exactly-range-3 attacks gaining bonus damage, 1 Aether, and 3 vigor needs a distance-gated attack-path modifier hook.',
  },
  'geomancer:trait:orogenic-rage': {
    sourceId: 'geomancer:trait:orogenic-rage', name: 'Orogenic Rage', status: 'wired',
    mechanic: 'From round 5, the owner gains a durable Unstoppable condition at the start of every round (round-start recipe) and the rage marker is set.',
    detail: 'The aftershock-double-damage half needs the Aftershock mechanic and stays table-facing with it.',
  },
  'geomancer:trait:stone-double': {
    sourceId: 'geomancer:trait:stone-double', name: 'Stone Double', status: 'documented',
    mechanic: '',
    detail: 'Leaving a height-1 statue object on first vacating a space is a movement-vacate hook.',
  },
  // ---------------------------------------------------------------- spellblade
  'spellblade:trait:aether-deflection': {
    sourceId: 'spellblade:trait:aether-deflection', name: 'Aether Deflection', status: 'documented',
    mechanic: '',
    detail: 'The Interrupt-1 \u201ctargeted by an ability from range 2\u201d resistance needs a targeted-by-ability window row; the once-per-combat use with the spend-2-Aether regain is a use ledger.',
  },
  'spellblade:trait:conqueror-s-edge': {
    sourceId: 'spellblade:trait:conqueror-s-edge', name: 'Conqueror\u2019s Edge', status: 'documented',
    mechanic: '',
    detail: 'The Infuse cost reduction with a foe in range 2 and the infuse-as-slay allowance need an Infuse-cost kernel hook.',
  },
  'spellblade:trait:storm-hilt-rage': {
    sourceId: 'spellblade:trait:storm-hilt-rage', name: 'Storm Hilt Rage', status: 'wired',
    mechanic: 'From round 5, the rage marker is set at the start of every round (round-start recipe).',
    detail: 'The battlefield-range teleports and the free teleport before any ability are caller choices on the documented rage.',
  },
  'spellblade:trait:klingenkunst': {
    sourceId: 'spellblade:trait:klingenkunst', name: 'Klingenkunst', status: 'wired',
    mechanic: 'A free action that teleports the user to a chosen in-grid space within range 2 (typed resolver).',
    detail: 'The interrupt-other-abilities-or-movement utility is a timing choice; the teleport itself is wired.',
  },
  // --------------------------------------------------------------- stormbender
  'stormbender:trait:selkie': {
    sourceId: 'stormbender:trait:selkie', name: 'Selkie', status: 'wired',
    mechanic: 'Summons the bound elemental companion in range 3 at combat start (round-start recipe, once per combat). The selkie\u2019s summon action stays table-facing.',
    detail: 'The selkie\u2019s end-of-turn fly-3 (removing and re-placing characters in its space) is a summon-trigger window.',
  },
  'stormbender:trait:dash-on-the-rocks': {
    sourceId: 'stormbender:trait:dash-on-the-rocks', name: 'Dash on the Rocks', status: 'wired',
    mechanic: '1/round when you cause a character to collide, fold into the ability\u2019s mutation stream: gain 1 aether and deal 1 piercing damage as a burst-1 area effect centered on the collided character (the burst never affects the ability user, p.97). The once-per-round gate is a durable round ledger reset at each round start via the reactive job-trait fold (kernels/trait-reactions.ts, content/jobs/trait-reactions.ts).',
    detail: '',
  },
  'stormbender:trait:sea-legs': {
    sourceId: 'stormbender:trait:sea-legs', name: 'Sea Legs', status: 'documented',
    mechanic: '',
    detail: 'Bonus damage against foes in pits/difficult/dangerous terrain needs a terrain-gated modifier hook; flying inside your own terrain needs a spatial terrain check.',
  },
  'stormbender:trait:pelagic-rage': {
    sourceId: 'stormbender:trait:pelagic-rage', name: 'Pelagic Rage', status: 'documented',
    mechanic: '',
    detail: 'The round-5 aura 2 (flying + cover for allies, difficult/dangerous for foes) is an aura mechanic that does not exist yet.',
  },
};

import type { CombatStartTraitRecipe } from '../../kernels/lifecycle.js';

/**
 * Combat-start trait effects (F6): the durable grants and persistent
 * companion summons applied once on ENCOUNTER_STARTED (see the kernel type).
 * Consumable conditions (Defiance) are granted durably here - never
 * projected, because a projection is re-derived on every condition-set read
 * and would resurrect a consumed condition. `initState` seeds per-combat rule
 * state (e.g. the mantra die at 1, p.196); `summon` places the persistent
 * companion (state.companion) that survives the owner's defeat. The rows are
 * registered into the lifecycle kernel by `content/registry.ts`.
 */
export const COMBAT_START_TRAIT_RECIPES: Readonly<Record<string, CombatStartTraitRecipe>> = {
  // ICON p.190 Enochian Embersoul: "Start combat with regeneration and
  // defiance" - regeneration is a whole-combat projection, defiance is
  // durable here because the damage kernel consumes it.
  'enochian:trait:embersoul': { grantConditions: ['defiance'] },
  // ICON p.192 Colossus Furious Berserk: "You start combat with defiance"
  // (regeneration is a projection; the bloodied halves are lifecycle).
  'colossus:trait:furious-berserk': { grantConditions: ['defiance'] },
  // ICON p.196 Sealer Godly Smite: "You start combat with a mantra power die,
  // a d6 that starts at 1" (the round-start recipe ticks it from round 2).
  'sealer:trait:godly-smite': { initState: { 'mantra:die': 1 } },
  // ICON p.168 Warden Beast Master: "At the start of every combat, summon a
  // great beast in range 2 ... persists even if you're defeated."
  'warden:trait:beast-master': { summon: { entityType: 'beast', range: 2 } },
  // ICON p.154 Freelancer Bound Spirit: "At the start of combat, you may place
  // your seraph in range 2 from you ... persists even if you're defeated."
  'freelancer:trait:bound-spirit': { summon: { entityType: 'seraph', range: 2 } },
  // ICON p.218 Stormbender Selkie: "At the start of any combat, summon it in
  // range 3."
  'stormbender:trait:selkie': { summon: { entityType: 'selkie', range: 3 } },
};

/** The wired trait IDs — the allowlist that makes each unit\u2019s compilation
 * complete (audit authority: allowlist + source fixture + replay test). */
export const EXECUTABLE_JOB_TRAIT_IDS: ReadonlySet<string> = new Set(
  Object.values(JOB_TRAIT_RECIPES).filter((recipe) => recipe.status === 'wired').map((recipe) => recipe.sourceId),
);

/** Exposed for the closed-registry fixtures: every documented row stays
 * source-visible and must never gain a guessed resolver. */
export const DOCUMENTED_JOB_TRAIT_IDS: ReadonlySet<string> = new Set(
  Object.values(JOB_TRAIT_RECIPES).filter((recipe) => recipe.status === 'documented').map((recipe) => recipe.sourceId),
);
