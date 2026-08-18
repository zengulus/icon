import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { JOBS, PHASE_TWO_READY, RULES_COVERAGE, findAbility, findJob } from '../rules/catalog.js';
import { createCharacter, validateCharacter } from '../rules/character.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, createFoeFromProfile, executeCommand, migrateEncounter } from '../rules/encounter.js';
import { seededDice } from '../rules/dice.js';
import { FOE_PROFILES } from '../rules/foes.js';
import { auditRuleSourceUnits, collectRuleSourceUnits, type RuleSourceKind } from '../rules/source-units.js';
import type { EncounterCommand, EncounterEvent, EncounterState, Position } from '../rules/types.js';
import { useCharacters } from '../context/CharacterContext.js';
import { assetBackground } from '../services/assets.js';

const STORAGE_KEY = 'icon.sandbox.encounter.v2';
const LAB_STORAGE_KEY = 'icon.rules-lab.encounter.v2';
const LAB_PREFERENCES_KEY = 'icon.rules-lab.preferences.v1';
const testingEnabled = PHASE_TWO_READY || import.meta.env.DEV || import.meta.env.VITE_ENABLE_INCOMPLETE_VTT === 'true';
type InteractionMode = 'standard' | 'dash' | 'light' | 'heavy' | 'interact' | 'rescue' | 'ability';

const labFoes = FOE_PROFILES.filter(({ roleId }) => roleId !== 'mob' && roleId !== 'special');
const defaultLabFoe = labFoes.find(({ roleId }) => roleId === 'heavy') ?? labFoes[0];

interface LabPreferences {
  jobId: string;
  foeProfileId: string;
  seed: number;
}

const defaultLabPreferences: LabPreferences = { jobId: JOBS[0].id, foeProfileId: defaultLabFoe.id, seed: 1907 };

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

function createLabFixture(preferences: LabPreferences): EncounterState {
  const job = findJob(preferences.jobId) ?? JOBS[0];
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
  let state = { ...createEncounter('Rules proving ground'), id: 'rules-lab-encounter' };
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  return executeCommand(state, { type: 'START_ENCOUNTER' }).state;
}

function downloadEncounter(state: EncounterState) {
  const blob = new Blob([`${JSON.stringify(state, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'icon-rules-lab-encounter.json';
  link.click();
  URL.revokeObjectURL(url);
}

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

export interface SandboxProps {
  forceEnabled?: boolean;
  labMode?: boolean;
}

export function Sandbox({ forceEnabled = false, labMode = false }: SandboxProps) {
  const { characters } = useCharacters();
  const readyCharacter = characters.find((character) => validateCharacter(character).every(({ severity }) => severity !== 'error'));
  const [labPreferences, setLabPreferences] = useState(loadLabPreferences);
  const storageKey = labMode ? LAB_STORAGE_KEY : STORAGE_KEY;
  const [state, setState] = useState<EncounterState>(() => {
    try {
      const stored = localStorage.getItem(storageKey) ?? (!labMode ? localStorage.getItem('icon.sandbox.encounter.v1') : null) ?? '';
      return migrateEncounter(JSON.parse(stored));
    } catch {
      return labMode ? createLabFixture(labPreferences) : createEncounter('Rules proving ground');
    }
  });
  const [mode, setMode] = useState<InteractionMode>('standard');
  const [selectedAbilityId, setSelectedAbilityId] = useState('');
  const [error, setError] = useState('');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticTab, setDiagnosticTab] = useState<'events' | 'source'>('events');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceKind, setSourceKind] = useState<RuleSourceKind | 'all'>('all');
  const [replayMatches, setReplayMatches] = useState<boolean | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const active = state.activeActorId ? state.actors[state.activeActorId] : null;
  const selectedAbility = selectedAbilityId ? findAbility(selectedAbilityId) : undefined;
  const recentEvents = useMemo(() => [...state.eventLog].reverse().slice(0, 20), [state.eventLog]);
  const sourceUnits = useMemo(() => labMode ? collectRuleSourceUnits() : [], [labMode]);
  const sourceAudit = useMemo(() => auditRuleSourceUnits(sourceUnits), [sourceUnits]);
  const filteredSourceUnits = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    return sourceUnits.filter((entry) => (sourceKind === 'all' || entry.kind === sourceKind) && (!query || `${entry.id} ${entry.name} ${entry.rulesText}`.toLocaleLowerCase().includes(query)));
  }, [sourceKind, sourceQuery, sourceUnits]);

  function command(commandValue: EncounterCommand) {
    try {
      const result = executeCommand(state, commandValue, seededDice(state.revision + (labMode ? labPreferences.seed : 1907)));
      const replayed = applyEvents(state, result.events);
      setState(result.state);
      setReplayMatches(JSON.stringify(replayed) === JSON.stringify(result.state));
      localStorage.setItem(storageKey, JSON.stringify(result.state));
      setError('');
      if (commandValue.type === 'USE_ABILITY') setSelectedAbilityId('');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That action is not legal.');
      setReplayMatches(null);
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
    const fresh = labMode ? createLabFixture(labPreferences) : createEncounter('Rules proving ground');
    setState(fresh);
    setSelectedAbilityId('');
    setMode('standard');
    setReplayMatches(null);
    localStorage.removeItem(storageKey);
    if (!labMode) localStorage.removeItem('icon.sandbox.encounter.v1');
  }

  function updateLabPreferences(next: LabPreferences) {
    localStorage.setItem(LAB_PREFERENCES_KEY, JSON.stringify(next));
    setLabPreferences(next);
    const fresh = createLabFixture(next);
    setState(fresh);
    setSelectedAbilityId('');
    setMode('standard');
    setReplayMatches(null);
    setError('');
    localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(fresh));
  }

  async function importEncounter(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = migrateEncounter(JSON.parse(await file.text()));
      setState(imported);
      setReplayMatches(null);
      localStorage.setItem(storageKey, JSON.stringify(imported));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That file is not a valid ICON encounter export.');
    }
  }

  if (!testingEnabled && !forceEnabled) {
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
        <div><p className="eyebrow">{labMode ? 'Rules Lab // local VTT skeleton' : 'Local-only // engineering harness'}</p><h1>{state.name}</h1></div>
        <div className="battle-status"><span>ROUND <b>{state.round || '—'}</b></span><span>RESOLVE <b>{state.partyResolve}</b></span><span>REV <b>{state.revision}</b></span></div>
        {labMode && <div className="sandbox-file-actions"><button className={diagnosticsOpen ? 'active' : ''} onClick={() => setDiagnosticsOpen((open) => !open)}>Diagnostics</button><button onClick={() => importInput.current?.click()}>Import</button><button onClick={() => downloadEncounter(state)}>Export</button><input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={importEncounter} /></div>}
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
          {labMode && <details className="lab-fixture-controls"><summary>Fixture setup</summary><label>Icon Job<select value={labPreferences.jobId} onChange={(event) => updateLabPreferences({ ...labPreferences, jobId: event.target.value })}>{JOBS.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}</select></label><label>Test foe<select value={labPreferences.foeProfileId} onChange={(event) => updateLabPreferences({ ...labPreferences, foeProfileId: event.target.value })}>{labFoes.map((profile) => <option key={profile.id} value={profile.id}>{profile.faction} · {profile.name}</option>)}</select></label><label>Dice seed<input type="number" value={labPreferences.seed} onChange={(event) => { const next = { ...labPreferences, seed: Number(event.target.value) || 0 }; localStorage.setItem(LAB_PREFERENCES_KEY, JSON.stringify(next)); setLabPreferences(next); }} /></label></details>}
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
          <div className="map-settings"><label>Hotlinked map background<input value={state.grid.backgroundUrl} placeholder="https://…" onChange={(event) => { const next = { ...state, grid: { ...state.grid, backgroundUrl: event.target.value } }; setState(next); localStorage.setItem(storageKey, JSON.stringify(next)); }} /></label></div>
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
      {labMode && diagnosticsOpen && <section className="lab-diagnostics">
        <header><div><button className={diagnosticTab === 'events' ? 'active' : ''} onClick={() => setDiagnosticTab('events')}>Event replay</button><button className={diagnosticTab === 'source' ? 'active' : ''} onClick={() => setDiagnosticTab('source')}>Source audit</button></div><span className={replayMatches === false ? 'failed' : replayMatches ? 'passed' : ''}>{replayMatches === null ? 'No command replayed' : replayMatches ? '✓ deterministic replay match' : '⚠ replay mismatch'}</span><button onClick={() => setDiagnosticsOpen(false)}>Close</button></header>
        {diagnosticTab === 'events' ? <div className="lab-event-diagnostics"><aside><div><strong>{state.revision}</strong><small>State revision</small></div><div><strong>{state.eventLog.length}</strong><small>Total events</small></div><div><strong>{recentEvents.length}</strong><small>Shown below</small></div></aside><pre>{recentEvents.length ? JSON.stringify(recentEvents, null, 2) : 'Use a board command to inspect its authoritative event payload.'}</pre></div> : <div className="lab-source-diagnostics"><aside><div><strong>{sourceAudit.total.toLocaleString()}</strong><small>Source units</small></div><div><strong>{sourceAudit.duplicateIds.length + sourceAudit.emptyRules.length + sourceAudit.invalidSources.length || 'PASS'}</strong><small>Integrity gaps</small></div><div><strong>{Object.keys(sourceAudit.byKind).length}</strong><small>Mechanic types</small></div></aside><div><div className="lab-source-filters"><input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Search mechanic source…" /><select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as RuleSourceKind | 'all')}><option value="all">All mechanic types</option>{Object.entries(sourceAudit.byKind).sort(([first], [second]) => first.localeCompare(second)).map(([entryKind, count]) => <option key={entryKind} value={entryKind}>{entryKind} ({count})</option>)}</select></div><div className="lab-source-list">{filteredSourceUnits.slice(0, 100).map((entry) => <details key={entry.id}><summary><span>{entry.kind}</span><strong>{entry.name}</strong><em>p.{entry.source.page}</em></summary><code>{entry.id}</code><p>{entry.rulesText}</p></details>)}</div>{filteredSourceUnits.length > 100 && <p className="lab-source-limit">Showing 100 of {filteredSourceUnits.length.toLocaleString()} matches. Refine the search to inspect a specific rule.</p>}</div></div>}
      </section>}
    </div>
  );
}
