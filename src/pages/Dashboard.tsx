import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { chapterForLevel, findBond, findCulture, findJob, findKin, validateCharacter } from '../rules/index.js';
import { useCharacters } from '../context/CharacterContext.js';
import { assetBackground } from '../services/assets.js';
import { importLegacyIconFile, LEGACY_ICON_FILE_ACCEPT } from '../services/legacy-icon-import.js';
import { createConnectApi, type ConnectProfile } from '../services/connect-api.js';
import { loadLocalInstance, type LocalInstance } from '../services/instance-identity.js';
import { buildIconConnectArtifact, parseIconConnectArtifact, serializeIconConnectArtifact } from '../connect/icon-connect.js';
import { isOpaqueInternalAuthEmail, validateUsername } from '../connect/username.js';
import { supabase, supabaseConfigured } from '../services/supabase.js';

type ConnectMode = 'create' | 'login';

export function Dashboard() {
  const { characters, loading, error, save, remove, user, cloudEnabled, signIn, signOut } = useCharacters();
  const inputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');

  // ICON Connect identity/account state.
  const [connectMode, setConnectMode] = useState<ConnectMode>('create');
  const [connectUsername, setConnectUsername] = useState('');
  const [connectPassword, setConnectPassword] = useState('');
  const [connectConfirm, setConnectConfirm] = useState('');
  const [connectMessage, setConnectMessage] = useState('');
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectProfile, setConnectProfile] = useState<ConnectProfile | null>(null);
  const [localInstance, setLocalInstance] = useState<LocalInstance | null>(null);
  const [instanceError, setInstanceError] = useState('');
  const [showEmailLogin, setShowEmailLogin] = useState(false);

  // Account creation needs both a configured Supabase backend (server-side
  // auth) and the Render connect service.
  const connectAvailable = supabaseConfigured && Boolean(createConnectApi());

  // Ensure the local instance/keypair exists once; fully offline.
  useEffect(() => {
    let active = true;
    loadLocalInstance()
      .then((instance) => { if (active) setLocalInstance(instance); })
      .catch((reason) => {
        if (active) setInstanceError(reason instanceof Error ? reason.message : 'Local identity unavailable.');
      });
    return () => { active = false; };
  }, []);

  // "Connected as <username>" is fetched from server state after login, never
  // read from a persisted browser profile blob.
  useEffect(() => {
    let active = true;
    async function refreshProfile() {
      const api = createConnectApi();
      if (!user || !supabase || !api) {
        if (active) setConnectProfile(null);
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          if (active) setConnectProfile(null);
          return;
        }
        const profile = await api.profile(data.session.access_token);
        if (active) setConnectProfile(profile);
      } catch {
        if (active) setConnectProfile(null);
      }
    }
    void refreshProfile();
    return () => { active = false; };
  }, [user?.id]);

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      // Legacy .icon conversion is import-only and runs fully offline. Each
      // valid record becomes a fresh canonical character persisted through the
      // same local-first save path as native creation.
      const result = importLegacyIconFile(await file.text());
      for (const character of result.imported) {
        await save(character);
      }
      const messages: string[] = [];
      if (result.imported.length) {
        messages.push(`Imported ${result.imported.length} character${result.imported.length === 1 ? '' : 's'}.`);
      }
      for (const connectError of result.errors) {
        messages.push(`Record ${connectError.index + 1}: ${connectError.message}`);
      }
      setNotice(messages.length ? messages.join(' ') : 'No characters were imported.');
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

  /** Username/password account creation or login. The password exists only in
   * this transient form state and is cleared immediately after success or
   * failure — it is never persisted anywhere by the application. */
  async function submitConnect(event: FormEvent) {
    event.preventDefault();
    setConnectBusy(true);
    setConnectMessage('');
    try {
      if (!localInstance) throw new Error('Your local identity is still loading; try again in a moment.');
      const api = createConnectApi();
      if (!api) throw new Error('The connection service is not configured for this deployment.');
      const username = validateUsername(connectUsername);
      if (!username.ok) throw new Error(username.message);
      if (connectPassword.length < 8) throw new Error('Passwords must be at least 8 characters.');
      if (connectMode === 'create' && connectPassword !== connectConfirm) throw new Error('Passwords do not match.');
      const result = connectMode === 'create'
        ? await (async () => {
          // Prove possession of THIS instance with the non-extractable
          // private key before the server binds it to the new account.
          const challenge = await api.requestChallenge({
            instanceId: localInstance.instanceId,
            publicKey: localInstance.publicKey,
            operation: 'register',
          });
          const signature = await localInstance.sign(challenge.challenge);
          return api.register({
            username: username.display,
            password: connectPassword,
            instanceId: localInstance.instanceId,
            challengeId: challenge.challengeId,
            signature,
          });
        })()
        : await api.login({ username: username.display, password: connectPassword });
      await supabase?.auth.setSession({
        access_token: result.session.accessToken,
        refresh_token: result.session.refreshToken,
      });
      setConnectProfile(result.profile);
      setConnectMessage(`Connected as ${result.profile.username}.`);
      setConnectUsername('');
    } catch (reason) {
      setConnectMessage(reason instanceof Error ? reason.message : 'Could not connect this player.');
    } finally {
      setConnectPassword('');
      setConnectConfirm('');
      setConnectBusy(false);
    }
  }

  /** Export the PUBLIC instance descriptor (icon_connect.json). It contains
   * only identity + public key — never credentials. */
  function exportConnectFile() {
    if (!localInstance) return;
    const artifact = buildIconConnectArtifact(localInstance.instanceId, localInstance.publicKey);
    const blob = new Blob([serializeIconConnectArtifact(artifact)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'icon_connect.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** Importing icon_connect.json only validates the public artifact: it never
   * logs anybody in, grants permissions, or changes local identity. */
  async function importConnectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const artifact = parseIconConnectArtifact(await file.text());
      if (!localInstance) {
        setNotice('This connect file describes a device; this browser has no local identity to compare against.');
      } else if (artifact.instanceId === localInstance.instanceId) {
        const sameKey = artifact.publicKey.x === localInstance.publicKey.x && artifact.publicKey.y === localInstance.publicKey.y;
        setNotice(sameKey
          ? 'This connect file matches this device.'
          : 'This connect file matches this device id but carries a different public key. Your local identity was not changed.');
      } else {
        setNotice('This connect file describes a different device. It cannot claim characters or change this device; your local identity was not changed.');
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'The connect file is invalid.');
    }
    event.target.value = '';
  }

  return (
    <div className="page dashboard">
      <header className="page-header">
        <div><p className="eyebrow">Personal archive</p><h1>Your Icons</h1><p>Build narrative identity and tactical loadout from one rules-backed record.</p></div>
        <div className="header-actions">
          <input ref={inputRef} type="file" accept={LEGACY_ICON_FILE_ACCEPT} hidden onChange={importFile} />
          <button className="button ghost" onClick={() => inputRef.current?.click()}>Import .icon</button>
          <Link className="button primary" to="/characters/new">New character</Link>
        </div>
      </header>

      {(notice || connectMessage || error) && <div className="notice">{error || connectMessage || notice}</div>}

      <section className="sync-strip">
        <div>
          <span className={`status-dot ${user ? 'online' : ''}`} />
          <strong>{user ? 'Cloud sync active' : 'Working locally'}</strong>
          <small>{user
            ? (connectProfile?.username
              ? `Connected as ${connectProfile.username}`
              // A connect account's internal auth address is opaque and
              // must never surface in the UI; fall back to a neutral label.
              : isOpaqueInternalAuthEmail(user.email) ? 'Connected' : user.email)
            : (connectAvailable ? 'Create a username and password to carry this roster between devices.' : cloudEnabled ? 'Sign in to carry this roster between devices.' : 'Add Supabase environment variables to enable accounts.')}
            {instanceError ? ` ${instanceError}` : ''}
          </small>
        </div>

        <div className="sync-actions">
          {user ? (
            <>
              <span className="connected-as">{connectProfile?.username ? `Connected as ${connectProfile.username}` : ''}</span>
              <button className="text-button" onClick={signOut}>Sign out</button>
            </>
          ) : connectAvailable && !showEmailLogin ? (
            <form className="connect-form" onSubmit={submitConnect}>
              <label>Username<input value={connectUsername} onChange={(event) => setConnectUsername(event.target.value)} autoComplete="username" required /></label>
              <label>Password<input type="password" value={connectPassword} onChange={(event) => setConnectPassword(event.target.value)} autoComplete={connectMode === 'create' ? 'new-password' : 'current-password'} required /></label>
              {connectMode === 'create' && <label>Confirm password<input type="password" value={connectConfirm} onChange={(event) => setConnectConfirm(event.target.value)} autoComplete="new-password" required /></label>}
              <button className="button compact" type="submit" disabled={connectBusy}>{connectBusy ? 'Working…' : connectMode === 'create' ? 'Create account' : 'Log in'}</button>
              <button type="button" className="text-button" onClick={() => setConnectMode(connectMode === 'create' ? 'login' : 'create')}>
                {connectMode === 'create' ? 'Have an account? Log in' : 'New here? Create an account'}
              </button>
              <button type="button" className="text-button" onClick={() => setShowEmailLogin(true)}>Sign in by email instead</button>
            </form>
          ) : cloudEnabled ? (
            <form onSubmit={(event) => { event.preventDefault(); void sendMagicLink(); }}>
              <input type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
              <button className="button compact" type="submit">Email sign-in link</button>
              {connectAvailable && <button type="button" className="text-button" onClick={() => setShowEmailLogin(false)}>Use username and password</button>}
            </form>
          ) : null}

          <div className="sync-file-actions">
            <button className="text-button" onClick={exportConnectFile} disabled={!localInstance} title="Export this device's public connect file">Download connect file</button>
            <label className="text-button" title="Validate an icon_connect.json descriptor">Import connect file
              <input type="file" accept=".json,application/json" hidden onChange={importConnectFile} />
            </label>
          </div>
        </div>
      </section>

      {loading ? <div className="empty-state">Opening the archive…</div> : characters.length === 0 ? (
        <div className="empty-state"><span>◈</span><h2>No Icons recorded yet</h2><p>Start at level 0 with Kin, Culture, Bond, Job, and two abilities.</p><Link className="button primary" to="/characters/new">Create your first Icon</Link></div>
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
