import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ACTION_IDS,
  ACTIONS,
  createLevelZeroNarrative,
  applyLevelZeroTactical,
  validateNarrativeCharacter,
  actionOptions,
  bondOptions,
  cultureOptions,
  kinOptions,
  levelZeroJobOptions,
  type ActionId,
  type BondId,
  type BondPowerId,
  type CultureId,
  type JobClassId,
  type JobDefinition,
  type KinId,
  type LevelZeroNarrativeSelection,
  type LevelZeroTacticalSelection,
} from '../rules/index.js';
import { SourceReference } from '../components/SourceReference.js';
import { SaveStateChip } from '../components/SaveStateChip.js';
import { useCharacters } from '../context/CharacterContext.js';

type Step = 'identity' | 'narrative' | 'gate' | 'combat';

const CLASSES: ReadonlyArray<{ classId: JobClassId; name: string }> = [
  { classId: 'stalwart', name: 'Stalwart' },
  { classId: 'vagabond', name: 'Vagabond' },
  { classId: 'mendicant', name: 'Mendicant' },
  { classId: 'wright', name: 'Wright' },
];

/** Loose editing state: the wizard allows unselected (empty) IDs while a
 * value is being assembled. It is only coerced to the strict selection type at
 * build time, after `validateNarrativeCharacter` has passed. */
interface NarrativeDraftState {
  kinId: '' | KinId;
  cultureId: '' | CultureId;
  bondId: '' | BondId;
  bondPowerId: '' | BondPowerId;
  bondActionId: '' | ActionId;
  additionalActionDots: Partial<Record<ActionId, number>>;
}

const emptySelection = (): NarrativeDraftState => ({
  kinId: '',
  cultureId: '',
  bondId: '',
  bondPowerId: '',
  bondActionId: '',
  additionalActionDots: {},
});

/** Per-action total = the Bond's +2 (only for the Bond's linked action) plus
 * any additional dots the player spread across actions. */
function dotFor(selection: NarrativeDraftState, actionId: ActionId): number {
  const bondBase = selection.bondActionId === actionId ? 2 : 0;
  return bondBase + (selection.additionalActionDots[actionId] ?? 0);
}

export function NewCharacter() {
  const navigate = useNavigate();
  const { save } = useCharacters();

  const [step, setStep] = useState<Step>('identity');
  const [name, setName] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [portraitUrl, setPortraitUrl] = useState('');
  const [selection, setSelection] = useState<NarrativeDraftState>(emptySelection);
  const [jobId, setJobId] = useState<JobDefinition['id'] | ''>('');
  const [abilitySelection, setAbilitySelection] = useState<string[]>([]);
  const [durable, setDurable] = useState(false);
  const [message, setMessage] = useState('');

  const bonds = bondOptions();
  const activeBond = bonds.find((bond) => bond.id === selection.bondId);
  const extraDotsUsed = ACTION_IDS.reduce((sum, action) => sum + (selection.additionalActionDots[action] ?? 0), 0);
  const jobs = levelZeroJobOptions();
  const activeJob = jobs.find((job) => job.id === jobId);

  const narrativeIssues = useMemo(() => {
    const probe = {
      kinId: selection.kinId || null,
      cultureId: selection.cultureId || null,
      bondId: selection.bondId || null,
      bondActionId: selection.bondActionId || null,
      bondPowerIds: selection.bondPowerId ? [selection.bondPowerId] : [],
      actions: Object.fromEntries(ACTION_IDS.map((action) => [action, dotFor(selection, action)])),
      level: 0,
    } as unknown as Parameters<typeof validateNarrativeCharacter>[0];
    return validateNarrativeCharacter(probe);
  }, [selection]);

  const narrativeBlocking = narrativeIssues.filter((issue) => issue.severity === 'error');
  const narrativeComplete = narrativeBlocking.length === 0;

  /** Narrow the loose draft to the strict selection once narrative validation
   * has passed. Only called from the two commit paths after the gate, so the
   * cast is safe and gated by `validateNarrativeCharacter`. */
  function sealedSelection(): LevelZeroNarrativeSelection {
    return selection as unknown as LevelZeroNarrativeSelection;
  }

  function addDot(actionId: ActionId) {
    if (extraDotsUsed >= 4) return;
    setSelection((current) => {
      if (dotFor(current, actionId) >= 3) return current;
      const dots = { ...current.additionalActionDots };
      dots[actionId] = (dots[actionId] ?? 0) + 1;
      return { ...current, additionalActionDots: dots };
    });
  }
  function removeDot(actionId: ActionId) {
    setSelection((current) => {
      const dots = { ...current.additionalActionDots };
      if (dots[actionId] !== undefined && dots[actionId]! > 0) dots[actionId] = (dots[actionId]! ?? 1) - 1;
      return { ...current, additionalActionDots: dots };
    });
  }

  function commitNarrativeOnly() {
    try {
      const character = createLevelZeroNarrative({ name, pronouns, portraitUrl }, sealedSelection());
      void save(character).then(() => {
        setDurable(true);
        navigate('/');
      });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not save this character.');
    }
  }

  function toggleAbility(abilityId: string) {
    if (!activeJob?.abilities.some((ability) => ability.id === abilityId)) return;
    setAbilitySelection((current) => {
      const has = current.includes(abilityId);
      if (has) return current.filter((id) => id !== abilityId);
      if (current.length >= 2) return current;
      return [...current, abilityId];
    });
  }

  function finishCombat() {
    if (!jobId || abilitySelection.length !== 2) {
      setMessage('Choose one Job and exactly two of its starting abilities.');
      return;
    }
    try {
      const tactical: LevelZeroTacticalSelection = { jobId, abilityIds: abilitySelection };
      const narrative = createLevelZeroNarrative({ name, pronouns, portraitUrl }, sealedSelection());
      const character = applyLevelZeroTactical(narrative, tactical);
      void save(character).then((saved) => {
        setDurable(true);
        navigate(`/characters/${saved.id}`, { replace: true });
      });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not finish combat creation.');
    }
  }

  return (
    <div className="page new-character-page">
      <header className="page-header">
        <div><Link className="back-link" to="/">← Roster</Link><p className="eyebrow">New character // level 0</p><h1>Create an Icon</h1><p>Narrative creation first; your tactical combat character is a separate choice.</p></div>
        <div className="header-actions"><SaveStateChip state={durable ? 'local' : 'editing'} /></div>
      </header>

      {message && <div className="notice">{message}</div>}

      <nav className="wizard-steps" aria-label="Creation progress">
        {(['identity', 'narrative', 'gate', 'combat'] as const).map((item, index) => (
          <span key={item} className={step === item ? 'active' : ''}><b>{index + 1}</b>{item === 'gate' ? 'Tactical gate' : item === 'identity' ? 'Basics' : item}</span>
        ))}
      </nav>

      {step === 'identity' && (
        <section className="sheet-section">
          <div className="section-heading"><span>A</span><div><h2>Identity</h2><p>These are application character metadata — they are not ICON rules choices.</p></div></div>
          <div className="form-grid three">
            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Unnamed Icon" autoFocus /></label>
            <label>Pronouns<input value={pronouns} onChange={(event) => setPronouns(event.target.value)} placeholder="they/them" /></label>
            <label>Portrait URL<input type="url" value={portraitUrl} onChange={(event) => setPortraitUrl(event.target.value)} placeholder="https://…" /></label>
          </div>
          <div className="wizard-actions"><button className="button primary" onClick={() => setStep('narrative')}>Continue to narrative creation</button></div>
        </section>
      )}

      {step === 'narrative' && (
        <section className="sheet-section">
          <div className="section-heading"><span>B</span><div><h2>Narrative creation</h2><p>Choose Kin, Culture, Bond, one Bond power, and six action dots (two come from your Bond).</p></div></div>
          <SourceReference page={46} />

          <div className="subheading"><h3>1 · Kin</h3><p>Descriptive; Kin have no mechanical differences.</p></div>
          <div className="option-grid bonds">
            {kinOptions().map((kin) => (
              <div className="creation-option" key={kin.id}>
                <button type="button" className={`option-card ${selection.kinId === kin.id ? 'selected' : ''}`} onClick={() => setSelection((current) => ({ ...current, kinId: kin.id }))}>
                  <strong>{kin.name}</strong><small>{kin.description}</small>
                </button>
                <SourceReference page={kin.sourcePage} />
              </div>
            ))}
          </div>

          <div className="subheading"><h3>2 · Culture</h3><p>Background and outlook.</p></div>
          <div className="option-grid bonds">
            {cultureOptions().map((culture) => (
              <div className="creation-option" key={culture.id}>
                <button type="button" className={`option-card ${selection.cultureId === culture.id ? 'selected' : ''}`} onClick={() => setSelection((current) => ({ ...current, cultureId: culture.id }))}>
                  <strong>{culture.name}</strong><small>{culture.description}</small>
                </button>
                <SourceReference page={culture.sourcePage} />
              </div>
            ))}
          </div>

          <div className="subheading"><h3>3 · Bond</h3><p>Your Bond grants +2 dots in one linked action and one starting power.</p></div>
          <div className="option-grid bonds">
            {bonds.map((bond) => (
              <div className="creation-option" key={bond.id}>
                <button type="button" className={`option-card ${selection.bondId === bond.id ? 'selected' : ''}`} onClick={() => setSelection((current) => ({ ...current, bondId: bond.id, bondActionId: '', bondPowerId: '' }))}>
                  <strong>{bond.name}</strong><small>{bond.summary}</small><em>{bond.actions.map((id) => ACTIONS.find((action) => action.id === id)?.name).join(' / ')}</em>
                </button>
                <SourceReference page={bond.sourcePage} />
              </div>
            ))}
          </div>

          {activeBond && (
            <>
              <div className="subheading"><h3>4 · Bond power</h3><p>Choose one starting Bond power.</p></div>
              <div className="compact-picker">
                {activeBond.powers.map((power) => (
                  <button key={power.id} type="button" className={selection.bondPowerId === power.id ? 'selected' : ''} onClick={() => setSelection((current) => ({ ...current, bondPowerId: power.id }))}>
                    {selection.bondPowerId === power.id ? '✓ ' : '+ '}{power.name}
                  </button>
                ))}
              </div>

              <div className="subheading"><h3>5 · Bond’s +2 action</h3><p>One of {activeBond.actions.map((id) => ACTIONS.find((action) => action.id === id)?.name).join(' or ')} receives the Bond’s +2 dots.</p></div>
              <div className="compact-picker">
                {activeBond.actions.map((actionId) => (
                  <button key={actionId} type="button" className={selection.bondActionId === actionId ? 'selected' : ''} onClick={() => setSelection((current) => ({ ...current, bondActionId: actionId }))}>
                    {selection.bondActionId === actionId ? '✓ ' : '+ '}{ACTIONS.find((action) => action.id === actionId)?.name}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="subheading"><h3>6 · Additional action dots</h3><p>Add {4 - extraDotsUsed} more dots across any Actions. No action rating may exceed 3.</p></div>
          <div className="action-list">
            {ACTION_IDS.map((action) => {
              const total = dotFor(selection, action);
              const sourcePage = actionOptions().find((option) => option.id === action)?.sourcePage ?? 17;
              return (
                <div className="action-row" key={action}>
                  <div><strong>{ACTIONS.find((item) => item.id === action)?.name}</strong><small>{ACTIONS.find((item) => item.id === action)?.description}</small></div>
                  <div className="rating-control">
                    <button aria-label={`Remove a dot from ${action}`} onClick={() => removeDot(action)} disabled={(selection.additionalActionDots[action] ?? 0) <= 0}>−</button>
                    {[1, 2, 3].map((dot) => <span key={dot} className={total >= dot ? 'filled' : ''} />)}
                    <button aria-label={`Add a dot to ${action}`} onClick={() => addDot(action)} disabled={extraDotsUsed >= 4 || total >= 3}>+</button>
                  </div>
                  <SourceReference page={sourcePage} />
                </div>
              );
            })}
          </div>

          <div className="wizard-actions">
            <button className="button ghost" onClick={() => setStep('identity')}>Back</button>
            <button className="button primary" disabled={!narrativeComplete} onClick={() => { setMessage(''); setStep('gate'); }}>Continue to tactical gate</button>
            {!narrativeComplete && <small className="blocking-reason">{narrativeBlocking.map((issue) => issue.message).join(' · ')}</small>}
          </div>
        </section>
      )}

      {step === 'gate' && (
        <section className="sheet-section">
          <div className="section-heading"><span>C</span><div><h2>Choose your tactical character?</h2><p>Your Job and two starting abilities define your level-0 tactical combat character.</p></div></div>
          <div className="gate-actions">
            <button className="button ghost" onClick={commitNarrativeOnly} title="Saves a valid narrative character locally; you can choose combat options later from the sheet.">Not yet</button>
            <button className="button primary" onClick={() => setStep('combat')}>Choose combat options</button>
          </div>
        </section>
      )}

      {step === 'combat' && (
        <section className="sheet-section">
          <div className="section-heading"><span>D</span><div><h2>Combat creation</h2><p>Choose exactly one Job and exactly two of its level-0 abilities.</p></div></div>
          <SourceReference page={112} />
          <div className="class-columns">
            {CLASSES.map(({ classId, name }) => (
              <div key={classId} className="class-column">
                <h3>{name}</h3>
                {jobs.filter((job) => job.classId === classId).map((job) => (
                  <div className="creation-option" key={job.id}>
                    <button type="button" className={`${jobId === job.id ? 'selected' : ''}`} onClick={() => { setJobId(job.id); setAbilitySelection([]); }}>
                      <strong>{job.name}</strong><small>{job.epithet}</small>
                    </button>
                    <SourceReference page={job.sourcePage} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          {activeJob && (
            <div className="job-detail">
              <h4>{activeJob.name} abilities <small>{abilitySelection.length}/2 selected</small></h4>
              <div className="ability-grid">
                {activeJob.abilities.map((ability) => (
                  <button key={ability.id} type="button" className={abilitySelection.includes(ability.id) ? 'selected' : ''} onClick={() => toggleAbility(ability.id)}>
                    <span>{abilitySelection.includes(ability.id) ? '✓' : '+'}</span>
                    <span>{ability.name}<small>p.{ability.sourcePage}</small></span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="wizard-actions">
            <button className="button ghost" onClick={() => setStep('gate')}>Back</button>
            <button className="button primary" disabled={!jobId || abilitySelection.length !== 2} onClick={finishCombat}>Finish and open character</button>
          </div>
        </section>
      )}
    </div>
  );
}