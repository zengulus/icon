import type { FoeRecipe } from '../../kernels/foe-recipes.js';

/**
 * Independently reviewed foe ability recipes (ICON p.300–302), the second
 * `foe-ability` slice after the Crusher (p.301) pilot. Each entry is one
 * declarative recipe; the generic factories in `kernels/foe-recipes.ts`
 * resolve it. Profiles: Warrior, Soldier, and Brute (basic heavy, p.300)
 * plus Pepperbox and Hunter (basic skirmisher, p.302), covering the
 * canonical attack (with true strike, bonus damage, conditions, splash, and
 * criticals), shove with collide, rush, vigor buff, adjacency and ranged
 * marks, swap, dash-strike, blast area, terrain creation, and end-turn
 * stealth.
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
