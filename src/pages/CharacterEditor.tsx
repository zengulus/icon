import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ACTIONS, ACTION_IDS, BONDS, JOBS, RELICS, abilityPointAllowance, abilityPointsSpent, aspectRelicFromSharedQuest, awardXp, chapterForLevel, characterStats, completeRelicAspectQuest, findBond, findClass, findJob, infuseRelicDust, jobSlotsForLevel, masteryPointAllowance, narrativeBudgets, refocusCharacter, refocusDustCost, relicMinimumInfusedDust, relicRankForDust, relicSlotsForLevel, resolveRelicAspect, spendLevelUp, validateCharacter, type ActionId, type BondId, type BondPowerId, type CharacterClock, type CultureId, type IconCharacter, type KinId } from '../rules/index.js';
import { cultureOptions, kinOptions } from '../rules/player-creation.js';
import { downloadCharacter } from '../services/characters.js';
import { useCharacters } from '../context/CharacterContext.js';
import { assetBackground, uploadImage } from '../services/assets.js';

export function CharacterEditor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { characters, loading, save, user } = useCharacters();
  const [draft, setDraft] = useState<IconCharacter | null>(null);
  const [saved, setSaved] = useState(true);
  const [message, setMessage] = useState('');
  const [refocusOpen, setRefocusOpen] = useState(false);
  const [refocusJobs, setRefocusJobs] = useState<string[]>([]);

  useEffect(() => {
    const character = characters.find((item) => item.id === id);
    if (character) setDraft(structuredClone(character));
  }, [characters, id]);

  const issues = useMemo(() => draft ? validateCharacter(draft) : [], [draft]);
  const bond = draft ? findBond(draft.bondId) : undefined;
  const job = draft?.primaryJobId ? findJob(draft.primaryJobId) : undefined;
  const jobClass = job ? findClass(job.classId) : undefined;
  const stats = draft ? characterStats(draft) : null;
  const actionTotal = draft ? ACTION_IDS.reduce((sum, action) => sum + draft.actions[action], 0) : 0;
  const apAllowance = draft ? abilityPointAllowance(draft) : 0;
  const apSpent = draft ? abilityPointsSpent(draft) : 0;
  const masteryAllowance = draft ? masteryPointAllowance(draft) : 0;

  function update(patch: Partial<IconCharacter>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setSaved(false);
  }

  async function persist() {
    if (!draft) return;
    const result = await save(draft);
    setDraft(result);
    setSaved(true);
    setMessage('Saved.');
    window.setTimeout(() => setMessage(''), 1600);
  }

  async function uploadPortrait(file: File | undefined) {
    if (!file || !user) return;
    try {
      const portraitUrl = await uploadImage(file, user.id);
      update({ portraitUrl });
      setMessage('Portrait uploaded. Save the character to keep it.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Portrait upload failed.');
    }
  }

  function chooseBond(id: BondId) {
    const selectedBond = findBond(id);
    update({
      bondId: id,
      bondActionId: null,
      bondPowerIds: [],
      effort: selectedBond?.effort ?? 3,
      strain: 0,
      activeKit: '',
      customKitItems: [],
      actions: Object.fromEntries(ACTION_IDS.map((action) => [action, 0])) as IconCharacter['actions'],
    });
  }

  function chooseBondAction(action: ActionId) {
    if (!draft) return;
    const actions = { ...draft.actions };
    if (draft.bondActionId) actions[draft.bondActionId] = Math.max(0, actions[draft.bondActionId] - 2);
    actions[action] = Math.min(3, actions[action] + 2);
    update({ bondActionId: action, actions });
  }

  function changeAction(action: ActionId, delta: number) {
    if (!draft) return;
    const floor = draft.bondActionId === action ? 2 : 0;
    const next = Math.max(floor, Math.min(draft.level === 0 ? 3 : 4, draft.actions[action] + delta));
    const budgets = narrativeBudgets(draft.level);
    if (delta > 0 && actionTotal >= budgets.fixedActionDots + budgets.flexibleChoices * 2) return;
    update({ actions: { ...draft.actions, [action]: next } });
  }

  function chooseJob(jobId: string) {
    if (!draft) return;
    if (draft.jobs.includes(jobId)) { update({ primaryJobId: jobId }); return; }
    if (draft.level === 0) { update({ jobs: [jobId], primaryJobId: jobId, abilities: [], equippedAbilityIds: [] }); return; }
    if (draft.jobs.length >= jobSlotsForLevel(draft.level)) { setMessage(`Level ${draft.level} has no open Job slot.`); return; }
    update({ jobs: [...draft.jobs, jobId], primaryJobId: jobId });
  }

  function toggleAbility(abilityId: string) {
    if (!draft) return;
    const ability = job?.abilities.find((candidate) => candidate.id === abilityId);
    if (!ability || ability.chapter > chapterForLevel(draft.level)) return;
    const has = draft.abilities.some((ability) => ability.abilityId === abilityId);
    const canLearn = draft.level === 0 ? draft.abilities.length < 2 : apSpent < apAllowance;
    const abilities = has ? draft.abilities.filter((ability) => ability.abilityId !== abilityId) : canLearn ? [...draft.abilities, { abilityId, talent: null, mastered: false }] : draft.abilities;
    const equippedAbilityIds = has
      ? draft.equippedAbilityIds.filter((selectedId) => selectedId !== abilityId)
      : draft.equippedAbilityIds.length < 6 && abilities.some((ability) => ability.abilityId === abilityId) ? [...draft.equippedAbilityIds, abilityId] : draft.equippedAbilityIds;
    update({ abilities, equippedAbilityIds });
  }

  function toggleBondPower(powerId: BondPowerId) {
    if (!draft) return;
    const selected = draft.bondPowerIds.includes(powerId);
    const maxPowers = narrativeBudgets(draft.level).fixedPowers + narrativeBudgets(draft.level).flexibleChoices;
    const bondPowerIds = selected ? draft.bondPowerIds.filter((item) => item !== powerId) : draft.level === 0 ? [powerId] : draft.bondPowerIds.length < maxPowers ? [...draft.bondPowerIds, powerId] : draft.bondPowerIds;
    update({ bondPowerIds });
  }

  function setTalent(abilityId: string, talent: 1 | 2 | null) {
    if (!draft) return;
    const current = draft.abilities.find((ability) => ability.abilityId === abilityId);
    if (!current || (talent && !current.talent && apSpent >= apAllowance)) return;
    update({ abilities: draft.abilities.map((ability) => ability.abilityId === abilityId ? { ...ability, talent } : ability) });
  }

  function toggleMastery(abilityId: string) {
    if (!draft) return;
    const spent = draft.abilities.filter(({ mastered }) => mastered).length;
    update({ abilities: draft.abilities.map((ability) => ability.abilityId === abilityId ? { ...ability, mastered: ability.mastered ? false : spent < masteryAllowance } : ability) });
  }

  function addRelic(relicId: string) {
    if (!draft || !relicId || draft.relics.some((relic) => relic.relicId === relicId) || draft.relics.length >= relicSlotsForLevel(draft.level)) return;
    update({ relics: [...draft.relics, { relicId, rank: 1, aspectState: 'none', dustInfused: 0 }] });
  }

  function relicAction(action: () => IconCharacter) {
    try {
      setDraft(action());
      setSaved(false);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Relic advancement failed.');
    }
  }

  function beginRefocus() {
    if (!draft) return;
    setRefocusJobs([...draft.jobs]);
    setRefocusOpen(true);
  }

  function confirmRefocus() {
    if (!draft || !refocusOpen) return;
    try {
      const refocused = refocusCharacter(draft, { jobs: refocusJobs, primaryJobId: refocusJobs[0] ?? null, abilities: [], equippedAbilityIds: [] });
      setDraft(refocused);
      setSaved(false);
      setRefocusOpen(false);
      setMessage('Refocus complete — re-pick abilities and masteries with the refunded AP.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Refocus failed.');
    }
  }

  function toggleEquipped(abilityId: string) {
    if (!draft) return;
    const equippedAbilityIds = draft.equippedAbilityIds.includes(abilityId)
      ? draft.equippedAbilityIds.filter((id) => id !== abilityId)
      : draft.equippedAbilityIds.length < 6 ? [...draft.equippedAbilityIds, abilityId] : draft.equippedAbilityIds;
    update({ equippedAbilityIds });
  }

  function addClock(group: 'burdens' | 'ambitions') {
    if (!draft || draft[group].length >= 3) return;
    const clock: CharacterClock = { id: crypto.randomUUID(), name: '', size: 4, progress: 0 };
    update({ [group]: [...draft[group], clock] });
  }

  function updateClock(group: 'burdens' | 'ambitions', id: string, patch: Partial<CharacterClock>) {
    if (!draft) return;
    update({ [group]: draft[group].map((clock) => clock.id === id ? { ...clock, ...patch } : clock) });
  }

  function removeClock(group: 'burdens' | 'ambitions', id: string) {
    if (!draft) return;
    update({ [group]: draft[group].filter((clock) => clock.id !== id) });
  }

  function grantXp(amount: number) {
    setDraft((current) => current ? awardXp(current, amount) : current);
    setSaved(false);
    setMessage(amount === 6 ? 'Expedition XP added.' : 'XP added.');
  }

  function advanceLevel() {
    if (!draft) return;
    try {
      setDraft(spendLevelUp(draft, 3));
      setSaved(false);
      setMessage('Level gained. Confirm the campaign chapter permits it.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to level up.');
    }
  }

  if (loading && !draft) return <div className="page"><div className="empty-state">Opening character record…</div></div>;
  if (!draft) return <div className="page"><div className="empty-state"><h2>Character not found</h2><button className="button" onClick={() => navigate('/')}>Return to roster</button></div></div>;

  return (
    <div className="page editor-page">
      <header className="editor-header">
        <div><Link className="back-link" to="/">← Roster</Link><p className="eyebrow">Character record // rules 1.5</p><input className="title-input" value={draft.name} placeholder="Unnamed Icon" onChange={(event) => update({ name: event.target.value })} /></div>
        <div className="header-actions"><span className={saved ? 'save-state' : 'save-state unsaved'}>{message || (saved ? 'All changes saved' : 'Unsaved changes')}</span><button className="button ghost" onClick={() => downloadCharacter(draft)}>Export</button><button className="button primary" onClick={persist}>Save character</button></div>
      </header>

      <div className="editor-layout">
        <div className="editor-main">
          <section className="sheet-section">
            <div className="section-heading"><span>01</span><div><h2>Identity</h2><p>Kin is descriptive; Culture anchors background and outlook.</p></div></div>
            <div className="form-grid three">
              <label>Name<input value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
              <label>Pronouns<input value={draft.pronouns} onChange={(event) => update({ pronouns: event.target.value })} placeholder="they/them" /></label>
              <label>Portrait URL<input type="url" value={draft.portraitUrl} onChange={(event) => update({ portraitUrl: event.target.value })} placeholder="https://…" />{user && <span className="upload-link">or upload<input type="file" accept="image/*" onChange={(event) => void uploadPortrait(event.target.files?.[0])} /></span>}</label>
              <label>Kin<select value={draft.kinId ?? ''} onChange={(event) => update({ kinId: (event.target.value || null) as KinId | null })}><option value="">Choose Kin</option>{kinOptions().map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Culture<select value={draft.cultureId ?? ''} onChange={(event) => update({ cultureId: (event.target.value || null) as CultureId | null })}><option value="">Choose Culture</option>{cultureOptions().map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Level<input type="number" min="0" max="12" value={draft.level} onChange={(event) => update({ level: Number(event.target.value) })} /></label>
            </div>
          </section>

          <section className="sheet-section">
            <div className="section-heading"><span>02</span><div><h2>Bond</h2><p>Your narrative drive grants +2 dots in one linked action and one starting power.</p></div></div>
            <div className="option-grid bonds">
              {BONDS.map((option) => <button key={option.id} className={`option-card ${option.id === draft.bondId ? 'selected' : ''}`} onClick={() => chooseBond(option.id)}><strong>{option.name}</strong><small>{option.summary}</small><em>{option.actions.map((id) => ACTIONS.find((item) => item.id === id)?.name).join(' / ')}</em></button>)}
            </div>
            {bond && <div className="bond-detail"><div><label>Bond’s +2 action<select value={draft.bondActionId ?? ''} onChange={(event) => chooseBondAction(event.target.value as ActionId)}><option value="">Choose action</option>{bond.actions.map((id) => <option key={id} value={id}>{ACTIONS.find((item) => item.id === id)?.name}</option>)}</select></label><small className="bond-feature"><b>Second Wind:</b> {bond.secondWind}<br /><b>Special:</b> {bond.specialAbility}</small></div><div className="bond-power-picker"><label>Bond powers <small>{draft.bondPowerIds.length} selected</small></label>{bond.powers.map((power) => <button key={power.id} title={power.rulesText} className={draft.bondPowerIds.includes(power.id) ? 'selected' : ''} onClick={() => toggleBondPower(power.id)}>{draft.bondPowerIds.includes(power.id) ? '✓ ' : '+ '}{power.name}</button>)}</div><Link className="source-link" to={`/compendium?section=bonds&q=${encodeURIComponent(bond.name)}`}>Read source · p.{bond.source.page}</Link></div>}
          </section>

          <section className="sheet-section">
            <div className="section-heading"><span>03</span><div><h2>Action ratings</h2><p>Six starting dots, then narrative improvements from advancement. Only one action may reach 4.</p></div><div className={`dot-budget ${actionTotal === 6 ? 'complete' : ''}`}>{actionTotal}<small>/ {narrativeBudgets(draft.level).fixedActionDots + narrativeBudgets(draft.level).flexibleChoices * 2} max</small></div></div>
            <div className="action-list">
              {ACTIONS.map((action) => <div className="action-row" key={action.id}><div><strong>{action.name}</strong><small>{action.description}</small></div><div className="rating-control"><button onClick={() => changeAction(action.id, -1)}>−</button>{[1, 2, 3, 4].map((dot) => <span key={dot} className={draft.actions[action.id] >= dot ? 'filled' : ''} />)}<button onClick={() => changeAction(action.id, 1)}>+</button></div></div>)}
            </div>
          </section>

          <section className="sheet-section">
            <div className="section-heading"><span>04</span><div><h2>Combat Jobs</h2><p>Choose the primary Job for this expedition and learn abilities with AP.</p></div><div className="dot-budget">{draft.jobs.length}<small>/ {jobSlotsForLevel(draft.level)} Jobs</small></div></div>
            <div className="class-columns">
              {(['stalwart', 'vagabond', 'mendicant', 'wright'] as const).map((classId) => { const definition = findClass(classId)!; return <div key={classId} className="class-column" style={{ '--class-color': definition.color } as React.CSSProperties}><h3>{definition.name}</h3>{JOBS.filter((item) => item.classId === classId).map((item) => <button className={item.id === draft.primaryJobId ? 'selected' : ''} key={item.id} onClick={() => chooseJob(item.id)}><strong>{item.name}</strong><small>{item.epithet}</small></button>)}</div>; })}
            </div>
            {job && jobClass && <div className="job-detail"><div className="job-title"><div><p className="eyebrow">{jobClass.name} · primary</p><h3>{job.name}</h3><p>{job.epithet}</p></div><div className="stat-line"><span><b>{stats?.hp}</b> HP</span><span><b>{stats?.defense}</b> DEF</span><span><b>{stats?.armor}</b> ARM</span><span><b>{stats?.speed}</b> SPD</span><span><b>d{stats?.damageDie}</b> DMG</span></div></div><h4>Abilities <small>{apSpent}/{apAllowance} AP · Chapter {chapterForLevel(draft.level)}</small></h4><div className="ability-grid">{job.abilities.map((ability) => { const selected = draft.abilities.some((item) => item.abilityId === ability.id); const locked = ability.chapter > chapterForLevel(draft.level); return <button key={ability.id} className={selected ? 'selected' : ''} disabled={locked} title={`${ability.header} · ${ability.summary}`} onClick={() => toggleAbility(ability.id)}><span>{selected ? '✓' : locked ? '×' : '+'}</span><span>{ability.name}<small>Ch. {ability.chapter} · p.{ability.source.page}</small></span></button>; })}</div><Link className="source-link" to={`/compendium?section=${job.id}`}>Open full {job.name} rules · p.{job.source.page}–{job.endPage}</Link></div>}
          </section>

          <section className="sheet-section">
            <div className="section-heading"><span>05</span><div><h2>Advancement and loadout</h2><p>AP buys abilities or one of their mutually exclusive talents. Mastery uses its own points.</p></div><div className="dot-budget">{apSpent}<small>/ {apAllowance} AP</small></div></div>
            <div className="advancement-summary"><span><b>{draft.equippedAbilityIds.length}</b>/6 equipped</span><span><b>{draft.abilities.filter(({ mastered }) => mastered).length}</b>/{masteryAllowance} masteries</span><span><b>{draft.relics.length}</b>/{relicSlotsForLevel(draft.level)} relics</span></div>
            <div className="learned-abilities">{draft.abilities.map((learned) => { const definition = JOBS.flatMap((item) => item.abilities).find((ability) => ability.id === learned.abilityId); if (!definition) return null; return <article key={learned.abilityId}><div><strong>{definition.name}</strong><small>{definition.header} · {findJob(definition.jobId)?.name}</small></div><label className="inline-check"><input type="checkbox" checked={draft.equippedAbilityIds.includes(learned.abilityId)} onChange={() => toggleEquipped(learned.abilityId)} /> Equipped</label><label>Talent<select value={learned.talent ?? ''} onChange={(event) => setTalent(learned.abilityId, event.target.value ? Number(event.target.value) as 1 | 2 : null)}><option value="">None</option><option value="1">I · {definition.talents[0]}</option><option value="2">II · {definition.talents[1]}</option></select></label><button className={`mastery-toggle ${learned.mastered ? 'selected' : ''}`} onClick={() => toggleMastery(learned.abilityId)}>{learned.mastered ? 'Mastered' : `Mastery · ${definition.mastery?.name ?? ''}`}</button></article>; })}</div>
            <div className="relic-manager"><div className="subheading"><div><h3>Relics</h3><p>Relic slots unlock at levels 2, 6, and 9.</p></div><select value="" onChange={(event) => addRelic(event.target.value)}><option value="">Add relic…</option>{RELICS.filter((relic) => !draft.relics.some((selected) => selected.relicId === relic.id)).map((relic) => <option value={relic.id} key={relic.id}>{relic.name}</option>)}</select></div>{draft.relics.map((selected) => { const relic = RELICS.find((item) => item.id === selected.relicId)!; const rank = selected.rank === 4 ? 4 : relicRankForDust(selected.dustInfused); const canInfuse = rank < 4 && draft.dust > 0; const canAspect = rank === 3 && selected.aspectState === 'none' && selected.dustInfused >= relicMinimumInfusedDust(3); return <article key={selected.relicId}><div><strong>{relic.name}</strong><small>{relic.description}</small></div><div className="relic-advancement"><span><b>Rank {['I', 'II', 'III', 'Aspected'][rank - 1]}</b><small>{selected.dustInfused} dust infused · {selected.aspectState === 'unresolved' ? 'provenance unconfirmed' : selected.aspectState === 'none' ? '' : selected.aspectState.replace('-', ' ')}</small></span>{canInfuse && <button className="button compact" onClick={() => relicAction(() => infuseRelicDust(draft, selected.relicId, 1))}>Infuse 1 dust ({draft.dust} carried)</button>}</div>{canAspect && <div className="relic-aspect-actions"><button className="button compact" title="Complete a legendary task for this relic" onClick={() => relicAction(() => completeRelicAspectQuest(draft, selected.relicId))}>Aspect: legendary task</button><button className="button compact" title="Another character completed this relic's quest, so Aspect costs 4 dust" disabled={draft.dust < 4} onClick={() => relicAction(() => aspectRelicFromSharedQuest(draft, selected.relicId))}>Aspect: shared quest (4 dust)</button></div>}{selected.aspectState === 'unresolved' && <div className="relic-aspect-actions"><label>Resolve aspect<select value="" onChange={(event) => { if (event.target.value) relicAction(() => resolveRelicAspect(draft, selected.relicId, event.target.value as 'dust' | 'quest' | 'shared-quest')); }}><option value="">Confirm how it was earned…</option><option value="dust">12-dust aspect (24 total)</option><option value="quest">Aspect quest</option><option value="shared-quest">Shared aspect quest</option></select></label></div>}<button className="text-button danger" onClick={() => update({ relics: draft.relics.filter((item) => item.relicId !== selected.relicId) })}>Remove</button></article>; })}</div>
            <div className="refocus-controls"><div><h3>Refocus</h3><p>During an interlude, refund every ability, talent, and mastery, drop and re-pick Jobs ({refocusDustCost(draft, draft.jobs)} dust to keep Jobs, 8 to change them).</p></div><button className="button compact" disabled={draft.level < 1 || draft.dust < refocusDustCost(draft, draft.jobs)} onClick={beginRefocus}>Refocus…</button></div>
            {refocusOpen && <div className="refocus-panel"><label className="eyebrow">Refocus re-picks the same number of Jobs ({draft.jobs.length}); abilities and masteries are refunded.</label><div className="form-grid">{draft.jobs.map((_, index) => <label key={index}>Job {index + 1}<select value={refocusJobs[index] ?? ''} onChange={(event) => setRefocusJobs((current) => current.map((jobId, jobIndex) => jobIndex === index ? event.target.value : jobId))}>{JOBS.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}</select></label>)}</div><small className="refocus-cost">Cost: {refocusDustCost(draft, refocusJobs)} dust · carried {draft.dust}</small><div className="refocus-actions"><button className="button primary compact" onClick={confirmRefocus}>Confirm refocus</button><button className="button ghost compact" onClick={() => setRefocusOpen(false)}>Cancel</button></div></div>}
          </section>

          <section className="sheet-section">
            <div className="section-heading"><span>06</span><div><h2>Expedition record</h2><p>Track narrative resources, kits, loose gear, burdens, ambitions, and notes.</p></div></div>
            <div className="progression-controls"><div><strong>{draft.xp}/15 XP</strong><small>{draft.xpAbilityPointClaimed ? 'This level’s 7-XP AP is claimed.' : 'Gain 7 XP to claim +1 AP.'}{draft.pendingLevelUps ? ' A level-up is banked.' : ''}</small></div><button className="button compact" onClick={() => grantXp(1)}>+1 XP</button><button className="button compact" onClick={() => grantXp(6)}>+6 expedition XP</button>{draft.pendingLevelUps > 0 && <button className="button primary compact" onClick={advanceLevel}>Gain level</button>}</div>
            <div className="form-grid three"><label>XP (manual correction)<input type="number" min="0" max="14" value={draft.xp} onChange={(event) => { const xp = Number(event.target.value); update({ xp, xpAbilityPointClaimed: draft.xpAbilityPointClaimed || xp >= 7 }); }} /></label><label>Effort<input type="number" min="0" max={bond?.effort ?? 3} value={draft.effort} onChange={(event) => update({ effort: Number(event.target.value) })} /></label><label>Strain<input type="number" min="0" max={bond?.strain ?? 5} value={draft.strain} onChange={(event) => update({ strain: Number(event.target.value) })} /></label><label>Carried dust<input type="number" min="0" max="8" value={draft.dust} onChange={(event) => update({ dust: Number(event.target.value) })} /></label><label>Active Bond kit<select value={draft.activeKit} onChange={(event) => update({ activeKit: event.target.value })}><option value="">Choose kit</option>{bond?.kits.map((kit) => <option key={kit.name} value={kit.name}>{kit.name}</option>)}<option value="Custom Kit">Custom Kit</option></select></label></div>
            <div className="form-grid two"><label>Custom kit items<textarea rows={4} value={draft.customKitItems.join('\n')} onChange={(event) => update({ customKitItems: event.target.value ? event.target.value.split('\n') : [] })} placeholder="One item per line; a custom kit has three" /></label><label>Stored loose gear<textarea rows={4} value={draft.looseGear.join('\n')} onChange={(event) => update({ looseGear: event.target.value ? event.target.value.split('\n') : [], equippedLooseGear: draft.equippedLooseGear.filter((item) => event.target.value.split('\n').includes(item)) })} placeholder="One item per line" /></label></div>
            {draft.looseGear.filter(Boolean).length > 0 && <div className="gear-picker"><strong>Loose gear taken (max 2)</strong>{draft.looseGear.filter(Boolean).map((item, index) => <label key={`${item}-${index}`}><input type="checkbox" checked={draft.equippedLooseGear.includes(item)} onChange={() => update({ equippedLooseGear: draft.equippedLooseGear.includes(item) ? draft.equippedLooseGear.filter((selected) => selected !== item) : draft.equippedLooseGear.length < 2 ? [...draft.equippedLooseGear, item] : draft.equippedLooseGear })} /> {item}</label>)}</div>}
            <div className="clock-columns">{(['burdens', 'ambitions'] as const).map((group) => <div key={group}><div className="subheading"><h3>{group}</h3><button className="button compact" onClick={() => addClock(group)}>Add</button></div>{draft[group].map((clock) => <div className="clock-row" key={clock.id}><input value={clock.name} onChange={(event) => updateClock(group, clock.id, { name: event.target.value })} placeholder={group === 'burdens' ? 'Burden' : 'Ambition'} /><select value={clock.size} onChange={(event) => updateClock(group, clock.id, { size: Number(event.target.value) as 4 | 6 | 10 })}><option value="4">4</option><option value="6">6</option><option value="10">10</option></select><input type="number" min="0" max={clock.size} value={clock.progress} onChange={(event) => updateClock(group, clock.id, { progress: Number(event.target.value) })} /><button className="text-button danger" onClick={() => removeClock(group, clock.id)}>×</button></div>)}</div>)}</div>
            <label>Character notes<textarea rows={7} value={draft.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="Ideals, appearance, history, and expedition notes…" /></label>
          </section>
        </div>

        <aside className="validation-panel">
          <div className="sticky-card">
            <p className="eyebrow">Creation check</p><h3>{issues.filter(({ severity }) => severity === 'error').length ? 'Still taking shape' : 'Ready for expedition'}</h3>
            <div className="mini-portrait" style={assetBackground(draft.portraitUrl)}>{!assetBackground(draft.portraitUrl) && (draft.name[0] || 'I')}</div>
            <dl><div><dt>Bond</dt><dd>{bond?.name ?? '—'}</dd></div><div><dt>Job</dt><dd>{job?.name ?? '—'}</dd></div><div><dt>Vitality</dt><dd>{stats?.vitality ?? '—'}</dd></div><div><dt>HP</dt><dd>{stats?.maxHp ?? '—'}</dd></div></dl>
            <ul className="issue-list">{issues.length ? issues.map((issue, index) => <li className={issue.severity} key={`${issue.code}-${index}`}><span>{issue.severity === 'error' ? '!' : 'i'}</span>{issue.message}</li>) : <li className="ok"><span>✓</span>All level 0 requirements are satisfied.</li>}</ul>
            <button className="button primary full" onClick={persist}>Save character</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
