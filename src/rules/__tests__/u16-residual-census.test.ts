import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { bullStrengthCollideKey, useLedgerAvailable } from '../automation/kernels/use-ledger.js';
import { bullStrengthCollideMutations } from '../automation/content/jobs/attack-modifier-recipes.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import type { RuleMutation } from '../automation/primitives/types.js';
import { scriptedDice, validCharacter, endTurnTo, startEncounterTo } from './fixtures.js';

/**
 * U16 residual-usage-state census (2026-08-31, corrected) — adversarial /
 * replay / disjointness proofs for the once-per-scope marks that moved from
 * raw booleans/counters onto typed U16 ledger keys:
 *   - chain-reaction  -> ledger:round:core:chain-reaction        (once/round)
 *   - midas           -> ledger:combat:geomancer:midas           (twice/combat)
 *   - bull-s-strength -> ledger:any-turn:core:bull-s-strength:target:<id>
 *                        (per-RECIPIENT, once per any-turn battlefield window)
 * plus the RETAINED damage-immune mode (proven disjoint from U16). Every
 * scenario must stay deterministic under applyEvents replay. The round cadence
 * is strict hero/foe alternation: after the hero the caller must take every
 * remaining foe-side actor's turn before the hero is eligible again.
 */

const chainReactionKey = 'ledger:round:core:chain-reaction';
const midasKey = 'ledger:combat:geomancer:midas';

/** End the active actor's turn and take `nextId`'s turn (the TF fixture helper). */
const take = (state: EncounterState, nextId: string): EncounterState =>
  endTurnTo(state, nextId, scriptedDice());

/** Cycle through every foe-side actor then back to `heroId`, ending the round.
 * Midas removes its targets, so the actable foe set shrinks each round; pass
 * the foes that remain actable for this cycle. Returns the post-cycle state
 * with the hero active in the next round. */
function cycleFoesAndHero(state: EncounterState, foeIds: string[], heroId: string): EncounterState {
  let s = state;
  for (const foeId of foeIds) s = take(s, foeId);
  return take(s, heroId);
}

interface WrightFixture {
  state: EncounterState;
  hero: EncounterActor;
  foes: EncounterActor[];
  rotor: EncounterActor;
  secondHero: EncounterActor | null;
}

function wrightFixture(params: { hero?: string; targets?: Position[]; secondHero?: boolean } = {}): WrightFixture {
  const hero = actorFromCharacter(validCharacter('Earth Shaper'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foes = (params.targets ?? [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }])
    .map((position, i) => createFoe(i === 0 ? 'Relict' : 'Grim', position));
  let state = createEncounter('U16 census fixture');
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  for (const foe of foes) state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  const rotor = createFoe('Grim', { x: 6, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: rotor }).state;
  const secondHero = params.secondHero
    ? (() => {
        const other = actorFromCharacter(validCharacter('Mira'), { x: 1, y: 2 });
        other.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
        return other;
      })()
    : null;
  if (secondHero) {
    // Set different resources/name so the two heroes are distinguishable.
    secondHero.name = 'Mira';
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: secondHero }).state;
  }
  state = startEncounterTo(state, params.hero ?? hero.id);
  return { state, hero, foes, rotor, secondHero };
}

const castMidas = (state: EncounterState, actorId: string, targetId: string) =>
  executeCommand(state, {
    type: 'EXECUTE_RULE',
    actorId,
    sourceId: 'geomancer:midas',
    actionId: 'default',
    timing: 'interrupt',
    input: { actorIds: { target: [targetId] } },
  }, scriptedDice());

describe('U16 — Midas is a twice-per-combat entitlement (combat scope, never resets early)', () => {
  it('two uses across two rounds are legal, the durable count persists (never reset), and a third is rejected', () => {
    const { state, hero, foes, rotor } = wrightFixture();
    // Round 1 hero turn: first Midas use -> count 1.
    let s = castMidas(state, hero.id, foes[0]!.id).state;
    expect(s.actors[hero.id].ruleState[midasKey]).toBe(1);
    // Hero is still active (interrupt does not end the turn). Cycle the two
    // remaining targets + rotor, then back to the hero -> round 2. Combat scope
    // must NOT reset the count at the round boundary.
    s = cycleFoesAndHero(s, [foes[1]!.id, foes[2]!.id, rotor.id], hero.id);
    expect(s.round).toBe(2);
    expect(s.actors[hero.id].ruleState[midasKey]).toBe(1); // persists across rounds
    // Round 2 hero turn: second Midas use -> count 2 (cap reached).
    s = castMidas(s, hero.id, foes[1]!.id).state;
    expect(s.actors[hero.id].ruleState[midasKey]).toBe(2);
    expect(useLedgerAvailable(s.actors[hero.id], midasKey)).toBe(false);
    // Cycle the remaining target (foes[2]) + rotor, then back -> round 3.
    s = cycleFoesAndHero(s, [foes[2]!.id, rotor.id], hero.id);
    expect(s.round).toBe(3);
    expect(s.actors[hero.id].ruleState[midasKey]).toBe(2); // never reset
    // Third use is rejected by the U16 combat-scope cap — no competing path.
    expect(() => castMidas(s, hero.id, foes[2]!.id)).toThrow(/twice per combat/);
    // Deterministic replay reproduces the round-2 second-use transition exactly.
    const round1 = castMidas(state, hero.id, foes[0]!.id).state;
    const round2 = cycleFoesAndHero(round1, [foes[1]!.id, foes[2]!.id, rotor.id], hero.id);
    const secondUse = castMidas(round2, hero.id, foes[1]!.id);
    expect(applyEvents(round2, secondUse.events)).toEqual(secondUse.state);
    expect(secondUse.state.actors[hero.id].ruleState[midasKey]).toBe(2);
  });
});

describe('U16 — Chain Reaction (Wright) round gate: once per round, owner-local, resets at the boundary', () => {
  it('an ability damaging two foes procs once, consumes the U16 gate, and a round boundary reopens it exactly once', () => {
    const { state, hero, foes, rotor } = wrightFixture({ targets: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    state.actors[hero.id].traitIds.push('wright:trait:chain-reaction');
    // Round 1 hero turn: landwaster damages both adjacent foes -> proc +1 aether.
    const proc = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:land-waster', targetIds: [foes[0]!.id] }, scriptedDice(15, 3, 5)).state;
    expect(proc.actors[hero.id].resources.aether).toBe(1);
    expect(proc.actors[hero.id].ruleState[chainReactionKey]).toBe(true);
    expect(useLedgerAvailable(proc.actors[hero.id], chainReactionKey)).toBe(false); // gate consumed
    // Full round cycle (both damaged-but-alive foes + rotor, then back to the
    // hero) reopens the gate: every actable foe-side actor must take its turn
    // before the hero is eligible again.
    let s = cycleFoesAndHero(proc, [foes[0]!.id, foes[1]!.id, rotor.id], hero.id);
    expect(s.round).toBe(2);
    expect(s.actors[hero.id].ruleState[chainReactionKey]).toBeUndefined();
    expect(useLedgerAvailable(s.actors[hero.id], chainReactionKey)).toBe(true);
    // land-waster's header default range is 1 and its burst shoves foes away,
    // so round 1 pushed f0 two cells off. Reposition the targets adjacent before
    // the round-2 proc (pure fixture staging, not a rules decision).
    s.actors[foes[0]!.id].position = { x: 2, y: 1 };
    s.actors[foes[1]!.id].position = { x: 2, y: 0 };
    // Next-round proc is legal again and regenerates the consumed mark.
    const fresh = executeCommand(s, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:land-waster', targetIds: [foes[0]!.id] }, scriptedDice(15, 3, 5)).state;
    expect(fresh.actors[hero.id].resources.aether).toBe(2);
    expect(fresh.actors[hero.id].ruleState[chainReactionKey]).toBe(true);
    // Deterministic replay reproduces the fresh-proc transition (staging state
    // is the pre-command snapshot, so it replays byte-identically).
    expect(applyEvents(s, executeCommand(s, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:land-waster', targetIds: [foes[0]!.id] }, scriptedDice(15, 3, 5)).events)).toEqual(fresh);
  });

  it('the round gate is actor-local: one owner proc does not consume another owner', () => {
    const { state, hero, foes, secondHero } = wrightFixture({ secondHero: true, targets: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    expect(secondHero).not.toBeNull();
    state.actors[hero.id].traitIds.push('wright:trait:chain-reaction');
    const proc = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:land-waster', targetIds: [foes[0]!.id] }, scriptedDice(15, 3, 5)).state;
    // A's round mark is consumed; B's independent round ledger is untouched.
    expect(proc.actors[hero.id].ruleState[chainReactionKey]).toBe(true);
    expect(useLedgerAvailable(proc.actors[hero.id], chainReactionKey)).toBe(false);
    expect(useLedgerAvailable(proc.actors[secondHero!.id], chainReactionKey)).toBe(true);
  });
});

describe('U16 — Bull\'s Strength is a per-TARGET any-turn entitlement (recipient-limited, battlefield window)', () => {
  it('two different Bastion owners never alias: the same target may take the damage from each owner in the same turn', () => {
    // Heracule's shove (hero at 1,1) pushes the foe at 2,1 into the impassable
    // cell at 3,1 -> collide (p.95), the Bull's Strength bonus. The restriction
    // ("Characters can't take this damage more than once a turn") belongs to
    // the RECIPIENT, so the per-target gate lives on the OWNER's ledger with a
    // target suffix: owner A's consume must never close owner B's gate.
    const { state, hero, foes, secondHero } = wrightFixture({ targets: [{ x: 2, y: 1 }], secondHero: true });
    state.grid.terrain.push({ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 });
    state.actors[hero.id].traitIds.push('bastion:trait:bull-s-strength');
    state.actors[secondHero!.id].traitIds.push('bastion:trait:bull-s-strength');
    const target = foes[0]!.id;
    const key = bullStrengthCollideKey(target);
    // Owner A collides the target: its per-target gate consumes; owner B's
    // identical gate on the SAME target stays untouched (OWNER ≠ TARGET).
    const first = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [target] }, scriptedDice(15, 3, 5));
    expect(first.state.actors[hero.id].ruleState[key]).toBe(true);
    expect(first.state.actors[secondHero!.id].ruleState[key]).toBeUndefined();
    // Owner B's collide fold against the SAME target in the SAME turn still
    // fires (damage + its own consume) — the two owners never alias.
    const shove = (targetId: string): RuleMutation => ({
      kind: 'move', sourceId: 'test', sourceActorId: secondHero!.id, actorId: targetId, movement: 'shove', distance: 1,
      positions: [], direction: { x: -1, y: 0 }, phasing: false,
    });
    const ownerBCollide = bullStrengthCollideMutations(first.state, [shove(target)]);
    expect(ownerBCollide.filter((mutation) => mutation.kind === 'damage')).toHaveLength(1);
    expect(ownerBCollide.filter((mutation) => mutation.kind === 'state' && mutation.key === key)).toHaveLength(1);
    // Deterministic replay reproduces owner A's recorded target-sensitive consume.
    expect(applyEvents(state, first.events)).toEqual(first.state);
  });

  it('the battlefield any-turn window reopens at another actor\'s turn start — no owner-turn dependency (replay byte-identical)', () => {
    const { state, hero, foes } = wrightFixture({ targets: [{ x: 2, y: 1 }] });
    state.grid.terrain.push({ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 });
    state.actors[hero.id].traitIds.push('bastion:trait:bull-s-strength');
    const target = foes[0]!.id;
    const key = bullStrengthCollideKey(target);
    const resulted = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [target] }, scriptedDice(15, 3, 5));
    let s = resulted.state;
    expect(useLedgerAvailable(s.actors[hero.id], key)).toBe(false);
    // Ending the owner's turn and starting a FOE's turn reopens the battlefield
    // window — the Bastion never takes its own turn between.
    s = take(s, foes[0]!.id);
    expect(useLedgerAvailable(s.actors[hero.id], key)).toBe(true);
    // Replay reproduces the collide transition byte-identically.
    expect(applyEvents(state, resulted.events)).toEqual(resulted.state);
  });
});

describe('U16 — retained damage-immune is MODE state, proven disjoint from usage entitlement', () => {
  it('toggle damage-immune never changes the U16 gate answer (negative substitute proof)', () => {
    const { state, hero } = wrightFixture({ targets: [{ x: 2, y: 1 }] });
    const actor = state.actors[hero.id];
    // Gate open; damage-immune set must NOT consume it and must NOT reopen it.
    expect(useLedgerAvailable(actor, chainReactionKey)).toBe(true);
    actor.ruleState['damage-immune'] = true;
    actor.ruleStateOwners['damage-immune'] = null;
    expect(useLedgerAvailable(actor, chainReactionKey)).toBe(true); // immunity is not a use
    // Consume via the U16 gate; the immunity status is unaffected and must not
    // open the gate back up.
    actor.ruleState[chainReactionKey] = true;
    expect(useLedgerAvailable(actor, chainReactionKey)).toBe(false);
    expect(actor.ruleState['damage-immune']).toBe(true); // the mode persists
    // immunity is not a ledger key and carries no usage count.
    expect(Object.keys(actor.ruleState)).not.toContain('ledger:any-turn:core:damage-immune');
  });

  it('damage-immune resets to false at the turn boundary as a mode, independently of round ledger life', () => {
    const { state, hero, foes, rotor } = wrightFixture({ targets: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    let s = state;
    s.actors[hero.id].ruleState['damage-immune'] = true;
    s.actors[hero.id].ruleStateOwners['damage-immune'] = null;
    // A full round cycle back to the hero resets the per-turn immunity mode to
    // false while leaving any per-round ledger untouched — the immunity is NOT
    // a durability count (it clears by setting false, never via ledger reset).
    s = cycleFoesAndHero(s, [foes[0]!.id, foes[1]!.id, rotor.id], hero.id);
    expect(s.actors[hero.id].ruleState['damage-immune']).toBe(false);
  });
});