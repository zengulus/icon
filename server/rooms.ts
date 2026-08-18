import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WebSocket } from 'ws';
import { createEncounter, executeCommand, migrateEncounter, RuleViolation } from '../src/rules/encounter.js';
import type { EncounterCommand, EncounterState } from '../src/rules/types.js';
import type { ServerMessage } from '../src/rules/protocol.js';
import { sendDiscordNotice } from './discord.js';
import type { ServerConfig } from './config.js';

export interface AuthenticatedClient {
  socket: WebSocket;
  userId: string;
  role: 'gm' | 'player';
  encounterId: string;
}

interface Room {
  id: string;
  campaignId: string | null;
  state: EncounterState;
  clients: Set<AuthenticatedClient>;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

interface Identity {
  userId: string;
  role: 'gm' | 'player';
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly admin: SupabaseClient | null;

  constructor(private readonly config: ServerConfig) {
    this.admin = config.supabaseUrl && config.supabaseServiceRoleKey
      ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  }

  async authenticate(token: string, encounterId: string): Promise<Identity> {
    if (this.config.allowDevAuth && token.startsWith('dev:')) {
      const [, userId = 'local-user', role = 'gm'] = token.split(':');
      return { userId, role: role === 'player' ? 'player' : 'gm' };
    }
    if (!this.admin) throw new Error('Multiplayer persistence is not configured.');
    const { data, error } = await this.admin.auth.getUser(token);
    if (error || !data.user) throw new Error('Authentication failed.');
    const { data: encounter, error: encounterError } = await this.admin.from('encounters').select('campaign_id').eq('id', encounterId).single();
    if (encounterError) throw new Error('Encounter was not found.');
    const { data: membership, error: memberError } = await this.admin.from('campaign_members').select('role').eq('campaign_id', encounter.campaign_id).eq('user_id', data.user.id).single();
    if (memberError || !membership) throw new Error('You are not a member of this campaign.');
    return { userId: data.user.id, role: membership.role === 'gm' ? 'gm' : 'player' };
  }

  async join(socket: WebSocket, encounterId: string, token: string): Promise<AuthenticatedClient> {
    const identity = await this.authenticate(token, encounterId);
    const room = await this.getRoom(encounterId);
    const client = { socket, encounterId, ...identity };
    room.clients.add(client);
    this.send(socket, { type: 'joined', encounterId, state: room.state, role: identity.role });
    return client;
  }

  leave(client: AuthenticatedClient | null) {
    if (!client) return;
    const room = this.rooms.get(client.encounterId);
    room?.clients.delete(client);
  }

  async command(client: AuthenticatedClient, expectedRevision: number, command: EncounterCommand) {
    const room = await this.getRoom(client.encounterId);
    if (expectedRevision !== room.state.revision) {
      this.send(client.socket, { type: 'error', code: 'revision.conflict', message: 'Encounter state changed; resynchronize before acting.', state: room.state });
      return;
    }
    if (!this.canRun(client, room.state, command)) {
      this.send(client.socket, { type: 'error', code: 'permission.denied', message: 'That command is not permitted for your role.' });
      return;
    }
    try {
      const beforePhase = room.state.phase;
      const result = executeCommand(room.state, command);
      room.state = result.state;
      this.broadcast(room, { type: 'events', encounterId: room.id, events: result.events, state: room.state });
      this.queueSave(room);
      if (beforePhase !== room.state.phase) {
        const activity = room.state.phase === 'active' ? 'started' : room.state.phase === 'complete' ? 'ended' : '';
        if (activity) void sendDiscordNotice(this.config.discordWebhookUrl, {
          title: `Session ${activity}`,
          description: `**${room.state.name}** ${activity} at round ${room.state.round || 1}.`,
          fields: [
            { name: 'Combatants', value: String(Object.keys(room.state.actors).length), inline: true },
            { name: 'Revision', value: String(room.state.revision), inline: true },
          ],
        }).catch((error) => console.error('Discord notification failed:', error));
      }
    } catch (error) {
      const code = error instanceof RuleViolation ? error.code : 'command.failed';
      const message = error instanceof Error ? error.message : 'The command failed.';
      this.send(client.socket, { type: 'error', code, message });
    }
  }

  status() {
    return {
      rooms: this.rooms.size,
      connections: [...this.rooms.values()].reduce((sum, room) => sum + room.clients.size, 0),
    };
  }

  private canRun(client: AuthenticatedClient, state: EncounterState, command: EncounterCommand) {
    if (client.role === 'gm') return true;
    if (['ADD_ACTOR', 'REMOVE_ACTOR', 'SET_TERRAIN', 'START_ENCOUNTER', 'END_ENCOUNTER', 'APPLY_STATUS'].includes(command.type)) return false;
    if (!('actorId' in command)) return false;
    return state.actors[command.actorId]?.controllerId === client.userId;
  }

  private async getRoom(id: string): Promise<Room> {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    let state = createEncounter('Multiplayer encounter');
    let campaignId: string | null = null;
    if (this.admin) {
      const { data, error } = await this.admin.from('encounters').select('campaign_id,state').eq('id', id).single();
      if (error) throw new Error('Encounter was not found.');
      campaignId = data.campaign_id;
      if (data.state && Object.keys(data.state).length) state = migrateEncounter(data.state);
    } else {
      state.id = id;
    }
    const room: Room = { id, campaignId, state, clients: new Set(), saveTimer: null };
    this.rooms.set(id, room);
    return room;
  }

  private queueSave(room: Room) {
    if (!this.admin) return;
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => {
      room.saveTimer = null;
      void this.admin!.from('encounters').update({ state: room.state, revision: room.state.revision, updated_at: new Date().toISOString() }).eq('id', room.id).then(({ error }) => {
        if (error) console.error('Encounter persistence failed:', error.message);
      });
    }, 250);
  }

  private send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(room: Room, message: ServerMessage) {
    for (const client of room.clients) this.send(client.socket, message);
  }
}
