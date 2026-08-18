import { describe, expect, it } from 'vitest';
import { createFoe } from '../encounter.js';
import { parseClientMessage } from '../protocol.js';

describe('realtime protocol validation', () => {
  it('accepts known, fully shaped messages', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ping' }))).toEqual({ type: 'ping' });
    expect(parseClientMessage(JSON.stringify({ type: 'join', encounterId: 'encounter-1', token: 'dev:user:gm' }))).toMatchObject({ type: 'join' });
    const actor = createFoe('Test foe', { x: 2, y: 2 });
    expect(parseClientMessage(JSON.stringify({ type: 'command', encounterId: 'encounter-1', expectedRevision: 0, command: { type: 'ADD_ACTOR', actor } }))).toMatchObject({
      type: 'command',
      command: { type: 'ADD_ACTOR', actor: { name: 'Test foe' } },
    });
  });

  it('rejects malformed commands and unknown fields', () => {
    expect(() => parseClientMessage(JSON.stringify({ type: 'command', encounterId: 'encounter-1', expectedRevision: 0, command: { type: 'MOVE', path: [], mode: 'teleport' } }))).toThrow(/Invalid websocket message/);
    expect(() => parseClientMessage(JSON.stringify({ type: 'ping', injected: true }))).toThrow(/Invalid websocket message/);
  });
});
