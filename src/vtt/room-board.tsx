import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { planMovement } from '../rules/movement.js';
import type { EncounterCommand, Position } from '../rules/types.js';
import type { TableCommand, VttRoomState } from '../rules/vtt-room.js';
import { makeTableId } from './presentation.js';
import {
  fitWorldBounds, gridBoundsToWorld, panCameraBy, zoomCameraAtScreenPoint,
  type CameraTransform, type TacticalViewportGeometry, type ViewportRect,
} from './geometry.js';
import { TacticalViewport, useViewportSize, type InteractionMode, type TableTool } from './tactical-viewport.js';

interface DragState {
  pointerId: number;
  clientX: number;
  clientY: number;
  moved: boolean;
}

function samePosition(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Shared-room controls keep only ephemeral camera/tool state. Durable
 * actions leave through the supplied authoritative command callbacks. */
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

  function handleWheel(event: WheelEvent) {
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
    <TacticalViewport room={room} geometry={geometry} tableTool={tableTool} selectedCell={selectedCell} selectedActorId={selectedActorId} draftAnnotationStart={draftAnnotationStart} viewportRef={viewportRef} onCell={clickCell} onTokenSelect={(actor) => { setSelectedActorId(actor.id); setSelectedCell(actor.position); clickCell(actor.position); }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel} />
    <div className="vtt-camera-bar"><button onClick={fitCamera}>Fit map</button><button onClick={() => setCamera((current) => ({ ...current, zoom: clamp(current.zoom / 1.15, .2, 4) }))}>−</button><output>{Math.round(camera.zoom * 100)}%</output><button onClick={() => setCamera((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, .2, 4) }))}>+</button><span>Camera is ephemeral; room commands remain authoritative.</span></div>
  </section>;
}

