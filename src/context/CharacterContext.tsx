import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { IconCharacter } from '../rules/index.js';
import { characterLoadNotice, listCharactersWithReport } from '../services/characters.js';
import { CharacterSyncController, loadOrCreateCreatorInstanceId, type LocalCharacterRecord, type SaveState } from '../services/character-sync.js';
import { SupabaseCharacterTransport, loadLocalRecords, writeLocalRecords } from '../services/characters.js';
import { currentE2EIdentity, e2eAuthEnabled } from '../services/e2e-auth.js';
import { supabase, supabaseConfigured } from '../services/supabase.js';

/** The UI only needs an id and display email from a Supabase user. */
type AppUser = Pick<User, 'id' | 'email'>;

interface CharacterContextValue {
  characters: IconCharacter[];
  records: LocalCharacterRecord[];
  saveStates: Record<string, SaveState>;
  user: AppUser | null;
  loading: boolean;
  cloudEnabled: boolean;
  error: string;
  refresh(): Promise<void>;
  save(character: IconCharacter): Promise<IconCharacter>;
  remove(id: string): Promise<void>;
  flush(id: string): void;
  signIn(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const CharacterContext = createContext<CharacterContextValue | null>(null);

export function CharacterProvider({ children }: { children: ReactNode }) {
  const [characters, setCharacters] = useState<IconCharacter[]>([]);
  const [records, setRecords] = useState<LocalCharacterRecord[]>([]);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const userRef = useRef<AppUser | null>(null);
  userRef.current = user;

  const controllerRef = useRef<CharacterSyncController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CharacterSyncController({
      transport: new SupabaseCharacterTransport(() => userRef.current?.id ?? null),
      load: () => loadLocalRecords(),
      write: (next) => writeLocalRecords(next),
      hooks: {
        onState(record) {
          setRecords((current) => {
            const index = current.findIndex((item) => item.character.id === record.character.id);
            const next = index >= 0 ? [...current] : [...current];
            if (index >= 0) next[index] = record;
            else next.unshift(record);
            return next;
          });
          setSaveStates((states) => ({ ...states, [record.character.id]: record.cloudState === 'synced' && record.cloudRevision === record.localRevision ? 'cloud' : 'local' }));
          setCharacters((current) => {
            const next = current.filter((item) => item.id !== record.character.id);
            return [record.character, ...next];
          });
        },
        onCloudFailure() {
          // The record stays durably local + pending; the chip already reads
          // "local" until an exact-revision acknowledgement. No roster change.
        },
      },
    });
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCharactersWithReport(user?.id ?? null);
      controllerRef.current?.adopt(result.records);
      setRecords(result.records);
      setCharacters(result.characters);
      const states: Record<string, SaveState> = {};
      for (const record of result.records) {
        states[record.character.id] = record.cloudState === 'synced' && record.cloudRevision === record.localRevision ? 'cloud' : 'local';
      }
      setSaveStates(states);
      setError(characterLoadNotice(result.issues));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load characters.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    if (e2eAuthEnabled) {
      setUser(currentE2EIdentity());
      setLoading(false);
      return () => { active = false; };
    }
    if (!supabase) {
      return () => { active = false; };
    }
    void supabase.auth.getUser().then(({ data }) => active && setUser(data.user));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // Load the roster once on mount. Authentication might resolve afterward, so
  // refresh again whenever the identity changes to import any cloud rows.
  useEffect(() => { void refresh(); }, [refresh]);

  // Start the replication controller after the initial roster is in memory so
  // pending (locally-saved) records become eligible for cloud replication.
  useEffect(() => {
    controllerRef.current?.start();
  }, []);

  // Best-effort final flush on hide/close. The durable guarantee is that the
  // latest state is committed locally and remains pending; this attempt only
  // reduces the window during which a pending revision waits for quiescence.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const flush = () => controller.flushAllPending();
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const value = useMemo<CharacterContextValue>(() => ({
    characters,
    records,
    saveStates,
    user,
    loading,
    cloudEnabled: supabaseConfigured || e2eAuthEnabled,
    error,
    refresh,
    save(character) {
      // Local-first: the durable local commit happens synchronously here; the
      // controller handles debounced cloud replication. Returns the character
      // as it now stands in the durable local envelope.
      const record = controllerRef.current!.commit(character, userRef.current ? undefined : loadOrCreateCreatorInstanceId());
      setSaveStates((states) => ({ ...states, [record.character.id]: 'local' }));
      return Promise.resolve(record.character);
    },
    remove(id) {
      controllerRef.current?.remove(id);
      setCharacters((current) => current.filter((item) => item.id !== id));
      setRecords((current) => current.filter((record) => record.character.id !== id));
      setSaveStates(({ [id]: _removed, ...rest }) => rest);
      return Promise.resolve();
    },
    flush(id) {
      controllerRef.current?.flush(id);
    },
    async signIn(email) {
      if (e2eAuthEnabled) throw new Error('Browser acceptance identities are provisioned by the E2E route, not email login.');
      if (!supabase) throw new Error('Supabase is not configured for this deployment.');
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
      const { error: signInError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (signInError) throw signInError;
    },
    async signOut() {
      if (e2eAuthEnabled) {
        setUser(null);
        return;
      }
      if (supabase) await supabase.auth.signOut();
    },
  }), [characters, error, loading, records, refresh, saveStates, user]);

  return <CharacterContext.Provider value={value}>{children}</CharacterContext.Provider>;
}

export function useCharacters() {
  const value = useContext(CharacterContext);
  if (!value) throw new Error('useCharacters must be used inside CharacterProvider.');
  return value;
}