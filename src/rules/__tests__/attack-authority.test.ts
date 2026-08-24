import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { executeRuleProgram } from '../automation/kernels/runtime.js';
import { resolveAuthoritativeAttack } from '../automation/kernels/attack-resolution.js';
import { resolveOrdinaryAttackMutations } from '../automation/kernels/ordinary-attack.js';
import { HISSATSU_TRAIT, HISSATSU_ARMED_KEY } from '../automation/content/jobs/attack-modifier-recipes.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { damageMutation } from '../automation/primitives/job-kit.js';
import type { RuleActorView, RuleExecutionContext, RuleMutation, RuleProgram, RuleRuntimeState } from '../automation/primitives/types.js';
import type { DiceSource } from '../dice.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/** Narrowed mutation shapes so fixtures can assert on attack/damage fields. */
type AttackMutation = RuleMutation & { d20: number | null; boon: number; total: number | null; hit: boolean; critical: boolean; trueStrike: boolean; autoHit: boolean };
type DamageMutation = RuleMutation & { actorId: string; amount: number; damageType: string; ignoreCover: boolean; ignoreAetherwall?: boolean };

const attackMutations = (mutations: RuleMutation[]): AttackMutation[] =>
  mutations.filter((mutation): mutation is AttackMutation => mutation.kind === 'attack');
const damageMutations = (mutations: RuleMutation[]): DamageMutation[] =>
  mutations.filter((mutation): mutation is DamageMutation => mutation.kind === 'damage');

/**
 * Unified ordinary-attack authority (kernels/attack-resolution.ts): every
 * attack producer — the declarative VM `attack` effect, named Job resolvers,
 * and the generic foe recipe — resolves through `resolveAuthoritativeAttack`,
 * which folds the F6 trait modifiers (armed one-shot Hissatsu/Demon Edge,
 * elevation Pulverize, exact-range Trigrammaton through the canonical p.92
 * footprint distance, Blood Hunger), the aura attacker boons/curses plus the
 * target's defensive aura curse, the F10 ability-use modifiers (Blessing of
 * War boons/bonus damage, Rebirth pierce), the effective damage die (an
 * armed d10), and the cover/dodge/aetherwall provenance that follows the
 * attack into its direct damage only.
 *
 * These tests prove semantic parity that would have diverged under the old
 * split paths (job-kit's bare resolveAttackRoll bypassed every generic
 * modifier), plus the transactional boundary: a failed mandatory or
 * ability-use payment rejects before any attack, any dice, or any armed-state
 * consumption.
 */

const actor = (id: string, side: 'heroes' | 'foes', traitIds: string[], x: number, extra: Record<string, unknown> = {}): RuleActorView => ({
  id, side, position: { x, y: 0 }, hp: 20, maxHp: 40, vitality: 10, vigor: 0,
  defense: 6, armor: 0, speed: 4, dash: 2, fray: 4, damageDie: 6, actions: 2, attacked: false,
  size: 1, defeated: false, conditions: new Set<string>(), statuses: [],
  statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
  resources: {}, state: {}, traitIds, talents: {}, abilityIds: [], masteredAbilityIds: [], marks: [],
  ...extra,
} as RuleActorView);

const view = (hero: RuleActorView, foe: RuleActorView, extra: Partial<RuleRuntimeState> = {}): RuleRuntimeState => ({
  round: 1, grid: { width: 10, height: 10 },
  actors: { hero, foe }, entities: {}, terrainEffects: [],
  terrainAt: () => new Set<string>(), elevationAt: () => 0,
  ...extra,
});

const contextFor = (state: RuleRuntimeState, dice: DiceSource, extra: Partial<RuleExecutionContext> = {}): RuleExecutionContext => ({
  state, actorId: 'hero', sourceId: 'test:attack', actionId: 'use', timing: 'use',
  input: { actorIds: { target: ['foe'] } }, dice, triggers: new Set<string>(), ...extra,
});

/** A declarative VM attack: [D] on hit, fray on miss, through the VM's attack
 * effect (the same surface bastion:heracule / colossus:valkyrie ride). */
const vmAttackProgram = (name: string, opts: { boons?: number; trueStrike?: boolean; autoHit?: boolean } = {}): RuleProgram => ({
  // The VM requires the context's sourceId to match the program's; every
  // fixture uses the same test sourceId so one context helper drives both the
  // declarative and resolver paths.
  schemaVersion: 1, rulesVersion: '1.5', id: `program:${name}`, sourceId: 'test:attack',
  source: { page: 1, sectionId: 'test' }, name, classification: 'encounter', dependencies: [],
  actions: [{ id: 'use', name, timing: 'use', costs: [], tags: ['attack'], range: null, area: null, choices: [], steps: [
    { id: 'attack', timing: 'use', effects: [{
      kind: 'attack', target: { kind: 'input', key: 'target' },
      ...(opts.boons ? { boons: { kind: 'constant', value: opts.boons } } : {}),
      ...(opts.trueStrike ? { trueStrike: true } : {}),
      ...(opts.autoHit ? { autoHit: true } : {}),
      onHit: [{ kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'damage-roll', actor: { kind: 'self' }, dice: { kind: 'constant', value: 1 } }, damageType: 'normal', delivery: 'hit', ignoreCover: false }],
      onMiss: [],
    }] },
  ] }],
});

describe('ordinary attack authority — VM vs named resolver parity', () => {
  it('armed Hissatsu (+1 boon, true strike, d10) reaches VM and resolver attacks identically', () => {
    // Each path gets its own armed state: the VM consumes the one-shot armed
    // flag on the shared actor state when the attack is made, so a shared
    // fixture would let the first path disarm the second.
    const armedHero = () => actor('hero', 'heroes', [HISSATSU_TRAIT], 1, { state: { [HISSATSU_ARMED_KEY]: true } });

    // VM: d20 7, +1 boon die 5 → total 12; damage rolls the armed d10 (the
    // scripted 9 is only valid on a d10, so this proves the die override).
    const vmState = view(armedHero(), actor('foe', 'foes', [], 4));
    const vmResult = executeRuleProgram(vmAttackProgram('armed'), contextFor(vmState, scriptedDice(7, 5, 9)), {});
    const [vmAttack] = attackMutations(vmResult.mutations);
    const [vmDamage] = damageMutations(vmResult.mutations);
    expect(vmAttack).toMatchObject({ d20: 7, boon: 5, total: 12, hit: true, critical: false, trueStrike: true });
    expect(vmDamage.amount).toBe(9);

    // Resolver: identical roll through the same authority, and the attack's
    // [D] rolls the same d10.
    const resolverState = view(armedHero(), actor('foe', 'foes', [], 4));
    const resolverContext = contextFor(resolverState, scriptedDice(7, 5, 9));
    const roll = resolveAuthoritativeAttack(resolverContext, resolverState.actors.hero, resolverState.actors.foe);
    expect(roll.attackMutation).toMatchObject({ d20: 7, boon: 5, total: 12, hit: true, critical: false, trueStrike: true });
    expect(roll.damageDie).toBe(10);
    expect(resolverContext.dice.die(roll.damageDie)).toBe(9);
  });

  it('shared ordinary attack helper keeps critical and bonus-damage dice highest', () => {
    const hero = actor('hero', 'heroes', [], 1, { resources: { 'bonus-damage': 1 } });
    const foe = actor('foe', 'foes', [], 4);
    const context = contextFor(view(hero, foe), scriptedDice(20, 2, 6, 4));
    const result = resolveOrdinaryAttackMutations(context, hero, foe, 1, {}, 1);
    expect(result.attack.critical).toBe(true);
    expect(result.mutations[1]).toMatchObject({ kind: 'damage', amount: 14 });
  });

  it('control: without the armed flag both paths roll the ordinary d6 and no boon', () => {
    const hero = actor('hero', 'heroes', [HISSATSU_TRAIT], 1); // armed flag absent
    const foe = actor('foe', 'foes', [], 4);
    const state = view(hero, foe);

    const vmResult = executeRuleProgram(vmAttackProgram('plain'), contextFor(state, scriptedDice(7, 6)), {});
    const [vmAttack] = attackMutations(vmResult.mutations);
    const [vmDamage] = damageMutations(vmResult.mutations);
    expect(vmAttack).toMatchObject({ d20: 7, boon: 0, total: 7, hit: true, trueStrike: false });
    expect(vmDamage.amount).toBe(6); // ordinary d6

    const resolverContext = contextFor(state, scriptedDice(7, 6));
    const roll = resolveAuthoritativeAttack(resolverContext, state.actors.hero, state.actors.foe);
    expect(roll.attackMutation).toMatchObject({ d20: 7, boon: 0, total: 7, hit: true, trueStrike: false });
    expect(roll.damageDie).toBe(6);
    expect(resolverContext.dice.die(roll.damageDie)).toBe(6);
  });

  it('Triggrammaton exact-range-3 boon + unerring reaches both paths through the footprint metric', () => {
    // Size-1 hero at x=1, foe at x=4 → footprint distance 3.
    const hero = actor('hero', 'heroes', ['freelancer:trait:trigrammaton'], 1);
    const foe = actor('foe', 'foes', [], 4);
    const state = view(hero, foe);

    const vmResult = executeRuleProgram(vmAttackProgram('exact'), contextFor(state, scriptedDice(7, 5)), {});
    const [vmAttack] = attackMutations(vmResult.mutations);
    const [vmDamage] = damageMutations(vmResult.mutations);
    expect(vmAttack).toMatchObject({ boon: 5, total: 12 }); // +1 boon from the exact-range rule
    expect(vmDamage).toMatchObject({ ignoreCover: true, ignoreAetherwall: true }); // unerring

    const roll = resolveAuthoritativeAttack(contextFor(state, scriptedDice(7, 5)), state.actors.hero, state.actors.foe);
    expect(roll.attackMutation).toMatchObject({ boon: 5, total: 12 });
    expect(roll.damageProvenance).toMatchObject({ ignoreCover: true, ignoreAetherwall: true });
  });

  it('Size-2 footprints use edge distance on BOTH paths: anchors outside nominal range but edges within range differ identically', () => {
    // Hero (size 2) anchored at x=0 occupies x=0..1; a foe at x=3 is at
    // footprint distance 2 (not 3): Trigrammaton's exactly-range-3 must NOT
    // apply on either path, while the anchor Chebyshev distance 3 would have.
    const hero2 = actor('hero', 'heroes', ['freelancer:trait:trigrammaton'], 0, { size: 2 });
    const foe = actor('foe', 'foes', [], 3);
    const near = view(hero2, foe);
    const vmNear = executeRuleProgram(vmAttackProgram('near'), contextFor(near, scriptedDice(7)), {});
    const rollNear = resolveAuthoritativeAttack(contextFor(near, scriptedDice(7)), near.actors.hero, near.actors.foe);
    expect(attackMutations(vmNear.mutations)[0]).toMatchObject({ boon: 0, total: 7 });
    expect(rollNear.attackMutation).toMatchObject({ boon: 0, total: 7 });
    expect(rollNear.damageProvenance.ignoreCover).toBe(false);

    // A foe at x=4 is at footprint distance 3: the rule applies on BOTH paths.
    const far = view(actor('hero', 'heroes', ['freelancer:trait:trigrammaton'], 0, { size: 2 }), actor('foe', 'foes', [], 4));
    const vmFar = executeRuleProgram(vmAttackProgram('far'), contextFor(far, scriptedDice(7, 5)), {});
    const rollFar = resolveAuthoritativeAttack(contextFor(far, scriptedDice(7, 5)), far.actors.hero, far.actors.foe);
    expect(attackMutations(vmFar.mutations)[0]).toMatchObject({ boon: 5, total: 12 });
    expect(rollFar.attackMutation).toMatchObject({ boon: 5, total: 12 });
    expect(rollFar.damageProvenance.ignoreCover).toBe(true);
  });

  it('a defensive aura curse reaches both paths', () => {
    // The hero holds the chanter Gentleness stance; the aura includes the
    // origin, so the hero's own attacks suffer the +1 curse.
    const hero = actor('hero', 'heroes', [], 1, { stance: { stanceId: 'gentleness' } });
    const foe = actor('foe', 'foes', [], 4);
    const state = view(hero, foe);

    const vmResult = executeRuleProgram(vmAttackProgram('aura'), contextFor(state, scriptedDice(7, 3)), {});
    const [vmAttack] = attackMutations(vmResult.mutations);
    expect(vmAttack).toMatchObject({ boon: -3, total: 4 }); // -1 curse

    const roll = resolveAuthoritativeAttack(contextFor(state, scriptedDice(7, 3)), state.actors.hero, state.actors.foe);
    expect(roll.attackMutation).toMatchObject({ boon: -3, total: 4 });
  });

  it('F10 ability-use boons and flat bonus damage (Blessing of War) reach both paths', () => {
    const hero = actor('hero', 'heroes', [], 1);
    const foe = actor('foe', 'foes', [], 4);
    const state = view(hero, foe);
    const modifiers = { boons: 1, bonusDamage: 2 };

    const vmResult = executeRuleProgram(
      vmAttackProgram('war'),
      contextFor(state, scriptedDice(7, 5, 6), { abilityUseModifiers: modifiers }),
      {},
    );
    const [vmAttack] = attackMutations(vmResult.mutations);
    const [vmDamage] = damageMutations(vmResult.mutations);
    expect(vmAttack).toMatchObject({ boon: 5, total: 12 }); // +1 boon
    expect(vmDamage.amount).toBe(8); // d6 6 + flat 2

    const roll = resolveAuthoritativeAttack(
      contextFor(state, scriptedDice(7, 5, 6), { abilityUseModifiers: modifiers }),
      state.actors.hero,
      state.actors.foe,
    );
    expect(roll.attackMutation).toMatchObject({ boon: 5, total: 12 });
    expect(roll.damageProvenance.bonusFlat).toBe(2);
    expect(roll.damageProvenance).toMatchObject({ ignoreCover: false });
  });
});

describe('provenance isolation — attack facts never leak to collateral damage', () => {
  it('an unerring resolver attack does not make later area/effect damage unerring', () => {
    const hero = actor('hero', 'heroes', ['freelancer:trait:trigrammaton'], 1);
    const foe = actor('foe', 'foes', [], 4);
    const state = view(hero, foe);

    const resolverContext = contextFor(state, scriptedDice(7, 5));
    const roll = resolveAuthoritativeAttack(resolverContext, state.actors.hero, state.actors.foe);
    expect(roll.damageProvenance).toMatchObject({ ignoreCover: true, ignoreAetherwall: true });

    // The direct hit damage inherits unerring through the remembered
    // provenance; a collateral area mutation (delivery 'area') must NOT —
    // `directAttackDamageProvenance` only hands facts to hit/miss deliveries.
    const direct = damageMutation(resolverContext, foe.id, 5, 'hit') as DamageMutation;
    const area = damageMutation(resolverContext, foe.id, 5, 'area') as DamageMutation;
    expect(direct.ignoreCover).toBe(true);
    expect(area.ignoreCover).toBe(false);
    expect(area.ignoreAetherwall).toBeUndefined();
  });
});

describe('F10 Blessing of Rebirth pierce — resolver damage converts like the VM (integration)', () => {
  /** Strafe Shot (freelancer) is a named-resolver attack ability; Valkyrie
   * (colossus) is a VM-step attack ability. Both must pierce with the same
   * recorded ability-use choice. (God Hand also works but its own resolver
   * grants a blessing back, which would obscure the exact-spend assertion.) */
  const setup = (abilityId: string, chapter: 1 | 3) => {
    let state = createEncounter('Rebirth parity fixture');
    const hero = actorFromCharacter(validCharacter(abilityId === 'colossus:valkyrie' ? 'Aster' : 'Exorcist'), { x: 1, y: 1 });
    hero.abilityIds = [abilityId];
    hero.chapter = chapter;
    const foe = createFoe('Relict', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    state.actors[hero.id].traitIds = ['harvester:trait:blessing-of-rebirth'];
    state.actors[hero.id].resources.blessing = 5;
    return { state, hero, foe };
  };

  const eventDamages = (events: ReturnType<typeof executeCommand>['events'], foeId: string): DamageMutation[] => {
    const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED');
    return event && event.type === 'RULE_MUTATIONS_APPLIED'
      ? damageMutations(event.mutations).filter((mutation) => mutation.actorId === foeId)
      : [];
  };

  it('a resolver attack ability pierces its damage with a 1-blessing Rebirth spend', () => {
    const { state, hero, foe } = setup('freelancer:strafe-shot', 1);
    const result = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'freelancer:strafe-shot',
      targetIds: [foe.id],
      input: { abilityUseChoices: [{ traitId: 'harvester:trait:blessing-of-rebirth', spend: 1 }] },
    }, scriptedDice(12, 4));
    const damages = eventDamages(result.events, foe.id);
    expect(damages.some((mutation) => mutation.damageType === 'piercing')).toBe(true);
    expect(damages.some((mutation) => mutation.damageType === 'normal')).toBe(false);
    expect(result.state.actors[hero.id].resources.blessing).toBe(4); // exactly one blessing spent
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('a VM attack ability pierces its damage identically (control parity)', () => {
    const { state, hero, foe } = setup('colossus:valkyrie', 1);
    const result = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'colossus:valkyrie',
      targetIds: [foe.id],
      input: { abilityUseChoices: [{ traitId: 'harvester:trait:blessing-of-rebirth', spend: 1 }] },
    }, scriptedDice(8, 4));
    const damages = eventDamages(result.events, foe.id);
    expect(damages.some((mutation) => mutation.damageType === 'piercing')).toBe(true);
    expect(result.state.actors[hero.id].resources.blessing).toBe(4);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('without the choice neither path pierces', () => {
    const cases: Array<[string, 1 | 3]> = [['freelancer:strafe-shot', 1], ['colossus:valkyrie', 1]];
    for (const [abilityId, chapter] of cases) {
      const { state, hero, foe } = setup(abilityId, chapter);
      const result = executeCommand(state, {
        type: 'USE_ABILITY',
        actorId: hero.id,
        abilityId,
        targetIds: [foe.id],
      }, scriptedDice(12, 4));
      const damages = eventDamages(result.events, foe.id);
      expect(damages.some((mutation) => mutation.damageType === 'piercing')).toBe(false);
    }
  });
});

describe('failed ability-use spend — the transactional invariant', () => {
  const armedSetup = (hissatsuArmed: boolean) => {
    let state = createEncounter('Failed F10 fixture');
    const hero = actorFromCharacter(validCharacter('Exorcist'), { x: 1, y: 1 });
    hero.abilityIds = ['sealer:god-hand'];
    hero.chapter = 1;
    hero.traitIds = ['sealer:trait:blessing-of-war', 'demon-slayer:trait:hissatsu'];
    hero.ruleState['hissatsu:armed'] = hissatsuArmed;
    const foe = createFoe('Relict', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    // Per-encounter resources reset at ENCOUNTER_STARTED; set the post-start
    // balance so the fixture proves the transaction gate, not the reset.
    state.actors[hero.id].resources.blessing = 1; // not enough for the spend-3 option
    return { state, hero, foe };
  };

  it('an unpayable Blessing of War spend rejects the whole command: no attack, no dice, no partial cost', () => {
    const { state, hero, foe } = armedSetup(false);

    const dice = scriptedDice(12, 4);
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'sealer:god-hand',
      targetIds: [foe.id],
      input: { abilityUseChoices: [{ traitId: 'sealer:trait:blessing-of-war', spend: 3 }] },
    }, dice)).toThrow(/requires 3/);
    // Nothing resolved: no blessing spent, no attack recorded, no dice
    // consumed (the next roll is still the scripted first value).
    expect(state.actors[hero.id].resources.blessing).toBe(1);
    expect(state.actors[foe.id].hp).toBe(state.actors[foe.id].hp);
    expect(dice.die(20)).toBe(12); // the first scripted die is untouched
  });

  it('a failed mandatory cost does not consume armed one-shot attack state', () => {
    const { state, hero, foe } = armedSetup(true);
    expect(state.actors[hero.id].ruleState['hissatsu:armed']).toBe(true);

    expect(() => executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'sealer:god-hand',
      targetIds: [foe.id],
      input: { abilityUseChoices: [{ traitId: 'sealer:trait:blessing-of-war', spend: 3 }] },
    }, scriptedDice(12, 4))).toThrow(/requires 3/);
    expect(state.actors[hero.id].ruleState['hissatsu:armed']).toBe(true); // still armed
  });
});

describe('combined cost + attack replay', () => {
  it('a mandatory sacrifice + resolver attack replays to identical state', () => {
    let state = createEncounter('Combined fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = ['enochian:blackstar'];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 3, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const result = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'enochian:blackstar',
      targetIds: [foe.id],
    }, scriptedDice(12, 4, 5, 2));
    // The special effect paid its 50% sacrifice (20 of 40 max HP) before the
    // attack resolved.
    expect(result.state.actors[hero.id].hp).toBe(20);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
