/**
 * roles.test.ts — the U2 ROLE / PERSPECTIVE underlay's semantic contract.
 *
 * The underlay is the typed distinction of *relative to whom a clause is
 * interpreted*: source/owner/controller/chooser/payer/target/recipient/
 * carrier/creator/trigger roles/attacker/defender/original-user/current-
 * origin. Tests establish:
 *   - positive: TARGET_CONTROLLER resolves to the target's controller for a
 *     RuleChoice; mark OWNER ≠ mark CARRIER resolve distinctly;
 *   - negative: a chooser role that cannot be derived rejects (null), never
 *     guesses;
 *   - boundary: source == target == controller collapses to one id without
 *     breaking derivation; ROLE ≠ ANCHOR — the original-user role survives
 *     a rebound where the spatial origin moved;
 *   - replay: the same durable role frame derives the same map.
 */
import { describe, expect, it } from 'vitest';
import type { RuleChoice, RuleExecutionContext } from '../automation/primitives/types.js';
import { deriveRoles, resolveRoleSelector, roleFrameFromContext, type RoleFrame, type RoleSelector } from '../automation/primitives/roles.js';

describe('U2 ROLE — deriveRoles maps the durable role frame', () => {
  it('positive: mark OWNER and mark CARRIER resolve distinctly (p.94)', () => {
    const frame: RoleFrame = {
      sourceId: 'knave',
      targetId: 'foe',
      ownerId: 'knave', // the marker owns the mark
      carrierId: 'foe', // the target carries it
    };
    const roles = deriveRoles(frame);
    expect(roles.owner).toBe('knave');
    expect(roles.carrier).toBe('foe');
    expect(roles.owner).not.toBe(roles.carrier);
  });

  it('positive: attacker/defender and original-user/current-origin derive from the frame', () => {
    const frame: RoleFrame = {
      sourceId: 'hero',
      targetId: 'foe',
      attackerId: 'hero',
      defenderId: 'foe',
      originalUserId: 'hero',
      currentOriginId: 'rebounded-foe',
    };
    const roles = deriveRoles(frame);
    expect(roles.attacker).toBe('hero');
    expect(roles.defender).toBe('foe');
    expect(roles['original-user']).toBe('hero');
    expect(roles['current-origin']).toBe('rebounded-foe');
  });

  it('boundary: ROLE ≠ ANCHOR — the original-user role survives a rebound where the spatial origin moved', () => {
    // Masquerade p.151-style rebound: the rebound character's space is the
    // ANCHOR (U7), but effects "on the original user" still apply to the
    // original user (U2 role) — the role map is derived from the durable
    // role frame, not from any spatial anchor.
    const frame: RoleFrame = {
      sourceId: 'hero',
      originalUserId: 'hero',
      currentOriginId: 'rebounded-foe',
    };
    const roles = deriveRoles(frame);
    expect(roles['original-user']).toBe('hero');
    expect(roles['current-origin']).toBe('rebounded-foe');
    // No spatial anchor field participates in role derivation.
    expect(roles['original-user']).not.toBe(roles['current-origin']);
  });

  it('replay: the same durable role frame derives the same map', () => {
    const frame: RoleFrame = { sourceId: 'hero', targetId: 'foe', ownerId: 'hero', carrierId: 'foe' };
    expect(deriveRoles(frame)).toEqual(deriveRoles(frame));
  });
});

describe('U2 ROLE — chooser/controller role carriage on RuleChoice', () => {
  const targetController: RoleSelector = { kind: 'controller-of', subject: 'target' };

  it('positive: "choice made by TARGET_CONTROLLER" resolves to the target\'s controller', () => {
    const frame: RoleFrame = {
      sourceId: 'hero',
      targetId: 'foe',
      controllerId: 'player-2',
    };
    const roles = deriveRoles(frame);
    expect(resolveRoleSelector(targetController, roles)).toBe('player-2');
  });

  it('positive: a RuleChoice row carries typed chooser/controller roles (behavior-neutral)', () => {
    const choice: RuleChoice = {
      key: 'dark-knight-hate',
      label: 'Choose which equidistant foe to hate',
      kind: 'actors',
      required: true,
      relation: 'foe',
      chooser: { kind: 'controller-of', subject: 'source' },
      controller: { kind: 'role', role: 'source' },
    };
    expect(choice.chooser).toEqual({ kind: 'controller-of', subject: 'source' });
    expect(choice.controller).toEqual({ kind: 'role', role: 'source' });
  });

  it('negative: a chooser role that cannot be derived rejects (null), never guesses', () => {
    // No controller facts recorded and no source fallback path for a
    // controller-of target whose target is absent.
    const frame: RoleFrame = { sourceId: 'hero' };
    const roles = deriveRoles(frame);
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'target' }, roles)).toBeNull();
  });

  it('negative: an unknown role in the map rejects', () => {
    const frame: RoleFrame = { sourceId: 'hero' }; // no carrier derived
    const roles = deriveRoles(frame);
    expect(resolveRoleSelector({ kind: 'role', role: 'carrier' }, roles)).toBeNull();
  });

  it('boundary: source == target == controller collapses to one id without breaking derivation', () => {
    const frame: RoleFrame = { sourceId: 'self', targetId: 'self', controllerId: 'self' };
    const roles = deriveRoles(frame);
    expect(roles.source).toBe('self');
    expect(roles.target).toBe('self');
    expect(roles.controller).toBe('self');
    expect(resolveRoleSelector({ kind: 'role', role: 'source' }, roles)).toBe('self');
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'target' }, roles)).toBe('self');
  });
});

describe('U2 ROLE — the context seam derives the legacy slots', () => {
  function ctx(overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
    return {
      state: {
        round: 1,
        grid: { width: 24, height: 24 },
        actors: {
          hero: { id: 'hero', side: 'heroes', position: { x: 4, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
          foe: { id: 'foe', side: 'foes', position: { x: 8, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
        },
        entities: {},
        terrainAt: () => new Set(),
        elevationAt: () => 0,
        terrainEffects: [],
      },
      actorId: 'hero',
      sourceId: 'test:source',
      actionId: 'default',
      timing: 'use',
      input: {},
      dice: { die: () => 1 },
      attackTargetId: 'foe',
      damageRecipientId: 'foe',
      triggerSourceId: 'trap',
      triggerTargetIds: ['hero'],
      ...overrides,
    };
  }

  it('positive: the legacy slots map onto the semantic roles', () => {
    const roles = deriveRoles(roleFrameFromContext(ctx()));
    expect(roles.source).toBe('hero');
    expect(roles.target).toBe('foe');
    expect(roles.recipient).toBe('foe');
    expect(roles['trigger-source']).toBe('trap');
    expect(roles['trigger-recipient']).toBe('hero');
    expect(roles.attacker).toBe('hero');
    expect(roles.defender).toBe('foe');
  });
});
