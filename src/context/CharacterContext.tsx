import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { IconCharacter } from '../rules/index.js';
import { deleteCharacter, listCharacters, saveCharacter } from '../services/characters.js';
import { currentE2EIdentity, e2eAuthEnabled } from '../services/e2e-auth.js';
import { supabase, supabaseConfigured } from '../services/supabase.js';

/** The UI only needs an id and display email from a Supabase user. */
type AppUser = Pick<User, 'id' | 'email'>;

interface CharacterContextValue {
  characters: IconCharacter[];
  user: AppUser | null;
  loading: boolean;
  cloudEnabled: boolean;
  error: string;
  refresh(): Promise<void>;
  save(character: IconCharacter): Promise<IconCharacter>;
  remove(id: string): Promise<void>;
  signIn(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const CharacterContext = createContext<CharacterContextValue | null>(null);

export function CharacterProvider({ children }: { children: ReactNode }) {
  const [characters, setCharacters] = useState<IconCharacter[]>([]);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCharacters(await listCharacters(user?.id ?? null));
      setError('');
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
      setLoading(false);
      setCharacters([]);
      void listCharacters(null).then((items) => active && setCharacters(items));
      return () => { active = false; };
    }
    void supabase.auth.getUser().then(({ data }) => active && setUser(data.user));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<CharacterContextValue>(() => ({
    characters,
    user,
    loading,
    cloudEnabled: supabaseConfigured || e2eAuthEnabled,
    error,
    refresh,
    async save(character) {
      const saved = await saveCharacter(character, user?.id ?? null);
      setCharacters((current) => [saved, ...current.filter(({ id }) => id !== saved.id)]);
      return saved;
    },
    async remove(id) {
      await deleteCharacter(id, user?.id ?? null);
      setCharacters((current) => current.filter((character) => character.id !== id));
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
  }), [characters, error, loading, refresh, user]);

  return <CharacterContext.Provider value={value}>{children}</CharacterContext.Provider>;
}

export function useCharacters() {
  const value = useContext(CharacterContext);
  if (!value) throw new Error('useCharacters must be used inside CharacterProvider.');
  return value;
}
