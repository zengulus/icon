import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { JOBS, findAbility, findJob } from '../rules/catalog.js';
import { createCharacter } from '../rules/character.js';
import { actorFromCharacter, createEncounter, createFoeFromProfile } from '../rules/encounter.js';
import { seededDice } from '../rules/dice.js';
import { FOE_PROFILES } from '../rules/foes.js';
import { planMovement } from '../rules/movement.js';
import {
  applyRoomEvents,
  assertValidVttRoomState,
  createVttRoom,
  executeRoomCommand,
  type AreaTemplate,
  type AreaTemplateKind,
  type RoomCommand,
  type VttRoomState,
} from '../rules/vtt-room.js';
import type { EncounterCommand, EncounterEvent, EncounterState, Position, TerrainType } from '../rules/types.js';
import { assetBackground } from '../vtt/presentation.js';
import {
  fitWorldBounds,
  gridBoundsToWorld,
  panCameraBy,
  zoomCameraAtScreenPoint,
  type CameraTransform,
  type TacticalViewportGeometry,
  type ViewportRect,
} from '../vtt/geometry.js';
import { restorePersistedVttRoom } from '../vtt/persistence.js';
import { TacticalViewport, type InteractionMode, type TableTool } from '../vtt/tactical-viewport.js';

/**
 * Browser-local Lab (`#/lab`).
 *
 * This page is deliberately independent of both the Supabase data layer and
 * the Render realtime server: it boots a preset local authoritative room from
 * the pure room reducer (`rules/vtt-room.ts`), persists only to browser local
 * storage, and renders through the shared `TacticalViewport`. It is registered
 * on its own route OUTSIDE the `CharacterProvider`, so mounting it never calls
 * `supabase.auth.getUser` or any cloud/realtime service.
 *
 * It is a human-testing service, not a multiplayer authority: there is no
 * account, network connection, or shared checkpoint — every command is a
 * local replay. It deliberately remains available at every release phase.
 */
const STORAGE_KEY = 'icon.browser-vtt.room.v1';
const PREFERENCES_KEY = 'icon.browser-vtt.preferences.v1';

const labFoes = FOE_PROFILES.filter(({ roleId }) => roleId !== 'mob' && roleId !== 'special');
const defaultLabFoe = labFoes.find(({ roleId }) => roleId === 'heavy') ?? labFoes[0]!;

const terrainOptions: Array<{ id: TerrainType; label: string }> = [
  { id: 'basic', label: 'Clear' },
  { id: 'difficult', label: 'Difficult' },
  { id: 'dangerous', label: 'Dangerous' },
  { id: 'impassable', label: 'Impassable' },
  { id: 'pit', label: 'Pit' },
  { id: 'slope', label: 'Slope' },
];

interface Preferences {
  jobId: string;
  foeProfileId: string;
  seed: number;
}

const defaultPreferences: Preferences = { jobId: JOBS[0]!.id, foeProfileId: defaultLabFoe.id, seed: 1907 };

function loadPreferences(): Preferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '') as Partial<Preferences>;
    return {
      jobId: findJob(parsed.jobId ?? '')?.id ?? defaultPreferences.jobId,
      foeProfileId: labFoes.find(({ id }) => id === parsed.foeProfileId)?.id ?? defaultPreferences.foeProfileId,
      seed: Number.isSafeInteger(parsed.seed) ? Number(parsed.seed) : defaultPreferences.seed,
    };
  } catch {
    return defaultPreferences;
  }
}

function makeTableId(prefix: string): string {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function samePosition(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
}

function createLabFixture(preferences: Preferences): VttRoomState {
  const job = findJob(preferences.jobId) ?? JOBS[0]!;
  const character = createCharacter('2026-08-19T00:00:00.000Z');
  character.id = 'browser-vtt-hero';
  character.name = `${job.name} Test Icon`;
  character.level = 12;
  character.jobs = [job.id];
  character.primaryJobId = job.id;
  character.abilities = job.abilities.map(({ id }) => ({ abilityId: id, talent: null, mastered: false }));
  character.equippedAbilityIds = job.abilities.map(({ id }) => id);
  const hero = actorFromCharacter(character, { x: 2, y: 4 });
  const foe = createFoeFromProfile(preferences.foeProfileId, { x: 6, y: 4 }, 4, 3);
  hero.id = 'actor:browser-vtt-hero';
  foe.id = 'foe:browser-vtt-foe';
  const encounter = { ...createEncounter('Lab fixture'), id: 'browser-vtt-encounter' };
  let room = createVttRoom(encounter);
  room = executeRoomCommand(room, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: hero } }, seededDice(preferences.seed)).state;
  room = executeRoomCommand(room, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: foe } }, seededDice(preferences.seed + 1)).state;
  return executeRoomCommand(room, { domain: 'encounter', command: { type: 'START_ENCOUNTER' } }, seededDice(preferences.seed + 2)).state;
}

interface Load {
  room: VttRoomState;
  recoveryMessage: string;
}

function preserveCorruptRoom(raw: string): boolean {
  try {
    const baseKey = `${STORAGE_KEY}.corrupt`;
    const existing = localStorage.getItem(baseKey);
    // The common case is a reload before the user has chosen an action: one
    // forensic copy is enough and avoids adding a new record on each mount.
    if (existing === raw) return true;
    const key = existing === null
      ? baseKey
      : `${baseKey}.${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? 'recovery'}`;
    localStorage.setItem(key, raw);
    return true;
  } catch {
    // Keep the active record untouched when browser storage is unavailable;
    // a later command will still surface its save failure rather than quietly
    // replacing the malformed payload.
    return false;
  }
}

function loadRoom(preferences: Preferences): Load {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return { room: createLabFixture(preferences), recoveryMessage: '' };
    try {
      return { room: restorePersistedVttRoom(JSON.parse(stored)), recoveryMessage: '' };
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'The saved room is malformed.';
      const preserved = preserveCorruptRoom(stored);
      return {
        room: createLabFixture(preferences),
        recoveryMessage: `The previous local room was not loaded: ${detail}${preserved ? ' A recovery copy was kept in local storage.' : ''}`,
      };
    }
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : 'Browser storage is unavailable.';
    return { room: createLabFixture(preferences), recoveryMessage: `The previous local room could not be read: ${detail}` };
  }
}

function persistRoom(room: VttRoomState): void {
  assertValidVttRoomState(room);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(room));
}

interface DragState {
  pointerId: number;
  clientX: number;
  clientY: number;
  moved: boolean;
}

function eventSummary(event: EncounterEvent, state: EncounterState) {
  if (event.type === 'ABILITY_RESOLVED') {
    const ability = findAbility(event.abilityId);
    const result = event.attack ? `${event.attack.hit ? 'hit' : 'miss'} · ${event.attack.appliedDamage} damage` : 'cost and targeting resolved';
    return { title: ability?.name ?? event.abilityId, detail: result };
  }
  if (event.type === 'RULE_MUTATIONS_APPLIED') return { title: event.sourceId, detail: `${event.actionId} · ${event.mutations.length} state mutations` };
  const actor = 'actorId' in event ? state.actors[event.actorId] : null;
  return { title: event.type.replaceAll('_', ' '), detail: actor?.name ?? '' };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function useViewportSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function Lab() {
  const [preferences, setPreferences] = useState(loadPreferences);
  const initialLoad = useRef<Load | null>(null);
  if (initialLoad.current === null) {
    initialLoad.current = loadRoom(preferences);
  }
  const [room, setRoom] = useState<VttRoomState>(() => initialLoad.current!.room);
  const [mode, setMode] = useState<InteractionMode>('standard');
  const [tableTool, setTableTool] = useState<TableTool>('select');
  const [selectedCell, setSelectedCell] = useState<Position | null>(null);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [selectedAbilityId, setSelectedAbilityId] = useState('');
  const [terrainType, setTerrainType] = useState<TerrainType>('difficult');
  const [terrainElevation, setTerrainElevation] = useState(0);
  const [templateKind, setTemplateKind] = useState<AreaTemplateKind>('burst');
  const [templateLength, setTemplateLength] = useState(2);
  const [templateWidth, setTemplateWidth] = useState(2);
  const [annotationColor, setAnnotationColor] = useState('#d8ef62');
  const [error, setError] = useState(() => initialLoad.current!.recoveryMessage);
  const [replayMatches, setReplayMatches] = useState<boolean | null>(null);
  const [camera, setCamera] = useState<CameraTransform>({ pan: { x: 0, y: 0 }, zoom: 1 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const ignoreNextCellClick = useRef(false);
  const hasFittedCamera = useRef(false);
  const viewportSize = useViewportSize(viewportRef);

  const encounter = room.encounter;
  const active = encounter.activeActorId ? encounter.actors[encounter.activeActorId] : null;
  const selectedActor = selectedActorId ? encounter.actors[selectedActorId] ?? null : null;
  const selectedAbility = selectedAbilityId ? findAbility(selectedAbilityId) : undefined;
  const recentEvents = useMemo(() => [...encounter.eventLog].reverse().slice(0, 30), [encounter.eventLog]);

  const viewport = useMemo<ViewportRect>(() => ({ x: 0, y: 0, width: Math.max(1, viewportSize.width), height: Math.max(1, viewportSize.height) }), [viewportSize]);
  const geometry = useMemo<TacticalViewportGeometry>(() => ({
    camera,
    viewport,
    grid: { cellSize: room.table.map.cellSize },
    map: { scale: room.table.map.scale, offset: room.table.map.offset },
  }), [camera, room.table.map, viewport]);

  useEffect(() => {
    if (selectedActorId && !encounter.actors[selectedActorId]) setSelectedActorId(null);
  }, [encounter.actors, selectedActorId]);

  const fitCamera = useCallback(() => {
    if (viewport.width <= 1 || viewport.height <= 1) return;
    setCamera(fitWorldBounds(gridBoundsToWorld(encounter.grid, { cellSize: room.table.map.cellSize }), viewport, { padding: 34, minZoom: .2, maxZoom: 3 }));
  }, [encounter.grid, room.table.map.cellSize, viewport]);

  useEffect(() => {
    if (!hasFittedCamera.current && viewport.width > 1 && viewport.height > 1) {
      hasFittedCamera.current = true;
      fitCamera();
    }
  }, [fitCamera, viewport.height, viewport.width]);

  function runRoomCommand(command: RoomCommand): boolean {
    try {
      const result = executeRoomCommand(room, command, seededDice(room.revision + preferences.seed));
      const replayed = applyRoomEvents(room, result.events);
      setRoom(result.state);
      persistRoom(result.state);
      setReplayMatches(JSON.stringify(replayed) === JSON.stringify(result.state));
      setError('');
      if (command.domain === 'encounter' && command.command.type === 'USE_ABILITY') setSelectedAbilityId('');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That operation is not legal.');
      setReplayMatches(null);
      return false;
    }
  }

  function runEncounterCommand(command: EncounterCommand): boolean {
    return runRoomCommand({ domain: 'encounter', command });
  }

  function reset() {
    const fresh = createLabFixture(preferences);
    setRoom(fresh);
    setSelectedAbilityId('');
    setSelectedActorId(null);
    setSelectedCell(null);
    setMode('standard');
    setTableTool('select');
    setReplayMatches(null);
    setError('');
    hasFittedCamera.current = false;
    localStorage.removeItem(STORAGE_KEY);
  }

  function applyPreferences(next: Preferences) {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    setPreferences(next);
    reset();
  }

  function chooseMode(nextMode: InteractionMode, abilityId = '') {
    setMode(nextMode);
    setSelectedAbilityId(abilityId);
    setTableTool('select');
    setError('');
  }

  function activateTableTool(tool: TableTool) {
    setTableTool(tool);
    setSelectedAbilityId('');
    setError('');
  }

  function clickCell(position: Position) {
    if (ignoreNextCellClick.current) {
      ignoreNextCellClick.current = false;
      return;
    }
    setSelectedCell(position);
    const target = Object.values(encounter.actors).find((actor) => samePosition(actor.position, position));
    if (target) setSelectedActorId(target.id);
    if (tableTool === 'pan') return;
    if (tableTool === 'fog') {
      runRoomCommand({ domain: 'table', command: { type: 'PAINT_FOG', region: { id: makeTableId('fog'), cells: [position] } } });
      return;
    }
    if (tableTool === 'marker') {
      runRoomCommand({ domain: 'table', command: { type: 'UPSERT_ANNOTATION', annotation: { id: makeTableId('annotation'), kind: 'marker', points: [position], color: annotationColor, text: '•' } } });
      return;
    }
    if (tableTool === 'line' || tableTool === 'arrow') {
      runRoomCommand({ domain: 'table', command: { type: 'UPSERT_ANNOTATION', annotation: { id: makeTableId('annotation'), kind: tableTool, points: [position], color: annotationColor, text: '' } } });
      return;
    }
    if (tableTool === 'template') {
      const template: AreaTemplate = {
        id: makeTableId('template'), kind: templateKind, origin: position, rotation: 0,
        length: Math.max(1, Math.round(templateLength)), width: Math.max(1, Math.round(templateWidth)), label: '', color: annotationColor,
      };
      runRoomCommand({ domain: 'table', command: { type: 'UPSERT_TEMPLATE', template } });
      return;
    }
    if (tableTool === 'terrain') {
      if (encounter.phase !== 'setup') {
        setError('Terrain is locked after the encounter starts.');
        return;
      }
      runEncounterCommand({ type: 'SET_TERRAIN', cell: { position, type: terrainType, elevation: Math.max(0, Math.round(terrainElevation)) } });
      return;
    }
    if (!active || encounter.phase !== 'active') return;
    if (target && target.defeated && target.side === active.side && mode === 'rescue') {
      runEncounterCommand({ type: 'RESCUE', actorId: active.id, targetId: target.id });
      return;
    }
    if (target && mode === 'ability' && selectedAbilityId) {
      runEncounterCommand({ type: 'USE_ABILITY', actorId: active.id, abilityId: selectedAbilityId, targetIds: [target.id] });
      return;
    }
    if (target && target.side !== active.side && (mode === 'light' || mode === 'heavy')) {
      runEncounterCommand({ type: 'BASIC_ATTACK', actorId: active.id, targetId: target.id, weight: mode });
      return;
    }
    if (!target && (mode === 'standard' || mode === 'dash')) {
      const plan = planMovement(encounter, active.id, position, mode);
      if (!plan.legal) {
        setError(plan.issue?.message ?? 'No legal route reaches that space.');
        return;
      }
      runEncounterCommand({ type: 'MOVE', actorId: active.id, path: plan.path, mode });
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 1 && tableTool !== 'pan') return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = { x: event.clientX - drag.clientX, y: event.clientY - drag.clientY };
    if (Math.abs(delta.x) + Math.abs(delta.y) > 1) drag.moved = true;
    setCamera((current) => panCameraBy(current, delta));
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (drag.moved) {
      ignoreNextCellClick.current = true;
      window.setTimeout(() => { ignoreNextCellClick.current = false; }, 0);
    }
  }

  function handleWheel(event: WheelEvent) {
    const target = viewportRef.current;
    if (!target) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setCamera((current) => zoomCameraAtScreenPoint(current, viewport, anchor, clamp(current.zoom * (event.deltaY > 0 ? .9 : 1.1), .2, 4)));
  }

  const tools: Array<[TableTool, string]> = [
    ['select', 'Select'], ['pan', 'Pan'], ['fog', 'Fog'], ['marker', 'Mark'], ['line', 'Line'], ['arrow', 'Arrow'], ['template', 'Area'], ['terrain', 'Terrain'],
  ];

  return (
    <div className="sandbox-page vtt-page">
      <header className="sandbox-header vtt-header">
        <div>
          <p className="eyebrow">Lab // browser-local human testing</p>
          <h1>{encounter.name}</h1>
          <p>Runs entirely in this browser against the local authoritative room reducer. No Supabase, no Render server, and no shared room — commands replay locally and persist only to this browser.</p>
        </div>
        <div className="battle-status"><span>ROUND <b>{encounter.round || '—'}</b></span><span>RESOLVE <b>{encounter.partyResolve}</b></span><span>ROOM REV <b>{room.revision}</b></span><a href="#/"><span>← Back to app</span></a></div>
      </header>
      {error && <div className="battle-error">{error}</div>}
      <div className="vtt-workspace">
        <aside className="vtt-roster">
          <div className="vtt-panel-heading"><div><p className="eyebrow">Fixture</p><h2>Test combatants</h2></div><span>{Object.keys(encounter.actors).length}</span></div>
          <div className="vtt-combatant-list">
            {Object.values(encounter.actors).map((actor) => (
              <button className={`vtt-combatant ${actor.id === selectedActorId ? 'is-selected' : ''} ${actor.id === encounter.activeActorId ? 'is-active' : ''}`} key={actor.id} onClick={() => { setSelectedActorId(actor.id); setSelectedCell(actor.position); }}>
                <span className={`vtt-token-mini ${actor.side}`} style={assetBackground(actor.tokenUrl)}>{!assetBackground(actor.tokenUrl) && actor.name.slice(0, 1)}</span>
                <span><strong>{actor.name}</strong><small>{actor.side} · DEF {actor.defense} · {actor.actionsRemaining} ACT</small><i><b style={{ width: `${Math.max(0, Math.min(100, actor.hp / actor.baseMaxHp * 100))}%` }} /></i><small>{actor.hp}/{actor.baseMaxHp} HP{actor.vigor ? ` · ${actor.vigor} vigor` : ''}</small></span>
              </button>
            ))}
          </div>
          <details className="lab-fixture-controls">
            <summary>Fixture controls</summary>
            <label>Icon Job<select value={preferences.jobId} onChange={(event) => applyPreferences({ ...preferences, jobId: event.target.value })}>{JOBS.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}</select></label>
            <label>Test foe<select value={preferences.foeProfileId} onChange={(event) => applyPreferences({ ...preferences, foeProfileId: event.target.value })}>{labFoes.map((profile) => <option key={profile.id} value={profile.id}>{profile.faction} · {profile.name}</option>)}</select></label>
            <label>Dice seed<input type="number" value={preferences.seed} onChange={(event) => applyPreferences({ ...preferences, seed: Number(event.target.value) || 0 })} /></label>
          </details>
          <button className="text-button danger reset-button" onClick={reset}>Reset local room</button>
        </aside>

        <section className="vtt-table">
          <div className="vtt-toolbar" aria-label="Table tools">
            {tools.map(([tool, label]) => <button key={tool} className={tableTool === tool ? 'active' : ''} onClick={() => activateTableTool(tool)}>{label}</button>)}
            <span className="vtt-tool-hint">{tableTool === 'pan' ? 'Drag or use middle mouse' : 'Click a grid cell'}</span>
          </div>
          <TacticalViewport room={room} geometry={geometry} tableTool={tableTool} selectedCell={selectedCell} selectedActorId={selectedActorId} draftAnnotationStart={null} viewportRef={viewportRef} onCell={clickCell} onTokenSelect={(actor) => { setSelectedActorId(actor.id); setSelectedCell(actor.position); clickCell(actor.position); }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel} />
          <div className="vtt-camera-bar"><button onClick={fitCamera}>Fit map</button><button onClick={() => setCamera((current) => ({ ...current, zoom: clamp(current.zoom / 1.15, .2, 4) }))}>−</button><output>{Math.round(camera.zoom * 100)}%</output><button onClick={() => setCamera((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, .2, 4) }))}>+</button><span>Wheel to zoom at pointer · Pan never alters a mechanical space</span></div>
        </section>

        <aside className="vtt-inspector">
          <section>
            <p className="eyebrow">Active turn</p><h2>{active?.name ?? (encounter.phase === 'setup' ? 'Setup' : 'Encounter complete')}</h2>
            {active && <>
              <div className="action-pips">{[0, 1].map((index) => <span key={index} className={active.actionsRemaining > index ? 'available' : ''} />)}<small>{active.actionsRemaining} actions</small></div>
              <div className="vtt-mode-grid">
                <button className={mode === 'standard' ? 'selected' : ''} onClick={() => chooseMode('standard')}>Move <small>{active.speed} spaces · free</small></button>
                <button className={mode === 'dash' ? 'selected' : ''} onClick={() => chooseMode('dash')}>Dash <small>{active.dash} spaces · 1 ACT</small></button>
                <button className={mode === 'light' ? 'selected' : ''} onClick={() => chooseMode('light')}>Light attack <small>1 action</small></button>
                <button className={mode === 'heavy' ? 'selected' : ''} onClick={() => chooseMode('heavy')}>Heavy attack <small>2 actions</small></button>
                <button className={mode === 'rescue' ? 'selected' : ''} onClick={() => chooseMode('rescue')}>Rescue <small>1 action · ally</small></button>
              </div>
              {active.abilityIds.length > 0 && <div className="turn-abilities"><h3>Equipped abilities</h3>{active.abilityIds.map((abilityId) => { const ability = findAbility(abilityId); if (!ability) return null; return <button key={ability.id} className={selectedAbilityId === ability.id ? 'selected' : ''} disabled={ability.chapter > active.chapter} onClick={() => { if (ability.automation === 'executable') chooseMode('ability', ability.id); }}><strong>{ability.name}</strong><small>{ability.header} · {ability.automation === 'executable' ? 'executable' : 'source only'}</small></button>; })}</div>}
              {selectedAbility && <div className="selected-ability"><strong>{selectedAbility.name}</strong><p>{selectedAbility.summary}</p><small>{selectedAbility.header} · p.{selectedAbility.source.page}</small><p className="source-rules-text">{selectedAbility.rulesText}</p>{selectedAbility.automation === 'executable' ? <button className="button compact full" onClick={() => runEncounterCommand({ type: 'USE_ABILITY', actorId: active.id, abilityId: selectedAbility.id, targetIds: selectedAbility.tags.includes('self') ? [active.id] : [] })}>Use without map target</button> : <em>This procedure is indexed for reference only.</em>}</div>}
              <button className="button compact full" onClick={() => runEncounterCommand({ type: 'RECOVER', actorId: active.id })}>Recover</button>
              <button className="button primary full" onClick={() => runEncounterCommand({ type: 'END_TURN', actorId: active.id })}>End turn</button>
            </>}
          </section>

          <section className="vtt-table-controls">
            <p className="eyebrow">Table state</p><h3>Map & calibration</h3>
            <label>Map image URL<input placeholder="https://…" defaultValue={room.table.map.backgroundUrl} onBlur={(event) => runRoomCommand({ domain: 'table', command: { type: 'SET_MAP', map: { backgroundUrl: event.target.value } } })} /></label>
            <div className="vtt-control-grid"><label>Cell px<input type="number" min="8" max="1024" value={room.table.map.cellSize} onChange={(event) => runRoomCommand({ domain: 'table', command: { type: 'SET_MAP', map: { cellSize: Number(event.target.value) || 64 } } })} /></label><label>Map scale<input type="number" min="0.1" max="100" step=".1" value={room.table.map.scale} onChange={(event) => runRoomCommand({ domain: 'table', command: { type: 'SET_MAP', map: { scale: Number(event.target.value) || 1 } } })} /></label></div>
            <div className="vtt-toggle-row"><label><input type="checkbox" checked={room.table.map.showGrid} onChange={(event) => runRoomCommand({ domain: 'table', command: { type: 'SET_MAP', map: { showGrid: event.target.checked } } })} /> Grid</label><label><input type="checkbox" checked={room.table.map.showCoordinates} onChange={(event) => runRoomCommand({ domain: 'table', command: { type: 'SET_MAP', map: { showCoordinates: event.target.checked } } })} /> Coordinates</label></div>
            {tableTool === 'terrain' && <div className="vtt-tool-options"><label>Terrain<select value={terrainType} onChange={(event) => setTerrainType(event.target.value as TerrainType)}>{terrainOptions.map((terrain) => <option key={terrain.id} value={terrain.id}>{terrain.label}</option>)}</select></label><label>Elevation<input type="number" min="0" max="99" value={terrainElevation} onChange={(event) => setTerrainElevation(Number(event.target.value) || 0)} /></label></div>}
            {(['marker', 'line', 'arrow', 'template'] as TableTool[]).includes(tableTool) && <div className="vtt-tool-options"><label>Colour<input type="color" value={annotationColor} onChange={(event) => setAnnotationColor(event.target.value)} /></label>{tableTool === 'template' && <><label>Shape<select value={templateKind} onChange={(event) => setTemplateKind(event.target.value as AreaTemplateKind)}><option value="burst">Burst</option><option value="cone">Cone</option><option value="line">Line</option><option value="rectangle">Rectangle</option></select></label><label>Length<input type="number" min="1" max="100" value={templateLength} onChange={(event) => setTemplateLength(Number(event.target.value) || 1)} /></label><label>Width<input type="number" min="1" max="100" value={templateWidth} onChange={(event) => setTemplateWidth(Number(event.target.value) || 1)} /></label></>}</div>}
            <div className="vtt-table-actions"><button onClick={() => runRoomCommand({ domain: 'table', command: { type: 'CLEAR_FOG' } })} disabled={!room.table.fog.length}>Clear fog</button></div>
          </section>
        </aside>
      </div>

      <section className="vtt-log-panel"><div><p className="eyebrow">Reducer event log</p><h2>What the local rules engine accepted</h2></div><span className={replayMatches === false ? 'failed' : replayMatches ? 'passed' : ''}>{replayMatches === null ? 'No operation replayed yet' : replayMatches ? '✓ deterministic room replay matches' : '⚠ replay mismatch'}</span><div className="event-log">{recentEvents.map((event, index) => { const summary = eventSummary(event, encounter); return <div key={`${encounter.revision}-${index}`}><strong>{summary.title}</strong><small>{summary.detail}</small></div>; })}{recentEvents.length === 0 && <p>No accepted mechanical events yet.</p>}</div></section>
    </div>
  );
}
