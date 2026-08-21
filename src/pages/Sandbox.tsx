import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent,
} from 'react';
import { JOBS, PHASE_TWO_READY, RULES_COVERAGE, findAbility, findJob } from '../rules/catalog.js';
import { createCharacter, validateCharacter } from '../rules/character.js';
import { actorFromCharacter, createEncounter, createFoe, createFoeFromProfile } from '../rules/encounter.js';
import { seededDice } from '../rules/dice.js';
import { FOE_PROFILES } from '../rules/foes.js';
import { planMovement } from '../rules/movement.js';
import { isIndependentlyExecutableAbility } from '../rules/automation/manual-programs.js';
import { auditRuleSourceUnits, collectRuleSourceUnits, type RuleSourceKind } from '../rules/source-units.js';
import {
  applyRoomEvents,
  assertValidVttRoomState,
  createVttRoom,
  executeRoomCommand,
  type AnnotationKind,
  type AreaTemplate,
  type AreaTemplateKind,
  type RoomCommand,
  type TableCommand,
  type TableMapState,
  type VttRoomState,
} from '../rules/vtt-room.js';
import type { EncounterActor, EncounterCommand, EncounterEvent, EncounterState, Position, TerrainType } from '../rules/types.js';
import { useCharacters } from '../context/CharacterContext.js';
import { assetBackground } from '../services/assets.js';
import {
  fitWorldBounds,
  gridBoundsToWorld,
  gridCellToWorldCenter,
  gridToScreen,
  gridToWorld,
  mapToScreen,
  panCameraBy,
  worldToScreen,
  zoomCameraAtScreenPoint,
  type CameraTransform,
  type TacticalViewportGeometry,
  type ViewportRect,
} from '../vtt/geometry.js';
import { restorePersistedVttRoom } from '../vtt/persistence.js';

const STORAGE_KEY = 'icon.sandbox.room.v1';
const LEGACY_STORAGE_KEY = 'icon.sandbox.encounter.v2';
const LAB_STORAGE_KEY = 'icon.rules-lab.room.v1';
const LEGACY_LAB_STORAGE_KEY = 'icon.rules-lab.encounter.v2';
const LAB_PREFERENCES_KEY = 'icon.rules-lab.preferences.v1';
// A public build must never unlock incomplete rules automation through a
// browser-visible VITE flag. Engineering use happens only in a Vite dev/test
// server; production remains governed by the source coverage gate.
const testingEnabled = PHASE_TWO_READY || import.meta.env.DEV;

type InteractionMode = 'standard' | 'dash' | 'light' | 'heavy' | 'interact' | 'rescue' | 'ability';
export type TableTool = 'select' | 'pan' | 'fog' | 'marker' | 'line' | 'arrow' | 'template' | 'terrain';

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

interface LabPreferences {
  jobId: string;
  foeProfileId: string;
  seed: number;
}

interface DragState {
  pointerId: number;
  clientX: number;
  clientY: number;
  moved: boolean;
}

const defaultLabPreferences: LabPreferences = { jobId: JOBS[0]!.id, foeProfileId: defaultLabFoe.id, seed: 1907 };

function makeTableId(prefix: string): string {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function samePosition(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
}

function loadLabPreferences(): LabPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAB_PREFERENCES_KEY) ?? '') as Partial<LabPreferences>;
    return {
      jobId: findJob(parsed.jobId ?? '')?.id ?? defaultLabPreferences.jobId,
      foeProfileId: labFoes.find(({ id }) => id === parsed.foeProfileId)?.id ?? defaultLabPreferences.foeProfileId,
      seed: Number.isSafeInteger(parsed.seed) ? Number(parsed.seed) : defaultLabPreferences.seed,
    };
  } catch {
    return defaultLabPreferences;
  }
}

function createLabFixture(preferences: LabPreferences): VttRoomState {
  const job = findJob(preferences.jobId) ?? JOBS[0]!;
  const character = createCharacter('2026-08-19T00:00:00.000Z');
  character.id = 'rules-lab-hero';
  character.name = `${job.name} Test Icon`;
  character.level = 12;
  character.jobs = [job.id];
  character.primaryJobId = job.id;
  character.abilities = job.abilities.map(({ id }) => ({ abilityId: id, talent: null, mastered: false }));
  character.equippedAbilityIds = job.abilities.map(({ id }) => id);
  const hero = actorFromCharacter(character, { x: 2, y: 4 });
  const foe = createFoeFromProfile(preferences.foeProfileId, { x: 6, y: 4 }, 4, 3);
  hero.id = 'actor:rules-lab-hero';
  foe.id = 'foe:rules-lab-foe';
  const encounter = { ...createEncounter('Rules proving ground'), id: 'rules-lab-encounter' };
  let room = createVttRoom(encounter);
  room = executeRoomCommand(room, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: hero } }, seededDice(preferences.seed)).state;
  room = executeRoomCommand(room, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: foe } }, seededDice(preferences.seed + 1)).state;
  return executeRoomCommand(room, { domain: 'encounter', command: { type: 'START_ENCOUNTER' } }, seededDice(preferences.seed + 2)).state;
}

function createEmptyRoom(): VttRoomState {
  return createVttRoom(createEncounter('Rules proving ground'));
}

interface LocalRoomLoad {
  room: VttRoomState;
  recoveryMessage: string;
}

function preserveCorruptRoom(storageKey: string, raw: string): void {
  const backupKey = `${storageKey}.corrupt`;
  if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, raw);
}

function loadRoom(storageKey: string, legacyStorageKey: string, fallback: () => VttRoomState): LocalRoomLoad {
  try {
    const current = localStorage.getItem(storageKey);
    const sourceKey = current === null ? legacyStorageKey : storageKey;
    const stored = current ?? localStorage.getItem(legacyStorageKey);
    if (stored === null) return { room: fallback(), recoveryMessage: '' };
    try {
      return { room: restorePersistedVttRoom(JSON.parse(stored)), recoveryMessage: '' };
    } catch (reason) {
      try {
        preserveCorruptRoom(sourceKey, stored);
      } catch {
        // If browser storage is unavailable or full, leave the original record
        // in place rather than risking an unrecoverable replacement.
      }
      const detail = reason instanceof Error ? reason.message : 'The saved room is malformed.';
      return {
        room: fallback(),
        recoveryMessage: `The previous local room was not loaded: ${detail} A recovery copy was kept in local storage.`,
      };
    }
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : 'Browser storage is unavailable.';
    return { room: fallback(), recoveryMessage: `The previous local room could not be read: ${detail}` };
  }
}

function persistRoom(storageKey: string, room: VttRoomState): void {
  assertValidVttRoomState(room);
  localStorage.setItem(storageKey, JSON.stringify(room));
}

function downloadRoom(room: VttRoomState) {
  const blob = new Blob([`${JSON.stringify(room, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'icon-vtt-room.json';
  link.click();
  URL.revokeObjectURL(url);
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function Token({
  actor,
  selected,
  active,
  geometry,
  tokenUrl,
  tokenScale,
  label,
  hidden,
  onClick,
}: {
  actor: EncounterActor;
  selected: boolean;
  active: boolean;
  geometry: TacticalViewportGeometry;
  tokenUrl: string;
  tokenScale: number;
  label: string;
  hidden: boolean;
  onClick: () => void;
}) {
  const world = actor.size === 1
    ? gridCellToWorldCenter(actor.position, geometry.grid)
    : gridToWorld({ x: actor.position.x + actor.size / 2, y: actor.position.y + actor.size / 2 }, geometry.grid);
  const screen = worldToScreen(world, geometry);
  const size = geometry.grid.cellSize * geometry.camera.zoom * actor.size * tokenScale;
  const style: CSSProperties = {
    left: screen.x,
    top: screen.y,
    width: size,
    height: size,
    ...assetBackground(tokenUrl),
  };
  return (
    <button
      className={`vtt-token ${actor.side} ${active ? 'is-active' : ''} ${selected ? 'is-selected' : ''} ${actor.defeated ? 'is-defeated' : ''} ${hidden ? 'is-hidden' : ''}`}
      style={style}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      title={`${label} · ${actor.hp}/${actor.baseMaxHp} HP`}
      aria-label={`Select ${label}`}
    >
      {!assetBackground(tokenUrl) && <span>{label.slice(0, 1).toLocaleUpperCase()}</span>}
      {actor.size > 1 && <em>{actor.size}×</em>}
    </button>
  );
}

function AnnotationLayer({ annotations, geometry }: { annotations: VttRoomState['table']['annotations']; geometry: TacticalViewportGeometry }) {
  return (
    <svg className="vtt-drawing-layer" width={geometry.viewport.width} height={geometry.viewport.height} aria-hidden="true">
      <defs><marker id="vtt-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor" /></marker></defs>
      {annotations.map((annotation) => {
        const points = annotation.points.map((point) => gridToScreen({ x: point.x + 0.5, y: point.y + 0.5 }, geometry));
        const pointList = points.map(({ x, y }) => `${x},${y}`).join(' ');
        if (annotation.kind === 'marker') {
          const point = points[0]!;
          return <g key={annotation.id} className="vtt-annotation" style={{ color: annotation.color }}><circle cx={point.x} cy={point.y} r={Math.max(7, geometry.grid.cellSize * geometry.camera.zoom * .18)} /><text x={point.x} y={point.y + 4}>{annotation.text.slice(0, 1) || '•'}</text></g>;
        }
        const final = points.at(-1)!;
        return <g key={annotation.id} className="vtt-annotation" style={{ color: annotation.color }}><polyline points={pointList} markerEnd={annotation.kind === 'arrow' ? 'url(#vtt-arrowhead)' : undefined} /><text x={final.x + 7} y={final.y - 7}>{annotation.text}</text></g>;
      })}
    </svg>
  );
}

function TemplateLayer({ templates, geometry }: { templates: VttRoomState['table']['templates']; geometry: TacticalViewportGeometry }) {
  const cell = geometry.grid.cellSize * geometry.camera.zoom;
  return (
    <svg className="vtt-template-layer" width={geometry.viewport.width} height={geometry.viewport.height} aria-hidden="true">
      {templates.map((template) => {
        const center = gridToScreen({ x: template.origin.x + .5, y: template.origin.y + .5 }, geometry);
        const length = template.length * cell;
        const width = template.width * cell;
        const rotation = `rotate(${template.rotation} ${center.x} ${center.y})`;
        if (template.kind === 'burst') return <g key={template.id} className="vtt-template" style={{ color: template.color }}><circle cx={center.x} cy={center.y} r={length} /><text x={center.x} y={center.y}>{template.label || `${template.length} burst`}</text></g>;
        if (template.kind === 'cone') {
          const points = `${center.x},${center.y} ${center.x + length},${center.y - width / 2} ${center.x + length},${center.y + width / 2}`;
          return <g key={template.id} className="vtt-template" style={{ color: template.color }} transform={rotation}><polygon points={points} /><text x={center.x + length * .5} y={center.y}>{template.label || `${template.length} cone`}</text></g>;
        }
        return <g key={template.id} className="vtt-template" style={{ color: template.color }} transform={rotation}><rect x={center.x} y={center.y - width / 2} width={length} height={width} /><text x={center.x + length / 2} y={center.y}>{template.label || `${template.length} ${template.kind}`}</text></g>;
      })}
    </svg>
  );
}

/**
 * Geometry-driven, presentation-only map surface shared by the local harness
 * and a Render-backed room. It never owns a second encounter state: callers
 * receive grid-cell and token intent and submit it to their own session.
 */
export interface TacticalViewportProps {
  room: VttRoomState;
  geometry: TacticalViewportGeometry;
  tableTool: TableTool;
  selectedCell: Position | null;
  selectedActorId?: string | null;
  draftAnnotationStart: Position | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  onCell: (position: Position) => void;
  onTokenSelect: (actor: EncounterActor) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
}

export function TacticalViewport({
  room,
  geometry,
  tableTool,
  selectedCell,
  selectedActorId,
  draftAnnotationStart,
  viewportRef,
  onCell,
  onTokenSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
}: TacticalViewportProps) {
  const encounter = room.encounter;
  const screenCellSize = room.table.map.cellSize * geometry.camera.zoom;
  const gridOrigin = gridToScreen({ x: 0, y: 0 }, geometry);
  const mapOrigin = mapToScreen({ x: 0, y: 0 }, geometry);
  const terrainByCell = useMemo(() => new Map(encounter.grid.terrain.map((cell) => [`${cell.position.x},${cell.position.y}`, cell])), [encounter.grid.terrain]);
  const foggedCells = useMemo(() => new Set(room.table.fog.flatMap((region) => region.cells.map((cell) => `${cell.x},${cell.y}`))), [room.table.fog]);
  return (
    <div
      ref={viewportRef}
      className={`vtt-viewport tool-${tableTool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <div className="vtt-map-image" style={{ left: mapOrigin.x, top: mapOrigin.y, width: encounter.grid.width * room.table.map.cellSize * room.table.map.scale * geometry.camera.zoom, height: encounter.grid.height * room.table.map.cellSize * room.table.map.scale * geometry.camera.zoom, ...assetBackground(room.table.map.backgroundUrl) }} />
      <div className="vtt-grid-boundary" style={{ left: gridOrigin.x, top: gridOrigin.y, width: encounter.grid.width * screenCellSize, height: encounter.grid.height * screenCellSize }} />
      {Array.from({ length: encounter.grid.height }, (_, y) => Array.from({ length: encounter.grid.width }, (_, x) => {
        const position = { x, y };
        const point = gridToScreen(position, geometry);
        const terrain = terrainByCell.get(`${x},${y}`);
        const fogged = foggedCells.has(`${x},${y}`);
        return <button key={`${x}-${y}`} className={`vtt-cell ${room.table.map.showGrid ? 'show-grid' : ''} ${terrain?.type ?? ''} ${selectedCell && samePosition(selectedCell, position) ? 'is-selected' : ''}`} style={{ left: point.x, top: point.y, width: screenCellSize, height: screenCellSize }} onClick={() => onCell(position)} aria-label={`Grid ${x}, ${y}${terrain ? `, ${terrain.type}` : ''}`}>
          {room.table.map.showCoordinates && <small>{x},{y}</small>}
          {terrain && terrain.elevation > 0 && <i>{terrain.elevation}</i>}
          {fogged && <span className="vtt-fog-cell" />}
        </button>;
      }))}
      <TemplateLayer templates={room.table.templates} geometry={geometry} />
      <AnnotationLayer annotations={room.table.annotations} geometry={geometry} />
      {Object.values(encounter.actors).map((actor) => {
        const presentation = room.table.actorPresentation[actor.id];
        return <Token key={actor.id} actor={actor} selected={actor.id === selectedActorId} active={actor.id === encounter.activeActorId} geometry={geometry} tokenUrl={presentation?.tokenUrl ?? actor.tokenUrl} tokenScale={presentation?.tokenScale ?? 1} label={presentation?.label || actor.name} hidden={Boolean(presentation?.hidden)} onClick={() => onTokenSelect(actor)} />;
      })}
      {draftAnnotationStart && <div className="vtt-draft-point" style={{ left: gridToScreen({ x: draftAnnotationStart.x + .5, y: draftAnnotationStart.y + .5 }, geometry).x, top: gridToScreen({ x: draftAnnotationStart.x + .5, y: draftAnnotationStart.y + .5 }, geometry).y }} />}
    </div>
  );
}

/**
 * Reusable shared-room board for the Render session. Its only state is
 * ephemeral camera/tool selection; all durable actions leave through the two
 * supplied command callbacks. Sandbox uses the same TacticalViewport below.
 */
export interface VttRoomBoardProps {
  room: VttRoomState;
  role: 'gm' | 'player';
  onEncounter: (command: EncounterCommand) => void | boolean;
  onTable: (command: TableCommand) => void | boolean;
  onPing?: (position: Position) => void;
}

export function VttRoomBoard({ room, role, onEncounter, onTable, onPing }: VttRoomBoardProps) {
  const [mode, setMode] = useState<Extract<InteractionMode, 'standard' | 'dash' | 'light' | 'heavy'>>('standard');
  const [tableTool, setTableTool] = useState<TableTool>('select');
  const [selectedCell, setSelectedCell] = useState<Position | null>(null);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [draftAnnotationStart, setDraftAnnotationStart] = useState<Position | null>(null);
  const [camera, setCamera] = useState<CameraTransform>({ pan: { x: 0, y: 0 }, zoom: 1 });
  const [notice, setNotice] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const ignoreNextCellClick = useRef(false);
  const hasFittedCamera = useRef(false);
  const viewportSize = useViewportSize(viewportRef);
  const viewport = useMemo<ViewportRect>(() => ({ x: 0, y: 0, width: Math.max(1, viewportSize.width), height: Math.max(1, viewportSize.height) }), [viewportSize]);
  const geometry = useMemo<TacticalViewportGeometry>(() => ({ camera, viewport, grid: { cellSize: room.table.map.cellSize }, map: { scale: room.table.map.scale, offset: room.table.map.offset } }), [camera, room.table.map, viewport]);
  const active = room.encounter.activeActorId ? room.encounter.actors[room.encounter.activeActorId] : null;
  const fitCamera = useCallback(() => {
    if (viewport.width > 1 && viewport.height > 1) setCamera(fitWorldBounds(gridBoundsToWorld(room.encounter.grid, { cellSize: room.table.map.cellSize }), viewport, { padding: 34, minZoom: .2, maxZoom: 3 }));
  }, [room.encounter.grid, room.table.map.cellSize, viewport]);

  useEffect(() => {
    if (!hasFittedCamera.current && viewport.width > 1 && viewport.height > 1) {
      hasFittedCamera.current = true;
      fitCamera();
    }
  }, [fitCamera, viewport.height, viewport.width]);

  function emitEncounter(command: EncounterCommand) {
    if (onEncounter(command) === false) setNotice('The room rejected that mechanical command.');
    else setNotice('');
  }

  function emitTable(command: TableCommand) {
    if (onTable(command) === false) setNotice('The room rejected that table command.');
    else setNotice('');
  }

  function selectTool(next: TableTool) {
    setTableTool(next);
    setDraftAnnotationStart(null);
    setNotice('');
  }

  function clickCell(position: Position) {
    if (ignoreNextCellClick.current) {
      ignoreNextCellClick.current = false;
      return;
    }
    setSelectedCell(position);
    onPing?.(position);
    if (tableTool === 'pan') return;
    if (tableTool === 'fog') {
      if (role !== 'gm') return setNotice('Only a GM can change fog.');
      emitTable({ type: 'PAINT_FOG', region: { id: makeTableId('fog'), cells: [position] } });
      return;
    }
    if (tableTool === 'marker') {
      emitTable({ type: 'UPSERT_ANNOTATION', annotation: { id: makeTableId('annotation'), kind: 'marker', points: [position], color: '#d8ef62', text: '•' } });
      return;
    }
    if (tableTool === 'line' || tableTool === 'arrow') {
      if (!draftAnnotationStart) setDraftAnnotationStart(position);
      else {
        emitTable({ type: 'UPSERT_ANNOTATION', annotation: { id: makeTableId('annotation'), kind: tableTool, points: [draftAnnotationStart, position], color: '#d8ef62', text: '' } });
        setDraftAnnotationStart(null);
      }
      return;
    }
    if (!active || room.encounter.phase !== 'active') return;
    const target = Object.values(room.encounter.actors).find((actor) => samePosition(actor.position, position));
    if (target && target.side !== active.side && (mode === 'light' || mode === 'heavy')) {
      emitEncounter({ type: 'BASIC_ATTACK', actorId: active.id, targetId: target.id, weight: mode });
      return;
    }
    if (!target && (mode === 'standard' || mode === 'dash')) {
      const plan = planMovement(room.encounter, active.id, position, mode);
      if (!plan.legal) return setNotice(plan.issue?.message ?? 'No legal route reaches that space.');
      emitEncounter({ type: 'MOVE', actorId: active.id, path: plan.path, mode });
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

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const target = viewportRef.current;
    if (!target) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setCamera((current) => zoomCameraAtScreenPoint(current, viewport, anchor, clamp(current.zoom * (event.deltaY > 0 ? .9 : 1.1), .2, 4)));
  }

  const toolChoices: Array<[TableTool, string]> = role === 'gm'
    ? [['select', 'Select'], ['pan', 'Pan'], ['fog', 'Fog'], ['marker', 'Mark'], ['line', 'Line'], ['arrow', 'Arrow']]
    : [['select', 'Select'], ['pan', 'Pan'], ['marker', 'Mark'], ['line', 'Line'], ['arrow', 'Arrow']];
  return <section className="vtt-table vtt-room-board">
    <div className="vtt-toolbar" aria-label="Shared room board tools">
      {toolChoices.map(([tool, label]) => <button key={tool} className={tableTool === tool ? 'active' : ''} onClick={() => selectTool(tool)}>{label}</button>)}
      <button className={tableTool === 'select' && mode === 'standard' ? 'active' : ''} onClick={() => { setTableTool('select'); setMode('standard'); }}>Move</button>
      <button className={tableTool === 'select' && mode === 'dash' ? 'active' : ''} onClick={() => { setTableTool('select'); setMode('dash'); }}>Dash</button>
      <button className={tableTool === 'select' && mode === 'light' ? 'active' : ''} onClick={() => { setTableTool('select'); setMode('light'); }}>Light</button>
      <button className={tableTool === 'select' && mode === 'heavy' ? 'active' : ''} onClick={() => { setTableTool('select'); setMode('heavy'); }}>Heavy</button>
      <span className="vtt-tool-hint">{notice || (draftAnnotationStart ? 'Choose the second point' : 'Click a grid cell')}</span>
    </div>
    <TacticalViewport room={room} geometry={geometry} tableTool={tableTool} selectedCell={selectedCell} selectedActorId={selectedActorId} draftAnnotationStart={draftAnnotationStart} viewportRef={viewportRef} onCell={clickCell} onTokenSelect={(actor) => { setSelectedActorId(actor.id); setSelectedCell(actor.position); onPing?.(actor.position); }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel} />
    <div className="vtt-camera-bar"><button onClick={fitCamera}>Fit map</button><button onClick={() => setCamera((current) => ({ ...current, zoom: clamp(current.zoom / 1.15, .2, 4) }))}>−</button><output>{Math.round(camera.zoom * 100)}%</output><button onClick={() => setCamera((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, .2, 4) }))}>+</button><span>Camera is ephemeral; room commands remain authoritative.</span></div>
  </section>;
}

export interface SandboxProps {
  forceEnabled?: boolean;
  labMode?: boolean;
}

export function Sandbox({ forceEnabled = false, labMode = false }: SandboxProps) {
  const { characters } = useCharacters();
  const readyCharacter = characters.find((character) => validateCharacter(character).every(({ severity }) => severity !== 'error'));
  const [labPreferences, setLabPreferences] = useState(loadLabPreferences);
  const storageKey = labMode ? LAB_STORAGE_KEY : STORAGE_KEY;
  const legacyStorageKey = labMode ? LEGACY_LAB_STORAGE_KEY : LEGACY_STORAGE_KEY;
  const initialRoom = useRef<LocalRoomLoad | null>(null);
  if (initialRoom.current === null) {
    initialRoom.current = loadRoom(storageKey, legacyStorageKey, () => labMode ? createLabFixture(labPreferences) : createEmptyRoom());
  }
  const [room, setRoom] = useState<VttRoomState>(() => initialRoom.current!.room);
  const [mode, setMode] = useState<InteractionMode>('standard');
  const [tableTool, setTableTool] = useState<TableTool>('select');
  const [selectedAbilityId, setSelectedAbilityId] = useState('');
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<Position | null>(null);
  const [draftAnnotationStart, setDraftAnnotationStart] = useState<Position | null>(null);
  const [terrainType, setTerrainType] = useState<TerrainType>('difficult');
  const [terrainElevation, setTerrainElevation] = useState(0);
  const [annotationColor, setAnnotationColor] = useState('#d8ef62');
  const [templateKind, setTemplateKind] = useState<AreaTemplateKind>('burst');
  const [templateLength, setTemplateLength] = useState(2);
  const [templateWidth, setTemplateWidth] = useState(2);
  const [error, setError] = useState(() => initialRoom.current!.recoveryMessage);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticTab, setDiagnosticTab] = useState<'events' | 'source'>('events');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceKind, setSourceKind] = useState<RuleSourceKind | 'all'>('all');
  const [replayMatches, setReplayMatches] = useState<boolean | null>(null);
  const [mapUrlDraft, setMapUrlDraft] = useState(room.table.map.backgroundUrl);
  const [camera, setCamera] = useState<CameraTransform>({ pan: { x: 0, y: 0 }, zoom: 1 });
  const importInput = useRef<HTMLInputElement>(null);
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
  const sourceUnits = useMemo(() => labMode ? collectRuleSourceUnits() : [], [labMode]);
  const sourceAudit = useMemo(() => auditRuleSourceUnits(sourceUnits), [sourceUnits]);
  const filteredSourceUnits = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    return sourceUnits.filter((entry) => (sourceKind === 'all' || entry.kind === sourceKind) && (!query || `${entry.id} ${entry.name} ${entry.rulesText}`.toLocaleLowerCase().includes(query)));
  }, [sourceKind, sourceQuery, sourceUnits]);
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

  useEffect(() => {
    setMapUrlDraft(room.table.map.backgroundUrl);
  }, [room.table.map.backgroundUrl]);

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
      const result = executeRoomCommand(room, command, seededDice(room.revision + (labMode ? labPreferences.seed : 1907)));
      const replayed = applyRoomEvents(room, result.events);
      setRoom(result.state);
      persistRoom(storageKey, result.state);
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

  function setMap(map: Partial<TableMapState>) {
    runRoomCommand({ domain: 'table', command: { type: 'SET_MAP', map } });
  }

  function addHero() {
    if (!readyCharacter) {
      setError('Finish and save a valid character before adding a hero.');
      return;
    }
    const position = selectedCell ?? { x: 1, y: 4 };
    if (runEncounterCommand({ type: 'ADD_ACTOR', actor: actorFromCharacter(readyCharacter, position) })) setSelectedActorId(`actor:${readyCharacter.id}`);
  }

  function addTestFoe() {
    const position = selectedCell ?? { x: 8, y: 4 };
    runEncounterCommand({ type: 'ADD_ACTOR', actor: createFoe('Ruin Beast', position) });
  }

  function reset() {
    const fresh = labMode ? createLabFixture(labPreferences) : createEmptyRoom();
    setRoom(fresh);
    setSelectedAbilityId('');
    setSelectedActorId(null);
    setSelectedCell(null);
    setMode('standard');
    setTableTool('select');
    setDraftAnnotationStart(null);
    setReplayMatches(null);
    setError('');
    hasFittedCamera.current = false;
    localStorage.removeItem(storageKey);
    localStorage.removeItem(legacyStorageKey);
  }

  function updateLabPreferences(next: LabPreferences) {
    localStorage.setItem(LAB_PREFERENCES_KEY, JSON.stringify(next));
    setLabPreferences(next);
    const fresh = createLabFixture(next);
    setRoom(fresh);
    persistRoom(LAB_STORAGE_KEY, fresh);
    setSelectedAbilityId('');
    setSelectedActorId(null);
    setMode('standard');
    setReplayMatches(null);
    setError('');
    hasFittedCamera.current = false;
  }

  async function importRoom(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = restorePersistedVttRoom(JSON.parse(await file.text()));
      setRoom(imported);
      persistRoom(storageKey, imported);
      setSelectedActorId(null);
      setSelectedCell(null);
      setReplayMatches(null);
      setError('');
      hasFittedCamera.current = false;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That file is not a valid ICON VTT room export.');
    }
  }

  function updatePresentation(patch: Partial<VttRoomState['table']['actorPresentation'][string]>) {
    if (!selectedActor) return;
    const existing = room.table.actorPresentation[selectedActor.id] ?? {};
    runRoomCommand({ domain: 'table', command: { type: 'SET_ACTOR_PRESENTATION', actorId: selectedActor.id, presentation: { ...existing, ...patch } } });
  }

  function chooseMode(nextMode: InteractionMode, abilityId = '') {
    setMode(nextMode);
    setSelectedAbilityId(abilityId);
    setTableTool('select');
    setDraftAnnotationStart(null);
    setError('');
  }

  function addAnnotation(kind: AnnotationKind, points: Position[]) {
    runRoomCommand({
      domain: 'table',
      command: {
        type: 'UPSERT_ANNOTATION',
        annotation: { id: makeTableId('annotation'), kind, points, color: annotationColor, text: kind === 'marker' ? '•' : '' },
      },
    });
  }

  function addTemplate(origin: Position) {
    const template: AreaTemplate = {
      id: makeTableId('template'),
      kind: templateKind,
      origin,
      rotation: 0,
      length: Math.max(1, Math.round(templateLength)),
      width: Math.max(1, Math.round(templateWidth)),
      label: '',
      color: annotationColor,
    };
    runRoomCommand({ domain: 'table', command: { type: 'UPSERT_TEMPLATE', template } });
  }

  function activateTableTool(tool: TableTool) {
    setTableTool(tool);
    setDraftAnnotationStart(null);
    setSelectedAbilityId('');
    setError('');
  }

  function clickCell(position: Position) {
    if (ignoreNextCellClick.current) {
      ignoreNextCellClick.current = false;
      return;
    }
    setSelectedCell(position);
    if (tableTool === 'pan') return;
    if (tableTool === 'fog') {
      runRoomCommand({ domain: 'table', command: { type: 'PAINT_FOG', region: { id: makeTableId('fog'), cells: [position] } } });
      return;
    }
    if (tableTool === 'marker') {
      addAnnotation('marker', [position]);
      return;
    }
    if (tableTool === 'line' || tableTool === 'arrow') {
      if (!draftAnnotationStart) {
        setDraftAnnotationStart(position);
      } else {
        addAnnotation(tableTool, [draftAnnotationStart, position]);
        setDraftAnnotationStart(null);
      }
      return;
    }
    if (tableTool === 'template') {
      addTemplate(position);
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

    const target = Object.values(encounter.actors).find((actor) => samePosition(actor.position, position));
    if (target) setSelectedActorId(target.id);
    if (!active || encounter.phase !== 'active') return;
    if (target && mode === 'ability' && selectedAbilityId) {
      runEncounterCommand({ type: 'USE_ABILITY', actorId: active.id, abilityId: selectedAbilityId, targetIds: [target.id] });
      return;
    }
    if (target && target.defeated && target.side === active.side && mode === 'rescue') {
      runEncounterCommand({ type: 'RESCUE', actorId: active.id, targetId: target.id });
      return;
    }
    if (mode === 'interact') {
      runEncounterCommand({ type: 'INTERACT', actorId: active.id, position, description: 'Interact with battlefield feature' });
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

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const target = viewportRef.current;
    if (!target) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setCamera((current) => zoomCameraAtScreenPoint(current, viewport, anchor, clamp(current.zoom * (event.deltaY > 0 ? .9 : 1.1), .2, 4)));
  }

  const selectedPresentation = selectedActor ? room.table.actorPresentation[selectedActor.id] ?? {} : null;

  if (!testingEnabled && !(forceEnabled && import.meta.env.DEV)) {
    return (
      <div className="page gate-page">
        <header className="page-header"><div><p className="eyebrow">Phase 2 quality gate</p><h1>Local VTT is not unlocked</h1><p>The tactical room reducer and viewport are available to engineering, but production access remains gated until the ICON automation audit is complete.</p></div></header>
        <div className="coverage-list">{RULES_COVERAGE.map((item) => <div key={item.id}><span className={`coverage-icon ${item.status}`}>{item.status === 'complete' ? '✓' : item.status === 'partial' ? '◐' : '○'}</span><strong>{item.label}</strong><em>{item.status}</em></div>)}</div>
        <div className="notice">Developers can run the engineering harness through the local Vite development server; production access remains unavailable.</div>
      </div>
    );
  }

  return (
    <div className="sandbox-page vtt-page">
      <header className="sandbox-header vtt-header">
        <div><p className="eyebrow">{labMode ? 'Rules Lab // local authoritative room' : 'Local-only // room reducer preview'}</p><h1>{encounter.name}</h1><p>Mechanical commands and tabletop commands both pass through the shared room reducer. Local persistence is a preview, not multiplayer authority.</p></div>
        <div className="battle-status"><span>ROUND <b>{encounter.round || '—'}</b></span><span>RESOLVE <b>{encounter.partyResolve}</b></span><span>ROOM REV <b>{room.revision}</b></span><span>RULE REV <b>{encounter.revision}</b></span></div>
        <div className="sandbox-file-actions"><button className={diagnosticsOpen ? 'active' : ''} onClick={() => setDiagnosticsOpen((open) => !open)}>Diagnostics</button><button onClick={() => importInput.current?.click()}>Import</button><button onClick={() => downloadRoom(room)}>Export</button><button onClick={reset}>Reset</button><input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={importRoom} /></div>
      </header>
      {error && <div className="battle-error">{error}</div>}
      <div className="vtt-workspace">
        <aside className="vtt-roster">
          <div className="vtt-panel-heading"><div><p className="eyebrow">Encounter</p><h2>Combatants</h2></div><span>{Object.keys(encounter.actors).length}</span></div>
          <div className="vtt-combatant-list">
            {Object.values(encounter.actors).map((actor) => {
              const presentation = room.table.actorPresentation[actor.id];
              const tokenUrl = presentation?.tokenUrl ?? actor.tokenUrl;
              return <button className={`vtt-combatant ${actor.id === selectedActorId ? 'is-selected' : ''} ${actor.id === encounter.activeActorId ? 'is-active' : ''}`} key={actor.id} onClick={() => { setSelectedActorId(actor.id); setSelectedCell(actor.position); }}>
                <span className={`vtt-token-mini ${actor.side}`} style={assetBackground(tokenUrl)}>{!assetBackground(tokenUrl) && (presentation?.label ?? actor.name).slice(0, 1)}</span>
                <span><strong>{presentation?.label || actor.name}</strong><small>{actor.side} · DEF {actor.defense} · {actor.actionsRemaining} ACT</small><i><b style={{ width: `${Math.max(0, Math.min(100, actor.hp / actor.baseMaxHp * 100))}%` }} /></i><small>{actor.hp}/{actor.baseMaxHp} HP{actor.vigor ? ` · ${actor.vigor} vigor` : ''}</small></span>
              </button>;
            })}
          </div>
          {encounter.phase === 'setup' && <div className="vtt-setup-actions"><p>Placement: {selectedCell ? `(${selectedCell.x}, ${selectedCell.y})` : 'click a clear grid cell'}</p><button className="button compact full" onClick={addHero}>Add saved hero</button><button className="button compact full" onClick={addTestFoe}>Add test foe</button><button className="button primary full" onClick={() => runEncounterCommand({ type: 'START_ENCOUNTER' })}>Start encounter</button></div>}
          {labMode && <details className="lab-fixture-controls"><summary>Rules lab fixture</summary><label>Icon Job<select value={labPreferences.jobId} onChange={(event) => updateLabPreferences({ ...labPreferences, jobId: event.target.value })}>{JOBS.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}</select></label><label>Test foe<select value={labPreferences.foeProfileId} onChange={(event) => updateLabPreferences({ ...labPreferences, foeProfileId: event.target.value })}>{labFoes.map((profile) => <option key={profile.id} value={profile.id}>{profile.faction} · {profile.name}</option>)}</select></label><label>Dice seed<input type="number" value={labPreferences.seed} onChange={(event) => { const next = { ...labPreferences, seed: Number(event.target.value) || 0 }; localStorage.setItem(LAB_PREFERENCES_KEY, JSON.stringify(next)); setLabPreferences(next); }} /></label></details>}
          <button className="text-button danger reset-button" onClick={reset}>Reset local room</button>
        </aside>

        <section className="vtt-table">
          <div className="vtt-toolbar" aria-label="Table tools">
            {([
              ['select', 'Select'], ['pan', 'Pan'], ['fog', 'Fog'], ['marker', 'Mark'], ['line', 'Line'], ['arrow', 'Arrow'], ['template', 'Area'], ['terrain', 'Terrain'],
            ] as Array<[TableTool, string]>).map(([tool, label]) => <button key={tool} className={tableTool === tool ? 'active' : ''} onClick={() => activateTableTool(tool)}>{label}</button>)}
            <span className="vtt-tool-hint">{draftAnnotationStart ? 'Choose the second point' : tableTool === 'pan' ? 'Drag or use middle mouse' : 'Click a grid cell'}</span>
          </div>
          <TacticalViewport room={room} geometry={geometry} tableTool={tableTool} selectedCell={selectedCell} selectedActorId={selectedActorId} draftAnnotationStart={draftAnnotationStart} viewportRef={viewportRef} onCell={clickCell} onTokenSelect={(actor) => { setSelectedActorId(actor.id); setSelectedCell(actor.position); }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel} />
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
                <button className={mode === 'interact' ? 'selected' : ''} onClick={() => chooseMode('interact')}>Interact <small>1 action · adjacent</small></button>
                <button className={mode === 'rescue' ? 'selected' : ''} onClick={() => chooseMode('rescue')}>Rescue <small>1 action · ally</small></button>
              </div>
              {active.abilityIds.length > 0 && <div className="turn-abilities"><h3>Equipped abilities</h3>{active.abilityIds.map((abilityId) => { const ability = findAbility(abilityId); if (!ability) return null; const executable = ability.automation === 'executable' && isIndependentlyExecutableAbility(ability.id); return <button key={ability.id} className={selectedAbilityId === ability.id ? 'selected' : ''} disabled={ability.chapter > active.chapter} title={!executable ? 'This source rule is indexed but has no independently verified resolver yet.' : undefined} onClick={() => { if (executable) chooseMode('ability', ability.id); else { setSelectedAbilityId(ability.id); setMode('standard'); setError(''); } }}><strong>{ability.name}</strong><small>{ability.header} · {executable ? 'executable' : 'source only'}</small></button>; })}</div>}
              {selectedAbility && <div className="selected-ability"><strong>{selectedAbility.name}</strong><p>{selectedAbility.summary}</p><small>{selectedAbility.header} · p.{selectedAbility.source.page} · {selectedAbility.automation}</small><p className="source-rules-text">{selectedAbility.rulesText}</p>{selectedAbility.automation === 'executable' && isIndependentlyExecutableAbility(selectedAbility.id) ? <button className="button compact full" onClick={() => runEncounterCommand({ type: 'USE_ABILITY', actorId: active.id, abilityId: selectedAbility.id, targetIds: selectedAbility.tags.includes('self') ? [active.id] : [] })}>Use without map target</button> : <em>This procedure is indexed for reference only. It cannot change encounter state until an independently verified resolver and replay fixture are added.</em>}</div>}
              <button className="button compact full" onClick={() => runEncounterCommand({ type: 'RECOVER', actorId: active.id })}>Recover</button>
              <button className="button primary full" onClick={() => runEncounterCommand({ type: 'END_TURN', actorId: active.id })}>End turn</button>
            </>}
          </section>

          <section className="vtt-table-controls">
            <p className="eyebrow">Table state</p><h3>Map & calibration</h3>
            <label>Map image URL<input value={mapUrlDraft} placeholder="https://…" onChange={(event) => setMapUrlDraft(event.target.value)} onBlur={() => setMap({ backgroundUrl: mapUrlDraft })} /></label>
            <div className="vtt-control-grid"><label>Cell px<input type="number" min="8" max="1024" value={room.table.map.cellSize} onChange={(event) => setMap({ cellSize: Number(event.target.value) || 64 })} /></label><label>Map scale<input type="number" min="0.1" max="100" step=".1" value={room.table.map.scale} onChange={(event) => setMap({ scale: Number(event.target.value) || 1 })} /></label><label>Map X<input type="number" value={room.table.map.offset.x} onChange={(event) => setMap({ offset: { ...room.table.map.offset, x: Number(event.target.value) || 0 } })} /></label><label>Map Y<input type="number" value={room.table.map.offset.y} onChange={(event) => setMap({ offset: { ...room.table.map.offset, y: Number(event.target.value) || 0 } })} /></label></div>
            <div className="vtt-toggle-row"><label><input type="checkbox" checked={room.table.map.showGrid} onChange={(event) => setMap({ showGrid: event.target.checked })} /> Grid</label><label><input type="checkbox" checked={room.table.map.showCoordinates} onChange={(event) => setMap({ showCoordinates: event.target.checked })} /> Coordinates</label></div>
            {tableTool === 'terrain' && <div className="vtt-tool-options"><label>Terrain<select value={terrainType} onChange={(event) => setTerrainType(event.target.value as TerrainType)}>{terrainOptions.map((terrain) => <option key={terrain.id} value={terrain.id}>{terrain.label}</option>)}</select></label><label>Elevation<input type="number" min="0" max="99" value={terrainElevation} onChange={(event) => setTerrainElevation(Number(event.target.value) || 0)} /></label></div>}
            {(['marker', 'line', 'arrow', 'template'] as TableTool[]).includes(tableTool) && <div className="vtt-tool-options"><label>Colour<input type="color" value={annotationColor} onChange={(event) => setAnnotationColor(event.target.value)} /></label>{tableTool === 'template' && <><label>Shape<select value={templateKind} onChange={(event) => setTemplateKind(event.target.value as AreaTemplateKind)}><option value="burst">Burst</option><option value="cone">Cone</option><option value="line">Line</option><option value="rectangle">Rectangle</option></select></label><label>Length<input type="number" min="1" max="100" value={templateLength} onChange={(event) => setTemplateLength(Number(event.target.value) || 1)} /></label><label>Width<input type="number" min="1" max="100" value={templateWidth} onChange={(event) => setTemplateWidth(Number(event.target.value) || 1)} /></label></>}</div>}
            <div className="vtt-table-actions"><button onClick={() => runRoomCommand({ domain: 'table', command: { type: 'CLEAR_FOG' } })} disabled={!room.table.fog.length}>Clear fog</button><button onClick={() => { if (draftAnnotationStart) setDraftAnnotationStart(null); }}>Cancel drawing</button></div>
          </section>

          {selectedActor && selectedPresentation && <section className="vtt-token-controls"><p className="eyebrow">Token presentation</p><h3>{selectedPresentation.label || selectedActor.name}</h3><label>Display label<input value={selectedPresentation.label ?? ''} placeholder={selectedActor.name} onChange={(event) => updatePresentation({ label: event.target.value })} /></label><label>Token image URL<input value={selectedPresentation.tokenUrl ?? selectedActor.tokenUrl} placeholder="https://…" onChange={(event) => updatePresentation({ tokenUrl: event.target.value })} /></label><label>Token scale<input type="number" min=".1" max="20" step=".1" value={selectedPresentation.tokenScale ?? 1} onChange={(event) => updatePresentation({ tokenScale: Number(event.target.value) || 1 })} /></label><label className="vtt-checkbox"><input type="checkbox" checked={selectedPresentation.hidden ?? false} onChange={(event) => updatePresentation({ hidden: event.target.checked })} /> Mark hidden for player views</label></section>}

          <section className="vtt-clock-controls"><p className="eyebrow">Shared clocks</p><div><h3>Clocks</h3><button onClick={() => runRoomCommand({ domain: 'table', command: { type: 'UPSERT_CLOCK', clock: { id: makeTableId('clock'), name: 'Scene clock', segments: 6, filled: 0 } } })}>Add</button></div>{room.table.clocks.map((clock) => <article key={clock.id}><span><strong>{clock.name}</strong><small>{clock.filled}/{clock.segments}</small></span><div>{Array.from({ length: clock.segments }, (_, index) => <i className={index < clock.filled ? 'filled' : ''} key={index} />)}</div><button onClick={() => runRoomCommand({ domain: 'table', command: { type: 'UPSERT_CLOCK', clock: { ...clock, filled: Math.max(0, clock.filled - 1) } } })}>−</button><button onClick={() => runRoomCommand({ domain: 'table', command: { type: 'UPSERT_CLOCK', clock: { ...clock, filled: Math.min(clock.segments, clock.filled + 1) } } })}>+</button><button className="danger" onClick={() => runRoomCommand({ domain: 'table', command: { type: 'REMOVE_CLOCK', clockId: clock.id } })}>×</button></article>)}</section>
        </aside>
      </div>

      <section className="vtt-log-panel"><div><p className="eyebrow">Reducer event log</p><h2>What the rules engine accepted</h2></div><span className={replayMatches === false ? 'failed' : replayMatches ? 'passed' : ''}>{replayMatches === null ? 'No operation replayed yet' : replayMatches ? '✓ deterministic room replay matches' : '⚠ replay mismatch'}</span><div className="event-log">{recentEvents.map((event, index) => { const summary = eventSummary(event, encounter); return <div key={`${encounter.revision}-${index}`}><strong>{summary.title}</strong><small>{summary.detail}</small></div>; })}{recentEvents.length === 0 && <p>No accepted mechanical events yet.</p>}</div></section>

      {diagnosticsOpen && <section className="lab-diagnostics">
        <header><div><button className={diagnosticTab === 'events' ? 'active' : ''} onClick={() => setDiagnosticTab('events')}>Event replay</button><button className={diagnosticTab === 'source' ? 'active' : ''} onClick={() => setDiagnosticTab('source')}>Rules coverage</button></div><span className={replayMatches === false ? 'failed' : replayMatches ? 'passed' : ''}>{replayMatches === null ? 'No command replayed' : replayMatches ? '✓ deterministic replay match' : '⚠ replay mismatch'}</span><button onClick={() => setDiagnosticsOpen(false)}>Close</button></header>
        {diagnosticTab === 'events' ? <div className="lab-event-diagnostics"><aside><div><strong>{room.revision}</strong><small>Room revision</small></div><div><strong>{encounter.revision}</strong><small>Rules revision</small></div><div><strong>{encounter.eventLog.length}</strong><small>Mechanical events</small></div></aside><pre>{recentEvents.length ? JSON.stringify(recentEvents, null, 2) : 'Use a rules-backed board command to inspect its authoritative event payload.'}</pre></div> : <div className="lab-source-diagnostics"><aside><div><strong>{sourceAudit.total.toLocaleString()}</strong><small>Traceable source units</small></div><div><strong>{sourceAudit.duplicateIds.length + sourceAudit.emptyRules.length + sourceAudit.invalidSources.length || 'PASS'}</strong><small>Source integrity gaps</small></div><div><strong>{Object.keys(sourceAudit.byKind).length}</strong><small>Mechanic types</small></div></aside><div><p className="vtt-coverage-note">This browser is intentionally an engineering preview: source units retain coverage status until the automation compiler marks every clause executable.</p><div className="lab-source-filters"><input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Search mechanic source…" /><select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as RuleSourceKind | 'all')}><option value="all">All mechanic types</option>{Object.entries(sourceAudit.byKind).sort(([first], [second]) => first.localeCompare(second)).map(([entryKind, count]) => <option key={entryKind} value={entryKind}>{entryKind} ({count})</option>)}</select></div><div className="lab-source-list">{filteredSourceUnits.slice(0, 100).map((entry) => <details key={entry.id}><summary><span>{entry.kind}</span><strong>{entry.name}</strong><em>p.{entry.source.page}</em></summary><code>{entry.id}</code><p>{entry.rulesText}</p></details>)}</div>{filteredSourceUnits.length > 100 && <p className="lab-source-limit">Showing 100 of {filteredSourceUnits.length.toLocaleString()} matches. Refine the search to inspect a specific rule.</p>}</div></div>}
      </section>}
    </div>
  );
}
