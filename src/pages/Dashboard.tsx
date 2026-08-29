import { useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { chapterForLevel, createCharacter, findBond, findCulture, findJob, findKin, migrateCharacter, validateCharacter } from '../rules/index.js';
import { useCharacters } from '../context/CharacterContext.js';
import { assetBackground } from '../services/assets.js';

export function Dashboard() {
  const { characters, loading, error, save, remove, user, cloudEnabled, signIn, signOut } = useCharacters();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');

  async function addCharacter() {
    const character = await save(createCharacter());
    navigate(`/characters/${character.id}`);
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const character = migrateCharacter(JSON.parse(await file.text()));
      character.id = crypto.randomUUID();
      character.name = `${character.name || 'Unnamed Icon'} (imported)`;
      await save(character);
      setNotice('Character imported.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Import failed.');
    }
    event.target.value = '';
  }

  async function sendMagicLink() {
    try {
      await signIn(email);
      setNotice('Check your email for the sign-in link.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Sign-in failed.');
    }
  }

  return (
    <div className="page dashboard">
      <header className="page-header">
        <div><p className="eyebrow">Personal archive</p><h1>Your Icons</h1><p>Build narrative identity and tactical loadout from one rules-backed record.</p></div>
        <div className="header-actions">
          <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
          <button className="button ghost" onClick={() => inputRef.current?.click()}>Import</button>
          <button className="button primary" onClick={addCharacter}>New character</button>
        </div>
      </header>

      {(notice || error) && <div className="notice">{error || notice}</div>}

      <section className="sync-strip">
        <div><span className={`status-dot ${user ? 'online' : ''}`} /><strong>{user ? 'Cloud sync active' : 'Working locally'}</strong><small>{user ? user.email : cloudEnabled ? 'Sign in to carry this roster between devices.' : 'Add Supabase environment variables to enable accounts.'}</small></div>
        {user ? <button className="text-button" onClick={signOut}>Sign out</button> : cloudEnabled && (
          <form onSubmit={(event) => { event.preventDefault(); void sendMagicLink(); }}>
            <input type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <button className="button compact" type="submit">Email sign-in link</button>
          </form>
        )}
      </section>

      {loading ? <div className="empty-state">Opening the archive…</div> : characters.length === 0 ? (
        <div className="empty-state"><span>◈</span><h2>No Icons recorded yet</h2><p>Start at level 0 with Kin, Culture, Bond, Job, and two abilities.</p><button className="button primary" onClick={addCharacter}>Create your first Icon</button></div>
      ) : (
        <div className="character-grid">
          {characters.map((character) => {
            const issues = validateCharacter(character).filter(({ severity }) => severity === 'error');
            const bond = findBond(character.bondId);
            const job = character.primaryJobId ? findJob(character.primaryJobId) : undefined;
            return (
              <article className="character-card" key={character.id}>
                <div className="portrait" style={assetBackground(character.portraitUrl)}>{!assetBackground(character.portraitUrl) && (character.name[0] || 'I')}</div>
                <div className="character-card-body">
                  <div className="card-meta"><span>LV {character.level}</span><span>CHAPTER {chapterForLevel(character.level)}</span></div>
                  <h2>{character.name || 'Unnamed Icon'}</h2>
                  <p>{[findKin(character.kinId)?.name, findCulture(character.cultureId)?.name, bond?.name, job?.name].filter(Boolean).join(' · ') || 'Creation in progress'}</p>
                  <div className="card-status"><span className={issues.length ? 'warning' : 'valid'}>{issues.length ? `${issues.length} item${issues.length === 1 ? '' : 's'} to finish` : 'Ready for expedition'}</span><span>{character.xp}/15 XP</span></div>
                  <div className="card-actions"><Link className="button compact" to={`/characters/${character.id}`}>Open sheet</Link><button className="text-button danger" onClick={() => window.confirm(`Archive ${character.name || 'this character'}?`) && void remove(character.id)}>Archive</button></div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
