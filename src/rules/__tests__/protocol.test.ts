import { describe, expect, it } from 'vitest';
import { createFoe } from '../encounter.js';
import { parseClientMessage } from '../protocol.js';

describe('realtime protocol validation', () => {
  it('accepts known, fully shaped messages', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ping', encounterId: 'encounter-1', position: { x: 2, y: 3 } }))).toEqual({
      type: 'ping',
      encounterId: 'encounter-1',
      position: { x: 2, y: 3 },
    });
    expect(parseClientMessage(JSON.stringify({ type: 'join', encounterId: 'encounter-1', token: 'dev:user:gm' }))).toMatchObject({ type: 'join' });
    const actor = createFoe('Test foe', { x: 2, y: 2 });
    expect(parseClientMessage(JSON.stringify({
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: { domain: 'encounter', command: { type: 'ADD_ACTOR', actor } },
    }))).toMatchObject({
      type: 'command',
      command: { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: { name: 'Test foe' } } },
    });
    expect(parseClientMessage(JSON.stringify({ type: 'save', encounterId: 'encounter-1', expectedRevision: 3 }))).toEqual({
      type: 'save',
      encounterId: 'encounter-1',
      expectedRevision: 3,
    });
  });

  it('rejects malformed commands and unknown fields', () => {
    expect(() => parseClientMessage(JSON.stringify({
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: { domain: 'encounter', command: { type: 'MOVE', path: [], mode: 'teleport' } },
    }))).toThrow(/Invalid websocket message/);
    expect(() => parseClientMessage(JSON.stringify({
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: {
        domain: 'table',
        command: {
          type: 'UPSERT_ANNOTATION',
          annotation: {
            id: 'spoofed-note',
            kind: 'note',
            points: [{ x: 1, y: 1 }],
            color: '#000',
            text: 'This user must not choose its server-side owner.',
            authorId: 'another-user',
          },
        },
      },
    }))).toThrow(/Invalid websocket message/);
    expect(() => parseClientMessage(JSON.stringify({ type: 'ping', encounterId: 'encounter-1', position: { x: 1, y: 1 }, injected: true }))).toThrow(/Invalid websocket message/);
    expect(() => parseClientMessage(JSON.stringify({ type: 'ping', encounterId: 'encounter-1', position: { x: 10_001, y: 1 } }))).toThrow(/Invalid websocket message/);
    expect(() => parseClientMessage(JSON.stringify({
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: { domain: 'encounter', command: { type: 'BASIC_ATTACK', actorId: 'a', targetId: 'b', weight: 'light', boons: 20, cover: false } },
    }))).toThrow(/Invalid websocket message/);
    expect(() => parseClientMessage(JSON.stringify({
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: { domain: 'encounter', command: { type: 'APPLY_STATUS', actorId: 'a', targetId: 'b', status: 'stunned' } },
    }))).toThrow(/Invalid websocket message/);
    const blobActor = createFoe('Non-durable token', { x: 2, y: 2 });
    blobActor.tokenUrl = '  BlOb:https://example.test/temporary-token';
    expect(() => parseClientMessage(JSON.stringify({
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: blobActor } },
    }))).toThrow(/durable/i);
    const incompleteActor = createFoe('Missing canonical field', { x: 2, y: 2 }) as unknown as Record<string, unknown>;
    delete incompleteActor.foeProfileId;
    expect(() => parseClientMessage(JSON.stringify({
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: incompleteActor } },
    }))).toThrow(/Invalid websocket message/);
    expect(() => parseClientMessage(JSON.stringify({
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: { domain: 'table', command: { type: 'SET_MAP', map: { backgroundUrl: 'blob:temporary-map' } } },
    }))).toThrow(/durable/i);
    const oversizedActor = createFoe('Too many durable resources', { x: 2, y: 2 });
    oversizedActor.resources = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`resource-${index}`, index]));
    expect(() => parseClientMessage(JSON.stringify({
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: oversizedActor } },
    }))).toThrow(/Record cannot contain more than 500 entries/i);
  });

  it('accepts bounded explicit Blessing choices for command-time status saves', () => {
    const message = {
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: {
        domain: 'encounter',
        command: {
          type: 'EXECUTE_RULE',
          actorId: 'mender',
          sourceId: 'mendicant:trait:diaga',
          actionId: 'default',
          timing: 'use',
          attackTargetId: 'patient',
          input: { statusSaveChoices: { patient: { blind: { spendBlessing: true } } } },
        },
      },
    };
    expect(parseClientMessage(JSON.stringify(message))).toMatchObject({
      type: 'command',
      command: { domain: 'encounter', command: { input: { statusSaveChoices: { patient: { blind: { spendBlessing: true } } } } } },
    });
    expect(() => parseClientMessage(JSON.stringify({
      ...message,
      command: {
        ...message.command,
        command: {
          ...message.command.command,
          input: { statusSaveChoices: { patient: { blind: { spendBlessing: true, injected: true } } } },
        },
      },
    }))).toThrow(/Invalid websocket message/);

    const recoverMessage = {
      type: 'command',
      encounterId: 'encounter-1',
      expectedRevision: 0,
      command: {
        domain: 'encounter',
        command: {
          type: 'RECOVER',
          actorId: 'patient',
          input: { statusSaveChoices: { patient: { blind: { spendBlessing: true } } } },
        },
      },
    };
    expect(parseClientMessage(JSON.stringify(recoverMessage))).toMatchObject({
      type: 'command',
      command: { domain: 'encounter', command: { type: 'RECOVER', input: { statusSaveChoices: { patient: { blind: { spendBlessing: true } } } } } },
    });
    expect(() => parseClientMessage(JSON.stringify({
      ...recoverMessage,
      command: {
        ...recoverMessage.command,
        command: {
          ...recoverMessage.command.command,
          // Core commands do not accept generic VM selectors or costs.
          input: { actorIds: { target: ['spoofed'] } },
        },
      },
    }))).toThrow(/Invalid websocket message/);
  });
});
