import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PHASE_THREE_READY, findAbility } from '../rules/index.js';
import type { EncounterCommand, EncounterEvent, EncounterState, Position } from '../rules/types.js';
import type { TableCommand } from '../rules/vtt-room.js';
import {
  RealtimeEncounterSession,
  type EncounterSessionSnapshot,
} from '../vtt/session.js';
import { useCharacters } from '../context/CharacterContext.js';
import { currentE2EIdentity, e2eRealtimeAccessToken } from '../services/e2e-auth.js';
import { supabase } from '../services/supabase.js';
import { VttRoomBoard } from './Sandbox.js';

const realtimeUrl = import.meta.env.VITE_REALTIME_URL?.trim() ?? '';
const multiplayerPreviewEnabled = PHASE_THREE_READY
  || import.meta.env.DEV;

interface PingNotice {
  userId: string;
  position: Position;
  receivedAt: number;
}

function eventSummary(event: EncounterEvent, encounter: EncounterState): { title: string; detail: string } {
  const actorName = (actorId: string) => encounter.actors[actorId]?.name ?? actorId;
  switch (event.type) {
    case 'ENCOUNTER_STARTED':
      return { title: 'Encounter started', detail: `${actorName(event.firstActorId)} acts first` };
    case 'ACTOR_MOVED':
      return { title: `${actorName(event.actorId)} moved`, detail: `${event.mode} · ${event.path.length} space${event.path.length === 1 ? '' : 's'}` };
    case 'ATTACK_RESOLVED':
      return { title: `${actorName(event.actorId)} ${event.weight} attack`, detail: `${event.hit ? 'hit' : 'miss'}${event.critical ? ' · critical' : ''} · ${event.appliedDamage} damage` };
    case 'ABILITY_RESOLVED': {
      const ability = findAbility(event.abilityId);
      return { title: `${actorName(event.actorId)} · ${ability?.name ?? event.abilityId}`, detail: event.attack ? `${event.attack.hit ? 'hit' : 'miss'} · ${event.attack.appliedDamage} damage` : 'cost and targets resolved' };
    }
    case 'ACTOR_RECOVERED':
      return { title: `${actorName(event.actorId)} recovered`, detail: `${event.vigorGained} vigor restored` };
    case 'ACTOR_RESCUED':
      return { title: `${actorName(event.actorId)} rescued ${actorName(event.targetId)}`, detail: `${event.restoredHp} HP restored` };
    case 'ACTOR_DEFEATED':
      return { title: `${actorName(event.actorId)} defeated`, detail: event.woundGained ? 'wound gained' : 'no wound gained' };
    case 'TURN_ENDED':
      return { title: `${actorName(event.actorId)} ended their turn`, detail: `round ${event.round} · ${actorName(event.nextActorId)} next` };
    case 'ENCOUNTER_ENDED':
      return { title: 'Encounter ended', detail: 'authoritative room complete' };
    case 'STATUS_APPLIED':
      return { title: `${actorName(event.actorId)} applied ${event.status}`, detail: actorName(event.targetId) };
    case 'STATUS_REMOVED':
      return { title: `${actorName(event.actorId)} cleared ${event.status}`, detail: '' };
    case 'ACTOR_INTERACTED':
      return { title: `${actorName(event.actorId)} interacted`, detail: event.description || `(${event.position.x}, ${event.position.y})` };
    case 'RULE_MUTATIONS_APPLIED':
      return { title: `${actorName(event.actorId)} resolved ${event.actionId}`, detail: `${event.mutations.length} rule mutation${event.mutations.length === 1 ? '' : 's'}` };
    case 'ACTOR_ADDED':
      return { title: `${event.actor.name} joined`, detail: event.actor.side };
    case 'ACTOR_REMOVED':
      return { title: 'Combatant removed', detail: event.actorId };
    case 'TERRAIN_SET':
      return { title: 'Terrain updated', detail: `${event.cell.type} at (${event.cell.position.x}, ${event.cell.position.y})` };
  }
}

function humanStatus(status: EncounterSessionSnapshot['status'] | 'connecting') {
  return status.replace('-', ' ');
}

/**
 * The production encounter route is intentionally a thin client: it creates
 * one Render-backed session and passes server-replaced room state to the same
 * board used by the local VTT. Camera, selection, and pings remain local.
 */
export function EncounterRoom() {
  const { encounterId } = useParams();
  const { user, cloudEnabled } = useCharacters();
  const sessionRef = useRef<RealtimeEncounterSession | null>(null);
  const [snapshot, setSnapshot] = useState<EncounterSessionSnapshot | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastPing, setLastPing] = useState<PingNotice | null>(null);

  useEffect(() => {
    if (!encounterId || !user || !realtimeUrl || !multiplayerPreviewEnabled) return undefined;
    let mounted = true;
    const session = new RealtimeEncounterSession({
      url: realtimeUrl,
      encounterId,
      userId: user.id,
      async accessToken() {
        const e2eIdentity = currentE2EIdentity();
        if (e2eIdentity && e2eIdentity.id === user.id) return e2eRealtimeAccessToken(e2eIdentity);
        const authClient = supabase;
        if (!authClient) throw new Error('Supabase authentication is not configured for this room.');
        const { data, error } = await authClient.auth.getSession();
        if (error) throw error;
        if (!data.session?.access_token) throw new Error('Your sign-in session expired. Sign in again before joining this room.');
        return data.session.access_token;
      },
      onPing(userId, position) {
        if (mounted) setLastPing({ userId, position, receivedAt: Date.now() });
      },
    });
    sessionRef.current = session;
    const unsubscribe = session.subscribe((next) => {
      if (mounted) setSnapshot(next);
    });
    void session.connect().catch((error) => {
      if (mounted) setConnectionError(error instanceof Error ? error.message : 'Could not connect to the authoritative room.');
    });

    return () => {
      mounted = false;
      unsubscribe();
      session.close();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [encounterId, user?.id]);

  const sendEncounter = useCallback((command: EncounterCommand): boolean => {
    try {
      const session = sessionRef.current;
      if (!session || !session.state) throw new Error('The authoritative room has not synchronized yet.');
      session.encounter(command);
      setConnectionError(null);
      return true;
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not send the mechanical command.');
      return false;
    }
  }, []);

  const sendTable = useCallback((command: TableCommand): boolean => {
    try {
      const session = sessionRef.current;
      if (!session || !session.state) throw new Error('The authoritative room has not synchronized yet.');
      session.table(command);
      setConnectionError(null);
      return true;
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not send the table command.');
      return false;
    }
  }, []);

  const sendPing = useCallback((position: Position) => {
    try {
      sessionRef.current?.ping(position);
    } catch {
      // A pointer ping is ephemeral; a reconnect will restore the board state.
    }
  }, []);

  const hardSave = useCallback(() => {
    try {
      sessionRef.current?.save();
      setConnectionError(null);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not request a completed save.');
    }
  }, []);

  const room = snapshot?.state ?? null;
  const recentEvents = useMemo(() => room ? [...room.encounter.eventLog].reverse().slice(0, 24) : [], [room]);
  const visibleError = connectionError ?? snapshot?.error ?? null;

  if (!encounterId) return <div className="page"><div className="empty-state"><h2>Encounter not found</h2><Link className="button" to="/campaigns">Return to campaigns</Link></div></div>;
  if (!multiplayerPreviewEnabled) return <div className="page gate-page"><header className="page-header"><div><p className="eyebrow">Phase 3 quality gate</p><h1>Shared rooms are not released yet</h1><p>The Render authority is available for engineering verification, but public multiplayer remains gated until the rules-complete local VTT acceptance suite passes.</p></div></header><Link className="button" to="/campaigns">Return to campaigns</Link></div>;
  if (!cloudEnabled || !user) return <div className="page"><header className="page-header"><div><p className="eyebrow">Authoritative room</p><h1>Sign in to join this encounter</h1><p>Campaign membership is verified by Render using your Supabase session.</p></div></header><Link className="button" to="/">Open roster</Link></div>;
  if (!realtimeUrl) return <div className="page"><header className="page-header"><div><p className="eyebrow">Authoritative room</p><h1>Realtime endpoint is not configured</h1><p>Add <code>VITE_REALTIME_URL</code> for the Render <code>/realtime</code> endpoint before joining this encounter.</p></div></header><Link className="button" to="/campaigns">Return to campaigns</Link></div>;

  const status = snapshot?.status ?? 'connecting';
  return <div className="vtt-page encounter-room-page">
    <header className="sandbox-header vtt-header">
      <div>
        <Link className="back-link" to="/campaigns">← Campaigns</Link>
        <p className="eyebrow">Render authoritative room</p>
        <h1>{room?.encounter.name ?? 'Joining encounter…'}</h1>
        <p>Commands are validated on Render. This client owns only camera, selection, and transient pointer pings.</p>
      </div>
      <div className="battle-status" aria-label="Room status">
        <span>CONNECTION <b className={`room-status-${status}`}>{humanStatus(status)}</b></span>
        <span>SAVE <b className={`room-save-${snapshot?.durability ?? 'unsaved'}`}>{snapshot?.durability ?? 'unsaved'}</b></span>
        <span>ROLE <b>{snapshot?.role ?? '—'}</b></span>
        <span>ROOM REV <b>{room?.revision ?? '—'}</b></span>
      </div>
      {snapshot?.role === 'gm' && <button className="button primary" disabled={!room || status !== 'connected'} onClick={hardSave}>Save now</button>}
    </header>

    {visibleError && <div className="battle-error">{visibleError}</div>}
    {lastPing && <div className="vtt-ping-notice">{lastPing.userId === user.id ? 'You' : 'A participant'} pinged ({lastPing.position.x}, {lastPing.position.y}) · {new Date(lastPing.receivedAt).toLocaleTimeString()}</div>}

    {room ? <>
      <VttRoomBoard room={room} role={snapshot?.role ?? 'player'} onEncounter={sendEncounter} onTable={sendTable} onPing={sendPing} />
      <section className="vtt-log-panel" aria-label="Authoritative mechanical event log">
        <div><p className="eyebrow">Authoritative event log</p><h2>What Render accepted</h2></div>
        <span className={snapshot?.durability === 'saved' ? 'passed' : snapshot?.durability === 'save-error' ? 'failed' : ''}>{snapshot?.durability === 'saved' ? '✓ latest checkpoint saved' : snapshot?.durability === 'save-error' ? '⚠ checkpoint retrying' : 'checkpoint pending'}</span>
        <div className="event-log">{recentEvents.map((event, index) => {
          const summary = eventSummary(event, room.encounter);
          return <div key={`${room.encounter.revision}-${index}-${event.type}`}><strong>{summary.title}</strong><small>{summary.detail}</small></div>;
        })}{recentEvents.length === 0 && <p>No accepted mechanical events yet.</p>}</div>
      </section>
    </> : <div className="empty-state"><span>◌</span><h2>Joining authoritative room…</h2><p>Render will send a role-filtered room snapshot before the board becomes interactive.</p></div>}
  </div>;
}
