import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { EncounterActor, Position } from '../rules/types.js';
import type { VttRoomState } from '../rules/vtt-room.js';
import { assetBackground } from './presentation.js';
import {
  gridCellToWorldCenter,
  gridToScreen,
  gridToWorld,
  mapToScreen,
  worldToScreen,
  type TacticalViewportGeometry,
} from './geometry.js';

/** Observe CSS dimensions for local and shared boards; camera state stays with the caller. */
export function useViewportSize(ref: RefObject<HTMLElement | null>) {
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

export type InteractionMode = 'standard' | 'dash' | 'light' | 'heavy' | 'interact' | 'rescue' | 'ability';
export type TableTool = 'select' | 'pan' | 'fog' | 'marker' | 'line' | 'arrow' | 'template' | 'terrain';

function samePosition(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
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
 * Geometry-driven, presentation-only map surface. It contains no auth,
 * persistence, or room authority: callers receive intent and decide where it
 * is submitted.
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
  onWheel: (event: WheelEvent) => void;
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
  const latestWheelHandler = useRef(onWheel);
  latestWheelHandler.current = onWheel;
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onNativeWheel = (event: WheelEvent) => latestWheelHandler.current(event);
    el.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', onNativeWheel);
  }, [viewportRef]);
  return (
    <div
      ref={viewportRef}
      className={`vtt-viewport tool-${tableTool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
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
