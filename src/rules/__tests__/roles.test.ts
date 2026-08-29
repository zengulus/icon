/**
 * roles.test.ts — the U2 ROLE / PERSPECTIVE underlay's semantic contract.
 *
 * The underlay is the typed distinction of *relative to whom a clause is
 * interpreted*: source/owner/controller/chooser/payer/target/recipient/
 * carrier/creator/trigger roles/attacker/defender/original-user/current-
 * origin. Controller authority is SUBJECT-RELATIVE (corrective pass
 * 2026-08-30): `controller-of(source)` and `controller-of(target)` resolve to
 * two DIFFERENT players when the source and target are controlled by
 * different connected players; a missing recorded controller for a valid
 * subject returns null (never silently falls back to the source). Tests
 * establish:
 *   - positive: source-controller ≠ target-controller in the same resolution;
 *     TARGET_CONTROLLER resolves to the target's controller; mark OWNER ≠
 *     mark CARRIER can have different controllers;
 *   - negative: a chooser role that cannot be derived rejects (null); a
 *     missing controller for an otherwise valid subject returns null; a
 *     missing subject returns null;
 *   - boundary: source == target == controller collapses to one id;
 *     ROLE ≠ ANCHOR — the original-user role survives a rebound;
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
    const map = deriveRoles(frame);
    expect(map.roles.owner).toBe('knave');
    expect(map.roles.carrier).toBe('foe');
    expect(map.roles.owner).not.toBe(map.roles.carrier);
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
    const map = deriveRoles(frame);
    expect(map.roles.attacker).toBe('hero');
    expect(map.roles.defender).toBe('foe');
    expect(map.roles['original-user']).toBe('hero');
    expect(map.roles['current-origin']).toBe('rebounded-foe');
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
    const map = deriveRoles(frame);
    expect(map.roles['original-user']).toBe('hero');
    expect(map.roles['current-origin']).toBe('rebounded-foe');
    // No spatial anchor field participates in role derivation.
    expect(map.roles['original-user']).not.toBe(map.roles['current-origin']);
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
      controllers: { target: 'player-2' },
    };
    const map = deriveRoles(frame);
    expect(resolveRoleSelector(targetController, map)).toBe('player-2');
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
    // No target recorded (subject missing) — controller-of target is null.
    const frame: RoleFrame = { sourceId: 'hero' };
    const map = deriveRoles(frame);
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'target' }, map)).toBeNull();
  });

  it('negative: an unknown role in the map rejects', () => {
    const frame: RoleFrame = { sourceId: 'hero' }; // no carrier derived
    const map = deriveRoles(frame);
    expect(resolveRoleSelector({ kind: 'role', role: 'carrier' }, map)).toBeNull();
  });

  it('boundary: source == target == controller collapses to one id without breaking derivation', () => {
    const frame: RoleFrame = {
      sourceId: 'self',
      targetId: 'self',
      controllers: { source: 'self', target: 'self' },
    };
    const map = deriveRoles(frame);
    expect(map.roles.source).toBe('self');
    expect(map.roles.target).toBe('self');
    expect(resolveRoleSelector({ kind: 'role', role: 'source' }, map)).toBe('self');
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'target' }, map)).toBe('self');
  });
});

describe('U2 ROLE — controller authority is SUBJECT-RELATIVE (corrective pass 2026-08-30)', () => {
  it('positive: source and target have DIFFERENT controllers', () => {
    const frame: RoleFrame = {
      sourceId: 'hero',
      targetId: 'foe',
      controllers: { source: 'player-a', target: 'player-b' },
    };
    const map = deriveRoles(frame);
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'source' }, map)).toBe('player-a');
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'target' }, map)).toBe('player-b');
    expect(map.controllers.source).not.toBe(map.controllers.target);
  });

  it('positive: mark OWNER and mark CARRIER can have different controllers', () => {
    const frame: RoleFrame = {
      sourceId: 'hero',
      ownerId: 'hero',
      carrierId: 'ally',
      controllers: { owner: 'player-a', carrier: 'player-c' },
    };
    const map = deriveRoles(frame);
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'owner' }, map)).toBe('player-a');
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'carrier' }, map)).toBe('player-c');
  });

  it('negative: missing controller for an otherwise valid subject returns null — it must NOT silently return source', () => {
    // The subject (target) is derivable, but no controller is recorded for it.
    const frame: RoleFrame = {
      sourceId: 'hero',
      targetId: 'foe',
      controllers: { source: 'player-a' }, // only the source has a recorded controller
    };
    const map = deriveRoles(frame);
    expect(map.roles.target).toBe('foe'); // subject is valid…
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'target' }, map)).toBeNull(); // …but has no controller
  });

  it('negative: missing subject returns null', () => {
    const frame: RoleFrame = { sourceId: 'hero', controllers: { target: 'player-b' } };
    const map = deriveRoles(frame);
    expect(map.roles.target).toBeUndefined();
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'target' }, map)).toBeNull();
  });

  it('replay: the same durable controller map derives the same subject-relative authority', () => {
    const frame: RoleFrame = {
      sourceId: 'hero',
      targetId: 'foe',
      controllers: { source: 'player-a', target: 'player-b' },
    };
    expect(deriveRoles(frame)).toEqual(deriveRoles(frame));
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
    const map = deriveRoles(roleFrameFromContext(ctx()));
    expect(map.roles.source).toBe('hero');
    expect(map.roles.target).toBe('foe');
    expect(map.roles.recipient).toBe('foe');
    expect(map.roles['trigger-source']).toBe('trap');
    expect(map.roles['trigger-recipient']).toBe('hero');
    expect(map.roles.attacker).toBe('hero');
    expect(map.roles.defender).toBe('foe');
  });

  it('negative: the legacy seam records no controllers, so controller-of fails closed (never guesses source)', () => {
    const map = deriveRoles(roleFrameFromContext(ctx()));
    expect(map.controllers).toEqual({});
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'target' }, map)).toBeNull();
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'source' }, map)).toBeNull();
  });
});