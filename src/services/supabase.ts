import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseConfigured = Boolean(url && anonKey);
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;
