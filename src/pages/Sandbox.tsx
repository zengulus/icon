import { useMemo, useState } from 'react';
import { PHASE_TWO_READY, RULES_COVERAGE, findAbility } from '../rules/catalog.js';
import { validateCharacter } from '../rules/character.js';
import { actorFromCharacter, createEncounter, createFoe, executeCommand, migrateEncounter } from '../rules/encounter.js';
import { seededDice } from '../rules/dice.js';
import type { EncounterCommand, EncounterEvent, EncounterState, Position } from '../rules/types.js';
import { useCharacters } from '../context/CharacterContext.js';
import { assetBackground } from '../services/assets.js';

const STORAGE_KEY = 'icon.sandbox.encounter.v2';
const testingEnabled = PHASE_TWO_READY || import.meta.env.DEV || import.meta.env.VITE_ENABLE_INCOMPLETE_VTT === 'true';
type InteractionMode = 'standard' | 'dash' | 'light' | 'heavy' | 'interact' | 'rescue' | 'ability';

function pathTo(from: Position, to: Position): Position[] {
  const path: Position[] = [];
  let current = { ...from };
  while (current.x !== to.x) {
    current = { ...current, x: current.x + Math.sign(to.x - current.x) };
    path.push(current);
  }
  while (current.y !== to.y) {
    current = { ...current, y: current.y + Math.sign(to.y - current.y) };
    path.push(current);
  }
  return path;
}

function eventSummary(event: EncounterEvent, state: EncounterState) {
  if (event.type === 'ABILITY_RESOLVED') {
    const ability = findAbility(event.abilityId);
    const result = event.attack ? `${event.attack.hit ? 'hit' : 'miss'} · ${event.attack.appliedDamage} damage` : 'rules text pending';
    return { title: ability?.name ?? event.abilityId, detail: result };
  }
  const actor = 'actorId' in event ? state.actors[event.actorId] : null;
  return { title: event.type.replaceAll('_', ' '), detail: actor?.name ?? '' };
}

export function Sandbox() {
  const { characters } = useCharacters();
  const readyCharacter = characters.find((character) => validateCharacter(character).every(({ severity }) => severity !== 'error'));
  const [state, setState] = useState<EncounterState>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('icon.sandbox.encounter.v1') ?? '';
      return migrateEncounter(JSON.parse(stored));
    } catch {
      return createEncounter('Rules proving ground');
    }
  });
  const [mode, setMode] = useState<InteractionMode>('standard');
  const [selectedAbilityId, setSelectedAbilityId] = useState('');
  const [error, setError] = useState('');
  const active = state.activeActorId ? state.actors[state.activeActorId] : null;
  const selectedAbility = selectedAbilityId ? findAbility(selectedAbilityId) : undefined;
  const recentEvents = useMemo(() => [...state.eventLog].reverse().slice(0, 20), [state.eventLog]);

  function command(commandValue: EncounterCommand) {
    try {
      const result = executeCommand(state, commandValue, seededDice(state.revision + 1907));
      setState(result.state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result.state));
      setError('');
      if (commandValue.type === 'USE_ABILITY') setSelectedAbilityId('');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That action is not legal.');
      return false;
    }
  }

  function addHero() {
    if (!readyCharacter) {
      setError('Finish and save a valid character before adding a hero.');
      return;
    }
    command({ type: 'ADD_ACTOR', actor: actorFromCharacter(readyCharacter, { x: 1, y: 4 }) });
  }

  function chooseMode(nextMode: InteractionMode, abilityId = '') {
    setMode(nextMode);
    setSelectedAbilityId(abilityId);
    setError('');
  }

  function clickCell(position: Position) {
    if (!active || active.side !== 'heroes') return;
    const target = Object.values(state.actors).find((actor) => actor.position.x === position.x && actor.position.y === position.y);
    if (target && mode === 'ability' && selectedAbilityId) {
      command({ type: 'USE_ABILITY', actorId: active.id, abilityId: selectedAbilityId, targetIds: [target.id] });
    } else if (target && target.defeated && target.side === active.side && mode === 'rescue') {
      command({ type: 'RESCUE', actorId: active.id, targetId: target.id });
    } else if (mode === 'interact') {
      command({ type: 'INTERACT', actorId: active.id, position, description: 'Interact with battlefield feature' });
    } else if (target && target.side !== active.side && (mode === 'light' || mode === 'heavy')) {
      command({ type: 'BASIC_ATTACK', actorId: active.id, targetId: target.id, weight: mode });
    } else if (!target && (mode === 'standard' || mode === 'dash')) {
      command({ type: 'MOVE', actorId: active.id, path: pathTo(active.position, position), mode });
    }
  }

  function reset() {
    const fresh = createEncounter('Rules proving ground');
    setState(fresh);
    setSelectedAbilityId('');
    setMode('standard');
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('icon.sandbox.encounter.v1');
  }

  if (!testingEnabled) {
    return (
      <div className="page gate-page">
        <header className="page-header"><div><p className="eyebrow">Phase 2 quality gate</p><h1>Local VTT is not unlocked</h1><p>The tactical client and reducer are present, but production access remains gated until every ICON ability required for encounter play is structured and automated.</p></div></header>
        <div className="coverage-list">{RULES_COVERAGE.map((item) => <div key={item.id}><span className={`coverage-icon ${item.status}`}>{item.status === 'complete' ? '✓' : item.status === 'partial' ? '◐' : '○'}</span><strong>{item.label}</strong><em>{item.status}</em></div>)}</div>
        <div className="notice">Developers can run the engineering harness locally, or set <code>VITE_ENABLE_INCOMPLETE_VTT=true</code> for a non-production test deployment.</div>
      </div>
    );
  }

  return (
    <div className="sandbox-page">
      <header className="sandbox-header">
        <div><p className="eyebrow">Local-only // engineering harness</p><h1>{state.name}</h1></div>
        <div className="battle-status"><span>ROUND <b>{state.round || '—'}</b></span><span>RESOLVE <b>{state.partyResolve}</b></span><span>REV <b>{state.revision}</b></span></div>
      </header>
      {error && <div className="battle-error">{error}</div>}
      <div className="sandbox-layout">
        <aside className="combatants">
          <h2>Combatants</h2>
          {Object.values(state.actors).map((actor) => (
            <div className={`combatant ${actor.id === state.activeActorId ? 'active' : ''}`} key={actor.id}>
              <div className="token-mini" style={assetBackground(actor.tokenUrl)}>{!assetBackground(actor.tokenUrl) && actor.name[0]}</div>
              <div><strong>{actor.name}</strong><small>{actor.side} · DEF {actor.defense}</small><div className="hp-track"><span style={{ width: `${Math.max(0, actor.hp / actor.baseMaxHp * 100)}%` }} /></div><small>{actor.hp} HP {actor.vigor ? `+ ${actor.vigor} vigor` : ''}</small></div>
            </div>
          ))}
          {state.phase === 'setup' && <div className="setup-actions"><button className="button compact full" onClick={addHero}>Add saved hero</button><button className="button compact full" onClick={() => command({ type: 'ADD_ACTOR', actor: createFoe('Ruin Beast', { x: 8, y: 4 }) })}>Add test foe</button><button className="button primary full" onClick={() => command({ type: 'START_ENCOUNTER' })}>Start encounter</button></div>}
          <button className="text-button danger reset-button" onClick={reset}>Reset sandbox</button>
        </aside>

        <section className="battlefield-wrap">
          <div className="battlefield" style={assetBackground(state.grid.backgroundUrl)}>
            {Array.from({ length: state.grid.height }, (_, y) => Array.from({ length: state.grid.width }, (_, x) => {
              const actor = Object.values(state.actors).find((item) => item.position.x === x && item.position.y === y);
              const terrain = state.grid.terrain.find((item) => item.position.x === x && item.position.y === y);
              return <button key={`${x}-${y}`} className={`cell ${terrain?.type ?? ''} ${actor ? 'occupied' : ''}`} onClick={() => clickCell({ x, y })}>{actor && <span className={`battle-token ${actor.side} ${actor.id === state.activeActorId ? 'active' : ''}`} style={assetBackground(actor.tokenUrl)}>{!assetBackground(actor.tokenUrl) && actor.name[0]}</span>}{terrain && terrain.elevation > 0 && <i>{terrain.elevation}</i>}</button>;
            }))}
          </div>
          <div className="map-settings"><label>Hotlinked map background<input value={state.grid.backgroundUrl} placeholder="https://…" onChange={(event) => { const next = { ...state, grid: { ...state.grid, backgroundUrl: event.target.value } }; setState(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }} /></label></div>
        </section>

        <aside className="turn-panel">
          <p className="eyebrow">Active turn</p><h2>{active?.name ?? 'Setup'}</h2>
          {active && <>
            <div className="action-pips">{[0, 1].map((index) => <span key={index} className={active.actionsRemaining > index ? 'available' : ''} />)}<small>{active.actionsRemaining} actions</small></div>
            <div className="mode-grid">
              <button className={mode === 'standard' ? 'selected' : ''} onClick={() => chooseMode('standard')}>Move <small>{active.speed} spaces</small></button>
              <button className={mode === 'dash' ? 'selected' : ''} onClick={() => chooseMode('dash')}>Dash <small>1 action</small></button>
              <button className={mode === 'light' ? 'selected' : ''} onClick={() => chooseMode('light')}>Light attack <small>1 action</small></button>
              <button className={mode === 'heavy' ? 'selected' : ''} onClick={() => chooseMode('heavy')}>Heavy attack <small>2 actions</small></button>
              <button className={mode === 'interact' ? 'selected' : ''} onClick={() => chooseMode('interact')}>Interact <small>1 action · choose space</small></button>
              <button className={mode === 'rescue' ? 'selected' : ''} onClick={() => chooseMode('rescue')}>Rescue <small>1 action · choose ally</small></button>
            </div>
            {active.abilityIds.length > 0 && <div className="turn-abilities"><h3>Equipped abilities</h3>{active.abilityIds.map((abilityId) => { const ability = findAbility(abilityId); if (!ability) return null; return <button key={ability.id} className={selectedAbilityId === ability.id ? 'selected' : ''} disabled={ability.chapter > active.chapter} onClick={() => chooseMode('ability', ability.id)}><strong>{ability.name}</strong><small>{ability.header}</small></button>; })}</div>}
            {selectedAbility && <div className="selected-ability"><strong>{selectedAbility.name}</strong><p>{selectedAbility.summary}</p><small>{selectedAbility.header} · p.{selectedAbility.source.page}</small><button className="button compact full" onClick={() => command({ type: 'USE_ABILITY', actorId: active.id, abilityId: selectedAbility.id, targetIds: selectedAbility.tags.includes('self') ? [active.id] : [] })}>Use without map target</button><em>Choose a token for a direct target. Area placement and unautomated effects remain recorded from the source text.</em></div>}
            <button className="button compact full" onClick={() => command({ type: 'RECOVER', actorId: active.id })}>Recover</button>
            <button className="button primary full" onClick={() => command({ type: 'END_TURN', actorId: active.id })}>End turn</button>
          </>}
          <h3>Event log</h3><div className="event-log">{recentEvents.map((event, index) => { const summary = eventSummary(event, state); return <div key={`${state.revision}-${index}`}><strong>{summary.title}</strong><small>{summary.detail}</small></div>; })}</div>
        </aside>
      </div>
    </div>
  );
}
